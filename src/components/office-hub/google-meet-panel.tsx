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
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldAlert, Unplug, Users, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { grantCoversMeetAccess } from '@/lib/office-hub-google';
import {
  GOOGLE_CALLBACK_PARAMS,
  readGoogleCallbackOutcome,
} from '@/lib/office-hub-google-client';
import { useGoogleMeetStatus } from './hooks';
import { OfficeHubSection } from './ui';

/**
 * The office Google account: one connected account that creates Meet links for everybody who has
 * not connected their own, so an office does not need every person to connect Google.
 *
 * Only your *own* account can be shared (the server takes no user id), and sharing needs Settings ›
 * Edit. The consequences are stated next to the button, because they are real: those events live
 * on that account's calendar, and that account is the Meet host who admits anyone asking to join.
 */
export function GoogleSharedAccountCard({ canEditSettings }: { canEditSettings: boolean }) {
  const { status, isLoading, setShared, connect, isBusy } = useGoogleMeetStatus();
  const shared = status.sharedAccount;

  if (!status.configured) return null;

  const busyIcon = <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />;

  return (
    <div className="rounded-lg border bg-white px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
        Office Google account (one account for everyone)
      </p>

      {isLoading ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Checking…</p>
      ) : shared ? (
        <>
          {shared.available ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Meet links for everyone who has not connected Google are created with{' '}
              <strong className="text-foreground">{shared.googleEmail ?? 'the shared account'}</strong>
              {shared.ownerName ? `, shared by ${shared.ownerName}` : ''}
              {shared.isMine ? ' (your account)' : ''}. Nobody else needs to connect.
            </p>
          ) : (
            <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                The shared account {shared.googleEmail ?? ''} needs reconnecting
                {shared.ownerName ? ` — ${shared.ownerName} should reconnect Google under My preferences` : ''}.
                Until then, people without their own connection are asked to paste a link.
              </span>
            </p>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Those meetings appear on that account’s Google Calendar and it is the Meet host, so it is
            the account that admits anyone who asks to join. An organizer who connects their own
            Google account uses theirs instead.
          </p>
          {(canEditSettings || shared.isMine) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 gap-1.5 bg-white text-xs"
              onClick={() => void setShared(false)}
              disabled={isBusy}
            >
              {isBusy ? busyIcon : <Unplug className="h-3.5 w-3.5" aria-hidden />}
              Stop sharing
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Not set. Every organizer has to connect their own Google account to get Meet links. Share
            one connected account here and nobody else needs to connect.
          </p>
          {canEditSettings &&
            (status.connection.connected ? (
              <Button
                type="button"
                size="sm"
                className="mt-2 gap-1.5 text-xs"
                onClick={() => void setShared(true)}
                disabled={isBusy}
              >
                {isBusy ? busyIcon : <Users className="h-3.5 w-3.5" aria-hidden />}
                Use my Google account{status.connection.googleEmail ? ` (${status.connection.googleEmail})` : ''} for everyone
              </Button>
            ) : (
              <div className="mt-2">
                <p className="text-[11px] text-muted-foreground">
                  Connect your own Google account first — that is the account that gets shared.
                </p>
                <Button type="button" size="sm" className="mt-1.5 gap-1.5 text-xs" onClick={() => void connect()} disabled={isBusy}>
                  {isBusy ? busyIcon : <Video className="h-3.5 w-3.5" aria-hidden />}
                  Connect Google
                </Button>
              </div>
            ))}
        </>
      )}
    </div>
  );
}

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
        ) : status.unavailable ? (
          /*
            The read itself failed. Says so, rather than asserting the server is unconfigured —
            the two need opposite responses, and guessing wrong sends an administrator to check
            environment variables that were never the problem.
          */
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              The Google connection could not be checked
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">{status.unavailable}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
              This is usually an expired session or a server fault, not a Google problem. Sign in
              again, or retry.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 gap-1.5 bg-white text-xs"
              onClick={() => reload()}
              disabled={isBusy}
            >
              <Loader2 className={isBusy ? 'h-3.5 w-3.5 animate-spin' : 'hidden'} aria-hidden />
              Try again
            </Button>
          </div>
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
              A connection made before Office Hub asked for Meet settings still creates links, so it
              is not "unhealthy" — but it cannot set who may join, and every online meeting would
              warn about it. One reconnect fixes that, so it is offered here, where the warning points.
            */}
            {!grantCoversMeetAccess(status.connection.scopes) && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Reconnect to control who can join
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                  Your connection was made before Office Hub could set Google Meet’s access, so “only
                  invited” and “anyone with the link” apply in Office Hub but not inside Meet.
                  Reconnect once and allow Office Hub to manage your Meet settings.
                </p>
                <Button type="button" size="sm" className="mt-2 gap-1.5 text-xs" onClick={() => void connect()} disabled={isBusy}>
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Video className="h-3.5 w-3.5" aria-hidden />}
                  Reconnect Google
                </Button>
              </div>
            )}

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
                  • Whether Google emails them is asked on each meeting (“Send email
                  invitations?”). Either way they are notified in SEL Live.
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
              Your Google connection cannot be used
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
            {status.sharedAccount?.available ? (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                <strong className="text-foreground">You do not need to connect.</strong> Meet links
                for your meetings are created with the office Google account
                {status.sharedAccount.googleEmail ? ` (${status.sharedAccount.googleEmail})` : ''}.
                Connect your own only if you want the events on your own Google Calendar instead.
              </p>
            ) : (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Connect your Google account and Office Hub will create the Meet link for every online
                meeting you organise, and add it to participants’ Google Calendars. Until you do,
                those meetings ask you to paste a link — unless an administrator shares one office
                Google account for everyone.
              </p>
            )}
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
