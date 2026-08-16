'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { PM_FORM_REGISTRY, type PMFormKey } from '@/lib/project-management-field-registry';

export interface PMFieldSetting {
  visible: boolean;
  required: boolean;
  label: string;
}

export const PM_SETTINGS_COLLECTION = 'projectManagementSettings';
export const PM_FIELD_CONTROL_DOC_ID = 'fieldControl';

function defaultsFor(formKey: PMFormKey): Record<string, PMFieldSetting> {
  const result: Record<string, PMFieldSetting> = {};
  for (const field of PM_FORM_REGISTRY[formKey].fields) {
    result[field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
  }
  return result;
}

/**
 * Reads the live, org-wide Field Control configuration for one form and exposes a `field(key)`
 * accessor merging admin overrides on top of the registry's defaults. Locked fields (see
 * project-management-field-registry.ts) ignore any stored visible/required override — only
 * their label can come from settings, so a form can never end up hiding, or making optional, a
 * field its own submit logic still hard-requires.
 */
export function useFieldControl(formKey: PMFormKey) {
  const [overrides, setOverrides] = useState<Record<string, Partial<PMFieldSetting>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    return onSnapshot(
      doc(db, PM_SETTINGS_COLLECTION, PM_FIELD_CONTROL_DOC_ID),
      (snapshot) => {
        const stored = (snapshot.data()?.[formKey] || {}) as Record<string, Partial<PMFieldSetting>>;
        setOverrides(stored);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [formKey]);

  const defaults = useMemo(() => defaultsFor(formKey), [formKey]);
  const fieldDefByKey = useMemo(
    () => Object.fromEntries(PM_FORM_REGISTRY[formKey].fields.map((item) => [item.key, item])),
    [formKey],
  );

  function field(key: string): PMFieldSetting {
    const base = defaults[key] || { visible: true, required: false, label: key };
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
  return false;
}

/**
 * Checks every non-locked, visible+required field of a form against a plain values object and
 * returns the label of the first one that's missing, or null if everything configured as
 * required is filled in. Locked fields are skipped here because the form's own hardcoded submit
 * checks already cover them.
 */
export function validateFieldControlRequirements(
  formKey: PMFormKey,
  values: Record<string, unknown>,
  field: (key: string) => PMFieldSetting,
): string | null {
  for (const def of PM_FORM_REGISTRY[formKey].fields) {
    if (def.locked) continue;
    const setting = field(def.key);
    if (!setting.visible || !setting.required) continue;
    if (isEmptyValue(values[def.key])) return setting.label;
  }
  return null;
}
