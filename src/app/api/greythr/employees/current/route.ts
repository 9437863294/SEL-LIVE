import { NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { isGreytHRConfigured } from '@/lib/greythr-client';
import { fetchCurrentEmployeeRoster } from '@/lib/greythr-live-roster';
import {
  readCurrentRosterSnapshot,
  replaceCurrentRosterSnapshot,
  type ReplaceSnapshotResult,
} from '@/lib/greythr-roster-store';

/**
 * The CURRENT roster, live from greytHR — and stored, replacing the previous snapshot.
 *
 * `GET /api/greythr/employees/current`
 *
 * Two jobs, in this order:
 *
 *   1. **Fetch** greytHR's `state=CURRENT` roster. No Firestore mirror in the middle, so this cannot
 *      inherit a stale sync or the placeholder-date failure — it never reads `leavingDate` as
 *      evidence of anything.
 *   2. **Store it**, clearing the previous snapshot. Each successful complete fetch replaces the last
 *      one wholesale in `greythrCurrentRoster`, so the collection holds exactly one dated answer to
 *      "who currently works here" and never accumulates leavers.
 *
 * The storing is deliberately confined to its own collection and never touches `employees`. See
 * `greythr-roster-store.ts` for why: pruning the mirror to CURRENT-only cannot hold against the
 * hourly sync, which fetches `state=ALL` and writes the leavers straight back.
 *
 * ── Why a write on a GET ───────────────────────────────────────────────────────────────────────
 *
 * Unusual, and worth being explicit about. This route is a cache-warm as much as a read: the store
 * exists so the roster survives greytHR being unreachable, and the only moment there is fresh data
 * worth storing is the moment somebody asks for it. The write is idempotent — the same roster stored
 * twice is the same snapshot — so a repeated GET is not a repeated effect.
 *
 * A storage failure never fails the request. The caller asked for the roster; they get the roster,
 * with `snapshot.refusedReason` explaining what did not get persisted and why.
 */

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, 'Settings.Employee Management', 'View');

    if (!isGreytHRConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'greytHR credentials are not configured on the server.' },
        { status: 400 },
      );
    }

    let live: Awaited<ReturnType<typeof fetchCurrentEmployeeRoster>> | null = null;
    let liveError: string | null = null;
    try {
      live = await fetchCurrentEmployeeRoster();
    } catch (error) {
      liveError = error instanceof Error ? error.message : 'greytHR could not be reached.';
    }

    /* ── greytHR unreachable: serve the stored snapshot rather than nothing ── */

    if (!live) {
      const { employees, meta } = await readCurrentRosterSnapshot();
      if (!employees.length) {
        return NextResponse.json(
          { ok: false, error: `${liveError} No stored roster snapshot is available either.` },
          { status: 502 },
        );
      }
      return NextResponse.json({
        ok: true,
        employees,
        totalCurrent: employees.length,
        fetchedAt: meta.fetchedAt ?? new Date().toISOString(),
        // The screen must be able to say "this is not live", so the source is never implied.
        source: 'snapshot',
        stale: true,
        staleReason: `${liveError} Showing the roster stored on the last successful fetch.`,
        snapshot: { fetchedAt: meta.fetchedAt, count: meta.count, replaced: false, refusedReason: null },
      });
    }

    /* ── Store it, replacing the previous snapshot ── */

    let snapshot: ReplaceSnapshotResult | null = null;
    try {
      snapshot = await replaceCurrentRosterSnapshot({
        employees: live.employees,
        fetchedAt: live.fetchedAt,
        complete: live.complete,
        totalElements: live.totalElements,
      });
    } catch (error) {
      // The fetch succeeded, so the answer below is good regardless. Persisting is the part that
      // failed, and saying so beats failing a request the user can otherwise be served.
      console.error('[greythr/current] Could not store the roster snapshot.', error);
      snapshot = {
        replaced: false,
        written: 0,
        deleted: 0,
        refusedReason: error instanceof Error ? error.message : 'The snapshot could not be stored.',
        fetchedAt: live.fetchedAt,
        count: live.employees.length,
      };
    }

    return NextResponse.json({
      ok: true,
      employees: live.employees,
      totalCurrent: live.employees.length,
      fetchedAt: live.fetchedAt,
      source: 'greythr-live',
      stale: false,
      snapshot: {
        replaced: snapshot.replaced,
        written: snapshot.written,
        /** Employees dropped from the snapshot because greytHR no longer lists them as current. */
        deleted: snapshot.deleted,
        refusedReason: snapshot.refusedReason,
        fetchedAt: snapshot.fetchedAt,
        count: snapshot.count,
      },
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
