'use client';

/**
 * Settings › Fleet › Approvals & notifications: how long an over-limit request waits at each level,
 * who it reaches last, who hears about exceptions and the morning digest, and where the monthly
 * payment report is emailed.
 *
 * The chain itself is per vehicle — its approver, else the driver's reporting authority, then its
 * backup approver (the Vehicles tab) — and ends with the escalation people set here. Spelled out on
 * the page, because "escalation" alone does not say who gets the 7 a.m. phone call.
 */

import { useState, type KeyboardEvent } from 'react';
import { BellRing, GitBranch, Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { Field, PeoplePicker } from '@/components/driver-management/trips/trip-ui';
import { fleetErrorMessage } from '@/components/fleet/fleet-api';
import { useToast } from '@/hooks/use-toast';
import type { FleetSettings } from '@/lib/fleet/types';
import { fieldErrorsOf, type FleetDirectoryUser } from './fleet-masters';
import { saveFleetSettings } from './settings-save';

interface Draft {
  approvalEscalateMinutes?: string;
  approvalExpiryMinutes?: string;
  escalationUserIds?: string[];
  digestUserIds?: string[];
  reportEmails?: string[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function NotificationSettings({ settings, users, canEdit, onSaved }: { settings: FleetSettings; users: FleetDirectoryUser[]; canEdit: boolean; onSaved: (settings: FleetSettings) => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailText, setEmailText] = useState('');
  const [saving, setSaving] = useState(false);

  const escalate = draft.approvalEscalateMinutes ?? String(settings.approvalEscalateMinutes);
  const expiry = draft.approvalExpiryMinutes ?? String(settings.approvalExpiryMinutes);
  const escalationUserIds = draft.escalationUserIds ?? settings.escalationUserIds;
  const digestUserIds = draft.digestUserIds ?? settings.digestUserIds;
  const reportEmails = draft.reportEmails ?? settings.reportEmails;
  const dirty = Object.keys(draft).length > 0;
  const disabled = !canEdit || saving;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const addEmails = () => {
    const typed = emailText.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean);
    if (!typed.length) return;
    const bad = typed.filter((entry) => !EMAIL.test(entry));
    if (bad.length) {
      setErrors((current) => ({ ...current, reportEmails: `Not an email address: ${bad.join(', ')}` }));
      return;
    }
    set('reportEmails', [...new Set([...reportEmails, ...typed.map((entry) => entry.toLowerCase())])].slice(0, 30));
    setEmailText('');
  };

  const onEmailKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addEmails();
    }
  };

  async function save() {
    const minutes = (value: string, min: number, max: number) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
    };
    const escalateMinutes = minutes(escalate, 5, 1440);
    const expiryMinutes = minutes(expiry, 10, 1440);
    const invalid: Record<string, string> = {};
    if (escalateMinutes === null) invalid.approvalEscalateMinutes = 'Whole minutes from 5 to 1,440.';
    if (expiryMinutes === null) invalid.approvalExpiryMinutes = 'Whole minutes from 10 to 1,440.';
    if (escalateMinutes !== null && expiryMinutes !== null && expiryMinutes <= escalateMinutes) invalid.approvalExpiryMinutes = 'A request must expire after it first moves up.';
    if (emailText.trim()) invalid.reportEmails = 'Press Add (or Enter) to add the address you typed, or clear it.';
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      return;
    }
    setSaving(true);
    try {
      const next = await saveFleetSettings(settings, {
        approvalEscalateMinutes: escalateMinutes as number,
        approvalExpiryMinutes: expiryMinutes as number,
        escalationUserIds,
        digestUserIds,
        reportEmails,
      });
      onSaved(next);
      setDraft({});
      setErrors({});
      toast({ title: 'Approvals and notifications saved' });
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      toast({ variant: 'destructive', title: 'Not saved', description: fleetErrorMessage(failure, 'The settings could not be saved.') });
    } finally {
      setSaving(false);
    }
  }

  const escalateNumber = Number(escalate) || settings.approvalEscalateMinutes;
  const expiryNumber = Number(expiry) || settings.approvalExpiryMinutes;

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && (
            <Button type="button" variant="outline" disabled={saving} onClick={() => { setDraft({}); setErrors({}); setEmailText(''); }}>
              Discard changes
            </Button>
          )}
          <Button type="button" className={VM_PRIMARY_BUTTON} disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4 text-slate-500" aria-hidden />
              Over-limit approvals
            </CardTitle>
            <CardDescription className="text-xs">A driver asks before a trip that would take the vehicle past its daily limit. The request goes up a level each time it waits too long.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-2 text-xs text-slate-700">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold">1</span>
                <span>The vehicle&apos;s approver — or, when it has none, the driver&apos;s reporting authority (Access Management, then greytHR).</span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold">2</span>
                <span>After {escalateNumber} min: the vehicle&apos;s backup approver, if it has one.</span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold">3</span>
                <span>After another {escalateNumber} min: the escalation people below.</span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[11px] font-semibold text-rose-700">×</span>
                <span>{expiryNumber} min after it was raised, an undecided request expires; the driver can ask again or use an emergency start.</span>
              </li>
            </ol>
            <p className="text-[11px] text-muted-foreground">Everyone it has reached can still decide. Nobody decides their own request.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Move up a level after" required error={errors.approvalEscalateMinutes} htmlFor="fleet-escalate" hint="Minutes">
                <Input id="fleet-escalate" type="number" inputMode="numeric" step="1" value={escalate} onChange={(event) => set('approvalEscalateMinutes', event.target.value)} disabled={disabled} className="bg-white" />
              </Field>
              <Field label="Expire after" required error={errors.approvalExpiryMinutes} htmlFor="fleet-expiry" hint="Minutes from the request">
                <Input id="fleet-expiry" type="number" inputMode="numeric" step="1" value={expiry} onChange={(event) => set('approvalExpiryMinutes', event.target.value)} disabled={disabled} className="bg-white" />
              </Field>
            </div>
            <Field label="Escalation people (level 3)" error={errors.escalationUserIds} hint="Usually the fleet in-charge. They also see every vehicle's trips and can settle any of them.">
              <PeoplePicker users={users} value={escalationUserIds} onChange={(next) => set('escalationUserIds', next)} disabled={disabled} placeholder="Add people…" />
            </Field>
            {!escalationUserIds.length && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                With nobody here, a request on a vehicle with no approver, no backup and a driver with no reporting authority cannot be raised at all — the driver is told to use an emergency start.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BellRing className="h-4 w-4 text-slate-500" aria-hidden />
                Exceptions and the morning digest
              </CardTitle>
              <CardDescription className="text-xs">Flagged fuel entries are sent to the vehicle&apos;s approver and to these people; the 8 a.m. digest summarises yesterday — requests, trips to review, flags, vehicles over their limit, services due.</CardDescription>
            </CardHeader>
            <CardContent>
              <Field label="Digest and exception people" error={errors.digestUserIds}>
                <PeoplePicker users={users} value={digestUserIds} onChange={(next) => set('digestUserIds', next)} disabled={disabled} placeholder="Add people…" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-slate-500" aria-hidden />
                Monthly payment report
              </CardTitle>
              <CardDescription className="text-xs">On the 1st at 06:00 last month&apos;s report is generated and emailed here as Excel and PDF, as a draft to approve for payment.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Field label="Email to" error={errors.reportEmails} hint="Addresses outside the company are fine — accounts, the auditor.">
                <div className="flex gap-2">
                  <Input type="email" inputMode="email" value={emailText} onChange={(event) => { setEmailText(event.target.value); setErrors((current) => ({ ...current, reportEmails: '' })); }} onKeyDown={onEmailKey} placeholder="accounts@example.com" disabled={disabled} className="min-w-0 flex-1 bg-white" aria-label="Email address to add" />
                  <Button type="button" variant="outline" onClick={addEmails} disabled={disabled || !emailText.trim()}>
                    Add
                  </Button>
                </div>
              </Field>
              {reportEmails.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {reportEmails.map((email) => (
                    <span key={email} className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
                      <span className="truncate">{email}</span>
                      {!disabled && (
                        <button type="button" onClick={() => set('reportEmails', reportEmails.filter((entry) => entry !== email))} className="-my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-slate-200" aria-label={`Remove ${email}`}>
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Nobody yet — the report is still generated and can be downloaded from Payment Reports.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
