'use client';

/**
 * The Firestore reads behind every designation label in the application.
 *
 * Split from `people-directory.ts` so the resolution rules there stay unit-testable — see that
 * module's header for what a designation is, why it is not `users.role`, and why the roster is read
 * before the mirror.
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
 * greytHR's CURRENT roster snapshot, and the full employee mirror.
 *
 * Read in that order and indexed in that order. The roster is the one that actually carries job
 * titles; the mirror is read second because it is the only record of somebody on notice or already
 * left, and those people still hold logins that show up in a picker.
 *
 * Both are `get, list: if signedIn()` in `firestore.rules` — the roster's own rule says it "holds no
 * field that [`employees`] does not already expose", so reading it here grants nobody anything new.
 */
const SOURCES = {
  roster: 'greythrCurrentRoster',
  mirror: 'employees',
} as const;

/**
 * The employee master, cached for the session.
 *
 * One pair of reads shared by every picker in the app. It changes when somebody joins, leaves or is
 * promoted — which is to say between sessions, not during one — so a five-minute window costs
 * nothing and saves ~550 document reads per screen. `force` is for a screen that has just written a
 * link and needs to see its own effect.
 */
const CACHE_TTL_MS = 5 * 60_000;
let cache: { at: number; value: EmployeeFactsIndex } | null = null;
let inFlight: Promise<EmployeeFactsIndex> | null = null;

const readRows = async (name: string): Promise<EmployeeFacts[]> => {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<EmployeeFacts, 'id'>) }));
};

export async function loadEmployeeFactsIndex(
  options: { force?: boolean } = {},
): Promise<EmployeeFactsIndex> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  // Several pickers can mount in the same tick; without this they would each start their own read.
  if (!options.force && inFlight) return inFlight;

  const run = (async () => {
    try {
      // Settled rather than all: a tenant that has never run a roster sync has no snapshot
      // collection, and that must not cost us the mirror's rows as well.
      const [roster, mirror] = await Promise.all([
        readRows(SOURCES.roster).catch((err) => {
          console.warn('[people] greytHR roster unreadable; falling back to the employee mirror', err);
          return [] as EmployeeFacts[];
        }),
        readRows(SOURCES.mirror).catch((err) => {
          console.warn('[people] employee mirror unreadable', err);
          return [] as EmployeeFacts[];
        }),
      ]);

      if (!roster.length && !mirror.length) return EMPTY_EMPLOYEE_FACTS_INDEX;

      const index = buildEmployeeFactsIndex(roster, mirror);
      cache = { at: Date.now(), value: index };
      return index;
    } catch (err) {
      // A permissions or network failure must not blank out every person picker in the app: the
      // callers all fall back to the department, then the email.
      console.error('[people] Failed to load employee designations', err);
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
