/**
 * Field Control registry for Driver Management.
 *
 * The same idea as the Site Account Statement module's: every form here is described as a flat list
 * of fields, and an administrator can override each one's label, whether it is required, and
 * whether it is shown at all — from Settings › Field Control.
 *
 * ── Why this module needed it ───────────────────────────────────────────────────────────────────
 *
 * `TripRules` already carries `requireOdometer`, `allowTollParking` and `requireProject`: three
 * hand-cut switches for three particular fields, added one at a time as somebody asked. Every
 * further request — require the department, hide Notes, call Purpose "Reason for travel" — meant
 * another boolean, another branch in the form and another in the validator. This is that pattern
 * generalised, so the next request is a setting rather than a change.
 *
 * Those three rules keep working and seed the defaults here, so an organisation that configured
 * them sees exactly what it configured.
 *
 * ── Locked fields ───────────────────────────────────────────────────────────────────────────────
 *
 * A field marked `locked` can be relabelled but not hidden or made optional. A field is locked when
 * `validateTrip` enforces it on the server regardless, or when it is what the record *is*: hiding
 * the trip date or the distance would let the form produce a claim that cannot be priced, and
 * optionalising something the server still rejects would trap the user behind an error for a field
 * they can no longer see.
 *
 * Pure: the form, the server validator and the settings screen all read it.
 */

export type ETFormKey = 'trip';

export interface ETFieldDef {
  key: string;
  defaultLabel: string;
  defaultRequired: boolean;
  /** Visible and required are fixed; only the label can be changed. */
  locked?: boolean;
  /** Why it is locked, shown on the settings screen so the lock is not a mystery. */
  lockReason?: string;
}

export interface ETFormDef {
  title: string;
  description: string;
  fields: ETFieldDef[];
}

export const ET_FORM_KEYS: ETFormKey[] = ['trip'];

export const ET_FORM_REGISTRY: Record<ETFormKey, ETFormDef> = {
  trip: {
    title: 'Record a trip',
    description:
      'The form behind Record a trip, Start a GPS trip and the review after a GPS recording — one definition, so a trip needs the same things however it was started.',
    fields: [
      {
        key: 'tripDate',
        defaultLabel: 'Trip date',
        defaultRequired: true,
        locked: true,
        lockReason: 'The rate card is chosen by date, so a trip without one cannot be priced.',
      },
      {
        key: 'ownership',
        defaultLabel: 'Vehicle',
        defaultRequired: true,
        locked: true,
        lockReason: 'Own and company vehicles have different rates. Switch either off under Rules instead.',
      },
      {
        key: 'vehicleType',
        defaultLabel: 'Vehicle type',
        defaultRequired: true,
        locked: true,
        lockReason: 'The per-km rate is set per vehicle type.',
      },
      {
        key: 'vehicleNumber',
        defaultLabel: 'Registration number',
        defaultRequired: true,
        locked: true,
        lockReason: 'Identifies the vehicle on the claim and links a trip to its odometer history.',
      },
      {
        key: 'fromPlace',
        defaultLabel: 'From',
        defaultRequired: true,
        locked: true,
        lockReason: 'The server rejects a trip with no starting place.',
      },
      {
        key: 'toPlace',
        defaultLabel: 'To',
        defaultRequired: true,
        locked: true,
        lockReason: 'The server rejects a trip with no destination.',
      },
      {
        key: 'distance',
        defaultLabel: 'Distance',
        defaultRequired: true,
        locked: true,
        lockReason: 'The claim is distance times the rate. Odometer-or-typed is set under Rules.',
      },
      { key: 'purpose', defaultLabel: 'Purpose', defaultRequired: true },
      { key: 'projectId', defaultLabel: 'Project', defaultRequired: false },
      { key: 'departmentId', defaultLabel: 'Department', defaultRequired: false },
      { key: 'tollAmount', defaultLabel: 'Toll (₹)', defaultRequired: false },
      { key: 'parkingAmount', defaultLabel: 'Parking (₹)', defaultRequired: false },
      { key: 'notes', defaultLabel: 'Notes', defaultRequired: false },
    ],
  },
};

/** What an administrator may override for one field. */
export interface ETFieldSetting {
  visible: boolean;
  required: boolean;
  label: string;
}

export type ETFieldControlDoc = Partial<Record<ETFormKey, Record<string, Partial<ETFieldSetting>>>>;

export const etFieldDef = (formKey: ETFormKey, fieldKey: string): ETFieldDef | undefined =>
  ET_FORM_REGISTRY[formKey]?.fields.find((field) => field.key === fieldKey);

/**
 * What a field should actually do, given the stored overrides.
 *
 * A locked field keeps the registry's `visible` and `required` whatever is stored, so a document
 * written before a field was locked — or edited by hand — cannot hide something the server still
 * demands. The label is always the administrator's if they set one.
 *
 * `seed` carries the three legacy `TripRules` switches, so `requireProject: true` arrives here as
 * Project being required without anybody re-entering it.
 */
export function resolveFieldSetting(
  doc: ETFieldControlDoc | null | undefined,
  formKey: ETFormKey,
  fieldKey: string,
  seed?: { required?: boolean; visible?: boolean },
): ETFieldSetting {
  const def = etFieldDef(formKey, fieldKey);
  const stored = doc?.[formKey]?.[fieldKey];

  const label = typeof stored?.label === 'string' && stored.label.trim()
    ? stored.label.trim()
    : def?.defaultLabel ?? fieldKey;

  if (def?.locked) {
    return { visible: true, required: def.defaultRequired, label };
  }

  return {
    visible:
      typeof stored?.visible === 'boolean' ? stored.visible : seed?.visible ?? true,
    required:
      typeof stored?.required === 'boolean'
        ? stored.required
        : seed?.required ?? def?.defaultRequired ?? false,
    label,
  };
}

/**
 * Every field of a form, resolved.
 *
 * Returned in registry order rather than the stored document's, so adding a field to the registry
 * puts it on the screen without a migration, and a stale key left in Firestore is ignored.
 */
export function resolveForm(
  doc: ETFieldControlDoc | null | undefined,
  formKey: ETFormKey,
  seeds: Record<string, { required?: boolean; visible?: boolean }> = {},
): Array<ETFieldDef & ETFieldSetting> {
  return (ET_FORM_REGISTRY[formKey]?.fields ?? []).map((def) => ({
    ...def,
    ...resolveFieldSetting(doc, formKey, def.key, seeds[def.key]),
  }));
}

/**
 * The legacy `TripRules` switches, expressed as seeds for the fields they governed.
 *
 * Kept as a translation rather than a migration: the rules are still enforced server-side, and
 * rewriting them into a new document would mean two places to read and one to forget.
 */
export function seedsFromRules(rules: {
  requireProject?: boolean;
  allowTollParking?: boolean;
}): Record<string, { required?: boolean; visible?: boolean }> {
  return {
    projectId: { required: rules.requireProject === true },
    tollAmount: { visible: rules.allowTollParking !== false },
    parkingAmount: { visible: rules.allowTollParking !== false },
  };
}
