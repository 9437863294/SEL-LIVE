'use client';

/**
 * The Google Meet connection card (§63).
 *
 * Two audiences in one component, because they need the same facts:
 *
 *   • **Anybody who schedules meetings** connects their own Google account here. The connection is
 *     personal — it creates events on *their* calendar and is revocable by them alone — so it sits
 *     in "My preferences" rather than under the module's administration.
 *   • **An administrator** additionally sees what the server has and has not been given, so a
 *     "Connect" button that cannot work is explained rather than merely broken.
 *
 * ── The one thing this screen has to be honest about ───────────────────────────────────────────
 *
 * Creating a Meet also creates a Google Calendar event with the participants as attendees, and
 * Google will collect its own RSVPs on it that Office Hub does not read. That is a real
 * consequence of the integration and it is stated in plain words here rather than left for
 * somebody to discover when the two systems disagree about who is coming.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldAlert, Unplug, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  GOOGLE_CALLBACK_PARAMS,
  readGoogleCallbackOutcome,
} from '@/lib/office-hub-google-client';
import { useGoogleMeetStatus } from './hooks';
import { OfficeHubSection } from './ui';

export function GoogleMeetPanel({ showAdministratorDetail }: { showAdministratorDetail?: boolean }) {
  const { status, isLoading, reload, connect, disconnect, isBusy } = useGoogleMeetStatus();
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  /**
   * Read the result the OAuth callback left in the URL, then take it out of the URL.
   *
   * The parameters are stripped with `replaceState` rather than a router navigation: this runs
   * during the render that follows the redirect, and a navigation here would fight the one that
   * just happened. Leaving them would re-announce a connection on every refresh, and would put a
   * stale message back on screen after the user disconnected.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const found = readGoogleCallbackOutcome(window.location.search);
    if (!found) return;

    setOutcome(found);

    const url = new URL(window.location.href);
    for (const param of GOOGLE_CALLBACK_PARAMS) url.searchParams.delete(param);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

    // The callback wrote the connection a moment ago, so the status read on mount may predate it.
    reload();
  }, [reload]);

  const connectedSince = useMemo(() => {
    if (!status.connection.connectedAt) return null;
    const date = new Date(status.connection.connectedAt);
    return Number.isNaN(date.getTime())
      ? null
      : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }, [status.connection.connectedAt]);

  return (
    <OfficeHubSection
      title="Google Meet"
      description="Office Hub creates the Meet link and the Google Calendar entry for the meetings you organise."
    >
      <div className="space-y-3">
        {outcome && (
          <div
            role="status"
            className={
              outcome.tone === 'success'
                ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900'
                : 'rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive'
            }
          >
            {outcome.message}
          </div>
        )}

        {isLoading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Checking the Google connection…
          </p>
        ) : !status.configured ? (
          /*
            Not an error the user can fix. Phrased as "an administrator needs to", and the missing
            variables are shown only to somebody who could act on them — see the prop.
          */
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              Google Meet is not set up on this server
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
              Until it is, an online meeting asks for a joining link to paste instead. An
              administrator needs to register a Google OAuth client and set its details in the
              environment.
            </p>
            {showAdministratorDetail && status.configurationProblems.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-amber-200 pt-2">
                {status.configurationProblems.map((problem) => (
                  <li key={problem} className="text-[11px] font-mono leading-relaxed text-amber-900">
                    {problem}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-amber-800">
              The full setup is in <span className="font-medium">docs/office-hub.md</span>, section
              “Google Meet”.
            </p>
          </div>
        ) : status.connection.connected ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-900">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Connected
                  {status.connection.googleEmail && (
                    <span className="truncate font-normal">as {status.connection.googleEmail}</span>
                  )}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-emerald-800">
                  Meetings you organise get a Meet link automatically, and appear on participants’
                  Google Calendars.
                  {connectedSince ? ` Connected on ${connectedSince}.` : ''}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 bg-white text-xs"
                onClick={() => void disconnect()}
                disabled={isBusy}
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Unplug className="h-3.5 w-3.5" aria-hidden />
                )}
                Disconnect
              </Button>
            </div>

            {/*
              Said here, once, rather than on every meeting: Google keeps its own RSVP state and
              Office Hub ignores it. Somebody who answers only in Google Calendar shows as not
              having answered on the attendance sheet, and this is the place that explains why.
            */}
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium">What this changes for participants</p>
              <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                <li>• The meeting appears on their Google Calendar with a Join button.</li>
                <li>
                  •{' '}
                  {status.settings.sendUpdates === 'none'
                    ? 'Google does not email them — Office Hub sends the only invitation.'
                    : 'Google emails them as well as Office Hub, so they get two invitations.'}
                </li>
                <li>
                  • Google shows its own Yes/No/Maybe buttons. <strong>Office Hub does not read
                  them</strong> — attendance and the response summary only count answers given in
                  Office Hub.
                </li>
                <li>• Participants with no email address on record get no calendar entry.</li>
              </ul>
            </div>
          </>
        ) : status.connection.health === 'reauth-required' ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
              Google stopped accepting the connection
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-destructive/90">
              {status.connection.reauthReason ??
                'This usually means access was revoked, a password changed, or the connection went unused for six months.'}
            </p>
            <Button type="button" size="sm" className="mt-2 gap-1.5 text-xs" onClick={() => void connect()} disabled={isBusy}>
              {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Video className="h-3.5 w-3.5" aria-hidden />}
              Reconnect Google
            </Button>
          </div>
        ) : (
          <div className="rounded-md border p-3">
            <p className="text-xs font-medium">Not connected</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Connect your Google account and Office Hub will create the Meet link for every online
              meeting you organise, and add it to participants’ Google Calendars. Until you do,
              those meetings ask you to paste a link.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Office Hub asks for permission to manage calendar events only. It cannot read your
              mail, your files or your contacts, and you can disconnect here at any time.
            </p>
            <Button type="button" size="sm" className="mt-2 gap-1.5 text-xs" onClick={() => void connect()} disabled={isBusy}>
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Video className="h-3.5 w-3.5" aria-hidden />
              )}
              Connect Google
            </Button>
          </div>
        )}

        {status.configured && status.connection.scopes.length > 0 && showAdministratorDetail && (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
            <span className="text-[11px] text-muted-foreground">Granted:</span>
            {status.connection.scopes.map((scope) => (
              <Badge key={scope} variant="secondary" className="font-mono text-[10px]">
                {scope.replace('https://www.googleapis.com/auth/', '')}
              </Badge>
            ))}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2"
            >
              Google account permissions
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        )}
      </div>
    </OfficeHubSection>
  );
}
