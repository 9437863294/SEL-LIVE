'use client';

/**
 * BOQ reconciliation — per BOQ item, the quantity tendered, executed (JMC + MVAC), certified and
 * billed (RA bills), and what is left at each step, with the items that need attention flagged:
 * work beyond the BOQ, billing beyond certification, and JMC / MVAC / bill lines that match no
 * BOQ item. Rules: src/lib/billing-recon/reconciliation.ts.
 *
 * Quantities and their value at the BOQ rate only — the bills' money (GST, retention,
 * collections) is Bill Tracking's.
 */

import { useMemo, useState } from 'react';
import type { Worksheet } from 'exceljs';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  IndianRupee,
  Layers,
  Loader2,
  Receipt,
  Scale,
  Send,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard, KpiGrid } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { PageAccessDenied } from '@/components/shared/module-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBillingReconData } from '@/components/billing-recon/ra-bills/use-billing-recon-data';
import {
  buildReconciliation,
  filterReconciliationRows,
  scopeOptions,
  totalsOf,
  type ReconciliationRow,
  type UnmatchedLine,
} from '@/lib/billing-recon/reconciliation';
import { QTY_TOLERANCE, formatAmount, formatAmountCompact, formatIsoDate, formatQty, localIsoDate } from '@/lib/billing-recon/lines';
import { cn } from '@/lib/utils';

const MODULE = 'Billing Recon';
const RESOURCE = 'Billing Recon.Reconciliation';
const COLS = 14;

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—');

/** A signed balance: red below zero, muted at zero. */
function Balance({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'tabular-nums',
        value < -QTY_TOLERANCE ? 'font-medium text-rose-700' : Math.abs(value) <= QTY_TOLERANCE ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {formatQty(value)}
    </span>
  );
}

function Flags({ row }: { row: ReconciliationRow }) {
  if (!row.isException) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {row.overExecuted && (
        <StatusBadge tone="danger" title="Executed more than the BOQ quantity">
          Over-executed
        </StatusBadge>
      )}
      {row.overBilled && (
        <StatusBadge tone="danger" title="Billed more than certified">
          Over-billed
        </StatusBadge>
      )}
      {row.duplicateOf && (
        <StatusBadge tone="warning" title="Another BOQ item has the same scope and BOQ SL No; its quantities are counted there">
          Duplicate SL No
        </StatusBadge>
      )}
    </div>
  );
}

export default function ReconciliationPage() {
  const { project: projectSlug } = useParams() as { project: string };
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const canView = can('View', RESOURCE);
  const canExport = can('Export', RESOURCE);
  const canSeeBills = can('View', 'Billing Recon.Billing');

  const { project, boqItems, jmcEntries, mvacEntries, bills, loading, error, reload } = useBillingReconData(
    projectSlug,
    { boq: true, entries: true, bills: true },
    !authLoading && canView,
  );

  const [scope1, setScope1] = useState('all');
  const [scope2, setScope2] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [exporting, setExporting] = useState(false);

  const recon = useMemo(
    () => buildReconciliation({ boqItems, jmcEntries, mvacEntries, bills }),
    [boqItems, jmcEntries, mvacEntries, bills],
  );
  const options = useMemo(() => scopeOptions(recon.rows, scope1), [recon.rows, scope1]);
  const rows = useMemo(
    () => filterReconciliationRows(recon.rows, { scope1, scope2, search, onlyGaps, onlyExceptions }),
    [recon.rows, scope1, scope2, search, onlyGaps, onlyExceptions],
  );
  const visible = useMemo(() => totalsOf(rows), [rows]);
  const totals = recon.totals;
  const activeFilters = (scope1 !== 'all' ? 1 : 0) + (scope2 !== 'all' ? 1 : 0) + (onlyGaps ? 1 : 0) + (onlyExceptions ? 1 : 0);
  const exceptionCount = totals.overExecutedItems + totals.overBilledItems + totals.duplicateItems;

  const clearFilters = () => {
    setScope1('all');
    setScope2('all');
    setSearch('');
    setOnlyGaps(false);
    setOnlyExceptions(false);
  };

  const exportExcel = async () => {
    if (!project || exporting) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'SEL Live';
      workbook.created = new Date();

      const QTY = '#,##0.###';
      const MONEY = '#,##0.00';
      const styleHeader = (sheet: Worksheet) => {
        const head = sheet.getRow(1);
        head.font = { bold: true };
        head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      };

      const sheet = workbook.addWorksheet('Reconciliation');
      sheet.columns = [
        { header: 'ERP SL No', key: 'erpSlNo', width: 10 },
        { header: 'BOQ SL No', key: 'boqSlNo', width: 11 },
        { header: 'Scope 1', key: 'scope1', width: 14 },
        { header: 'Scope 2', key: 'scope2', width: 14 },
        { header: 'Description', key: 'description', width: 48 },
        { header: 'Unit', key: 'unit', width: 8 },
        { header: 'Rate', key: 'rate', width: 12, style: { numFmt: MONEY } },
        { header: 'BOQ Qty', key: 'boqQty', width: 12, style: { numFmt: QTY } },
        { header: 'BOQ Amount', key: 'boqAmount', width: 15, style: { numFmt: MONEY } },
        { header: 'JMC Executed', key: 'jmcExecutedQty', width: 13, style: { numFmt: QTY } },
        { header: 'MVAC Executed', key: 'mvacExecutedQty', width: 13, style: { numFmt: QTY } },
        { header: 'Executed', key: 'executedQty', width: 12, style: { numFmt: QTY } },
        { header: 'JMC Certified', key: 'jmcCertifiedQty', width: 13, style: { numFmt: QTY } },
        { header: 'MVAC Certified', key: 'mvacCertifiedQty', width: 13, style: { numFmt: QTY } },
        { header: 'Certified', key: 'certifiedQty', width: 12, style: { numFmt: QTY } },
        { header: 'Billed', key: 'billedQty', width: 12, style: { numFmt: QTY } },
        { header: 'To Execute', key: 'toExecuteQty', width: 12, style: { numFmt: QTY } },
        { header: 'To Certify', key: 'toCertifyQty', width: 12, style: { numFmt: QTY } },
        { header: 'To Bill', key: 'toBillQty', width: 12, style: { numFmt: QTY } },
        { header: 'Executed Value', key: 'executedValue', width: 15, style: { numFmt: MONEY } },
        { header: 'Certified Value', key: 'certifiedValue', width: 15, style: { numFmt: MONEY } },
        { header: 'Billed Value', key: 'billedValue', width: 15, style: { numFmt: MONEY } },
        { header: 'To Certify Value', key: 'toCertifyValue', width: 15, style: { numFmt: MONEY } },
        { header: 'To Bill Value', key: 'toBillValue', width: 15, style: { numFmt: MONEY } },
        { header: 'Flags', key: 'flags', width: 28 },
      ];
      for (const row of rows) {
        sheet.addRow({
          ...row,
          flags: [row.overExecuted && 'Over-executed', row.overBilled && 'Over-billed', row.duplicateOf && 'Duplicate SL No']
            .filter(Boolean)
            .join(', '),
        });
      }
      const totalRow = sheet.addRow({
        description: `Total (${rows.length} item${rows.length === 1 ? '' : 's'})`,
        boqAmount: visible.boqValue,
        executedValue: visible.executedValue,
        certifiedValue: visible.certifiedValue,
        billedValue: visible.billedValue,
        toCertifyValue: visible.toCertifyValue,
        toBillValue: visible.toBillValue,
      });
      totalRow.font = { bold: true };
      styleHeader(sheet);
      sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

      const unmatchedSheet = workbook.addWorksheet('Unmatched lines');
      unmatchedSheet.columns = [
        { header: 'Source', key: 'source', width: 10 },
        { header: 'Document No', key: 'docNo', width: 18 },
        { header: 'Date', key: 'docDate', width: 12 },
        { header: 'Line', key: 'line', width: 6 },
        { header: 'BOQ SL No', key: 'boqSlNo', width: 11 },
        { header: 'Scope 1', key: 'scope1', width: 14 },
        { header: 'Scope 2', key: 'scope2', width: 14 },
        { header: 'Description', key: 'description', width: 44 },
        { header: 'Unit', key: 'unit', width: 8 },
        { header: 'Rate', key: 'rate', width: 12, style: { numFmt: MONEY } },
        { header: 'Executed', key: 'executedQty', width: 12, style: { numFmt: QTY } },
        { header: 'Certified', key: 'certifiedQty', width: 12, style: { numFmt: QTY } },
        { header: 'Billed', key: 'billedQty', width: 12, style: { numFmt: QTY } },
        { header: 'Value', key: 'value', width: 15, style: { numFmt: MONEY } },
        { header: 'Why unmatched', key: 'reason', width: 40 },
      ];
      for (const line of recon.unmatched) unmatchedSheet.addRow({ ...line, line: line.itemIndex + 1 });
      styleHeader(unmatchedSheet);

      const summary = workbook.addWorksheet('Summary');
      summary.columns = [
        { header: 'Figure', key: 'label', width: 34 },
        { header: 'Value', key: 'value', width: 22 },
      ];
      const filterText =
        [
          scope1 !== 'all' && `Scope 1: ${scope1}`,
          scope2 !== 'all' && `Scope 2: ${scope2}`,
          search.trim() && `Search: ${search.trim()}`,
          onlyGaps && 'Only items with a gap',
          onlyExceptions && 'Only exceptions',
        ]
          .filter(Boolean)
          .join('; ') || 'None — every BOQ item';
      const summaryRows: Array<[string, string | number, string?]> = [
        ['Project', project.projectName ?? ''],
        ['Exported on', new Date().toLocaleString('en-IN')],
        ['Filters on the Reconciliation sheet', filterText],
        ['BOQ items', totals.items],
        ['BOQ value', totals.boqValue, MONEY],
        ['Executed value', totals.executedValue, MONEY],
        ['Certified value', totals.certifiedValue, MONEY],
        ['Billed value', totals.billedValue, MONEY],
        ['To execute value', totals.toExecuteValue, MONEY],
        ['To certify value', totals.toCertifyValue, MONEY],
        ['To bill value', totals.toBillValue, MONEY],
        ['Over-executed items', totals.overExecutedItems],
        ['Over-executed value', round(totals.overExecutedValue), MONEY],
        ['Over-billed items', totals.overBilledItems],
        ['Over-billed value', round(totals.overBilledValue), MONEY],
        ['Duplicate BOQ SL Nos', totals.duplicateItems],
        ['Unmatched lines', recon.unmatched.length],
        ['Unmatched value', recon.unmatchedValue, MONEY],
      ];
      for (const [label, value, numFmt] of summaryRows) {
        const added = summary.addRow({ label, value });
        if (numFmt) added.getCell(2).numFmt = numFmt;
      }
      styleHeader(summary);

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `boq-reconciliation_${projectSlug}_${localIsoDate()}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: MODULE,
          action: 'Export BOQ Reconciliation',
          recordId: project.id,
          recordRef: project.projectName,
          details: { projectId: project.id, projectName: project.projectName ?? '', items: rows.length, unmatched: recon.unmatched.length, filters: filterText },
        });
      }
      toast({ title: 'Export ready', description: `${rows.length} item${rows.length === 1 ? '' : 's'} and ${recon.unmatched.length} unmatched line${recon.unmatched.length === 1 ? '' : 's'}.` });
    } catch (err) {
      console.error('Reconciliation export failed', err);
      toast({ title: 'Export failed', description: 'Could not build the Excel file.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const unmatchedColumns: Array<ListColumn<UnmatchedLine>> = [
    {
      header: 'Document',
      mobile: 'title',
      cell: (line) => (
        <span className="whitespace-nowrap font-medium text-foreground">
          {line.docNo || line.docId} <span className="text-xs font-normal text-muted-foreground">line {line.itemIndex + 1}</span>
        </span>
      ),
    },
    {
      header: 'Source',
      mobile: 'aside',
      cell: (line) => (
        <StatusBadge tone={line.source === 'RA Bill' ? 'info' : 'neutral'}>{line.source}</StatusBadge>
      ),
    },
    { header: 'Date', cell: (line) => <span className="whitespace-nowrap">{formatIsoDate(line.docDate)}</span> },
    { header: 'BOQ SL No', cell: (line) => line.boqSlNo || <span className="text-muted-foreground">blank</span> },
    {
      header: 'Scope',
      cell: (line) => [line.scope1, line.scope2].filter(Boolean).join(' / ') || <span className="text-muted-foreground">blank</span>,
    },
    {
      header: 'Description',
      className: 'max-w-xs',
      cell: (line) => (
        <span className="line-clamp-2" title={line.description}>
          {line.description || '—'}
        </span>
      ),
    },
    {
      header: 'Qty',
      align: 'right',
      cell: (line) => (
        <span className="whitespace-nowrap tabular-nums">
          {line.source === 'RA Bill' ? `${formatQty(line.billedQty)} billed` : `${formatQty(line.executedQty)} exec · ${formatQty(line.certifiedQty)} cert`}
        </span>
      ),
    },
    { header: 'Value', align: 'right', cell: (line) => <span className="whitespace-nowrap tabular-nums">{formatAmount(line.value)}</span> },
    { header: 'Why', className: 'max-w-xs', cell: (line) => <span className="text-muted-foreground">{line.reason}</span> },
  ];

  const header = (
    <PageHeader
      title="BOQ Reconciliation"
      icon={Scale}
      description="Per BOQ item: tendered, executed, certified and billed quantities, and what is left at each step — valued at the BOQ rate."
      meta={project ? [{ label: 'Project', value: project.projectName }] : undefined}
      actions={
        <>
          {canSeeBills && (
            <Button asChild variant="outline">
              <Link href={`/billing-recon/${projectSlug}/billing`}>
                <Receipt className="mr-2 h-4 w-4" /> RA bills
              </Link>
            </Button>
          )}
          {canExport && (
            <Button type="button" variant="outline" onClick={() => void exportExcel()} disabled={loading || exporting || !project}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export to Excel
            </Button>
          )}
        </>
      }
    />
  );

  if (authLoading) {
    return (
      <div className="min-w-0 space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-w-0 space-y-4">
        <PageHeader title="BOQ Reconciliation" icon={Scale} />
        <PageAccessDenied message="You do not have permission to view the BOQ reconciliation." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-w-0 space-y-4">
        {header}
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <p className="font-semibold text-foreground">{error === 'not-found' ? 'Project not found' : 'Could not load the reconciliation'}</p>
            <p className="text-sm text-muted-foreground">
              {error === 'not-found'
                ? 'This link does not match any project. It may have been renamed or removed.'
                : 'Check your connection and try again.'}
            </p>
            {error === 'failed' && (
              <Button type="button" variant="outline" onClick={() => void reload()}>
                Try again
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const dash = loading ? '…' : undefined;

  return (
    <div className="min-w-0 space-y-4">
      {header}

      <KpiGrid>
        <KpiCard label="BOQ value" value={dash ?? formatAmountCompact(totals.boqValue)} hint={dash ? undefined : `${totals.items} items`} icon={ClipboardList} tone="slate" />
        <KpiCard
          label="Executed"
          value={dash ?? formatAmountCompact(totals.executedValue)}
          hint={dash ? undefined : `${percent(totals.executedValue, totals.boqValue)} of BOQ`}
          icon={Layers}
          tone="blue"
          info="JMC and MVAC executed quantities × BOQ rate. Rejected and cancelled entries are left out."
        />
        <KpiCard
          label="Certified"
          value={dash ?? formatAmountCompact(totals.certifiedValue)}
          hint={dash ? undefined : `${percent(totals.certifiedValue, totals.executedValue)} of executed`}
          icon={CheckCircle2}
          tone="teal"
        />
        <KpiCard
          label="Billed"
          value={dash ?? formatAmountCompact(totals.billedValue)}
          hint={dash ? undefined : `${percent(totals.billedValue, totals.certifiedValue)} of certified`}
          icon={IndianRupee}
          tone="emerald"
          info="Quantities on RA bills that are not cancelled (drafts included) × BOQ rate."
        />
        <KpiCard
          label="To certify"
          value={dash ?? formatAmountCompact(totals.toCertifyValue)}
          hint={dash ? undefined : 'Executed, not certified'}
          icon={FileText}
          tone="amber"
        />
        <KpiCard
          label="To bill"
          value={dash ?? formatAmountCompact(totals.toBillValue)}
          hint={dash ? undefined : 'Certified, not billed'}
          icon={Send}
          tone="violet"
          info="Only items with a positive balance add up here, so an over-billed item does not hide another item's unbilled quantity."
        />
      </KpiGrid>

      {!loading && (exceptionCount > 0 || recon.unmatched.length > 0) && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 sm:flex-row sm:items-center">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {[
              totals.overExecutedItems && `${totals.overExecutedItems} over-executed`,
              totals.overBilledItems && `${totals.overBilledItems} over-billed (${formatAmount(totals.overBilledValue)})`,
              totals.duplicateItems && `${totals.duplicateItems} duplicate BOQ SL No${totals.duplicateItems === 1 ? '' : 's'}`,
              recon.unmatched.length && `${recon.unmatched.length} unmatched line${recon.unmatched.length === 1 ? '' : 's'} (${formatAmount(recon.unmatchedValue)})`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {exceptionCount > 0 && !onlyExceptions && (
            <Button type="button" size="sm" variant="outline" onClick={() => setOnlyExceptions(true)}>
              Show exceptions
            </Button>
          )}
        </div>
      )}

      <TableCard
        title="BOQ items"
        count={loading ? undefined : rows.length}
        total={loading ? undefined : recon.rows.length}
        noun="item"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'BOQ SL No or description' }}
            activeCount={activeFilters}
            onClear={clearFilters}
          >
            {options.scope1.length > 0 && (
              <Select
                value={scope1}
                onValueChange={(value) => {
                  setScope1(value);
                  setScope2('all');
                }}
              >
                <SelectTrigger aria-label="Scope 1" className="text-left">
                  <span className="truncate">
                    <SelectValue placeholder="Scope 1" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every scope 1</SelectItem>
                  {options.scope1.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {options.scope2.length > 0 && (
              <Select value={scope2} onValueChange={setScope2}>
                <SelectTrigger aria-label="Scope 2" className="text-left">
                  <span className="truncate">
                    <SelectValue placeholder="Scope 2" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every scope 2</SelectItem>
                  {options.scope2.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground" title="Executed but not certified, or certified but not billed">
              <Switch checked={onlyGaps} onCheckedChange={setOnlyGaps} aria-label="Only items with a gap" />
              Only gaps
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground" title="Over-executed, over-billed or duplicate BOQ SL No">
              <Switch checked={onlyExceptions} onCheckedChange={setOnlyExceptions} aria-label="Only exceptions" />
              Only exceptions
            </label>
          </FilterBar>
        }
      >
        <Table className="min-w-[78rem]">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 !z-30 w-24 shadow-[1px_0_0_0_var(--border)]">BOQ SL No</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">BOQ qty</TableHead>
              <TableHead className="text-right">Executed</TableHead>
              <TableHead className="text-right">Certified</TableHead>
              <TableHead className="text-right">Billed</TableHead>
              <TableHead className="text-right">To execute</TableHead>
              <TableHead className="text-right">To certify</TableHead>
              <TableHead className="text-right">To bill</TableHead>
              <TableHead className="text-right">BOQ amount</TableHead>
              <TableHead className="text-right">To-bill value</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }, (_, index) => (
                <TableRow key={index}>
                  {Array.from({ length: COLS }, (_, cell) => (
                    <TableCell key={cell}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : recon.rows.length === 0 ? (
              <TableEmpty colSpan={COLS}>This project has no BOQ items yet. Import the BOQ first.</TableEmpty>
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={COLS}>No BOQ items match these filters.</TableEmpty>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className={cn(row.isException && 'bg-rose-50')}>
                  <TableCell
                    className={cn(
                      'sticky left-0 z-10 whitespace-nowrap font-medium shadow-[1px_0_0_0_var(--border)]',
                      row.isException ? 'bg-rose-50' : 'bg-card',
                    )}
                  >
                    {row.boqSlNo || <span className="text-muted-foreground">—</span>}
                    {row.erpSlNo && <div className="text-[11px] font-normal text-muted-foreground">ERP {row.erpSlNo}</div>}
                  </TableCell>
                  <TableCell className="min-w-[16rem] max-w-md">
                    <div className="line-clamp-2" title={row.description}>
                      {row.description || '—'}
                    </div>
                    {(row.scope1 || row.scope2) && (
                      <div className="text-xs text-muted-foreground">{[row.scope1, row.scope2].filter(Boolean).join(' / ')}</div>
                    )}
                  </TableCell>
                  <TableCell>{row.unit || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatAmount(row.rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(row.boqQty)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div>{formatQty(row.executedQty)}</div>
                    {(row.jmcExecutedQty !== 0 || row.mvacExecutedQty !== 0) && (
                      <div className="whitespace-nowrap text-[11px] text-muted-foreground">
                        J {formatQty(row.jmcExecutedQty)} · M {formatQty(row.mvacExecutedQty)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div>{formatQty(row.certifiedQty)}</div>
                    {(row.jmcCertifiedQty !== 0 || row.mvacCertifiedQty !== 0) && (
                      <div className="whitespace-nowrap text-[11px] text-muted-foreground">
                        J {formatQty(row.jmcCertifiedQty)} · M {formatQty(row.mvacCertifiedQty)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(row.billedQty)}</TableCell>
                  <TableCell className="text-right">
                    <Balance value={row.toExecuteQty} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Balance value={row.toCertifyQty} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Balance value={row.toBillQty} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatAmount(row.boqAmount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatAmount(row.toBillValue)}</TableCell>
                  <TableCell>
                    <Flags row={row} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {!loading && rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="sticky left-0 z-10 bg-muted shadow-[1px_0_0_0_var(--border)]">Total</TableCell>
                <TableCell colSpan={10} className="text-xs font-normal text-muted-foreground">
                  {rows.length} item{rows.length === 1 ? '' : 's'} · executed {formatAmount(visible.executedValue)} · certified{' '}
                  {formatAmount(visible.certifiedValue)} · billed {formatAmount(visible.billedValue)} · to certify {formatAmount(visible.toCertifyValue)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatAmount(visible.boqValue)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatAmount(visible.toBillValue)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableCard>

      <TableCard
        title="Unmatched lines"
        icon={AlertTriangle}
        count={loading ? undefined : recon.unmatched.length}
        noun="line"
        description="JMC, MVAC and RA bill lines whose scope and BOQ SL No match no BOQ item. They are in no item's totals above — correct the line or the BOQ so they reconcile."
        scroll="natural"
      >
        <div className="p-3 sm:p-4">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <DataList
              rows={recon.unmatched}
              columns={unmatchedColumns}
              dense
              empty={
                <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Every JMC, MVAC and RA bill line matches a BOQ item.
                </p>
              }
            />
          )}
        </div>
      </TableCard>
    </div>
  );
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
