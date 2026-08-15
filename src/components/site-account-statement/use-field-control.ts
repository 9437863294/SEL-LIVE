'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SAS_COLLECTIONS, SAS_FIELD_CONTROL_DOC_ID } from '@/lib/site-account-statement';
import { SAS_FORM_REGISTRY, type SASFormKey } from '@/lib/site-account-statement-field-registry';

export interface SASFieldSetting {
  visible: boolean;
  required: boolean;
  label: string;
}

/**
 * A stored field value is either the pre-existing plain boolean (the old Add Expense / Add
 * Receipt "mandatory" flag) or the new `{visible, required, label}` shape. Both are accepted so
 * organizations that already configured the old Field Control page keep their settings.
 */
type StoredFieldValue = boolean | Partial<SASFieldSetting> | undefined;

export type SASFieldControlDoc = Partial<Record<SASFormKey, Record<string, StoredFieldValue>>>;

function defaultsFor(formKey: SASFormKey): Record<string, SASFieldSetting> {
  const result: Record<string, SASFieldSetting> = {};
  for (const field of SAS_FORM_REGISTRY[formKey].fields) {
    result[field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
  }
  return result;
}

/**
 * Reads the live, org-wide Field Control configuration for one form and exposes a `field(key)`
 * accessor merging admin overrides on top of the registry's defaults. Locked fields (see
 * site-account-statement-field-registry.ts) ignore any stored visible/required override — only
 * their label can come from settings, so a form can never end up hiding, or making optional, a
 * field its own submit logic still hard-requires.
 */
export function useFieldControl(formKey: SASFormKey) {
  const [overrides, setOverrides] = useState<Record<string, StoredFieldValue>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    return onSnapshot(
      doc(db, SAS_COLLECTIONS.settings, SAS_FIELD_CONTROL_DOC_ID),
      (snapshot) => {
        const stored = (snapshot.data()?.[formKey] || {}) as Record<string, StoredFieldValue>;
        setOverrides(stored);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [formKey]);

  const defaults = useMemo(() => defaultsFor(formKey), [formKey]);
  const fieldDefByKey = useMemo(
    () => Object.fromEntries(SAS_FORM_REGISTRY[formKey].fields.map((item) => [item.key, item])),
    [formKey],
  );

  function field(key: string): SASFieldSetting {
    const base = defaults[key] || { visible: true, required: false, label: key };
    const def = fieldDefByKey[key];
    const override = overrides[key];
    if (override === undefined) return base;
    // Legacy shape: a plain boolean was the old "mandatory" flag.
    if (typeof override === 'boolean') {
      return def?.locked ? base : { ...base, required: override };
    }
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
 * Checks every non-locked, visible+required field of a form against a plain values object (a
 * FormData entries object, or a controlled-form state object — anything keyed the same as the
 * form's registry field keys) and returns the label of the first one that's missing, or null if
 * everything configured as required is filled in. Locked fields are skipped here because the
 * form's own hardcoded submit checks already cover them.
 */
export function validateFieldControlRequirements(
  formKey: SASFormKey,
  values: Record<string, unknown>,
  field: (key: string) => SASFieldSetting,
): string | null {
  for (const def of SAS_FORM_REGISTRY[formKey].fields) {
    if (def.locked) continue;
    const setting = field(def.key);
    if (!setting.visible || !setting.required) continue;
    if (isEmptyValue(values[def.key])) return setting.label;
  }
  return null;
}
