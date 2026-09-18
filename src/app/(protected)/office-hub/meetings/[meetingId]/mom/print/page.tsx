'use client';

/**
 * The printable minutes (§45's "allow export/print").
 *
 * A route of its own rather than a print stylesheet on the minutes page, for two reasons:
 *
 *   • `AppShell` strips the application header for any path containing `/print`, and the Office Hub
 *     layout does the same for its own sidebar — so this page renders the minutes and nothing else,
 *     on screen and on paper.
 *   • Print-hiding the chrome instead would not have worked: the module's mobile bar is `lg:hidden`,
 *     and print lays out at paper width (~816px), which is *below* `lg`. The bar nobody sees on a
 *     desktop screen would un-hide itself in the printout.
 *
 * `window.print()` fires once the document is assembled, so opening this route from the minutes page
 * goes straight to the print dialog.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  buildMomDocument,
  canViewMeeting,
} from '@/lib/office-hub';
import {
  getMeeting,
  getMeetingNotes,
  getMom,
  listActionItems,
  listAgenda,
  listDecisions,
  listMeetingParticipants,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import { MomView } from '@/components/office-hub/mom-view';

export default function MomPrintPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params?.meetingId ?? '';
  const { viewer, capabilities, settings, isLoading } = useOfficeHub();
  const printed = useRef(false);

  const query = useOfficeHubQuery(
    async () => {
      const meeting = await getMeeting(meetingId);
      if (!meeting) return null;
      const [participants, agenda, decisions, actionItems, notes, mom] = await Promise.all([
        listMeetingParticipants(meetingId),
        listAgenda(meetingId),
        listDecisions({ meetingId }),
        listActionItems({ meetingId }),
        getMeetingNotes(meetingId),
        getMom(meetingId),
      ]);
      return { meeting, participants, agenda, decisions, actionItems, notes, mom };
    },
    [meetingId],
    { enabled: Boolean(meetingId) },
  );

  const data = query.data;

  const document = useMemo(() => {
    if (!data?.meeting) return null;
    return buildMomDocument({
      meeting: data.meeting,
      participants: data.participants,
      agenda: data.agenda,
      decisions: data.decisions,
      actionItems: data.actionItems,
      notesPlainText: data.notes?.plainText ?? null,
      mom: data.mom
        ? {
            reference: data.mom.reference,
            stage: data.mom.stage,
            discussionHtml: data.mom.discussionHtml ?? data.notes?.html ?? null,
            nextMeetingDate: data.mom.nextMeetingDate,
            nextMeetingTime: data.mom.nextMeetingTime,
            nextMeetingNote: data.mom.nextMeetingNote,
            preparedByName: data.mom.preparedByName,
            approvedByName: data.mom.approvedByName,
          }
        : { stage: 'Draft', discussionHtml: data.notes?.html ?? null },
    });
  }, [data]);

  /**
   * Open the print dialog once, when there is something to print.
   *
   * Guarded by a ref rather than by the effect's dependencies: a re-render caused by the settings
   * listener arriving would otherwise re-open the dialog behind the one already open.
   */
  useEffect(() => {
    if (printed.current || !document || isLoading) return;
    printed.current = true;
    // A frame's delay so the browser has laid the document out before it is serialised; printing
    // mid-layout produces a blank first page in Chrome.
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [document, isLoading]);

  if (isLoading || query.isLoading) {
    return <p className="p-8 text-sm text-slate-500">Preparing the minutes…</p>;
  }

  if (!data?.meeting || !document) {
    return <p className="p-8 text-sm text-slate-500">That meeting could not be found.</p>;
  }

  if (!canViewMeeting(data.meeting, viewer, capabilities)) {
    return <p className="p-8 text-sm text-slate-500">You do not have permission to view these minutes.</p>;
  }

  return <MomView document={document} organizationName={settings.organizationName} />;
}
