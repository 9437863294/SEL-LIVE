import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chunkProjectIds,
  ledgerScopeFor,
  mergeChunkPages,
  SAS_IN_CHUNK,
} from '../src/lib/site-account-statement-scope.ts';

const project = (id, roles = {}) => ({
  id,
  assignedPersonId: roles.assigned ?? '',
  altUserId: roles.alt ?? '',
  viewerId: roles.viewer ?? '',
});

describe('ledgerScopeFor', () => {
  const projects = [
    project('p1', { assigned: 'u1' }),
    project('p2', { alt: 'u1' }),
    project('p3', { viewer: 'u1' }),
    project('p4', { assigned: 'u2' }),
  ];

  it('returns null — meaning every project — for an All Projects holder', () => {
    assert.equal(ledgerScopeFor(projects, 'u1', true), null);
  });

  it('includes projects held as assignee, alternate, or viewer', () => {
    assert.deepEqual(ledgerScopeFor(projects, 'u1', false), ['p1', 'p2', 'p3']);
  });

  it('excludes projects the user has no role on', () => {
    assert.deepEqual(ledgerScopeFor(projects, 'u2', false), ['p4']);
  });

  it('returns an empty scope — never null — when the user has not resolved yet', () => {
    // The distinction matters: `null` means "no project constraint", so returning it for an
    // unresolved user would silently widen every query to the whole organisation.
    assert.deepEqual(ledgerScopeFor(projects, undefined, false), []);
  });

  it('returns an empty scope for a user attached to nothing', () => {
    assert.deepEqual(ledgerScopeFor(projects, 'nobody', false), []);
  });
});

describe('chunkProjectIds', () => {
  it('represents "every project" as a single unconstrained chunk', () => {
    assert.deepEqual(chunkProjectIds(null), [null]);
  });

  it('represents "no projects" as no chunks at all, so no query is issued', () => {
    assert.deepEqual(chunkProjectIds([]), []);
  });

  it('keeps a scope within the limit as one chunk', () => {
    const ids = Array.from({ length: SAS_IN_CHUNK }, (_, i) => `p${i}`);
    assert.deepEqual(chunkProjectIds(ids), [ids]);
  });

  it('splits a scope past the limit without dropping or repeating an id', () => {
    const ids = Array.from({ length: SAS_IN_CHUNK * 2 + 3 }, (_, i) => `p${i}`);
    const chunks = chunkProjectIds(ids);
    assert.equal(chunks.length, 3);
    chunks.forEach(chunk => assert.ok(chunk.length <= SAS_IN_CHUNK));
    assert.deepEqual(chunks.flat(), ids);
  });

  it('stays inside the Firestore rules document-access budget', () => {
    // firestore.rules authorises project members with one get() per distinct project, and Firestore
    // permits 20 document accesses per query — two of which the caller's own user and role
    // documents consume.
    assert.ok(SAS_IN_CHUNK <= 18, `SAS_IN_CHUNK is ${SAS_IN_CHUNK}, which would exhaust the rules budget`);
  });
});

describe('mergeChunkPages', () => {
  const row = (id, date) => ({ id, date });
  const fetched = (rows, exhausted = true) => ({ rows, exhausted });

  it('orders the merged page newest-first across chunks', () => {
    const merged = mergeChunkPages(
      [
        fetched([row('a', '2026-03-10'), row('b', '2026-01-05')]),
        fetched([row('c', '2026-02-20'), row('d', '2025-12-31')]),
      ],
      10,
      [null, null],
    );
    assert.deepEqual(merged.rows.map(r => r.id), ['a', 'c', 'b', 'd']);
    assert.equal(merged.hasMore, false);
  });

  it('breaks same-date ties on id, so a cursor can never straddle a shared date', () => {
    const merged = mergeChunkPages(
      [fetched([row('aaa', '2026-03-10'), row('ccc', '2026-03-10')]), fetched([row('bbb', '2026-03-10')])],
      10,
      [null, null],
    );
    // Descending on id, matching the query's `orderBy(documentId(), 'desc')`.
    assert.deepEqual(merged.rows.map(r => r.id), ['ccc', 'bbb', 'aaa']);
  });

  it('trims to the page size and reports that more remain', () => {
    const merged = mergeChunkPages(
      [fetched([row('a', '2026-03-03'), row('b', '2026-03-02'), row('c', '2026-03-01')], false)],
      2,
      [null],
    );
    assert.deepEqual(merged.rows.map(r => r.id), ['a', 'b']);
    assert.equal(merged.hasMore, true);
  });

  it('marks each chunk at the last row actually consumed', () => {
    // Chunk 1 supplies the two newest rows; chunk 2 supplies none once the page is trimmed. Chunk 2
    // must keep its previous position rather than being advanced past rows it never served.
    const merged = mergeChunkPages(
      [
        fetched([row('a', '2026-03-03'), row('b', '2026-03-02')], false),
        fetched([row('z', '2020-01-01')], true),
      ],
      2,
      [null, null],
    );
    assert.deepEqual(merged.rows.map(r => r.id), ['a', 'b']);
    assert.equal(merged.marks[0].id, 'b');
    assert.equal(merged.marks[1], null);
  });

  it('keeps a chunk that contributed nothing pinned to its previous mark', () => {
    const previous = row('old', '2025-06-01');
    const merged = mergeChunkPages(
      [fetched([row('a', '2026-03-03')], false), fetched([], true)],
      1,
      [null, previous],
    );
    assert.equal(merged.marks[1], previous);
  });

  it('reports a chunk done only when every row it returned was consumed', () => {
    // Chunk 0 returned everything it had and all of it fits on the page: finished.
    // Chunk 1 also returned everything it had, but a row was trimmed off: not finished.
    const merged = mergeChunkPages(
      [
        fetched([row('a', '2026-03-03')], true),
        fetched([row('b', '2026-03-02'), row('c', '2026-03-01')], true),
      ],
      2,
      [null, null],
    );
    assert.deepEqual(merged.rows.map(r => r.id), ['a', 'b']);
    assert.deepEqual(merged.done, [0]);
  });

  it('paginates a multi-chunk scope without gaps or repeats', () => {
    // Two chunks, interleaved dates, walked page by page the way the UI's "Load more" does.
    const chunkA = [row('a1', '2026-03-09'), row('a2', '2026-03-07'), row('a3', '2026-03-05')];
    const chunkB = [row('b1', '2026-03-08'), row('b2', '2026-03-06'), row('b3', '2026-03-04')];
    const sources = [chunkA, chunkB];

    const pageSize = 2;
    let marks = [null, null];
    let done = new Set();
    const seen = [];

    for (let guard = 0; guard < 10; guard++) {
      const fetches = sources.map((rows, index) => {
        if (done.has(index)) return fetched([], true);
        const mark = marks[index];
        const start = mark ? rows.findIndex(r => r.id === mark.id) + 1 : 0;
        const slice = rows.slice(start, start + pageSize + 1);
        return { rows: slice.slice(0, pageSize + 1), exhausted: slice.length <= pageSize };
      });

      const merged = mergeChunkPages(fetches, pageSize, marks);
      seen.push(...merged.rows.map(r => r.id));
      marks = merged.marks;
      done = new Set(merged.done);
      if (!merged.hasMore) break;
    }

    // Every row exactly once, in strict date order.
    assert.deepEqual(seen, ['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
    assert.equal(new Set(seen).size, seen.length);
  });
});
