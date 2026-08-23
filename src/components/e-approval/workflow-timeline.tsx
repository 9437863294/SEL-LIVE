'use client';

import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock,
  CornerDownLeft,
  HelpCircle,
  MinusCircle,
  PauseCircle,
  Search,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  eApprovalTimeline,
  type EApprovalStepRecord,
  type EApprovalStepStatus,
  type EApprovalTimelineNode,
} from '@/lib/e-approval';
import { EApprovalOutcomeBadge, EApprovalSlaBadge } from './shared';
import { formatEApprovalDateTime } from './hooks';

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
  now,
  onSelectStep,
  className,
}: {
  steps: EApprovalStepRecord[];
  now?: string;
  onSelectStep?: (step: EApprovalStepRecord) => void;
  className?: string;
}) {
  const nodes = eApprovalTimeline(steps, now ?? new Date());
  if (!nodes.length) {
    return (
      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
        No workflow yet — the chain is created when the approval is submitted.
      </p>
    );
  }
  return (
    <ol className={cn('space-y-1', className)}>
      {nodes.map((node, index) => (
        <TimelineNode
          key={node.step.id}
          node={node}
          isLast={index === nodes.length - 1}
          onSelectStep={onSelectStep}
          now={now}
        />
      ))}
    </ol>
  );
}

interface NodeProps {
  node: EApprovalTimelineNode;
  isLast: boolean;
  onSelectStep?: (step: EApprovalStepRecord) => void;
  now?: string;
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

function NodeBody({ node, isLast, onSelectStep, now }: NodeProps) {
  const [expanded, setExpanded] = useState(true);
  const step = node.step;
  const Icon = statusIcon[step.status] ?? CircleDashed;
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2',
            statusRing[step.status],
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        {(!isLast || hasChildren) && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
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
            <span className="text-sm font-semibold">{node.label}</span>
            {step.type !== 'APPROVAL' && (
              <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[10px] text-violet-700">
                {step.type === 'CLARIFICATION' ? 'Clarification' : step.type === 'REVIEW' ? 'Review' : 'Verification'}
              </Badge>
            )}
            <EApprovalOutcomeBadge outcome={step.outcome} />
            {step.status === 'Active' && <EApprovalSlaBadge step={step} now={now} />}
            {step.reopened && (
              <Badge variant="outline" className="border-orange-200 bg-orange-50 text-[10px] text-orange-700">
                Re-opened
              </Badge>
            )}
            {step.groupMode && step.groupMode !== 'Single' && (
              <Badge variant="outline" className="text-[10px]">
                {step.groupMode === 'All' ? 'All must approve' : step.groupMode === 'Any' ? 'Any one' : 'N of M'}
              </Badge>
            )}
          </div>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {node.assigneeLabel}
            {step.ownedByName && ` · taken by ${step.ownedByName}`}
            {step.delegatedToName && ` · delegated to ${step.delegatedToName}`}
          </p>

          {(step.startedAt || step.completedAt) && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">
              {step.completedAt
                ? `${step.actedByName || 'Acted'} · ${formatEApprovalDateTime(step.completedAt)}`
                : `Pending since ${formatEApprovalDateTime(step.startedAt)}`}
              {step.onBehalfOfName && ` (on behalf of ${step.onBehalfOfName})`}
            </p>
          )}

          {step.instruction && (
            <p className="mt-1 rounded border-l-2 border-sky-200 bg-sky-50/60 px-2 py-1 text-[11px] text-slate-700">
              {step.instruction}
            </p>
          )}
          {step.comment && (
            <p className="mt-1 rounded border-l-2 border-slate-200 bg-muted/40 px-2 py-1 text-[11px] italic text-slate-700">
              “{step.comment}”
            </p>
          )}
        </button>

        {hasChildren && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-50"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', !expanded && '-rotate-90')} />
              {node.children.length} {node.children.length === 1 ? 'sub-task' : 'sub-tasks'}
            </button>

            {expanded && (
              <ol className="mt-1 space-y-1 border-l-2 border-dashed border-violet-200 pl-3">
                {node.children.map((child, index) => (
                  <li key={child.step.id} className="relative">
                    <div className="flex items-center gap-1 text-[10px] text-violet-600">
                      <ArrowRight className="h-3 w-3" /> sent for{' '}
                      {child.step.type === 'CLARIFICATION' ? 'clarification' : 'verification'}
                    </div>
                    <NodeBody
                      node={child}
                      isLast={index === node.children.length - 1}
                      onSelectStep={onSelectStep}
                      now={now}
                    />
                    {(child.step.status === 'Completed' || child.step.status === 'Returned') && (
                      <div className="-mt-2 mb-1 flex items-center gap-1 text-[10px] text-violet-600">
                        <ArrowDownLeft className="h-3 w-3" /> returned to {node.assigneeLabel}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
