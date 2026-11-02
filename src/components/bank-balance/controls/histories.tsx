'use client';

/**
 * The History tab of each Bank Balance control: Site Account's settings history card, reading the
 * entries these pages write to the activity log, with accounts where Site Account has projects.
 */

import { changedAreas, type FieldControlChanges } from '@/lib/site-account-statement-field-control-changes';
import { periodLabel } from '@/lib/site-account-statement-period-range';
import { ALL_ACCOUNTS_LABEL } from '@/lib/bank-balance-entry-controls';
import {
  SettingsHistory,
  type AuditLogEntry,
  type HistoryContext,
  type SettingsHistoryConfig,
} from '@/components/site-account-statement/settings-history';

/** The activity names the three pages write. Bank Balance's own, so no module filter is needed. */
export const BB_CONTROL_ACTIONS = {
  fieldControl: 'Update Bank Field Control',
  dateControl: 'Edit Bank Date Control',
  closeMonth: 'Close Bank Month',
  closeMonths: 'Close Bank Months (bulk)',
  reopenMonth: 'Reopen Bank Month',
  clearException: 'Clear Bank Month Exception',
  autoRule: 'Change Bank Auto-Close Rule',
} as const;

const SCOPE = { scopeLabel: 'Account', allScopeLabel: ALL_ACCOUNTS_LABEL } as const;
const reasonOnly = (log: AuditLogEntry) => ({ text: typeof log.details?.reason === 'string' ? log.details.reason : '' });

// ── Field Control ────────────────────────────────────────────────────────────────────────────

const changesOf = (log: AuditLogEntry): FieldControlChanges => {
  const changes = log.details?.changes;
  return changes && typeof changes === 'object' ? (changes as FieldControlChanges) : {};
};

const FIELD_CONFIG: SettingsHistoryConfig = {
  actions: { [BB_CONTROL_ACTIONS.fieldControl]: { label: 'Fields changed', tone: 'bg-violet-100 text-violet-900' } },
  subjectHeader: 'Change',
  subjectOf: (log) => {
    const keys = Object.keys(changesOf(log));
    if (keys.length === 0) return 'No changes';
    const { from, to } = changesOf(log)[keys[0]];
    return `${keys[0]}: ${from} → ${to}${keys.length > 1 ? ` (+${keys.length - 1} more)` : ''}`;
  },
  reasonOf: reasonOnly,
  detailsOf: (log) => {
    const entries = Object.entries(changesOf(log));
    return entries.length ? entries.map(([what, { from, to }]) => [what, `${from} → ${to}`]) : [['Changes', 'None']];
  },
  facet: { label: 'Form', anyLabel: 'All forms', valuesOf: (log) => changedAreas(changesOf(log)) },
  hideScope: true,
  emptyVerb: 'changed',
  searchPlaceholder: 'Search field, form, reason, person…',
  exportName: 'Bank Field Control',
  ...SCOPE,
};

export function BankFieldControlHistory({ refreshKey }: { refreshKey: number }) {
  return <SettingsHistory config={FIELD_CONFIG} scopeName={ALL_ACCOUNTS_LABEL} refreshKey={refreshKey} defaultOpen />;
}

// ── Date Control ─────────────────────────────────────────────────────────────────────────────

function ruleOf(log: AuditLogEntry): string {
  const d = log.details ?? {};
  if (d.follows) return 'Follows all accounts';
  if (d.enabled === false) return 'No restriction';
  if (typeof d.backdateDays !== 'number') return '—';
  const back = d.backdateDays === 0 ? 'Today only' : `${d.backdateDays} day${d.backdateDays === 1 ? '' : 's'} back`;
  const ahead = typeof d.futureDays === 'number' && d.futureDays > 0 ? `, ${d.futureDays} ahead` : '';
  const cheques = typeof d.postDatedDays === 'number' ? `, cheques ${d.postDatedDays} ahead` : '';
  return back + ahead + cheques;
}

function appliesTo(log: AuditLogEntry): string | null {
  const d = log.details ?? {};
  if (typeof d.applyToPayments !== 'boolean') return null;
  const parts = [d.applyToPayments && 'Payments', d.applyToReceipts && 'Receipts', d.applyToTransfers && 'Transfers'].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Nothing';
}

const DATE_CONFIG: SettingsHistoryConfig = {
  actions: { [BB_CONTROL_ACTIONS.dateControl]: { label: 'Rule changed', tone: 'bg-emerald-100 text-emerald-900' } },
  subjectHeader: 'Rule',
  subjectOf: ruleOf,
  reasonOf: reasonOnly,
  detailsOf: (log: AuditLogEntry, { previous }: HistoryContext) => {
    const scoped = Boolean(log.details?.scope) && log.details?.scope !== ALL_ACCOUNTS_LABEL;
    const before = previous ? ruleOf(previous) : scoped ? 'Followed all accounts' : 'Not recorded';
    const rows: Array<[string, string]> = [['Changed', `${before} → ${ruleOf(log)}`]];
    const applies = appliesTo(log);
    if (applies) rows.push(['Applies to', applies]);
    return rows;
  },
  emptyVerb: 'changed',
  searchPlaceholder: 'Search reason, rule, account, person…',
  exportName: 'Bank Date Control',
  ...SCOPE,
};

export function BankDateControlHistory(props: { scopeName: string; scopeAccount?: string; refreshKey: number }) {
  return <SettingsHistory config={DATE_CONFIG} scopeName={props.scopeName} scopeProject={props.scopeAccount} refreshKey={props.refreshKey} defaultOpen />;
}

// ── Month Closure ────────────────────────────────────────────────────────────────────────────

function periodsOf(log: AuditLogEntry): string[] {
  const d = log.details ?? {};
  if (typeof d.period === 'string' && d.period) return [d.period];
  if (typeof d.periods === 'string' && d.periods) return d.periods.split(',').map((p: string) => p.trim()).filter(Boolean);
  if (typeof d.through === 'string' && d.through) return [d.through];
  return [];
}

const CLOSURE_CONFIG: SettingsHistoryConfig = {
  actions: {
    [BB_CONTROL_ACTIONS.closeMonth]: { label: 'Closed', tone: 'bg-slate-100 text-slate-800' },
    [BB_CONTROL_ACTIONS.closeMonths]: { label: 'Closed (bulk)', tone: 'bg-slate-100 text-slate-800' },
    [BB_CONTROL_ACTIONS.reopenMonth]: { label: 'Reopened', tone: 'bg-amber-100 text-amber-900' },
    [BB_CONTROL_ACTIONS.clearException]: { label: 'Follows all accounts', tone: 'bg-sky-100 text-sky-900' },
    [BB_CONTROL_ACTIONS.autoRule]: { label: 'Auto-close rule', tone: 'bg-indigo-100 text-indigo-900' },
  },
  subjectHeader: 'Month',
  subjectOf: (log) => {
    const d = log.details ?? {};
    if (typeof d.period === 'string' && d.period) return periodLabel(d.period);
    if (typeof d.through === 'string' && d.through) return `${d.count ?? ''} month${d.count === 1 ? '' : 's'} through ${periodLabel(d.through)}`.trim();
    return '—';
  },
  reasonOf: (log) => {
    const d = log.details ?? {};
    if (typeof d.reason === 'string' && d.reason) return { text: d.reason };
    if (typeof d.note === 'string' && d.note) return { text: d.note };
    if (typeof d.rule === 'string' && d.rule) return { text: `Rule: ${d.rule}`, muted: true };
    return { text: '' };
  },
  facet: { label: 'Month', anyLabel: 'All months', valuesOf: periodsOf, labelOf: periodLabel, descending: true },
  detailsOf: (log) => {
    const d = log.details ?? {};
    const rows: Array<[string, string]> = [];
    const months = periodsOf(log);
    if (months.length > 1) rows.push(['Months', months.map(periodLabel).join(', ')]);
    if (typeof d.relockOn === 'string' && d.relockOn) rows.push(['Locks again on', d.relockOn === 'none' ? 'No limit — stays open until closed' : d.relockOn]);
    if (typeof d.rule === 'string' && d.rule && typeof d.reason === 'string' && d.reason) rows.push(['Rule', d.rule]);
    return rows;
  },
  emptyVerb: 'closed or reopened',
  searchPlaceholder: 'Search reason, month, account, person…',
  exportName: 'Bank Month Closure',
  ...SCOPE,
};

export function BankMonthClosureHistory(props: { scopeName: string; scopeAccount?: string; refreshKey: number }) {
  return <SettingsHistory config={CLOSURE_CONFIG} scopeName={props.scopeName} scopeProject={props.scopeAccount} refreshKey={props.refreshKey} defaultOpen />;
}
