'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { VM_FORM_REGISTRY, type VMFormKey } from '@/lib/vehicle-management-field-registry';

export interface VMFieldSetting {
  visible: boolean;
  required: boolean;
  label: string;
}

export const VEHICLE_FIELD_CONTROL_DOC_ID = 'fieldControl';

function defaultsFor(formKey: VMFormKey): Record<string, VMFieldSetting> {
  const result: Record<string, VMFieldSetting> = {};
  for (const field of VM_FORM_REGISTRY[formKey].fields) {
    result[field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
  }
  return result;
}

/**
 * Reads the live, org-wide Field Control configuration for one form and exposes a `field(key)`
 * accessor merging admin overrides on top of the registry's defaults. Locked fields (see
 * vehicle-management-field-registry.ts) ignore any stored visible/required override — only
 * their label can come from settings, so a form can never end up hiding, or making optional, a
 * field its own submit logic still hard-requires.
 *
 * `formKey` is optional because `GenericCrudPage` (the component this hook is primarily built
 * for) is also reused by other, unrelated modules (Letter of Credit, Employee Trip
 * Reimbursement) that don't have a Field Control registry — passing no `formKey` makes `field()`
 * a pure passthrough (`visible: true`, unmodified `required`/`label`) so those callers behave
 * exactly as before.
 */
export function useFieldControl(formKey?: VMFormKey) {
  const [overrides, setOverrides] = useState<Record<string, Partial<VMFieldSetting>>>({});
  const [loading, setLoading] = useState(!!formKey);

  useEffect(() => {
    if (!formKey) return;
    setLoading(true);
    return onSnapshot(
      doc(db, VEHICLE_COLLECTIONS.settings, VEHICLE_FIELD_CONTROL_DOC_ID),
      (snapshot) => {
        const stored = (snapshot.data()?.[formKey] || {}) as Record<string, Partial<VMFieldSetting>>;
        setOverrides(stored);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [formKey]);

  const defaults = useMemo(() => (formKey ? defaultsFor(formKey) : {}), [formKey]);
  const fieldDefByKey = useMemo(
    () => (formKey ? Object.fromEntries(VM_FORM_REGISTRY[formKey].fields.map((item) => [item.key, item])) : {}),
    [formKey],
  );

  function field(key: string): VMFieldSetting {
    const base = defaults[key] || { visible: true, required: false, label: key };
    if (!formKey) return base;
    const def = fieldDefByKey[key];
    const override = overrides[key];
    if (!override) return base;
    if (def?.locked) return { ...base, label: override.label || base.label };
    return {
      visible: override.visible ?? base.visible,
      required: override.required ?? base.required,
      label: override.label || base.label,
    };
  }

  return { field, loading };
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'boolean' || typeof value === 'number') return false;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof File) return !value.size;
  return false;
}

/**
 * Checks every non-locked, visible+required field of a form against a plain values object and
 * returns the label of the first one that's missing, or null if everything configured as
 * required is filled in. Locked fields are skipped here because the form's own hardcoded submit
 * checks already cover them.
 */
export function validateFieldControlRequirements(
  formKey: VMFormKey,
  values: Record<string, unknown>,
  field: (key: string) => VMFieldSetting,
): string | null {
  for (const def of VM_FORM_REGISTRY[formKey].fields) {
    if (def.locked) continue;
    const setting = field(def.key);
    if (!setting.visible || !setting.required) continue;
    if (isEmptyValue(values[def.key])) return setting.label;
  }
  return null;
}
