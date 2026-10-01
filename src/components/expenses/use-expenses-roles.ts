'use client';

/**
 * Reads the Expenses module's own "who does what" document — who acts on each of the module's
 * actions, what they act on, and who stands in for them.
 *
 * A live subscription rather than a one-off read, for the same reason the GST registrations are
 * one: two of the three authority modes actually decide who may act, so a register or a form left
 * open while an administrator reassigns an action has to pick that up rather than keep enforcing
 * yesterday's assignment until the tab is reloaded.
 *
 * The document always resolves through `resolveExpensesRolesDoc`, so every call site gets a
 * complete `ExpensesRolesDoc` with an entry for every action. A missing document, a read denied by
 * rules and a read that errored all give the same thing: every action on `roles-only` with nobody
 * assigned — which is exactly "nothing is configured, roles decide", the shipped behaviour. That
 * keeps the guard out of every consumer, and means a read failure can never narrow access.
 */

import { useEffect, useState } from 'react';
import { doc as docRef, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { resolveExpensesRolesDoc, type ExpensesRolesDoc } from '@/lib/expenses-roles';

/** `expensesSettings/user-roles` — a document of its own, never merged into module-config. */
export const EXPENSES_ROLES_PATH = { collection: 'expensesSettings', doc: 'user-roles' } as const;

/** Who last saved the document, for the "Last updated by X on …" line. */
export interface ExpensesRolesStamp {
  /** ISO string, or undefined when the document has never been saved. */
  at?: string;
  by?: string;
}

const readStamp = (raw: Record<string, unknown> | undefined): ExpensesRolesStamp => {
  if (!raw) return {};
  const value = raw.updatedAt as { toDate?: () => Date } | string | undefined;
  let at: string | undefined;
  if (value && typeof value === 'object' && typeof value.toDate === 'function') {
    at = value.toDate().toISOString();
  } else if (typeof value === 'string' && value) {
    at = value;
  }
  const by = (raw.updatedByName as string) || (raw.updatedById as string) || undefined;
  return { at, by };
};

export function useExpensesRoles(): {
  doc: ExpensesRolesDoc;
  isLoading: boolean;
  /** Extra to the two fields consumers need; the settings page uses it for the stamp line. */
  stamp: ExpensesRolesStamp;
} {
  const [state, setState] = useState<{ doc: ExpensesRolesDoc; stamp: ExpensesRolesStamp }>(() => ({
    doc: resolveExpensesRolesDoc(undefined),
    stamp: {},
  }));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      docRef(db, EXPENSES_ROLES_PATH.collection, EXPENSES_ROLES_PATH.doc),
      snapshot => {
        const raw = snapshot.data();
        setState({ doc: resolveExpensesRolesDoc(raw), stamp: readStamp(raw) });
        setIsLoading(false);
      },
      error => {
        // Falling back to the resolved default leaves every action on `roles-only`, so a read
        // failure here can only ever mean "roles decide" — never a narrower set of people than
        // the module had a moment ago.
        console.error('Could not read the Expenses user roles:', error);
        setState({ doc: resolveExpensesRolesDoc(undefined), stamp: {} });
        setIsLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  return { doc: state.doc, isLoading, stamp: state.stamp };
}
