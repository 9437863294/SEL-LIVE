'use client';

/**
 * The rendered Minutes of Meeting (§45).
 *
 * Shared between the on-screen minutes and the print route, so the paper copy and the screen copy
 * cannot disagree about what the meeting decided. The document itself is assembled by
 * `buildMomDocument`, which reads the meeting's own records — the attendance sheet, the decision
 * register, the action items — rather than a separate minutes form. That is the whole argument for
 * recording those things during the meeting: the minutes become a rendering of the register, and a
 * rendering cannot contradict its source.
 *
 * The layout follows §45's template exactly, including the action-items table, because a minutes
 * format is something an organisation recognises and expects to be stable.
 */

import { forwardRef } from 'react';
import type { MomDocument } from '@/lib/office-hub';

export const MomView = forwardRef<HTMLDivElement, { document: MomDocument; organizationName?: string }>(
  function MomView({ document: mom, organizationName }, ref) {
    return (
      <div
        ref={ref}
        /*
          Explicit print styling rather than a Tailwind `prose` class: this element is what
          `react-to-print` and the browser's own Print both serialise, and a utility class whose
          stylesheet does not come with it produces an unstyled page. `print:` variants are used
          only for what must change on paper.
        */
        className="mx-auto max-w-[820px] bg-white p-6 text-slate-900 print:max-w-none print:p-0"
      >
        <header className="border-b-2 border-slate-800 pb-3 text-center">
          {organizationName && (
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{organizationName}</p>
          )}
          <h1 className="mt-1 text-lg font-bold uppercase tracking-[0.12em]">{mom.title}</h1>
          {mom.stage !== 'Published' && (
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-amber-700">
              {mom.stage} — not yet published
            </p>
          )}
        </header>

        <section className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="Meeting" value={mom.meetingTitle} />
          <Row label="Reference" value={mom.reference} />
          <Row label="Date" value={mom.date} />
          <Row label="Time" value={mom.time} />
          <Row label="Location" value={mom.location} />
          <Row label="Organizer" value={mom.organizer} />
          <Row label="Type" value={mom.meetingType} />
        </section>

        <Section title="Participants">
          {mom.participants.length === 0 ? (
            <p className="text-sm text-slate-500">No attendance was recorded.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <Th>Name</Th>
                  <Th>Department</Th>
                  <Th>Designation</Th>
                  <Th>Attendance</Th>
                </tr>
              </thead>
              <tbody>
                {mom.participants.map((participant, index) => (
                  <tr key={`${participant.name}-${index}`}>
                    <Td>{participant.name}</Td>
                    <Td>{participant.department}</Td>
                    <Td>{participant.designation}</Td>
                    <Td>{participant.attendance}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {mom.absentees.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Absent: </span>
              {mom.absentees.map((absentee) => `${absentee.name} (${absentee.department})`).join(', ')}
            </p>
          )}
        </Section>

        <Section title="Agenda">
          {mom.agenda.length === 0 ? (
            <p className="text-sm text-slate-500">No agenda was published for this meeting.</p>
          ) : (
            <ol className="ml-5 list-decimal space-y-1 text-sm">
              {mom.agenda.map((item) => (
                <li key={item.order}>
                  <span className="font-medium">{item.title}</span>
                  {(item.presenter !== '—' || item.outcome !== '—') && (
                    <span className="text-slate-600">
                      {item.presenter !== '—' ? ` — presented by ${item.presenter}` : ''}
                      {item.outcome !== '—' ? ` · expected outcome: ${item.outcome}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Discussion">
          {/*
            The discussion is HTML when the organizer typed formatted notes, and a plain sentence
            when they did not. It is sanitised on save and again on read by the notes editor, and
            what arrives here has already been through both.
          */}
          {mom.discussion.trim().startsWith('<') ? (
            <div
              className="space-y-2 text-sm [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-1 [&_ul]:list-disc"
              dangerouslySetInnerHTML={{ __html: mom.discussion }}
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm">{mom.discussion}</p>
          )}
        </Section>

        <Section title="Decisions">
          {mom.decisions.length === 0 ? (
            <p className="text-sm text-slate-500">No formal decisions were recorded.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <Th>Ref</Th>
                  <Th>Decision</Th>
                  <Th>Owner</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {mom.decisions.map((decision) => (
                  <tr key={decision.reference}>
                    <Td>{decision.reference}</Td>
                    <Td>{decision.title}</Td>
                    <Td>{decision.owner}</Td>
                    <Td>{decision.dueDate}</Td>
                    <Td>{decision.status}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Action items">
          {mom.actionItems.length === 0 ? (
            <p className="text-sm text-slate-500">No action items were recorded.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <Th>Action</Th>
                  <Th>Responsible</Th>
                  <Th>Due date</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {mom.actionItems.map((item, index) => (
                  <tr key={`${item.action}-${index}`}>
                    <Td>{item.action}</Td>
                    <Td>{item.responsible}</Td>
                    <Td>{item.dueDate}</Td>
                    <Td>{item.status}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {mom.nextMeeting && (
          <Section title="Next meeting">
            <p className="text-sm">
              <span className="font-semibold">Date: </span>
              {mom.nextMeeting.date}
              {mom.nextMeeting.time !== '—' && (
                <>
                  <span className="ml-4 font-semibold">Time: </span>
                  {mom.nextMeeting.time}
                </>
              )}
            </p>
            {mom.nextMeeting.note && <p className="mt-1 text-sm text-slate-600">{mom.nextMeeting.note}</p>}
          </Section>
        )}

        <footer className="mt-8 grid grid-cols-1 gap-8 border-t border-slate-300 pt-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-slate-500">Prepared by</p>
            <p className="mt-6 border-t border-slate-400 pt-1 font-medium">{mom.preparedBy ?? '—'}</p>
          </div>
          <div>
            <p className="text-slate-500">Approved by</p>
            <p className="mt-6 border-t border-slate-400 pt-1 font-medium">{mom.approvedBy ?? '—'}</p>
          </div>
        </footer>
      </div>
    );
  },
);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="mb-2 border-b border-slate-300 pb-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-700">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex gap-2">
      <span className="min-w-[5.5rem] shrink-0 font-semibold text-slate-600">{label}:</span>
      <span className="min-w-0 break-words">{value}</span>
    </p>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border border-slate-300 px-2 py-1 text-left font-semibold">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="border border-slate-300 px-2 py-1 align-top">{children}</td>;
}
