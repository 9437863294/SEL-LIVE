'use client';

/**
 * Server-side scoping, aggregation and pagination for the Site Account Statement ledger.
 *
 * Every page in this module used to call `getDocs(collection(db, 'siteAccountExpenses'))` with no
 * constraints and then filter in JavaScript. That shipped the whole organisation's ledger to every
 * browser — slow, expensive, and a data leak for anyone who is only assigned to one project. This
 * module is the single place that talks to the ledger collections, and it never issues an
 * unconstrained read:
 *
 *   • Project scope is pushed into the query (`projectId in [...]`), so a site user's browser only
 *     ever receives their own projects' rows.
 *   • Totals come from `getAggregateFromServer` — one billed read instead of one per document, and
 *     the figure stays correct even though the table below it only holds one page.
 *   • The table itself is cursor-paginated, so "All Time" on a five-year-old project loads 50 rows
 *     rather than fifty thousand.
 *
 * Firestore caps `in` filters at 30 values, so a scope wider than that is split into chunks:
 * aggregates are summed across chunks, and pagination merges the chunks' pages by date. See
 * `chunkScope` for why that is safe.
 */

import {
  collection,
  count,
  getAggregateFromServer,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  sum,
  where,
  type DocumentData,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { SAS_COLLECTIONS, type SASExpense, type SASPayment, type SASProject } from './site-account-statement';
import {
  chunkProjectIds, ledgerScopeFor, mergeChunkPages,
  SAS_IN_CHUNK, SAS_MAX_SCAN, SAS_PAGE_SIZE,
  type ChunkFetch, type OrderedRecord,
} from './site-account-statement-scope';

// Re-exported so call sites keep importing everything ledger-related from one place, while the
// arithmetic itself lives in a Firebase-free module that tests can load directly.
export { ledgerScopeFor, SAS_IN_CHUNK, SAS_MAX_SCAN, SAS_PAGE_SIZE };

export type LedgerKind = 'expenses' | 'payments';

const DATE_FIELD: Record<LedgerKind, string> = {
  expenses: 'expenseDate',
  payments: 'receiptDate',
};

const AMOUNT_FIELD: Record<LedgerKind, string> = {
  expenses: 'expenseAmount',
  payments: 'receivedAmount',
};

const COLLECTION: Record<LedgerKind, string> = {
  expenses: SAS_COLLECTIONS.expenses,
  payments: SAS_COLLECTIONS.payments,
};

/**
 * Which slice of the ledger a caller is allowed to see and is asking about.
 *
 * `projectIds: null` means "every project" and is only ever produced for a holder of
 * `Site Account Statement.All Projects`. An empty array means the user is scoped to no projects at
 * all, and every function here short-circuits to an empty result rather than falling back to an
 * unfiltered read — the failure mode of a bad scope must be "sees nothing", never "sees everything".
 */
export interface SASLedgerScope {
  projectIds: string[] | null;
  /** Inclusive lower bound, `YYYY-MM-DD`. Omit or pass '' for no lower bound. */
  from?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. Omit or pass '' for no upper bound. */
  to?: string;
  /**
   * Main expense category, pushed into the query.
   *
   * This is the *only* optional equality filter that goes to the server, and that is a deliberate
   * limit rather than an oversight. Every extra equality filter multiplies the set of composite
   * indexes the module needs: each subset of the filters, crossed with project-scoped vs. not, and
   * again with pagination vs. aggregation. Three optional filters meant 32 index definitions for
   * `siteAccountExpenses` alone — more than the whole rest of the application uses — and every one
   * of them is a separate deploy-and-build before the feature works.
   *
   * Category earns its place because "how much did we spend on Material Purchase this month" is a
   * figure people read off the total, so it has to be a *server* total rather than a sum of
   * whatever rows happen to be paged in. Payment mode and the GST flag are narrowing aids applied
   * to the loaded rows instead; the UI labels their totals accordingly.
   */
  expenseCategory?: string;
}

export interface SASAggregate {
  total: number;
  count: number;
}

export interface SASPage<T> {
  rows: T[];
  /** Pass back as `cursor` to fetch the next page. `null` when the last page has been reached. */
  cursor: SASCursor | null;
  hasMore: boolean;
}

/**
 * An opaque page cursor. It holds one Firestore document snapshot per `in`-chunk, because each
 * chunk is its own query with its own position.
 */
export interface SASCursor {
  readonly __brand: 'SASCursor';
  readonly marks: (QueryDocumentSnapshot<DocumentData> | null)[];
  /** Indices of chunks that returned nothing further, so they are not re-queried on later pages. */
  readonly done: readonly number[];
  /**
   * Row offset, set only while paging through an unindexed fallback result.
   *
   * Firestore cursors are document snapshots from an ordered server query. When the composite index
   * that ordering needs does not exist, there is no server ordering to anchor to, so the fallback
   * sorts client-side and pages by position instead.
   */
  readonly offset?: number;
}

function makeCursor(
  marks: (QueryDocumentSnapshot<DocumentData> | null)[],
  done: readonly number[],
  offset?: number,
): SASCursor {
  return { __brand: 'SASCursor', marks, done, offset } as SASCursor;
}

const chunkScope = (projectIds: string[] | null) => chunkProjectIds(projectIds);

function scopeConstraints(kind: LedgerKind, scope: SASLedgerScope, chunk: string[] | null): QueryConstraint[] {
  const dateField = DATE_FIELD[kind];
  const constraints: QueryConstraint[] = [];

  if (chunk !== null) {
    constraints.push(chunk.length === 1 ? where('projectId', '==', chunk[0]) : where('projectId', 'in', chunk));
  }
  if (kind === 'expenses' && scope.expenseCategory) {
    constraints.push(where('expenseCategory', '==', scope.expenseCategory));
  }
  // An empty bound means "unbounded". A literal where(date, '<=', '') would match nothing, since
  // every real date string sorts after the empty string.
  if (scope.from) constraints.push(where(dateField, '>=', scope.from));
  if (scope.to)   constraints.push(where(dateField, '<=', scope.to));

  return constraints;
}

function isMissingIndex(error: unknown): boolean {
  return (error as { code?: string })?.code === 'failed-precondition';
}

let warnedAboutIndexes = false;

/**
 * How long to stop attempting a query shape that has already failed for want of an index.
 *
 * Without this, every call re-attempts the indexed path, eats a failed round-trip, and lets the
 * Firestore SDK log its own error before our fallback runs — so a single page load produces a dozen
 * wasted requests and a wall of red console output for a condition we already know about.
 *
 * It expires rather than latching so that a tab left open while `firebase deploy --only
 * firestore:indexes` finishes picks the fast path back up on its own, without a reload.
 */
const INDEX_RETRY_MS = 5 * 60 * 1000;

/** Query shape → when it is worth attempting the indexed path again. */
const indexUnavailableUntil = new Map<string, number>();

function indexKnownMissing(shape: string): boolean {
  const until = indexUnavailableUntil.get(shape);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    indexUnavailableUntil.delete(shape);
    return false;
  }
  return true;
}

/**
 * Records that a query shape has no index yet, and tells the developer once.
 *
 * Every function here can answer its question without the composite indexes, just less efficiently.
 * That matters because the indexes in `firestore.indexes.json` have to be deployed separately
 * (`firebase deploy --only firestore:indexes`) and take minutes to build — the module must keep
 * working in the gap rather than showing the user an error they cannot act on.
 */
function noteMissingIndex(shape: string): void {
  indexUnavailableUntil.set(shape, Date.now() + INDEX_RETRY_MS);
  if (!warnedAboutIndexes) {
    warnedAboutIndexes = true;
    console.warn(
      '[SAS] Composite indexes are not deployed yet — falling back to client-side filtering. '
      + 'Run `firebase deploy --only firestore:indexes` and allow a few minutes for them to build. '
      + 'Figures stay correct; queries are slower and read more until then.',
    );
  }
}

/**
 * Every row for one chunk, without relying on any composite index.
 *
 * Firestore always has single-field indexes, so exactly two query shapes are safe here: filtering on
 * `projectId` alone, or ranging and ordering on the date field alone. Anything that combines them
 * needs the composite index this path exists precisely because we do not have.
 *
 *   • Scoped to projects → filter on `projectId` and apply dates locally. Deliberately unbounded:
 *     truncating without a server-side ordering would drop arbitrary rows and quietly understate
 *     every total. This path is transitional — once the indexes are built it stops being used — so
 *     reading a project's rows in full is the right trade against reporting a wrong number.
 *   • All projects → range and order on the date field server-side, which *is* a single-field
 *     query, and cap the read. Filtering after a cap would be the silent-truncation bug above, so
 *     the bound goes into the query rather than into the loop below.
 */
async function fetchChunkUnindexed(
  kind: LedgerKind,
  scope: SASLedgerScope,
  chunk: string[] | null,
  maxScan: number,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const dateField = DATE_FIELD[kind];

  const constraints: QueryConstraint[] = chunk === null
    ? [
        ...(scope.from ? [where(dateField, '>=', scope.from)] : []),
        ...(scope.to   ? [where(dateField, '<=', scope.to)]   : []),
        orderBy(dateField, 'desc'),
        limit(maxScan + 1),
      ]
    : [chunk.length === 1 ? where('projectId', '==', chunk[0]) : where('projectId', 'in', chunk)];

  const snap = await getDocs(query(collection(db, COLLECTION[kind]), ...constraints) as Query<DocumentData>);

  return snap.docs.filter(doc => {
    const data = doc.data();
    const date = String(data[dateField] ?? '');
    if (scope.from && date < scope.from) return false;
    if (scope.to   && date > scope.to)   return false;
    if (kind === 'expenses' && scope.expenseCategory && data.expenseCategory !== scope.expenseCategory) return false;
    return true;
  });
}

/** All rows in scope, unindexed, newest first. */
async function fetchAllUnindexed(
  kind: LedgerKind,
  scope: SASLedgerScope,
  maxScan: number,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const dateField = DATE_FIELD[kind];
  const chunks = chunkScope(scope.projectIds);
  const perChunk = await Promise.all(chunks.map(chunk => fetchChunkUnindexed(kind, scope, chunk, maxScan)));

  return perChunk.flat().sort((left, right) => {
    const leftDate = String(left.data()[dateField] ?? '');
    const rightDate = String(right.data()[dateField] ?? '');
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
    return right.id.localeCompare(left.id);
  });
}

/**
 * Sum + count for a scope, computed on the server.
 *
 * Falls back to reading the documents and adding them up when the composite index the aggregation
 * needs has not finished building — a slow correct answer beats a red error box on a dashboard.
 */
export async function aggregateLedger(kind: LedgerKind, scope: SASLedgerScope): Promise<SASAggregate> {
  const chunks = chunkScope(scope.projectIds);
  if (chunks.length === 0) return { total: 0, count: 0 };

  const amountField = AMOUNT_FIELD[kind];

  const shape = `${kind}:aggregate`;

  const results = await Promise.all(chunks.map(async (chunk) => {
    // Re-running `base` after a failure would hit the very index that is missing, so the fallback
    // uses the single-field query shape and does the filtering and adding up locally.
    const locally = async () => {
      const docs = await fetchChunkUnindexed(kind, scope, chunk, SAS_MAX_SCAN);
      return {
        total: docs.reduce((running, item) => running + ((item.data()[amountField] as number) || 0), 0),
        count: docs.length,
      };
    };

    if (indexKnownMissing(shape)) return locally();

    const base = query(collection(db, COLLECTION[kind]), ...scopeConstraints(kind, scope, chunk));
    try {
      const snap = await getAggregateFromServer(base, { total: sum(amountField), rows: count() });
      return { total: snap.data().total ?? 0, count: Number(snap.data().rows ?? 0) };
    } catch (error) {
      if (!isMissingIndex(error)) throw error;
      noteMissingIndex(shape);
      return locally();
    }
  }));

  return results.reduce<SASAggregate>(
    (running, item) => ({ total: running.total + item.total, count: running.count + item.count }),
    { total: 0, count: 0 },
  );
}

/** Convenience wrapper — the sum only, for callers that do not need the row count. */
export async function sumLedger(kind: LedgerKind, scope: SASLedgerScope): Promise<number> {
  return (await aggregateLedger(kind, scope)).total;
}

/**
 * The cumulative total for a project up to (and including) a date — the "opening balance" primitive.
 * `through` is inclusive; pass the day before the period start for a true opening balance.
 */
export async function cumulativeThrough(
  kind: LedgerKind,
  projectIds: string[] | null,
  through: string,
): Promise<number> {
  if (!through) return 0;
  return sumLedger(kind, { projectIds, to: through });
}

/** The cumulative total for a project strictly before a date. */
export async function cumulativeBefore(
  kind: LedgerKind,
  projectIds: string[] | null,
  before: string,
): Promise<number> {
  if (!before) return 0;
  const chunks = chunkScope(projectIds);
  if (chunks.length === 0) return 0;

  const dateField = DATE_FIELD[kind];
  const amountField = AMOUNT_FIELD[kind];

  const shape = `${kind}:cumulative`;

  const totals = await Promise.all(chunks.map(async (chunk) => {
    // `base` needs the index that is missing, so re-running it would fail the same way. The
    // exclusive `< before` bound becomes an inclusive `to` on the previous day, which the fallback
    // applies client-side.
    const locally = async () => {
      const docs = await fetchChunkUnindexed(
        kind,
        { projectIds: chunk, to: previousDay(before) },
        chunk,
        SAS_MAX_SCAN,
      );
      return docs.reduce((running, item) => running + ((item.data()[amountField] as number) || 0), 0);
    };

    if (indexKnownMissing(shape)) return locally();

    const constraints: QueryConstraint[] = [];
    if (chunk !== null) {
      constraints.push(chunk.length === 1 ? where('projectId', '==', chunk[0]) : where('projectId', 'in', chunk));
    }
    constraints.push(where(dateField, '<', before));
    const base = query(collection(db, COLLECTION[kind]), ...constraints);
    try {
      const snap = await getAggregateFromServer(base, { total: sum(amountField) });
      return snap.data().total ?? 0;
    } catch (error) {
      if (!isMissingIndex(error)) throw error;
      noteMissingIndex(shape);
      return locally();
    }
  }));

  return totals.reduce((running, item) => running + item, 0);
}

/** The calendar day before a `YYYY-MM-DD` string, so an exclusive bound becomes an inclusive one. */
function previousDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * One page of the ledger, newest first.
 *
 * With a single `in`-chunk this is a plain Firestore cursor query. With several, each chunk is
 * paged independently and the pages are merged by date — every chunk is ordered by the same key, so
 * taking the newest `pageSize` rows of the merged set and remembering each chunk's last consumed
 * document yields exactly the next `pageSize` rows on the following call.
 */
export async function fetchLedgerPage<T>(
  kind: LedgerKind,
  scope: SASLedgerScope,
  options: { cursor?: SASCursor | null; pageSize?: number } = {},
): Promise<SASPage<T>> {
  const pageSize = options.pageSize ?? SAS_PAGE_SIZE;
  const chunks = chunkScope(scope.projectIds);
  if (chunks.length === 0) return { rows: [], cursor: null, hasMore: false };

  const dateField = DATE_FIELD[kind];
  const marks = options.cursor?.marks ?? chunks.map(() => null);
  const alreadyDone = new Set(options.cursor?.done ?? []);

  /** Position-based paging over a client-sorted result, for when the index is not available. */
  async function unindexedPage(offset: number): Promise<SASPage<T>> {
    const docs = await fetchAllUnindexed(kind, scope, SAS_MAX_SCAN);
    const slice = docs.slice(offset, offset + pageSize);
    const hasMore = docs.length > offset + pageSize;
    return {
      rows: slice.map(doc => ({ id: doc.id, ...doc.data() } as T)),
      cursor: hasMore ? makeCursor([], [], offset + pageSize) : null,
      hasMore,
    };
  }

  // Already paging through a fallback result — stay on that path rather than flip-flopping.
  if (options.cursor?.offset !== undefined) return unindexedPage(options.cursor.offset);

  const shape = `${kind}:page`;
  if (indexKnownMissing(shape)) return unindexedPage(0);

  /** The merge below works on plain records, so each snapshot is carried alongside its sort key. */
  type Carried = OrderedRecord & { snapshot: QueryDocumentSnapshot<DocumentData> };

  let chunkResults: ChunkFetch<Carried>[];
  try {
    chunkResults = await Promise.all(chunks.map(async (chunk, index) => {
      // A chunk that ran dry on an earlier page has nothing left to contribute.
      if (alreadyDone.has(index)) return { rows: [], exhausted: true };

      const mark = marks[index] ?? null;
      const constraints = [
        ...scopeConstraints(kind, scope, chunk),
        // Firestore appends `__name__` implicitly, in the direction of the last `orderBy`, and
        // `startAfter(snapshot)` uses it — so ordering on the document id explicitly buys nothing
        // and only widens the composite index the query demands.
        orderBy(dateField, 'desc'),
        ...(mark ? [startAfter(mark)] : []),
        // One extra row tells us whether a further page exists without a second query.
        limit(pageSize + 1),
      ];
      const snap = await getDocs(query(collection(db, COLLECTION[kind]), ...constraints) as Query<DocumentData>);
      return {
        rows: snap.docs.map(doc => ({
          id: doc.id,
          date: String(doc.data()[dateField] ?? ''),
          snapshot: doc,
        })),
        exhausted: snap.size <= pageSize,
      };
    }));
  } catch (error) {
    if (!isMissingIndex(error)) throw error;
    noteMissingIndex(shape);
    return unindexedPage(0);
  }

  const previousCarried: (Carried | null)[] = marks.map(mark =>
    mark ? { id: mark.id, date: String(mark.data()[dateField] ?? ''), snapshot: mark } : null
  );

  const merged = mergeChunkPages(chunkResults, pageSize, previousCarried);

  return {
    rows: merged.rows.map(entry => ({ id: entry.id, ...entry.snapshot.data() } as T)),
    cursor: merged.hasMore
      ? makeCursor(merged.marks.map(mark => mark?.snapshot ?? null), merged.done)
      : null,
    hasMore: merged.hasMore,
  };
}

/**
 * Every row in scope, for Excel exports and the report pages, capped at `SAS_MAX_SCAN`.
 *
 * `truncated` is the caller's cue to warn that the figures below are incomplete rather than to
 * present a partial total as if it were the whole picture.
 */
export async function fetchLedgerAll<T>(
  kind: LedgerKind,
  scope: SASLedgerScope,
  maxScan = SAS_MAX_SCAN,
): Promise<{ rows: T[]; truncated: boolean }> {
  const chunks = chunkScope(scope.projectIds);
  if (chunks.length === 0) return { rows: [], truncated: false };

  const dateField = DATE_FIELD[kind];
  const shape = `${kind}:scan`;

  let docs: QueryDocumentSnapshot<DocumentData>[];
  if (indexKnownMissing(shape)) {
    docs = await fetchAllUnindexed(kind, scope, maxScan);
  } else {
    try {
      const perChunk = await Promise.all(chunks.map(async (chunk) => {
        const constraints = [
          ...scopeConstraints(kind, scope, chunk),
          orderBy(dateField, 'desc'),
          limit(maxScan + 1),
        ];
        const snap = await getDocs(query(collection(db, COLLECTION[kind]), ...constraints) as Query<DocumentData>);
        return snap.docs;
      }));
      docs = perChunk.flat().sort((left, right) => {
        const leftDate = String(left.data()[dateField] ?? '');
        const rightDate = String(right.data()[dateField] ?? '');
        return rightDate.localeCompare(leftDate);
      });
    } catch (error) {
      if (!isMissingIndex(error)) throw error;
      noteMissingIndex(shape);
      docs = await fetchAllUnindexed(kind, scope, maxScan);
    }
  }

  return {
    rows: docs.slice(0, maxScan).map(doc => ({ id: doc.id, ...doc.data() } as T)),
    truncated: docs.length > maxScan,
  };
}

/** Row count for a scope, from the server. */
export async function countLedger(kind: LedgerKind, scope: SASLedgerScope): Promise<number> {
  const chunks = chunkScope(scope.projectIds);
  if (chunks.length === 0) return 0;

  const shape = `${kind}:count`;
  if (indexKnownMissing(shape)) return (await fetchAllUnindexed(kind, scope, SAS_MAX_SCAN)).length;

  try {
    const counts = await Promise.all(chunks.map(async (chunk) => {
      const base = query(collection(db, COLLECTION[kind]), ...scopeConstraints(kind, scope, chunk));
      const snap = await getCountFromServer(base);
      return snap.data().count;
    }));
    return counts.reduce((running, item) => running + item, 0);
  } catch (error) {
    if (!isMissingIndex(error)) throw error;
    noteMissingIndex(shape);
    return (await fetchAllUnindexed(kind, scope, SAS_MAX_SCAN)).length;
  }
}

/**
 * Loads the expense and payment ledger for exactly the projects a user may see.
 *
 * Report pages each used to run `getDocs(collection(db, 'siteAccountExpenses'))` with no
 * constraints and filter the result in JavaScript. That shipped the entire organisation's ledger to
 * every browser on every page view — expensive, slow, and readable in the network tab by a user
 * scoped to a single project. Reports genuinely do need every row in their scope to compute totals,
 * so this still reads documents rather than aggregates; it just reads only the ones in scope, and
 * reports when it hit the scan ceiling instead of quietly returning a partial answer.
 */
export async function loadScopedLedger(options: {
  projects: SASProject[];
  userId: string | undefined;
  canViewAll: boolean;
  from?: string;
  to?: string;
  maxScan?: number;
}): Promise<{ expenses: SASExpense[]; payments: SASPayment[]; truncated: boolean }> {
  const projectIds = ledgerScopeFor(options.projects, options.userId, options.canViewAll);
  const scope: SASLedgerScope = { projectIds, from: options.from, to: options.to };

  const [expenseResult, paymentResult] = await Promise.all([
    fetchLedgerAll<SASExpense>('expenses', scope, options.maxScan),
    fetchLedgerAll<SASPayment>('payments', scope, options.maxScan),
  ]);

  return {
    expenses: expenseResult.rows,
    payments: paymentResult.rows,
    truncated: expenseResult.truncated || paymentResult.truncated,
  };
}

/** Typed conveniences, so call sites read as what they fetch rather than as a generic. */
export const expensesPage = (scope: SASLedgerScope, options?: { cursor?: SASCursor | null; pageSize?: number }) =>
  fetchLedgerPage<SASExpense>('expenses', scope, options);

export const paymentsPage = (scope: SASLedgerScope, options?: { cursor?: SASCursor | null; pageSize?: number }) =>
  fetchLedgerPage<SASPayment>('payments', scope, options);

export const allExpenses = (scope: SASLedgerScope, maxScan?: number) =>
  fetchLedgerAll<SASExpense>('expenses', scope, maxScan);

export const allPayments = (scope: SASLedgerScope, maxScan?: number) =>
  fetchLedgerAll<SASPayment>('payments', scope, maxScan);
