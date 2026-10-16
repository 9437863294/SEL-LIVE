'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { RP_COLLECTIONS } from '@/lib/recurring-payments';
import { resolveListSort, sortListRows, type SortDirection, type SortField, type SortSetting } from '@/lib/list-sort';
import { RP_LIST_REGISTRY, sortControlDocId, type RPListKey, type RPSortControlDoc } from '@/lib/recurring-payments-sort-registry';

export interface ListSortControl {
  /** The order applied now — the configured default until the user picks one this session. */
  sort: SortSetting;
  setField: (field: string) => void;
  toggleDirection: () => void;
  /** Back to the order the administrator configured. */
  reset: () => void;
  fields: SortField[];
  atConfiguredDefault: boolean;
  sortRows: <T>(rows: T[]) => T[];
}

/**
 * The order one Recurring Payments list opens in (Settings › Field Control › Sort Order), combined
 * with the user's own in-session choice. The configured default is watched live but only moves the
 * list while the user hasn't picked an order — an administrator saving a new default must not pull
 * a column out from under someone mid-task.
 */
export function useRecurringSortControl(listKey: RPListKey): ListSortControl {
  const { user } = useAuth();
  const organizationId = user?.organizationId || 'default';
  const [stored, setStored] = useState<RPSortControlDoc | null>(null);
  const [override, setOverride] = useState<SortSetting | null>(null);

  useEffect(
    () =>
      onSnapshot(
        doc(db, RP_COLLECTIONS.settings, sortControlDocId(organizationId)),
        (snapshot) => setStored((snapshot.data() as RPSortControlDoc | undefined) ?? {}),
        // A failed read leaves the registry default in force, which is the safe fallback.
        () => undefined,
      ),
    [organizationId],
  );

  const configured = useMemo(() => resolveListSort(RP_LIST_REGISTRY, listKey, stored), [listKey, stored]);
  const sort = override ?? configured;

  const setField = useCallback(
    (field: string) => setOverride((prev) => ({ field, direction: (prev ?? configured).direction })),
    [configured],
  );
  const toggleDirection = useCallback(
    () =>
      setOverride((prev) => {
        const base = prev ?? configured;
        const direction: SortDirection = base.direction === 'asc' ? 'desc' : 'asc';
        return { field: base.field, direction };
      }),
    [configured],
  );
  const reset = useCallback(() => setOverride(null), []);
  const sortRows = useCallback(<T,>(rows: T[]) => sortListRows(RP_LIST_REGISTRY, rows, listKey, sort), [listKey, sort]);

  return {
    sort,
    setField,
    toggleDirection,
    reset,
    fields: RP_LIST_REGISTRY[listKey].fields,
    atConfiguredDefault: sort.field === configured.field && sort.direction === configured.direction,
    sortRows,
  };
}
