'use client';

import { useEffect, useState } from 'react';
import { deleteField, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { CalendarClock, History, Landmark, Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BANK_PAGE, BankAccessDenied, BankPageSkeleton, accountLabel, useBankData } from '@/components/bank-balance/page-kit';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import {
  ALL_ACCOUNTS,
  ALL_ACCOUNTS_LABEL,
  BB_CONTROL_DOCS,
  BB_SETTINGS_COLLECTION,
  DEFAULT_BB_DATE_RULE,
  MAX_BACKDATE_DAYS,
  MAX_FUTURE_DAYS,
  accountsWithOwnRule,
  bbDateRuleFor,
  bbDateWindow,
  bbRuleOnly,
  clampDays,
  describeBBRule,
  resolveBBDateControl,
  todayLocal,
  type BBDateControlSettings,
  type BBDateRule,
} from '@/lib/bank-balance-entry-controls';
import { BB_CONTROL_ACTIONS, BankDateControlHistory } from './histories';

/** Common windows, so the usual choice is one click rather than a number to think about. */
const PRESETS = [
  { days: 0, label: 'Today only' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 15, label: '15 days' },
  { days: 30, label: '1 month' },
  { days: 90, label: '1 quarter' },
];

const POST_DATED_PRESETS = [
  { days: 0, label: 'None' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
];

/**
 * Bank Balance › Settings › Date Control: how far back — and forward — a payment, receipt or
 * transfer may be dated, for all accounts or one account of its own. Site Account's page, for
 * bank accounts, with a separate forward limit for post-dated cheques.
 */
export default function BankDateControlSettings() {
  const { can, isLoading: authLoading } = useAuthorization();
  // Field Control, then the module's settings right, stand in for Date Control until roles grant it.
  const canEdit = can('Edit', 'Bank Balance.Date Control') || can('Edit', 'Bank Balance.Field Control') || can('Edit', 'Bank Balance.Payment Entry Settings');
  const canView = canEdit || can('View', 'Bank Balance.Date Control') || can('View', 'Bank Balance.Field Control') || can('View Module', 'Bank Balance');

  const [stored, setStored] = useState<BBDateControlSettings>(() => resolveBBDateControl(null));
  const [loading, setLoading] = useState(true);
  const { accounts } = useBankData({ enabled: canView && !authLoading });
  const [scope, setScope] = useState<string>(ALL_ACCOUNTS);
  const [tab, setTab] = useState('rule');
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(
    () =>
      onSnapshot(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.dateControl),
        (snapshot) => {
          setStored(resolveBBDateControl(snapshot.data() as Partial<BBDateControlSettings> | undefined));
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [],
  );

  if (authLoading || loading) return <BankPageSkeleton kpis={0} blocks={1} />;
  if (!canView) return <BankAccessDenied title="Date Control" backHref="/bank-balance/settings" backLabel="Back to settings" what="Date Control" />;

  const scopeAccount = scope === ALL_ACCOUNTS ? undefined : scope;
  const nameOf = (id: string) => {
    const account = accounts.find((a) => a.id === id);
    return account ? accountLabel(account) : 'this account';
  };
  const scopeName = scopeAccount ? nameOf(scopeAccount) : ALL_ACCOUNTS_LABEL;
  const allRule = bbRuleOnly(bbDateRuleFor(stored));
  const ownRule = scopeAccount ? stored.accounts[scopeAccount] : undefined;
  const overridden = accountsWithOwnRule(stored)
    .map((id) => ({ id, name: nameOf(id), rule: stored.accounts[id] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Active accounts, plus any inactive one that still carries a rule of its own.
  const pickable = accounts.filter((a) => a.status === 'Active' || stored.accounts[a.id]);

  return (
    <div className={BANK_PAGE}>
      <PageHeader
        backHref="/bank-balance/settings"
        backLabel="Back to settings"
        title="Date Control"
        description="How far back a payment, receipt or transfer may be dated — for all accounts, or one account of its own."
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="rule" className="gap-1.5"><CalendarClock className="h-4 w-4" /> Rule</TabsTrigger>
          <TabsTrigger value="accounts" className="gap-1.5">
            <Landmark className="h-4 w-4" /> Accounts with own rule{overridden.length > 0 ? ` (${overridden.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5"><History className="h-4 w-4" /> History</TabsTrigger>
        </TabsList>

        <TabsContent value="rule" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">Rule for</span>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="w-full sm:w-[280px]" aria-label="Date control scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ACCOUNTS}>{ALL_ACCOUNTS_LABEL}</SelectItem>
                {pickable.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {accountLabel(a)} — {a.bankName}
                    {stored.accounts[a.id] ? ' · own rule' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {scopeAccount
                ? 'A rule set here applies to this account only, in place of the all-accounts rule.'
                : 'Applies to every account that has no rule of its own.'}
            </span>
          </div>

          <DateRuleEditor
            // Keyed by scope, so a draft for one account never carries over to another.
            key={scope}
            scopeAccount={scopeAccount}
            scopeName={scopeName}
            initialRule={scopeAccount ? ownRule ?? allRule : allRule}
            initialOwn={Boolean(ownRule)}
            allRule={allRule}
            canEdit={canEdit}
            onSaved={() => setHistoryKey((k) => k + 1)}
          />
        </TabsContent>

        <TabsContent value="accounts" className="mt-0">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Accounts with their own rule</CardTitle>
              <CardDescription>
                {overridden.length > 0
                  ? 'These ignore the all-accounts rule. Pick one to change or remove its rule.'
                  : 'Every account follows the all-accounts rule. Give one its own on the Rule tab.'}
              </CardDescription>
            </CardHeader>
            {overridden.length > 0 && (
              <CardContent className="divide-y border-t p-0">
                {overridden.map(({ id, name, rule }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setScope(id);
                      setTab('rule');
                    }}
                    className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-6 py-2.5 text-left text-sm hover:bg-muted/40"
                  >
                    <span className="font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">{describeBBRule(rule)}</span>
                  </button>
                ))}
              </CardContent>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <BankDateControlHistory scopeName={scopeName} scopeAccount={scopeAccount} refreshKey={historyKey} />
        </TabsContent>
      </Tabs>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          You can view this configuration but not change it. Ask an administrator for Edit on Bank Balance › Date Control.
        </p>
      )}
    </div>
  );
}

function DayPresets({
  presets,
  value,
  onPick,
  disabled,
}: {
  presets: Array<{ days: number; label: string }>;
  value: number;
  onPick: (days: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((preset) => (
        <Button
          key={preset.days}
          type="button"
          size="sm"
          variant={value === preset.days ? 'default' : 'outline'}
          onClick={() => onPick(preset.days)}
          disabled={disabled}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}

function DaysInput({ value, max, onChange, disabled, suffix, label }: { value: number; max: number; onChange: (days: number) => void; disabled: boolean; suffix: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        // `min`/`max` are hints the browser applies loosely — 1.5, -3 and 99999 all reach here — so
        // the value is made whole and bounded before it can be saved.
        onChange={(e) => onChange(clampDays(e.target.value, max))}
        disabled={disabled}
        className="h-9 w-28"
      />
      <span className="text-sm text-muted-foreground">{suffix}</span>
    </div>
  );
}

/** The rule for one scope: all accounts, or one account — which follows that rule or has its own. */
function DateRuleEditor({
  scopeAccount,
  scopeName,
  initialRule,
  initialOwn,
  allRule,
  canEdit,
  onSaved,
}: {
  scopeAccount?: string;
  scopeName: string;
  initialRule: BBDateRule;
  initialOwn: boolean;
  allRule: BBDateRule;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  const { toast } = useToast();
  const [draft, setDraft] = useState<BBDateRule>(initialRule);
  const [own, setOwn] = useState(initialOwn);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');

  // The all-accounts scope always edits its rule; an account edits one only when it has its own.
  const editing = !scopeAccount || own;
  const set = <K extends keyof BBDateRule>(key: K, value: BBDateRule[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  async function handleSave() {
    if (!canEdit) return;
    setSaving(true);
    const stamp = { updatedAt: serverTimestamp(), updatedBy: user?.id ?? '', updatedByName: user?.name ?? '' };
    try {
      const ref = doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.dateControl);
      if (!scopeAccount) await setDoc(ref, { ...bbRuleOnly(draft), ...stamp }, { merge: true });
      else await setDoc(ref, { accounts: { [scopeAccount]: own ? bbRuleOnly(draft) : deleteField() }, ...stamp }, { merge: true });
      await log(BB_CONTROL_ACTIONS.dateControl, {
        scope: scopeAccount ? scopeName : ALL_ACCOUNTS_LABEL,
        ...(editing ? bbRuleOnly(draft) : { follows: ALL_ACCOUNTS_LABEL }),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }).catch(() => {});
      setReason('');
      onSaved();
      toast({
        title: 'Saved',
        description: scopeAccount
          ? own ? `${scopeName} now has its own date rule.` : `${scopeName} now follows the all-accounts rule.`
          : 'Date control updated. It applies to new entries immediately.',
      });
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not save.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  // The window exactly as a user would see it, so the consequence of a number is readable.
  const today = todayLocal();
  const rule = editing ? draft : allRule;
  const entries = bbDateWindow({ settings: rule, kind: 'receipt', today });
  const cheques = bbDateWindow({ settings: rule, kind: 'payment', postDated: true, today });

  return (
    <Card>
      {scopeAccount && (
        <CardHeader className="border-b pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">{scopeName}</CardTitle>
              <CardDescription className="mt-1">
                {own ? 'Has its own rule, below. The all-accounts rule does not apply to it.' : <>Follows the all-accounts rule: <strong>{describeBBRule(allRule)}</strong>.</>}
              </CardDescription>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <span className="text-muted-foreground">Own rule</span>
              <Switch
                checked={own}
                onCheckedChange={(v) => {
                  setOwn(v);
                  if (v && !initialOwn) setDraft(allRule);
                }}
                disabled={!canEdit}
                aria-label={`Give ${scopeName} its own date rule`}
              />
            </label>
          </div>
        </CardHeader>
      )}

      {editing && (
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-emerald-600" />
                Restrict entry dates
              </CardTitle>
              <CardDescription className="mt-1">
                {scopeAccount
                  ? 'Off means this account accepts any date, whatever the all-accounts rule says.'
                  : 'Off by default. While off, any date can be entered — exactly as before this setting existed.'}
              </CardDescription>
            </div>
            <Switch checked={draft.enabled} onCheckedChange={(v) => set('enabled', v)} disabled={!canEdit} aria-label="Restrict entry dates" />
          </div>
        </CardHeader>
      )}

      <CardContent className={editing && draft.enabled ? 'space-y-6 border-t pt-5' : 'space-y-4 pt-4'}>
        {editing && draft.enabled && (
          <>
            <div className="space-y-2.5">
              <Label className="text-sm font-medium">Allow back-dating up to</Label>
              <DayPresets presets={PRESETS} value={draft.backdateDays} onPick={(days) => set('backdateDays', days)} disabled={!canEdit} />
              <div className="pt-1">
                <DaysInput value={draft.backdateDays} max={MAX_BACKDATE_DAYS} onChange={(days) => set('backdateDays', days)} disabled={!canEdit} suffix="days before today" label="Days before today" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Allow future dating up to</Label>
              <DaysInput value={draft.futureDays} max={MAX_FUTURE_DAYS} onChange={(days) => set('futureDays', days)} disabled={!canEdit} suffix="days after today" label="Days after today" />
              <p className="text-xs text-muted-foreground">
                For receipts, transfers and payments by bank transfer. Leave at 0 so money cannot be recorded as moved before it has.
              </p>
            </div>

            <div className="space-y-2.5">
              <Label className="text-sm font-medium">Allow post-dated cheques and DDs up to</Label>
              <DayPresets presets={POST_DATED_PRESETS} value={draft.postDatedDays} onPick={(days) => set('postDatedDays', days)} disabled={!canEdit} />
              <div className="pt-1">
                <DaysInput value={draft.postDatedDays} max={MAX_FUTURE_DAYS} onChange={(days) => set('postDatedDays', days)} disabled={!canEdit} suffix="days after today" label="Post-dated days after today" />
              </div>
              <p className="text-xs text-muted-foreground">
                A cheque is valid for three months, so 90 days covers every cheque the bank will honour. 0 stops post-dated cheques.
              </p>
            </div>

            <div className="space-y-2.5">
              <Label className="text-sm font-medium">Apply to</Label>
              {([
                ['applyToPayments', 'Payments', ' — the payment voucher form'],
                ['applyToReceipts', 'Receipts', ' — the receipt entry form'],
                ['applyToTransfers', 'Transfers', ' — new transfers, and edits to existing ones'],
              ] as const).map(([key, title, note]) => (
                <label key={key} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5">
                  <Switch checked={draft[key]} onCheckedChange={(v) => set(key, v)} disabled={!canEdit} aria-label={`Apply to ${title}`} />
                  <span className="text-sm">
                    {title}
                    <span className="text-muted-foreground">{note}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            {scopeAccount ? `What users on ${scopeName} see today` : 'What every user sees today'}
          </p>
          <p className="mt-1 text-sm text-emerald-900 dark:text-emerald-100">
            {entries.enforced || cheques.enforced ? (
              <>
                Dates from <strong>{(entries.min ?? cheques.min)!}</strong> to <strong>{entries.max ?? today}</strong>
                {cheques.enforced && cheques.max !== entries.max && (
                  <>; cheques and DDs up to <strong>{cheques.max}</strong></>
                )}{' '}
                ({today} is today).
              </>
            ) : (
              <>No restriction — every date is accepted.</>
            )}
          </p>
        </div>

        {editing && draft.enabled && (
          <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">No permission overrides this</p>
              <p>
                The window applies to every user, administrators included, on every form that records a payment, receipt or
                transfer. To allow an older entry, widen the window here; to correct a month that has already been reported,
                reopen it in Month Closure.
              </p>
            </div>
          </div>
        )}

        {canEdit && (
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for this change (optional)"
              aria-label="Reason for this change"
              maxLength={300}
              className="h-9 sm:mr-auto sm:max-w-md"
            />
            <div className="flex flex-wrap justify-end gap-2">
              {editing && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setDraft(scopeAccount ? allRule : DEFAULT_BB_DATE_RULE)} disabled={saving}>
                  <RotateCcw className="h-4 w-4" /> {scopeAccount ? 'Copy all-accounts rule' : 'Reset'}
                </Button>
              )}
              <Button size="sm" className="gap-2" onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save{scopeAccount ? ` for ${scopeName}` : ''}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
