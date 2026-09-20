'use client';

import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { HrLoader, HrPageHeader } from '@/components/hr/hr-ui';
import { hasPermission } from '@/lib/access-control';
import { DEFAULT_MONITORING_DISCLOSURE, WINDOWS_AGENT_RESOURCES } from '@/lib/windows-agent';
import { fetchSettings, saveSettings } from '@/lib/windows-agent-service';
import { useWindowsAgent, useWindowsAgentAction, useWindowsAgentQuery } from './hooks';

/**
 * §52's monitoring policy — the page an employee can always open.
 *
 * ── The lists are code, not content ────────────────────────────────────────────────────────────
 *
 * An administrator can write the covering statement. They cannot edit the "collected" and "never
 * collected" lists, and that is the point of the page rather than a limitation of it. Those lists
 * come from `DEFAULT_MONITORING_DISCLOSURE`, which the agent's own status window also renders and
 * which the ingest route enforces — so the page cannot come to disagree with what the software
 * does. A monitoring disclosure that an administrator can freely rewrite is a marketing document,
 * and an employee reading one has no reason to believe it.
 *
 * If the agent ever started capturing something new, that constant would have to change in the
 * same commit, and this page would say so the moment it deployed.
 *
 * ── Why it is ungated ──────────────────────────────────────────────────────────────────────────
 *
 * Every other page in the module needs a permission. This one needs none: the people with the
 * strongest claim to read it are precisely the ones with no administrative access. Gating it
 * would mean the only people who could see what was being collected were the people doing the
 * collecting.
 */
export function MonitoringPolicyPage() {
  const { viewer, actor, loading } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();

  const canEdit = hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.monitoringPolicy, 'Edit');
  const settings = useWindowsAgentQuery('Loading the monitoring policy', fetchSettings, [], {
    enabled: !loading,
  });

  const [statement, setStatement] = useState('');
  const [selfView, setSelfView] = useState(true);

  useEffect(() => {
    if (!settings.data) return;
    setStatement(settings.data.monitoringPolicyText ?? '');
    setSelfView(settings.data.employeeSelfViewEnabled);
  }, [settings.data]);

  if (loading || settings.loading) return <HrLoader label="Loading the monitoring policy" />;

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="What this computer records"
        description="The SEL LIVE agent runs on company computers. This is everything it collects, and everything it does not."
      />

      {statement ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Company statement</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{statement}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 text-slate-600" aria-hidden />
              Recorded
            </CardTitle>
            <CardDescription>While you are signed in on a company computer.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {DEFAULT_MONITORING_DISCLOSURE.collected.map((line) => (
                <li key={line} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-emerald-800">
              <EyeOff className="h-4 w-4" aria-hidden />
              Never recorded
            </CardTitle>
            <CardDescription>
              Not a promise about configuration — the agent contains no code to do any of these.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {DEFAULT_MONITORING_DISCLOSURE.neverCollected.map((line) => (
                <li key={line} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1 w-3 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-amber-600" aria-hidden />
            Optional, and off unless your organisation turns them on
          </CardTitle>
          <CardDescription>
            Open <strong>Agent status</strong> from the SEL LIVE icon in your system tray to see
            whether either of these is switched on for your computer specifically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {DEFAULT_MONITORING_DISCLOSURE.optional.map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1 w-3 shrink-0 rounded-full bg-amber-400" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base">How long it is kept</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>
            The detailed timeline — which program, at which minute — is deleted automatically after
            the retention period your organisation has set, which defaults to 90 days.
          </p>
          <p>
            Daily totals and attendance are kept longer, because they are what the attendance
            record is built from.
          </p>
          <p>
            The administrative audit trail is permanent, and records what administrators did — not
            what employees did.
          </p>
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Administration</CardTitle>
            <CardDescription>
              You can add a covering statement and decide whether employees may open their own
              activity page. The two lists above are not editable — they describe what the
              software does, and a policy page that could disagree with the software would be
              worse than none.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wa-statement">Company statement</Label>
              <Textarea
                id="wa-statement"
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
                rows={5}
                placeholder="Why this agent is installed, who to contact with questions, and which company policy governs it."
              />
            </div>

            <label className="flex items-start justify-between gap-4 rounded-md border p-3">
              <span className="text-sm">
                <span className="block font-medium">Let employees see their own activity</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  On by default. With this off, an employee can read this page but cannot see what
                  was actually recorded about them — which is a decision worth taking deliberately.
                </span>
              </span>
              <Switch checked={selfView} onCheckedChange={setSelfView} />
            </label>

            <Button
              disabled={pending}
              onClick={async () => {
                await run('Monitoring policy saved', () =>
                  saveSettings(actor, {
                    employeeSelfViewEnabled: selfView,
                    monitoringPolicyText: statement.trim() || null,
                    minimumFullDaySeconds: settings.data?.minimumFullDaySeconds ?? 8 * 3600,
                  }),
                );
                settings.refresh();
              }}
            >
              Save
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
