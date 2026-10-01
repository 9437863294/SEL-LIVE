'use client';

/**
 * Reads the company's GST registrations and the rules that attribute a bill to one of them.
 *
 * A live subscription rather than a one-off read: the registration a bill is attributed to decides
 * its tax treatment and which return it lands in, so a verification dialog or a report left open
 * while an administrator adds a state has to pick that up — not show a stale list until reload.
 *
 * The document always resolves through `resolveRegistrationsDoc`, so every call site gets a
 * complete `GstRegistrationsDoc`. A missing document, a read denied by rules and a read that
 * errored all give the same thing: no registrations and the shipped attribution chain. That keeps
 * the guard out of every consumer — a page checks `doc.registrations.length`, not `doc`.
 */

import { useEffect, useState } from 'react';
import { doc as docRef, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { resolveRegistrationsDoc, type GstRegistrationsDoc } from '@/lib/gst-registrations';

/** `expensesSettings/gst-registrations` — a document of its own, never merged into module-config. */
export const GST_REGISTRATIONS_PATH = { collection: 'expensesSettings', doc: 'gst-registrations' } as const;

/** Who last saved the document, for the "Last updated by X on …" line. */
export interface GstRegistrationsStamp {
  /** ISO string, or undefined when the document has never been saved. */
  at?: string;
  by?: string;
}

const readStamp = (raw: Record<string, unknown> | undefined): GstRegistrationsStamp => {
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

export function useGstRegistrations(): {
  doc: GstRegistrationsDoc;
  isLoading: boolean;
  /** Extra to the two fields consumers need; the settings page uses it for the stamp line. */
  stamp: GstRegistrationsStamp;
} {
  const [state, setState] = useState<{ doc: GstRegistrationsDoc; stamp: GstRegistrationsStamp }>(() => ({
    doc: resolveRegistrationsDoc(undefined),
    stamp: {},
  }));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      docRef(db, GST_REGISTRATIONS_PATH.collection, GST_REGISTRATIONS_PATH.doc),
      snapshot => {
        const raw = snapshot.data();
        setState({ doc: resolveRegistrationsDoc(raw), stamp: readStamp(raw) });
        setIsLoading(false);
      },
      error => {
        // Without registrations a bill simply has none to be attributed to, which every consumer
        // already handles; rendering nothing instead would take the whole screen down with it.
        console.error('Could not read the GST registrations:', error);
        setState({ doc: resolveRegistrationsDoc(undefined), stamp: {} });
        setIsLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  return { doc: state.doc, isLoading, stamp: state.stamp };
}
