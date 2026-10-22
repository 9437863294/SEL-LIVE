'use client';

/**
 * Month Closure's history: every close, reopen, bulk close, project exception cleared and
 * automatic-rule change, with who did it, when, and the note or reason they gave.
 *
 * The month cards show only each month's latest state, and closing a month again clears the
 * reopen reason from its card — so on its own the page had no record of what happened before.
 * The card itself is the shared settings history; this says how closure entries read.
 */

import { periodLabel } from '@/lib/site-account-statement-period-range';
import { SettingsHistory, type AuditLogEntry, type SettingsHistoryConfig } from './settings-history';

/** The months an entry touched, as `YYYY-MM` keys — one, or a bulk close's list. */
function periodsOf(log: AuditLogEntry): string[] {
  const d = log.details ?? {};
  if (typeof d.period === 'string' && d.period) return [d.period];
  if (typeof d.periods === 'string' && d.periods) return d.periods.split(',').map((p: string) => p.trim()).filter(Boolean);
  if (typeof d.through === 'string' && d.through) return [d.through];
  return [];
}

function monthsOf(log: AuditLogEntry): string {
  const d = log.details ?? {};
  if (typeof d.period === 'string' && d.period) return periodLabel(d.period);
  if (typeof d.through === 'string' && d.through) {
    return `${d.count ?? ''} month${d.count === 1 ? '' : 's'} through ${periodLabel(d.through)}`.trim();
  }
  return '—';
}

/** The words the person gave — a reopen reason, a closing note — or what the rule became. */
function reasonOf(log: AuditLogEntry): { text: string; muted?: boolean } {
  const d = log.details ?? {};
  if (typeof d.reason === 'string' && d.reason) return { text: d.reason };
  if (typeof d.note === 'string' && d.note) return { text: d.note };
  if (typeof d.rule === 'string' && d.rule) return { text: `Rule: ${d.rule}`, muted: true };
  return { text: '' };
}

function detailsOf(log: AuditLogEntry): Array<[string, string]> {
  const d = log.details ?? {};
  const rows: Array<[string, string]> = [];
  const months = periodsOf(log);
  if (months.length > 1) rows.push(['Months', months.map(periodLabel).join(', ')]);
  if (typeof d.relockOn === 'string' && d.relockOn) {
    rows.push(['Locks again on', d.relockOn === 'none' ? 'No limit — stays open until closed' : d.relockOn]);
  }
  if (typeof d.rule === 'string' && d.rule && typeof d.reason === 'string' && d.reason) rows.push(['Rule', d.rule]);
  return rows;
}

/** Module-level, so the shared card's memos see the same config on every render. */
const CONFIG: SettingsHistoryConfig = {
  actions: {
    'Close SAS Month':            { label: 'Closed',               tone: 'bg-slate-100 text-slate-800' },
    'Close SAS Months (bulk)':    { label: 'Closed (bulk)',        tone: 'bg-slate-100 text-slate-800' },
    'Reopen SAS Month':           { label: 'Reopened',             tone: 'bg-amber-100 text-amber-900' },
    'Clear SAS Month Exception':  { label: 'Follows all projects', tone: 'bg-sky-100 text-sky-900' },
    'Change SAS Auto-Close Rule': { label: 'Auto-close rule',      tone: 'bg-indigo-100 text-indigo-900' },
  },
  subjectHeader: 'Month',
  subjectOf: monthsOf,
  reasonOf,
  facet: { label: 'Month', anyLabel: 'All months', valuesOf: periodsOf, labelOf: periodLabel, descending: true },
  detailsOf,
  emptyVerb: 'closed or reopened',
  searchPlaceholder: 'Search reason, month, project, person…',
  exportName: 'Month Closure',
};

export function MonthClosureHistory(props: { scopeName: string; scopeProject?: string; refreshKey: number; defaultOpen?: boolean }) {
  return <SettingsHistory config={CONFIG} {...props} />;
}
