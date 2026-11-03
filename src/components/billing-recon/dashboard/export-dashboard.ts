'use client';

/**
 * Billing Recon dashboard → Excel: the figures the dashboard shows, one sheet per section, so
 * finance can work from them without re-keying. Built in the browser with exceljs (loaded on
 * demand), the same way the Reconciliation page exports.
 */

import type { ProjectSummary, PendingEntry } from '@/lib/billing-recon/dashboard';
import type { AgeBucket, BillRow, ExceptionRow, PeriodComparison, ScopeRow, StatusRow } from '@/lib/billing-recon/dashboard-detail';
import type { ReconciliationTotals } from '@/lib/billing-recon/reconciliation';

export interface DashboardExportProject {
  name: string;
  register: string;
  summary: ProjectSummary;
  totals: ReconciliationTotals | null;
  exceptions: number;
}

export interface DashboardExport {
  title: string;
  filters: string;
  projects: DashboardExportProject[];
  pending: Array<PendingEntry & { projectName: string }>;
  ageing: AgeBucket[];
  period: PeriodComparison;
  statuses: StatusRow[];
  scopes: ScopeRow[];
  exceptions: ExceptionRow[];
  bills: BillRow[];
}

const MONEY = '#,##0.00';

function fmtDate(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

export async function exportDashboard(data: DashboardExport): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  type Col = { header: string; key: string; width: number; money?: boolean };
  const sheet = (name: string, cols: Col[], rows: Array<Record<string, unknown>>) => {
    const ws = workbook.addWorksheet(name);
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));
    cols.forEach((c, i) => {
      if (c.money) ws.getColumn(i + 1).numFmt = MONEY;
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  };

  // Summary
  const totals = data.projects.reduce(
    (acc, p) => {
      acc.executed += p.summary.values.executed;
      acc.certified += p.summary.values.certified;
      acc.billed += p.summary.values.billed;
      acc.awaiting += p.summary.values.awaitingCertification;
      acc.unbilled += p.summary.values.certifiedUnbilled;
      acc.boq += p.totals?.boqValue ?? 0;
      acc.open += p.summary.pending.length;
      acc.overdue += p.summary.overdueCount;
      return acc;
    },
    { executed: 0, certified: 0, billed: 0, awaiting: 0, unbilled: 0, boq: 0, open: 0, overdue: 0 },
  );
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Figure', key: 'k', width: 34 },
    { header: 'Value', key: 'v', width: 22 },
  ];
  summary.getRow(1).font = { bold: true };
  [
    ['Report', data.title],
    ['Filters', data.filters],
    ['Exported', new Date().toLocaleString('en-IN')],
    ['Projects', data.projects.length],
    ['BOQ value', totals.boq],
    ['Executed value', totals.executed],
    ['Certified value', totals.certified],
    ['Billed value (RA bills)', totals.billed],
    ['Executed, not certified', totals.awaiting],
    ['Certified, not billed', totals.unbilled],
    ['Open entries', totals.open],
    ['Overdue entries', totals.overdue],
  ].forEach(([k, v]) => summary.addRow({ k, v }));
  summary.getColumn(2).numFmt = MONEY;
  // Rows 2–4 are text, 5 / 12 / 13 are counts; the rest are money.
  [2, 3, 4].forEach((r) => (summary.getCell(`B${r}`).numFmt = '@'));
  [5, 12, 13].forEach((r) => (summary.getCell(`B${r}`).numFmt = '0'));

  sheet(
    'Projects',
    [
      { header: 'Project', key: 'name', width: 36 },
      { header: 'Register', key: 'register', width: 16 },
      { header: 'BOQ value', key: 'boq', width: 16, money: true },
      { header: 'Executed', key: 'executed', width: 16, money: true },
      { header: 'Certified', key: 'certified', width: 16, money: true },
      { header: 'Billed', key: 'billed', width: 16, money: true },
      { header: 'Executed, not certified', key: 'awaiting', width: 20, money: true },
      { header: 'Certified, not billed', key: 'unbilled', width: 20, money: true },
      { header: 'JMC', key: 'jmc', width: 8 },
      { header: 'MVAC', key: 'mvac', width: 8 },
      { header: 'RA bills', key: 'bills', width: 9 },
      { header: 'Open', key: 'open', width: 8 },
      { header: 'Overdue', key: 'overdue', width: 9 },
      { header: 'Exceptions', key: 'exceptions', width: 11 },
      { header: 'Last activity', key: 'last', width: 14 },
    ],
    data.projects.map((p) => ({
      name: p.name,
      register: p.register,
      boq: p.totals?.boqValue ?? null,
      executed: p.summary.values.executed,
      certified: p.summary.values.certified,
      billed: p.summary.values.billed,
      awaiting: p.summary.values.awaitingCertification,
      unbilled: p.summary.values.certifiedUnbilled,
      jmc: p.summary.counts.jmc,
      mvac: p.summary.counts.mvac,
      bills: p.summary.counts.bills,
      open: p.summary.pending.length,
      overdue: p.summary.overdueCount,
      exceptions: p.exceptions,
      last: fmtDate(p.summary.lastActivity),
    })),
  );

  sheet(
    'Open entries',
    [
      { header: 'Project', key: 'project', width: 32 },
      { header: 'Register', key: 'kind', width: 9 },
      { header: 'Number', key: 'number', width: 18 },
      { header: 'WO', key: 'wo', width: 16 },
      { header: 'Stage', key: 'stage', width: 24 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Raised', key: 'raised', width: 12 },
      { header: 'Age (days)', key: 'age', width: 10 },
      { header: 'Due', key: 'due', width: 12 },
      { header: 'Overdue', key: 'overdue', width: 9 },
      { header: 'Executed value', key: 'value', width: 16, money: true },
    ],
    data.pending.map((p) => ({
      project: p.projectName,
      kind: p.kind,
      number: p.number,
      wo: p.woNo,
      stage: p.stage,
      status: p.status,
      raised: fmtDate(p.createdAt),
      age: p.ageDays,
      due: fmtDate(p.deadline),
      overdue: p.overdue ? 'Yes' : '',
      value: p.executedValue,
    })),
  );

  sheet(
    'Ageing',
    [
      { header: 'Waiting', key: 'label', width: 16 },
      { header: 'JMC', key: 'jmc', width: 8 },
      { header: 'MVAC', key: 'mvac', width: 8 },
      { header: 'Total', key: 'count', width: 8 },
      { header: 'Overdue', key: 'overdue', width: 9 },
      { header: 'Executed value', key: 'value', width: 16, money: true },
    ],
    data.ageing.map((b) => ({ ...b })),
  );

  const p = data.period;
  sheet(
    'Periods',
    [
      { header: 'Figure', key: 'k', width: 18 },
      { header: p.thisMonthLabel, key: 'a', width: 16 },
      { header: p.lastMonthLabel, key: 'b', width: 16 },
      { header: p.financialYearLabel, key: 'c', width: 16 },
    ],
    (
      [
        ['JMC raised', 'jmcRaised'],
        ['MVAC raised', 'mvacRaised'],
        ['Executed value', 'executed'],
        ['Certified value', 'certified'],
        ['RA bills', 'bills'],
        ['Billed value', 'billed'],
      ] as const
    ).map(([k, key]) => ({ k, a: p.thisMonth[key], b: p.lastMonth[key], c: p.financialYear[key] })),
  );

  sheet(
    'Statuses',
    [
      { header: 'Status', key: 'status', width: 16 },
      { header: 'JMC', key: 'jmc', width: 8 },
      { header: 'MVAC', key: 'mvac', width: 8 },
    ],
    data.statuses.map((s) => ({ ...s })),
  );

  sheet(
    'Scopes to bill',
    [
      { header: 'Project', key: 'projectName', width: 32 },
      { header: 'Scope 2', key: 'scope2', width: 24 },
      { header: 'Scope 1', key: 'scope1', width: 24 },
      { header: 'Items', key: 'items', width: 8 },
      { header: 'BOQ value', key: 'boqValue', width: 16, money: true },
      { header: 'Certified', key: 'certifiedValue', width: 16, money: true },
      { header: 'Billed', key: 'billedValue', width: 16, money: true },
      { header: 'To certify', key: 'toCertifyValue', width: 16, money: true },
      { header: 'To bill', key: 'toBillValue', width: 16, money: true },
    ],
    data.scopes.map((s) => ({ ...s })),
  );

  sheet(
    'Exceptions',
    [
      { header: 'Project', key: 'projectName', width: 32 },
      { header: 'Kind', key: 'kind', width: 16 },
      { header: 'Reference', key: 'reference', width: 26 },
      { header: 'Scope', key: 'scope', width: 28 },
      { header: 'Description', key: 'description', width: 48 },
      { header: 'Value', key: 'value', width: 16, money: true },
    ],
    data.exceptions.map((e) => ({ ...e })),
  );

  sheet(
    'RA bills',
    [
      { header: 'Project', key: 'projectName', width: 32 },
      { header: 'Bill No', key: 'billNo', width: 18 },
      { header: 'RA', key: 'ra', width: 6 },
      { header: 'Date', key: 'billDate', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Bill Tracking ref', key: 'billTrackingRef', width: 18 },
      { header: 'Amount', key: 'amount', width: 16, money: true },
      { header: 'Needs attention', key: 'issue', width: 28 },
    ],
    data.bills.map((b) => ({ ...b, ra: b.raSequence ?? '' })),
  );

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `billing-recon-dashboard-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
