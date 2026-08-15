'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { RP_COLLECTIONS } from '@/lib/recurring-payments';
import { RP_FORM_REGISTRY, type RPFormKey } from '@/lib/recurring-payments-field-registry';

export interface RPFieldSetting {
  visible: boolean;
  required: boolean;
  label: string;
}

export type RPFieldControlDoc = Partial<Record<RPFormKey, Record<string, Partial<RPFieldSetting>>>>;

export const fieldControlDocId = (organizationId: string) =>
  `fieldControl_${organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

function defaultsFor(formKey: RPFormKey): Record<string, RPFieldSetting> {
  const result: Record<string, RPFieldSetting> = {};
  for (const field of RP_FORM_REGISTRY[formKey].fields) {
    result[field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
  }
  return result;
}

/**
 * Reads the live, per-organization Field Control configuration for one form and exposes a
 * `field(key)` accessor merging admin overrides on top of the registry's defaults. Locked fields
 * (see recurring-payments-field-registry.ts) ignore any stored visible/required override — only
 * their label can come from settings, so a form can never end up hiding, or making optional, a
 * field its own submit logic still hard-requires.
 */
export function useFieldControl(formKey: RPFormKey) {
  const { user } = useAuth();
  const organizationId = user?.organizationId || 'default';
  const [overrides, setOverrides] = useState<Record<string, Partial<RPFieldSetting>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    return onSnapshot(
      doc(db, RP_COLLECTIONS.settings, fieldControlDocId(organizationId)),
      (snapshot) => {
        const stored = (snapshot.data()?.[formKey] || {}) as Record<string, Partial<RPFieldSetting>>;
        setOverrides(stored);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [organizationId, formKey]);

  const defaults = useMemo(() => defaultsFor(formKey), [formKey]);
  const fieldDefByKey = useMemo(
    () => Object.fromEntries(RP_FORM_REGISTRY[formKey].fields.map((item) => [item.key, item])),
    [formKey],
  );

  function field(key: string): RPFieldSetting {
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
  formKey: RPFormKey,
  values: Record<string, unknown>,
  field: (key: string) => RPFieldSetting,
): string | null {
  for (const def of RP_FORM_REGISTRY[formKey].fields) {
    if (def.locked) continue;
    const setting = field(def.key);
    if (!setting.visible || !setting.required) continue;
    if (isEmptyValue(values[def.key])) return setting.label;
  }
  return null;
}
