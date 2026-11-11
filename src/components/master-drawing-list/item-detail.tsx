'use client';

/**
 * One drawing item (`/master-drawing-list/register/[itemId]`): its facts, the full revision history
 * with the days between events, and the next steps the item allows and the user may take — record a
 * submission, the client's comments, or the approval — plus the Edit form.
 */

import { useState } from 'react';
import { Check, FileStack, MessageSquare, Pencil, Send, TriangleAlert } from 'lucide-react';

import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { ageing, daysBetween, events, formatDate } from '@/lib/master-drawing-list/derive';
import { DAYS_HINT, daysFor } from '@/lib/master-drawing-list/register';
import type { ItemView } from '@/lib/master-drawing-list/server/queries';
import type { MdlStep } from '@/lib/master-drawing-list/steps';
import { STATUS_LABEL, type MdlItem } from '@/lib/master-drawing-list/types';
import { cn } from '@/lib/utils';

import { DetailsDialog } from './details-dialog';
import { useMdlQuery } from './mdl-client';
import { DateText, MdlError, MdlLoading, MdlStatusBadge, STATUS_ACTION } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';
import { StepDialog } from './step-dialogs';

const STEP_ICON: Record<MdlStep, React.ElementType> = { submission: Send, comments: MessageSquare, approval: Check };

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{children}</dd>
    </div>
  );
}

const dash = <span className="text-muted-foreground">—</span>;

/** The history: every dated event, the gap since the one before, and what the item waits on now. */
function History({ item, today }: { item: MdlItem; today: string }) {
  const list = events(item);
  const waiting = ageing(item, today);
  if (!list.length) {
    return <p className="text-sm text-muted-foreground">Nothing has been submitted to the client yet.</p>;
  }
  return (
    <ol className="relative space-y-0">
      {list.map((event, index) => {
        const previous = index > 0 ? list[index - 1].date : null;
        const gap = previous ? daysBetween(previous, event.date) : null;
        const revision = event.rev === null ? null : item.revisions.find((entry) => entry.rev === event.rev);
        const tone =
          event.kind === 'approved'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : event.kind === 'commented'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-sky-200 bg-sky-50 text-sky-700';
        const Icon = event.kind === 'approved' ? Check : event.kind === 'commented' ? MessageSquare : Send;
        const label =
          event.kind === 'approved' ? 'Approved by the client' : event.kind === 'commented' ? `Comments received on R${event.rev}` : `R${event.rev} submitted`;
        return (
          <li key={`${event.kind}-${event.rev}-${index}`} className="grid grid-cols-[auto,1fr,auto] gap-x-3 pb-4 last:pb-0">
            <span className="relative flex flex-col items-center">
              <span className={cn('z-10 flex h-7 w-7 items-center justify-center rounded-full border', tone)} aria-hidden="true">
                <Icon className="h-3.5 w-3.5" />
              </span>
              {index < list.length - 1 && <span className="absolute top-7 h-[calc(100%-0.25rem)] w-px bg-slate-200" aria-hidden="true" />}
            </span>
            <div className="min-w-0 pt-1">
              <p className="text-sm font-medium text-slate-800">{label}</p>
              {event.kind === 'submitted' && revision?.transmittalNo && <p className="text-xs text-muted-foreground">Transmittal {revision.transmittalNo}</p>}
              {gap !== null && <p className="text-xs text-muted-foreground">{gap === 1 ? '1 day' : `${gap} days`} after the previous event</p>}
            </div>
            <span className="pt-1 text-sm tabular-nums text-slate-700">{formatDate(event.date)}</span>
          </li>
        );
      })}
      {waiting && (
        <li className="mt-4 rounded-lg border border-dashed px-3 py-2 text-sm text-slate-700">
          Waiting {waiting.with === 'Client' ? 'with the client' : 'with SEL'} for <b className="tabular-nums">{waiting.days}</b> {waiting.days === 1 ? 'day' : 'days'} since {formatDate(waiting.since)}.
        </li>
      )}
    </ol>
  );
}

export default function ItemDetail({ itemId }: { itemId: string }) {
  const query = useMdlQuery<ItemView>(`items/${encodeURIComponent(itemId)}`);
  const [step, setStep] = useState<MdlStep | null>(null);
  const [editing, setEditing] = useState(false);
  const view = query.data;
  const back = useBackNavigation(view ? `${MDL_BASE}/register?project=${encodeURIComponent(view.project.code)}` : `${MDL_BASE}/register`);

  if (query.loading && !view) return <MdlLoading />;
  if (!view) return <MdlError message={query.error ?? 'This drawing item could not be loaded.'} onRetry={query.reload} />;

  const { item, project, today } = view;
  const days = daysFor(item, today);
  const targetMissed = !item.approved && item.targetApproval && item.targetApproval < today;
  const plannedMissed = !item.revisions.some((revision) => revision.submittedOn) && item.plannedSubmission && item.plannedSubmission < today;
  const saved = () => query.reload();

  return (
    <>
      <PageHeader
        icon={FileStack}
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
        breadcrumbs={[{ label: 'Drawing Register', href: `${MDL_BASE}/register?project=${encodeURIComponent(project.code)}` }, { label: project.short }]}
        title={item.description}
        badge={<MdlStatusBadge status={item.status} />}
        meta={[
          { label: 'Sl. No.', value: item.slNo || '—' },
          { label: 'Drg No.', value: item.drgNo || '—' },
          { label: 'Revision', value: item.currentRev === null ? '—' : `R${item.currentRev}` },
          { label: 'Action', value: STATUS_ACTION[item.status] },
        ]}
        actions={
          <>
            {view.steps.map(({ step: next, label }, index) => {
              const Icon = STEP_ICON[next];
              return (
                <Button key={next} variant={index === 0 ? 'default' : 'outline'} onClick={() => setStep(next)}>
                  <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                  {next === 'submission' && item.revisions.length ? `Record R${item.revisions[item.revisions.length - 1].rev + 1} submission` : label}
                </Button>
              );
            })}
            {view.canEdit && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                Edit
              </Button>
            )}
          </>
        }
      />

      <MdlError message={query.error} onRetry={query.reload} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardContent className="p-4 sm:p-5">
            <SectionHeader title="Revision history" description="Every submission, comment and the approval, with the days between them." />
            <History item={item} today={today} />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardContent className="p-4 sm:p-5">
            <SectionHeader title="Facts" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Project" className="col-span-2">
                {project.displayName}
              </Fact>
              <Fact label="Schedule">{item.schedule}</Fact>
              <Fact label="Scope">{item.scope}</Fact>
              <Fact label="Group" className="col-span-2">
                {item.group ?? dash}
              </Fact>
              <Fact label="Planned submission">
                <DateText value={item.plannedSubmission} className={plannedMissed ? 'text-rose-700' : undefined} />
              </Fact>
              <Fact label="Target approval">
                <DateText value={item.targetApproval} className={targetMissed ? 'text-rose-700' : undefined} />
              </Fact>
              <Fact label="Last submitted">
                <DateText value={item.lastSubmittedOn} />
              </Fact>
              <Fact label="Last comments">
                <DateText value={item.lastCommentedOn} />
              </Fact>
              <Fact label="Approved on">
                <DateText value={item.approvedOn} />
              </Fact>
              <Fact label="Days">{days ? `${days.days} ${DAYS_HINT[days.kind]}` : dash}</Fact>
              <Fact label="Vendor finalised">{item.vendorFinalised ? 'Yes' : 'No'}</Fact>
              <Fact label="On hold">{item.onHold ? 'Yes' : 'No'}</Fact>
              <Fact label="Remarks" className="col-span-2">
                {item.remarks ? <span className="whitespace-pre-line">{item.remarks}</span> : dash}
              </Fact>
              <Fact label="Last change" className="col-span-2">
                {item.updatedAt ? (
                  <span className="text-slate-700">
                    {item.updatedBy === 'import' ? 'Imported from Excel' : (item.updatedByName ?? 'Unknown user')} ·{' '}
                    {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(item.updatedAt))}
                  </span>
                ) : (
                  dash
                )}
              </Fact>
            </dl>
            {(plannedMissed || targetMissed) && (
              <p className="mt-3 text-xs text-rose-700">{plannedMissed ? 'Planned submission date has passed.' : 'Target approval date has passed.'}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {item.legacy && (
        <Card className="min-w-0">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <SectionHeader title="Imported from Excel" description={item.legacy.source} />
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact label="Status typed in the workbook">{item.legacy.status ?? dash}</Fact>
              <Fact label="Status from the dates">{STATUS_LABEL[item.status]}</Fact>
            </dl>
            {item.legacy.issues.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="flex items-center gap-2 font-medium">
                  <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Entries to correct in the workbook
                </p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-6">
                  {item.legacy.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step && <StepDialog item={item} step={step} today={today} open={Boolean(step)} onOpenChange={(open) => !open && setStep(null)} onSaved={saved} />}
      {view.canEdit && <DetailsDialog item={item} open={editing} onOpenChange={setEditing} onSaved={saved} />}
    </>
  );
}
