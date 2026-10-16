'use client';

import { useEffect, useState } from 'react';
import {
  collection, deleteField, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc,
} from 'firebase/firestore';
import {
  Building2, CalendarClock, Loader2, RotateCcw, Save, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { SAS_COLLECTIONS, SAS_DATE_CONTROL_DOC_ID, type SASProject } from '@/lib/site-account-statement';
import {
  DEFAULT_DATE_CONTROL,
  MAX_BACKDATE_DAYS,
  MAX_FUTURE_DAYS,
  clampDays,
  dateRuleFor,
  projectsWithOwnRule,
  resolveDateControl,
  resolveDateWindow,
  todayLocal,
  type SASDateControlSettings,
  type SASDateRule,
} from '@/lib/site-account-statement-date-policy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DateControlHistory } from './date-control-history';

const MODULE = 'Site Account Statement';
const ALL_PROJECTS = 'all';

/** Common windows, so the usual choice is one click rather than a number to think about. */
const PRESETS = [
  { days: 0,  label: 'Today only' },
  { days: 3,  label: '3 days' },
  { days: 7,  label: '1 week' },
  { days: 15, label: '15 days' },
  { days: 30, label: '1 month' },
  { days: 90, label: '1 quarter' },
];

/** The fields of a rule only — what is written for the all-projects rule or a project's. */
function ruleOnly(rule: SASDateRule): SASDateRule {
  return {
    enabled: rule.enabled,
    // Bounded again here: the draft is also set by Reset and the presets, not only by the inputs
    // that already clamp, and the saved value is what every form reads.
    backdateDays: clampDays(rule.backdateDays, MAX_BACKDATE_DAYS),
    futureDays: clampDays(rule.futureDays, MAX_FUTURE_DAYS),
    applyToExpenses: rule.applyToExpenses,
    applyToPayments: rule.applyToPayments,
  };
}

/** One line saying what a rule does, for the follow-all note and the project list. */
function describeRule(rule: SASDateRule): string {
  if (!rule.enabled) return 'No restriction';
  const back = rule.backdateDays === 0 ? 'today only' : `back-dating up to ${rule.backdateDays} day${rule.backdateDays === 1 ? '' : 's'}`;
  const ahead = rule.futureDays > 0 ? `, up to ${rule.futureDays} day${rule.futureDays === 1 ? '' : 's'} ahead` : '';
  return `${back.charAt(0).toUpperCase()}${back.slice(1)}${ahead}`;
}

export default function SiteAccountDateControlSettings() {
  const { can, isLoading: authLoading } = useAuthorization();

  /*
   * Field Control stands in for Date Control until roles are updated.
   *
   * `Date Control` is a new resource, so no existing role document grants it. Without this the
   * settings card would be reachable (the hub applies the same fallback) but the page behind it
   * would refuse everyone — the worst of both. One-directional: holding Date Control never implies
   * Field Control. Grant `Date Control` explicitly in Role Management to separate the two.
   */
  const canView = can('View', `${MODULE}.Date Control`) || can('Edit', `${MODULE}.Date Control`)
    || can('View', `${MODULE}.Field Control`) || can('Edit', `${MODULE}.Field Control`);
  const canEdit = can('Edit', `${MODULE}.Date Control`) || can('Edit', `${MODULE}.Field Control`);

  const [stored, setStored] = useState<SASDateControlSettings>(() => resolveDateControl(null));
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<SASProject[]>([]);
  const [scope, setScope] = useState<string>(ALL_PROJECTS);
  /** Bumped after each save, so the History card shows the new entry. */
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(
    () =>
      onSnapshot(
        doc(db, SAS_COLLECTIONS.settings, SAS_DATE_CONTROL_DOC_ID),
        (snapshot) => {
          setStored(resolveDateControl(snapshot.data() as Partial<SASDateControlSettings> | undefined));
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName')))
      .then(snap => {
        if (cancelled) return;
        setProjects(
          snap.docs
            .map(d => ({ id: d.id, ...d.data() } as SASProject))
            .filter(p => p.enabledForSiteAccount && p.status === 'Active'),
        );
      })
      .catch(() => { /* the scope picker falls back to all-projects only */ });
    return () => { cancelled = true; };
  }, []);

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
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldAlert className="h-12 w-12 text-destructive" />
          <p className="font-semibold text-slate-800">Access Denied</p>
          <p className="text-sm text-muted-foreground">You don&apos;t have permission to configure date control.</p>
        </CardContent>
      </Card>
    );
  }

  const scopeProject = scope === ALL_PROJECTS ? undefined : scope;
  const scopeName = scopeProject
    ? projects.find(p => p.id === scopeProject)?.projectName ?? 'this project'
    : 'All projects';
  const allRule = ruleOnly(dateRuleFor(stored));
  const ownRule = scopeProject ? stored.projects?.[scopeProject] : undefined;
  const overridden = projectsWithOwnRule(stored)
    .map(id => ({ id, name: projects.find(p => p.id === id)?.projectName ?? id, rule: stored.projects![id] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <PageHeader
        backHref="/site-account-statement/settings"
        backLabel="Back to settings"
        title="Date Control"
        description="How far back an expense or receipt may be dated — for all projects, or one project of its own."
      />

      {/* ── Scope ── its own bar, above everything it governs, as on Month Closure. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white/80 px-4 py-3">
        <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="text-sm font-medium text-slate-700">Rule for</span>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-full sm:w-[280px]" aria-label="Date control scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projects.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.projectName}{p.projectCode ? ` (${p.projectCode})` : ''}
                {stored.projects?.[p.id] ? ' · own rule' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {scopeProject
            ? 'A rule set here applies to this project only, in place of the all-projects rule.'
            : 'Applies to every project that has no rule of its own.'}
        </span>
      </div>

      <DateRuleEditor
        // Keyed by scope, so a draft for one project never carries over to another.
        key={scope}
        scopeProject={scopeProject}
        scopeName={scopeName}
        initialRule={scopeProject ? (ownRule ?? allRule) : allRule}
        initialOwn={Boolean(ownRule)}
        allRule={allRule}
        canEdit={canEdit}
        onSaved={() => setHistoryKey(k => k + 1)}
      />

      {/* Which projects do not follow the all-projects rule — said where the rule is set. */}
      {!scopeProject && overridden.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Projects with their own rule</CardTitle>
            <CardDescription>These ignore the rule above. Pick one to change or remove its rule.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y border-t p-0">
            {overridden.map(({ id, name, rule }) => (
              <button
                key={id}
                type="button"
                onClick={() => setScope(id)}
                className="flex w-full items-center justify-between gap-3 px-6 py-2.5 text-left text-sm hover:bg-muted/40"
              >
                <span className="font-medium text-slate-800">{name}</span>
                <span className="text-xs text-muted-foreground">{describeRule(rule)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <DateControlHistory scopeName={scopeName} scopeProject={scopeProject} refreshKey={historyKey} />

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          You can view this configuration but not change it. Ask an administrator for the Date Control · Edit permission.
        </p>
      )}
    </div>
  );
}

/**
 * The rule for one scope: all projects, or one project — which either follows the all-projects
 * rule or has its own.
 */
function DateRuleEditor({
  scopeProject,
  scopeName,
  initialRule,
  initialOwn,
  allRule,
  canEdit,
  onSaved,
}: {
  /** Called once a change is saved and logged, so the page's History card can refresh. */
  onSaved: () => void;
  scopeProject?: string;
  scopeName: string;
  initialRule: SASDateRule;
  /** For a project: whether it already has a rule of its own. */
  initialOwn: boolean;
  allRule: SASDateRule;
  canEdit: boolean;
}) {
  const { user } = useAuth();
  const { log } = useActivityLogger(MODULE);
  const { toast } = useToast();
  const [draft, setDraft] = useState<SASDateRule>(initialRule);
  const [own, setOwn] = useState(initialOwn);
  const [saving, setSaving] = useState(false);
  /** Why the rule is changing — optional, kept with the change in History. */
  const [reason, setReason] = useState('');

  // The all-projects scope always edits its rule; a project edits one only when it has its own.
  const editing = !scopeProject || own;

  function set<K extends keyof SASDateRule>(key: K, value: SASDateRule[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!canEdit) return;
    setSaving(true);
    const stamp = { updatedAt: serverTimestamp(), updatedBy: user?.id ?? '', updatedByName: user?.name ?? '' };
    try {
      const ref = doc(db, SAS_COLLECTIONS.settings, SAS_DATE_CONTROL_DOC_ID);
      if (!scopeProject) {
        await setDoc(ref, { ...ruleOnly(draft), ...stamp }, { merge: true });
      } else {
        await setDoc(ref, {
          projects: { [scopeProject]: own ? ruleOnly(draft) : deleteField() },
          ...stamp,
        }, { merge: true });
      }
      // Awaited, so the History card refreshes with this entry in it. A failed log never fails the save.
      await log('Edit SAS Date Control', {
        scope: scopeProject ? scopeName : 'All projects',
        ...(editing
          ? {
              enabled: draft.enabled, backdateDays: draft.backdateDays, futureDays: draft.futureDays,
              applyToExpenses: draft.applyToExpenses, applyToPayments: draft.applyToPayments,
            }
          : { follows: 'All projects' }),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }).catch(() => {});
      setReason('');
      onSaved();
      toast({
        title: 'Saved',
        description: scopeProject
          ? own ? `${scopeName} now has its own date rule.` : `${scopeName} now follows the all-projects rule.`
          : 'Date control updated. It applies to new entries immediately.',
      });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  // Preview the window exactly as a user would see it, so an administrator can read the
  // consequence of the number they just typed instead of working it out.
  const today = todayLocal();
  const preview = resolveDateWindow({ settings: editing ? draft : allRule, kind: 'expense', today });
  const actions = canEdit && (
    <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
      <Input
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason for this change (optional)"
        aria-label="Reason for this change"
        maxLength={300}
        className="h-9 sm:mr-auto sm:max-w-md"
      />
      <div className="flex flex-wrap justify-end gap-2">
      {editing && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setDraft(scopeProject ? allRule : DEFAULT_DATE_CONTROL)}
          disabled={saving}
        >
          <RotateCcw className="h-4 w-4" /> {scopeProject ? 'Copy all-projects rule' : 'Reset'}
        </Button>
      )}
      <Button size="sm" className="gap-2 bg-emerald-700 hover:bg-emerald-800" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save{scopeProject ? ` for ${scopeName}` : ''}
      </Button>
      </div>
    </div>
  );

  return (
    <Card>
      {scopeProject && (
        <CardHeader className="border-b pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">{scopeName}</CardTitle>
              <CardDescription className="mt-1">
                {own
                  ? 'Has its own rule, below. The all-projects rule does not apply to it.'
                  : <>Follows the all-projects rule: <strong>{describeRule(allRule)}</strong>.</>}
              </CardDescription>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <span className="text-muted-foreground">Own rule</span>
              <Switch
                checked={own}
                onCheckedChange={v => { setOwn(v); if (v && !initialOwn) setDraft(allRule); }}
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
                {scopeProject
                  ? 'Off means this project accepts any date, whatever the all-projects rule says.'
                  : 'Off by default. While off, any date can be entered — exactly as before this setting existed.'}
              </CardDescription>
            </div>
            <Switch checked={draft.enabled} onCheckedChange={v => set('enabled', v)} disabled={!canEdit} />
          </div>
        </CardHeader>
      )}

      <CardContent className={editing && draft.enabled ? 'space-y-6 border-t pt-5' : 'space-y-4 pt-4'}>
        {editing && draft.enabled && (
          <>
            {/* Back-dating window */}
            <div className="space-y-2.5">
              <Label className="text-sm font-medium">Allow back-dating up to</Label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map(preset => (
                  <Button
                    key={preset.days}
                    type="button"
                    size="sm"
                    variant={draft.backdateDays === preset.days ? 'default' : 'outline'}
                    className={draft.backdateDays === preset.days ? 'bg-emerald-700 hover:bg-emerald-800' : ''}
                    onClick={() => set('backdateDays', preset.days)}
                    disabled={!canEdit}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Input
                  type="number"
                  min={0}
                  max={MAX_BACKDATE_DAYS}
                  step={1}
                  value={draft.backdateDays}
                  // `min`/`max` are hints the browser applies loosely — 1.5, -3 and 99999 all reach
                  // here — so the value is made whole and bounded before it can be saved.
                  onChange={e => set('backdateDays', clampDays(e.target.value, MAX_BACKDATE_DAYS))}
                  disabled={!canEdit}
                  className="h-9 w-28"
                />
                <span className="text-sm text-muted-foreground">days before today</span>
              </div>
            </div>

            {/* Forward window */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Allow future dating up to</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={MAX_FUTURE_DAYS}
                  step={1}
                  value={draft.futureDays}
                  onChange={e => set('futureDays', clampDays(e.target.value, MAX_FUTURE_DAYS))}
                  disabled={!canEdit}
                  className="h-9 w-28"
                />
                <span className="text-sm text-muted-foreground">days after today</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave at 0 so money cannot be recorded as spent before it has been.
              </p>
            </div>

            {/* Record types */}
            <div className="space-y-2.5">
              <Label className="text-sm font-medium">Apply to</Label>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5">
                <Switch
                  checked={draft.applyToExpenses}
                  onCheckedChange={v => set('applyToExpenses', v)}
                  disabled={!canEdit}
                />
                <span className="text-sm">
                  Site Expenses
                  <span className="text-muted-foreground"> — including the dashboard quick-add and Excel import</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5">
                <Switch
                  checked={draft.applyToPayments}
                  onCheckedChange={v => set('applyToPayments', v)}
                  disabled={!canEdit}
                />
                <span className="text-sm">
                  Payments Received
                  <span className="text-muted-foreground"> — including Excel import</span>
                </span>
              </label>
            </div>
          </>
        )}

        {/* Live preview */}
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {scopeProject ? `What users on ${scopeName} see today` : 'What every user sees today'}
          </p>
          <p className="mt-1 text-sm text-emerald-900">
            {preview.enforced
              ? <>Dates from <strong>{preview.min}</strong> to <strong>{preview.max}</strong> ({today} is today).</>
              : <>No restriction — every date is accepted.</>}
          </p>
        </div>

        {/* Nobody is exempt — said plainly, since an earlier version did exempt some roles. */}
        {editing && draft.enabled && (
          <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-slate-700">No permission overrides this</p>
              <p>
                The window applies to every user, administrators included, on every form that
                records an expense or receipt — the full form, the dashboard quick-add and Excel
                import. To allow an older entry, widen the window here; to correct a month that
                has already been reported, reopen it in Month Closure.
              </p>
            </div>
          </div>
        )}

        {actions}
      </CardContent>
    </Card>
  );
}
