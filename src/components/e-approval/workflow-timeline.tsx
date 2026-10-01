'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock,
  CornerDownLeft,
  CornerUpRight,
  HelpCircle,
  MessageSquare,
  MinusCircle,
  Paperclip,
  PauseCircle,
  Search,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  eApprovalDiscussion,
  eApprovalStepDiscussion,
  eApprovalStepHops,
  eApprovalTimeline,
  E_APPROVAL_REASSIGNMENT_VERBS,
  type EApprovalComment,
  type EApprovalStepHop,
  type EApprovalDiscussion,
  type EApprovalDiscussionEntry,
  type EApprovalDiscussionNote,
  type EApprovalEventKind,
  type EApprovalHistoryEntry,
  type EApprovalStepRecord,
  type EApprovalStepStatus,
  type EApprovalTimelineNode,
} from '@/lib/e-approval';
import { StatusBadge } from '@/components/shared/status-badge';
import { eApprovalOutcomeTone, EApprovalSlaBadge } from './shared';
import { formatEApprovalAmount, formatEApprovalDateTime } from './hooks';

const statusIcon: Record<EApprovalStepStatus, typeof CheckCircle2> = {
  Pending: CircleDashed,
  Active: Clock,
  'Awaiting Verification': Search,
  'Awaiting Clarification': HelpCircle,
  'On Hold': PauseCircle,
  Completed: CheckCircle2,
  Returned: CornerDownLeft,
  Skipped: MinusCircle,
  Cancelled: XCircle,
  Superseded: MinusCircle,
};

const statusRing: Record<EApprovalStepStatus, string> = {
  Pending: 'bg-slate-100 text-slate-400 ring-slate-200',
  Active: 'bg-sky-100 text-sky-700 ring-sky-300 animate-pulse',
  'Awaiting Verification': 'bg-violet-100 text-violet-700 ring-violet-300',
  'Awaiting Clarification': 'bg-amber-100 text-amber-700 ring-amber-300',
  'On Hold': 'bg-zinc-100 text-zinc-600 ring-zinc-300',
  Completed: 'bg-emerald-100 text-emerald-700 ring-emerald-300',
  Returned: 'bg-orange-100 text-orange-700 ring-orange-300',
  Skipped: 'bg-slate-100 text-slate-400 ring-slate-200',
  Cancelled: 'bg-slate-100 text-slate-400 ring-slate-200',
  Superseded: 'bg-stone-100 text-stone-500 ring-stone-200',
};

/**
 * The nested workflow timeline of spec section 17.
 *
 * Verification and clarification steps render *inside* the approver who raised them, indented, with
 * the arrow back — because that is what they are. Drawing them as siblings in the main chain is the
 * presentation mistake that makes people believe a verifier replaced the approver, which is exactly
 * the misunderstanding the whole module is designed to prevent.
 */
export function WorkflowTimeline({
  steps,
  history,
  comments,
  now,
  onSelectStep,
  className,
}: {
  steps: EApprovalStepRecord[];
  /** The activity log. Without it a stage shows only its last surviving comment. */
  history?: EApprovalHistoryEntry[];
  comments?: EApprovalComment[];
  now?: string;
  onSelectStep?: (step: EApprovalStepRecord) => void;
  className?: string;
}) {
  const nodes = eApprovalTimeline(steps, now ?? new Date());
  const discussion = useMemo(
    () =>
      eApprovalDiscussion(steps, {
        events: history,
        comments: (comments ?? []).map((comment) => ({
          ...comment,
          // The engine takes an ISO string; the Firestore stamp does not leave this layer.
          at: comment.createdAt ? new Date(comment.createdAt.toMillis()).toISOString() : null,
        })),
      }),
    [steps, history, comments],
  );

  if (!nodes.length) {
    return (
      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
        No workflow yet — the chain is created when the approval is submitted.
      </p>
    );
  }
  return (
    <div className={className}>
      <ol className="space-y-1">
        {nodes.map((node, index) => (
          <TimelineNode
            key={node.step.id}
            node={node}
            isLast={index === nodes.length - 1 && discussion.general.length === 0}
            onSelectStep={onSelectStep}
            now={now}
            discussion={discussion}
          />
        ))}
      </ol>

      {/* Notes written against the request rather than a desk — and Created / Submit, which happen
          before any stage exists. They would otherwise be the one part of the trail with nowhere to
          appear, which is exactly how a note goes unread. */}
      {discussion.general.length > 0 && (
        <section className="mt-2 rounded-md border border-dashed bg-muted/30 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            On the request as a whole
          </p>
          <StepThread entries={discussion.general} className="mt-1" />
        </section>
      )}
    </div>
  );
}

interface NodeProps {
  node: EApprovalTimelineNode;
  isLast: boolean;
  onSelectStep?: (step: EApprovalStepRecord) => void;
  now?: string;
  discussion: EApprovalDiscussion;
}

/**
 * One list item of the timeline.
 *
 * Split from `NodeBody` so the recursion never puts an `<li>` straight inside an `<li>`: a nested
 * level is its own `<ol>`, and only this component emits the item wrapper. That is both valid HTML
 * and what screen readers need to announce the verification chain as a sub-list rather than as a
 * sibling of the approval that raised it.
 */
function TimelineNode(props: NodeProps) {
  return (
    <li className="relative">
      <NodeBody {...props} />
    </li>
  );
}

function NodeBody(props: NodeProps) {
  const { node, discussion } = props;
  const hops = useMemo(
    () => eApprovalStepHops(node.step, eApprovalStepDiscussion(discussion, node.step.id), node.children),
    [node, discussion],
  );
  return <HopBody {...props} hops={hops} index={0} />;
}

function HopBody({
  node,
  isLast,
  onSelectStep,
  now,
  discussion,
  hops,
  index,
}: NodeProps & { hops: EApprovalStepHop[]; index: number }) {
  const [expanded, setExpanded] = useState(true);
  const step = node.step;
  const hop = hops[index];
  const next = hops[index + 1];
  const hasChildren = hop.children.length > 0;

  const Icon = hop.isCurrent ? (statusIcon[step.status] ?? CircleDashed) : CornerUpRight;
  const ring = hop.isCurrent
    ? statusRing[step.status]
    : 'bg-orange-100 text-orange-600 ring-orange-300';
  const verb = hop.move ? E_APPROVAL_REASSIGNMENT_VERBS[hop.move.kind] : null;
  const stateLabel = hop.isCurrent ? step.status : (verb ?? 'Moved on');

  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2',
            ring,
          )}
          // Several states share a tint (and Skipped/Superseded an icon), so the name is on hover here
          // and spoken in the desk's button below — the marker alone is not the only carrier.
          title={stateLabel}
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        {(!isLast || hasChildren || next) && (
          <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1 pb-3">
        <button
          type="button"
          onClick={() => onSelectStep?.(step)}
          disabled={!onSelectStep}
          className={cn(
            'block w-full rounded-md px-2 py-1 text-left transition-colors',
            onSelectStep && 'hover:bg-muted/60',
          )}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{hop.title}</span>
            <span className="sr-only">({stateLabel})</span>
            {index === 0 && step.type !== 'APPROVAL' && (
              <Badge variant="neutral">
                {step.type === 'CLARIFICATION' ? 'Clarification' : step.type === 'REVIEW' ? 'Review' : 'Verification'}
              </Badge>
            )}
            {/* A desk the file has left is labelled by what it did with it. Only the desk that still
                holds the stage can speak for the stage's outcome. */}
            {verb && <StatusBadge status={verb} tone="warning" />}
            {hop.isCurrent && step.outcome && (
              <StatusBadge status={step.outcome} tone={eApprovalOutcomeTone[step.outcome]} />
            )}
            {hop.isCurrent && step.status === 'Active' && <EApprovalSlaBadge step={step} now={now} />}
            {hop.isCurrent && step.reopened && <StatusBadge status="Re-opened" tone="warning" />}
            {hop.isCurrent && step.groupMode && step.groupMode !== 'Single' && (
              <Badge variant="outline" className="text-[10px]">
                {step.groupMode === 'All' ? 'All must approve' : step.groupMode === 'Any' ? 'Any one' : 'N of M'}
              </Badge>
            )}
          </div>

          {/* Only when it says something the heading does not. On an ad-hoc stage the two are the
              same person, and printing the name twice is what made this read as two stacked names. */}
          {hop.assigneeLabel !== hop.title && (
            <p className="mt-0.5 text-xs text-muted-foreground">{hop.assigneeLabel}</p>
          )}
          {hop.isCurrent && (step.ownedByName || step.delegatedToName) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {step.ownedByName && `Taken by ${step.ownedByName}`}
              {step.ownedByName && step.delegatedToName && ' · '}
              {step.delegatedToName && `Delegated to ${step.delegatedToName}`}
            </p>
          )}
          {/* Why a stage configured as "Project Manager" is showing a person's name. Without it the
              chain names somebody the workflow never mentions, and there is nothing to read it by. */}
          {hop.resolvedFrom && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">Resolved from {hop.resolvedFrom}</p>
          )}

          <p className="mt-0.5 text-[11px] text-muted-foreground/80">
            {hop.isCurrent
              ? step.completedAt
                ? `${step.actedByName || 'Acted'} · ${formatEApprovalDateTime(step.completedAt)}`
                : `Pending since ${formatEApprovalDateTime(hop.arrivedAt)}`
              : `${hop.move?.byName ? `${hop.move.byName} · ` : ''}${formatEApprovalDateTime(hop.move?.at)}`}
            {hop.isCurrent && step.onBehalfOfName && ` (on behalf of ${step.onBehalfOfName})`}
          </p>
          {hop.isCurrent && step.approvedAmount != null && (
            <p className="mt-0.5 text-[11px] font-medium text-emerald-700">
              Sanctioned {formatEApprovalAmount(step.approvedAmount)}
            </p>
          )}

          {/* Only as a fallback. A step document keeps the last instruction and comment written on it,
              so once the thread is available these two repeat its final entry. */}
          {hop.isCurrent && hop.entries.length === 0 && step.instruction && (
            <p className="mt-1 rounded border-l-2 border-sky-200 bg-sky-50/60 px-2 py-1 text-[11px] text-slate-700">
              {step.instruction}
            </p>
          )}
          {hop.isCurrent && hop.entries.length === 0 && step.comment && (
            <p className="mt-1 rounded border-l-2 border-slate-200 bg-muted/40 px-2 py-1 text-[11px] italic text-slate-700">
              “{step.comment}”
            </p>
          )}
        </button>

        {/*
          What was said at *this* desk: the actions taken here, the covering notes, the instructions
          and the comments filed against the stage while this person held it. A step document keeps
          only the last comment written on it, so without this the earlier approver's note was simply
          gone. The workflow tab is where somebody goes to ask why the file is where it is.
        */}
        <StepThread
          entries={hop.entries}
          className="mt-1"
          nodeStampAt={hop.isCurrent ? step.completedAt : hop.move?.at}
        />

        {hasChildren && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-50"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', !expanded && '-rotate-90')} />
              {hop.children.length} {hop.children.length === 1 ? 'sub-task' : 'sub-tasks'}
            </button>

            {expanded && (
              <ol className="mt-1 space-y-1 border-l-2 border-dashed border-violet-200 pl-3">
                {hop.children.map((child, childIndex) => (
                  <li key={child.step.id} className="relative">
                    <div className="flex items-center gap-1 text-[10px] text-violet-600">
                      <ArrowRight className="h-3 w-3" /> sent for{' '}
                      {child.step.type === 'CLARIFICATION' ? 'clarification' : 'verification'}
                    </div>
                    <NodeBody
                      node={child}
                      isLast={childIndex === hop.children.length - 1}
                      onSelectStep={onSelectStep}
                      now={now}
                      discussion={discussion}
                    />
                    {(child.step.status === 'Completed' || child.step.status === 'Returned') && (
                      <div className="-mt-2 mb-1 flex items-center gap-1 text-[10px] text-violet-600">
                        <ArrowDownLeft className="h-3 w-3" /> returned to {hop.assigneeLabel}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* The next desk, nested — the file went *from* here *to* there, and the indent is the only
            thing that says so at a glance. */}
        {next && (
          <ol className="mt-1 border-l-2 border-orange-200 pl-3">
            <li className="relative">
              <HopBody
                node={node}
                isLast={isLast}
                onSelectStep={onSelectStep}
                now={now}
                discussion={discussion}
                hops={hops}
                index={index + 1}
              />
            </li>
          </ol>
        )}
      </div>
    </div>
  );
}
/** Statuses a stage cannot move on from, so its assignment is where it ended rather than where it is. */
const CLOSED_STEP_STATUSES = new Set<EApprovalStepStatus>([
  'Completed',
  'Returned',
  'Skipped',
  'Cancelled',
  'Superseded',
]);

const entryIcon: Partial<Record<EApprovalEventKind, typeof CheckCircle2>> = {
  Created: CircleDashed,
  Submit: ArrowRight,
  Resubmit: ArrowRight,
  Approve: CheckCircle2,
  'Approve And Complete': CheckCircle2,
  'Send For Verification': Search,
  Verify: Search,
  'Request Clarification': HelpCircle,
  'Provide Clarification': HelpCircle,
  Return: CornerDownLeft,
  'Auto Returned': CornerDownLeft,
  Forward: CornerUpRight,
  Delegate: CornerUpRight,
  'Add Approver': ArrowRight,
  Escalate: CornerUpRight,
  'Escalation Fired': CornerUpRight,
  Reject: XCircle,
  Hold: PauseCircle,
  Resume: Clock,
  Cancel: XCircle,
  Superseded: MinusCircle,
  'Take Ownership': ArrowDownLeft,
  Assign: CornerUpRight,
  Comment: MessageSquare,
  Attachment: Paperclip,
};

const entryTone: Partial<Record<EApprovalEventKind, string>> = {
  Approve: 'text-emerald-600',
  'Approve And Complete': 'text-emerald-600',
  Verify: 'text-violet-600',
  'Send For Verification': 'text-violet-600',
  'Request Clarification': 'text-amber-600',
  'Provide Clarification': 'text-amber-600',
  Return: 'text-orange-600',
  'Auto Returned': 'text-orange-600',
  Forward: 'text-orange-500',
  Delegate: 'text-orange-500',
  Escalate: 'text-orange-500',
  'Escalation Fired': 'text-orange-500',
  Reject: 'text-rose-600',
  Cancel: 'text-rose-600',
  Comment: 'text-sky-600',
};

/**
 * How each kind of writing is framed.
 *
 * An instruction and a remark are not the same thing and must not look the same. "Check the rate
 * against the last purchase order" read as a bare quotation is indistinguishable from an approval
 * note, and acting on the wrong one is how a file comes back a second time.
 */
const noteStyle: Record<
  EApprovalDiscussionNote['label'],
  { title: string; className: string; quoted: boolean }
> = {
  Comment: {
    title: 'Comment',
    className: 'border-slate-300 bg-muted/50 text-slate-700',
    quoted: true,
  },
  Instruction: {
    title: 'Asked to',
    className: 'border-sky-300 bg-sky-50/70 text-slate-700',
    quoted: false,
  },
  Reason: {
    title: 'Reason',
    className: 'border-amber-300 bg-amber-50/70 text-slate-700',
    quoted: false,
  },
  Retracted: {
    title: 'Retracted',
    className: 'border-muted bg-muted/40 text-muted-foreground line-through',
    quoted: true,
  },
};

/** The thread for one stage — its actions and the words written at each of them, oldest first. */
function StepThread({
  entries,
  className,
  depth = 0,
  nodeStampAt,
}: {
  entries: EApprovalDiscussionEntry[];
  className?: string;
  depth?: number;
  /**
   * The instant already printed on the desk's own heading — the move that sent the file on, or the
   * decision that closed the stage.
   *
   * The entry recorded at it says the same thing the node above says: same verb (it is the badge),
   * same person (it is the name), same time, and its destination is the very next node. So only the
   * words somebody wrote are kept, and an entry with none is dropped. Printing it in full is what
   * buried the chain in a wall of repeated names in the first place.
   */
  nodeStampAt?: string | null;
}) {
  const visible = entries.filter(
    (entry) => !(nodeStampAt && entry.at === nodeStampAt && entry.notes.length === 0),
  );
  if (!visible.length) return null;
  return (
    <ol
      className={cn(
        'space-y-1',
        depth > 0 && 'mt-1 border-l-2 border-sky-200 pl-2.5',
        className,
      )}
    >
      {visible.map((entry) => (
        <ThreadEntry
          key={entry.id}
          entry={entry}
          depth={depth}
          notesOnly={Boolean(nodeStampAt) && entry.at === nodeStampAt}
        />
      ))}
    </ol>
  );
}

function ThreadEntry({
  entry,
  depth,
  notesOnly,
}: {
  entry: EApprovalDiscussionEntry;
  depth: number;
  /** The desk's heading already states who, what and when — keep only what they wrote. */
  notesOnly?: boolean;
}) {
  const Icon = (entry.kind && entryIcon[entry.kind]) ?? (entry.source === 'Comment' ? MessageSquare : CornerUpRight);
  const tone = (entry.kind && entryTone[entry.kind]) ?? 'text-muted-foreground';
  return (
    <li className="px-2">
      <div className="flex items-start gap-1.5">
        <Icon className={cn('mt-[3px] h-3 w-3 shrink-0', tone)} aria-hidden />
        <div className="min-w-0 flex-1">
          {!notesOnly && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground/85">{entry.headline}</span>
              {entry.movedTo && ` to ${entry.movedTo}`}
              {entry.actorName && <> by <span className="font-medium text-foreground/85">{entry.actorName}</span></>}
              {entry.actorDesignation && ` (${entry.actorDesignation})`}
              {entry.onBehalfOfName && ` on behalf of ${entry.onBehalfOfName}`}
              {entry.at && ` · ${formatEApprovalDateTime(entry.at)}`}
              {entry.outcome ? ` · ${entry.outcome}` : ''}
              {entry.approvedAmount != null && ` · ${formatEApprovalAmount(entry.approvedAmount)}`}
            </p>
          )}

          {entry.notes.map((note, index) => {
            const style = noteStyle[note.label];
            return (
              <div
                key={`${note.label}-${index}`}
                className={cn('mt-1 rounded border-l-2 px-2 py-1 text-[11px]', style.className)}
              >
                <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide opacity-60">
                  {style.title}
                </span>
                <span className={style.quoted ? 'italic' : undefined}>
                  {style.quoted ? `“${note.text}”` : note.text}
                </span>
              </div>
            );
          })}

          {/* A reply sits under the question it answers, however many stages later it came. */}
          <StepThread entries={entry.replies} depth={depth + 1} />
        </div>
      </div>
    </li>
  );
}
