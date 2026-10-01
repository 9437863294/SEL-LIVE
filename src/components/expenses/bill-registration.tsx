'use client';

/**
 * Which of the company's own GST registrations a bill belongs to — shared by the screens that
 * capture GST (Expenses › New Request) and the one that verifies it (Daily Requisition › GST & TDS).
 *
 * The rules all live in src/lib/gst-registrations.ts: the registration is worked out by a
 * configurable chain (chosen on the bill → the project's state → the department's → the default),
 * and it is that registration's state — not one hardcoded state — that decides CGST + SGST versus
 * IGST. The company works in seven states, so the single-state assumption was wrong six times out
 * of seven.
 *
 * A company with one registration, or none configured yet, has nothing to choose: `canChoose` is
 * false and every screen leaves the registration out entirely, exactly as before.
 */

import { useMemo } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useGstRegistrations } from '@/components/expenses/use-gst-registrations';
import {
  UNATTRIBUTED,
  checkTreatment,
  registrationLabel,
  resolveAttribution,
  type Attribution,
  type GstRegistration,
} from '@/lib/gst-registrations';
import { cn } from '@/lib/utils';

/** Radix Select cannot hold `''`, so "let the chain decide" needs a value of its own. */
export const AUTO_REGISTRATION = '__auto__';

export interface BillRegistration {
  /** The registrations that may be picked: the active ones, plus whichever this bill already holds. */
  options: GstRegistration[];
  /** The registration this bill belongs to as things stand, and why. */
  attribution: Attribution;
  registration: GstRegistration | null;
  /** What the chain would pick with nothing chosen on the bill — what "automatic" means here. */
  automatic: GstRegistration | null;
  /**
   * The state to judge CGST + SGST versus IGST by, for `suggestGstType` / `statutoryErrors`.
   * `undefined` with no registrations configured at all, which keeps the single-state fallback those
   * two have always used; `''` when registrations exist but this bill is attributed to none, so the
   * treatment is left unjudged rather than judged against someone else's state.
   */
  companyStateCode: string | undefined;
  /** False with one registration or none — there is nothing to choose, so none of this is shown. */
  canChoose: boolean;
  isLoading: boolean;
}

/**
 * The bill's registration, live from the configuration. `gstRegistrationId` is what was chosen on
 * the bill itself (`''` = automatic); the project and department let the rest of the chain resolve.
 */
export function useBillRegistration(input: {
  gstRegistrationId?: string;
  projectId?: string;
  departmentId?: string;
}): BillRegistration {
  const { doc, isLoading } = useGstRegistrations();
  const { gstRegistrationId = '', projectId = '', departmentId = '' } = input;

  return useMemo(() => {
    const { registrations, attribution: config, maps } = doc;
    const find = (id: string) => registrations.find((registration) => registration.id === id) ?? null;

    const attribution = resolveAttribution({ gstRegistrationId, projectId, departmentId }, config, maps, registrations);
    // Resolved a second time with nothing on the bill, so the "automatic" choice can name the
    // registration it would fall back to even while an override is in force.
    const automatic = resolveAttribution({ projectId, departmentId }, config, maps, registrations);
    const registration = find(attribution.registrationId);

    return {
      options: registrations.filter((candidate) => candidate.active || candidate.id === gstRegistrationId),
      attribution,
      registration,
      automatic: find(automatic.registrationId),
      companyStateCode: registrations.length === 0 ? undefined : registration?.stateCode ?? '',
      canChoose: registrations.filter((candidate) => candidate.active).length > 1,
      isLoading,
    };
  }, [doc, gstRegistrationId, projectId, departmentId, isLoading]);
}

/**
 * The picker itself: "automatic" first, naming what the chain resolves to, then every registration
 * that may be chosen instead. Caller-styled, so it fits both the compact form and the dialog.
 */
export function RegistrationSelect({
  id,
  value,
  onValueChange,
  bill,
  className,
  disabled,
}: {
  id?: string;
  /** The registration chosen on the bill; `''` means automatic. */
  value: string;
  onValueChange: (next: string) => void;
  bill: BillRegistration;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || AUTO_REGISTRATION}
      onValueChange={(next) => onValueChange(next === AUTO_REGISTRATION ? UNATTRIBUTED : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn('text-sm', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO_REGISTRATION}>
          {bill.automatic ? `${registrationLabel(bill.automatic)} (automatic)` : 'Not attributed (automatic)'}
        </SelectItem>
        {bill.options.map((registration) => (
          <SelectItem key={registration.id} value={registration.id}>
            {registrationLabel(registration)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * What is wrong with the tax split for these two states, or null. Only ever a warning: an unusual
 * but deliberate treatment is the user's call, not the form's.
 */
export function treatmentWarning(
  bill: BillRegistration,
  supplierGstin: string | undefined,
  gstType: string | undefined,
): { message: string; expected: string } | null {
  if (!bill.canChoose) return null;
  const check = checkTreatment(bill.registration, supplierGstin, gstType);
  return check.ok || !check.message || !check.expected ? null : { message: check.message, expected: check.expected };
}
