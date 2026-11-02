'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BB_CONTROL_DOCS, BB_SETTINGS_COLLECTION } from '@/lib/bank-balance-entry-controls';
import {
  BB_LIST_REGISTRY,
  fieldLabel,
  missingRequiredField,
  resolveBBSort,
  resolveFormFields,
  sortBBRows,
  type BBFieldControlDoc,
  type BBFieldSetting,
  type BBFormKey,
  type BBListKey,
  type BBSortControlDoc,
} from '@/lib/bank-balance-field-registry';
import type { SASSortDirection, SASSortSetting } from '@/lib/site-account-statement-sort-registry';

/**
 * Field Control for one Bank Balance form, live. `field(key)` is the setting to render with,
 * `label(key, contextual)` the label to show, and `missing(values)` the first required field left
 * empty. A read failure leaves the registry defaults in force — the form still works as it always
 * did — rather than blocking it.
 *
 * The payment form also reads the old Payment Entry switches, which stay the default for those
 * fields until Field Control is saved.
 */
export function useBBFieldControl(formKey: BBFormKey) {
  const [stored, setStored] = useState<BBFieldControlDoc[BBFormKey]>(undefined);
  const [legacy, setLegacy] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onSnapshot(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.fieldControl),
        (snapshot) => {
          setStored((snapshot.data() as BBFieldControlDoc | undefined)?.[formKey]);
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [formKey],
  );

  useEffect(() => {
    if (formKey !== 'payment') return;
    return onSnapshot(
      doc(db, BB_SETTINGS_COLLECTION, 'paymentEntry'),
      (snapshot) => setLegacy((snapshot.data()?.mandatoryFields as Record<string, unknown> | undefined) ?? null),
      () => setLegacy(null),
    );
  }, [formKey]);

  const fields = useMemo(() => resolveFormFields(formKey, stored, legacy), [formKey, stored, legacy]);

  const field = useCallback(
    (key: string): BBFieldSetting => fields[key] ?? { visible: true, required: false, label: key },
    [fields],
  );
  const label = useCallback((key: string, contextual?: string) => fieldLabel(formKey, key, fields[key], contextual), [formKey, fields]);
  const missing = useCallback(
    (values: Record<string, unknown>, only?: string[]) => missingRequiredField(formKey, values, fields, only),
    [formKey, fields],
  );

  return { fields, field, label, missing, loading };
}

/** The `*` after a required field's label. */
export const requiredMark = (setting: BBFieldSetting) => (setting.required ? ' *' : '');

/**
 * One list's sort: the administrator's opening order from Field Control › Sort order, which the
 * viewer can change for themselves without changing anyone else's.
 */
export function useBBSortControl(listKey: BBListKey) {
  const [stored, setStored] = useState<BBSortControlDoc | null>(null);
  const [override, setOverride] = useState<SASSortSetting | null>(null);

  useEffect(
    () =>
      onSnapshot(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.sortControl),
        (snapshot) => setStored((snapshot.data() as BBSortControlDoc | undefined) ?? {}),
        // A read failure leaves the registry default in force.
        () => setStored({}),
      ),
    [],
  );

  const configured = useMemo(() => resolveBBSort(listKey, stored), [listKey, stored]);
  const sort = override ?? configured;

  return {
    sort,
    fields: BB_LIST_REGISTRY[listKey].fields,
    setField: (fieldKey: string) => setOverride({ field: fieldKey, direction: sort.direction }),
    setDirection: (direction: SASSortDirection) => setOverride({ field: sort.field, direction }),
    toggleDirection: () => setOverride({ field: sort.field, direction: sort.direction === 'asc' ? 'desc' : 'asc' }),
    reset: () => setOverride(null),
    atConfiguredDefault: sort.field === configured.field && sort.direction === configured.direction,
    sortRows: <T,>(rows: T[], tiebreak?: (a: T, b: T) => number) => sortBBRows(rows, listKey, sort, tiebreak),
  };
}
