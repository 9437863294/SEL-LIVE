'use client';

/**
 * Daily Requisition's Verification steps and early takes, on screen
 * (the rules of both live in src/lib/daily-requisition-flow.ts):
 *
 *   - `VerificationStepView` is a Verification step's own page (`/daily-requisition/<its slug>`):
 *     what waits for the signed-in person there, with Verify and Hand over.
 *   - `TakeEarlyPanel` sits on any step set to take requisitions early: what is still at the
 *     earlier steps it takes from, and a Take button that brings it straight here.
 *   - `HandOverDialog` hands requisitions to someone else, at any step marked for it: at a
 *     Verification step they become its holder, at a built-in stage it is assigned to them.
 *   - `StageAssignedView` is a built-in stage's page for someone a requisition was handed to who
 *     holds none of the stage's permissions: what is with them there, and the stage's own actions.
 *
 * Every change re-reads the requisition in a transaction and re-plans from what it finds, so a page
 * that is out of date can only refuse — never move something that has moved on since it loaded.
 */

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  Timestamp,
  where,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ArrowRight, ArrowRightLeft, ChevronDown, FastForward, Loader2, Search, ShieldCheck, TriangleAlert, Undo2, UserRound, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { InfoTip } from '@/components/shared/info-tip';
import { TableCard } from '@/components/shared/table-card';
import { dailyPageContainerClass, dailySurfaceCardClass, DAILY_STATUS_TONE } from '@/components/daily-requisition/module-shell';
import { BANNER_DIALOG_CLASS, GstTdsVerificationDialog } from '@/components/daily-requisition/GstTdsVerificationDialog';
import { dueText, useStepDeadline } from '@/components/daily-requisition/step-deadline';
import { StatusBadge } from '@/components/shared/status-badge';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { personOptionLabel } from '@/lib/people-directory';
import { withDesignations } from '@/lib/people-directory-client';
import { dispatchNotification } from '@/lib/notifications';
import { dailyStepSlug } from '@/lib/daily-requisition-settings';
import { isPaymentLocked } from '@/lib/requisition-progress';
import {
  allowsHandOver,
  approvalActionsOf,
  assignedStageOf,
  handOverCandidates,
  heldStep,
  holdForMove,
  stageOfStatus,
  type StageRole,
  holdAfterVerify,
  PAYMENT_PAGE_NAME,
  placeSteps,
  planReject,
  planSendBack,
  planTake,
  positionOf,
  resolveStepAssignees,
  stepAfterVerify,
  stepNamesUser,
  takeSourcesOf,
  waitingStatusesAt,
} from '@/lib/daily-requisition-flow';
import type { DailyFlowEvent, DailyRequisitionEntry, Department, Project, WorkflowStep } from '@/lib/types';
import { cn } from '@/lib/utils';

/* ── shared bits ─────────────────────────────────────────────────────────── */

type Entry = DailyRequisitionEntry & { id: string };

// Loaded on first open: the dialog imports FlowTrail from this file, so a static import would be circular.
const ViewDailyRequisitionDialog = dynamic(() => import('@/components/daily-requisition/ViewDailyRequisitionDialog'), {
  ssr: false,
});

/** A row that opens its requisition, by click or Enter/Space on the row itself (not on a control inside it). */
function openRowProps(open: () => void) {
  return {
    tabIndex: 0,
    onClick: open,
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    },
  };
}

/** Keeps a click on a cell's own controls (tick box, buttons) from also opening the row. */
const stopRowOpen = (event: MouseEvent) => event.stopPropagation();

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(amount) || 0);

const asDate = (value: unknown): Date | null => {
  const maybe = value as { toDate?: () => Date } | null | undefined;
  if (maybe && typeof maybe.toDate === 'function') return maybe.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const STRIPED_ROW = 'border-slate-100 even:bg-slate-50 hover:bg-emerald-50';
const SELECTED_ROW = 'border-slate-100 bg-emerald-50';

/** Project and department names, read once. Users come from the signed-in session's directory. */
function useProjectAndDepartmentNames() {
  const [names, setNames] = useState<{ projects: Map<string, string>; departments: Map<string, string> } | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([getDocs(collection(db, 'projects')), getDocs(collection(db, 'departments'))])
      .then(([projectsSnap, departmentsSnap]) => {
        if (!active) return;
        setNames({
          projects: new Map(projectsSnap.docs.map((d) => [d.id, (d.data() as Project).projectName])),
          departments: new Map(departmentsSnap.docs.map((d) => [d.id, (d.data() as Department).name])),
        });
      })
      .catch((error) => {
        console.error('Error loading names:', error);
        if (active) setNames({ projects: new Map(), departments: new Map() });
      });
    return () => {
      active = false;
    };
  }, []);
  return names;
}

/** A trail event without undefined fields, which Firestore refuses. */
function flowEvent(event: DailyFlowEvent): DailyFlowEvent {
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)),
  ) as unknown as DailyFlowEvent;
}

/** "3 d", "5 h" — how long since. */
const waitedSince = (value: unknown) => {
  const date = asDate(value);
  return date ? formatDistanceToNowStrict(date) : '—';
};

/* ── Take early ──────────────────────────────────────────────────────────── */

interface TakeEarlyPanelProps {
  steps: WorkflowStep[];
  /** The step taking — its position in the workflow. */
  targetIndex: number;
  /**
   * Whether the person may take into the step at all: `Take Early` on a built-in stage, or being
   * one of a Verification step's assignees (checked again for each requisition).
   */
  canTake: boolean;
}

/**
 * What the step could take early: requisitions still at the earlier steps it is set to take from.
 * Collapsed until opened, so it never pushes the step's own queue down. Shows only what this person
 * may take; nothing at all for someone who may take nothing.
 */
export function TakeEarlyPanel({ steps, targetIndex, canTake }: TakeEarlyPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const names = useProjectAndDepartmentNames();

  const placed = useMemo(() => placeSteps(steps), [steps]);
  const target = placed[targetIndex];
  const sources = useMemo(() => takeSourcesOf(placed, targetIndex), [placed, targetIndex]);
  const statusKey = useMemo(
    () => [...new Set(sources.flatMap((s) => waitingStatusesAt(placed, s.index)))].sort().join('|'),
    [placed, sources],
  );

  const [docs, setDocs] = useState<QueryDocumentSnapshot[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<Entry[] | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const active = canTake && Boolean(user) && sources.length > 0 && statusKey !== '';

  useEffect(() => {
    if (!active) return;
    const statuses = statusKey.split('|');
    return onSnapshot(
      query(collection(db, 'dailyRequisitions'), where('status', 'in', statuses)),
      (snap) => {
        setDocs(snap.docs);
        setDenied(false);
      },
      (error) => {
        console.error('Error loading requisitions to take early:', error);
        setDenied(error.code === 'permission-denied');
        setDocs([]);
      },
    );
  }, [active, statusKey]);

  const rows = useMemo(() => {
    if (!docs || !user) return [];
    const sourceIndexes = new Set(sources.map((s) => s.index));
    return docs
      .map((d) => ({ ...(d.data() as DailyRequisitionEntry), id: d.id }) as Entry)
      .filter((entry) => {
        const position = positionOf(placed, entry);
        if (position === null || !sourceIndexes.has(position) || isPaymentLocked(entry)) return false;
        return planTake(steps, entry, targetIndex, { now: null, actorId: user.id }).ok;
      })
      .map((entry) => ({
        entry,
        at: placed[positionOf(placed, entry) ?? 0]?.step.name ?? '',
        since: asDate(entry.heldSince) ?? asDate(entry.receivedAt) ?? asDate(entry.date) ?? asDate(entry.createdAt),
      }))
      .sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0));
  }, [docs, user, sources, placed, steps, targetIndex]);

  if (!active || !target) return null;

  const visibleIds = new Set(rows.map((r) => r.entry.id));
  const ticked = rows.filter((r) => selected.has(r.entry.id)).map((r) => r.entry);
  const allTicked = rows.length > 0 && ticked.length === rows.length;
  const sourceNames = sources.map((s) => `"${s.step.name}"`).join(', ');

  const plans = (confirming ?? []).map((entry) => planTake(steps, entry, targetIndex, { now: null, actorId: user?.id ?? '' }));
  const skipsGst = plans.some((p) => p.ok && p.plan.skipsGstVerification);
  const skippedNames = [...new Set(plans.flatMap((p) => (p.ok ? p.plan.skipped : [])))];

  const take = async (targets: Entry[]) => {
    if (!user || targets.length === 0) return;
    setBusy(true);
    let taken = 0;
    const refused: string[] = [];
    for (const row of targets) {
      try {
        const result = await runTransaction(db, async (tx) => {
          const ref = doc(db, 'dailyRequisitions', row.id);
          const snap = await tx.get(ref);
          if (!snap.exists()) return { ok: false as const, reason: 'it no longer exists' };
          const current = snap.data() as DailyRequisitionEntry;
          if (isPaymentLocked(current)) return { ok: false as const, reason: 'payments have been made against it' };
          const now = Timestamp.now();
          const planned = planTake(steps, current, targetIndex, { now, actorId: user.id });
          if (!planned.ok) return planned;
          const event = flowEvent({
            action: 'Taken early',
            stepKey: planned.plan.to.key,
            stepName: planned.plan.to.step.name,
            userId: user.id,
            userName: user.name || user.email || user.id,
            at: now,
            comment: comment.trim() || undefined,
            fromStep: planned.plan.from.step.name,
            skipped: planned.plan.skipped,
          });
          tx.update(ref, { ...planned.plan.update, flowTrail: [...(current.flowTrail ?? []), event] });
          return { ok: true as const, plan: planned.plan, from: current.status ?? '' };
        });
        if (result.ok) {
          taken += 1;
          void log(
            'Take Requisition Early',
            {
              step: target.step.name,
              receptionNo: row.receptionNo ?? null,
              partyName: row.partyName ?? null,
              takenFrom: result.plan.from.step.name,
              skipped: result.plan.skipped.join(' → '),
              statusFrom: result.from,
              statusTo: String(result.plan.update.status ?? result.from),
              ...(result.plan.skipsGstVerification ? { skippedGstVerification: true } : {}),
              ...(comment.trim() ? { comment: comment.trim() } : {}),
            },
            { recordId: row.id, recordRef: row.receptionNo || undefined },
          );
        } else {
          refused.push(`${row.receptionNo || row.id}: ${result.reason}`);
        }
      } catch (error) {
        console.error('Error taking requisition early:', error);
        refused.push(`${row.receptionNo || row.id}: could not be saved`);
      }
    }
    setBusy(false);
    setConfirming(null);
    setComment('');
    setSelected(new Set());
    toast({
      title: taken === 0 ? 'Nothing taken' : refused.length ? 'Partly taken' : 'Taken',
      description: [
        taken ? `${taken} ${taken === 1 ? 'requisition is' : 'requisitions are'} now at "${target.step.name}".` : '',
        refused.length ? `Not taken — ${refused.slice(0, 3).join('; ')}${refused.length > 3 ? ` and ${refused.length - 3} more` : ''}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      variant: taken === 0 ? 'destructive' : undefined,
    });
  };

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <section className="overflow-hidden rounded-xl border border-dashed bg-card shadow-sm">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/40 sm:px-5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                <FastForward className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  Take early
                  <span className="rounded-full bg-muted px-2 text-xs font-semibold leading-5 tabular-nums">
                    {docs === null ? '…' : rows.length.toLocaleString('en-IN')}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  Still at {sourceNames} — take them now and skip the steps before yours.
                </span>
              </span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t">
              {denied ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  You cannot see the earlier steps&apos; lists, so there is nothing to take from here. Ask for View on{' '}
                  {sourceNames}.
                </p>
              ) : (
                <>
                  {rows.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-2 text-sm sm:px-5">
                      <Checkbox
                        aria-label={allTicked ? 'Untick every row' : 'Tick every row'}
                        checked={allTicked ? true : ticked.length > 0 ? 'indeterminate' : false}
                        onCheckedChange={(c) => setSelected(c === true ? new Set(visibleIds) : new Set())}
                      />
                      <span className="text-muted-foreground">
                        <span className="font-semibold text-foreground tabular-nums">{ticked.length}</span> of {rows.length} selected
                      </span>
                      <Button size="sm" className="ml-auto" disabled={ticked.length === 0 || busy} onClick={() => setConfirming(ticked)}>
                        <FastForward className="mr-1.5 h-4 w-4" /> Take selected{ticked.length ? ` (${ticked.length})` : ''}
                      </Button>
                    </div>
                  )}
                  <TableCard>
                    <Table className="[--table-cell-py:0.375rem] [--table-head-h:2.25rem]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[44px]" />
                          <TableHead>Reception No.</TableHead>
                          <TableHead>Now at</TableHead>
                          <TableHead>Waiting</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Party Name</TableHead>
                          <TableHead className="text-right">Net Amount</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {docs === null ? (
                          <TableRow>
                            <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                            </TableCell>
                          </TableRow>
                        ) : rows.length === 0 ? (
                          <TableEmpty colSpan={8}>Nothing to take early right now.</TableEmpty>
                        ) : (
                          rows.map(({ entry, at, since }) => (
                            <TableRow key={entry.id} className={selected.has(entry.id) ? SELECTED_ROW : STRIPED_ROW}>
                              <TableCell>
                                <Checkbox
                                  aria-label={`Select ${entry.receptionNo}`}
                                  checked={selected.has(entry.id)}
                                  onCheckedChange={(c) => {
                                    const next = new Set(selected);
                                    if (c === true) next.add(entry.id);
                                    else next.delete(entry.id);
                                    setSelected(next);
                                  }}
                                />
                              </TableCell>
                              <TableCell className="whitespace-nowrap font-medium">{entry.receptionNo}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge variant="outline" className="font-normal">
                                  {at}
                                </Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums">{since ? formatDistanceToNowStrict(since) : '—'}</TableCell>
                              <TableCell>
                                <span className="block max-w-[200px] truncate">{names?.projects.get(entry.projectId) || 'N/A'}</span>
                              </TableCell>
                              <TableCell>
                                <span className="block max-w-[220px] truncate">{entry.partyName}</span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(entry.netAmount)}</TableCell>
                              <TableCell className="text-right">
                                <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => setConfirming([entry])}>
                                  Take
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableCard>
                </>
              )}
            </div>
          </CollapsibleContent>
        </section>
      </Collapsible>

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && !busy && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Take {confirming?.length ?? 0} {confirming?.length === 1 ? 'requisition' : 'requisitions'} into &quot;{target.step.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {skippedNames.length > 0 ? (
                <>
                  {confirming?.length === 1 ? 'It skips' : 'They skip'} <b>{skippedNames.join(', ')}</b> and{' '}
                  {confirming?.length === 1 ? 'comes' : 'come'} straight to you. The skip is recorded on each requisition.
                </>
              ) : (
                'They come straight to you.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {skipsGst && (
            <p className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Not yet verified at GST &amp; TDS Verification: no GST or TDS will have been worked out on{' '}
              {confirming?.length === 1 ? 'it' : 'those'}.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="take-early-comment">Note (optional)</Label>
            <Textarea
              id="take-early-comment"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Why it is being taken early"
              className="resize-none"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !confirming?.length}
              onClick={(event) => {
                event.preventDefault();
                if (confirming) void take(confirming);
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FastForward className="mr-2 h-4 w-4" />}
              Take {confirming?.length ?? 0}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ── a Verification step's page ──────────────────────────────────────────── */

interface VerificationStepViewProps {
  steps: WorkflowStep[];
  /** The Verification step — its position in the workflow. */
  index: number;
}

type HeldRow = {
  entry: Entry;
  holders: string;
  mine: boolean;
  /** The latest hand-over at this step, when it was handed over. */
  handedBy?: string;
};

/**
 * A Verification step's queue. "Waiting for me" holds what the signed-in person must verify — the
 * step's own assignment for the requisition's project or department, or what was handed to them —
 * and anyone who can read the module's requisitions also sees everything waiting at the step.
 */
export function VerificationStepView({ steps, index }: VerificationStepViewProps) {
  const { user, users } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const names = useProjectAndDepartmentNames();

  const placed = useMemo(() => placeSteps(steps), [steps]);
  const self = placed[index];
  const step = self?.step;
  const stepKeyValue = self?.key ?? '';
  const nextName = stepAfterVerify(steps, index) ?? 'the next step';
  const userId = user?.id ?? '';

  const [mineDocs, setMineDocs] = useState<QueryDocumentSnapshot[] | null>(null);
  const [allDocs, setAllDocs] = useState<QueryDocumentSnapshot[] | null>(null);
  const [allDenied, setAllDenied] = useState(false);
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState<Entry[] | null>(null);
  /** A requisition being verified for GST & TDS here (its form is open while set), which then goes on. */
  const [gstVerifying, setGstVerifying] = useState<Entry | null>(null);
  const [handingOver, setHandingOver] = useState<Entry | null>(null);
  /** The requisition whose details are open. */
  const [viewing, setViewing] = useState<Entry | null>(null);
  /** A requisition being sent back or rejected (the dialog is open while set), and the note it goes with. */
  const [turningBack, setTurningBack] = useState<{ entry: Entry; kind: 'Sent back' | 'Rejected' } | null>(null);
  const [turnNote, setTurnNote] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  // The details dialog takes lists; it only looks names up in them.
  const projectList = useMemo(
    () => [...(names?.projects ?? new Map<string, string>())].map(([id, projectName]) => ({ id, projectName }) as Project),
    [names],
  );
  const departmentList = useMemo(
    () => [...(names?.departments ?? new Map<string, string>())].map(([id, name]) => ({ id, name }) as Department),
    [names],
  );

  // What is waiting for me: named among the holders. Readable by the holders whatever else they may see.
  useEffect(() => {
    if (!userId || !stepKeyValue) return;
    return onSnapshot(
      query(collection(db, 'dailyRequisitions'), where('heldAssignees', 'array-contains', userId)),
      (snap) => setMineDocs(snap.docs),
      (error) => {
        console.error('Error loading requisitions waiting for you:', error);
        setMineDocs([]);
      },
    );
  }, [userId, stepKeyValue]);

  // Everything at the step, for those who can read the module's requisitions.
  useEffect(() => {
    if (!userId || !stepKeyValue) return;
    return onSnapshot(
      query(collection(db, 'dailyRequisitions'), where('heldAt', '==', stepKeyValue)),
      (snap) => {
        setAllDocs(snap.docs);
        setAllDenied(false);
      },
      (error) => {
        if (error.code !== 'permission-denied') console.error('Error loading the step:', error);
        setAllDenied(true);
        setAllDocs([]);
      },
    );
  }, [userId, stepKeyValue]);

  const userName = useMemo(() => {
    const map = new Map(users.map((u) => [u.id, u.name || u.email || u.id]));
    return (id: string) => map.get(id) ?? id;
  }, [users]);

  const toRows = (snaps: QueryDocumentSnapshot[] | null): HeldRow[] =>
    (snaps ?? [])
      .map((d) => ({ ...(d.data() as DailyRequisitionEntry), id: d.id }) as Entry)
      .filter((entry) => heldStep(placed, entry)?.key === stepKeyValue)
      .map((entry) => {
        const handover = [...(entry.flowTrail ?? [])]
          .reverse()
          .find((event) => event.stepKey === stepKeyValue && event.action === 'Handed over');
        return {
          entry,
          holders: (entry.heldAssignees ?? []).map(userName).join(', ') || '—',
          mine: (entry.heldAssignees ?? []).includes(userId),
          handedBy: handover ? handover.userName : undefined,
        };
      })
      .sort((a, b) => (asDate(a.entry.heldSince)?.getTime() ?? 0) - (asDate(b.entry.heldSince)?.getTime() ?? 0));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mineRows = useMemo(() => toRows(mineDocs), [mineDocs, placed, stepKeyValue, userName, userId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allRows = useMemo(() => toRows(allDocs), [allDocs, placed, stepKeyValue, userName, userId]);

  if (!step || !self) return null;

  const isAssignee = stepNamesUser(step, userId);
  const canTakeHere = takeSourcesOf(placed, index).length > 0 && isAssignee;
  const showAll = !allDenied;
  const rows = tab === 'all' && showAll ? allRows : mineRows;
  const visibleMine = rows.filter((r) => r.mine);
  const ticked = visibleMine.filter((r) => selected.has(r.entry.id)).map((r) => r.entry);
  const loading = mineDocs === null || (showAll && allDocs === null);
  const totalAmount = mineRows.reduce((sum, r) => sum + (Number(r.entry.netAmount) || 0), 0);

  const canHandOver = allowsHandOver(step);
  // Send Back and Reject, where Workflow Configuration switched them on. The first step before
  // Finance has nothing earlier to send back to.
  const approval = approvalActionsOf(step);
  const canSendBack =
    Boolean(approval.sendBack) && !(self.segment === 0 && !placed.slice(0, index).some((q) => q.role === 'verification' && q.segment === 0));
  const canReject = Boolean(approval.reject);

  /**
   * Send back or reject one requisition, re-read in a transaction (planSendBack, planReject).
   * Rejecting frees the expense request it was received from, as Finance's cancel does, when this
   * person may read it; otherwise the request stays linked and the toast says so.
   */
  const turnBack = async (row: Entry, kind: 'Sent back' | 'Rejected', note: string) => {
    if (!user) return;
    setBusy(true);
    let requestRefs: DocumentReference[] = [];
    let requestUnread = false;
    if (kind === 'Rejected' && row.depNo?.trim()) {
      try {
        const snap = await getDocs(query(collection(db, 'expenseRequests'), where('requestNo', '==', row.depNo)));
        requestRefs = snap.docs.map((d) => d.ref);
      } catch {
        requestUnread = true;
      }
    }
    try {
      const result = await runTransaction(db, async (tx) => {
        const ref = doc(db, 'dailyRequisitions', row.id);
        const snap = await tx.get(ref);
        const requestSnaps = await Promise.all(requestRefs.map((r) => tx.get(r)));
        if (!snap.exists()) return { ok: false as const, reason: 'it no longer exists' };
        const current = snap.data() as DailyRequisitionEntry;
        if (heldStep(placeSteps(steps), current)?.key !== stepKeyValue) return { ok: false as const, reason: 'it has moved on' };
        if (!(current.heldAssignees ?? []).includes(user.id)) return { ok: false as const, reason: 'it is no longer with you' };
        if (isPaymentLocked(current)) return { ok: false as const, reason: 'payments have been made against it' };
        const now = Timestamp.now();
        const plan = kind === 'Sent back' ? planSendBack(steps, current, now) : planReject(steps, current);
        if (!plan.ok) return { ok: false as const, reason: plan.reason };
        const event = flowEvent({
          action: kind,
          stepKey: stepKeyValue,
          stepName: step.name,
          userId: user.id,
          userName: user.name || user.email || user.id,
          at: now,
          comment: note.trim() || undefined,
          toStep: kind === 'Sent back' ? plan.toName : undefined,
        });
        tx.update(ref, { ...plan.update, flowTrail: [...(current.flowTrail ?? []), event] });
        // The requests this requisition received (same Reception No) are free to be received again.
        const receptionNo = (current.receptionNo || '').trim();
        let freed = 0;
        requestSnaps.forEach((s) => {
          if (receptionNo && s.exists() && String(s.data().receptionNo ?? '').trim() === receptionNo) {
            tx.update(s.ref, { receptionNo: '', receptionDate: '' });
            freed += 1;
          }
        });
        return { ok: true as const, toName: plan.toName, freed };
      });
      if (result.ok) {
        void log(
          kind === 'Sent back' ? 'Send Back Requisition' : 'Reject Requisition',
          {
            step: step.name,
            receptionNo: row.receptionNo ?? null,
            partyName: row.partyName ?? null,
            ...(kind === 'Sent back' ? { sentBackTo: result.toName } : {}),
            ...(result.freed > 0 ? { expenseRequestsReleased: result.freed } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
          { recordId: row.id, recordRef: row.receptionNo || undefined },
        );
        toast({
          title: kind === 'Sent back' ? 'Sent back' : 'Rejected',
          description:
            kind === 'Sent back'
              ? `${row.receptionNo || 'The requisition'} is back at ${result.toName}.`
              : `${row.receptionNo || 'The requisition'} is cancelled.${
                  requestUnread ? ' Its expense request could not be freed from here, so it still shows as received.' : ''
                }`,
        });
      } else {
        toast({ title: kind === 'Sent back' ? 'Not sent back' : 'Not rejected', description: `${row.receptionNo || row.id}: ${result.reason}.`, variant: 'destructive' });
      }
    } catch (error) {
      console.error(`Error (${kind}) on requisition:`, error);
      toast({ title: kind === 'Sent back' ? 'Not sent back' : 'Not rejected', description: 'It could not be saved.', variant: 'destructive' });
    }
    setBusy(false);
    setTurningBack(null);
    setTurnNote('');
  };

  /**
   * Verify each, one transaction apiece: passed to the segment's next Verification step, or released
   * to the stage after. With `figures` (Verify (GST & TDS), one requisition), its GST & TDS figures
   * are written in the same transaction. Resolves to how many went on.
   */
  const verify = async (targets: Entry[], figures?: Record<string, unknown>): Promise<number> => {
    if (!user || targets.length === 0) return 0;
    setBusy(true);
    let done = 0;
    const refused: string[] = [];
    /** Who requisitions went back to, for those handed over with "send it back to me". */
    const returned: string[] = [];
    for (const row of targets) {
      try {
        const result = await runTransaction(db, async (tx) => {
          const ref = doc(db, 'dailyRequisitions', row.id);
          const snap = await tx.get(ref);
          if (!snap.exists()) return { ok: false as const, reason: 'it no longer exists' };
          const current = snap.data() as DailyRequisitionEntry;
          if (heldStep(placeSteps(steps), current)?.key !== stepKeyValue) return { ok: false as const, reason: 'it has moved on' };
          if (!(current.heldAssignees ?? []).includes(user.id)) return { ok: false as const, reason: 'it is no longer with you' };
          if (isPaymentLocked(current)) return { ok: false as const, reason: 'payments have been made against it' };
          const now = Timestamp.now();
          const next = holdAfterVerify(steps, current, now);
          const note = figures ? ['GST & TDS verified', comment.trim()].filter(Boolean).join(' — ') : comment.trim();
          const event = flowEvent({
            action: 'Verified',
            stepKey: stepKeyValue,
            stepName: step.name,
            userId: user.id,
            userName: user.name || user.email || user.id,
            at: now,
            comment: note || undefined,
          });
          tx.update(ref, { ...(figures ?? {}), ...next, flowTrail: [...(current.flowTrail ?? []), event] });
          // Handed over with "send it back to me": it stays at this step, back with whoever asked.
          if (next.heldAt === stepKeyValue) {
            return { ok: true as const, nextStep: step.name, returnedTo: next.heldAssignees.map(userName).join(', ') };
          }
          const nextStep = next.heldAt ? placeSteps(steps).find((p) => p.key === next.heldAt)?.step.name : null;
          return { ok: true as const, nextStep: nextStep ?? nextName, returnedTo: '' };
        });
        if (result.ok) {
          done += 1;
          if (result.returnedTo) returned.push(result.returnedTo);
          void log(
            'Verify Requisition',
            {
              step: step.name,
              receptionNo: row.receptionNo ?? null,
              partyName: row.partyName ?? null,
              ...(result.returnedTo ? { returnedTo: result.returnedTo } : { sentTo: result.nextStep }),
              ...(targets.length > 1 ? { bulk: true, batchCount: targets.length } : {}),
              ...(comment.trim() ? { comment: comment.trim() } : {}),
            },
            { recordId: row.id, recordRef: row.receptionNo || undefined },
          );
        } else {
          refused.push(`${row.receptionNo || row.id}: ${result.reason}`);
        }
      } catch (error) {
        console.error('Error verifying requisition:', error);
        refused.push(`${row.receptionNo || row.id}: could not be saved`);
      }
    }
    setBusy(false);
    setVerifying(null);
    setComment('');
    setSelected(new Set());
    toast({
      title: done === 0 ? 'Nothing verified' : refused.length ? 'Partly verified' : 'Verified',
      description: [
        done > returned.length
          ? `${done - returned.length} ${done - returned.length === 1 ? 'requisition' : 'requisitions'} verified and sent on.`
          : '',
        returned.length ? `${returned.length === 1 ? 'One' : returned.length} verified and back with ${[...new Set(returned)].join(', ')}, who asked for it back.` : '',
        refused.length ? `Not verified — ${refused.slice(0, 3).join('; ')}${refused.length > 3 ? ` and ${refused.length - 3} more` : ''}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      variant: done === 0 ? 'destructive' : undefined,
    });
    return done;
  };

  const forwardLabel = approval.forward ?? 'Approve';

  return (
    <>
      <div className={`${dailyPageContainerClass} space-y-3`}>
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="space-y-0 px-4 pb-3 pt-3 sm:px-5 sm:pt-4">
            <PageHeader
              backHref="/daily-requisition"
              breadcrumbs={[{ label: 'Daily Requisition', href: '/daily-requisition' }, { label: step.name }]}
              title={step.name}
              badge={
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> Verification step
                </Badge>
              }
              description={
                step.description?.trim() ||
                `Verify each requisition, or hand it to someone else to verify. Once verified it goes to ${nextName}.`
              }
            />
          </div>
          <dl className="grid grid-cols-3 gap-px border-t bg-border">
            {[
              { label: 'Waiting for me', value: mineRows.length.toLocaleString('en-IN') },
              { label: 'Amount', value: formatCurrency(totalAmount) },
              { label: 'Verified goes to', value: nextName },
            ].map((stat) => (
              <div key={stat.label} className="min-w-0 bg-card px-4 py-2.5 sm:px-5">
                <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</dt>
                <dd className="mt-1 truncate font-mono text-base font-semibold leading-tight tabular-nums text-foreground" title={stat.value}>
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {canTakeHere && <TakeEarlyPanel steps={steps} targetIndex={index} canTake={isAssignee} />}

        <Tabs
          value={showAll ? tab : 'mine'}
          onValueChange={(v) => {
            setTab(v as 'mine' | 'all');
            setSelected(new Set());
          }}
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <TabsList>
              <TabsTrigger value="mine">Waiting for me ({mineRows.length})</TabsTrigger>
              {showAll && <TabsTrigger value="all">Everyone at this step ({allRows.length})</TabsTrigger>}
            </TabsList>
            {visibleMine.length > 0 && approval.forward && (
              <Button size="sm" className="ml-auto" disabled={ticked.length === 0 || busy} onClick={() => setVerifying(ticked)}>
                <ShieldCheck className="mr-1.5 h-4 w-4" /> {approval.forward} selected{ticked.length ? ` (${ticked.length})` : ''}
              </Button>
            )}
          </div>

          {(['mine', 'all'] as const).map((key) => (
            <TabsContent key={key} value={key} className="mt-0">
              <TableCard>
                <Table className="[--table-cell-py:0.375rem] [--table-head-h:2.25rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[44px]">
                        <Checkbox
                          aria-label="Tick every requisition waiting for you"
                          disabled={visibleMine.length === 0}
                          checked={
                            visibleMine.length > 0 && ticked.length === visibleMine.length
                              ? true
                              : ticked.length > 0
                                ? 'indeterminate'
                                : false
                          }
                          onCheckedChange={(c) => setSelected(c === true ? new Set(visibleMine.map((r) => r.entry.id)) : new Set())}
                        />
                      </TableHead>
                      <TableHead>Reception No.</TableHead>
                      <TableHead>Received At</TableHead>
                      <TableHead>Waiting</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Party Name</TableHead>
                      <TableHead>With</TableHead>
                      <TableHead className="text-right">Net Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableEmpty colSpan={9}>
                        {tab === 'mine' || !showAll ? 'Nothing is waiting for you at this step.' : 'Nothing is waiting at this step.'}
                      </TableEmpty>
                    ) : (
                      rows.map(({ entry, holders, mine, handedBy }) => {
                        const receivedAt = asDate(entry.receivedAt);
                        return (
                          <TableRow
                            key={entry.id}
                            className={cn('cursor-pointer', selected.has(entry.id) ? SELECTED_ROW : STRIPED_ROW)}
                            {...openRowProps(() => setViewing(entry))}
                          >
                            <TableCell onClick={stopRowOpen}>
                              <Checkbox
                                aria-label={`Select ${entry.receptionNo}`}
                                disabled={!mine}
                                checked={selected.has(entry.id)}
                                onCheckedChange={(c) => {
                                  const next = new Set(selected);
                                  if (c === true) next.add(entry.id);
                                  else next.delete(entry.id);
                                  setSelected(next);
                                }}
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-medium">{entry.receptionNo}</TableCell>
                            <TableCell className="whitespace-nowrap">{receivedAt ? format(receivedAt, 'dd MMM, yyyy') : '—'}</TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums">{waitedSince(entry.heldSince)}</TableCell>
                            <TableCell>
                              <span className="block max-w-[200px] truncate">{names?.projects.get(entry.projectId) || 'N/A'}</span>
                            </TableCell>
                            <TableCell>
                              <span className="block max-w-[220px] truncate" title={entry.partyName}>
                                {entry.partyName}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[200px]">
                              <span className="flex items-center gap-1.5 truncate">
                                <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate" title={holders}>
                                  {holders}
                                </span>
                              </span>
                              {handedBy && (
                                <span className="block truncate text-[11px] text-muted-foreground">handed over by {handedBy}</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(entry.netAmount)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right" onClick={stopRowOpen}>
                              {mine ? (
                                <div className="flex justify-end gap-1.5">
                                  {approval.gstVerify && (
                                    <Button size="sm" className="h-7" disabled={busy} onClick={() => setGstVerifying(entry)}>
                                      Verify (GST &amp; TDS)
                                    </Button>
                                  )}
                                  {approval.forward && (
                                    <Button
                                      size="sm"
                                      variant={approval.gstVerify ? 'outline' : 'default'}
                                      className="h-7"
                                      disabled={busy}
                                      onClick={() => setVerifying([entry])}
                                    >
                                      {approval.forward}
                                    </Button>
                                  )}
                                  {canSendBack && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7"
                                      disabled={busy}
                                      onClick={() => setTurningBack({ entry, kind: 'Sent back' })}
                                    >
                                      <Undo2 className="mr-1 h-3.5 w-3.5" /> {approval.sendBack}
                                    </Button>
                                  )}
                                  {canReject && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                      disabled={busy}
                                      onClick={() => setTurningBack({ entry, kind: 'Rejected' })}
                                    >
                                      <XCircle className="mr-1 h-3.5 w-3.5" /> {approval.reject}
                                    </Button>
                                  )}
                                  {canHandOver && (
                                    <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => setHandingOver(entry)}>
                                      <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Hand over
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableCard>
            </TabsContent>
          ))}
        </Tabs>

        {!loading && mineRows.length === 0 && !isAssignee && allDenied && (
          <Card className={dailySurfaceCardClass}>
            <CardHeader>
              <CardTitle className="text-base">Nothing here for you</CardTitle>
              <CardDescription>
                This step is worked by the people assigned to it in Workflow Configuration, and by anyone a
                requisition is handed to. When one is handed to you it shows here.
              </CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        )}
      </div>

      {/* Verify: one or many, with an optional note that goes on each requisition's trail. */}
      <AlertDialog open={verifying !== null} onOpenChange={(o) => !o && !busy && setVerifying(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {forwardLabel} {verifying?.length ?? 0} {verifying?.length === 1 ? 'requisition' : 'requisitions'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {verifying?.length === 1 ? `${verifying[0].receptionNo} goes` : 'They go'} on to <b>{nextName}</b>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="verify-comment">Note (optional)</Label>
            <Textarea
              id="verify-comment"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Anything the next step should know"
              className="resize-none"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !verifying?.length}
              onClick={(event) => {
                event.preventDefault();
                if (verifying) void verify(verifying);
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {forwardLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Verify (GST & TDS) at this step: the figures are recorded as it goes on; its status stays. */}
      <GstTdsVerificationDialog
        isOpen={gstVerifying !== null}
        onOpenChange={(open) => !open && setGstVerifying(null)}
        entry={gstVerifying ? ({ ...gstVerifying, projectName: names?.projects.get(gstVerifying.projectId) } as Entry) : null}
        onSuccess={() => setGstVerifying(null)}
        passOn={{ to: nextName, save: async (figures) => (gstVerifying ? (await verify([gstVerifying], figures)) > 0 : false) }}
        stepName={step.name}
        path={{
          done: self.segment === 0 ? 'Entered' : 'Received',
          current: step.name,
          next: nextName === PAYMENT_PAGE_NAME ? [nextName] : [nextName, 'Payment'],
        }}
        sendBack={canSendBack && gstVerifying && approval.sendBack ? { label: approval.sendBack, onClick: () => setTurningBack({ entry: gstVerifying, kind: 'Sent back' }) } : undefined}
      />

      <HandOverDialog steps={steps} index={index} entries={handingOver ? [handingOver] : null} onClose={() => setHandingOver(null)} />

      {/* Send back or reject: the note says why, and goes on the requisition's trail. */}
      <AlertDialog
        open={turningBack !== null}
        onOpenChange={(o) => {
          if (!o && !busy) {
            setTurningBack(null);
            setTurnNote('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {turningBack?.kind === 'Rejected' ? approval.reject : approval.sendBack} {turningBack?.entry.receptionNo}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {turningBack?.kind === 'Rejected'
                ? 'It is cancelled here and goes no further.'
                : 'It goes back to the step before this one, which works it again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="turn-back-note">{turningBack?.kind === 'Rejected' ? 'Reason' : 'What needs fixing'}</Label>
            <Textarea
              id="turn-back-note"
              rows={2}
              value={turnNote}
              onChange={(e) => setTurnNote(e.target.value)}
              placeholder={turningBack?.kind === 'Rejected' ? 'Why it is rejected' : 'What the step before should look at'}
              className="resize-none"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !turnNote.trim()}
              className={turningBack?.kind === 'Rejected' ? 'bg-rose-600 hover:bg-rose-700' : undefined}
              onClick={(event) => {
                event.preventDefault();
                if (turningBack) void turnBack(turningBack.entry, turningBack.kind, turnNote);
              }}
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : turningBack?.kind === 'Rejected' ? (
                <XCircle className="mr-2 h-4 w-4" />
              ) : (
                <Undo2 className="mr-2 h-4 w-4" />
              )}
              {turningBack?.kind === 'Rejected' ? approval.reject : approval.sendBack}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {viewing && (
        <ViewDailyRequisitionDialog
          isOpen
          onOpenChange={(open) => !open && setViewing(null)}
          // The live copy while it is still listed here; the one clicked once it has moved on.
          entry={[...mineRows, ...allRows].find((r) => r.entry.id === viewing.id)?.entry ?? viewing}
          projects={projectList}
          departments={departmentList}
          // The lists are live: whatever the dialog changes arrives through the listeners.
          onActionComplete={() => undefined}
          // This step's own buttons, for the person it is with — exactly those on its row.
          stepActions={
            (viewing.heldAssignees ?? []).includes(userId) && heldStep(placed, viewing)?.key === stepKeyValue
              ? {
                  ...(approval.forward ? { approve: { label: approval.forward, onClick: () => setVerifying([viewing]) } } : {}),
                  ...(approval.gstVerify ? { gstVerify: { label: 'Verify (GST & TDS)', onClick: () => setGstVerifying(viewing) } } : {}),
                  ...(canSendBack && approval.sendBack
                    ? { sendBack: { label: approval.sendBack, onClick: () => setTurningBack({ entry: viewing, kind: 'Sent back' }) } }
                    : {}),
                  ...(canReject && approval.reject
                    ? { reject: { label: approval.reject, onClick: () => setTurningBack({ entry: viewing, kind: 'Rejected' }) } }
                    : {}),
                  ...(canHandOver ? { handOver: { label: 'Hand over', onClick: () => setHandingOver(viewing) } } : {}),
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/* ── handing over, at any step marked for it ─────────────────────────────── */

interface HandOverDialogProps {
  steps: WorkflowStep[];
  /** The step handing over — its position in the workflow. */
  index: number;
  /** What to hand over. The dialog is open while this is set. */
  entries: Entry[] | null;
  /**
   * At a built-in stage: may hand over anything waiting there (`Hand Over` on the stage), not only
   * what was handed to them. A Verification step's holders always may.
   */
  canHandOverAny?: boolean;
  onClose: () => void;
}

/** Ready-made notes for whoever it is handed to; each adds to the note. */
const HAND_OVER_NOTES = ['Check GST split', 'Confirm TDS section', 'Match bill with PO', 'Verify party GSTIN', 'Urgent: site payment'];

/** A queue this much above the average, and at least this long, is marked Busy. */
const BUSY_FACTOR = 1.5;
const BUSY_MIN = 5;

const PERSON_COLOURS = ['#0f766e', '#7c3aed', '#ea580c', '#db2777', '#2563eb', '#15803d', '#b45309', '#0891b2'];
const personColour = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PERSON_COLOURS[Math.abs(hash) % PERSON_COLOURS.length];
};
const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * Hand requisitions to someone else. At a Verification step the chosen person becomes its only
 * holder and their verification counts for it — and, asked to, it then comes back to whoever handed
 * it over (`heldReturn`, src/lib/daily-requisition-flow.ts handBackOf); at a built-in stage the
 * requisition is assigned to them there, and they do the stage's work on it. Each requisition is
 * re-read and re-checked.
 *
 * The people offered are the step's hand-over list (anyone, without one), each with what is already
 * waiting with them and whether they also approve it later; the requisition's own deadline comes
 * from the step's turnaround in working hours (Settings › Working hours and holidays).
 */
export function HandOverDialog(props: HandOverDialogProps) {
  const { entries, onClose } = props;
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={entries !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      {entries && entries.length > 0 ? (
        <DialogContent
          windowControls={false}
          className={cn('max-w-[98vw] gap-0 p-0 sm:max-w-[560px]', BANNER_DIALOG_CLASS)}
          style={{ scrollbarGutter: 'auto' }}
        >
          {/* Keyed by what is handed over, so each opening starts clean. */}
          <HandOverForm key={entries.map((e) => e.id).join(',')} {...props} entries={entries} busy={busy} setBusy={setBusy} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function HandOverForm({
  steps,
  index,
  entries,
  canHandOverAny = false,
  onClose,
  busy,
  setBusy,
}: HandOverDialogProps & { entries: Entry[]; busy: boolean; setBusy: (busy: boolean) => void }) {
  const { user, users } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const names = useProjectAndDepartmentNames();
  const [handTo, setHandTo] = useState('');
  const [search, setSearch] = useState('');
  const [comment, setComment] = useState('');
  const [notify, setNotify] = useState(true);
  const [returnToMe, setReturnToMe] = useState(false);
  /** The people, with their job titles once read (people-directory-client). */
  const [titled, setTitled] = useState<typeof users | null>(null);
  /** What is already waiting with each of them; null until read, or when it could not be. */
  const [queue, setQueue] = useState<Map<string, number> | null>(null);
  const [now] = useState(() => new Date());

  const placed = useMemo(() => placeSteps(steps), [steps]);
  const self = placed[index];
  const step = self?.step;
  const userId = user?.id ?? '';
  const isVerification = self?.role === 'verification';
  const first = entries[0];
  const single = entries.length === 1;
  const candidates = useMemo(
    () => (step ? handOverCandidates(step, users, [userId]).filter((u) => (u as { status?: string }).status !== 'Inactive') : []),
    [step, users, userId],
  );

  // Job titles, for telling people apart.
  useEffect(() => {
    let active = true;
    withDesignations(candidates)
      .then((people) => active && setTitled(people))
      .catch(() => active && setTitled(candidates));
    return () => {
      active = false;
    };
  }, [candidates]);

  // Each person's queue: what is held by them at a Verification step, or handed to them at a stage.
  useEffect(() => {
    const ids = candidates.map((u) => u.id);
    if (ids.length === 0 || ids.length > 300) return;
    let active = true;
    const field = isVerification ? 'heldAssignees' : 'assignedTo';
    const groups: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) groups.push(ids.slice(i, i + 30));
    Promise.all(groups.map((group) => getDocs(query(collection(db, 'dailyRequisitions'), where(field, 'array-contains-any', group)))))
      .then((snaps) => {
        if (!active) return;
        const wanted = new Set(ids);
        const counts = new Map<string, number>();
        const seen = new Set<string>();
        for (const snap of snaps) {
          for (const d of snap.docs) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            const data = d.data() as DailyRequisitionEntry;
            if (data.status === 'Paid' || data.status === 'Cancelled') continue;
            if (isVerification ? !data.heldAt : !data.assignedStage) continue;
            for (const id of (isVerification ? data.heldAssignees : data.assignedTo) ?? []) {
              if (wanted.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
            }
          }
        }
        setQueue(counts);
      })
      // Not everyone may list the register; the people are offered without their queues.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [candidates, isVerification]);

  // The deadline at this step: its turnaround, in working hours, from when it arrived or was handed on.
  const since = single ? (isVerification ? first.heldSince : first.assignedSince) : null;
  const tat = Number(step?.tat) || 0;
  const deadline = useStepDeadline(since && typeof since.toDate === 'function' ? since.toDate() : null, tat);

  if (!step || !self) return null;

  const nameOf = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u?.name || u?.email || id;
  };
  const people = (titled ?? candidates).map((u) => {
    const [name, title = ''] = personOptionLabel(u, undefined, { separator: '\u0000' }).split('\u0000');
    return { id: u.id, name: name || u.email || u.id, title };
  });
  const term = search.trim().toLowerCase();
  const visible = term ? people.filter((p) => `${p.name} ${p.title}`.toLowerCase().includes(term)) : people;

  // The lightest queue, and the busy ones, among the people offered.
  const counts = queue ? people.map((p) => queue.get(p.id) ?? 0) : [];
  const average = counts.length ? counts.reduce((sum, n) => sum + n, 0) / counts.length : 0;
  const lightest = queue && people.length > 1 ? people.reduce((best, p) => ((queue.get(p.id) ?? 0) < (queue.get(best.id) ?? 0) ? p : best), people[0]).id : null;
  const isBusy = (id: string) => {
    const n = queue?.get(id) ?? 0;
    return n >= BUSY_MIN && n > average * BUSY_FACTOR;
  };

  /** A later approval step that also names this person for the requisition: they would check it twice. */
  const alsoApprovesAt = (id: string) =>
    placed.slice(index + 1).find((p) => p.role === 'verification' && p.segment !== null && resolveStepAssignees(p.step, first).includes(id))?.step.name ?? null;

  // Where it goes after them.
  const nextStepName = isVerification ? (stepAfterVerify(steps, index) ?? 'the next step') : null;
  const nextStep = nextStepName ? placed.find((p) => p.step.name === nextStepName) : null;
  const nextPerson = nextStep ? resolveStepAssignees(nextStep.step, first)[0] : undefined;
  const workRole = !isVerification ? stageOfStatus(first.status) : null;
  const stageVerb = workRole === 'receiving' ? 'receives' : workRole === 'gst' ? 'verifies' : 'works it';
  const afterStage = workRole === 'receiving' ? 'GST & TDS' : workRole === 'gst' ? PAYMENT_PAGE_NAME : 'the next step';

  const chosen = people.find((p) => p.id === handTo) ?? null;
  const chosenQueue = chosen && queue ? (queue.get(chosen.id) ?? 0) : null;
  const chosenAlso = chosen ? alsoApprovesAt(chosen.id) : null;
  const due = deadline ? dueText(deadline, now) : null;
  const amount = entries.reduce((sum, e) => sum + (Number(e.netAmount) || 0), 0);

  const addNote = (note: string) => setComment((current) => (current.trim() ? `${current.trim().replace(/\.$/, '')}. ${note}` : note));

  const submit = async () => {
    if (!user || !handTo || busy) return;
    setBusy(true);
    const handed: Entry[] = [];
    const refused: string[] = [];
    for (const row of entries) {
      try {
        const result = await runTransaction(db, async (tx) => {
          const ref = doc(db, 'dailyRequisitions', row.id);
          const snap = await tx.get(ref);
          if (!snap.exists()) return { ok: false as const, reason: 'it no longer exists' };
          const current = snap.data() as DailyRequisitionEntry;
          if (isPaymentLocked(current)) return { ok: false as const, reason: 'payments have been made against it' };
          const at = Timestamp.now();
          const placedNow = placeSteps(steps);
          let update: Record<string, unknown>;
          let from: string;
          if (self.role === 'verification') {
            if (heldStep(placedNow, current)?.key !== self.key) return { ok: false as const, reason: 'it has moved on' };
            if (!(current.heldAssignees ?? []).includes(user.id)) return { ok: false as const, reason: 'it is no longer with you' };
            update = {
              heldAssignees: [handTo],
              heldSince: at,
              // Back to me once they verify it: this hand-over's own moment, so no later one inherits it.
              heldReturn: returnToMe ? { stepKey: self.key, to: [user.id], since: at } : null,
            };
            from = (current.heldAssignees ?? []).map(nameOf).join(', ');
          } else {
            // The work of this stage its status is at (a stage may do several: its buttons decide).
            const role = stageOfStatus(current.status);
            if (!role || !self.roles.includes(role) || heldStep(placedNow, current)) {
              return { ok: false as const, reason: 'it is no longer at this stage' };
            }
            const assigned = assignedStageOf(placedNow, current);
            const mine = assigned?.index === self.index && (current.assignedTo ?? []).includes(user.id);
            if (!canHandOverAny && !mine) return { ok: false as const, reason: 'it is not with you' };
            update = { assignedStage: role, assignedTo: [handTo], assignedSince: at };
            from = assigned ? (current.assignedTo ?? []).map(nameOf).join(', ') : '';
          }
          const event = flowEvent({
            action: 'Handed over',
            stepKey: self.key,
            stepName: step.name,
            userId: user.id,
            userName: user.name || user.email || user.id,
            at,
            comment: [comment.trim(), isVerification && returnToMe ? 'to come back once verified' : ''].filter(Boolean).join(' — ') || undefined,
            toUserIds: [handTo],
            toUserNames: [nameOf(handTo)],
          });
          tx.update(ref, { ...update, flowTrail: [...(current.flowTrail ?? []), event] });
          return { ok: true as const, from };
        });
        if (result.ok) {
          handed.push(row);
          void log(
            'Hand Over Requisition',
            {
              step: step.name,
              receptionNo: row.receptionNo ?? null,
              partyName: row.partyName ?? null,
              ...(result.from ? { from: result.from } : {}),
              to: nameOf(handTo),
              ...(isVerification && returnToMe ? { comesBackTo: nameOf(user.id) } : {}),
              ...(entries.length > 1 ? { bulk: true, batchCount: entries.length } : {}),
              ...(comment.trim() ? { comment: comment.trim() } : {}),
            },
            { recordId: row.id, recordRef: row.receptionNo || undefined },
          );
        } else {
          refused.push(`${row.receptionNo || row.id}: ${result.reason}`);
        }
      } catch (error) {
        console.error('Error handing over requisition:', error);
        refused.push(`${row.receptionNo || row.id}: could not be saved`);
      }
    }

    // Told now, in the bell and on their phone; a failed notice never undoes the hand-over.
    let notified = false;
    if (notify && handed.length > 0) {
      const what = handed.length === 1 ? handed[0].receptionNo || 'A requisition' : `${handed.length} requisitions`;
      notified =
        (await dispatchNotification(
          { userIds: [handTo] },
          {
            type: 'record_assigned',
            title: `${what} handed to you`,
            body: `${user.name || user.email || 'Someone'} handed ${handed.length === 1 ? 'it' : 'them'} to you at ${step.name}.${comment.trim() ? ` Note: ${comment.trim()}` : ''}`,
            module: ACTIVITY_MODULES.DAILY_REQUISITION,
            itemId: handed[0].id,
            itemRef: handed[0].receptionNo || undefined,
            stepName: step.name,
            link: `/daily-requisition/${dailyStepSlug(step.name)}`,
          },
        )) > 0;
    }

    setBusy(false);
    const done = handed.length;
    toast({
      title: done === 0 ? 'Not handed over' : refused.length ? 'Partly handed over' : 'Handed over',
      description: [
        done
          ? `${done === 1 && single ? first.receptionNo : `${done} ${done === 1 ? 'requisition' : 'requisitions'}`} now with ${nameOf(handTo)}${notified ? ', who has been notified' : ''}.`
          : '',
        refused.length ? `Not handed over — ${refused.slice(0, 3).join('; ')}${refused.length > 3 ? ` and ${refused.length - 3} more` : ''}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      variant: done === 0 ? 'destructive' : undefined,
    });
    onClose();
  };

  const flowNode = (id: string | null, label: string) => (
    <span className="flex items-center gap-1.5">
      {id ? (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9.5px] font-extrabold text-white" style={{ background: personColour(id) }}>
          {initialsOf(nameOf(id))}
        </span>
      ) : null}
      {label}
    </span>
  );
  const arrow = <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── header ── */}
      <header className="keep-light relative flex shrink-0 items-center gap-3.5 overflow-hidden bg-gradient-to-r from-teal-700 via-blue-600 to-violet-600 py-4 pl-5 pr-14 text-white">
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(360px_180px_at_95%_0%,rgba(245,158,11,0.6),transparent_65%)]" aria-hidden />
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-white/20">
          <ArrowRightLeft className="h-[22px] w-[22px]" />
        </span>
        <div className="relative min-w-0">
          <p className="truncate text-[11.5px] font-bold uppercase tracking-[0.08em] text-white/75">{step.name} · Hand over</p>
          <DialogTitle className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-extrabold leading-tight text-white">
            Hand over
            <span className="rounded-lg bg-white/20 px-2 py-px font-mono text-[13.5px] font-bold">
              {single ? first.receptionNo : `${entries.length} requisitions`}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isVerification
              ? `The person you choose verifies ${single ? 'it' : 'them'} instead of you.`
              : `The person you choose does the "${step.name}" work on ${single ? 'it' : 'them'}.`}
          </DialogDescription>
        </div>
      </header>

      {/* ── body ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[14px] border bg-slate-50 px-3 py-2.5 text-[12.5px] text-muted-foreground">
          {single ? (
            <>
              <b className="text-foreground">{names?.projects.get(first.projectId) || 'N/A'}</b>
              <i className="h-[3px] w-[3px] rounded-full bg-slate-300" aria-hidden />
              <span className="min-w-0 truncate">{first.partyName}</span>
            </>
          ) : (
            <b className="text-foreground">{entries.length} requisitions</b>
          )}
          {due && (
            <>
              <i className="h-[3px] w-[3px] rounded-full bg-slate-300" aria-hidden />
              <b className={cn(due.late ? 'text-rose-700' : due.soon ? 'text-amber-700' : 'text-foreground')}>{due.text}</b>
            </>
          )}
          <span className="ml-auto text-[15px] font-extrabold tabular-nums text-foreground">{formatCurrency(amount)}</span>
        </div>

        <div className="mb-2 mt-4 flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold text-muted-foreground">
          Hand to
          <InfoTip label="About “Hand to”">
            {(step.handOverUserIds?.length ?? 0) > 0 ? 'People set for this step in Workflow Configuration' : 'Anyone in the company'}
          </InfoTip>
        </div>
        <label className="mb-2 flex items-center gap-2 rounded-[11px] border px-2.5 py-1.5 text-muted-foreground focus-within:border-violet-400">
          <Search className="h-4 w-4 shrink-0" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or role"
            aria-label="Search people"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
          />
        </label>
        <div className="flex max-h-[270px] flex-col gap-2 overflow-y-auto p-0.5" role="radiogroup" aria-label="Hand to">
          {visible.length === 0 ? (
            <p className="px-2 py-2.5 text-sm text-muted-foreground">{people.length === 0 ? 'There is no one to hand it to.' : 'No one matches.'}</p>
          ) : (
            visible.map((person) => {
              const on = person.id === handTo;
              const waiting = queue?.get(person.id) ?? 0;
              const also = alsoApprovesAt(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setHandTo(person.id)}
                  className={cn(
                    'grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition hover:border-violet-300',
                    on && 'border-violet-600 bg-violet-50 ring-[3px] ring-violet-100',
                  )}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full text-[13px] font-extrabold text-white" style={{ background: personColour(person.id) }}>
                    {initialsOf(person.name)}
                  </span>
                  <span className="min-w-0">
                    <b className="block truncate text-[13.5px] leading-tight">{person.name}</b>
                    {person.title && <small className="block truncate text-[11.5px] text-muted-foreground">{person.title}</small>}
                    {(queue || also) && (
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {lightest === person.id && waiting < average && <PersonChip tone="ok">Lightest queue</PersonChip>}
                        {isBusy(person.id) && <PersonChip tone="warn">Busy</PersonChip>}
                        {also && <PersonChip tone="violet">Also approves at {also}</PersonChip>}
                        {queue && <PersonChip tone="grey">{waiting} waiting</PersonChip>}
                      </span>
                    )}
                  </span>
                  <span className={cn('h-5 w-5 rounded-full border-2 border-slate-300', on && 'border-[6px] border-violet-600')} aria-hidden />
                </button>
              );
            })
          )}
        </div>

        {/* Where it goes: you, them, (back to you,) then on. */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2 rounded-[14px] bg-slate-50 px-3 py-2.5 text-xs font-semibold text-muted-foreground">
          {flowNode(userId, 'You')}
          {arrow}
          {chosen ? (
            flowNode(chosen.id, `${firstNameOf(chosen.name)} ${isVerification ? 'verifies' : stageVerb}`)
          ) : (
            <span className="rounded-full border bg-background px-2.5 py-0.5">Someone {isVerification ? 'verifies' : stageVerb}</span>
          )}
          {arrow}
          {isVerification && returnToMe && (
            <>
              {flowNode(userId, 'Back to you')}
              {arrow}
            </>
          )}
          <span className="rounded-full border bg-background px-2.5 py-0.5">
            {isVerification ? `${nextStepName}${nextPerson ? ` · ${nameOf(nextPerson)}` : ''}` : afterStage}
          </span>
        </div>

        <div className="mb-2 mt-4 flex items-center justify-between text-[11.5px] font-bold text-muted-foreground">
          <label htmlFor="handover-comment">Note for them</label>
          <small className="font-semibold">optional</small>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {HAND_OVER_NOTES.map((note) => (
            <button
              key={note}
              type="button"
              onClick={() => addNote(note)}
              className="rounded-full border border-dashed border-slate-300 bg-background px-2.5 py-0.5 text-xs font-semibold text-muted-foreground hover:border-violet-400 hover:text-violet-700"
            >
              + {note}
            </button>
          ))}
        </div>
        <Textarea
          id="handover-comment"
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="What they should check"
          className="min-h-[70px] resize-y rounded-xl"
        />
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2 text-[12.5px] font-semibold text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox checked={notify} onCheckedChange={(value) => setNotify(value === true)} />
            Notify them now
          </label>
          {isVerification && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox checked={returnToMe} onCheckedChange={(value) => setReturnToMe(value === true)} />
              Send it back to me after they verify
            </label>
          )}
        </div>
      </div>

      {/* ── footer ── */}
      <footer className="flex shrink-0 flex-wrap items-center gap-2.5 border-t px-4 py-3 sm:px-5">
        <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
          {chosen ? (
            <>
              <b className="text-foreground">{chosen.name}</b> gets {single ? 'it' : 'them'}
              {chosenQueue !== null ? (chosenQueue > 0 ? ` with ${chosenQueue} other${chosenQueue === 1 ? '' : 's'} in their queue` : ', with nothing else waiting') : ''}
              {chosenAlso && <span className="text-amber-700"> · they also approve at {chosenAlso}, so one person would check it twice</span>}
            </>
          ) : (
            'Choose a person to continue'
          )}
        </p>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          className="border-0 bg-gradient-to-r from-teal-700 via-blue-600 to-violet-600 text-white shadow-[0_10px_22px_-12px_#4f46e5] hover:opacity-95"
          onClick={() => void submit()}
          disabled={busy || !handTo}
        >
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-1.5 h-4 w-4" />}
          Hand over
        </Button>
      </footer>
    </div>
  );
}

function PersonChip({ tone, children }: { tone: 'ok' | 'warn' | 'violet' | 'grey'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-px text-[11px] font-bold',
        tone === 'ok' && 'bg-green-100 text-green-700',
        tone === 'warn' && 'bg-amber-100 text-amber-700',
        tone === 'violet' && 'bg-violet-100 text-violet-700',
        tone === 'grey' && 'bg-slate-100 text-slate-600',
      )}
    >
      {children}
    </span>
  );
}

/* ── a built-in stage, for the person a requisition was handed to ────────── */

interface StageAssignedViewProps {
  steps: WorkflowStep[];
  /** The built-in stage — its position in the workflow. */
  index: number;
  /** Shown instead when nothing at the stage is with this person (the stage's Access Denied). */
  fallback: ReactNode;
}

type StageMove = { to: DailyRequisitionEntry['status']; from: readonly string[]; label: string };

/** What the person a requisition was handed to may do with it at each stage (firestore.rules drAssigneeMayMove). */
const RECEIVE: StageMove = { to: 'Received', from: ['Pending'], label: 'Mark as Received' };
const SEND_FOR_PAYMENT: StageMove = { to: 'Received for Payment', from: ['Verified'], label: 'Send for Payment' };
const MARK_PAID: StageMove = { to: 'Paid', from: ['Received for Payment'], label: 'Mark as Paid' };

/**
 * A built-in stage for someone who holds none of its permissions but has requisitions handed to
 * them there: those requisitions, with the stage's own work — Mark as Received; Verify (the GST &
 * TDS dialog) and Send for Payment; Mark as Paid — and Hand over. Anything more stays with the
 * stage's own people.
 */
export function StageAssignedView({ steps, index, fallback }: StageAssignedViewProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const names = useProjectAndDepartmentNames();
  const userId = user?.id ?? '';

  const placed = useMemo(() => placeSteps(steps), [steps]);
  const self = placed[index];
  /** The built-in works this stage does (its buttons decide); a requisition is worked by the one its status is at. */
  const roles: readonly StageRole[] = self?.roles ?? [];

  const [docs, setDocs] = useState<QueryDocumentSnapshot[] | null>(null);
  const [verifyEntry, setVerifyEntry] = useState<Entry | null>(null);
  const [confirm, setConfirm] = useState<{ entry: Entry; move: StageMove } | null>(null);
  const [handingOver, setHandingOver] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(
      query(collection(db, 'dailyRequisitions'), where('assignedTo', 'array-contains', userId)),
      (snap) => setDocs(snap.docs),
      (error) => {
        console.error('Error loading requisitions handed to you:', error);
        setDocs([]);
      },
    );
  }, [userId]);

  const rows = useMemo(
    () =>
      (docs ?? [])
        .map((d) => ({ ...(d.data() as DailyRequisitionEntry), id: d.id }) as Entry)
        .filter((entry) => assignedStageOf(placed, entry)?.index === index && (entry.assignedTo ?? []).includes(userId))
        .sort((a, b) => (asDate(a.assignedSince)?.getTime() ?? 0) - (asDate(b.assignedSince)?.getTime() ?? 0)),
    [docs, placed, index, userId],
  );

  if (!self || roles.length === 0) return <>{fallback}</>;
  if (docs === null) {
    return (
      <div className={`${dailyPageContainerClass} flex justify-center py-16`}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (rows.length === 0) return <>{fallback}</>;

  const move = async (entry: Entry, stageMove: StageMove) => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await runTransaction(db, async (tx) => {
        const ref = doc(db, 'dailyRequisitions', entry.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) return { ok: false as const, reason: 'It no longer exists.' };
        const current = snap.data() as DailyRequisitionEntry;
        if (assignedStageOf(placeSteps(steps), current)?.index !== index || !(current.assignedTo ?? []).includes(user.id)) {
          return { ok: false as const, reason: 'It is no longer with you.' };
        }
        if (isPaymentLocked(current)) return { ok: false as const, reason: 'Payments have been made against it.' };
        if (!stageMove.from.includes(current.status ?? 'Pending')) {
          return { ok: false as const, reason: `It is now "${current.status || 'Pending'}".` };
        }
        const now = Timestamp.now();
        const stamps: Record<string, unknown> =
          stageMove.to === 'Received'
            ? { receivedAt: now, receivedById: user.id }
            : stageMove.to === 'Paid'
              ? { paidAt: now, paidAmount: Number(current.netAmount) || 0, manualPaid: true, paidById: user.id, paidByName: user.name ?? null }
              : {};
        tx.update(ref, { status: stageMove.to, ...stamps, ...holdForMove(steps, current, stageMove.to, now) });
        return { ok: true as const, from: current.status ?? '' };
      });
      if (result.ok) {
        void log(
          'Update Requisition Status',
          {
            step: self.step.name,
            receptionNo: entry.receptionNo ?? null,
            partyName: entry.partyName ?? null,
            from: result.from,
            to: stageMove.to,
            handedOverTo: true,
            ...(stageMove.to === 'Paid' ? { manualPaid: true } : {}),
          },
          { recordId: entry.id, recordRef: entry.receptionNo || undefined },
        );
        toast({ title: 'Done', description: `${entry.receptionNo} updated to "${stageMove.to}".` });
      } else {
        toast({ title: 'Not updated', description: result.reason, variant: 'destructive' });
      }
    } catch (error) {
      console.error('Error updating requisition:', error);
      toast({ title: 'Error', description: 'It could not be updated.', variant: 'destructive' });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const actionsFor = (entry: Entry) => {
    const status = entry.status ?? 'Pending';
    const buttons: ReactNode[] = [];
    const push = (key: string, node: ReactNode) => buttons.push(<span key={key}>{node}</span>);
    if (roles.includes('receiving') && RECEIVE.from.includes(status)) {
      push('receive', <Button size="sm" className="h-7" disabled={busy} onClick={() => setConfirm({ entry, move: RECEIVE })}>{RECEIVE.label}</Button>);
    }
    if (roles.includes('gst')) {
      if (status === 'Received' || status === 'Needs Review') {
        push('verify', <Button size="sm" className="h-7" disabled={busy} onClick={() => setVerifyEntry(entry)}>{status === 'Received' ? 'Verify' : 'Review & Verify'}</Button>);
      }
      if (status === 'Verified') {
        push('send', <Button size="sm" className="h-7" disabled={busy} onClick={() => setConfirm({ entry, move: SEND_FOR_PAYMENT })}>{SEND_FOR_PAYMENT.label}</Button>);
        push('reverify', <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => setVerifyEntry(entry)}>Re-verify</Button>);
      }
    }
    if (roles.includes('payment') && MARK_PAID.from.includes(status) && !isPaymentLocked(entry)) {
      push('paid', <Button size="sm" className="h-7" disabled={busy} onClick={() => setConfirm({ entry, move: MARK_PAID })}>{MARK_PAID.label}</Button>);
    }
    if (allowsHandOver(self.step)) {
      push('handover', (
        <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => setHandingOver(entry)}>
          <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Hand over
        </Button>
      ));
    }
    return buttons;
  };

  return (
    <>
      <div className={`${dailyPageContainerClass} space-y-3`}>
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="space-y-0 px-4 pb-3 pt-3 sm:px-5 sm:pt-4">
            <PageHeader
              backHref="/daily-requisition"
              breadcrumbs={[{ label: 'Daily Requisition', href: '/daily-requisition' }, { label: self.step.name }]}
              title={self.step.name}
              badge={
                <Badge variant="secondary" className="gap-1">
                  <UserRound className="h-3.5 w-3.5" /> Handed to you
                </Badge>
              }
              description={`${rows.length} ${rows.length === 1 ? 'requisition was' : 'requisitions were'} handed to you here. Do this stage's work on ${rows.length === 1 ? 'it' : 'them'}, or hand ${rows.length === 1 ? 'it' : 'them'} on.`}
            />
          </div>
        </section>

        <TableCard>
          <Table className="[--table-cell-py:0.375rem] [--table-head-h:2.25rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Reception No.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>With you for</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Party Name</TableHead>
                <TableHead className="text-right">Net Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((entry) => (
                <TableRow key={entry.id} className={STRIPED_ROW}>
                  <TableCell className="whitespace-nowrap font-medium">{entry.receptionNo}</TableCell>
                  <TableCell>
                    <StatusBadge status={entry.status} tone={DAILY_STATUS_TONE[entry.status]}>
                      {entry.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{waitedSince(entry.assignedSince)}</TableCell>
                  <TableCell>
                    <span className="block max-w-[200px] truncate">{names?.projects.get(entry.projectId) || 'N/A'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-[220px] truncate" title={entry.partyName}>
                      {entry.partyName}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(entry.netAmount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <div className="flex justify-end gap-1.5">{actionsFor(entry)}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </div>

      {roles.includes('gst') && (
        <GstTdsVerificationDialog
          isOpen={verifyEntry !== null}
          onOpenChange={(open) => !open && setVerifyEntry(null)}
          entry={verifyEntry}
          // Nothing to reload: the live list shows the verification as soon as it is saved.
          onSuccess={() => undefined}
          stepName={self?.step.name}
          path={{ done: 'Received', current: 'Verify', next: ['Send for payment', 'Payment'] }}
        />
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.move.label} — {confirm?.entry.receptionNo}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.move.to === 'Paid'
                ? 'Marked paid outside Bank Balance — no bank entry is made.'
                : `It moves to "${confirm?.move.to}" and leaves your hands.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (confirm) void move(confirm.entry, confirm.move);
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {confirm?.move.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <HandOverDialog steps={steps} index={index} entries={handingOver ? [handingOver] : null} onClose={() => setHandingOver(null)} />
    </>
  );
}


/**
 * What a requisition went through at Verification steps and early takes, oldest first — for the
 * requisition's own dialog.
 */
export function FlowTrail({ entry, steps }: { entry: DailyRequisitionEntry; steps: WorkflowStep[] }) {
  const { users } = useAuth();
  const placed = useMemo(() => placeSteps(steps), [steps]);
  const held = heldStep(placed, entry);
  const assigned = assignedStageOf(placed, entry);
  const trail = entry.flowTrail ?? [];
  if (!held && !assigned && trail.length === 0) return null;
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || id;

  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Verification</h3>
      {held && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Waiting at <b>{held.step.name}</b> for {(entry.heldAssignees ?? []).map(nameOf).join(', ') || 'no one'}
          {entry.heldSince ? <span className="text-sky-700">· {waitedSince(entry.heldSince)}</span> : null}
        </p>
      )}
      {assigned && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900">
          <UserRound className="h-4 w-4 shrink-0" />
          With {(entry.assignedTo ?? []).map(nameOf).join(', ')} at <b>{assigned.step.name}</b>
          {entry.assignedSince ? <span className="text-violet-700">· {waitedSince(entry.assignedSince)}</span> : null}
        </p>
      )}
      {trail.length > 0 && (
        <ol className="space-y-1.5 text-sm">
          {trail.map((event, i) => {
            const at = asDate(event.at);
            return (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
                <span className="min-w-0">
                  <b>{event.action}</b>{' '}
                  {event.action === 'Handed over'
                    ? `to ${(event.toUserNames ?? []).join(', ')} at ${event.stepName}`
                    : event.action === 'Taken early'
                      ? `into ${event.stepName} from ${event.fromStep ?? '—'}${event.skipped?.length ? ` (skipped ${event.skipped.join(', ')})` : ''}`
                      : event.action === 'Sent back'
                        ? `from ${event.stepName} to ${event.toStep ?? 'the step before'}`
                        : `at ${event.stepName}`}{' '}
                  <span className="text-muted-foreground">
                    by {event.userName}
                    {at ? ` · ${format(at, 'dd MMM yyyy, HH:mm')}` : ''}
                  </span>
                  {event.comment ? <span className="block whitespace-pre-wrap text-muted-foreground">“{event.comment}”</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
