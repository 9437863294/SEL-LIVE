'use client';

/**
 * Settings › Workflow & approvers.
 *
 * Approval levels in order, then the payment stage. A level goes to the employee's reporting
 * authority (with exceptions per employee), the same people for every claim, or people per project /
 * department — the stage's own people always being the fallback. Levels after the first may apply
 * only to claims from an amount up (a director's sign-off on large claims). Being assigned is the
 * authority to act; nobody acts on their own claim. Saving re-routes the claims already in process.
 *
 * A level that follows the reporting line lists whose claims it sends where (reporting-line-panel),
 * from the same links Employee › Reporting shows; a page with no such level says so, since a level
 * can be called "Reporting Authority Approval" and still name fixed people.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Banknote, GitBranch, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { ROUTING_LABELS, type StageRouting, type WorkflowStage } from '@/lib/employee-trips/types';
import { ReportingLinePanel } from './reporting-line-panel';
import { ErrorBlock, Field, LoadingBlock, PeoplePicker, SearchSelect } from './trip-ui';
import { useTripSettings } from './use-trip-settings';

const numberOrNull = (value: string): number | null => (value.trim() === '' ? null : Number(value));

export default function WorkflowSettings() {
  const { payload, error, saving, load, save } = useTripSettings();
  // The edits, or null while the saved workflow is shown unchanged.
  const [draft, setDraft] = useState<WorkflowStage[] | null>(null);
  const stages = useMemo(() => draft ?? payload?.settings.stages ?? [], [draft, payload]);
  const dirty = draft !== null;

  const canEdit = Boolean(payload?.canEdit);
  const approvals = stages.filter((stage) => stage.kind === 'approval');
  const payment = stages.find((stage) => stage.kind === 'payment');

  const setStages = (change: (existing: WorkflowStage[]) => WorkflowStage[]) => setDraft(change(stages));
  const update = (id: string, patch: Partial<WorkflowStage>) => {
    setStages((existing) => existing.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)));
  };
  const move = (id: string, by: -1 | 1) => {
    setStages((existing) => {
      const list = existing.filter((stage) => stage.kind === 'approval');
      const index = list.findIndex((stage) => stage.id === id);
      const target = index + by;
      if (index < 0 || target < 0 || target >= list.length) return existing;
      [list[index], list[target]] = [list[target], list[index]];
      return [...list, ...existing.filter((stage) => stage.kind === 'payment')];
    });
  };
  const remove = (id: string) => {
    setStages((existing) => existing.filter((stage) => stage.id !== id));
  };
  /** An exception for one employee, its people still to choose (the editor asks for them). */
  const setApprover = (stageId: string, employeeId: string) => {
    setStages((existing) =>
      existing.map((stage) => (stage.id === stageId && !stage.routes.some((route) => route.key === employeeId) ? { ...stage, routes: [...stage.routes, { key: employeeId, userIds: [] }] } : stage)),
    );
  };
  const addLevel = () => {
    setStages((existing) => [
      ...existing.filter((stage) => stage.kind === 'approval'),
      { id: `stage-${Date.now().toString(36)}`, name: `Approval level ${existing.filter((stage) => stage.kind === 'approval').length + 1}`, kind: 'approval', routing: 'users', userIds: [], routes: [], minAmount: null, tatHours: 48 },
      ...existing.filter((stage) => stage.kind === 'payment'),
    ]);
  };

  // What the editor would refuse to save, said before the save.
  const problems = useMemo(
    () =>
      stages.flatMap((stage) => {
        const issues: string[] = [];
        if (!stage.name.trim()) issues.push('A stage needs a name.');
        if (!stage.userIds.length) issues.push(`Name at least one person on “${stage.name || 'a stage'}”${stage.routing === 'users' ? '' : ' (for claims without a route)'}.`);
        if (stage.routes.some((route) => !route.key || !route.userIds.length)) issues.push(`Finish or remove the empty routes on “${stage.name}”.`);
        return issues;
      }),
    [stages],
  );

  async function submit() {
    const ok = await save({ part: 'stages', stages }, 'Workflow saved');
    if (ok) setDraft(null);
  }

  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />;
  if (!payload) return <LoadingBlock />;

  const users = payload.users;
  const keyOptions = (routing: StageRouting) =>
    routing === 'reporting'
      ? users.map((user) => ({ value: user.id, label: user.name, hint: user.email || undefined }))
      : (routing === 'project' ? payload.projects : payload.departments).map((entry) => ({ value: entry.id, label: entry.name }));

  /** What the people and the routes of a stage mean, per way of routing it. */
  const routingCopy = (stage: WorkflowStage) => {
    const isPayment = stage.kind === 'payment';
    switch (stage.routing) {
      case 'reporting':
        return {
          people: 'Fallback — employees with no reporting authority on record',
          routesTitle: 'Exceptions',
          routesHint: "Every claim goes to the employee's reporting manager — as Employee › Reporting shows it, unless Access Management names another. Add an exception to send one employee's claims to someone else.",
          keyLabel: 'employee',
          addLabel: 'Add exception',
        };
      case 'project':
      case 'department': {
        const label = stage.routing;
        return {
          people: `Fallback — for claims without a ${label} route`,
          routesTitle: `By ${label}`,
          routesHint: `Trips of different ${label}s become separate claims, each going to its own people.`,
          keyLabel: label,
          addLabel: `Add ${label} route`,
        };
      }
      default:
        return { people: isPayment ? 'Payers' : 'Approvers', routesTitle: '', routesHint: '', keyLabel: '', addLabel: '' };
    }
  };

  const stageEditor = (stage: WorkflowStage, index: number) => {
    const isPayment = stage.kind === 'payment';
    const copy = routingCopy(stage);
    return (
      <Card key={stage.id}>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{isPayment ? <Banknote className="h-3.5 w-3.5" aria-hidden /> : index + 1}</span>
            {isPayment ? 'Payment stage' : index === 0 ? 'First approval — every claim' : 'Further approval'}
          </CardTitle>
          {!isPayment && canEdit && (
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0} onClick={() => move(stage.id, -1)} aria-label="Move up">
                <ArrowUp className="h-4 w-4" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={index === approvals.length - 1} onClick={() => move(stage.id, 1)} aria-label="Move down">
                <ArrowDown className="h-4 w-4" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600" disabled={approvals.length === 1} onClick={() => remove(stage.id)} aria-label="Remove level">
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canEdit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Stage name" required className="sm:col-span-2">
                <Input value={stage.name} onChange={(event) => update(stage.id, { name: event.target.value })} maxLength={60} className="bg-white" aria-label="Stage name" />
              </Field>
              <Field label="Time allowed (hours)" hint="Past this, the claim shows as overdue.">
                <Input type="number" min="1" inputMode="numeric" value={stage.tatHours ?? ''} onChange={(event) => update(stage.id, { tatHours: numberOrNull(event.target.value) })} className="bg-white" aria-label="Time allowed in hours" />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Who works it" className="sm:col-span-2">
                {/* A different way of routing means different keys (employees, projects…): start its routes afresh. */}
                <Select value={stage.routing} onValueChange={(value) => update(stage.id, { routing: value as StageRouting, routes: [] })} disabled={!canEdit}>
                  <SelectTrigger className="bg-white text-left" aria-label="Who works it">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROUTING_LABELS) as StageRouting[])
                      .filter((key) => !(isPayment && key === 'reporting'))
                      .map((key) => (
                        <SelectItem key={key} value={key}>
                          {ROUTING_LABELS[key]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              {!isPayment && index > 0 && (
                <Field label="Only for claims of (₹)" hint="Blank = every claim.">
                  <Input type="number" min="0" inputMode="numeric" value={stage.minAmount ?? ''} onChange={(event) => update(stage.id, { minAmount: numberOrNull(event.target.value) })} placeholder="e.g. 5000" className="bg-white" aria-label="Minimum claim amount" />
                </Field>
              )}
            </div>
            <Field label={copy.people} required hint="Any one of them can act.">
              <PeoplePicker users={users} value={stage.userIds} onChange={(next) => update(stage.id, { userIds: next })} disabled={!canEdit} invalid={!stage.userIds.length} />
            </Field>
            {stage.routing === 'users' && stage.userIds.length === 1 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                {users.find((user) => user.id === stage.userIds[0])?.name ?? 'That person'}&apos;s own claims would wait for nobody here — nobody acts on their own claim. Add someone else.
              </p>
            )}
            {stage.routing !== 'users' && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-700">{copy.routesTitle}</p>
                <p className="text-[11px] text-muted-foreground">{copy.routesHint}</p>
                {stage.routes.map((route, routeIndex) => (
                  <div key={`${stage.id}-${routeIndex}`} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-[14rem_minmax(0,1fr)_2rem]">
                    <SearchSelect
                      options={keyOptions(stage.routing).filter((option) => option.value === route.key || !stage.routes.some((entry) => entry.key === option.value))}
                      value={route.key || null}
                      onChange={(value) => update(stage.id, { routes: stage.routes.map((entry, at) => (at === routeIndex ? { ...entry, key: value ?? '' } : entry)) })}
                      placeholder={`Choose ${copy.keyLabel}`}
                      disabled={!canEdit}
                    />
                    <PeoplePicker users={users} value={route.userIds} onChange={(next) => update(stage.id, { routes: stage.routes.map((entry, at) => (at === routeIndex ? { ...entry, userIds: next } : entry)) })} disabled={!canEdit} placeholder={stage.routing === 'reporting' ? 'Approve their claims instead…' : undefined} />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-full sm:w-8" onClick={() => update(stage.id, { routes: stage.routes.filter((_, at) => at !== routeIndex) })} aria-label="Remove">
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => update(stage.id, { routes: [...stage.routes, { key: '', userIds: [] }] })}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {copy.addLabel}
                </Button>
              </div>
            )}
          </fieldset>
          {/* Outside the fieldset: someone who may only view the workflow can still search and filter it. */}
          {stage.routing === 'reporting' && (
            <div className="mt-4">
              <ReportingLinePanel stage={stage} line={payload.reportingLine ?? []} users={users} canEdit={canEdit} onSetApprover={(employeeId) => setApprover(stage.id, employeeId)} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Workflow & approvers"
        icon={GitBranch}
        backHref="/driver-management/settings"
        description="Each claim goes first to the employee's reporting authority (or the people you name), through any further levels, then to payment. Assigned people need no other permission to act."
        actions={
          canEdit ? (
            <Button type="button" className={VM_PRIMARY_BUTTON} disabled={!dirty || saving || problems.length > 0} onClick={() => void submit()}>
              {saving ? 'Saving…' : 'Save workflow'}
            </Button>
          ) : undefined
        }
      />

      {dirty && problems.length > 0 && (
        <ul className="list-inside list-disc rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {[...new Set(problems)].map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {dirty && !problems.length && <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">Unsaved changes. Saving re-routes the claims already in process to the people named here.</p>}

      {!approvals.some((stage) => stage.routing === 'reporting') && (
        <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0">
            No approval level follows the reporting line, so reporting managers do not approve their people&apos;s claims — the people named below do. To use{' '}
            <Link href="/employee/reporting" className="font-medium underline underline-offset-2">
              Employee › Reporting
            </Link>
            , set <span className="font-medium">Who works it</span> to <span className="font-medium">{ROUTING_LABELS.reporting}</span> on a level.
          </p>
        </div>
      )}

      {approvals.map((stage, index) => stageEditor(stage, index))}
      {canEdit && approvals.length < 6 && (
        <Button type="button" variant="outline" onClick={addLevel}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Add approval level
        </Button>
      )}
      {payment && stageEditor(payment, approvals.length)}
    </div>
  );
}
