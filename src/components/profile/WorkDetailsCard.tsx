'use client';

/**
 * "Work details" on the Profile page — the signed-in person's own HR facts, read-only.
 *
 * ── Where every value comes from ────────────────────────────────────────────────────────────────
 *
 *   users/{uid}.employeeId / employeeNo / greytHR   the link itself (`src/lib/greythr-linking.ts`)
 *   loadEmployeeFactsIndex()                         the session-cached roster + mirror index every
 *                                                    person picker already uses. AuthProvider loads
 *                                                    it at sign-in, so reading it here is free.
 *   resolveDesignation(user, index)                  designation, department, location, employee
 *                                                    code — the same join `withDesignations` /
 *                                                    `attachDesignations` apply app-wide.
 *   employees/{id}                                   ONE read of the linked mirror document, for what
 *                                                    the roster snapshot does not carry: reporting
 *                                                    manager (org tree), last sync time.
 *
 * Both `employees` and `greythrCurrentRoster` are `get, list: if signedIn()`, so nothing here needs a
 * new rule. `employeeSensitive` (identity numbers, bank, addresses) is never read, and the salary
 * fields some legacy mirror documents carry are never picked.
 *
 * Nothing is editable: greytHR is the system of record, and linking is an administrator's job on
 * the linking console — so the unlinked state explains who to ask rather than offering a button.
 */

import { useEffect, useId, useState, type ReactNode } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import {
  Briefcase,
  CircleCheck,
  CircleX,
  Clock,
  Eye,
  Info,
  Link2,
  Link2Off,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { formatGrantDate } from '@/lib/access-control';
import { linkMethodLabel, type LinkMethod } from '@/lib/greythr-linking';
import {
  employeeFactsFor,
  resolveDesignation,
  type EmployeeFactsIndex,
} from '@/lib/people-directory';
import { loadEmployeeFactsIndex } from '@/lib/people-directory-client';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------------------------------------
 * Loading
 * ---------------------------------------------------------------------------------------------- */

/** A document as Firestore returned it. Only named, non-sensitive keys are ever read out of it. */
type WorkRecord = Record<string, unknown>;

interface WorkLink {
  employeeId: string;
  employeeNo: string;
  email: string;
}

interface WorkLoad {
  /** The request this answers — a stale answer for another account or attempt is ignored. */
  key: string;
  status: 'ready' | 'error';
  index: EmployeeFactsIndex | null;
  /** The index row (roster first, mirror second) — see `buildEmployeeFactsIndex`. */
  facts: WorkRecord | null;
  /** The `employees` mirror document, which alone carries the org-tree detail. */
  record: WorkRecord | null;
}

const EMPLOYEES = 'employees';

const text = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

/**
 * The linked `employees` document.
 *
 * Usually one `getDoc`: the sync keys mirror documents by greytHR's numeric id, which is both what
 * the roster row's id is and what `users.employeeId` normally holds. Older records were created
 * under a random id with the code in a field, hence the single `employeeNo` query as a last resort.
 */
async function readLinkedEmployee(link: WorkLink, facts: WorkRecord | null): Promise<WorkRecord | null> {
  const ids = [...new Set([text(facts?.id), link.employeeId].filter(Boolean))];
  for (const id of ids) {
    const snapshot = await getDoc(doc(db, EMPLOYEES, id));
    if (snapshot.exists()) return { id: snapshot.id, ...snapshot.data() };
  }
  const code = link.employeeNo || text(facts?.employeeNo);
  if (!code) return null;
  const matches = await getDocs(query(collection(db, EMPLOYEES), where('employeeNo', '==', code), limit(1)));
  const first = matches.docs[0];
  return first ? { id: first.id, ...first.data() } : null;
}

async function loadWorkDetails(link: WorkLink): Promise<Omit<WorkLoad, 'key' | 'status'>> {
  // Cached for the session and de-duplicated; never throws — an unreadable index comes back empty
  // with `loaded: false`.
  const index = await loadEmployeeFactsIndex();
  // The index holds whole documents typed as the few fields it indexes on; read them as records.
  const facts = (employeeFactsFor(link, index) as unknown as WorkRecord | null) ?? null;

  let record: WorkRecord | null = null;
  try {
    record = await readLinkedEmployee(link, facts);
  } catch (error) {
    // With the index in hand the card can still show the essentials; without either, it is an error.
    if (!index.loaded) throw error;
    console.warn('[profile] Linked employee record unreadable; showing the directory facts only', error);
  }
  return { index: index.loaded ? index : null, facts, record };
}

/* ------------------------------------------------------------------------------------------------
 * Presentation helpers
 * ---------------------------------------------------------------------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2021-03-15` → `15-Mar-2021`, the format the access screens use.
 *
 * Calendar dates are read by their parts rather than through `Date`, so a joining date can never
 * shift a day in a timezone west of UTC. Timestamps fall through to `formatGrantDate`.
 */
function formatHrDate(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (parts) {
    const month = MONTHS[Number(parts[2]) - 1];
    if (month) return `${parts[3]}-${month}-${parts[1]}`;
  }
  const formatted = formatGrantDate(value);
  return formatted === '—' ? value : formatted;
}

interface StateDisplay {
  label: string;
  icon: LucideIcon;
  tone: string;
}

/** Employment state as an icon plus a word — never colour alone. */
const EMPLOYMENT_STATE: Record<string, StateDisplay> = {
  Active: { label: 'Active', icon: CircleCheck, tone: 'text-success' },
  'Notice Period': { label: 'Serving notice', icon: Clock, tone: 'text-warning' },
  Relieved: { label: 'Relieved', icon: CircleX, tone: 'text-danger' },
  Retired: { label: 'Retired', icon: CircleX, tone: 'text-muted-foreground' },
  Settled: { label: 'Settled', icon: CircleX, tone: 'text-muted-foreground' },
  Left: { label: 'Left', icon: CircleX, tone: 'text-danger' },
  Unknown: { label: 'Not in the current roster', icon: TriangleAlert, tone: 'text-warning' },
};

interface DetailRow {
  label: string;
  value: string;
  /** Long unbroken values (emails) must be allowed to break anywhere at 360px. */
  breakAll?: boolean;
}

function DetailList({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{row.label}</dt>
          <dd
            className={cn(
              'mt-0.5 text-sm font-medium',
              row.breakAll ? 'break-all' : 'break-words',
              !row.value && 'font-normal italic text-muted-foreground',
            )}
          >
            {row.value || 'Not recorded'}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StatusLine({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: string;
  children: ReactNode;
}) {
  return (
    <p className="flex items-start gap-2 text-sm">
      <Icon aria-hidden className={cn('mt-0.5 h-4 w-4 shrink-0', tone)} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function LoadingRows() {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * The card
 * ---------------------------------------------------------------------------------------------- */

export function WorkDetailsCard({ className }: { className?: string }) {
  const { user, loading: authLoading, isImpersonating, originalUser } = useAuth();
  const titleId = useId();

  const userId = user?.id ?? '';
  const employeeId = text(user?.employeeId);
  const employeeNo = text(user?.employeeNo);
  const email = text(user?.email);
  const linked = Boolean(employeeId);

  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<WorkLoad | null>(null);
  const requestKey = `${userId}|${employeeId}|${employeeNo}|${email}|${attempt}`;

  useEffect(() => {
    if (!userId || !employeeId) return;
    let cancelled = false;
    loadWorkDetails({ employeeId, employeeNo, email }).then(
      (value) => {
        if (!cancelled) setLoad({ key: requestKey, status: 'ready', ...value });
      },
      (error: unknown) => {
        console.error('[profile] Failed to load work details', error);
        if (!cancelled) setLoad({ key: requestKey, status: 'error', index: null, facts: null, record: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId, employeeId, employeeNo, email, requestKey]);

  const current = load?.key === requestKey ? load : null;
  const isLoading = authLoading || (linked && !current);

  /* ── Derived facts ── */

  const resolved = user && current?.status === 'ready' && current.index
    ? resolveDesignation(user, current.index)
    : null;
  const pick = (key: string): string => text(current?.record?.[key]) || text(current?.facts?.[key]);
  const found = Boolean(current?.facts || current?.record);

  const code = resolved?.employeeCode || employeeNo || pick('employeeNo');
  const stateKey = pick('employmentState');
  const state = stateKey ? EMPLOYMENT_STATE[stateKey] : undefined;
  const lastDay = pick('exitDate') || pick('leavingDate');
  const syncedAt = pick('syncedAt');

  const rows: DetailRow[] = [
    { label: 'Employee number', value: code },
    { label: 'Designation', value: resolved?.designation || pick('designation') },
    { label: 'Department', value: resolved?.department || pick('department') },
    { label: 'Location', value: resolved?.location || pick('location') },
  ];
  // Optional facts appear only when greytHR actually holds them, so the list does not fill up with
  // "Not recorded" for fields this tenant never uses.
  const optional: Array<DetailRow | null> = [
    pick('reportingManagerName') ? { label: 'Reporting manager', value: pick('reportingManagerName') } : null,
    pick('dateOfJoin') ? { label: 'Date of joining', value: formatHrDate(pick('dateOfJoin')) } : null,
    pick('employmentType') ? { label: 'Employment type', value: pick('employmentType') } : null,
    pick('confirmDate') ? { label: 'Confirmed on', value: formatHrDate(pick('confirmDate')) } : null,
    stateKey === 'Notice Period' && lastDay ? { label: 'Last working day', value: formatHrDate(lastDay) } : null,
    pick('company') ? { label: 'Company', value: pick('company') } : null,
    pick('projectName') ? { label: 'Project (in greytHR)', value: pick('projectName') } : null,
    pick('email') ? { label: 'Official email', value: pick('email'), breakAll: true } : null,
    pick('phone') ? { label: 'Mobile', value: pick('phone') } : null,
  ];
  for (const row of optional) if (row) rows.push(row);

  const link = user?.greytHR;
  const linkedSince = link?.linkedAt ? formatGrantDate(link.linkedAt) : '';
  const method = link?.method ? linkMethodLabel(link.method as LinkMethod) : '';

  const self = isImpersonating ? 'This login' : 'Your login';

  /* ── Body ── */

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div role="status" aria-live="polite" className="space-y-4">
        <span className="sr-only">Loading work details…</span>
        <Skeleton className="h-4 w-56 max-w-full" />
        <LoadingRows />
      </div>
    );
  } else if (!user) {
    body = (
      <StatusLine icon={CircleX} tone="text-danger">
        Your account could not be loaded. Refresh the page to try again.
      </StatusLine>
    );
  } else if (!linked) {
    body = (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-6 text-center">
        <Link2Off aria-hidden className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">Not linked to an HR record</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {self} isn&apos;t linked to an HR record yet — ask HR to link it. Your designation,
          department and joining date will appear here once it is.
        </p>
      </div>
    );
  } else if (current?.status === 'error') {
    body = (
      <div className="space-y-3">
        <StatusLine icon={CircleX} tone="text-danger">
          <span className="font-medium">Couldn&apos;t load your work details.</span>{' '}
          <span className="text-muted-foreground">Check your connection and try again.</span>
        </StatusLine>
        <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
          <RefreshCw aria-hidden className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  } else if (!found) {
    body = (
      <div className="space-y-4">
        <StatusLine icon={TriangleAlert} tone="text-warning">
          <span className="font-medium">
            Linked to HR record {code || employeeId}, but that record isn&apos;t in the synced employee list.
          </span>{' '}
          <span className="text-muted-foreground">Ask HR to check the link.</span>
        </StatusLine>
        <DetailList rows={[{ label: 'Employee number', value: code }]} />
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusLine icon={Link2} tone="text-success">
            <span className="font-medium">Linked to greytHR</span>
            {(method || linkedSince) && (
              <span className="text-muted-foreground">
                {' · '}
                {[method, linkedSince && `since ${linkedSince}`].filter(Boolean).join(' · ')}
              </span>
            )}
          </StatusLine>
          {state && (
            <p className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium">
              <state.icon aria-hidden className={cn('h-3.5 w-3.5', state.tone)} />
              <span className="sr-only">Employment status: </span>
              {state.label}
            </p>
          )}
        </div>
        <DetailList rows={rows} />
      </div>
    );
  }

  return (
    <Card role="region" className={cn('min-w-0', className)} aria-labelledby={titleId}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Briefcase aria-hidden className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <CardTitle id={titleId} role="heading" aria-level={2} className="text-base">
              Work details
            </CardTitle>
            <CardDescription>
              {isImpersonating ? 'The HR record behind this account.' : 'Your HR record, as greytHR holds it.'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isImpersonating && user && (
          <p className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Eye aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              You&apos;re viewing <span className="font-medium text-foreground">{user.name || 'this user'}</span>
              &apos;s account{originalUser?.name ? ` as ${originalUser.name}` : ''}. These are their details, not
              yours.
            </span>
          </p>
        )}

        {body}

        {user && linked && !isLoading && current?.status !== 'error' && (
          <p className="flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              These details come from greytHR{syncedAt ? ` (last synced ${formatGrantDate(syncedAt)})` : ''}. If
              anything is wrong, ask HR to correct it there — it updates here after the next sync.
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
