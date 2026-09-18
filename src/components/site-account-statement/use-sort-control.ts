'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SAS_COLLECTIONS, SAS_SORT_CONTROL_DOC_ID } from '@/lib/site-account-statement';
import {
  isDefaultSort,
  resolveSort,
  sortRows as sortRowsWith,
  SAS_LIST_REGISTRY,
  type SASListKey,
  type SASSortControlDoc,
  type SASSortDirection,
  type SASSortSetting,
} from '@/lib/site-account-statement-sort-registry';

export interface SortControl {
  /** The order currently applied — the admin default until the user changes it this session. */
  sort: SASSortSetting;
  setField: (field: string) => void;
  setDirection: (direction: SASSortDirection) => void;
  toggleDirection: () => void;
  /** Back to whatever the administrator configured. */
  reset: () => void;
  /** The columns this list allows sorting on. */
  fields: typeof SAS_LIST_REGISTRY[SASListKey]['fields'];
  /** True while the applied order still equals the configured default. */
  atConfiguredDefault: boolean;
  /** True while the applied order equals the registry default — what the server already returns. */
  atRegistryDefault: boolean;
  sortRows: <T>(rows: T[]) => T[];
  loading: boolean;
}

/**
 * The sort order for one list, combining the org-wide configured default with the user's own
 * in-session choice.
 *
 * The configured default is watched live, but it only moves the list while the user has not picked
 * an order themselves — an administrator saving a new default must not yank a column out from under
 * someone mid-task.
 */
export function useSortControl(listKey: SASListKey): SortControl {
  const [stored, setStored] = useState<SASSortControlDoc | null>(null);
  const [loading, setLoading] = useState(true);
  /** Null until the user picks an order; the configured default applies until then. */
  const [override, setOverride] = useState<SASSortSetting | null>(null);

  useEffect(() => {
    return onSnapshot(
      doc(db, SAS_COLLECTIONS.settings, SAS_SORT_CONTROL_DOC_ID),
      (snapshot) => {
        setStored((snapshot.data() as SASSortControlDoc | undefined) ?? {});
        setLoading(false);
      },
      // A read failure must not leave a list unsorted; the registry default still applies.
      () => setLoading(false),
    );
  }, []);

  const configured = useMemo(() => resolveSort(listKey, stored), [listKey, stored]);
  const sort = override ?? configured;

  const setField = useCallback((field: string) => {
    setOverride(prev => ({ field, direction: (prev ?? configured).direction }));
  }, [configured]);

  const setDirection = useCallback((direction: SASSortDirection) => {
    setOverride(prev => ({ field: (prev ?? configured).field, direction }));
  }, [configured]);

  const toggleDirection = useCallback(() => {
    setOverride(prev => {
      const base = prev ?? configured;
      return { field: base.field, direction: base.direction === 'asc' ? 'desc' : 'asc' };
    });
  }, [configured]);

  const reset = useCallback(() => setOverride(null), []);

  // Depends on `sort` itself, not its destructured parts: it is either the memoized `configured`
  // or the `override` state object, so it is already referentially stable, and naming the whole
  // thing is what lets the compiler keep the memoization.
  const sortRows = useCallback(
    <T,>(rows: T[]) => sortRowsWith(rows, listKey, sort),
    [listKey, sort],
  );

  return {
    sort,
    setField,
    setDirection,
    toggleDirection,
    reset,
    fields: SAS_LIST_REGISTRY[listKey].fields,
    atConfiguredDefault: sort.field === configured.field && sort.direction === configured.direction,
    atRegistryDefault: isDefaultSort(listKey, sort),
    sortRows,
    loading,
  };
}
