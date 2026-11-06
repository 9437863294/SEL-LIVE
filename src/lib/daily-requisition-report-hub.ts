/**
 * The Daily Requisition Reports hub's figures: the totals across its range, and for each report's
 * card the one figure (and the small chart) worth reading before opening it — worked out from the
 * requisitions themselves, the same way the reports do.
 *
 * Pure and importless, so `node --experimental-strip-types --test` loads it directly
 * (tests/daily-requisition-report-hub.test.mjs). The page maps each requisition to a `HubRow` first:
 * its reception date as a local yyyy-MM-dd, paid and still-due through paidOf / balanceOf
 * (src/lib/requisition-progress.ts), and where it waits in the workflow (pipelineKeyOf).
 */

export interface HubRow {
  /** Reception date, yyyy-MM-dd; '' when it has none. */
  dateKey: string;
  status: string;
  gross: number;
  net: number;
  paid: number;
  balance: number;
  igst: number;
  cgst: number;
  sgst: number;
  tds: number;
  retention: number;
  other: number;
  departmentId: string;
  projectId: string;
  party: string;
  /** Where it waits in the workflow (src/lib/daily-requisition-flow.ts pipelineKeyOf) while open; null once paid or cancelled. */
  stage: string | null;
}

export interface HubGroup {
  key: string;
  count: number;
  net: number;
  outstanding: number;
}

export interface HubFigures {
  /** In the range, cancelled ones left out. */
  totals: { count: number; net: number; paid: number; outstanding: number; open: number; overBacklog: number; overBacklogBalance: number };
  /** Received this calendar month, whatever the range. */
  thisMonthCount: number;
  /** What is open in the range, at each place in the workflow, in the order given. */
  pipeline: Array<{ key: string; count: number; balance: number }>;
  /** Net received each of the last 12 months (by reception date), oldest first — whatever the range. */
  monthly: Array<{ key: string; label: string; net: number }>;
  /** Everything open now, by how long it has waited since its reception date — whatever the range. */
  ageing: Array<{ label: string; count: number; balance: number }>;
  money: { gross: number; net: number; gst: number; tds: number; retention: number; other: number };
  departments: HubGroup[];
  projects: HubGroup[];
  parties: HubGroup[];
  tax: { igst: number; cgst: number; sgst: number; tds: number; bills: number };
}

/** Open past this many days is backlog: the Ageing report's last bucket. */
export const HUB_BACKLOG_DAYS = 180;

export const HUB_AGEING = [
  { label: '0–15', min: 0, max: 15 },
  { label: '16–60', min: 16, max: 60 },
  { label: '61–180', min: 61, max: 180 },
  { label: '180+', min: 181, max: null },
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const isKey = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key);
const dayNumber = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
const isOpen = (status: string) => status !== 'Paid' && status !== 'Cancelled';

/** The 12 months ending with today's, oldest first. */
function last12(todayKey: string): Array<{ key: string; label: string }> {
  const [y, m] = todayKey.split('-').map(Number);
  const out: Array<{ key: string; label: string }> = [];
  for (let back = 11; back >= 0; back -= 1) {
    const index = y * 12 + (m - 1) - back;
    const year = Math.floor(index / 12);
    const month = index % 12;
    out.push({ key: `${year}-${String(month + 1).padStart(2, '0')}`, label: `${MONTHS[month]} ${String(year).slice(2)}` });
  }
  return out;
}

function addGroup(map: Map<string, HubGroup>, key: string, row: HubRow) {
  const group = map.get(key) ?? { key, count: 0, net: 0, outstanding: 0 };
  group.count += 1;
  group.net = round2(group.net + row.net);
  group.outstanding = round2(group.outstanding + row.balance);
  map.set(key, group);
}

export function hubFigures(
  rows: readonly HubRow[],
  options: { todayKey: string; range: { from: string; to: string }; stages: readonly string[] },
): HubFigures {
  const { todayKey, range } = options;
  const inRange = (key: string) => (!range.from && !range.to) || (isKey(key) && (!range.from || key >= range.from) && (!range.to || key <= range.to));
  const thisMonth = todayKey.slice(0, 7);
  const months = last12(todayKey);
  const monthIndex = new Map(months.map((month, index) => [month.key, index]));

  const figures: HubFigures = {
    totals: { count: 0, net: 0, paid: 0, outstanding: 0, open: 0, overBacklog: 0, overBacklogBalance: 0 },
    thisMonthCount: 0,
    pipeline: options.stages.map((key) => ({ key, count: 0, balance: 0 })),
    monthly: months.map((month) => ({ ...month, net: 0 })),
    ageing: HUB_AGEING.map((bucket) => ({ label: bucket.label, count: 0, balance: 0 })),
    money: { gross: 0, net: 0, gst: 0, tds: 0, retention: 0, other: 0 },
    departments: [],
    projects: [],
    parties: [],
    tax: { igst: 0, cgst: 0, sgst: 0, tds: 0, bills: 0 },
  };
  const pipeline = new Map(figures.pipeline.map((slot) => [slot.key, slot]));
  const departments = new Map<string, HubGroup>();
  const projects = new Map<string, HubGroup>();
  const parties = new Map<string, HubGroup>();

  for (const row of rows) {
    const status = (row.status || 'Pending').trim();
    if (status === 'Cancelled') continue;
    const dated = isKey(row.dateKey);
    const age = dated ? Math.max(0, dayNumber(todayKey) - dayNumber(row.dateKey)) : null;
    const open = isOpen(status);

    // Whatever the range: this month's count, the 12 months, and the age of everything open now.
    if (dated && row.dateKey.slice(0, 7) === thisMonth) figures.thisMonthCount += 1;
    const month = dated ? monthIndex.get(row.dateKey.slice(0, 7)) : undefined;
    if (month !== undefined) figures.monthly[month].net = round2(figures.monthly[month].net + row.net);
    if (open && age !== null) {
      const bucket = HUB_AGEING.findIndex((b) => age >= b.min && (b.max === null || age <= b.max));
      figures.ageing[bucket].count += 1;
      figures.ageing[bucket].balance = round2(figures.ageing[bucket].balance + row.balance);
    }

    if (!inRange(row.dateKey)) continue;
    const t = figures.totals;
    t.count += 1;
    t.net = round2(t.net + row.net);
    t.paid = round2(t.paid + row.paid);
    t.outstanding = round2(t.outstanding + row.balance);
    if (open) {
      t.open += 1;
      if (age !== null && age > HUB_BACKLOG_DAYS) {
        t.overBacklog += 1;
        t.overBacklogBalance = round2(t.overBacklogBalance + row.balance);
      }
      if (row.stage) {
        let slot = pipeline.get(row.stage);
        if (!slot) {
          slot = { key: row.stage, count: 0, balance: 0 };
          pipeline.set(row.stage, slot);
          figures.pipeline.push(slot);
        }
        slot.count += 1;
        slot.balance = round2(slot.balance + row.balance);
      }
    }

    const gst = round2(row.igst + row.cgst + row.sgst);
    const m = figures.money;
    m.gross = round2(m.gross + row.gross);
    m.net = round2(m.net + row.net);
    m.gst = round2(m.gst + gst);
    m.tds = round2(m.tds + row.tds);
    m.retention = round2(m.retention + row.retention);
    m.other = round2(m.other + row.other);

    const x = figures.tax;
    x.igst = round2(x.igst + row.igst);
    x.cgst = round2(x.cgst + row.cgst);
    x.sgst = round2(x.sgst + row.sgst);
    x.tds = round2(x.tds + row.tds);
    if (gst > 0 || row.tds > 0) x.bills += 1;

    addGroup(departments, row.departmentId || '', row);
    addGroup(projects, row.projectId || '', row);
    addGroup(parties, row.party.trim() || '—', row);
  }

  figures.departments = [...departments.values()].sort((a, b) => b.net - a.net || b.count - a.count);
  figures.projects = [...projects.values()].sort((a, b) => b.outstanding - a.outstanding || b.net - a.net);
  figures.parties = [...parties.values()].sort((a, b) => b.net - a.net || b.count - a.count);
  return figures;
}
