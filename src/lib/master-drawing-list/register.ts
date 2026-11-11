/**
 * The Master Drawing List's screens as pure functions over items: filtering, the schedule › scope ›
 * group headings, the "Days" figure, the pending lists, the dashboard figures and the Excel sheet.
 * Pure, so the screens, the API and the tests share one version of each.
 */

import type { ExcelSheet } from '../report-excel.ts';
import { ageing, cycleDays, daysBetween, formatDate } from './derive.ts';
import { SCHEDULES, SCOPES, STATUSES, STATUS_LABEL, type IsoDate, type MdlItem, type MdlProject, type MdlSchedule, type MdlScope, type MdlStatus } from './types.ts';

/* ── filters ─────────────────────────────────────────────────────────────── */

export interface RegisterFilters {
  schedule?: MdlSchedule | null;
  scope?: MdlScope | null;
  status?: MdlStatus | null;
  /** Searched in the description, drawing number and group. */
  q?: string | null;
}

export const isSchedule = (value: unknown): value is MdlSchedule => SCHEDULES.includes(value as MdlSchedule);
export const isScope = (value: unknown): value is MdlScope => SCOPES.includes(value as MdlScope);
export const isStatus = (value: unknown): value is MdlStatus => STATUSES.includes(value as MdlStatus);

type Searchable = Pick<MdlItem, 'description' | 'drgNo' | 'group'>;

/** Every word typed must appear in the description, drawing number or group (any case). */
export function matchesSearch(item: Searchable, q: string | null | undefined): boolean {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [item.description, item.drgNo ?? '', item.group ?? ''].join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Schedule, scope and search only — the status summary counts what these leave. */
export function filterWithoutStatus<T extends MdlItem>(items: T[], filters: RegisterFilters): T[] {
  return items.filter(
    (item) =>
      (!filters.schedule || item.schedule === filters.schedule) &&
      (!filters.scope || item.scope === filters.scope) &&
      matchesSearch(item, filters.q),
  );
}

export function filterItems<T extends MdlItem>(items: T[], filters: RegisterFilters): T[] {
  return filterWithoutStatus(items, filters).filter((item) => !filters.status || item.status === filters.status);
}

export function countByStatus(items: Pick<MdlItem, 'status'>[]): Record<MdlStatus, number> {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<MdlStatus, number>;
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/* ── headings ────────────────────────────────────────────────────────────── */

export interface RegisterGroup<T> {
  key: string;
  /** The heading the rows sit under in the workbook; null for rows directly under the scope. */
  group: string | null;
  items: T[];
}

export interface RegisterSection<T> {
  key: string;
  schedule: MdlSchedule;
  scope: MdlScope;
  groups: RegisterGroup<T>[];
  count: number;
}

/**
 * Rows under schedule › scope › group headings. Sections and groups keep the order they first appear
 * in the register (`order`), and every row of a heading sits under it — an item added later to an
 * existing group joins that group rather than opening a second heading at the end.
 */
export function groupForRegister<T extends Pick<MdlItem, 'schedule' | 'scope' | 'group' | 'order'>>(items: T[]): RegisterSection<T>[] {
  const sections = new Map<string, RegisterSection<T> & { byGroup: Map<string, RegisterGroup<T>> }>();
  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    const sectionKey = `${item.schedule}|${item.scope}`;
    let section = sections.get(sectionKey);
    if (!section) {
      section = { key: sectionKey, schedule: item.schedule, scope: item.scope, groups: [], count: 0, byGroup: new Map() };
      sections.set(sectionKey, section);
    }
    const groupKey = `${sectionKey}|${item.group ?? ''}`;
    let group = section.byGroup.get(groupKey);
    if (!group) {
      group = { key: groupKey, group: item.group, items: [] };
      section.byGroup.set(groupKey, group);
      section.groups.push(group);
    }
    group.items.push(item);
    section.count += 1;
  }
  return [...sections.values()].map(({ byGroup: _byGroup, ...section }) => section);
}

/* ── numbering ───────────────────────────────────────────────────────────── */

/**
 * Where a new item goes: after every row of the project (`order`), and the next Sl. No. within its
 * schedule and scope — one more than the highest whole-number Sl. No. there (workbook numbers such as
 * "3a" are left out of the count).
 */
export function nextNumbers(items: Pick<MdlItem, 'order' | 'schedule' | 'scope' | 'slNo'>[], schedule: MdlSchedule, scope: MdlScope): { order: number; slNo: string } {
  let order = 0;
  let sl = 0;
  for (const item of items) {
    order = Math.max(order, item.order);
    if (item.schedule === schedule && item.scope === scope && /^\d+$/.test(item.slNo)) sl = Math.max(sl, Number(item.slNo));
  }
  return { order: order + 1, slNo: String(sl + 1) };
}

/** The groups already used in a project, per schedule and scope — suggestions for a new item. */
export function existingGroups(items: Pick<MdlItem, 'schedule' | 'scope' | 'group' | 'order'>[]): { schedule: MdlSchedule; scope: MdlScope; group: string }[] {
  const seen = new Set<string>();
  const out: { schedule: MdlSchedule; scope: MdlScope; group: string }[] = [];
  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    if (!item.group) continue;
    const key = `${item.schedule}|${item.scope}|${item.group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ schedule: item.schedule, scope: item.scope, group: item.group });
  }
  return out;
}

/* ── days ────────────────────────────────────────────────────────────────── */

export interface DaysFigure {
  days: number;
  /** Open items: who has it. Approved items: first submission to approval. */
  kind: 'client' | 'sel' | 'cycle';
  /** The date counted from. */
  since: IsoDate;
}

/**
 * "Days" in the register: for an open item, days since the last event while it waits with the client
 * or with SEL; for an approved item, first submission to approval. Null when there is nothing to count.
 */
export function daysFor(item: Pick<MdlItem, 'status' | 'lastSubmittedOn' | 'lastCommentedOn' | 'revisions' | 'approved' | 'approvedOn'>, today: IsoDate): DaysFigure | null {
  if (item.status === 'approved') {
    const days = cycleDays(item);
    const first = item.revisions.find((revision) => revision.submittedOn)?.submittedOn;
    return days === null || !first ? null : { days, kind: 'cycle', since: first };
  }
  const waiting = ageing(item, today);
  if (!waiting) return null;
  return { days: waiting.days, kind: waiting.with === 'Client' ? 'client' : 'sel', since: waiting.since };
}

export const DAYS_HINT: Record<DaysFigure['kind'], string> = {
  client: 'with client',
  sel: 'with SEL',
  cycle: 'to approval',
};

/* ── pending action ──────────────────────────────────────────────────────── */

export interface PendingEntry {
  item: MdlItem;
  days: number;
  since: IsoDate;
}

export interface PendingLists {
  /** Comments received: SEL has to revise and resubmit. Longest waiting first. */
  comments: PendingEntry[];
  /** Submitted and with the client. Longest waiting first. */
  review: PendingEntry[];
  /** Nothing can be drawn until a vendor is finalised — by project, then group. */
  vendor: { projectCode: string; groups: { group: string | null; items: MdlItem[] }[]; count: number }[];
}

export function pendingLists(items: MdlItem[], today: IsoDate): PendingLists {
  const comments: PendingEntry[] = [];
  const review: PendingEntry[] = [];
  for (const item of items) {
    const waiting = ageing(item, today);
    if (!waiting) continue;
    (waiting.with === 'SEL' ? comments : review).push({ item, days: waiting.days, since: waiting.since });
  }
  const longestFirst = (a: PendingEntry, b: PendingEntry) => b.days - a.days || a.item.projectCode.localeCompare(b.item.projectCode) || a.item.order - b.item.order;
  comments.sort(longestFirst);
  review.sort(longestFirst);

  const byProject = new Map<string, MdlItem[]>();
  for (const item of items) {
    if (item.status !== 'vendor_not_finalised') continue;
    byProject.set(item.projectCode, [...(byProject.get(item.projectCode) ?? []), item]);
  }
  const vendor = [...byProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([projectCode, list]) => {
      const groups = new Map<string, { group: string | null; items: MdlItem[] }>();
      for (const item of [...list].sort((a, b) => a.order - b.order)) {
        const key = item.group ?? '';
        if (!groups.has(key)) groups.set(key, { group: item.group, items: [] });
        groups.get(key)!.items.push(item);
      }
      return { projectCode, groups: [...groups.values()], count: list.length };
    });
  return { comments, review, vendor };
}

/* ── dashboard ───────────────────────────────────────────────────────────── */

/** Waiting-time bands for the dashboard's ageing view. */
export const AGE_BANDS = [
  { label: '0–15 days', max: 15 },
  { label: '16–30 days', max: 30 },
  { label: '31–60 days', max: 60 },
  { label: '61–90 days', max: 90 },
  { label: 'Over 90 days', max: Infinity },
] as const;

export interface ProjectSummary {
  projectCode: string;
  total: number;
  counts: Record<MdlStatus, number>;
  /** Per band in `AGE_BANDS`: items waiting with the client, and with SEL (comments to comply). */
  withClient: number[];
  withSel: number[];
  /** The longest wait in days, with the client and with SEL; null when none. */
  oldestWithClient: number | null;
  oldestWithSel: number | null;
  /** Median days from first submission to approval, over approved items with both dates. */
  medianCycleDays: number | null;
}

const bandOf = (days: number) => AGE_BANDS.findIndex((band) => days <= band.max);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function summarise(projectCode: string, items: MdlItem[], today: IsoDate): ProjectSummary {
  const withClient = AGE_BANDS.map(() => 0);
  const withSel = AGE_BANDS.map(() => 0);
  let oldestWithClient: number | null = null;
  let oldestWithSel: number | null = null;
  const cycles: number[] = [];
  for (const item of items) {
    const waiting = ageing(item, today);
    if (waiting) {
      const band = bandOf(Math.max(0, waiting.days));
      if (waiting.with === 'Client') {
        withClient[band] += 1;
        oldestWithClient = Math.max(oldestWithClient ?? 0, waiting.days);
      } else {
        withSel[band] += 1;
        oldestWithSel = Math.max(oldestWithSel ?? 0, waiting.days);
      }
    }
    if (item.status === 'approved') {
      const days = cycleDays(item);
      if (days !== null) cycles.push(days);
    }
  }
  return {
    projectCode,
    total: items.length,
    counts: countByStatus(items),
    withClient,
    withSel,
    oldestWithClient,
    oldestWithSel,
    medianCycleDays: median(cycles),
  };
}

/* ── Excel ───────────────────────────────────────────────────────────────── */

const excelDate = (value: IsoDate | null | undefined): Date | null => (value ? new Date(`${value}T00:00:00Z`) : null);

/**
 * The register view as one sheet: the item's facts, then a submitted / comments pair of columns per
 * revision (as many as the deepest item in the view has), then approval, status and days. Dates are
 * real Excel dates shown DD.MM.YYYY, so the sheet still sorts and filters.
 */
export function registerSheet(items: MdlItem[], project: Pick<MdlProject, 'short'>, today: IsoDate): ExcelSheet {
  const revisions = Math.max(0, ...items.map((item) => (item.revisions.length ? Math.max(...item.revisions.map((revision) => revision.rev)) + 1 : 0)));
  const date = { width: 12, numFmt: 'dd.mm.yyyy' };
  const columns: ExcelSheet['columns'] = [
    { header: 'Schedule', key: 'schedule', width: 11 },
    { header: 'Scope', key: 'scope', width: 16 },
    { header: 'Group', key: 'group', width: 28 },
    { header: 'Sl. No.', key: 'slNo', width: 8 },
    { header: 'Description', key: 'description', width: 60 },
    { header: 'Drg / Doc No.', key: 'drgNo', width: 26 },
    { header: 'Planned submission', key: 'plannedSubmission', ...date, width: 14 },
    { header: 'Target approval', key: 'targetApproval', ...date, width: 14 },
  ];
  for (let rev = 0; rev < revisions; rev += 1) {
    columns.push({ header: `R${rev} submitted`, key: `r${rev}s`, ...date });
    columns.push({ header: `R${rev} comments`, key: `r${rev}c`, ...date });
    columns.push({ header: `R${rev} transmittal`, key: `r${rev}t`, width: 16 });
  }
  columns.push(
    { header: 'Approved on', key: 'approvedOn', ...date },
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Action with', key: 'heldBy', width: 12 },
    { header: 'Days', key: 'days', width: 8 },
    { header: 'Days counted', key: 'daysKind', width: 13 },
    { header: 'Vendor finalised', key: 'vendorFinalised', width: 10 },
    { header: 'Remarks', key: 'remarks', width: 40 },
  );
  const rows = groupForRegister(items).flatMap((section) =>
    section.groups.flatMap((group) =>
      group.items.map((item) => {
        const days = daysFor(item, today);
        const row: Record<string, unknown> = {
          schedule: item.schedule,
          scope: item.scope,
          group: item.group ?? '',
          slNo: item.slNo,
          description: item.description,
          drgNo: item.drgNo ?? '',
          plannedSubmission: excelDate(item.plannedSubmission),
          targetApproval: excelDate(item.targetApproval),
          approvedOn: excelDate(item.approvedOn),
          status: STATUS_LABEL[item.status],
          heldBy: item.heldBy ?? '',
          days: days?.days ?? null,
          daysKind: days ? DAYS_HINT[days.kind] : '',
          vendorFinalised: item.vendorFinalised ? 'Yes' : 'No',
          remarks: item.remarks ?? '',
        };
        for (const revision of item.revisions) {
          row[`r${revision.rev}s`] = excelDate(revision.submittedOn);
          row[`r${revision.rev}c`] = excelDate(revision.commentedOn);
          row[`r${revision.rev}t`] = revision.transmittalNo ?? '';
        }
        return row;
      }),
    ),
  );
  // Sheet names: 31 characters, none of : \ / ? * [ ]. Replaced one by one rather than with a
  // character class: Tailwind scans src/ and reads a bracketed colon as a CSS class.
  let name = `MDL ${project.short}`;
  for (const forbidden of ['\\', '/', '?', '*', '[', ']', ':']) name = name.split(forbidden).join(' ');
  return { name: name.slice(0, 31), columns, rows };
}

/** `MDL-<short>-<DD.MM.YYYY>.xlsx`. */
export function exportFileName(project: Pick<MdlProject, 'short'>, today: IsoDate): string {
  return `MDL-${project.short.replace(/[^A-Za-z0-9._-]+/g, '-')}-${formatDate(today)}.xlsx`;
}

/** Days between two recorded events, for the history's "gap" column. */
export const gapDays = (from: IsoDate | null, to: IsoDate): number | null => (from ? daysBetween(from, to) : null);
