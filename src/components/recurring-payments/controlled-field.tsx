'use client';

import { Label } from '@/components/ui/label';
import type { RPFieldSetting } from './use-field-control';

/**
 * Renders (or hides) one field per the live Field Control setting for its key — the shared
 * label/visibility/required wrapper every Recurring Payments form uses instead of a hardcoded
 * label string. See use-field-control.ts and recurring-payments-field-registry.ts.
 */
export function ControlledField({
  setting,
  children,
  className = 'space-y-1.5',
}: {
  setting: RPFieldSetting;
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

/** Same visibility/label behaviour as ControlledField, for checkbox/switch style rows that don't use a <Label> wrapper. */
export function ControlledToggleLabel({ setting }: { setting: RPFieldSetting }) {
  return (
    <>
      {setting.label}
      {setting.required && <span className="text-destructive"> *</span>}
    </>
  );
}
