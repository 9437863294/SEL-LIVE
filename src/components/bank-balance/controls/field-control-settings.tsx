'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowDownAZ, ArrowUpAZ, History, Info, Loader2, Lock, RotateCcw, Save, SlidersHorizontal, Wallet } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BANK_PAGE, BankAccessDenied, BankPageSkeleton } from '@/components/bank-balance/page-kit';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { BB_CONTROL_DOCS, BB_SETTINGS_COLLECTION } from '@/lib/bank-balance-entry-controls';
import {
  BB_FORM_KEYS,
  BB_FORM_REGISTRY,
  BB_LIST_KEYS,
  BB_LIST_REGISTRY,
  LEGACY_PAYMENT_MANDATORY,
  describeBBSort,
  resolveAllForms,
  resolveBBSort,
  sortDirectionLabel,
  type BBFieldControlDoc,
  type BBFieldSetting,
  type BBFormKey,
  type BBListKey,
  type BBSortControlDoc,
} from '@/lib/bank-balance-field-registry';
import { fieldControlChanges } from '@/lib/site-account-statement-field-control-changes';
import type { SASSortDirection } from '@/lib/site-account-statement-sort-registry';
import { BB_CONTROL_ACTIONS, BankFieldControlHistory } from './histories';
import { PaymentOptions } from './payment-options';

type FieldControlTab = 'fields' | 'sort' | 'payment' | 'history';
const TABS: FieldControlTab[] = ['fields', 'sort', 'payment', 'history'];

/** The tab a link asked for (`?tab=payment` — the old Payment Entry page redirects there). */
function requestedTab(): FieldControlTab {
  if (typeof window === 'undefined') return 'fields';
  const asked = new URLSearchParams(window.location.search).get('tab') as FieldControlTab | null;
  return asked && TABS.includes(asked) ? asked : 'fields';
}

type Draft = Record<BBFormKey, Record<string, BBFieldSetting>>;

/** Each list's opening sort, described and keyed by list title — what a save is compared on. */
function describeSorts(doc: BBSortControlDoc): Record<string, string> {
  return Object.fromEntries(BB_LIST_KEYS.map((key) => [BB_LIST_REGISTRY[key].title, describeBBSort(key, resolveBBSort(key, doc))]));
}

/**
 * Bank Balance › Settings › Field Control: per form, which fields appear, whether they are
 * required and what they are called; and the order each flat list opens in. Site Account's page,
 * for Bank Balance's forms.
 */
export default function BankFieldControlSettings() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  const { toast } = useToast();
  // The module's settings right stands in for Field Control until roles grant it.
  const canEdit = can('Edit', 'Bank Balance.Field Control') || can('Edit', 'Bank Balance.Payment Entry Settings');
  // Payment options keep the old Payment Entry page's rights: the settings right, or recording payments.
  const canEditPayment = can('Edit', 'Bank Balance.Payment Entry Settings') || can('Add', 'Bank Balance.Expenses');
  const canView = canEdit || canEditPayment || can('View', 'Bank Balance.Field Control')
    || can('View', 'Bank Balance.Payment Entry Settings') || can('View Module', 'Bank Balance');
  // Read on the first render only: the page shows its skeleton until permissions resolve, so the
  // server's markup never contains the tabs and cannot disagree with this.
  const [tab, setTab] = useState<FieldControlTab>(requestedTab);
  const fieldTabs = tab === 'fields' || tab === 'sort';

  const [activeForm, setActiveForm] = useState<BBFormKey>('payment');
  const [stored, setStored] = useState<BBFieldControlDoc | null>(null);
  const [legacy, setLegacy] = useState<Record<string, unknown> | null>(null);
  const [edits, setEdits] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sortStored, setSortStored] = useState<BBSortControlDoc>({});
  const [sortEdits, setSortEdits] = useState<BBSortControlDoc | null>(null);
  /** Why the change is being made — optional, kept with it in History. */
  const [reason, setReason] = useState('');
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(
    () =>
      onSnapshot(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.fieldControl),
        (snapshot) => {
          setStored((snapshot.data() as BBFieldControlDoc | undefined) ?? null);
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(
        doc(db, BB_SETTINGS_COLLECTION, 'paymentEntry'),
        (snapshot) => setLegacy((snapshot.data()?.mandatoryFields as Record<string, unknown> | undefined) ?? null),
        () => setLegacy(null),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.sortControl),
        (snapshot) => setSortStored((snapshot.data() as BBSortControlDoc | undefined) ?? {}),
        // A read failure leaves the registry defaults in force, which is the safe fallback.
        () => undefined,
      ),
    [],
  );

  // The settings as last saved, so a save can say what it changed; the draft is that until edited.
  const saved = useMemo(() => resolveAllForms(stored, legacy), [stored, legacy]);
  const draft = edits ?? saved;
  const sortDraft = sortEdits ?? sortStored;
  // Payment Entry's old switches still set the defaults until Field Control is first saved.
  const legacyInForce = !stored?.payment && Boolean(legacy && Object.values(LEGACY_PAYMENT_MANDATORY).some((key) => legacy[key] === true));

  function update(formKey: BBFormKey, fieldKey: string, patch: Partial<BBFieldSetting>) {
    setEdits((current) => {
      const base = current ?? saved;
      return { ...base, [formKey]: { ...base[formKey], [fieldKey]: { ...base[formKey][fieldKey], ...patch } } };
    });
  }

  function resetForm(formKey: BBFormKey) {
    const reset: Record<string, BBFieldSetting> = {};
    for (const field of BB_FORM_REGISTRY[formKey].fields) reset[field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
    setEdits((current) => ({ ...(current ?? saved), [formKey]: reset }));
  }

  function setSort(listKey: BBListKey, patch: { field?: string; direction?: SASSortDirection }) {
    setSortEdits((current) => {
      const base = current ?? sortStored;
      return { ...base, [listKey]: { ...resolveBBSort(listKey, base), ...patch } };
    });
  }

  /** Clearing the entry, rather than writing the default, keeps the document free of noise. */
  function resetSort(listKey: BBListKey) {
    setSortEdits((current) => {
      const next = { ...(current ?? sortStored) };
      delete next[listKey];
      return next;
    });
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    try {
      const stamp = { updatedAt: serverTimestamp(), updatedBy: user?.id || '', updatedByName: user?.name || '' };
      // Both documents go together, so one Save button means what it says.
      await Promise.all([
        setDoc(doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.fieldControl), { ...draft, ...stamp }),
        setDoc(doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.sortControl), { ...sortDraft, ...stamp }),
      ]);
      const changes = fieldControlChanges({
        forms: BB_FORM_KEYS.map((key) => ({ key, title: BB_FORM_REGISTRY[key].title, fields: BB_FORM_REGISTRY[key].fields })),
        before: saved,
        after: draft,
        sortBefore: describeSorts(sortStored),
        sortAfter: describeSorts(sortDraft),
      });
      // Awaited, so the History tab shows this entry. A failed log never fails the save.
      await log(BB_CONTROL_ACTIONS.fieldControl, {
        changes,
        changeCount: Object.keys(changes).length,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }).catch(() => {});
      setEdits(null);
      setSortEdits(null);
      setReason('');
      setHistoryKey((k) => k + 1);
      toast({ title: 'Saved', description: 'Field control and sort order updated for everyone.' });
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not save.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) return <BankPageSkeleton kpis={0} blocks={1} />;
  if (!canView) return <BankAccessDenied title="Field Control" backHref="/bank-balance/settings" backLabel="Back to settings" what="Field Control" />;

  const formDef = BB_FORM_REGISTRY[activeForm];
  const formState = draft[activeForm];

  return (
    <div className={BANK_PAGE}>
      <PageHeader
        backHref="/bank-balance/settings"
        backLabel="Back to settings"
        title="Field Control"
        description="Choose which fields appear, whether they're required, and what they're called — per form — the order each list opens in, and the payment form's options."
        actions={
          canEdit && fieldTabs ? (
            <>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for this change (optional)"
                aria-label="Reason for this change"
                maxLength={300}
                className="h-9 sm:w-64"
              />
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save changes
              </Button>
            </>
          ) : undefined
        }
      />

      {!canEdit && fieldTabs && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          You have view-only access to Field Control. Ask your administrator for &quot;Edit&quot; on Bank Balance › Field Control to make changes.
        </div>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as FieldControlTab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="fields" className="gap-1.5"><SlidersHorizontal className="h-4 w-4" /> Fields</TabsTrigger>
          <TabsTrigger value="sort" className="gap-1.5"><ArrowDownAZ className="h-4 w-4" /> Sort order</TabsTrigger>
          <TabsTrigger value="payment" className="gap-1.5"><Wallet className="h-4 w-4" /> Payment options</TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5"><History className="h-4 w-4" /> History</TabsTrigger>
        </TabsList>

        <TabsContent value="fields" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
          {activeForm === 'payment' && legacyInForce && (
            <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              The mandatory switches that used to be on the Payment Entry page now live here. They are shown below as they were
              set, and keep applying until this page is saved.
            </p>
          )}
          <TableCard
            icon={SlidersHorizontal}
            title={formDef.title}
            description={formDef.description}
            scroll="natural"
            actions={
              <>
                <Select value={activeForm} onValueChange={(value) => setActiveForm(value as BBFormKey)}>
                  <SelectTrigger className="w-full sm:w-auto sm:min-w-[14rem]" aria-label="Form">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BB_FORM_KEYS.map((key) => (
                      <SelectItem value={key} key={key}>{BB_FORM_REGISTRY[key].title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => resetForm(activeForm)}>
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Reset
                  </Button>
                )}
              </>
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-64">Label</TableHead>
                  <TableHead className="w-28 text-center">Required</TableHead>
                  <TableHead className="w-28 text-center">Visible</TableHead>
                  <TableHead>Field</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formDef.fields.map((field) => {
                  const setting = formState[field.key];
                  return (
                    <TableRow key={field.key}>
                      <TableCell>
                        <Input
                          value={setting.label}
                          disabled={!canEdit}
                          aria-label={`Label for ${field.defaultLabel}`}
                          onChange={(event) => update(activeForm, field.key, { label: event.target.value })}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={setting.required}
                          disabled={!canEdit || field.locked || !setting.visible}
                          aria-label={`${field.defaultLabel} required`}
                          onCheckedChange={(value) => update(activeForm, field.key, { required: value })}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={setting.visible}
                          disabled={!canEdit || field.locked || field.alwaysShown}
                          aria-label={`${field.defaultLabel} visible`}
                          onCheckedChange={(value) => update(activeForm, field.key, { visible: value })}
                        />
                      </TableCell>
                      <TableCell className="min-w-[14rem]">
                        <span className="whitespace-nowrap font-mono text-xs">{field.key}</span>
                        {field.locked && (
                          <Badge variant="outline" className="ml-2 gap-1 font-sans">
                            <Lock className="h-2.5 w-2.5" /> Locked
                          </Badge>
                        )}
                        {field.hint && <span className="mt-1 block text-xs text-muted-foreground">{field.hint}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableCard>
          <p className="text-xs text-muted-foreground">
            Locked fields are needed by the form&apos;s own logic — an entry&apos;s account, date and amount, or what the save cannot do
            without — so they can&apos;t be hidden or made optional, but their label can still be renamed. A hidden field is never
            required. Changes apply to everyone using Bank Balance.
          </p>
        </TabsContent>

        <TabsContent value="sort" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
          <TableCard
            icon={ArrowDownAZ}
            title="Sort order"
            description="The order each list opens in. Anyone viewing a list can still re-sort it for themselves — this sets where it starts, for everyone."
            scroll="natural"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-64">List</TableHead>
                  <TableHead className="w-56">Sort by</TableHead>
                  <TableHead className="w-48">Direction</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {BB_LIST_KEYS.map((listKey) => {
                  const list = BB_LIST_REGISTRY[listKey];
                  const current = resolveBBSort(listKey, sortDraft);
                  const type = list.fields.find((f) => f.key === current.field)?.type ?? 'text';
                  return (
                    <TableRow key={listKey}>
                      <TableCell>
                        <p className="font-medium">{list.title}</p>
                        <p className="text-xs text-muted-foreground">{list.description}</p>
                      </TableCell>
                      <TableCell>
                        <Select value={current.field} disabled={!canEdit} onValueChange={(value) => setSort(listKey, { field: value })}>
                          <SelectTrigger aria-label={`${list.title} sort by`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {list.fields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={current.direction} disabled={!canEdit} onValueChange={(value) => setSort(listKey, { direction: value as SASSortDirection })}>
                          <SelectTrigger aria-label={`${list.title} direction`}>
                            <div className="flex items-center gap-2">
                              {current.direction === 'asc' ? <ArrowUpAZ className="h-3.5 w-3.5" /> : <ArrowDownAZ className="h-3.5 w-3.5" />}
                              <SelectValue />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="asc">{sortDirectionLabel(type, 'asc')}</SelectItem>
                            <SelectItem value="desc">{sortDirectionLabel(type, 'desc')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {canEdit && sortDraft[listKey] !== undefined && (
                          <Button variant="ghost" size="sm" onClick={() => resetSort(listKey)}>
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableCard>
          <p className="text-xs text-muted-foreground">
            The payments and receipts logs (grouped by date and bank) and the transfers ledger keep their date order: re-sorting them
            would break their grouping rather than reorder it.
          </p>
        </TabsContent>

        <TabsContent value="payment" className="mt-0 space-y-4">
          <PaymentOptions canEdit={canEditPayment} />
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <BankFieldControlHistory refreshKey={historyKey} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
