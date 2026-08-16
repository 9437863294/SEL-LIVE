'use client';

import { Label } from '@/components/ui/label';
import type { PMFieldSetting } from './use-field-control';

/**
 * Renders (or hides) one field per the live Field Control setting for its key. See
 * use-field-control.ts and project-management-field-registry.ts.
 */
export function ControlledField({
  setting,
  children,
  className = 'space-y-1.5',
}: {
  setting: PMFieldSetting;
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

/** Computes the "* " / "" suffix used by this module's existing `label="X *"` convention. */
export function labelWithMark(setting: PMFieldSetting) {
  return `${setting.label}${setting.required ? ' *' : ''}`;
}
