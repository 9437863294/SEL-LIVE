'use client';

/**
 * FD Export Centre — filtered, multi-sheet export of the fixed-deposit register.
 *
 * The register and reports pages each hand-roll a single fixed-column workbook. This
 * page owns the general case: choose the scope, choose the columns (or a preset), and
 * emit one workbook with the deposits plus any of the derived sheets. The
 * "Import template layout" sheet writes the exact header order the import wizard maps
 * automatically, which is what makes edit-offline-and-re-import a supported round trip.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Columns3, Download, FileSpreadsheet, Loader2, RefreshCw, RotateCcw, Search, ShieldAlert, Upload } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  FD_COLLECTIONS,
  RESERVED_ASSIGNMENT_STATUSES,
  assignmentOutstanding,
  assignmentOutstanding as outstanding,
  calculateEligibleValue,
  daysUntil,
  deriveOperationalStatus,
  escapeCsv,
  fdStatusLabel,
  financialYearForDate,
  formatFdCurrency,
  toDate,
  type FDAssignment,
  type FixedDeposit,
} from '@/lib/fixed-deposit';
import {
  FD_EXPORT_COLUMNS,
  FD_EXPORT_COLUMN_GROUPS,
  FD_EXPORT_PRESETS,
  FD_IMPORT_FIELDS,
  columnWidthFor,
  downloadBlob,
  downloadWorkbook,
  numberFormatFor,
  styleHeaderRow,
  toImportShapedRow,
  type FdExportRow,
} from '@/lib/fd-import-export';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const PREVIEW_ROWS = 25;

type SheetKey = 'deposits' | 'assignments' | 'maturity' | 'bankSummary' | 'importLayout';

const OPTIONAL_SHEETS: Array<{ key: SheetKey; label: string; description: string }> = [
  { key: 'assignments', label: 'BG / LC Assignments', description: 'Every assignment against the deposits in scope, with outstanding amounts.' },
  { key: 'maturity', label: 'Maturity Schedule', description: 'Month-wise maturing principal, interest and net proceeds.' },
  { key: 'bankSummary', label: 'Bank Summary', description: 'Bank-wise principal, utilisation and availability with a totals row.' },
  { key: 'importLayout', label: 'Import Template Layout', description: 'Same columns as the import template, so the file can be edited and re-imported.' },
];

const UTILISATION_FILTERS = [
  ['ALL', 'Any utilisation'],
  ['AVAILABLE', 'Has available balance'],
  ['UTILISED', 'Partly or fully utilised'],
  ['FULL', 'Fully utilised'],
  ['UNUSED', 'Never utilised'],
] as const;

export default function FDExportWorkspace() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();

  const canView = can('View', 'Fixed Deposit Management.FD Register') || can('View', 'Fixed Deposit Management.Reports');
  const canExport = can('Export', 'Fixed Deposit Management.FD Register')
    || can('Export', 'Fixed Deposit Management.Reports')
    || can('Export', 'Fixed Deposit Management.Import & Reconciliation');

  const [deposits, setDeposits] = useState<FixedDeposit[]>([]);
  const [assignments, setAssignments] = useState<FDAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [bank, setBank] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [year, setYear] = useState('ALL');
  const [project, setProject] = useState('ALL');
  const [holder, setHolder] = useState('ALL');
  const [utilisation, setUtilisation] = useState<string>('ALL');
  const [maturityFrom, setMaturityFrom] = useState('');
  const [maturityTo, setMaturityTo] = useState('');

  const [preset, setPreset] = useState('standard');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => FD_EXPORT_PRESETS[0].keys as string[]);
  const [sheets, setSheets] = useState<SheetKey[]>(['assignments', 'bankSummary']);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scoped = (name: string) => (user?.role === 'Super Admin' || !user?.organizationId
        ? collection(db, name)
        : query(collection(db, name), where('organizationId', '==', user.organizationId)));
      const [fdSnap, assignmentSnap] = await Promise.all([getDocs(scoped(FD_COLLECTIONS.deposits)), getDocs(scoped(FD_COLLECTIONS.assignments))]);
      setDeposits(fdSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FixedDeposit)).filter((fd) => !fd.isDeleted));
      setAssignments(assignmentSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FDAssignment)));
    } catch (error) {
      console.error('Unable to load FD export data', error);
      toast({ title: 'Unable to load fixed deposits', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, user?.organizationId, user?.role]);

  useEffect(() => { if (!authLoading && canView) void load(); else if (!authLoading) setLoading(false); }, [authLoading, canView, load]);

  /** Utilisation is recomputed from assignment records, matching the register's own view. */
  const rows = useMemo<FdExportRow[]>(() => deposits.map((fd) => {
    const linked = assignments.filter((item) => item.fdId === fd.id);
    const active = linked.filter((item) => ACTIVE_ASSIGNMENT_STATUSES.includes(item.status));
    const reservedRows = linked.filter((item) => RESERVED_ASSIGNMENT_STATUSES.includes(item.status));
    const bg = active.filter((item) => item.instrumentType === 'BG').reduce((total, item) => total + outstanding(item), 0);
    const lc = active.filter((item) => item.instrumentType === 'LC').reduce((total, item) => total + outstanding(item), 0);
    const reserved = reservedRows.reduce((total, item) => total + outstanding(item), 0);
    const eligible = Number(fd.eligibleValue || calculateEligibleValue(fd.principalAmount, fd.eligibleMarginPercentage || 100));
    const available = Math.max(0, Number((eligible - bg - lc - reserved).toFixed(2)));
    return {
      ...fd,
      computedStatus: deriveOperationalStatus({ ...fd, bgUtilizedAmount: bg, lcUtilizedAmount: lc, reservedAmount: reserved, totalUtilizedAmount: bg + lc, availableAmount: available }),
      computedEligible: eligible,
      computedBg: bg,
      computedLc: lc,
      computedReserved: reserved,
      computedUtilised: Number((bg + lc + reserved).toFixed(2)),
      computedAvailable: available,
      daysToMaturity: daysUntil(fd.maturityDate),
      financialYear: financialYearForDate(fd.valueDate),
      assignmentCount: active.length,
      instrumentNumbers: active.map((item) => `${item.instrumentType} ${item.instrumentNumber}`).join(', '),
    };
  }), [assignments, deposits]);

  const banks = useMemo(() => Array.from(new Set(rows.map((row) => row.bankName).filter(Boolean))).sort(), [rows]);
  const statuses = useMemo(() => Array.from(new Set(rows.map((row) => row.computedStatus))).sort(), [rows]);
  const years = useMemo(() => Array.from(new Set(rows.map((row) => row.financialYear))).sort().reverse(), [rows]);
  const projectNames = useMemo(() => Array.from(new Set(rows.map((row) => row.projectName).filter(Boolean) as string[])).sort(), [rows]);
  const holders = useMemo(() => Array.from(new Set(rows.map((row) => row.holderName).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => {
    const from = maturityFrom ? new Date(`${maturityFrom}T00:00:00`).getTime() : null;
    const to = maturityTo ? new Date(`${maturityTo}T23:59:59`).getTime() : null;
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (bank !== 'ALL' && row.bankName !== bank) return false;
      if (status !== 'ALL' && row.computedStatus !== status) return false;
      if (year !== 'ALL' && row.financialYear !== year) return false;
      if (project !== 'ALL' && (row.projectName || '') !== project) return false;
      if (holder !== 'ALL' && row.holderName !== holder) return false;
      if (utilisation === 'AVAILABLE' && row.computedAvailable <= 0) return false;
      if (utilisation === 'UTILISED' && row.computedUtilised <= 0) return false;
      if (utilisation === 'FULL' && row.computedAvailable > 0) return false;
      if (utilisation === 'UNUSED' && row.computedUtilised > 0) return false;
      const maturity = toDate(row.maturityDate)?.getTime() ?? null;
      if (from !== null && (maturity === null || maturity < from)) return false;
      if (to !== null && (maturity === null || maturity > to)) return false;
      if (term && !`${row.referenceNumber} ${row.fdNumber} ${row.bankName} ${row.branchName || ''} ${row.holderName} ${row.projectName || ''} ${row.remarks || ''}`.toLowerCase().includes(term)) return false;
      return true;
    }).sort((a, b) => (toDate(a.maturityDate)?.getTime() || 0) - (toDate(b.maturityDate)?.getTime() || 0));
  }, [bank, holder, maturityFrom, maturityTo, project, rows, search, status, utilisation, year]);

  const totals = useMemo(() => filtered.reduce((sum, row) => ({
    principal: sum.principal + row.principalAmount,
    eligible: sum.eligible + row.computedEligible,
    utilised: sum.utilised + row.computedUtilised,
    available: sum.available + row.computedAvailable,
  }), { principal: 0, eligible: 0, utilised: 0, available: 0 }), [filtered]);

  const columns = useMemo(() => FD_EXPORT_COLUMNS.filter((column) => selectedColumns.includes(column.key)), [selectedColumns]);
  const scopedAssignments = useMemo(() => {
    const ids = new Set(filtered.map((row) => row.id));
    return assignments.filter((item) => ids.has(item.fdId));
  }, [assignments, filtered]);

  const applyPreset = (id: string) => {
    setPreset(id);
    const found = FD_EXPORT_PRESETS.find((item) => item.id === id);
    if (!found) return;
    setSelectedColumns(found.keys === 'all' ? FD_EXPORT_COLUMNS.map((column) => column.key) : [...found.keys]);
  };

  const toggleColumn = (key: string) => {
    setPreset('custom');
    setSelectedColumns((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const toggleGroup = (group: string) => {
    const keys = FD_EXPORT_COLUMNS.filter((column) => column.group === group).map((column) => column.key);
    const allOn = keys.every((key) => selectedColumns.includes(key));
    setPreset('custom');
    setSelectedColumns((current) => (allOn ? current.filter((key) => !keys.includes(key)) : Array.from(new Set([...current, ...keys]))));
  };

  const resetFilters = () => {
    setSearch(''); setBank('ALL'); setStatus('ALL'); setYear('ALL'); setProject('ALL'); setHolder('ALL');
    setUtilisation('ALL'); setMaturityFrom(''); setMaturityTo('');
  };

  const scopeSummary = () => {
    const parts = [
      bank !== 'ALL' ? `Bank: ${bank}` : '',
      status !== 'ALL' ? `Status: ${fdStatusLabel(status)}` : '',
      year !== 'ALL' ? `FY: ${year}` : '',
      project !== 'ALL' ? `Project: ${project}` : '',
      holder !== 'ALL' ? `Holder: ${holder}` : '',
      utilisation !== 'ALL' ? `Utilisation: ${UTILISATION_FILTERS.find(([value]) => value === utilisation)?.[1]}` : '',
      maturityFrom ? `Maturity from ${maturityFrom}` : '',
      maturityTo ? `Maturity to ${maturityTo}` : '',
      search.trim() ? `Search: ${search.trim()}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'All fixed deposits';
  };

  const fileStem = `fd-export-${new Date().toISOString().slice(0, 10)}`;

  const exportExcel = async () => {
    if (!filtered.length || !columns.length) return;
    setBusy(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'SEL Live';
      workbook.created = new Date();

      const deposit = workbook.addWorksheet('Fixed Deposits');
      deposit.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width }));
      filtered.forEach((row) => {
        const record: Record<string, unknown> = {};
        columns.forEach((column) => { record[column.key] = column.value(row); });
        deposit.addRow(record);
      });
      // Totals live in a labelled row rather than a formula so CSV consumers see them too.
      const totalRow: Record<string, unknown> = {};
      const [firstColumn] = columns;
      totalRow[firstColumn.key] = `Total — ${filtered.length} deposits`;
      columns.forEach((column) => {
        if (column.kind !== 'amount') return;
        totalRow[column.key] = filtered.reduce((sum, row) => sum + (Number(column.value(row)) || 0), 0);
      });
      const added = deposit.addRow(totalRow);
      added.font = { bold: true };
      columns.forEach((column, index) => {
        const format = numberFormatFor(column.kind);
        if (format) deposit.getColumn(index + 1).numFmt = format;
        if (column.key === 'fdNumber' || column.key === 'pan') deposit.getColumn(index + 1).numFmt = '@';
      });
      styleHeaderRow(deposit as never);

      if (sheets.includes('assignments')) {
        const sheet = workbook.addWorksheet('BG-LC Assignments');
        sheet.columns = [
          { header: 'Instrument', key: 'instrument', width: 12 },
          { header: 'Instrument Number', key: 'number', width: 26 },
          { header: 'Party / Beneficiary', key: 'party', width: 28 },
          { header: 'FD Reference', key: 'fdReference', width: 26 },
          { header: 'FD Number', key: 'fdNumber', width: 22 },
          { header: 'Bank', key: 'bank', width: 24 },
          { header: 'Assigned', key: 'assigned', width: 16 },
          { header: 'Released', key: 'released', width: 16 },
          { header: 'Outstanding', key: 'outstandingAmount', width: 16 },
          { header: 'Margin %', key: 'margin', width: 11 },
          { header: 'Status', key: 'status', width: 20 },
          { header: 'Assigned On', key: 'assignedOn', width: 15 },
          { header: 'Expected Release', key: 'expected', width: 17 },
        ];
        const referenceByFd = new Map(filtered.map((row) => [row.id, row.referenceNumber]));
        scopedAssignments.forEach((item) => sheet.addRow({
          instrument: item.instrumentType,
          number: item.instrumentNumber,
          party: item.partyName || '',
          fdReference: referenceByFd.get(item.fdId) || '',
          fdNumber: item.fdNumber,
          bank: item.bankName,
          assigned: item.assignmentAmount,
          released: item.releasedAmount,
          outstandingAmount: assignmentOutstanding(item),
          margin: item.marginPercentage ?? '',
          status: fdStatusLabel(item.status),
          assignedOn: toDate(item.assignmentDate) || '',
          expected: toDate(item.expectedReleaseDate) || '',
        }));
        ['assigned', 'released', 'outstandingAmount'].forEach((key) => { sheet.getColumn(key).numFmt = '#,##0.00'; });
        ['assignedOn', 'expected'].forEach((key) => { sheet.getColumn(key).numFmt = 'dd-mm-yyyy'; });
        styleHeaderRow(sheet as never, 'FF1D4ED8');
      }

      if (sheets.includes('maturity')) {
        const sheet = workbook.addWorksheet('Maturity Schedule');
        sheet.columns = [
          { header: 'Maturity Month', key: 'month', width: 18 },
          { header: 'Deposits', key: 'count', width: 11 },
          { header: 'Principal', key: 'principal', width: 18 },
          { header: 'Expected Interest', key: 'interest', width: 18 },
          { header: 'Maturity Amount', key: 'maturity', width: 18 },
          { header: 'Expected TDS', key: 'tds', width: 16 },
          { header: 'Net Proceeds', key: 'net', width: 18 },
          { header: 'Still Utilised', key: 'utilised', width: 16 },
        ];
        const buckets = new Map<string, { sort: number; count: number; principal: number; interest: number; maturity: number; tds: number; net: number; utilised: number }>();
        filtered.forEach((row) => {
          const date = toDate(row.maturityDate);
          const key = date ? date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'Unknown';
          const bucket = buckets.get(key) || { sort: date ? date.getFullYear() * 100 + date.getMonth() : 999_999, count: 0, principal: 0, interest: 0, maturity: 0, tds: 0, net: 0, utilised: 0 };
          bucket.count += 1;
          bucket.principal += row.principalAmount;
          bucket.interest += row.expectedInterest;
          bucket.maturity += row.maturityAmount;
          bucket.tds += row.expectedTds;
          bucket.net += row.expectedNetProceeds;
          bucket.utilised += row.computedUtilised;
          buckets.set(key, bucket);
        });
        Array.from(buckets.entries()).sort((a, b) => a[1].sort - b[1].sort).forEach(([month, bucket]) => sheet.addRow({
          month, count: bucket.count, principal: bucket.principal, interest: bucket.interest,
          maturity: bucket.maturity, tds: bucket.tds, net: bucket.net, utilised: bucket.utilised,
        }));
        ['principal', 'interest', 'maturity', 'tds', 'net', 'utilised'].forEach((key) => { sheet.getColumn(key).numFmt = '#,##0.00'; });
        styleHeaderRow(sheet as never, 'FFB45309');
      }

      if (sheets.includes('bankSummary')) {
        const sheet = workbook.addWorksheet('Bank Summary');
        sheet.columns = [
          { header: 'Bank', key: 'bank', width: 30 },
          { header: 'Deposits', key: 'count', width: 11 },
          { header: 'Principal', key: 'principal', width: 18 },
          { header: 'Eligible Value', key: 'eligible', width: 18 },
          { header: 'BG Utilised', key: 'bg', width: 16 },
          { header: 'LC Utilised', key: 'lc', width: 16 },
          { header: 'Reserved', key: 'reserved', width: 16 },
          { header: 'Available', key: 'available', width: 18 },
          { header: 'Utilisation %', key: 'percent', width: 14 },
        ];
        const buckets = new Map<string, { count: number; principal: number; eligible: number; bg: number; lc: number; reserved: number; available: number }>();
        filtered.forEach((row) => {
          const bucket = buckets.get(row.bankName) || { count: 0, principal: 0, eligible: 0, bg: 0, lc: 0, reserved: 0, available: 0 };
          bucket.count += 1;
          bucket.principal += row.principalAmount;
          bucket.eligible += row.computedEligible;
          bucket.bg += row.computedBg;
          bucket.lc += row.computedLc;
          bucket.reserved += row.computedReserved;
          bucket.available += row.computedAvailable;
          buckets.set(row.bankName, bucket);
        });
        Array.from(buckets.entries()).sort((a, b) => b[1].principal - a[1].principal).forEach(([name, bucket]) => sheet.addRow({
          bank: name, count: bucket.count, principal: bucket.principal, eligible: bucket.eligible,
          bg: bucket.bg, lc: bucket.lc, reserved: bucket.reserved, available: bucket.available,
          percent: bucket.eligible ? Number((((bucket.bg + bucket.lc + bucket.reserved) / bucket.eligible) * 100).toFixed(2)) : 0,
        }));
        const summaryTotal = sheet.addRow({
          bank: 'Total', count: filtered.length, principal: totals.principal, eligible: totals.eligible,
          bg: filtered.reduce((sum, row) => sum + row.computedBg, 0), lc: filtered.reduce((sum, row) => sum + row.computedLc, 0),
          reserved: filtered.reduce((sum, row) => sum + row.computedReserved, 0), available: totals.available,
          percent: totals.eligible ? Number(((totals.utilised / totals.eligible) * 100).toFixed(2)) : 0,
        });
        summaryTotal.font = { bold: true };
        ['principal', 'eligible', 'bg', 'lc', 'reserved', 'available'].forEach((key) => { sheet.getColumn(key).numFmt = '#,##0.00'; });
        sheet.getColumn('percent').numFmt = '0.00';
        styleHeaderRow(sheet as never, 'FF7C3AED');
      }

      if (sheets.includes('importLayout')) {
        const sheet = workbook.addWorksheet('Import Template Layout');
        sheet.columns = FD_IMPORT_FIELDS.map((field) => ({ header: field.label, key: field.key, width: columnWidthFor(field.label) }));
        filtered.forEach((row) => sheet.addRow(toImportShapedRow(row)));
        FD_IMPORT_FIELDS.forEach((field, index) => {
          const column = sheet.getColumn(index + 1);
          if (field.key === 'fdNumber' || field.key === 'pan') column.numFmt = '@';
          else if (field.type === 'date') column.numFmt = 'dd-mm-yyyy';
          else if (field.type === 'number' && field.decimals === 2) column.numFmt = '#,##0.00';
        });
        styleHeaderRow(sheet as never, 'FF0F766E');
      }

      const scope = workbook.addWorksheet('Export Scope');
      scope.columns = [{ header: 'Parameter', key: 'parameter', width: 26 }, { header: 'Value', key: 'value', width: 90 }];
      [
        ['Generated', new Date().toLocaleString('en-IN')],
        ['Generated by', `${user?.name || ''} (${user?.email || ''})`],
        ['Organization', user?.organizationName || user?.organizationId || ''],
        ['Filters', scopeSummary()],
        ['Deposits exported', `${filtered.length} of ${rows.length}`],
        ['Columns', columns.map((column) => column.header).join(', ')],
        ['Additional sheets', sheets.length ? sheets.map((key) => OPTIONAL_SHEETS.find((item) => item.key === key)?.label).filter(Boolean).join(', ') : 'None'],
        ['Total principal', formatFdCurrency(totals.principal)],
        ['Total available', formatFdCurrency(totals.available)],
      ].forEach(([parameter, value]) => scope.addRow({ parameter, value }));
      scope.getColumn('value').alignment = { wrapText: true, vertical: 'top' };
      styleHeaderRow(scope as never, 'FF334155');

      await downloadWorkbook(workbook as never, `${fileStem}.xlsx`);
      if (user) {
        await logUserActivity({
          userId: user.id, userName: user.name, userEmail: user.email, module: 'Fixed Deposit Management',
          action: 'Export Fixed Deposits',
          details: { format: 'xlsx', rows: filtered.length, columns: columns.map((column) => column.key), sheets, filters: scopeSummary() },
        });
      }
      toast({ title: `${filtered.length} fixed deposits exported`, description: `${columns.length} columns · ${sheets.length + 2} sheets.` });
    } catch (error) {
      console.error('FD export failed', error);
      toast({ title: 'Export failed', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    if (!filtered.length || !columns.length) return;
    const body = [
      columns.map((column) => column.header),
      ...filtered.map((row) => columns.map((column) => {
        const value = column.value(row);
        return value instanceof Date ? value.toISOString().slice(0, 10) : value;
      })),
    ].map((line) => line.map(escapeCsv).join(',')).join('\r\n');
    // BOM so Excel opens rupee amounts and holder names in UTF-8 rather than ANSI.
    downloadBlob(new Blob(['﻿', body], { type: 'text/csv;charset=utf-8' }), `${fileStem}.csv`);
    if (user) {
      await logUserActivity({
        userId: user.id, userName: user.name, userEmail: user.email, module: 'Fixed Deposit Management',
        action: 'Export Fixed Deposits',
        details: { format: 'csv', rows: filtered.length, columns: columns.map((column) => column.key), filters: scopeSummary() },
      });
    }
    toast({ title: `${filtered.length} rows exported to CSV` });
  };

  if (authLoading || loading) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canView) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view the fixed-deposit register.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  const previewRows = filtered.slice(0, PREVIEW_ROWS);
  const previewColumns = columns.slice(0, 8);

  return <div className="space-y-4">
    <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">FD Export Centre</h1>
        <p className="text-sm text-muted-foreground">Filter the register, pick your columns, and export a multi-sheet workbook — including a re-importable template layout.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild><Link href="/fixed-deposit/import"><Upload className="mr-2 h-4 w-4" />Import Workspace</Link></Button>
        <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </div>

    <div className="grid gap-3 sm:grid-cols-4">
      {[
        ['Deposits in scope', `${filtered.length} / ${rows.length}`, 'text-slate-900'],
        ['Principal', formatFdCurrency(totals.principal), 'text-slate-900'],
        ['Utilised', formatFdCurrency(totals.utilised), 'text-blue-700'],
        ['Available', formatFdCurrency(totals.available), 'text-emerald-700'],
      ].map(([label, value, tone]) => <Card key={label} className="border-white/80 bg-white/90"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn('mt-1 text-xl font-bold', tone)}>{value}</p></CardContent></Card>)}
    </div>

    <Card className="border-white/80 bg-white/90 shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div><CardTitle className="text-base">1. Scope</CardTitle><CardDescription>{scopeSummary()}</CardDescription></div>
        <Button variant="ghost" size="sm" onClick={resetFilters}><RotateCcw className="mr-2 h-4 w-4" />Clear</Button>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative sm:col-span-2 xl:col-span-2">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, FD number, bank, holder, project, remarks…" className="pl-9" />
        </div>
        <div className="space-y-1.5"><Label className="text-xs">Bank</Label><Select value={bank} onValueChange={setBank}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All banks</SelectItem>{banks.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs">Operational status</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All statuses</SelectItem>{statuses.map((value) => <SelectItem key={value} value={value}>{fdStatusLabel(value)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs">Financial year</Label><Select value={year} onValueChange={setYear}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All financial years</SelectItem>{years.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs">Project</Label><Select value={project} onValueChange={setProject}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All projects</SelectItem>{projectNames.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs">Holder</Label><Select value={holder} onValueChange={setHolder}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All holders</SelectItem>{holders.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs">Utilisation</Label><Select value={utilisation} onValueChange={setUtilisation}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{UTILISATION_FILTERS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs">Maturity from</Label><Input type="date" value={maturityFrom} onChange={(event) => setMaturityFrom(event.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Maturity to</Label><Input type="date" value={maturityTo} onChange={(event) => setMaturityTo(event.target.value)} /></div>
      </CardContent>
    </Card>

    <Card className="border-white/80 bg-white/90 shadow-sm">
      <CardHeader><CardTitle className="text-base">2. Columns</CardTitle><CardDescription>{columns.length} of {FD_EXPORT_COLUMNS.length} columns selected. Presets are a starting point — every checkbox is editable.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{FD_EXPORT_PRESETS.map((item) => <button key={item.id} type="button" onClick={() => applyPreset(item.id)} className={cn('rounded-lg border p-2.5 text-left transition-colors', preset === item.id ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white hover:bg-slate-50')}>
          <span className="flex items-center gap-1.5 text-sm font-medium">{preset === item.id && <Columns3 className="h-3.5 w-3.5 text-cyan-700" />}{item.label}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{item.description}</span>
        </button>)}</div>
        <Separator />
        <div className="space-y-3">{FD_EXPORT_COLUMN_GROUPS.map((group) => {
          const groupColumns = FD_EXPORT_COLUMNS.filter((column) => column.group === group);
          const activeCount = groupColumns.filter((column) => selectedColumns.includes(column.key)).length;
          return <div key={group} className="space-y-1.5">
            <button type="button" onClick={() => toggleGroup(group)} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800">
              {group}<Badge variant="secondary" className="text-[10px]">{activeCount}/{groupColumns.length}</Badge>
            </button>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">{groupColumns.map((column) => <label key={column.key} className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox checked={selectedColumns.includes(column.key)} onCheckedChange={() => toggleColumn(column.key)} />
              <span className={selectedColumns.includes(column.key) ? 'text-slate-800' : 'text-muted-foreground'}>{column.header}</span>
            </label>)}</div>
          </div>;
        })}</div>
      </CardContent>
    </Card>

    <Card className="border-white/80 bg-white/90 shadow-sm">
      <CardHeader><CardTitle className="text-base">3. Sheets</CardTitle><CardDescription>The Fixed Deposits sheet and an Export Scope sheet recording the filters are always included.</CardDescription></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">{OPTIONAL_SHEETS.map((sheet) => <label key={sheet.key} className={cn('flex cursor-pointer gap-2.5 rounded-lg border p-2.5', sheets.includes(sheet.key) ? 'border-cyan-200 bg-cyan-50/50' : 'border-slate-200 bg-white hover:bg-slate-50')}>
        <Checkbox className="mt-0.5" checked={sheets.includes(sheet.key)} onCheckedChange={() => setSheets((current) => (current.includes(sheet.key) ? current.filter((key) => key !== sheet.key) : [...current, sheet.key]))} />
        <span><span className="block text-sm font-medium">{sheet.label}</span><span className="block text-[11px] leading-snug text-muted-foreground">{sheet.description}</span></span>
      </label>)}</CardContent>
    </Card>

    <Card className="overflow-hidden border-white/80 bg-white/90 shadow-sm">
      <CardHeader className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div><CardTitle className="text-base">4. Preview &amp; download</CardTitle><CardDescription>First {previewRows.length} rows{columns.length > previewColumns.length ? ` · ${previewColumns.length} of ${columns.length} columns shown` : ''}.</CardDescription></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void exportCsv()} disabled={!canExport || !filtered.length || !columns.length}><FileSpreadsheet className="mr-2 h-4 w-4" />CSV</Button>
          <Button onClick={() => void exportExcel()} disabled={!canExport || busy || !filtered.length || !columns.length} className="bg-gradient-to-r from-cyan-600 to-blue-700">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Export Excel ({filtered.length})
          </Button>
        </div>
      </CardHeader>
      {!canExport && <CardContent className="pt-0"><p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">You can review the scope, but an Export permission on the FD Register, Reports or Import &amp; Reconciliation is required to download.</p></CardContent>}
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>{previewColumns.map((column) => <TableHead key={column.key} className={column.kind === 'amount' || column.kind === 'number' || column.kind === 'percent' ? 'text-right' : undefined}>{column.header}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {previewRows.map((row) => <TableRow key={row.id}>{previewColumns.map((column) => {
                const value = column.value(row);
                const display = value instanceof Date ? value.toLocaleDateString('en-IN') : column.kind === 'amount' ? formatFdCurrency(Number(value) || 0, row.currency) : String(value ?? '');
                return <TableCell key={column.key} className={cn('whitespace-nowrap text-xs', (column.kind === 'amount' || column.kind === 'number' || column.kind === 'percent') && 'text-right')}>{display}</TableCell>;
              })}</TableRow>)}
              {!previewRows.length && <TableRow><TableCell colSpan={Math.max(1, previewColumns.length)} className="h-28 text-center text-sm text-muted-foreground">No fixed deposits match this scope.</TableCell></TableRow>}
              {!columns.length && <TableRow><TableCell className="h-28 text-center text-sm text-muted-foreground">Select at least one column to export.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  </div>;
}
