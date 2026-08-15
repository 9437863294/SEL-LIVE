'use client';

import { Label } from '@/components/ui/label';
import type { VMFieldSetting } from './use-field-control';

/**
 * Renders (or hides) one field per the live Field Control setting for its key — the shared
 * label/visibility/required wrapper for Vehicle Management forms that don't already have their
 * own richer field wrapper. See use-field-control.ts and vehicle-management-field-registry.ts.
 */
export function ControlledField({
  setting,
  children,
  className = 'space-y-1.5',
}: {
  setting: VMFieldSetting;
  children: React.ReactNode;
  className?: string;
}) {
  if (!setting.visible) return null;
  return (
    <div className={className}>
      <Label>
        {setting.label}
        {setting.required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

/** Same visibility/label behaviour as ControlledField, for checkbox/switch rows that don't use a <Label> wrapper. */
export function ControlledToggleLabel({ setting }: { setting: VMFieldSetting }) {
  return (
    <>
      {setting.label}
      {setting.required && <span className="text-destructive"> *</span>}
    </>
  );
}

/** Computes the "* " / "" suffix used by this module's existing `label="X *"` convention. */
export function labelWithMark(setting: VMFieldSetting) {
  return `${setting.label}${setting.required ? ' *' : ''}`;
}
