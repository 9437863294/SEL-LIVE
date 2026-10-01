'use client';

/**
 * Add New Entry › Multiple: receive several expense requests (DEPs) at once.
 *
 * Tick the requests, pick one reception date, and each becomes its own requisition. They are
 * numbered in DEP order (src/lib/daily-requisition-receive.ts): a department's lowest serial takes
 * the first reception number of the block and its highest the last.
 *
 * One transaction does everything — re-reads every ticked request (so none received meanwhile is
 * received twice), takes a contiguous block from the serial counter, creates the requisitions, links
 * each request to its reception number and writes each requisition's "created" log — so the receipt
 * lands whole or not at all.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, runTransaction, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { AlertCircle, CalendarIcon, ListOrdered, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FORM_LABEL } from '@/components/expenses/statutory-section';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { formatInr } from '@/lib/bank-balance-ledger';
import { db } from '@/lib/firebase';
import { MAX_RECEIVE_AT_ONCE, orderForReception, planReception } from '@/lib/daily-requisition-receive';
import {
  dateKey,
  describeDateWindow,
  validateEntryValues,
  validateReceptionDate,
  type DailyRequisitionSettings,
  type DRDateWindow,
} from '@/lib/daily-requisition-settings';
import { requisitionStatutoryFields } from '@/lib/statutory';
import type { Department, ExpenseRequest, Project, SerialNumberConfig } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The GST & TDS fields a requisition inherits from its expense request — all but gross and net,
 * which the receiving form owns. The GST registration chosen on the request travels too, so the
 * bill is verified and reported against the same one it was raised under
 * (src/lib/gst-registrations.ts); left unset it is worked out from the project or department again.
 */
export function carriedStatutory(request: Pick<ExpenseRequest, 'statutory' | 'gstRegistrationId'>) {
  const chosen: { gstRegistrationId?: string } = request.gstRegistrationId ? { gstRegistrationId: request.gstRegistrationId } : {};
  if (!request.statutory) return chosen;
  const { grossAmount: _gross, netAmount: _net, ...rest } = requisitionStatutoryFields(request.statutory);
  return { ...chosen, ...rest };
}

/** Gross is the request's taxable value and net what is payable, when GST & TDS were captured on it. */
const grossOf = (req: ExpenseRequest) => Number(req.statutory?.taxableAmount ?? req.amount) || 0;
const netOf = (req: ExpenseRequest) => Number(req.statutory?.netPayable ?? req.amount) || 0;

const raisedOn = (value: string | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, 'dd MMM yyyy');
};

const BLOCKED = 'ReceiveBlocked';
const blocked = (message: string) => Object.assign(new Error(message), { name: BLOCKED });

export function ReceiveMultiplePanel({
  requests,
  projects,
  departments,
  settings,
  dateWindow,
  calendarDisabled,
  onCancel,
  onDone,
}: {
  /** Expense requests not yet received. */
  requests: ExpenseRequest[];
  projects: Project[];
  departments: Department[];
  settings: DailyRequisitionSettings;
  dateWindow: DRDateWindow;
  calendarDisabled?: Array<{ before: Date } | { after: Date }>;
  onCancel: () => void;
  /** After a save: refresh the sheet and close. `refreshOnly` when nothing was saved but the list is stale. */
  onDone: (refreshOnly?: boolean) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { log, entry: logEntry } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);

  const [receptionDate, setReceptionDate] = useState<Date>(() => new Date());
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<SerialNumberConfig | null>(null);
  const [showOrder, setShowOrder] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // The counter as it stands now, for the preview. The numbers are taken for real inside the save.
  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, 'serialNumberConfigs', 'daily-requisition'))
      .then((snap) => {
        if (!cancelled && snap.exists()) setConfig(snap.data() as SerialNumberConfig);
      })
      .catch((error) => console.error('Could not read the reception number series:', error));
    return () => {
      cancelled = true;
    };
  }, []);

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.projectName])), [projects]);
  const departmentName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  /** Why a request cannot be received as it stands (Field Control's required fields), or null. */
  const issueOf = useMemo(() => {
    const noWindow: DRDateWindow = { ...dateWindow, enforced: false, min: null, max: null };
    return (req: ExpenseRequest): string | null => {
      const errors = validateEntryValues(
        {
          depNo: req.requestNo,
          receptionDate: '',
          partyName: req.partyName ?? '',
          projectId: req.projectId ?? '',
          departmentId: req.departmentId ?? '',
          description: req.description ?? '',
          grossAmount: String(grossOf(req)),
          netAmount: String(netOf(req)),
        },
        settings,
        { mode: 'add', attachmentCount: 0, window: noWindow },
      );
      delete errors.receptionDate;
      if (errors.attachments) errors.attachments = 'Attachments are required — receive this one on its own';
      const messages = Object.values(errors).filter(Boolean);
      return messages.length ? messages.join(' · ') : null;
    };
  }, [settings, dateWindow]);

  const departmentsInList = useMemo(() => {
    const ids = [...new Set(requests.map((r) => r.departmentId).filter(Boolean))];
    return ids
      .map((id) => ({ id, name: departmentName.get(id) || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [requests, departmentName]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orderForReception(
      requests.filter((req) => {
        if (departmentFilter !== 'all' && req.departmentId !== departmentFilter) return false;
        if (!needle) return true;
        return [req.requestNo, req.partyName, req.description, projectName.get(req.projectId)]
          .some((value) => String(value ?? '').toLowerCase().includes(needle));
      }),
    );
  }, [requests, departmentFilter, search, projectName]);

  const chosen = useMemo(() => requests.filter((req) => selected.has(req.id)), [requests, selected]);
  const plan = useMemo(() => planReception(chosen, config ?? { startingIndex: 0 }), [chosen, config]);
  const totalNet = chosen.reduce((sum, req) => sum + netOf(req), 0);

  const dateCheck = validateReceptionDate(dateKey(receptionDate), dateWindow, 'Reception date');
  const windowHint = describeDateWindow(dateWindow);

  const selectable = visible.filter((req) => !issueOf(req));
  const allVisibleSelected = selectable.length > 0 && selectable.every((req) => selected.has(req.id));
  const someVisibleSelected = selectable.some((req) => selected.has(req.id));

  const toggle = (id: string, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) {
        if (next.size >= MAX_RECEIVE_AT_ONCE) return current;
        next.add(id);
      } else next.delete(id);
      return next;
    });
  };

  const toggleAllVisible = (on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const req of selectable) {
        if (on) {
          if (next.size >= MAX_RECEIVE_AT_ONCE) break;
          next.add(req.id);
        } else next.delete(req.id);
      }
      return next;
    });
  };

  const handleReceive = async () => {
    if (!user || chosen.length === 0 || !dateCheck.ok) return;
    const stillBad = chosen.find((req) => issueOf(req));
    if (stillBad) {
      toast({ title: 'Cannot receive', description: `${stillBad.requestNo}: ${issueOf(stillBad)}`, variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    const receptionKey = dateKey(receptionDate);
    try {
      const result = await runTransaction(db, async (tx) => {
        const configRef = doc(db, 'serialNumberConfigs', 'daily-requisition');
        const configSnap = await tx.get(configRef);
        if (!configSnap.exists()) {
          throw blocked('Daily Requisition has no serial number configuration. Set one under Settings first.');
        }
        // Every read before any write: the requests, to be sure none was received meanwhile.
        const requestSnaps = await Promise.all(chosen.map((req) => tx.get(doc(db, 'expenseRequests', req.id))));
        const taken = requestSnaps
          .map((snap, index) => ({ snap, req: chosen[index] }))
          .filter(({ snap }) => !snap.exists() || String(snap.data()?.receptionNo ?? '').trim());
        if (taken.length) {
          throw blocked(
            `${taken.map(({ req }) => req.requestNo).join(', ')} ${taken.length === 1 ? 'was' : 'were'} received by someone else meanwhile. The list has been refreshed — nothing was saved.`,
          );
        }

        const { items, nextIndex } = planReception(chosen, configSnap.data() as SerialNumberConfig);
        tx.update(configRef, { startingIndex: nextIndex });

        // One millisecond apart, so the register (newest first) keeps the block in its order.
        const createdBase = Date.now();
        items.forEach(({ request, receptionNo }, index) => {
          const entryRef = doc(collection(db, 'dailyRequisitions'));
          tx.set(entryRef, {
            receptionNo,
            depNo: request.requestNo,
            date: Timestamp.fromDate(receptionDate),
            projectId: request.projectId ?? '',
            departmentId: request.departmentId ?? '',
            description: request.description ?? '',
            partyName: request.partyName ?? '',
            grossAmount: grossOf(request),
            netAmount: netOf(request),
            createdAt: Timestamp.fromMillis(createdBase + index),
            status: 'Pending' as const,
            documentStatus: 'Pending' as const,
            attachments: [],
            // GST & TDS captured on the request travel with it, so verification starts filled in.
            ...carriedStatutory(request),
          });
          tx.update(doc(db, 'expenseRequests', request.id), { receptionNo, receptionDate: receptionKey });

          const created = logEntry(
            'Create Daily Requisition',
            {
              receptionNo,
              depNo: request.requestNo,
              partyName: request.partyName ?? '',
              amount: netOf(request),
              receivedTogether: items.length,
            },
            { recordId: entryRef.id, recordRef: receptionNo },
          );
          if (created) tx.set(doc(collection(db, 'userLogs')), created);
        });

        return items.map(({ request, receptionNo }) => ({ depNo: request.requestNo, receptionNo }));
      });

      void log('Receive Expense Requests', {
        count: result.length,
        receptionDate: receptionKey,
        firstReceptionNo: result[0]?.receptionNo ?? '',
        lastReceptionNo: result[result.length - 1]?.receptionNo ?? '',
        received: result.map((r) => `${r.depNo} → ${r.receptionNo}`),
      });

      toast({
        title: `${result.length} request${result.length === 1 ? '' : 's'} received`,
        description:
          result.length === 1
            ? `${result[0].depNo} → ${result[0].receptionNo}`
            : `${result[0].receptionNo} to ${result[result.length - 1].receptionNo}`,
      });
      setSelected(new Set());
      onDone();
    } catch (error) {
      if (error instanceof Error && error.name === BLOCKED) {
        toast({ title: 'Not received', description: error.message, variant: 'destructive' });
        setSelected(new Set());
        onDone(true);
      } else {
        console.error('Could not receive the expense requests:', error);
        toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Something went wrong.', variant: 'destructive' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const first = plan.items[0]?.receptionNo;
  const last = plan.items[plan.items.length - 1]?.receptionNo;

  return (
    <div className="space-y-3 border-t pt-4">
      {/* One date for the whole receipt, and what to pick from */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[11rem_13rem_minmax(0,1fr)]">
        <div className="min-w-0 space-y-1.5">
          <p className={FORM_LABEL}>Reception date</p>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn('h-9 w-full justify-start px-3 text-left font-normal', !dateCheck.ok && 'border-destructive')}>
                <CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />
                {format(receptionDate, 'dd MMM yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={receptionDate} onSelect={(date) => date && setReceptionDate(date)} disabled={calendarDisabled} initialFocus />
            </PopoverContent>
          </Popover>
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className={FORM_LABEL}>Department</p>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departmentsInList.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className={FORM_LABEL}>Find</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="DEP No, party, project or description" className="h-9 pl-8 text-sm" />
          </div>
        </div>
      </div>
      {!dateCheck.ok ? (
        <p className="text-[11px] font-medium text-destructive">{dateCheck.reason}</p>
      ) : windowHint ? (
        <p className="text-[11px] text-muted-foreground">{windowHint}</p>
      ) : null}

      {/* The requests, in the order they will be numbered */}
      <div className="max-h-[46vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500">
            <tr className="border-b">
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                  disabled={selectable.length === 0}
                  aria-label="Select all listed requests"
                />
              </th>
              <th className="px-2 py-2 font-medium">DEP No</th>
              <th className="px-2 py-2 font-medium">Raised</th>
              <th className="px-2 py-2 font-medium">Department</th>
              <th className="px-2 py-2 font-medium">Party</th>
              <th className="px-2 py-2 font-medium">Project</th>
              <th className="px-3 py-2 text-right font-medium">Net payable</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {requests.length === 0 ? 'Every expense request has been received.' : 'No request matches.'}
                </td>
              </tr>
            ) : (
              visible.map((req) => {
                const issue = issueOf(req);
                const isOn = selected.has(req.id);
                const position = isOn ? plan.items.findIndex((item) => item.request.id === req.id) : -1;
                return (
                  <tr
                    key={req.id}
                    className={cn('border-b last:border-b-0', issue ? 'bg-slate-50/60 text-muted-foreground' : 'cursor-pointer hover:bg-slate-50', isOn && 'bg-emerald-50/60 hover:bg-emerald-50')}
                    onClick={(event) => {
                      if (issue || (event.target as HTMLElement).closest('button, [role="checkbox"]')) return;
                      toggle(req.id, !isOn);
                    }}
                  >
                    <td className="px-3 py-2 align-top">
                      <Checkbox checked={isOn} disabled={Boolean(issue)} onCheckedChange={(checked) => toggle(req.id, checked === true)} aria-label={`Select ${req.requestNo}`} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 align-top">
                      <span className="font-mono text-xs font-medium text-slate-800">{req.requestNo}</span>
                      {position >= 0 && config && (
                        <span className="mt-0.5 block font-mono text-[11px] text-emerald-700">→ {plan.items[position].receptionNo}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 align-top text-xs">{raisedOn(req.createdAt)}</td>
                    <td className="px-2 py-2 align-top text-xs">{departmentName.get(req.departmentId) || '—'}</td>
                    <td className="max-w-[14rem] px-2 py-2 align-top">
                      <span className="block truncate" title={req.partyName}>
                        {req.partyName || '—'}
                      </span>
                      {issue && (
                        <span className="mt-0.5 flex items-start gap-1 text-[11px] font-medium text-amber-700">
                          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                          {issue}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-2 align-top text-xs" title={projectName.get(req.projectId)}>
                      {projectName.get(req.projectId) || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right align-top tabular-nums">{formatInr(netOf(req))}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* What will be created */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm">
        {chosen.length === 0 ? (
          <span className="text-muted-foreground">Tick the requests to receive. They are numbered in DEP order — the lowest serial takes the first reception number.</span>
        ) : (
          <>
            <span>
              <span className="font-semibold">{chosen.length}</span> selected
              {chosen.length >= MAX_RECEIVE_AT_ONCE && <span className="text-amber-700"> (most at once)</span>}
            </span>
            <span className="tabular-nums">
              Net <span className="font-semibold">{formatInr(totalNet)}</span>
            </span>
            {config && first && (
              <span className="font-mono text-xs text-emerald-800">
                {first}
                {last && last !== first ? ` → ${last}` : ''}
              </span>
            )}
            <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-800 hover:underline" onClick={() => setShowOrder((v) => !v)}>
              <ListOrdered className="h-3.5 w-3.5" />
              {showOrder ? 'Hide order' : 'Show order'}
            </button>
          </>
        )}
      </div>
      {showOrder && chosen.length > 0 && (
        <ol className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg border bg-white px-3 py-2 text-xs sm:grid-cols-2">
          {plan.items.map((item, index) => (
            <li key={item.request.id} className="flex items-center justify-between gap-3 font-mono">
              <span className="text-slate-500">
                {index + 1}. {item.request.requestNo}
              </span>
              <span className="font-medium text-slate-800">{config ? item.receptionNo : '…'}</span>
            </li>
          ))}
        </ol>
      )}
      {config && chosen.length > 0 && (
        <p className="text-[11px] text-muted-foreground">Reception numbers are confirmed when you save — if someone adds an entry first, the block moves up by one.</p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void handleReceive()} disabled={isSaving || chosen.length === 0 || !dateCheck.ok}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Receive {chosen.length > 0 ? `${chosen.length} request${chosen.length === 1 ? '' : 's'}` : 'requests'}
        </Button>
      </div>
    </div>
  );
}
