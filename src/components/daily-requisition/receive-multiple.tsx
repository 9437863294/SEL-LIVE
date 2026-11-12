'use client';

/**
 * Add New Entry › Multiple: receive several expense requests (DEPs) at once.
 *
 * Tick the requests, pick one reception date, and each becomes its own requisition, carrying the
 * request's GST & TDS and bank details. They are
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
import { AlertCircle, CalendarIcon, Check, ListOrdered, Loader2, Search } from 'lucide-react';

import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KeyHint, ef } from '@/components/daily-requisition/entry-form-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { formatInr } from '@/lib/bank-balance-ledger';
import { db } from '@/lib/firebase';
import { MAX_RECEIVE_AT_ONCE, orderForReception, planReception } from '@/lib/daily-requisition-receive';
import { holdForCreate } from '@/lib/daily-requisition-flow';
import { readDailyRequisitionWorkflowSteps } from '@/components/daily-requisition/nav';
import {
  dateKey,
  describeDateWindow,
  validateEntryValues,
  validateReceptionDate,
  type DailyRequisitionSettings,
  type DRDateWindow,
} from '@/lib/daily-requisition-settings';
import { requisitionStatutoryFields } from '@/lib/statutory';
import { storedBankOf } from '@/lib/expenses-bank';
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
  // Only the fields the request actually carries. A request saved before one of these existed has
  // no value for it, and Firestore rejects the whole write for a single `undefined` — which would
  // fail the receipt rather than carry one field less.
  return { ...chosen, ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) };
}

/**
 * The bank account a requisition inherits from its expense request (src/lib/expenses-bank.ts), so
 * GST & TDS verification checks it beside the bill. Nothing when the request carries none.
 */
export function carriedBankDetails(request: { bankDetails?: unknown } | null | undefined) {
  const bankDetails = storedBankOf(request?.bankDetails);
  return bankDetails ? { bankDetails } : {};
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
  onPreview,
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
  /** The reception numbers the ticked requests will take ("…/0070 – 0072"), or null with none ticked. */
  onPreview?: (range: string | null) => void;
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
      // Verification steps before Finance: each starts at the first that names someone for it.
      const workflowSteps = await readDailyRequisitionWorkflowSteps();
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

        // The requests as they stand now, for what each carries — not as the list loaded them.
        const freshById = new Map(requestSnaps.map((snap, index) => [chosen[index].id, snap.data()]));

        const { items, update } = planReception(chosen, configSnap.data() as SerialNumberConfig);
        // The counter, and the financial year it numbered in when it restarts each year.
        tx.update(configRef, update);

        // One millisecond apart, so the register (newest first) keeps the block in its order.
        const createdBase = Date.now();
        items.forEach(({ request, receptionNo }, index) => {
          const entryRef = doc(collection(db, 'dailyRequisitions'));
          const entry = {
            receptionNo,
            // Every other field here is defaulted, and Firestore rejects the whole write for one
            // `undefined` — a request with no Request No must not fail the rest of the receipt.
            depNo: request.requestNo ?? '',
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
            // …and so does the account it is paid into, for verification to check.
            ...carriedBankDetails(freshById.get(request.id) ?? request),
          };
          tx.set(entryRef, { ...entry, ...holdForCreate(workflowSteps, entry, Timestamp.now()) });
          tx.update(doc(db, 'expenseRequests', request.id), { receptionNo, receptionDate: receptionKey });

          const created = logEntry(
            'Create Daily Requisition',
            {
              receptionNo,
              depNo: request.requestNo ?? '',
              partyName: request.partyName ?? '',
              amount: netOf(request),
              receivedTogether: items.length,
            },
            { recordId: entryRef.id, recordRef: receptionNo },
          );
          if (created) tx.set(doc(collection(db, 'userLogs')), created);
        });

        return items.map(({ request, receptionNo }) => ({ depNo: request.requestNo ?? '', receptionNo }));
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

  // The block the ticked requests will take, for the reception number in the dialog's header bar:
  // "SEL/REC/2026-27/0070 – 0072" (the last one's serial only, as the rest is the same).
  const range = config && first ? (last && last !== first ? `${first} – ${last.split('/').pop()}` : first) : null;
  useEffect(() => {
    onPreview?.(range);
  }, [range, onPreview]);
  // Nothing ticked once the panel goes: the header then shows the next single number again.
  useEffect(() => () => onPreview?.(null), [onPreview]);

  const canReceive = !isSaving && chosen.length > 0 && dateCheck.ok;

  return (
    <div
      className={ef.pane}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          if (canReceive) void handleReceive();
        }
      }}
    >
      <div className={ef.body}>
        {/* What to pick from, and one reception date for the whole receipt */}
        <div className={ef.tools}>
          <div className={ef.toolSearch}>
            <Search aria-hidden="true" />
            <input
              className={ef.ctl}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pending expense requests…"
              aria-label="Search pending expense requests by DEP No, party, project or description"
              autoComplete="off"
            />
          </div>
          <div className={ef.toolDept}>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className={ef.ctl} aria-label="Department">
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
          <div className={ef.toolDate}>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={ef.ctl}
                  aria-invalid={!dateCheck.ok || undefined}
                  aria-label={`Reception date for every entry: ${format(receptionDate, 'dd MMM yyyy')}`}
                  title="Reception date for every entry"
                >
                  <CalendarIcon className={ef.ctlIcon} aria-hidden="true" />
                  <span>{format(receptionDate, 'dd MMM yyyy')}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="single" selected={receptionDate} onSelect={(date) => date && setReceptionDate(date)} disabled={calendarDisabled} initialFocus />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {!dateCheck.ok ? (
          <p className={cn(ef.err, 'mt-1.5')}>{dateCheck.reason}</p>
        ) : windowHint ? (
          <p className={cn(ef.help, 'mt-1.5')}>{windowHint}</p>
        ) : null}

        {/* The requests, in the order they will be numbered */}
        <div className={ef.tableWrap}>
          <table className={ef.mt}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <Checkbox
                    checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                    disabled={selectable.length === 0}
                    aria-label="Select all listed requests"
                  />
                </th>
                <th>DEP No.</th>
                <th>Party</th>
                <th>Project</th>
                <th>Dept.</th>
                <th>Raised</th>
                <th className={ef.r}>Net payable</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className={ef.emptyRow}>
                    {requests.length === 0 ? 'Every expense request has been received.' : 'No pending expense request matches.'}
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
                      className={cn(issue ? ef.rowOff : ef.rowPick, isOn && ef.rowOn)}
                      onClick={(event) => {
                        if (issue || (event.target as HTMLElement).closest('button, [role="checkbox"]')) return;
                        toggle(req.id, !isOn);
                      }}
                    >
                      <td>
                        <Checkbox
                          checked={isOn}
                          disabled={Boolean(issue)}
                          onCheckedChange={(checked) => toggle(req.id, checked === true)}
                          aria-label={`Select ${req.requestNo}`}
                        />
                      </td>
                      <td>
                        <span className={ef.depNo}>{req.requestNo}</span>
                        {position >= 0 && config && <span className={ef.depNext}>→ {plan.items[position].receptionNo}</span>}
                      </td>
                      <td style={{ maxWidth: '16rem' }}>
                        <span className={ef.who} title={req.partyName}>
                          {req.partyName || '—'}
                        </span>
                        {req.description ? (
                          <span className={ef.whoNote} title={req.description}>
                            {req.description}
                          </span>
                        ) : null}
                        {issue && (
                          <span className={ef.issue}>
                            <AlertCircle aria-hidden="true" />
                            {issue}
                          </span>
                        )}
                      </td>
                      <td style={{ maxWidth: '12rem' }}>
                        <span className={ef.whoNote} title={projectName.get(req.projectId)}>
                          {projectName.get(req.projectId) || '—'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-xs">{departmentName.get(req.departmentId) || '—'}</td>
                      <td className="whitespace-nowrap text-xs">{raisedOn(req.createdAt)}</td>
                      <td className={cn(ef.r, ef.amt)}>{formatInr(netOf(req))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {visible.length > 0 ? (
              <tfoot>
                <tr>
                  <td />
                  <td colSpan={5}>
                    {chosen.length === 0 ? (
                      <span className="font-medium text-muted-foreground">Tick the requests to receive — they are numbered in DEP order.</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>
                          {chosen.length} selected
                          {chosen.length >= MAX_RECEIVE_AT_ONCE && <span className="font-medium text-amber-700"> (most at once)</span>}
                        </span>
                        <button type="button" className={ef.linkBtn} onClick={() => setShowOrder((v) => !v)}>
                          <ListOrdered aria-hidden="true" />
                          {showOrder ? 'Hide order' : 'Show order'}
                        </button>
                      </span>
                    )}
                  </td>
                  <td className={cn(ef.r, ef.amt)}>{formatInr(totalNet)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        {showOrder && chosen.length > 0 && (
          <ol className={ef.order}>
            {plan.items.map((item, index) => (
              <li key={item.request.id}>
                <span>
                  {index + 1}. {item.request.requestNo}
                </span>
                <span>{config ? item.receptionNo : '…'}</span>
              </li>
            ))}
          </ol>
        )}
        {config && chosen.length > 0 && (
          <p className={cn(ef.help, 'mt-2')}>Reception numbers are confirmed when you save — if someone adds an entry first, the block moves up by one.</p>
        )}
      </div>

      <div className={ef.foot}>
        <KeyHint />
        <span className={ef.footSpacer} />
        <button type="button" className={ef.btn} onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
        <button type="button" className={cn(ef.btn, ef.btnPrimary)} onClick={() => void handleReceive()} disabled={!canReceive}>
          {isSaving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          {chosen.length > 0 ? `Add ${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'}` : 'Add entries'}
        </button>
      </div>
    </div>
  );
}
