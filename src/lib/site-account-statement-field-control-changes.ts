/**
 * What a Field Control save changed, in words, for the activity log and the page's History card.
 *
 * The log used to record only "Update SAS Field Control" and a count of sorted lists, so nobody
 * could tell afterwards which field had been made optional, hidden or renamed. This compares the
 * settings as last saved with the settings being saved and names each difference.
 *
 * The shape returned — `{ "<what>": { from, to } }` — is the `details.changes` convention the
 * shared audit views already render, so the global Audit Log shows these changes too.
 *
 * Importless, like the module's other domain files: the registries are passed in.
 */

export interface FieldControlSetting {
  visible: boolean;
  required: boolean;
  label: string;
}

export interface FieldControlForm {
  key: string;
  title: string;
  fields: Array<{ key: string; defaultLabel: string; locked?: boolean }>;
}

export type FieldControlChanges = Record<string, { from: string; to: string }>;

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

export function fieldControlChanges({
  forms,
  before,
  after,
  sortBefore,
  sortAfter,
}: {
  forms: FieldControlForm[];
  before: Record<string, Record<string, FieldControlSetting>>;
  after: Record<string, Record<string, FieldControlSetting>>;
  /** Each list's opening sort, described — "Expense Date, Newest first" — keyed by list title. */
  sortBefore: Record<string, string>;
  sortAfter: Record<string, string>;
}): FieldControlChanges {
  const changes: FieldControlChanges = {};
  for (const form of forms) {
    for (const field of form.fields) {
      const was = before[form.key]?.[field.key];
      const now = after[form.key]?.[field.key];
      if (!was || !now) continue;
      const name = `${form.title} · ${field.defaultLabel}`;
      // A locked field's visibility and requirement are fixed; only its label can move.
      if (!field.locked && was.visible !== now.visible) changes[`${name} · Shown`] = { from: yesNo(was.visible), to: yesNo(now.visible) };
      if (!field.locked && was.required !== now.required) changes[`${name} · Required`] = { from: yesNo(was.required), to: yesNo(now.required) };
      if ((was.label || '') !== (now.label || '')) changes[`${name} · Label`] = { from: was.label || '—', to: now.label || '—' };
    }
  }
  for (const list of Object.keys({ ...sortBefore, ...sortAfter })) {
    if (sortBefore[list] !== sortAfter[list]) {
      changes[`${list} · Sort order`] = { from: sortBefore[list] ?? '—', to: sortAfter[list] ?? '—' };
    }
  }
  return changes;
}

/** The forms or lists a set of changes touched — "Add Expense", "Site Expenses" — for the Form filter. */
export function changedAreas(changes: FieldControlChanges | null | undefined): string[] {
  return [...new Set(Object.keys(changes ?? {}).map(key => key.split(' · ')[0]).filter(Boolean))];
}
