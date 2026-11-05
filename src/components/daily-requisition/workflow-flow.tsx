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
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ArrowRightLeft, ChevronDown, FastForward, Loader2, ShieldCheck, TriangleAlert, UserRound } from 'lucide-react';

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
import { TableCard } from '@/components/shared/table-card';
import { dailyPageContainerClass, dailySurfaceCardClass, DAILY_STATUS_TONE } from '@/components/daily-requisition/module-shell';
import { GstTdsVerificationDialog } from '@/components/daily-requisition/GstTdsVerificationDialog';
import { StatusBadge } from '@/components/shared/status-badge';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { personOptionLabel } from '@/lib/people-directory';
import { isPaymentLocked } from '@/lib/requisition-progress';
import {
  allowsHandOver,
  assignedStageOf,
  handOverCandidates,
  heldStep,
  holdForMove,
  stageOfStatus,
  type StageRole,
  holdAfterVerify,
  placeSteps,
  planTake,
  positionOf,
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
  const [handingOver, setHandingOver] = useState<Entry | null>(null);
  /** The requisition whose details are open. */
  const [viewing, setViewing] = useState<Entry | null>(null);
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

  /** Verify each, one transaction apiece: passed to the segment's next Verification step, or released to the stage after. */
  const verify = async (targets: Entry[]) => {
    if (!user || targets.length === 0) return;
    setBusy(true);
    let done = 0;
    const refused: string[] = [];
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
          const event = flowEvent({
            action: 'Verified',
            stepKey: stepKeyValue,
            stepName: step.name,
            userId: user.id,
            userName: user.name || user.email || user.id,
            at: now,
            comment: comment.trim() || undefined,
          });
          tx.update(ref, { ...next, flowTrail: [...(current.flowTrail ?? []), event] });
          const nextStep = next.heldAt ? placeSteps(steps).find((p) => p.key === next.heldAt)?.step.name : null;
          return { ok: true as const, nextStep: nextStep ?? nextName };
        });
        if (result.ok) {
          done += 1;
          void log(
            'Verify Requisition',
            {
              step: step.name,
              receptionNo: row.receptionNo ?? null,
              partyName: row.partyName ?? null,
              sentTo: result.nextStep,
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
        done ? `${done} ${done === 1 ? 'requisition' : 'requisitions'} verified and sent on.` : '',
        refused.length ? `Not verified — ${refused.slice(0, 3).join('; ')}${refused.length > 3 ? ` and ${refused.length - 3} more` : ''}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      variant: done === 0 ? 'destructive' : undefined,
    });
  };

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
            {visibleMine.length > 0 && (
              <Button size="sm" className="ml-auto" disabled={ticked.length === 0 || busy} onClick={() => setVerifying(ticked)}>
                <ShieldCheck className="mr-1.5 h-4 w-4" /> Verify selected{ticked.length ? ` (${ticked.length})` : ''}
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
                                  <Button size="sm" className="h-7" disabled={busy} onClick={() => setVerifying([entry])}>
                                    Verify
                                  </Button>
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
              Verify {verifying?.length ?? 0} {verifying?.length === 1 ? 'requisition' : 'requisitions'}?
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
              Verify
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <HandOverDialog steps={steps} index={index} entries={handingOver ? [handingOver] : null} onClose={() => setHandingOver(null)} />

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

/**
 * Hand requisitions to someone else. At a Verification step the chosen person becomes its only
 * holder and their verification counts for it; at a built-in stage the requisition is assigned to
 * them there, and they do the stage's work on it. Each requisition is re-read and re-checked.
 */
export function HandOverDialog({ steps, index, entries, canHandOverAny = false, onClose }: HandOverDialogProps) {
  const { user, users } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const [handTo, setHandTo] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const placed = useMemo(() => placeSteps(steps), [steps]);
  const self = placed[index];
  const step = self?.step;
  const userId = user?.id ?? '';
  const candidates = step ? handOverCandidates(step, users, [userId]) : [];
  const nameOf = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u?.name || u?.email || id;
  };

  const close = () => {
    setHandTo('');
    setComment('');
    onClose();
  };

  const submit = async () => {
    if (!user || !self || !step || !entries?.length || !handTo) return;
    setBusy(true);
    let done = 0;
    const refused: string[] = [];
    for (const row of entries) {
      try {
        const result = await runTransaction(db, async (tx) => {
          const ref = doc(db, 'dailyRequisitions', row.id);
          const snap = await tx.get(ref);
          if (!snap.exists()) return { ok: false as const, reason: 'it no longer exists' };
          const current = snap.data() as DailyRequisitionEntry;
          if (isPaymentLocked(current)) return { ok: false as const, reason: 'payments have been made against it' };
          const now = Timestamp.now();
          const placedNow = placeSteps(steps);
          let update: Record<string, unknown>;
          let from: string;
          if (self.role === 'verification') {
            if (heldStep(placedNow, current)?.key !== self.key) return { ok: false as const, reason: 'it has moved on' };
            if (!(current.heldAssignees ?? []).includes(user.id)) return { ok: false as const, reason: 'it is no longer with you' };
            update = { heldAssignees: [handTo], heldSince: now };
            from = (current.heldAssignees ?? []).map(nameOf).join(', ');
          } else {
            const role = self.role as StageRole;
            if (stageOfStatus(current.status) !== role || heldStep(placedNow, current)) {
              return { ok: false as const, reason: 'it is no longer at this stage' };
            }
            const assigned = assignedStageOf(placedNow, current);
            const mine = assigned?.role === role && (current.assignedTo ?? []).includes(user.id);
            if (!canHandOverAny && !mine) return { ok: false as const, reason: 'it is not with you' };
            update = { assignedStage: role, assignedTo: [handTo], assignedSince: now };
            from = assigned ? (current.assignedTo ?? []).map(nameOf).join(', ') : '';
          }
          const event = flowEvent({
            action: 'Handed over',
            stepKey: self.key,
            stepName: step.name,
            userId: user.id,
            userName: user.name || user.email || user.id,
            at: now,
            comment: comment.trim() || undefined,
            toUserIds: [handTo],
            toUserNames: [nameOf(handTo)],
          });
          tx.update(ref, { ...update, flowTrail: [...(current.flowTrail ?? []), event] });
          return { ok: true as const, from };
        });
        if (result.ok) {
          done += 1;
          void log(
            'Hand Over Requisition',
            {
              step: step.name,
              receptionNo: row.receptionNo ?? null,
              partyName: row.partyName ?? null,
              ...(result.from ? { from: result.from } : {}),
              to: nameOf(handTo),
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
    setBusy(false);
    toast({
      title: done === 0 ? 'Not handed over' : refused.length ? 'Partly handed over' : 'Handed over',
      description: [
        done
          ? `${done === 1 && entries.length === 1 ? entries[0].receptionNo : `${done} ${done === 1 ? 'requisition' : 'requisitions'}`} now with ${nameOf(handTo)}.`
          : '',
        refused.length ? `Not handed over — ${refused.slice(0, 3).join('; ')}${refused.length > 3 ? ` and ${refused.length - 3} more` : ''}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      variant: done === 0 ? 'destructive' : undefined,
    });
    close();
  };

  if (!step) return null;
  const isVerification = self?.role === 'verification';
  const count = entries?.length ?? 0;

  return (
    <Dialog open={entries !== null} onOpenChange={(o) => !o && !busy && close()}>
      {/* DialogContent is a plain column: gap-4 keeps the header, fields and buttons apart. */}
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hand over {count === 1 ? entries?.[0]?.receptionNo : `${count} requisitions`}</DialogTitle>
          <DialogDescription>
            {isVerification
              ? `The person you choose verifies ${count === 1 ? 'it' : 'them'} instead of you. Once verified, ${count === 1 ? 'it goes' : 'they go'} on to ${stepAfterVerify(steps, index) ?? 'the next step'}.`
              : `The person you choose does the "${step.name}" work on ${count === 1 ? 'it' : 'them'}. Everyone here still sees ${count === 1 ? 'it' : 'them'}, marked as with that person.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Hand to</Label>
            <Select value={handTo} onValueChange={setHandTo}>
              <SelectTrigger>
                <SelectValue placeholder={candidates.length ? 'Choose a person' : 'No one to choose from'} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {personOptionLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(step.handOverUserIds?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">Only the people set for this step in Workflow Configuration.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover-comment">Note (optional)</Label>
            <Textarea
              id="handover-comment"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What they should check"
              className="resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !handTo}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
            Hand over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const role = self?.role;

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

  if (!self || (role !== 'receiving' && role !== 'gst' && role !== 'payment')) return <>{fallback}</>;
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
    if (role === 'receiving' && RECEIVE.from.includes(status)) {
      push('receive', <Button size="sm" className="h-7" disabled={busy} onClick={() => setConfirm({ entry, move: RECEIVE })}>{RECEIVE.label}</Button>);
    }
    if (role === 'gst') {
      if (status === 'Received' || status === 'Needs Review') {
        push('verify', <Button size="sm" className="h-7" disabled={busy} onClick={() => setVerifyEntry(entry)}>{status === 'Received' ? 'Verify' : 'Review & Verify'}</Button>);
      }
      if (status === 'Verified') {
        push('send', <Button size="sm" className="h-7" disabled={busy} onClick={() => setConfirm({ entry, move: SEND_FOR_PAYMENT })}>{SEND_FOR_PAYMENT.label}</Button>);
        push('reverify', <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => setVerifyEntry(entry)}>Re-verify</Button>);
      }
    }
    if (role === 'payment' && MARK_PAID.from.includes(status) && !isPaymentLocked(entry)) {
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

      {role === 'gst' && (
        <GstTdsVerificationDialog
          isOpen={verifyEntry !== null}
          onOpenChange={(open) => !open && setVerifyEntry(null)}
          entry={verifyEntry}
          // Nothing to reload: the live list shows the verification as soon as it is saved.
          onSuccess={() => undefined}
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
