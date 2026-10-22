'use client';

/**
 * Field Control's history: every save, with who made it, when, the reason given, and each field
 * or sort order it changed.
 *
 * Saves made before change-tracking existed logged only that a save happened; they are listed,
 * marked as having no details. The card itself is the shared settings history.
 */

import { changedAreas, type FieldControlChanges } from '@/lib/site-account-statement-field-control-changes';
import { SettingsHistory, type AuditLogEntry, type SettingsHistoryConfig } from './settings-history';

const changesOf = (log: AuditLogEntry): FieldControlChanges => {
  const changes = log.details?.changes;
  return changes && typeof changes === 'object' ? changes as FieldControlChanges : {};
};

/** The first change in words, and how many more — or that an old entry recorded none. */
function subjectOf(log: AuditLogEntry): string {
  const keys = Object.keys(changesOf(log));
  if (keys.length === 0) return log.details?.changeCount === 0 ? 'No changes' : 'Saved (changes not recorded)';
  const [first] = keys;
  const { from, to } = changesOf(log)[first];
  return `${first}: ${from} → ${to}${keys.length > 1 ? ` (+${keys.length - 1} more)` : ''}`;
}

function reasonOf(log: AuditLogEntry): { text: string; muted?: boolean } {
  const reason = log.details?.reason;
  return { text: typeof reason === 'string' ? reason : '' };
}

/** Every change, one row each, in the opened entry. */
function detailsOf(log: AuditLogEntry): Array<[string, string]> {
  const entries = Object.entries(changesOf(log));
  if (entries.length === 0) return [['Changes', 'Not recorded — saved before changes were tracked']];
  return entries.map(([what, { from, to }]) => [what, `${from} → ${to}`]);
}

/** Module-level, so the shared card's memos see the same config on every render. */
const CONFIG: SettingsHistoryConfig = {
  actions: {
    'Update SAS Field Control': { label: 'Fields changed', tone: 'bg-violet-100 text-violet-900' },
  },
  subjectHeader: 'Change',
  subjectOf,
  reasonOf,
  detailsOf,
  facet: { label: 'Form', anyLabel: 'All forms', valuesOf: log => changedAreas(changesOf(log)) },
  hideScope: true,
  emptyVerb: 'changed',
  searchPlaceholder: 'Search field, form, reason, person…',
  exportName: 'Field Control',
};

export function FieldControlHistory({ refreshKey, defaultOpen }: { refreshKey: number; defaultOpen?: boolean }) {
  return <SettingsHistory config={CONFIG} scopeName="All projects" refreshKey={refreshKey} defaultOpen={defaultOpen} />;
}
