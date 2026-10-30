'use client';

/**
 * Settings › Login Expiry — how long you may stay idle before SEL Live signs you out. It is your own
 * setting (`users/{id}.theme.sessionDuration`), capped by the company's session policy, and it
 * applies from your next sign-in.
 */

import { useEffect, useState } from 'react';
import { Clock, Loader2, LogIn, RotateCcw, Save } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/shared/page-header';
import { SettingsAccessDenied, SettingsNotice, SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { fetchSessionPolicy } from '@/lib/session-manager';
import { cn } from '@/lib/utils';

const MIN_MINUTES = 5;
const MAX_MINUTES = 1440;
const DEFAULT_MINUTES = 60;
const PRESETS = [30, 60, 120, 240, 480];

const asText = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
};

export default function LoginExpiryPage() {
  const back = useBackNavigation('/settings');
  const { toast } = useToast();
  const { user, refreshUserData } = useAuth();
  const { can } = useAuthorization();
  const canView = can('View', 'Settings.Login Expiry');
  const canEdit = can('Edit', 'Settings.Login Expiry');

  const stored = user?.theme?.sessionDuration || DEFAULT_MINUTES;
  // Text, so the field can be cleared while typing; the number is read from it.
  const [value, setValue] = useState(String(stored));
  const [saving, setSaving] = useState(false);
  const [cap, setCap] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetchSessionPolicy()
      .then((result) => {
        if (live) setCap(result.policy.idleTimeoutCapMinutes > 0 ? result.policy.idleTimeoutCapMinutes : null);
      })
      .catch((error) => console.warn('[login-expiry] session policy not loaded', error));
    return () => {
      live = false;
    };
  }, []);

  if (!canView) return <SettingsAccessDenied title="Login Expiry" icon={LogIn} />;

  const minutes = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES;
  const dirty = valid && minutes !== stored;
  const applied = valid && cap !== null ? Math.min(minutes, cap) : null;

  const save = async () => {
    if (!user || !canEdit || !valid) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.id), { 'theme.sessionDuration': minutes });
      await refreshUserData();
      toast({ title: 'Login expiry saved', description: `You will be signed out after ${asText(minutes)} idle, from your next sign-in.` });
    } catch {
      toast({ title: 'Not saved', description: 'Check your connection and try again.', variant: 'destructive' });
    }
    setSaving(false);
  };

  return (
    <SettingsPage>
      <PageHeader
        title="Login Expiry"
        description="How long you can stay idle before SEL Live signs you out."
        icon={LogIn}
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start">
        <SettingsSection
          title="Idle sign-out"
          icon={Clock}
          description="Counted from your last click or key press, on every device you are signed in on."
          footer={
            canEdit ? (
              <>
                {value !== String(stored) && (
                  <Button variant="ghost" onClick={() => setValue(String(stored))} disabled={saving}>
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                    Undo
                  </Button>
                )}
                <Button onClick={() => void save()} disabled={saving || !dirty}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Save
                </Button>
              </>
            ) : undefined
          }
        >
          <div role="radiogroup" aria-label="Quick choices" className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => {
              const selected = valid && minutes === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!canEdit}
                  onClick={() => setValue(String(preset))}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/40 hover:bg-primary/5',
                  )}
                >
                  {asText(preset)}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="session-duration">Or any number of minutes</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                id="session-duration"
                type="number"
                inputMode="numeric"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={1}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={!canEdit}
                aria-invalid={!valid}
                aria-describedby="session-duration-hint"
                className="w-28 text-center text-base font-semibold tabular-nums"
              />
              <span className="text-sm text-muted-foreground">minutes{valid ? ` · ${asText(minutes)}` : ''}</span>
            </div>
            <p id="session-duration-hint" className={cn('text-xs', valid ? 'text-muted-foreground' : 'font-medium text-danger')}>
              {valid ? `Between ${MIN_MINUTES} minutes and 24 hours.` : `Enter a whole number from ${MIN_MINUTES} to ${MAX_MINUTES}.`}
            </p>
          </div>

          {!canEdit && <SettingsNotice>Your role can see this setting but not change it (Login Expiry › Edit).</SettingsNotice>}
        </SettingsSection>

        <div className="min-w-0 space-y-3">
          <SettingsNotice title="Applies from your next sign-in">
            Your current session keeps the timeout it started with. Signing out and back in picks up a change straight away.
          </SettingsNotice>
          {cap !== null && (
            <SettingsNotice tone="warning" title={`The company caps idle time at ${asText(cap)}`}>
              {applied !== null && applied < minutes
                ? `So you will be signed out after ${asText(applied)}, not ${asText(minutes)}.`
                : 'A longer setting here is cut down to that.'}
            </SettingsNotice>
          )}
        </div>
      </div>
    </SettingsPage>
  );
}
