'use client';

/**
 * The in-app guide.
 *
 * Ungated on purpose — a user who cannot find anything is exactly the user who needs it, and
 * gating the help behind the permission whose absence confused them is a closed loop.
 *
 * It is written around §91's workflow rather than around the nav, because "I have just come out of
 * a meeting, now what?" is the question people actually arrive with.
 */

import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  FileText,
  Gavel,
  Keyboard,
  ListTodo,
  Radio,
  Repeat,
  Search,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { OFFICE_HUB_BASE_PATH } from '@/lib/office-hub';
import { useOfficeHub } from '@/components/office-hub/hooks';
import { OfficeHubPageHeader, OfficeHubSection } from '@/components/office-hub/ui';

const STAGES: { icon: React.ElementType; title: string; body: string; href?: string; cta?: string }[] = [
  {
    icon: CalendarDays,
    title: 'Plan',
    body: 'Schedule the meeting. Invite people by name, or invite a whole team or department — the members are resolved when the meeting is created, and again if you reschedule, so somebody who joined last week is included.',
    href: `${OFFICE_HUB_BASE_PATH}/meetings/new`,
    cta: 'Schedule a meeting',
  },
  {
    icon: ClipboardList,
    title: 'Prepare',
    body: 'Add the agenda, attach the papers, and check who has not answered. For a recurring meeting the preparation page also lists unfinished action items from earlier meetings in the series, with a button to carry them into this one.',
    href: `${OFFICE_HUB_BASE_PATH}/meetings`,
    cta: 'Open a meeting',
  },
  {
    icon: Radio,
    title: 'Meet',
    body: 'Meeting mode gives you a timer, the agenda to tick through, and the notes to type into — plus one-tap ways to mark attendance, record a decision and raise an action item without leaving the page. Notes save themselves.',
  },
  {
    icon: Gavel,
    title: 'Decide',
    body: 'A decision goes in the register with its own reference, an owner and a follow-up date, so it can be chased. It stays linked to the meeting that took it.',
    href: `${OFFICE_HUB_BASE_PATH}/decisions`,
    cta: 'Decision register',
  },
  {
    icon: CheckSquare,
    title: 'Assign',
    body: 'An action item records who will do what by when. Pressing "Create task" turns it into a tracked task with the meeting, the decision, the person and the date already filled in — you change what you need and save.',
    href: `${OFFICE_HUB_BASE_PATH}/action-items`,
    cta: 'Action items',
  },
  {
    icon: Bell,
    title: 'Remind',
    body: 'Reminders are written to the server when the meeting or task is saved, and sent by a scheduled job. They arrive whether or not anybody has the app open — and an overdue task nags once a day until somebody acts.',
  },
  {
    icon: ListTodo,
    title: 'Complete',
    body: 'Work the task from the list or drag it across the board. Tick its checklist and the progress bar follows. Linked tasks block completion until the thing they wait on is finished.',
    href: `${OFFICE_HUB_BASE_PATH}/tasks`,
    cta: 'My tasks',
  },
  {
    icon: FileText,
    title: 'Review',
    body: 'Minutes are assembled from what the meeting actually produced — the attendance sheet, the decision register, the action items — so they cannot disagree with the record. Publish them and every participant is told.',
  },
];

const ANSWERS: { question: string; answer: React.ReactNode }[] = [
  {
    question: 'I invited a department. What if somebody joins it next month?',
    answer:
      'The meeting stores the selection ("the Finance department"), not a frozen list of names, so the next meeting you create from it — or a follow-up — invites whoever is in Finance then. The already-sent invitations do not change, because those people have already answered.',
  },
  {
    question: 'Why can I not edit a meeting after it has finished?',
    answer:
      'Its agenda, participants and times are now what the minutes, the attendance sheet and any tasks raised from it all refer to. Editing them would not correct history, it would falsify it. Record what happened in the minutes instead — and attendance stays editable afterwards, because it is almost always filled in later.',
  },
  {
    question: 'Who can see the joining link?',
    answer:
      'Participants, the organizer, and anybody with permission to see every meeting. For most conferencing platforms the link *is* the access control, so being able to see that a meeting exists is deliberately not the same as being entitled to walk into it.',
  },
  {
    question: 'I changed one occurrence of a recurring meeting — did I change them all?',
    answer:
      'No. Editing asks which you mean, and defaults to this occurrence only. Changing how often a meeting repeats is refused from a single occurrence, because "move next Tuesday" and "move every Tuesday for a year" are different intentions.',
  },
  {
    question: 'Why does my task say it is blocked?',
    answer:
      'Something it is linked to as "blocked by" or "depends on" is not finished. Open the Links tab to see which. Both ends of a link are written, so the other task shows that something is waiting on it.',
  },
  {
    question: 'I turned off a notification and still got one.',
    answer:
      'A few are not optional: a meeting you are in being cancelled, and minutes being published. A switch that can hide "your meeting was cancelled" is a switch that makes people turn up to meetings that are not happening.',
  },
  {
    question: 'Does Office Hub rate people?',
    answer:
      'No, and it is built not to. The workload view shows plain counts — active, overdue, completed, meetings, action items — with no composite score, no utilisation percentage, and no default ranking. It exists so work can be moved, not graded.',
  },
];

export default function OfficeHubGuidePage() {
  const { capabilities, settings } = useOfficeHub();

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Guide"
        description="How Office Hub is meant to be used, and the few rules it will not let you break."
      />

      <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-sky-50">
        <CardContent className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-700">The whole idea</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-indigo-950">
            Plan
            <ArrowRight className="h-3.5 w-3.5 opacity-50" />
            Meet
            <ArrowRight className="h-3.5 w-3.5 opacity-50" />
            Discuss
            <ArrowRight className="h-3.5 w-3.5 opacity-50" />
            Decide
            <ArrowRight className="h-3.5 w-3.5 opacity-50" />
            Assign
            <ArrowRight className="h-3.5 w-3.5 opacity-50" />
            Remind
            <ArrowRight className="h-3.5 w-3.5 opacity-50" />
            Complete
            <ArrowRight className="h-3.5 w-3.5 opacity-50" />
            Review
          </p>
          <p className="mt-1.5 text-xs text-indigo-900/80">
            A meeting should never end as just a calendar entry. Everything in this module exists to
            make the step from &ldquo;we agreed something&rdquo; to &ldquo;somebody is being reminded
            about it&rdquo; as short as possible.
          </p>
        </CardContent>
      </Card>

      <OfficeHubSection title="The eight stages" description="What to do, and where.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {STAGES.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <Card key={stage.title} className="border-white/60 bg-white/80">
                <CardContent className="p-4">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
                      <Icon className="h-4 w-4 text-indigo-600" />
                    </span>
                    <p className="text-sm font-semibold text-slate-800">
                      {index + 1}. {stage.title}
                    </p>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600">{stage.body}</p>
                  {stage.href && stage.cta && (
                    <Button size="sm" variant="ghost" asChild className="mt-1.5 h-7 px-2 text-[11px]">
                      <Link href={stage.href}>{stage.cta} →</Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </OfficeHubSection>

      <OfficeHubSection title="Shortcuts" description="Worth knowing after the first week.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Tip icon={Keyboard} title="Ctrl + K">
            Opens the command palette anywhere in Office Hub — search meetings, tasks, decisions and
            people, or start creating something. Pasting a reference number like{' '}
            <code className="rounded bg-slate-100 px-1 text-[11px]">TSK-2627-0041</code> takes you
            straight to it.
          </Tip>
          <Tip icon={Search} title="Search reaches into notes">
            Meeting notes are indexed as plain text, so searching a phrase somebody typed during a
            meeting finds the meeting.
          </Tip>
          <Tip icon={CalendarDays} title="Drag to reschedule">
            On the calendar&rsquo;s month view, drag a meeting to another day. The time is kept,
            participants are notified, and the reminders move with it.
          </Tip>
          <Tip icon={Repeat} title="Series are topped up">
            An open-ended recurring meeting is materialised twelve weeks ahead and extended
            automatically, so it never runs out — and running the generator twice never creates
            duplicates.
          </Tip>
          <Tip icon={Users} title="Teams save re-picking names">
            Invite a team once instead of eight people every month. A task assigned to a team can
            also name one person inside it as responsible.
          </Tip>
          <Tip icon={Bell} title="Reminders do not need a browser">
            They are scheduled on the server. Closing the app does not stop them.
          </Tip>
        </div>
      </OfficeHubSection>

      <OfficeHubSection title="Common questions" description="Including the deliberate refusals.">
        <div className="space-y-2">
          {ANSWERS.map((entry) => (
            <details key={entry.question} className="rounded-lg border bg-white px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">{entry.question}</summary>
              <div className="mt-1.5 text-xs leading-relaxed text-slate-600">{entry.answer}</div>
            </details>
          ))}
        </div>
      </OfficeHubSection>

      <OfficeHubSection title="What you can do here" description="Based on the permissions you currently hold.">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['Create meetings', capabilities.canCreateMeeting],
              ['See all meetings', capabilities.canViewAllMeetings],
              ['Create tasks', capabilities.canCreateTask],
              ['Assign tasks to others', capabilities.canAssignTasks],
              ['Record decisions', capabilities.canCreateDecision],
              ['Create teams', capabilities.canCreateTeam],
              ['Prepare minutes', capabilities.canPrepareMinutes],
              ['Approve minutes', capabilities.canApproveMinutes],
              ['Publish minutes', capabilities.canPublishMinutes],
              ['View reports', capabilities.canViewReports],
              ['Management overview', capabilities.canViewManagementOverview],
              ['Import employees', capabilities.canImportEmployees],
              ['Edit office settings', capabilities.canEditSettings],
            ] as [string, boolean][]
          ).map(([label, allowed]) => (
            <Badge
              key={label}
              variant="outline"
              className={
                allowed
                  ? 'border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700'
                  : 'border-slate-200 bg-slate-50 text-[11px] text-slate-400'
              }
            >
              {allowed ? '✓ ' : '· '}
              {label}
            </Badge>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Something missing? Ask an administrator — access is granted through the app&rsquo;s own
          role and access management, not separately in this module. Note that organising a meeting
          is itself the authority to run it: you do not need extra permissions to set the agenda,
          mark attendance or write the minutes of a meeting you called.
        </p>
      </OfficeHubSection>

      <p className="text-[11px] text-muted-foreground">
        Times are shown in {settings.defaultTimeZone} unless you set your own time zone in{' '}
        <Link href={`${OFFICE_HUB_BASE_PATH}/settings`} className="text-indigo-600 hover:underline">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}

function Tip({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-white/60 bg-white/80">
      <CardContent className="flex items-start gap-2.5 p-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100">
          <Icon className="h-3.5 w-3.5 text-slate-500" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{children}</p>
        </div>
      </CardContent>
    </Card>
  );
}
