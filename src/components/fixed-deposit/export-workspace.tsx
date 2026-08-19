'use client';

/**
 * FD Export Centre — filtered, multi-sheet export of the fixed-deposit register.
 *
 * The register and reports pages each hand-roll a single fixed-column workbook. This
 * page owns the general case: choose the scope, choose the columns (or a preset), and
 * emit one workbook with the deposits plus any of the derived sheets. The
 * "Import template layout" sheet writes the exact header order the import wizard maps
 * automatically, which is what makes edit-offline-and-re-import a supported round trip.
 *
 * Layout mirrors the import wizard: four numbered steps shown one at a time, with a
 * sticky summary rail that keeps the running totals and the download buttons in view
 * no matter which step is open.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Columns3,
  Download,
  FileSpreadsheet,
  Filter,
  Landmark,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Table2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
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
const PREVIEW_COLUMNS = 10;

type SheetKey = 'deposits' | 'assignments' | 'maturity' | 'bankSummary' | 'importLayout';
type Step = 'scope' | 'columns' | 'sheets' | 'download';

const STEPS: Array<{ id: Step; label: string; caption: string; icon: LucideIcon }> = [
  { id: 'scope', label: 'Scope', caption: 'Which deposits', icon: Filter },
  { id: 'columns', label: 'Columns', caption: 'Which fields', icon: Columns3 },
  { id: 'sheets', label: 'Sheets', caption: 'What goes in the file', icon: Layers },
  { id: 'download', label: 'Preview & Download', caption: 'Check, then export', icon: Download },
];

const ALWAYS_ON_SHEETS: Array<{ label: string; description: string }> = [
  { label: 'Fixed Deposits', description: 'One row per deposit in scope, using the columns picked in step 2, with a totals row.' },
  { label: 'Export Scope', description: 'Who exported what, when, and under which filters — the audit copy of this screen.' },
];

const OPTIONAL_SHEETS: Array<{ key: SheetKey; label: string; description: string; icon: LucideIcon }> = [
  { key: 'assignments', label: 'BG / LC Assignments', description: 'Every assignment against the deposits in scope, with outstanding amounts.', icon: Landmark },
  { key: 'maturity', label: 'Maturity Schedule', description: 'Month-wise maturing principal, interest and net proceeds.', icon: CalendarClock },
  { key: 'bankSummary', label: 'Bank Summary', description: 'Bank-wise principal, utilisation and availability with a totals row.', icon: BarChart3 },
  { key: 'importLayout', label: 'Import Template Layout', description: 'Same columns as the import template, so the file can be edited and re-imported.', icon: Upload },
];

const UTILISATION_FILTERS = [
  ['ALL', 'Any utilisation'],
  ['AVAILABLE', 'Has available balance'],
  ['UTILISED', 'Partly or fully utilised'],
  ['FULL', 'Fully utilised'],
  ['UNUSED', 'Never utilised'],
] as const;

type ActiveFilter = { key: string; label: string; clear: () => void };

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

  const [step, setStep] = useState<Step>('scope');

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
  const [columnQuery, setColumnQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [sheets, setSheets] = useState<SheetKey[]>(['assignments', 'bankSummary']);
  const [showAllPreviewColumns, setShowAllPreviewColumns] = useState(false);

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

  /** One list drives the removable chips, the scope caption and the audit sheet. */
  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = [];
    if (bank !== 'ALL') list.push({ key: 'bank', label: `Bank: ${bank}`, clear: () => setBank('ALL') });
    if (status !== 'ALL') list.push({ key: 'status', label: `Status: ${fdStatusLabel(status)}`, clear: () => setStatus('ALL') });
    if (year !== 'ALL') list.push({ key: 'year', label: `FY: ${year}`, clear: () => setYear('ALL') });
    if (project !== 'ALL') list.push({ key: 'project', label: `Project: ${project}`, clear: () => setProject('ALL') });
    if (holder !== 'ALL') list.push({ key: 'holder', label: `Holder: ${holder}`, clear: () => setHolder('ALL') });
    if (utilisation !== 'ALL') list.push({ key: 'utilisation', label: `Utilisation: ${UTILISATION_FILTERS.find(([value]) => value === utilisation)?.[1]}`, clear: () => setUtilisation('ALL') });
    if (maturityFrom) list.push({ key: 'from', label: `Maturity from ${maturityFrom}`, clear: () => setMaturityFrom('') });
    if (maturityTo) list.push({ key: 'to', label: `Maturity to ${maturityTo}`, clear: () => setMaturityTo('') });
    if (search.trim()) list.push({ key: 'search', label: `Search: ${search.trim()}`, clear: () => setSearch('') });
    return list;
  }, [bank, holder, maturityFrom, maturityTo, project, search, status, utilisation, year]);

  const scopeText = activeFilters.length ? activeFilters.map((item) => item.label).join(' · ') : 'All fixed deposits';

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

  const fileStem = `fd-export-${new Date().toISOString().slice(0, 10)}`;
  const sheetCount = sheets.length + ALWAYS_ON_SHEETS.length;
  const canDownload = canExport && Boolean(filtered.length) && Boolean(columns.length);

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
        ['Filters', scopeText],
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
          details: { format: 'xlsx', rows: filtered.length, columns: columns.map((column) => column.key), sheets, filters: scopeText },
        });
      }
      toast({ title: `${filtered.length} fixed deposits exported`, description: `${columns.length} columns · ${sheetCount} sheets.` });
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
        details: { format: 'csv', rows: filtered.length, columns: columns.map((column) => column.key), filters: scopeText },
      });
    }
    toast({ title: `${filtered.length} rows exported to CSV` });
  };

  if (authLoading || loading) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canView) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view the fixed-deposit register.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const previous = STEPS[stepIndex - 1];
  const next = STEPS[stepIndex + 1];
  const stepValue: Record<Step, string> = {
    scope: `${filtered.length} of ${rows.length} deposits`,
    columns: `${columns.length} of ${FD_EXPORT_COLUMNS.length} fields`,
    sheets: `${sheetCount} sheets`,
    download: `${fileStem}.xlsx`,
  };

  // Not named `query` — that identifier is Firestore's, used by load() in the same scope.
  const fieldSearch = columnQuery.trim().toLowerCase();
  const previewRows = filtered.slice(0, PREVIEW_ROWS);
  const previewColumns = showAllPreviewColumns ? columns : columns.slice(0, PREVIEW_COLUMNS);

  return <div className="space-y-4">
    <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">FD Export Centre</h1>
        <p className="text-sm text-muted-foreground">Four steps: choose the deposits, choose the columns, choose the sheets, download. The summary on the right updates as you go.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild><Link href="/fixed-deposit/import"><Upload className="mr-2 h-4 w-4" />Import Workspace</Link></Button>
        <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </div>

    {/* Step rail — every step is reachable directly; each chip doubles as a status readout. */}
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {STEPS.map((item, index) => {
        const state = item.id === step ? 'active' : index < stepIndex ? 'done' : 'todo';
        const Icon = item.icon;
        return <button key={item.id} type="button" onClick={() => setStep(item.id)}
          className={cn('flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all',
            state === 'active' && 'border-cyan-300 bg-gradient-to-r from-cyan-600 to-blue-700 text-white shadow-md',
            state === 'done' && 'border-emerald-200 bg-emerald-50/80 text-emerald-900 hover:bg-emerald-50',
            state === 'todo' && 'border-slate-200 bg-white/90 text-slate-600 hover:bg-slate-50')}>
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', state === 'active' ? 'bg-white/20' : state === 'done' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500')}>
            {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold">{index + 1}. {item.label}</span>
            <span className={cn('block truncate text-[11px]', state === 'active' ? 'text-white/80' : 'text-muted-foreground')}>{stepValue[item.id]}</span>
          </span>
        </button>;
      })}
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      {/* ── summary rail ─────────────────────────────────────────────────── */}
      <aside className="order-1 space-y-3 lg:sticky lg:top-20 lg:order-2">
        <Card className="border-white/80 bg-white/90 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Export summary</CardTitle><CardDescription className="line-clamp-2">{scopeText}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Deposits in scope</p>
              <p className="text-2xl font-bold text-slate-900">{filtered.length}<span className="ml-1 text-sm font-medium text-muted-foreground">/ {rows.length}</span></p>
            </div>
            <div className="space-y-1.5 text-sm">
              {[
                ['Principal', formatFdCurrency(totals.principal), 'text-slate-900'],
                ['Utilised', formatFdCurrency(totals.utilised), 'text-blue-700'],
                ['Available', formatFdCurrency(totals.available), 'text-emerald-700'],
              ].map(([label, value, tone]) => <div key={label} className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{label}</span><span className={cn('font-semibold', tone)}>{value}</span>
              </div>)}
            </div>
            <Separator />
            <div className="space-y-1.5 text-sm">
              <div className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">Columns</span><span className="font-semibold">{columns.length}</span></div>
              <div className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">Sheets</span><span className="font-semibold">{sheetCount}</span></div>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {['Fixed Deposits', ...sheets.map((key) => OPTIONAL_SHEETS.find((item) => item.key === key)?.label || ''), 'Export Scope']
                  .filter(Boolean).map((label) => <Badge key={label} variant="secondary" className="text-[10px] font-normal">{label}</Badge>)}
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <Button onClick={() => void exportExcel()} disabled={!canDownload || busy} className="w-full bg-gradient-to-r from-cyan-600 to-blue-700">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Export Excel
              </Button>
              <Button variant="outline" className="w-full" onClick={() => void exportCsv()} disabled={!canDownload}><FileSpreadsheet className="mr-2 h-4 w-4" />Export CSV (deposits only)</Button>
              <p className="text-[11px] leading-snug text-muted-foreground">Saved as <span className="font-medium text-slate-700">{fileStem}.xlsx</span></p>
            </div>
            {!canExport && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">You can review the scope, but an Export permission on the FD Register, Reports or Import &amp; Reconciliation is required to download.</p>}
            {canExport && !filtered.length && <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">No deposits match the current scope — widen the filters in step 1.</p>}
            {canExport && Boolean(filtered.length) && !columns.length && <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">Pick at least one column in step 2.</p>}
          </CardContent>
        </Card>
      </aside>

      {/* ── active step ──────────────────────────────────────────────────── */}
      <div className="order-2 min-w-0 space-y-3 lg:order-1">
        {step === 'scope' && <Card className="border-white/80 bg-white/90 shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div><CardTitle className="text-base">Step 1 · Which deposits?</CardTitle><CardDescription>Everything downstream — columns, sheets and totals — applies to these {filtered.length} deposits.</CardDescription></div>
            {Boolean(activeFilters.length) && <Button variant="ghost" size="sm" onClick={resetFilters}><RotateCcw className="mr-2 h-4 w-4" />Clear all</Button>}
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reference, FD number, bank, holder, project or remarks…" className="pl-9" />
            </div>

            <div className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deposit attributes</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-1.5"><Label className="text-xs">Bank</Label><Select value={bank} onValueChange={setBank}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All banks</SelectItem>{banks.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="text-xs">Operational status</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All statuses</SelectItem>{statuses.map((value) => <SelectItem key={value} value={value}>{fdStatusLabel(value)}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="text-xs">Financial year</Label><Select value={year} onValueChange={setYear}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All financial years</SelectItem>{years.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="text-xs">Project</Label><Select value={project} onValueChange={setProject}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All projects</SelectItem>{projectNames.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="text-xs">Holder</Label><Select value={holder} onValueChange={setHolder}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All holders</SelectItem>{holders.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
              </div>
            </div>

            <div className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Balance &amp; maturity window</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-1.5"><Label className="text-xs">Utilisation</Label><Select value={utilisation} onValueChange={setUtilisation}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{UTILISATION_FILTERS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="text-xs">Maturity from</Label><Input type="date" value={maturityFrom} onChange={(event) => setMaturityFrom(event.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Maturity to</Label><Input type="date" value={maturityTo} onChange={(event) => setMaturityTo(event.target.value)} /></div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applied filters</p>
              {activeFilters.length
                ? <div className="mt-2 flex flex-wrap gap-1.5">{activeFilters.map((item) => <button key={item.key} type="button" onClick={item.clear}
                    className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-medium text-cyan-800 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                    {item.label}<X className="h-3 w-3" />
                  </button>)}</div>
                : <p className="mt-1 text-xs text-muted-foreground">None — the whole register ({rows.length} deposits) will be exported.</p>}
            </div>
          </CardContent>
        </Card>}

        {step === 'columns' && <Card className="border-white/80 bg-white/90 shadow-sm">
          <CardHeader><CardTitle className="text-base">Step 2 · Which columns?</CardTitle><CardDescription>Start from a preset, then expand any group to fine-tune. {columns.length} of {FD_EXPORT_COLUMNS.length} fields selected.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Presets</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{FD_EXPORT_PRESETS.map((item) => <button key={item.id} type="button" onClick={() => applyPreset(item.id)} className={cn('rounded-lg border p-2.5 text-left transition-colors', preset === item.id ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white hover:bg-slate-50')}>
                <span className="flex items-center gap-1.5 text-sm font-medium">{preset === item.id && <CheckCircle2 className="h-3.5 w-3.5 text-cyan-700" />}{item.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{item.description}</span>
              </button>)}
              {preset === 'custom' && <div className="rounded-lg border border-dashed border-cyan-300 bg-cyan-50/50 p-2.5">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Columns3 className="h-3.5 w-3.5 text-cyan-700" />Custom selection</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">You have edited a preset. Pick a preset above to start over.</span>
              </div>}</div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected columns ({columns.length})</p>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setPreset('all'); setSelectedColumns(FD_EXPORT_COLUMNS.map((column) => column.key)); }}>Select all</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setPreset('custom'); setSelectedColumns([]); }}>Clear</Button>
                </div>
              </div>
              {columns.length
                ? <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2">
                    {columns.map((column, index) => <button key={column.key} type="button" onClick={() => toggleColumn(column.key)}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                      <span className="text-[9px] font-semibold text-muted-foreground">{index + 1}</span>{column.header}<X className="h-3 w-3" />
                    </button>)}
                  </div>
                : <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-muted-foreground">No columns selected — the workbook needs at least one.</p>}
              <p className="text-[11px] text-muted-foreground">Columns are written left to right in the order shown above.</p>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">All fields by group</p>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpenGroups((current) => (current.length ? [] : [...FD_EXPORT_COLUMN_GROUPS]))}>
                  {openGroups.length ? 'Collapse all' : 'Expand all'}
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={columnQuery} onChange={(event) => setColumnQuery(event.target.value)} placeholder="Find a field by name…" className="pl-9" />
              </div>
              <div className="space-y-2">{FD_EXPORT_COLUMN_GROUPS.map((group) => {
                const groupColumns = FD_EXPORT_COLUMNS.filter((column) => column.group === group);
                const visible = fieldSearch ? groupColumns.filter((column) => column.header.toLowerCase().includes(fieldSearch)) : groupColumns;
                if (!visible.length) return null;
                const activeCount = groupColumns.filter((column) => selectedColumns.includes(column.key)).length;
                const open = Boolean(fieldSearch) || openGroups.includes(group);
                return <div key={group} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center gap-2.5 px-3 py-2">
                    <Checkbox checked={activeCount === groupColumns.length} onCheckedChange={() => toggleGroup(group)} aria-label={`Select all ${group} columns`} />
                    <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                      onClick={() => setOpenGroups((current) => (current.includes(group) ? current.filter((item) => item !== group) : [...current, group]))}>
                      <span className="truncate text-sm font-medium text-slate-700">{group}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant={activeCount ? 'secondary' : 'outline'} className="text-[10px] font-normal">{activeCount}/{groupColumns.length}</Badge>
                        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
                      </span>
                    </button>
                  </div>
                  {open && <div className="grid gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/50 px-3 py-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map((column) => <label key={column.key} className="flex cursor-pointer items-center gap-2 text-xs">
                      <Checkbox checked={selectedColumns.includes(column.key)} onCheckedChange={() => toggleColumn(column.key)} />
                      <span className={cn('truncate', selectedColumns.includes(column.key) ? 'text-slate-800' : 'text-muted-foreground')} title={column.header}>{column.header}</span>
                    </label>)}
                  </div>}
                </div>;
              })}</div>
            </div>
          </CardContent>
        </Card>}

        {step === 'sheets' && <Card className="border-white/80 bg-white/90 shadow-sm">
          <CardHeader><CardTitle className="text-base">Step 3 · What goes in the workbook?</CardTitle><CardDescription>{sheetCount} sheets will be written. Optional sheets are derived from the same {filtered.length} deposits.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Always included</p>
              <div className="grid gap-2 sm:grid-cols-2">{ALWAYS_ON_SHEETS.map((sheet) => <div key={sheet.label} className="flex gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span><span className="block text-sm font-medium text-slate-700">{sheet.label}</span><span className="block text-[11px] leading-snug text-muted-foreground">{sheet.description}</span></span>
              </div>)}</div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Optional sheets</p>
              <div className="grid gap-2 sm:grid-cols-2">{OPTIONAL_SHEETS.map((sheet) => {
                const on = sheets.includes(sheet.key);
                const Icon = sheet.icon;
                return <label key={sheet.key} className={cn('flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition-colors', on ? 'border-cyan-300 bg-cyan-50/60' : 'border-slate-200 bg-white hover:bg-slate-50')}>
                  <Checkbox className="mt-0.5" checked={on} onCheckedChange={() => setSheets((current) => (current.includes(sheet.key) ? current.filter((key) => key !== sheet.key) : [...current, sheet.key]))} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium"><Icon className={cn('h-3.5 w-3.5', on ? 'text-cyan-700' : 'text-slate-400')} />{sheet.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{sheet.description}</span>
                  </span>
                </label>;
              })}</div>
            </div>
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              CSV carries the Fixed Deposits sheet only — pick Excel if you need any of the derived sheets.
            </p>
          </CardContent>
        </Card>}

        {step === 'download' && <Card className="overflow-hidden border-white/80 bg-white/90 shadow-sm">
          <CardHeader className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <CardTitle className="text-base">Step 4 · Preview &amp; download</CardTitle>
              <CardDescription>First {previewRows.length} of {filtered.length} rows · {previewColumns.length} of {columns.length} columns shown.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {columns.length > PREVIEW_COLUMNS && <Button variant="outline" size="sm" onClick={() => setShowAllPreviewColumns((current) => !current)}>
                <Table2 className="mr-2 h-4 w-4" />{showAllPreviewColumns ? `First ${PREVIEW_COLUMNS} columns` : `All ${columns.length} columns`}
              </Button>}
              <Button size="sm" onClick={() => void exportExcel()} disabled={!canDownload || busy} className="bg-gradient-to-r from-cyan-600 to-blue-700">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Export Excel ({filtered.length})
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto border-t border-slate-100">
              <Table>
                <TableHeader><TableRow>{previewColumns.map((column) => <TableHead key={column.key} className={cn('whitespace-nowrap', (column.kind === 'amount' || column.kind === 'number' || column.kind === 'percent') && 'text-right')}>{column.header}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {Boolean(previewColumns.length) && previewRows.map((row) => <TableRow key={row.id}>{previewColumns.map((column) => {
                    const value = column.value(row);
                    const display = value instanceof Date ? value.toLocaleDateString('en-IN') : column.kind === 'amount' ? formatFdCurrency(Number(value) || 0, row.currency) : String(value ?? '');
                    return <TableCell key={column.key} className={cn('whitespace-nowrap text-xs', (column.kind === 'amount' || column.kind === 'number' || column.kind === 'percent') && 'text-right')}>{display}</TableCell>;
                  })}</TableRow>)}
                  {!columns.length && <TableRow><TableCell className="h-28 text-center text-sm text-muted-foreground">Select at least one column in step 2 to preview the export.</TableCell></TableRow>}
                  {Boolean(columns.length) && !previewRows.length && <TableRow><TableCell colSpan={previewColumns.length} className="h-28 text-center text-sm text-muted-foreground">No fixed deposits match this scope — widen the filters in step 1.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>}

        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={() => previous && setStep(previous.id)} disabled={!previous}>
            <ArrowLeft className="mr-2 h-4 w-4" />{previous ? previous.label : 'Back'}
          </Button>
          {next && <Button variant="outline" onClick={() => setStep(next.id)}>{next.label}<ArrowRight className="ml-2 h-4 w-4" /></Button>}
        </div>
      </div>
    </div>
  </div>;
}
