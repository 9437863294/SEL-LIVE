'use client';

/**
 * The one Firestore read behind every designation label in the application.
 *
 * Split from `people-directory.ts` so the resolution rules there stay unit-testable — see that
 * module's header for what a designation is and why it is not `users.role`.
 */

import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  attachDesignations,
  buildEmployeeFactsIndex,
  EMPTY_EMPLOYEE_FACTS_INDEX,
  type EmployeeFacts,
  type EmployeeFactsIndex,
  type PersonLike,
} from '@/lib/people-directory';

/**
 * The employee master, cached for the session.
 *
 * One read shared by every picker in the app. It changes when somebody joins, leaves or is promoted
 * — which is to say between sessions, not during one — so a five-minute window costs nothing and
 * saves a 400-document read per screen. `force` is for the screens that have just written a link.
 */
const CACHE_TTL_MS = 5 * 60_000;
let cache: { at: number; value: EmployeeFactsIndex } | null = null;
let inFlight: Promise<EmployeeFactsIndex> | null = null;

export async function loadEmployeeFactsIndex(
  options: { force?: boolean } = {},
): Promise<EmployeeFactsIndex> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  // Several pickers can mount in the same tick; without this they would each start their own read.
  if (!options.force && inFlight) return inFlight;

  const run = (async () => {
    try {
      const snapshot = await getDocs(collection(db, 'employees'));
      const index = buildEmployeeFactsIndex(
        snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<EmployeeFacts, 'id'>) })),
      );
      cache = { at: Date.now(), value: index };
      return index;
    } catch (err) {
      // A permissions or network failure must not blank out every person picker in the app: the
      // callers all fall back to the role they were showing before this existed.
      console.error('[people] Failed to load the employee master for designations', err);
      return EMPTY_EMPLOYEE_FACTS_INDEX;
    } finally {
      inFlight = null;
    }
  })();

  inFlight = run;
  return run;
}

/** Drops the cached read — for a screen that has just linked or unlinked somebody. */
export function invalidateEmployeeFactsCache(): void {
  cache = null;
}

/**
 * `attachDesignations` for the screens that load the user directory themselves.
 *
 * A dozen settings and workflow-configuration pages each do their own
 * `getDocs(collection(db, 'users'))` inside a `Promise.all`, and rewriting each of them to share a
 * hook would be a much larger change than the one they need. Awaiting this instead costs them
 * nothing: the read above is cached for the session and de-duplicates concurrent callers, so the
 * second screen to ask pays no round trip at all.
 */
export async function withDesignations<T extends PersonLike>(people: T[]): Promise<T[]> {
  return attachDesignations(people, await loadEmployeeFactsIndex());
}
