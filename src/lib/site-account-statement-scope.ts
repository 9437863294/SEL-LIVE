/**
 * Pure scope and pagination arithmetic for the Site Account Statement ledger.
 *
 * Split out of `site-account-statement-queries.ts` — which imports the Firebase client and so cannot
 * be loaded outside a browser — so the parts that are easy to get subtly wrong (splitting a project
 * scope across `in` chunks, and stitching several chunks' pages back into one ordered page) can be
 * exercised directly by `tests/site-account-statement-scope.test.mjs`.
 *
 * Nothing here touches Firestore. It works on plain `{ id, date }` records.
 */

import type { SASProject } from './site-account-statement';

/**
 * How many project ids go into one `in` filter.
 *
 * Firestore's own cap is 30, but the security rules bind tighter. A project member without RBAC is
 * authorised per document by looking up that document's project (`sasCanReadProject` in
 * firestore.rules), and Firestore allows at most 20 document-access calls while evaluating a query.
 * Identical lookups are cached and counted once, so the real cost is one call per *distinct* project
 * in the chunk, plus two for the caller's own user and role documents.
 *
 * 15 keeps that comfortably inside the limit. Raising it past ~18 would make queries start failing
 * for exactly the users the per-project rules exist to serve.
 */
export const SAS_IN_CHUNK = 15;

/** Rows fetched per page of the expense / payment tables. */
export const SAS_PAGE_SIZE = 50;

/**
 * A hard ceiling on how many documents a single "load everything" call (Excel export, report page)
 * may pull, so a report cannot degenerate into an unbounded collection scan.
 */
export const SAS_MAX_SCAN = 5000;

/**
 * The project ids a user may see, or `null` for an All-Projects holder.
 *
 * One definition of "my projects", so a page cannot scope its *display* one way and its *query*
 * another. An unresolved user yields `[]`, never `null`: the failure mode of a scope that has not
 * loaded yet must be "sees nothing", never "sees everything".
 */
export function ledgerScopeFor(
  projects: Pick<SASProject, 'id' | 'assignedPersonId' | 'altUserId' | 'viewerId'>[],
  userId: string | undefined,
  canViewAll: boolean,
): string[] | null {
  if (canViewAll) return null;
  if (!userId) return [];
  return projects
    .filter(p => p.assignedPersonId === userId || p.altUserId === userId || p.viewerId === userId)
    .map(p => p.id);
}

/**
 * Splits a project scope into `in`-sized chunks.
 *
 * `[null]` — a single chunk with no project constraint — means "every project". `[]` means "no
 * projects", and every caller must treat that as an empty result rather than as "unconstrained".
 */
export function chunkProjectIds(projectIds: string[] | null, size = SAS_IN_CHUNK): (string[] | null)[] {
  if (projectIds === null) return [null];
  if (projectIds.length === 0) return [];
  if (projectIds.length <= size) return [projectIds];
  const chunks: string[][] = [];
  for (let i = 0; i < projectIds.length; i += size) chunks.push(projectIds.slice(i, i + size));
  return chunks;
}

/** The minimum a record needs for the merge below: a stable id and the field it is ordered by. */
export interface OrderedRecord {
  id: string;
  date: string;
}

export interface ChunkFetch<T extends OrderedRecord> {
  /** Up to `pageSize + 1` rows, already ordered newest-first by the server. */
  rows: T[];
  /** True when the server returned no more than `pageSize` rows — this chunk has nothing left. */
  exhausted: boolean;
}

export interface MergedPage<T extends OrderedRecord> {
  rows: T[];
  hasMore: boolean;
  /** Per chunk, the last row consumed — the next query resumes after it. */
  marks: (T | null)[];
  /** Indices of chunks with nothing further to give. */
  done: number[];
}

/**
 * Stitches per-chunk result pages into one page, newest first.
 *
 * Each chunk is its own Firestore query with its own cursor, but all of them are ordered by the same
 * key, so taking the newest `pageSize` of the union and remembering where each chunk was left off
 * yields exactly the next `pageSize` rows on the following call — no gaps and no repeats.
 *
 * The ordering key is `(date desc, id desc)`. Including the id matters: dates are day-granular here,
 * so several rows routinely share one, and a cursor built on date alone would either skip rows or
 * serve them twice.
 */
export function mergeChunkPages<T extends OrderedRecord>(
  chunks: ChunkFetch<T>[],
  pageSize: number,
  previousMarks: (T | null)[],
): MergedPage<T> {
  type Entry = { row: T; chunk: number };
  const merged: Entry[] = [];
  chunks.forEach((chunk, index) => chunk.rows.forEach(row => merged.push({ row, chunk: index })));

  merged.sort((left, right) => {
    if (left.row.date !== right.row.date) return right.row.date.localeCompare(left.row.date);
    return right.row.id.localeCompare(left.row.id);
  });

  const taken = merged.slice(0, pageSize);
  const hasMore = merged.length > pageSize;

  // A chunk that contributed nothing to this page keeps its previous mark, so it resumes from where
  // it was rather than restarting from the top.
  const marks = chunks.map((_, index) => {
    for (let i = taken.length - 1; i >= 0; i--) {
      if (taken[i].chunk === index) return taken[i].row;
    }
    return previousMarks[index] ?? null;
  });

  // A chunk is finished only once it has returned everything it had AND we consumed all of it — one
  // whose surplus rows were trimmed off this page still has rows to serve.
  const done: number[] = [];
  chunks.forEach((chunk, index) => {
    const consumed = taken.filter(entry => entry.chunk === index).length;
    if (chunk.exhausted && consumed === chunk.rows.length) done.push(index);
  });

  return { rows: taken.map(entry => entry.row), hasMore, marks, done };
}
