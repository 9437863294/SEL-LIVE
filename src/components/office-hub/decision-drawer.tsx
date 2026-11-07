'use client';

/**
 * The decision register's side drawer (2026-11-07, from the user's mockup): the decision at a
 * glance, its reasoning, the action items raised from it and its history, with the moves an owner
 * makes — start it, mark it seen through, reopen it, add an action item, edit it.
 *
 * The history is what the record itself carries (recorded, last changed, closed), never invented
 * steps: decisions keep no per-change trail of their own.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { CircleCheck, ExternalLink, Pencil, Play, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { formatAuditStamp } from '@/lib/audit-fields';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  decisionFollowUp,
  formatIsoDate,
  isDecisionOverdue,
  type DecisionStatus,
  type OfficeHubActionItem,
  type OfficeHubDecision,
} from '@/lib/office-hub';
import { Avatar } from './meeting-form-parts';
import { PriorityBars } from './task-create-dialog';
import { WorkStatusChip } from './register-parts';

export function DecisionDrawer({
  decision,
  actions,
  actionsKnown,
  today,
  canEdit,
  canClose,
  canAddAction,
  busy,
  onClose,
  onSetStatus,
  onEdit,
  onAddAction,
}: {
  decision: OfficeHubDecision | null;
  /** The action items raised from this decision. */
  actions: readonly OfficeHubActionItem[];
  /** False when the action items could not be read, so "none" is not claimed. */
  actionsKnown: boolean;
  today: string;
  canEdit: boolean;
  canClose: boolean;
  canAddAction: boolean;
  busy: boolean;
  onClose: () => void;
  onSetStatus: (status: DecisionStatus) => void;
  onEdit: () => void;
  onAddAction: () => void;
}) {
  const late = decision ? isDecisionOverdue(decision, today) : false;
  const followUp = decision ? decisionFollowUp(decision, today) : null;
  const live = actions.filter((item) => item.status !== 'Cancelled');
  const done = live.filter((item) => item.status === 'Completed').length;
  const open = decision?.status === 'Open' || decision?.status === 'In Progress';
  const recorded = decision ? formatAuditStamp(decision.createdByName, decision.createdAt) : '';
  const changed = decision ? formatAuditStamp(decision.updatedByName, decision.updatedAt) : '';

  return (
    <Sheet open={Boolean(decision)} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[440px]">
        {decision && (
          <>
            <div className="oh-hero oh-hero--glow keep-light px-5 pb-4 pt-5 pr-12 text-white">
              <small className="text-[11px] font-bold uppercase tracking-[0.07em] opacity-85">
                {decision.reference} · {decision.status === 'In Progress' ? 'In progress' : decision.status}
              </small>
              <SheetTitle className="mt-1 text-lg font-bold leading-snug text-white">{decision.title}</SheetTitle>
              <SheetDescription className="text-xs text-white/90">
                Taken {formatIsoDate(decision.decisionDate, { withWeekday: true })}
                {decision.meetingTitle ? ` · ${decision.meetingTitle}` : ''}
              </SheetDescription>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3.5">
              <div className="grid grid-cols-2 gap-2">
                <Fact label="Owner">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Avatar seed={decision.ownerId} name={decision.ownerName} size={18} />
                    <span className="truncate">{decision.ownerName}</span>
                  </span>
                </Fact>
                <Fact label="Department">{decision.departmentName ?? '—'}</Fact>
                <Fact label="Follow-up due">
                  <span className={cn(late && 'text-rose-600')}>
                    {decision.dueDate ? `${formatIsoDate(decision.dueDate, { withWeekday: true, year: false })}${late ? ` · ${followUp?.label}` : ''}` : '—'}
                  </span>
                </Fact>
                <Fact label="Priority">
                  <PriorityBars priority={decision.priority} />
                </Fact>
                {decision.projectName && (
                  <Fact label="Project" wide>
                    {decision.projectName}
                  </Fact>
                )}
              </div>

              <Section>Background &amp; reasoning</Section>
              <p className="whitespace-pre-wrap break-words rounded-r-[10px] border-l-[3px] border-violet-400 bg-violet-50 px-3 py-1.5 text-[12.5px] text-muted-foreground">
                {decision.description?.trim() || 'No reasoning recorded.'}
              </p>

              {decision.closureNote && (
                <>
                  <Section>How it ended</Section>
                  <p className="whitespace-pre-wrap break-words text-[12.5px] text-muted-foreground">{decision.closureNote}</p>
                </>
              )}

              <Section>
                Action items{live.length ? ` · ${done} of ${live.length} done` : ''}
              </Section>
              {!actionsKnown ? (
                <p className="text-xs text-muted-foreground">Action items could not be read.</p>
              ) : actions.length === 0 ? (
                <p className="text-xs text-muted-foreground">None yet.</p>
              ) : (
                <ul>
                  {actions.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 border-b py-1.5 text-[12.5px] last:border-0">
                      <Avatar seed={item.responsibleUserId ?? item.responsibleTeamId ?? item.id} name={item.responsibleUserName ?? item.responsibleTeamName ?? '?'} size={22} />
                      <span className={cn('min-w-0 flex-1 font-semibold', item.status === 'Completed' && 'text-muted-foreground line-through')}>{item.title}</span>
                      <WorkStatusChip status={item.status} />
                    </li>
                  ))}
                </ul>
              )}

              <Section>History</Section>
              <ol className="ml-1.5 border-l-2 pl-3.5">
                <HistoryLine title="Recorded">{recorded}</HistoryLine>
                {changed !== recorded && decision.updatedByName && <HistoryLine title="Last changed">{changed}</HistoryLine>}
                {decision.status === 'Completed' && decision.closedAt && (
                  <HistoryLine title="Seen through">{formatAuditStamp(null, new Date(decision.closedAt))}</HistoryLine>
                )}
              </ol>
            </div>

            <div className="flex flex-wrap gap-2 border-t px-5 py-3.5">
              {open && (canEdit || canClose) && (
                <Button size="sm" disabled={busy} onClick={() => onSetStatus('Completed')} className="gap-1.5 bg-gradient-to-r from-primary to-indigo-600 text-white">
                  <CircleCheck className="h-4 w-4" />
                  Mark seen through
                </Button>
              )}
              {decision.status === 'Open' && canEdit && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onSetStatus('In Progress')} className="gap-1.5">
                  <Play className="h-3.5 w-3.5" />
                  Start
                </Button>
              )}
              {decision.status === 'Completed' && canEdit && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onSetStatus('Open')} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reopen
                </Button>
              )}
              {open && canAddAction && (
                <Button size="sm" variant="outline" disabled={busy} onClick={onAddAction} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Action item
                </Button>
              )}
              {canEdit && (
                <Button size="sm" variant="outline" disabled={busy} onClick={onEdit} className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              )}
              <Button size="sm" variant="ghost" asChild className="gap-1.5">
                <Link href={`${OFFICE_HUB_BASE_PATH}/decisions/${decision.id}`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open page
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-[11px] bg-muted px-2.5 py-1.5', wide && 'col-span-2')}>
      <small className="block text-[10.5px] font-bold text-muted-foreground">{label}</small>
      <div className="truncate text-[12.5px] font-bold">{children}</div>
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 mt-3.5 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">{children}</div>;
}

function HistoryLine({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="relative py-1 text-xs text-muted-foreground before:absolute before:-left-[21px] before:top-[9px] before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-violet-400 before:bg-card">
      <b className="text-foreground">{title}</b> · {children}
    </li>
  );
}
