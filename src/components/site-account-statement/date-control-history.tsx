'use client';

/**
 * Date Control's history: every change to the all-projects window or a project's own, with who
 * made it, when, the reason given, and what it changed from.
 *
 * Each log entry records the rule as it became. "Before" is the previous entry for the same
 * scope, so it is shown for changes made before the reason field existed too. The card itself is
 * the shared settings history; this says how date-control entries read.
 */

import { SettingsHistory, type AuditLogEntry, type HistoryContext, type SettingsHistoryConfig } from './settings-history';

/** The rule an entry set, in a few words — "7 days back", "No restriction", "Follows all projects". */
function ruleOf(log: AuditLogEntry): string {
  const d = log.details ?? {};
  if (d.follows) return 'Follows all projects';
  if (d.enabled === false) return 'No restriction';
  if (typeof d.backdateDays !== 'number') return '—';
  const back = d.backdateDays === 0 ? 'Today only' : `${d.backdateDays} day${d.backdateDays === 1 ? '' : 's'} back`;
  const ahead = typeof d.futureDays === 'number' && d.futureDays > 0 ? `, ${d.futureDays} ahead` : '';
  return back + ahead;
}

/** Which records the rule covered, when the entry says. */
function appliesTo(log: AuditLogEntry): string | null {
  const d = log.details ?? {};
  if (typeof d.applyToExpenses !== 'boolean' && typeof d.applyToPayments !== 'boolean') return null;
  const parts = [d.applyToExpenses !== false && 'Expenses', d.applyToPayments !== false && 'Receipts'].filter(Boolean);
  return parts.length ? parts.join(' and ') : 'Neither';
}

function reasonOf(log: AuditLogEntry): { text: string; muted?: boolean } {
  const reason = log.details?.reason;
  return { text: typeof reason === 'string' ? reason : '' };
}

function detailsOf(log: AuditLogEntry, { previous }: HistoryContext): Array<[string, string]> {
  const scoped = Boolean(log.details?.scope) && log.details?.scope !== 'All projects';
  const before = previous
    ? ruleOf(previous)
    // A project's first entry: until then it followed the all-projects rule.
    : scoped ? 'Followed all projects' : 'Not recorded';
  const rows: Array<[string, string]> = [['Changed', `${before} → ${ruleOf(log)}`]];
  const applies = appliesTo(log);
  if (applies) rows.push(['Applies to', applies]);
  return rows;
}

/** Module-level, so the shared card's memos see the same config on every render. */
const CONFIG: SettingsHistoryConfig = {
  actions: {
    'Edit SAS Date Control': { label: 'Rule changed', tone: 'bg-emerald-100 text-emerald-900' },
  },
  subjectHeader: 'Rule',
  subjectOf: ruleOf,
  reasonOf,
  detailsOf,
  emptyVerb: 'changed',
  searchPlaceholder: 'Search reason, rule, project, person…',
};

export function DateControlHistory(props: { scopeName: string; scopeProject?: string; refreshKey: number; defaultOpen?: boolean }) {
  return <SettingsHistory config={CONFIG} {...props} />;
}
