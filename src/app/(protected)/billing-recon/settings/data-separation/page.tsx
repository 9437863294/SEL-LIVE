'use client';

/**
 * Settings › Data Separation — moves a project's Billing Recon records out of the register it
 * shared with Project Management. See src/lib/billing-recon/register.ts for the why, and
 * src/components/billing-recon/separation/separation-service.ts for exactly what is written.
 */

import { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle2, GitBranch, Info, Loader2, Search, Split } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { FormDialog } from '@/components/shared/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageAccessDenied } from '@/components/shared/module-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import type { Project } from '@/lib/types';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { isBillingReconSeparated } from '@/lib/billing-recon/register';
import {
  checkTaskFeed,
  loadSeparationPreview,
  rejoinSharedRegister,
  runSeparation,
  type SeparationPreview,
  type SeparationProgress,
  type TaskFeedState,
} from '@/components/billing-recon/separation/separation-service';
import { compactInr } from '@/components/billing-recon/dashboard/br-charts';

type Row = Project & { id: string };

const CLOSED = new Set(['completed', 'certified', 'rejected', 'cancelled']);
const fmt = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'dd MMM yyyy, HH:mm');
};

export default function DataSeparationPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();
  const { projects, loading, reload } = useBillingReconProjects();

  const canView = can('View', 'Billing Recon.Data Separation') || can('Run', 'Billing Recon.Data Separation');
  const canRun = can('Run', 'Billing Recon.Data Separation');

  const rows: Row[] = useMemo(() => projects.filter((p) => p.billingRequired || isBillingReconSeparated(p)), [projects]);
  const separatedCount = rows.filter((p) => isBillingReconSeparated(p)).length;

  // Review dialog state (one dialog for the page — list cells render twice).
  const [target, setTarget] = useState<Row | null>(null);
  const [preview, setPreview] = useState<SeparationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removeFromShared, setRemoveFromShared] = useState(false);
  const [search, setSearch] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SeparationProgress | null>(null);
  const [rejoinTarget, setRejoinTarget] = useState<Row | null>(null);
  const [feed, setFeed] = useState<Record<'jmc' | 'mvac', TaskFeedState> | null>(null);
  const userId = user?.id;

  const openReview = useCallback(async (project: Row) => {
    setTarget(project);
    setPreview(null);
    setPreviewError(null);
    setSearch('');
    setRemoveFromShared(false);
    setProgress(null);
    setFeed(null);
    if (userId) void checkTaskFeed(userId).then(setFeed).catch(() => setFeed(null));
    if (isBillingReconSeparated(project)) return;
    try {
      const data = await loadSeparationPreview(project);
      setPreview(data);
      setSelected(new Set(data.jmc.map((j) => j.id)));
    } catch (error) {
      console.error(error);
      setPreviewError(error instanceof Error ? error.message : 'Could not read this project.');
    }
  }, [userId]);

  const feedProblem = feed && (feed.jmc !== 'ready' || feed.mvac !== 'ready') ? feed : null;
  const feedNotice = feedProblem && (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Approvers won&apos;t see Billing Recon&apos;s own JMC / MVAC tasks yet</AlertTitle>
      <AlertDescription>
        The work board and the task bell can&apos;t read Billing Recon&apos;s registers
        {feedProblem.jmc === 'index-missing' || feedProblem.mvac === 'index-missing' ? ' — the Firestore indexes for them have not been created' : ''}
        {feedProblem.jmc === 'not-permitted' || feedProblem.mvac === 'not-permitted' ? ' — the published Firestore rules don’t allow it yet' : ''}
        . Entries still appear on each project&apos;s JMC / MVAC stage pages. Ask an administrator to publish the Billing Recon indexes and rules (firestore.indexes.json, firestore.rules) before separating projects with approvals in progress.
      </AlertDescription>
    </Alert>
  );

  const closeReview = () => {
    if (running) return;
    setTarget(null);
    setPreview(null);
  };

  const visibleJmc = useMemo(() => {
    const list = preview?.jmc ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((j) => [j.jmcNo, j.woNo, j.stage, j.status, j.raisedBy, j.jmcDate].some((v) => v.toLowerCase().includes(q)));
  }, [preview, search]);

  const chosen = useMemo(() => (preview?.jmc ?? []).filter((j) => selected.has(j.id)), [preview, selected]);
  const keptBecauseReferenced = removeFromShared ? chosen.filter((j) => j.referencedBySubcontractorBill).length : 0;
  const toRemove = removeFromShared ? chosen.length - keptBecauseReferenced : 0;
  const offWorkflow = useMemo(() => {
    if (!preview) return [];
    const steps = new Set(preview.targetWorkflowStepIds);
    return chosen.filter((j) => !CLOSED.has(j.status.toLowerCase()) && j.currentStepId && !steps.has(j.currentStepId));
  }, [chosen, preview]);
  const pendingChosen = chosen.filter((j) => !CLOSED.has(j.status.toLowerCase())).length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const run = async () => {
    if (!target || !preview || !user) return;
    setRunning(true);
    try {
      const result = await runSeparation(
        target,
        { selectedJmcIds: [...selected], removeCopiedJmcFromProjectRegister: removeFromShared },
        { id: user.id, name: user.name, email: user.email },
        setProgress,
      );
      toast({
        title: 'Project separated',
        description: `${target.projectName}: ${result.stamp.copied.boqItems} BOQ items, ${result.stamp.copied.jmcEntries} JMC and ${result.stamp.copied.mvacEntries} MVAC entries now belong to Billing Recon.`,
      });
      await reload();
      setTarget(null);
      setPreview(null);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Separation stopped',
        description: `${error instanceof Error ? error.message : 'Something went wrong.'} Nothing has switched over yet — run it again to continue; copied records are skipped.`,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setRunning(false);
    }
  };

  const rejoin = async () => {
    if (!rejoinTarget || !user) return;
    await rejoinSharedRegister(rejoinTarget, { id: user.id, name: user.name, email: user.email });
    toast({ title: 'Back on the shared register', description: `${rejoinTarget.projectName} reads Project Management's register again. Billing Recon's copies were kept.` });
    await reload();
    setTarget(null);
  };

  const columns: ListColumn<Row>[] = [
    { header: 'Project', mobile: 'title', cell: (p) => <span className="font-medium text-foreground">{p.projectName}</span> },
    {
      header: 'Register',
      mobile: 'aside',
      cell: (p) => (isBillingReconSeparated(p) ? <StatusBadge tone="success" status="Separated" /> : <StatusBadge tone="warning" status="Shared" />),
    },
    {
      header: 'Separated',
      cell: (p) =>
        isBillingReconSeparated(p) ? (
          <span className="text-muted-foreground">
            {fmt(p.billingReconSeparation?.separatedAt)} · {p.billingReconSeparation?.separatedByName || '—'}
          </span>
        ) : (
          <span className="text-muted-foreground">Not yet</span>
        ),
    },
    {
      header: 'Copied',
      cell: (p) => {
        const c = p.billingReconSeparation?.copied;
        return c ? (
          <span className="text-muted-foreground">
            {c.boqItems} BOQ · {c.jmcEntries} JMC · {c.mvacEntries} MVAC
          </span>
        ) : (
          '—'
        );
      },
    },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (p) => (
        <Button size="sm" variant={isBillingReconSeparated(p) ? 'outline' : 'default'} onClick={(e) => { e.stopPropagation(); void openReview(p); }}>
          {isBillingReconSeparated(p) ? 'Details' : 'Review & separate'}
        </Button>
      ),
    },
  ];

  if (authLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!canView) return <PageAccessDenied message="You need Billing Recon › Data Separation › View to open this page." />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Separation"
        description="Give each project's Billing Recon its own BOQ, JMC and MVAC records, apart from Project Management."
        backHref="/billing-recon/settings"
        backLabel="Settings"
        icon={Split}
      />

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4 text-muted-foreground" /> What separating a project does
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 p-4 pt-2 text-sm md:grid-cols-2">
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>Copies the project&apos;s <span className="text-foreground">BOQ</span> into Billing Recon. Project Management, Stores and Subcontractors keep theirs unchanged.</li>
            <li>Copies the <span className="text-foreground">JMC entries you choose</span> — the register is mixed, so you decide which are Billing Recon&apos;s.</li>
            <li>Copies every <span className="text-foreground">MVAC entry</span> (only Billing Recon ever recorded them).</li>
            <li>Gives Billing Recon its own <span className="text-foreground">JMC workflow</span> (a copy of today&apos;s), and Project Management its own JMC number series continuing from today&apos;s numbers.</li>
          </ul>
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>From then on, nothing entered in one module appears in the other.</li>
            <li>Nothing is deleted unless you tick the option to remove the chosen JMCs from Project Management&apos;s register. JMCs a subcontractor bill uses are never removed.</li>
            <li>If it stops part-way, nothing has switched over; run it again and copied records are skipped.</li>
            <li>A separated project can be switched back; Billing Recon&apos;s copies are kept.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-muted-foreground" /> Projects
          </CardTitle>
          <CardDescription className="text-xs">
            {loading ? 'Loading…' : `${separatedCount} of ${rows.length} billing projects separated.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-4 sm:pt-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <DataList rows={rows} columns={columns} empty="No project has billing switched on (Settings › Billing Status)." />
          )}
        </CardContent>
      </Card>

      <FormDialog
        open={target !== null}
        onOpenChange={(open) => !open && closeReview()}
        title={target ? `${isBillingReconSeparated(target) ? 'Separation' : 'Separate'} — ${target.projectName}` : ''}
        description={target && isBillingReconSeparated(target) ? 'This project reads and writes only Billing Recon’s own records.' : 'Review what will be copied, choose the JMC entries, then separate.'}
        size="xl"
        footer={
          target && !isBillingReconSeparated(target) ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              {!canRun && <span className="mr-auto text-xs text-muted-foreground">You need Data Separation › Run to separate.</span>}
              <Button variant="outline" onClick={closeReview} disabled={running}>
                Cancel
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={!canRun || !preview || running}>
                {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Separate project
              </Button>
            </div>
          ) : target ? (
            <div className="flex w-full flex-wrap justify-end gap-2">
              {canRun && (
                <Button variant="outline" onClick={() => setRejoinTarget(target)}>
                  Switch back to the shared register
                </Button>
              )}
              <Button onClick={closeReview}>Close</Button>
            </div>
          ) : undefined
        }
      >
        {target && isBillingReconSeparated(target) && (
          <div className="space-y-4">
            {feedNotice}
            <SeparatedDetails project={target} />
          </div>
        )}

        {target && !isBillingReconSeparated(target) && (
          <div className="space-y-4">
            {previewError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Could not read this project</AlertTitle>
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {!preview && !previewError && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 rounded-lg" />
                  ))}
                </div>
                <Skeleton className="h-48 rounded-lg" />
              </div>
            )}

            {preview && (
              <>
                {feedNotice}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Figure label="BOQ items" value={preview.sharedBoqCount} note={preview.copiedBoqCount ? `${preview.copiedBoqCount} already copied` : 'all copied'} />
                  <Figure label="JMC entries chosen" value={chosen.length} note={`of ${preview.jmc.length} in the register`} />
                  <Figure label="MVAC entries" value={preview.sharedMvacCount} note={preview.copiedMvacCount ? `${preview.copiedMvacCount} already copied` : 'all copied'} />
                  <Figure label="JMC number series" value={preview.serialConfigIds.length} note="continue for Project Management" />
                </div>

                <p className="text-xs text-muted-foreground">
                  JMC workflow:{' '}
                  {preview.billingReconWorkflowExists
                    ? 'Billing Recon already has its own (from an earlier separation); copied JMCs will run on it.'
                    : 'Billing Recon will get a copy of today’s JMC workflow. Edit it afterwards in the project’s JMC › Settings.'}
                </p>

                {offWorkflow.length > 0 && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>{offWorkflow.length} chosen JMC entries sit at a step Billing Recon&apos;s workflow doesn&apos;t have</AlertTitle>
                    <AlertDescription>
                      {offWorkflow.slice(0, 5).map((j) => j.jmcNo).join(', ')}
                      {offWorkflow.length > 5 ? '…' : ''} — they will be copied, but won&apos;t appear at any stage until their step exists in Billing Recon&apos;s JMC workflow.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="rounded-lg border border-border">
                  <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
                    <div className="relative min-w-0 flex-1 basis-52">
                      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search JMC no, WO, stage, raised by…" className="h-9 pl-8" />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setSelected(new Set([...selected, ...visibleJmc.map((j) => j.id)]))}>
                      Select {search ? 'shown' : 'all'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const hide = new Set(visibleJmc.map((j) => j.id));
                        setSelected(new Set([...selected].filter((id) => !hide.has(id))));
                      }}
                    >
                      Clear {search ? 'shown' : 'all'}
                    </Button>
                  </div>
                  {preview.jmc.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">This project has no JMC entries in the shared register.</p>
                  ) : (
                    <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto">
                      {visibleJmc.map((j) => (
                        <li key={j.id}>
                          <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/40">
                            <Checkbox className="mt-0.5" checked={selected.has(j.id)} onCheckedChange={(v) => toggle(j.id, v === true)} aria-label={`Copy JMC ${j.jmcNo}`} />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-medium text-foreground">{j.jmcNo}</span>
                                <span className="text-xs text-muted-foreground">{j.jmcDate || '—'}</span>
                                {j.alreadyCopied && <StatusBadge tone="info" status="Already copied" />}
                                {j.referencedBySubcontractorBill && <StatusBadge tone="neutral" status="Used by a subcontractor bill" />}
                              </span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {j.status}
                                {j.stage && j.stage !== j.status ? ` · ${j.stage}` : ''} · WO {j.woNo || '—'} · {j.lines} lines · {compactInr(j.executedValue)}
                                {j.raisedBy ? ` · raised by ${j.raisedBy}` : ''}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                      {visibleJmc.length === 0 && <li className="p-4 text-sm text-muted-foreground">No JMC matches the search.</li>}
                    </ul>
                  )}
                </div>

                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">Remove the chosen JMC entries from Project Management&apos;s register</p>
                      <p className="text-xs text-muted-foreground">
                        Off: they stay in both (history kept on both sides). On: Project Management stops showing them, and in-progress ones stop appearing in its approval queues. This deletes them from the project register and cannot be undone from here.
                      </p>
                    </div>
                    <Switch checked={removeFromShared} onCheckedChange={setRemoveFromShared} aria-label="Remove the chosen JMC entries from the project register" />
                  </div>
                  {removeFromShared && (
                    <p className="mt-2 text-xs text-foreground">
                      {toRemove} will be removed from Project Management&apos;s register
                      {keptBecauseReferenced ? `; ${keptBecauseReferenced} stay because a subcontractor bill uses them` : ''}.
                    </p>
                  )}
                  {!removeFromShared && pendingChosen > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {pendingChosen} chosen entries are still in approval; they will wait in both modules&apos; queues until each side finishes or removes them.
                    </p>
                  )}
                </div>

                {progress && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{progress.phase}</span>
                      <span className="tabular-nums">
                        {progress.done} / {progress.total}
                      </span>
                    </div>
                    <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </FormDialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Separate ${target?.projectName ?? 'this project'}?`}
        description={
          preview
            ? `Billing Recon will switch to its own copy: ${preview.sharedBoqCount} BOQ items, ${chosen.length} JMC entries and ${preview.sharedMvacCount} MVAC entries.${removeFromShared && toRemove ? ` ${toRemove} JMC entries will be deleted from Project Management's register.` : ''}`
            : ''
        }
        confirmLabel="Separate"
        destructive={removeFromShared && toRemove > 0}
        loading={running}
        onConfirm={run}
      >
        {progress && running && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{progress.phase}</span>
              <span className="tabular-nums">
                {progress.done} / {progress.total}
              </span>
            </div>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={rejoinTarget !== null}
        onOpenChange={(open) => !open && setRejoinTarget(null)}
        title={`Switch ${rejoinTarget?.projectName ?? 'this project'} back to the shared register?`}
        description="Billing Recon will read Project Management's BOQ and JMC register for this project again. Its own copies are kept but hidden — including anything recorded since separating — until the project is separated again."
        confirmLabel="Switch back"
        destructive
        onConfirm={rejoin}
      />
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-foreground">{value.toLocaleString('en-IN')}</div>
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

function SeparatedDetails({ project }: { project: Project }) {
  const s = project.billingReconSeparation;
  if (!s) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <span>
          Separated on {fmt(s.separatedAt)} by {s.separatedByName || '—'}.
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="BOQ items copied" value={s.copied?.boqItems ?? 0} />
        <Figure label="JMC entries copied" value={s.copied?.jmcEntries ?? 0} />
        <Figure label="MVAC entries copied" value={s.copied?.mvacEntries ?? 0} />
        <Figure label="Removed from PM register" value={s.removedFromProjectRegister ?? 0} />
      </div>
      <p className="text-xs text-muted-foreground">
        {s.copied?.jmcWorkflow ? 'Billing Recon’s JMC workflow was created from the shared one at this separation.' : 'Billing Recon’s JMC workflow already existed.'}{' '}
        {s.copied?.serialConfigs ? `${s.copied.serialConfigs} JMC number series were copied for Project Management.` : ''}
      </p>
    </div>
  );
}
