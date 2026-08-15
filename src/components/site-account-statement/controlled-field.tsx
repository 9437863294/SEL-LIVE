'use client';

import { Label } from '@/components/ui/label';
import type { SASFieldSetting } from './use-field-control';

/**
 * Renders (or hides) one field per the live Field Control setting for its key — the shared
 * label/visibility/required wrapper Site Account Statement forms use instead of a hardcoded
 * label string. See use-field-control.ts and site-account-statement-field-registry.ts.
 */
export function ControlledField({
  setting,
  children,
  className = 'space-y-1.5',
}: {
  setting: SASFieldSetting;
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
export function ControlledToggleLabel({ setting }: { setting: SASFieldSetting }) {
  return (
    <>
      {setting.label}
      {setting.required && <span className="text-destructive"> *</span>}
    </>
  );
}

/** Renders `*` or `(optional)` after a label, matching this module's existing fieldMark() convention. */
export function fieldMark(setting: SASFieldSetting) {
  return setting.required
    ? <span className="text-destructive">*</span>
    : <span className="text-muted-foreground text-xs font-normal">(optional)</span>;
}
