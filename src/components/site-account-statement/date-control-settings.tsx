'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { CalendarClock, Loader2, RotateCcw, Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { SAS_COLLECTIONS, SAS_DATE_CONTROL_DOC_ID } from '@/lib/site-account-statement';
import {
  DEFAULT_DATE_CONTROL,
  MAX_BACKDATE_DAYS,
  MAX_FUTURE_DAYS,
  clampDays,
  resolveDateControl,
  resolveDateWindow,
  todayLocal,
  type SASDateControlSettings,
} from '@/lib/site-account-statement-date-policy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const MODULE = 'Site Account Statement';

/** Common windows, so the usual choice is one click rather than a number to think about. */
const PRESETS = [
  { days: 0,  label: 'Today only' },
  { days: 3,  label: '3 days' },
  { days: 7,  label: '1 week' },
  { days: 15, label: '15 days' },
  { days: 30, label: '1 month' },
  { days: 90, label: '1 quarter' },
];

export default function SiteAccountDateControlSettings() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(MODULE);
  const { toast } = useToast();

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

  const [draft, setDraft] = useState<SASDateControlSettings>(DEFAULT_DATE_CONTROL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        doc(db, SAS_COLLECTIONS.settings, SAS_DATE_CONTROL_DOC_ID),
        (snapshot) => {
          setDraft(resolveDateControl(snapshot.data() as Partial<SASDateControlSettings> | undefined));
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [],
  );

  function set<K extends keyof SASDateControlSettings>(key: K, value: SASDateControlSettings[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!canEdit) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, SAS_COLLECTIONS.settings, SAS_DATE_CONTROL_DOC_ID),
        {
          enabled: draft.enabled,
          // Bounded again here: the draft is also set by Reset and the presets, not only by the
          // inputs that already clamp, and the saved value is what every form reads.
          backdateDays: clampDays(draft.backdateDays, MAX_BACKDATE_DAYS),
          futureDays: clampDays(draft.futureDays, MAX_FUTURE_DAYS),
          applyToExpenses: draft.applyToExpenses,
          applyToPayments: draft.applyToPayments,
          updatedAt: serverTimestamp(),
          updatedBy: user?.id ?? '',
          updatedByName: user?.name ?? '',
        },
        { merge: true },
      );
      void log('Edit SAS Date Control', {
        enabled: draft.enabled,
        backdateDays: draft.backdateDays,
        futureDays: draft.futureDays,
      });
      toast({ title: 'Saved', description: 'Date control updated. It applies to new entries immediately.' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
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
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldAlert className="h-12 w-12 text-destructive" />
          <p className="font-semibold text-slate-800">Access Denied</p>
          <p className="text-sm text-muted-foreground">You don&apos;t have permission to configure date control.</p>
        </CardContent>
      </Card>
    );
  }

  // Preview the window exactly as a restricted user would see it, so an administrator can read the
  // consequence of the number they just typed instead of working it out.
  const today = todayLocal();
  const preview = resolveDateWindow({ settings: draft, kind: 'expense', today });

  return (
    <div className="space-y-4">
      <PageHeader
        backHref="/site-account-statement/settings"
        backLabel="Back to settings"
        title="Date Control"
        description="How far back an expense or receipt may be dated."
        actions={canEdit ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setDraft(DEFAULT_DATE_CONTROL)}
              disabled={saving}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button size="sm" className="gap-2 bg-emerald-700 hover:bg-emerald-800" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </>
        ) : undefined}
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-emerald-600" />
                Restrict entry dates
              </CardTitle>
              <CardDescription className="mt-1">
                Off by default. While off, any date can be entered — exactly as before this setting existed.
              </CardDescription>
            </div>
            <Switch checked={draft.enabled} onCheckedChange={v => set('enabled', v)} disabled={!canEdit} />
          </div>
        </CardHeader>

        {draft.enabled && (
          <CardContent className="space-y-6 border-t pt-5">

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

            {/* Scope */}
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

            {/* Live preview */}
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                What every user sees today
              </p>
              <p className="mt-1 text-sm text-emerald-900">
                {preview.enforced
                  ? <>Dates from <strong>{preview.min}</strong> to <strong>{preview.max}</strong> ({today} is today).</>
                  : <>No restriction — every date is accepted.</>}
              </p>
            </div>

            {/* Nobody is exempt — said plainly, since an earlier version did exempt some roles. */}
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
          </CardContent>
        )}
      </Card>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          You can view this configuration but not change it. Ask an administrator for the Date Control · Edit permission.
        </p>
      )}
    </div>
  );
}
