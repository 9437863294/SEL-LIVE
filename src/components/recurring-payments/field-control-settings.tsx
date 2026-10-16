'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowDownAZ, ArrowUpAZ, Loader2, Lock, RotateCcw, Save, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { RP_COLLECTIONS } from '@/lib/recurring-payments';
import { RP_FORM_KEYS, RP_FORM_REGISTRY, type RPFormKey } from '@/lib/recurring-payments-field-registry';
import { resolveListSort, sortDirectionLabel, type SortDirection } from '@/lib/list-sort';
import {
  RP_LIST_KEYS,
  RP_LIST_REGISTRY,
  sortControlDocId,
  type RPListKey,
  type RPSortControlDoc,
} from '@/lib/recurring-payments-sort-registry';
import { fieldControlDocId, type RPFieldSetting } from './use-field-control';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Draft = Record<RPFormKey, Record<string, RPFieldSetting>>;

function buildDefaultDraft(): Draft {
  const draft = {} as Draft;
  for (const formKey of RP_FORM_KEYS) {
    draft[formKey] = {};
    for (const field of RP_FORM_REGISTRY[formKey].fields) {
      draft[formKey][field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
    }
  }
  return draft;
}

export default function RecurringFieldControlSettings() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.RECURRING_PAYMENTS);
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const canView = can('View', 'Recurring Payments.Settings');
  // The Firestore rules grant writes to the field-control documents on exactly this permission.
  const canEdit = can('Manage Field Control', 'Recurring Payments.Settings');
  const [activeForm, setActiveForm] = useState<RPFormKey>('master');
  const [draft, setDraft] = useState<Draft>(buildDefaultDraft);
  /**
   * Opening sort order per list, in its own document beside the field map — edited here because this
   * is where an administrator already decides how the module's screens behave, but stored apart so
   * neither save can overwrite the other's shape.
   */
  const [sortDraft, setSortDraft] = useState<RPSortControlDoc>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        doc(db, RP_COLLECTIONS.settings, fieldControlDocId(organizationId)),
        (snapshot) => {
          const stored = (snapshot.data() || {}) as Partial<Draft>;
          const next = buildDefaultDraft();
          for (const formKey of RP_FORM_KEYS) {
            for (const field of RP_FORM_REGISTRY[formKey].fields) {
              const override = stored[formKey]?.[field.key];
              if (!override) continue;
              if (field.locked) {
                next[formKey][field.key] = { ...next[formKey][field.key], label: override.label || field.defaultLabel };
                continue;
              }
              next[formKey][field.key] = {
                visible: override.visible ?? true,
                required: override.required ?? field.defaultRequired,
                label: override.label || field.defaultLabel,
              };
            }
          }
          setDraft(next);
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [organizationId],
  );

  useEffect(
    () =>
      onSnapshot(
        doc(db, RP_COLLECTIONS.settings, sortControlDocId(organizationId)),
        (snapshot) => {
          // Only the per-list entries; the audit stamp fields aren't sort settings.
          const data = (snapshot.data() || {}) as Record<string, unknown>;
          const next: RPSortControlDoc = {};
          for (const key of RP_LIST_KEYS) if (data[key]) next[key] = data[key] as RPSortControlDoc[RPListKey];
          setSortDraft(next);
        },
        // A read failure leaves the registry defaults in force, which is the safe fallback.
        () => undefined,
      ),
    [organizationId],
  );

  function update(formKey: RPFormKey, fieldKey: string, patch: Partial<RPFieldSetting>) {
    setDraft((current) => ({
      ...current,
      [formKey]: { ...current[formKey], [fieldKey]: { ...current[formKey][fieldKey], ...patch } },
    }));
  }

  function resetForm(formKey: RPFormKey) {
    setDraft((current) => {
      const reset: Record<string, RPFieldSetting> = {};
      for (const field of RP_FORM_REGISTRY[formKey].fields) {
        reset[field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
      }
      return { ...current, [formKey]: reset };
    });
  }

  function setSort(listKey: RPListKey, patch: { field?: string; direction?: SortDirection }) {
    setSortDraft((current) => ({ ...current, [listKey]: { ...resolveListSort(RP_LIST_REGISTRY, listKey, current), ...patch } }));
  }

  /** Clearing the entry, rather than writing the default, keeps the document free of noise. */
  function resetSort(listKey: RPListKey) {
    setSortDraft((current) => {
      const next = { ...current };
      delete next[listKey];
      return next;
    });
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    try {
      const stamp = { updatedAt: serverTimestamp(), updatedBy: user?.id || '', updatedByName: user?.name || '' };
      // Both documents together, so one Save button means what it says.
      await Promise.all([
        setDoc(doc(db, RP_COLLECTIONS.settings, fieldControlDocId(organizationId)), { ...draft, ...stamp }),
        setDoc(doc(db, RP_COLLECTIONS.settings, sortControlDocId(organizationId)), { ...sortDraft, ...stamp }),
      ]);
      void log('Update Recurring Payments Field Control', { lists: Object.keys(sortDraft).length });
      toast({ title: 'Saved', description: 'Field control and sort order updated.' });
    } catch (error) {
      toast({
        title: 'Field control could not be saved',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Access denied
          </CardTitle>
          <CardDescription>You do not have permission to view Field Control settings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const formDef = RP_FORM_REGISTRY[activeForm];
  const fields = formDef.fields;
  const formFieldState = draft[activeForm] || {};

  return (
    <div className="space-y-5">
      <PageHeader
        backHref="/recurring-payments/settings"
        backLabel="Back to settings"
        title="Field Control"
        description={<>Choose which fields appear, whether they&apos;re required, what they&apos;re called, and the order each list opens in.</>}
        actions={
          canEdit ? (
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save changes
            </Button>
          ) : undefined
        }
      />

      {!canEdit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          You have view-only access to Field Control. Ask your administrator for the &quot;Manage Field Control&quot;
          permission (Recurring Payments › Settings) to make changes.
        </div>
      )}

      <TableCard
        icon={SlidersHorizontal}
        title={formDef.title}
        description={formDef.description}
        scroll="natural"
        actions={
          <>
            <Select value={activeForm} onValueChange={(value) => setActiveForm(value as RPFormKey)}>
              <SelectTrigger className="w-full sm:w-auto sm:min-w-[16rem]" aria-label="Form">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RP_FORM_KEYS.map((key) => (
                  <SelectItem value={key} key={key}>
                    {RP_FORM_REGISTRY[key].title}
                  </SelectItem>
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
              <TableHead>Field key</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => {
              const setting = formFieldState[field.key] || {
                visible: true,
                required: field.defaultRequired,
                label: field.defaultLabel,
              };
              return (
                <TableRow key={field.key}>
                  <TableCell>
                    <Input
                      value={setting.label}
                      disabled={!canEdit}
                      aria-label={`${field.defaultLabel} label`}
                      onChange={(event) => update(activeForm, field.key, { label: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={setting.required}
                      disabled={!canEdit || field.locked}
                      aria-label={`${field.defaultLabel} required`}
                      onCheckedChange={(value) => update(activeForm, field.key, { required: value })}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={setting.visible}
                      disabled={!canEdit || field.locked}
                      aria-label={`${field.defaultLabel} visible`}
                      onCheckedChange={(value) => update(activeForm, field.key, { visible: value })}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono">
                    {field.key}
                    {field.locked && (
                      <Badge variant="outline" className="ml-2 gap-1 font-sans">
                        <Lock className="h-2.5 w-2.5" /> Locked
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableCard>

      {/* ── Sort Order ─────────────────────────────────────────────────────────── */}
      <TableCard
        icon={ArrowDownAZ}
        title="Sort Order"
        description={
          <>
            The order each list opens in. Anyone viewing a list can still re-sort it for themselves —
            this sets where it starts, for everyone in this organization.
          </>
        }
        scroll="natural"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-64">List</TableHead>
              <TableHead className="w-64">Sort by</TableHead>
              <TableHead className="w-48">Direction</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {RP_LIST_KEYS.map((listKey) => {
              const list = RP_LIST_REGISTRY[listKey];
              const current = resolveListSort(RP_LIST_REGISTRY, listKey, sortDraft);
              const type = list.fields.find((field) => field.key === current.field)?.type ?? 'text';
              const customised = sortDraft[listKey] !== undefined;
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
                        {list.fields.map((field) => (
                          <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={current.direction}
                      disabled={!canEdit}
                      onValueChange={(value) => setSort(listKey, { direction: value as SortDirection })}
                    >
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
                    {canEdit && customised && (
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
        Locked fields are required by the form&apos;s own logic — for example, a workflow step&apos;s mandatory amount or the
        record&apos;s own name/title — so they can&apos;t be hidden or made optional here, but their label can still be
        renamed. Changes apply to every user in this organization.
      </p>
    </div>
  );
}
