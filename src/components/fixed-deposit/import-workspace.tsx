'use client';

/**
 * FD Import & Reconciliation — a four-step wizard (upload → map → validate → import).
 *
 * The previous version read fifteen hard-coded headers off row 1 and inserted whatever
 * it found. This one maps arbitrary source columns onto the full FD field catalogue in
 * `@/lib/fd-import-export`, resolves banks and projects against the live masters,
 * validates every cell against the module's own enums, and allocates reference numbers
 * from the same `fdCounters` sequence the create form uses — so a migrated deposit is
 * indistinguishable from a hand-keyed one.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Workbook } from 'exceljs';
import { collection, doc, getDoc, getDocs, query, runTransaction, Timestamp, where, writeBatch } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Database, Download, FileSpreadsheet, Info, Loader2, RotateCcw, ShieldAlert, Upload, Wand2, XCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import type { BankAccount, Project } from '@/lib/types';
import {
  DEFAULT_FD_SETTINGS,
  FD_COLLECTIONS,
  FD_SETTINGS_PATH,
  calculateAvailableAmount,
  calculateEligibleValue,
  calculateMaturity,
  fdOrgCode,
  fdStatusLabel,
  financialYearForDate,
  formatFdCurrency,
  type FixedDeposit,
  type FixedDepositSettings,
} from '@/lib/fixed-deposit';
import {
  FD_IMPORT_FIELDS,
  FD_IMPORT_FIELD_GROUPS,
  autoMapColumns,
  cellValueToString,
  columnWidthFor,
  detectHeaderRow,
  downloadImportTemplate,
  downloadWorkbook,
  matchEnumOption,
  normalizeToken,
  parseDateCell,
  parseNumber,
  parseYesNo,
  roundTo,
  styleHeaderRow,
  worksheetToRows,
  type ImportField,
  type ImportFieldGroup,
  type ReadableSheet,
  type SheetRead,
} from '@/lib/fd-import-export';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/* ── constants ───────────────────────────────────────────────────────────── */

type Step = 'upload' | 'mapping' | 'validation' | 'summary';
const STEPS: Array<{ id: Step; label: string; caption: string }> = [
  { id: 'upload', label: 'Upload', caption: 'Template & workbook' },
  { id: 'mapping', label: 'Map Columns', caption: 'Source → FD field' },
  { id: 'validation', label: 'Validate', caption: 'Row-level checks' },
  { id: 'summary', label: 'Import', caption: 'Commit & audit' },
];

/** Each row writes the FD, its unique key and an audit entry — 3 of the 500 batch slots. */
const ROWS_PER_BATCH = 150;
const PREVIEW_LIMIT = 300;
const UNMAPPED = '__unmapped__';

/** Statuses that must not be silently overwritten by an import in "update" mode. */
const UPDATABLE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'RETURNED', 'ON_HOLD'];
const TERMINAL_STATUSES = ['CLOSED', 'PREMATURELY_CLOSED', 'CANCELLED', 'RENEWED', 'REPLACED'];

type ApprovalMode = 'migrate' | 'draft';
type DuplicateMode = 'skip' | 'update';
type ReferenceMode = 'generate' | 'file';

/* ── row model ───────────────────────────────────────────────────────────── */

type RowValues = Record<string, string | number | boolean | Date | null>;

interface Financials {
  derivedDays: number;
  tenureDays: number;
  tenureMonths: number;
  method: string;
  projectedFromRate: boolean;
  expectedInterest: number;
  maturityAmount: number;
  expectedTds: number;
  expectedNetProceeds: number;
  eligibleValue: number;
  openingBg: number;
  openingLc: number;
  availableAmount: number;
}

interface ValidatedRow {
  excelRow: number;
  source: Record<string, unknown>;
  values: RowValues;
  financials: Financials;
  bank: BankAccount | null;
  project: Project | null;
  existing: FixedDeposit | null;
  errors: string[];
  warnings: string[];
}

interface ImportOutcome {
  fileName: string;
  sheetName: string;
  read: number;
  inserted: number;
  updated: number;
  skipped: number;
  failures: Array<{ excelRow: number; reference: string; message: string }>;
  finishedAt: Date;
}

/* ── pure helpers ────────────────────────────────────────────────────────── */

const text = (values: RowValues, key: string) => String(values[key] ?? '');
const num = (values: RowValues, key: string) => Number(values[key] ?? 0) || 0;
const asDate = (values: RowValues, key: string) => (values[key] instanceof Date ? (values[key] as Date) : null);

/**
 * Money and tenure derived from the parsed row, used by both the validation preview and
 * the write, so the numbers a reviewer approves are the numbers that land in Firestore.
 */
const deriveFinancials = (values: RowValues, tdsPercentage: number): Financials => {
  const valueDate = asDate(values, 'valueDate');
  const maturityDate = asDate(values, 'maturityDate');
  const derivedDays = valueDate && maturityDate ? Math.max(0, Math.round((maturityDate.getTime() - valueDate.getTime()) / 86_400_000)) : 0;
  const tenureDays = num(values, 'tenureDays') || derivedDays;
  const tenureMonths = num(values, 'tenureMonths');
  const principal = num(values, 'principalAmount');
  const declared = String(values.interestCalculationMethod || 'BANK_PROVIDED');
  const manualAmount = num(values, 'maturityAmount');
  // BANK_PROVIDED/MANUAL with no bank figure would book zero interest, so fall back to a
  // simple-interest projection off the rate and flag it as an assumption.
  const projectedFromRate = (declared === 'BANK_PROVIDED' || declared === 'MANUAL') && manualAmount <= 0;
  const method = projectedFromRate ? 'SIMPLE' : declared;
  const calculation = calculateMaturity({
    principal,
    annualRate: num(values, 'interestRate'),
    tenureDays: tenureDays || undefined,
    tenureMonths: tenureMonths || undefined,
    method,
    frequency: String(values.interestPaymentFrequency || 'On maturity'),
    manualMaturityAmount: manualAmount || undefined,
    tdsPercentage,
  });
  const eligibleValue = calculateEligibleValue(principal, num(values, 'eligibleMarginPercentage'));
  const openingBg = roundTo(num(values, 'bgUtilizedAmount'), 2);
  const openingLc = roundTo(num(values, 'lcUtilizedAmount'), 2);
  return {
    derivedDays,
    tenureDays,
    tenureMonths,
    method,
    projectedFromRate,
    ...calculation,
    eligibleValue,
    openingBg,
    openingLc,
    availableAmount: calculateAvailableAmount(eligibleValue, openingBg, openingLc, 0),
  };
};

/** Bank lookup keyed on every spelling a source file might carry. */
const buildBankIndex = (banks: BankAccount[]) => {
  const index = new Map<string, BankAccount[]>();
  const add = (token: string, bank: BankAccount) => {
    if (!token) return;
    index.set(token, [...(index.get(token) || []), bank]);
  };
  banks.forEach((bank) => {
    add(normalizeToken(bank.bankName), bank);
    add(normalizeToken(bank.shortName), bank);
    add(normalizeToken(bank.accountNumber), bank);
    add(normalizeToken(`${bank.bankName}${bank.branch}`), bank);
    add(normalizeToken(`${bank.shortName}${bank.branch}`), bank);
  });
  return index;
};

const bankLabel = (bank: BankAccount) => `${bank.bankName}${bank.branch ? ` · ${bank.branch}` : ''}`;

/* ── validation ──────────────────────────────────────────────────────────── */

interface ValidationContext {
  banks: BankAccount[];
  bankIndex: Map<string, BankAccount[]>;
  projects: Project[];
  existingByKey: Map<string, FixedDeposit>;
  existingByNumber: Map<string, FixedDeposit[]>;
  duplicates: DuplicateMode;
  tdsPercentage: number;
}

/** Reads one field's cell into a typed value, appending any per-cell messages. */
const parseField = (
  field: ImportField,
  raw: unknown,
  mapped: boolean,
  errors: string[],
  warnings: string[],
): string | number | boolean | Date | null => {
  const rawText = cellValueToString(raw);

  if (!mapped) {
    if (field.required) errors.push(`${field.label} column is not mapped.`);
    return field.fallback ?? (field.type === 'date' ? null : field.type === 'yesno' ? false : field.type === 'number' || field.type === 'percentage' ? 0 : '');
  }

  switch (field.type) {
    case 'enum': {
      if (!rawText) {
        if (field.required) errors.push(`${field.label} is required.`);
        return field.fallback ?? '';
      }
      const match = matchEnumOption(raw, field.options || []);
      if (!match.matched) {
        errors.push(`${field.label} "${rawText}" is not recognised. Accepted: ${(field.options || []).map((option) => option.value).join(', ')}.`);
        return field.fallback ?? '';
      }
      return match.value;
    }
    case 'yesno': {
      const parsed = parseYesNo(raw);
      if (parsed === undefined) return field.fallback ?? false;
      if (parsed === null) {
        errors.push(`${field.label} "${rawText}" is not a Yes/No value.`);
        return field.fallback ?? false;
      }
      return parsed;
    }
    case 'number':
    case 'percentage': {
      const parsed = parseNumber(raw);
      if (!parsed.valid) {
        errors.push(`${field.label} "${rawText}" is not a valid number.`);
        return 0;
      }
      if (parsed.empty) {
        if (field.required) errors.push(`${field.label} is required.`);
        return field.fallback ?? 0;
      }
      const value = field.decimals === undefined ? parsed.value : roundTo(parsed.value, field.decimals);
      if (field.min !== undefined && value < field.min) errors.push(`${field.label} must be at least ${field.min}.`);
      if (field.max !== undefined && value > field.max) errors.push(`${field.label} cannot exceed ${field.max}.`);
      return value;
    }
    case 'date': {
      const parsed = parseDateCell(raw);
      if (!parsed) {
        if (field.required) errors.push(`${field.label} is required and must be a valid date.`);
        else if (rawText) errors.push(`${field.label} "${rawText}" is not a valid date.`);
        return null;
      }
      return parsed;
    }
    default: {
      const value = field.key === 'pan' ? rawText.toUpperCase() : rawText;
      if (field.required && !value) errors.push(`${field.label} is required.`);
      // Format problems are data quality, not blockers — a wrong PAN should not stop a
      // migration, but it should be visible before it becomes a compliance report.
      if (value && field.pattern && !field.pattern.test(value)) warnings.push(field.patternMessage || `${field.label} has an unexpected format.`);
      return value;
    }
  }
};

const validateRows = (read: SheetRead, columnMap: Record<string, string>, context: ValidationContext): ValidatedRow[] => {
  const seenInFile = new Map<string, number>();

  return read.rows.map((sourceRow) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const values: RowValues = {};

    FD_IMPORT_FIELDS.forEach((field) => {
      const header = columnMap[field.key];
      const mapped = Boolean(header) && header !== UNMAPPED;
      values[field.key] = parseField(field, mapped ? sourceRow.cells[header] : undefined, mapped, errors, warnings);
    });

    /* Bank — the one master the FD cannot exist without. */
    const bankText = text(values, 'bankName');
    const branchText = text(values, 'branchName');
    let bank: BankAccount | null = null;
    if (bankText) {
      const withBranch = context.bankIndex.get(normalizeToken(`${bankText}${branchText}`)) || [];
      const candidates = withBranch.length ? withBranch : context.bankIndex.get(normalizeToken(bankText)) || [];
      if (!candidates.length) {
        errors.push(`Bank "${bankText}" does not match any Active bank account in Bank Master.`);
      } else if (candidates.length > 1) {
        const byBranch = branchText ? candidates.filter((item) => normalizeToken(item.branch) === normalizeToken(branchText)) : [];
        bank = byBranch[0] || candidates[0];
        if (!byBranch.length) warnings.push(`Bank "${bankText}" matches ${candidates.length} accounts; linked to ${bankLabel(bank)}. Add a Branch value to disambiguate.`);
      } else {
        [bank] = candidates;
      }
    }
    if (bank && branchText && normalizeToken(bank.branch) !== normalizeToken(branchText)) {
      warnings.push(`Branch "${branchText}" differs from Bank Master ("${bank.branch}"); the master value will be stored.`);
    }

    /* Project — optional, so an unresolved name degrades to free text. */
    const projectText = text(values, 'projectName');
    let project: Project | null = null;
    if (projectText) {
      project = context.projects.find((item) => normalizeToken(item.projectName) === normalizeToken(projectText))
        || context.projects.find((item) => normalizeToken(item.siteCode) === normalizeToken(projectText))
        || null;
      if (!project) warnings.push(`Project "${projectText}" is not an Active project; it will be stored as text with no project link.`);
    }

    /* Dates and tenure. */
    const valueDate = asDate(values, 'valueDate');
    const maturityDate = asDate(values, 'maturityDate');
    const creationDate = asDate(values, 'creationDate');
    if (valueDate && maturityDate && maturityDate.getTime() <= valueDate.getTime()) {
      errors.push('Maturity Date must be after the Value Date.');
    }
    if (creationDate && valueDate && creationDate.getTime() > valueDate.getTime()) {
      warnings.push('Creation Date is after the Value Date.');
    }
    if (valueDate && valueDate.getTime() > Date.now()) warnings.push('Value Date is in the future.');

    const financials = deriveFinancials(values, context.tdsPercentage);
    const declaredDays = num(values, 'tenureDays');
    if (declaredDays && financials.derivedDays && Math.abs(declaredDays - financials.derivedDays) > 1) {
      warnings.push(`Tenure (Days) ${declaredDays} does not match the ${financials.derivedDays} days between the value and maturity dates.`);
    }
    const declaredMonths = num(values, 'tenureMonths');
    if (declaredMonths && financials.derivedDays && Math.abs(declaredMonths * 30.44 - financials.derivedDays) > 45) {
      warnings.push(`Tenure (Months) ${declaredMonths} does not match the deposit period.`);
    }

    /* Money. */
    const principal = num(values, 'principalAmount');
    const declaredMaturity = num(values, 'maturityAmount');
    if (declaredMaturity && principal && declaredMaturity < principal) {
      warnings.push('Maturity Amount is below the principal; it will be floored at the principal.');
    }
    if (financials.projectedFromRate && principal) {
      warnings.push(`Maturity Amount is blank, so maturity was projected on simple interest at ${num(values, 'interestRate')}% (${formatFdCurrency(financials.maturityAmount, text(values, 'currency') || 'INR')}).`);
    }
    if (num(values, 'interestRate') > 20) warnings.push('Interest Rate above 20% p.a. — confirm the value is a percentage, not a fraction.');
    if (financials.openingBg + financials.openingLc > financials.eligibleValue + 0.01) {
      errors.push(`Opening BG + LC utilisation (${formatFdCurrency(financials.openingBg + financials.openingLc)}) exceeds the eligible value (${formatFdCurrency(financials.eligibleValue)}).`);
    } else if (financials.openingBg + financials.openingLc > 0) {
      warnings.push('Opening utilisation reduces the available balance used by assignment checks. The register recomputes utilisation from BG/LC assignment records, so create the matching assignments to keep both views in agreement.');
    }

    /* Lien and status consistency. */
    if (values.lienMarked === true && !text(values, 'lienHolder')) warnings.push('Lien Marked is Yes but no Lien Holder was supplied.');
    if (text(values, 'fdType') === 'SECURITY' && values.lienMarked !== true) warnings.push('Security FDs are normally under lien; Lien Marked is No.');
    const status = text(values, 'status');
    if (TERMINAL_STATUSES.includes(status)) warnings.push(`Status ${fdStatusLabel(status)} imports as a historical record and will not appear in the available-FD pool.`);

    /* Duplicates — inside the file, then against the register. */
    const fdNumber = text(values, 'fdNumber');
    const key = bank && fdNumber ? `${bank.id}|${fdNumber.toLowerCase()}` : '';
    if (key) {
      const firstSeen = seenInFile.get(key);
      if (firstSeen) errors.push(`Duplicate of row ${firstSeen} in this file (same bank and FD number).`);
      else seenInFile.set(key, sourceRow.excelRow);
    }
    const existing = key ? context.existingByKey.get(key) || null : null;
    if (existing) {
      if (context.duplicates === 'skip') {
        errors.push(`FD ${fdNumber} already exists at ${existing.bankName} as ${existing.referenceNumber}.`);
      } else if (!UPDATABLE_STATUSES.includes(existing.status) && existing.approvalStatus === 'APPROVED') {
        errors.push(`${existing.referenceNumber} is approved and ${fdStatusLabel(existing.status)}; an approved FD cannot be overwritten by import. Use the renewal, closure or replacement workflow.`);
      } else if (Number(existing.totalUtilizedAmount || 0) > 0) {
        errors.push(`${existing.referenceNumber} carries ${formatFdCurrency(existing.totalUtilizedAmount)} of utilisation; release the assignments before re-importing it.`);
      } else {
        warnings.push(`${existing.referenceNumber} will be updated in place. Opening utilisation columns are ignored on update.`);
      }
    }
    if (fdNumber) {
      const elsewhere = (context.existingByNumber.get(fdNumber.toLowerCase()) || []).filter((item) => item.id !== existing?.id);
      if (elsewhere.length) warnings.push(`FD number ${fdNumber} also exists at ${Array.from(new Set(elsewhere.map((item) => item.bankName))).join(', ')}.`);
    }

    return { excelRow: sourceRow.excelRow, source: sourceRow.cells, values, financials, bank, project, existing, errors, warnings };
  });
};

/* ── step indicator ──────────────────────────────────────────────────────── */

function StepIndicator({ current }: { current: Step }) {
  const activeIndex = STEPS.findIndex((step) => step.id === current);
  return <div className="flex flex-wrap gap-2">{STEPS.map((step, index) => {
    const state = index === activeIndex ? 'active' : index < activeIndex ? 'done' : 'todo';
    return <div key={step.id} className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
      state === 'active' && 'border-cyan-300 bg-gradient-to-r from-cyan-600 to-blue-700 text-white shadow-sm',
      state === 'done' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      state === 'todo' && 'border-slate-200 bg-white text-slate-500')}>
      <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold', state === 'active' ? 'bg-white/25' : state === 'done' ? 'bg-emerald-600 text-white' : 'bg-slate-100')}>{state === 'done' ? '✓' : index + 1}</span>
      <span>{step.label}</span><span className={cn('hidden text-[10px] font-normal sm:inline', state === 'active' ? 'text-white/80' : 'text-muted-foreground')}>· {step.caption}</span>
    </div>;
  })}</div>;
}

/* ── workspace ───────────────────────────────────────────────────────────── */

export default function FDImportWorkspace() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const organizationName = user?.organizationName || 'Default Organization';
  const canView = can('View', 'Fixed Deposit Management.Import & Reconciliation');
  const canImport = can('Import', 'Fixed Deposit Management.Import & Reconciliation');
  const canExportExceptions = can('Export Exceptions', 'Fixed Deposit Management.Import & Reconciliation') || canImport;

  const [step, setStep] = useState<Step>('upload');
  const [loadingMasters, setLoadingMasters] = useState(true);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [existingDeposits, setExistingDeposits] = useState<FixedDeposit[]>([]);
  const [settings, setSettings] = useState<FixedDepositSettings>(DEFAULT_FD_SETTINGS);

  const workbookRef = useRef<Workbook | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [read, setRead] = useState<SheetRead | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(false);

  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('migrate');
  const [duplicates, setDuplicates] = useState<DuplicateMode>('skip');
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('generate');
  const [rowFilter, setRowFilter] = useState<'all' | 'ready' | 'warning' | 'error'>('all');

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const loadMasters = useCallback(async () => {
    setLoadingMasters(true);
    try {
      const [bankSnap, projectSnap, settingsSnap, depositSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'projects')),
        getDoc(doc(db, ...FD_SETTINGS_PATH)),
        getDocs(query(collection(db, FD_COLLECTIONS.deposits), where('organizationId', '==', organizationId))),
      ]);
      setBanks(bankSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as BankAccount)).filter((item) => item.status === 'Active').sort((a, b) => a.bankName.localeCompare(b.bankName)));
      setProjects(projectSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Project)).filter((item) => item.status === 'Active').sort((a, b) => a.projectName.localeCompare(b.projectName)));
      setSettings(settingsSnap.exists() ? { ...DEFAULT_FD_SETTINGS, ...settingsSnap.data(), organizationId } as FixedDepositSettings : { ...DEFAULT_FD_SETTINGS, organizationId });
      setExistingDeposits(depositSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FixedDeposit)).filter((item) => !item.isDeleted));
    } catch (error) {
      console.error('Unable to load FD import masters', error);
      toast({ title: 'Unable to load masters', description: 'Bank, project and existing FD data could not be loaded.', variant: 'destructive' });
    } finally {
      setLoadingMasters(false);
    }
  }, [organizationId, toast]);

  useEffect(() => { if (!authLoading && (canView || canImport)) void loadMasters(); else if (!authLoading) setLoadingMasters(false); }, [authLoading, canImport, canView, loadMasters]);

  const context = useMemo<ValidationContext>(() => {
    const existingByKey = new Map<string, FixedDeposit>();
    const existingByNumber = new Map<string, FixedDeposit[]>();
    existingDeposits.forEach((fd) => {
      const number = String(fd.fdNumber || '').trim().toLowerCase();
      if (!number) return;
      if (fd.bankId) existingByKey.set(`${fd.bankId}|${number}`, fd);
      existingByNumber.set(number, [...(existingByNumber.get(number) || []), fd]);
    });
    return { banks, bankIndex: buildBankIndex(banks), projects, existingByKey, existingByNumber, duplicates, tdsPercentage: settings.tdsPercentage };
  }, [banks, duplicates, existingDeposits, projects, settings.tdsPercentage]);

  const rows = useMemo(() => (read ? validateRows(read, columnMap, context) : []), [columnMap, context, read]);
  const readyRows = useMemo(() => rows.filter((row) => !row.errors.length), [rows]);
  const warningRows = useMemo(() => rows.filter((row) => !row.errors.length && row.warnings.length), [rows]);
  const errorRows = useMemo(() => rows.filter((row) => row.errors.length), [rows]);
  const insertCount = readyRows.filter((row) => !row.existing).length;
  const updateCount = readyRows.length - insertCount;

  const unmappedRequired = useMemo(() => FD_IMPORT_FIELDS.filter((field) => field.required && (!columnMap[field.key] || columnMap[field.key] === UNMAPPED)), [columnMap]);
  const mappedHeaders = useMemo(() => new Set(Object.values(columnMap).filter((header) => header && header !== UNMAPPED)), [columnMap]);
  const unusedHeaders = useMemo(() => (read?.headers || []).filter((header) => !mappedHeaders.has(header)), [mappedHeaders, read?.headers]);

  const visibleRows = useMemo(() => {
    const pool = rowFilter === 'ready' ? readyRows.filter((row) => !row.warnings.length) : rowFilter === 'warning' ? warningRows : rowFilter === 'error' ? errorRows : rows;
    return pool.slice(0, PREVIEW_LIMIT);
  }, [errorRows, readyRows, rowFilter, rows, warningRows]);

  /* ── file handling ─────────────────────────────────────────────────────── */

  const readSheet = useCallback((name: string, headerRowOverride?: number) => {
    const workbook = workbookRef.current;
    const worksheet = workbook?.getWorksheet(name);
    if (!worksheet) {
      toast({ title: 'Sheet unavailable', description: `"${name}" could not be read.`, variant: 'destructive' });
      return;
    }
    const sheet = worksheet as unknown as ReadableSheet;
    const resolvedHeaderRow = headerRowOverride ?? detectHeaderRow(sheet);
    const next = worksheetToRows(sheet, resolvedHeaderRow);
    if (!next.headers.length) {
      toast({ title: 'No header row found', description: `Row ${resolvedHeaderRow} of "${name}" is empty. Pick the row that holds the column titles.`, variant: 'destructive' });
    }
    setSheetName(name);
    setHeaderRow(next.headerRow);
    setRead(next);
    setColumnMap(autoMapColumns(FD_IMPORT_FIELDS, next.headers));
    setOutcome(null);
    setRowFilter('all');
  }, [toast]);

  const openFile = async (file: File) => {
    if (!/\.xlsx?$/i.test(file.name)) {
      toast({ title: 'Unsupported file', description: 'Upload an .xlsx or .xls workbook. Save CSV files as Excel first.', variant: 'destructive' });
      return;
    }
    setReading(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer() as never);
      const names = workbook.worksheets.map((worksheet) => worksheet.name);
      if (!names.length) throw new Error('The workbook has no worksheets.');
      workbookRef.current = workbook;
      setFileName(file.name);
      setSheetNames(names);
      // Prefer the template's own sheet when re-importing an export or a filled template.
      const preferred = names.find((name) => normalizeToken(name) === normalizeToken('Fixed Deposits')) || names[0];
      readSheet(preferred);
      setStep('mapping');
    } catch (error) {
      console.error('Unable to read FD workbook', error);
      toast({ title: 'Unable to read workbook', description: error instanceof Error ? error.message : 'The file may be corrupt or password protected.', variant: 'destructive' });
    } finally {
      setReading(false);
    }
  };

  const resetWizard = () => {
    workbookRef.current = null;
    setFileName(''); setSheetNames([]); setSheetName(''); setRead(null); setColumnMap({}); setHeaderRow(1);
    setOutcome(null); setProgress(0); setRowFilter('all'); setStep('upload');
  };

  const template = async (includeSamples: boolean) => {
    try {
      await downloadImportTemplate({
        includeSamples,
        bankNames: banks.map(bankLabel),
        projectNames: projects.map((project) => project.projectName),
      });
      toast({ title: includeSamples ? 'Sample workbook downloaded' : 'Template downloaded', description: 'The Instructions sheet documents every column; Master Data lists the bank and project names that resolve on import.' });
    } catch (error) {
      console.error('Unable to build FD template', error);
      toast({ title: 'Unable to build template', variant: 'destructive' });
    }
  };

  /* ── exceptions export ─────────────────────────────────────────────────── */

  const exportExceptions = async () => {
    if (!read) return;
    const problems = rows.filter((row) => row.errors.length || row.warnings.length);
    if (!problems.length) return;
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SEL Live';
    const sheet = workbook.addWorksheet('Exceptions');
    // Source columns are re-emitted verbatim after the diagnosis columns, so the file can
    // be corrected and uploaded again without rebuilding it from the original.
    sheet.columns = [
      { header: 'Excel Row', key: '__row', width: 11 },
      { header: 'Result', key: '__result', width: 12 },
      { header: 'Errors', key: '__errors', width: 70 },
      { header: 'Warnings', key: '__warnings', width: 70 },
      ...read.headers.map((header) => ({ header, key: header, width: columnWidthFor(header) })),
    ];
    problems.forEach((row) => {
      const record: Record<string, unknown> = {
        __row: row.excelRow,
        __result: row.errors.length ? 'Blocked' : 'Warning',
        __errors: row.errors.join(' | '),
        __warnings: row.warnings.join(' | '),
      };
      read.headers.forEach((header) => { record[header] = cellValueToString(row.source[header]); });
      const added = sheet.addRow(record);
      if (row.errors.length) added.getCell('__result').font = { bold: true, color: { argb: 'FFB91C1C' } };
    });
    styleHeaderRow(sheet as never, 'FFB91C1C');
    sheet.getColumn('__errors').alignment = { wrapText: true, vertical: 'top' };
    sheet.getColumn('__warnings').alignment = { wrapText: true, vertical: 'top' };
    await downloadWorkbook(workbook as never, `fd-import-exceptions-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: `${problems.length} exception rows exported` });
  };

  /* ── import ────────────────────────────────────────────────────────────── */

  /**
   * Reserves a contiguous block of sequence numbers per financial year in one
   * transaction each, then hands them out locally. The previous importer numbered rows
   * `FD/MIG/<FY>/<row index>`, which collided across separate import runs and did not
   * share the counter the create form advances.
   */
  const reserveReferences = async (needed: Map<string, number>) => {
    const starts = new Map<string, number>();
    for (const [financialYear, count] of needed) {
      const counterRef = doc(db, 'fdCounters', `${organizationId}_${financialYear}`.replace(/[^A-Za-z0-9_-]/g, '_'));
      // Sequential: one transaction per financial year, and a write batch cannot read.
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(counterRef);
        const start = Number(snapshot.data()?.nextSequence || 1);
        transaction.set(counterRef, { organizationId, financialYear, nextSequence: start + count, updatedAt: Timestamp.now() }, { merge: true });
        starts.set(financialYear, start);
      });
    }
    return starts;
  };

  const runImport = async () => {
    if (!user || !canImport || !readyRows.length) return;
    setImporting(true);
    setProgress(0);
    const failures: ImportOutcome['failures'] = [];
    let inserted = 0;
    let updated = 0;

    try {
      const needed = new Map<string, number>();
      readyRows.forEach((row) => {
        if (row.existing) return;
        if (referenceMode === 'file' && text(row.values, 'referenceNumber')) return;
        const financialYear = financialYearForDate(asDate(row.values, 'valueDate'));
        needed.set(financialYear, (needed.get(financialYear) || 0) + 1);
      });
      const starts = await reserveReferences(needed);
      const nextSequence = new Map(starts);
      const references = new Map<number, string>();
      readyRows.forEach((row) => {
        if (row.existing) return;
        const fromFile = text(row.values, 'referenceNumber');
        if (referenceMode === 'file' && fromFile) { references.set(row.excelRow, fromFile); return; }
        const financialYear = financialYearForDate(asDate(row.values, 'valueDate'));
        const sequence = nextSequence.get(financialYear) || 1;
        nextSequence.set(financialYear, sequence + 1);
        references.set(row.excelRow, `${settings.referencePrefix}/${fdOrgCode(organizationName)}/${financialYear}/${String(sequence).padStart(4, '0')}`);
      });

      for (let offset = 0; offset < readyRows.length; offset += ROWS_PER_BATCH) {
        const chunk = readyRows.slice(offset, offset + ROWS_PER_BATCH);
        const batch = writeBatch(db);
        const stamp = Timestamp.now();

        chunk.forEach((row) => {
          const { values, financials, bank, project } = row;
          const valueDate = asDate(values, 'valueDate') as Date;
          const maturityDate = asDate(values, 'maturityDate') as Date;
          const creationDate = asDate(values, 'creationDate') || valueDate;
          const lienDate = asDate(values, 'lienDate');
          const shared = {
            branchId: bank?.id || '',
            branchName: bank?.branch || text(values, 'branchName'),
            ifsc: bank?.ifsc || '',
            sourceAccountId: bank?.id || '',
            sourceAccountNumber: bank?.accountNumber || '',
            projectId: project?.id || '',
            projectName: project?.projectName || text(values, 'projectName'),
            holderName: text(values, 'holderName'),
            holderType: text(values, 'holderType') || 'Organization',
            jointHolderName: text(values, 'jointHolderName'),
            nomineeName: text(values, 'nomineeName'),
            pan: text(values, 'pan'),
            beneficialOwner: text(values, 'beneficialOwner'),
            fdType: text(values, 'fdType'),
            depositCategory: text(values, 'depositCategory'),
            purpose: text(values, 'purpose'),
            sourceOfFunds: text(values, 'sourceOfFunds'),
            currency: text(values, 'currency') || 'INR',
            principalAmount: num(values, 'principalAmount'),
            interestRate: num(values, 'interestRate'),
            interestCalculationMethod: text(values, 'interestCalculationMethod'),
            interestPaymentFrequency: text(values, 'interestPaymentFrequency'),
            tenureDays: financials.tenureDays,
            tenureMonths: financials.tenureMonths,
            creationDate: Timestamp.fromDate(creationDate),
            valueDate: Timestamp.fromDate(valueDate),
            maturityDate: Timestamp.fromDate(maturityDate),
            expectedInterest: financials.expectedInterest,
            maturityAmount: financials.maturityAmount,
            expectedTds: financials.expectedTds,
            expectedNetProceeds: financials.expectedNetProceeds,
            interestReceived: num(values, 'interestReceived'),
            prematureClosurePenalty: num(values, 'prematureClosurePenalty'),
            eligibleMarginPercentage: num(values, 'eligibleMarginPercentage'),
            eligibleValue: financials.eligibleValue,
            lienMarked: values.lienMarked === true,
            lienHolder: text(values, 'lienHolder'),
            lienDate: lienDate ? Timestamp.fromDate(lienDate) : null,
            lienAmount: num(values, 'lienAmount'),
            lienPurpose: text(values, 'lienPurpose'),
            bankConfirmationReference: text(values, 'bankConfirmationReference'),
            autoRenewal: values.autoRenewal === true,
            remarks: text(values, 'remarks'),
            relationshipManager: text(values, 'relationshipManager'),
            relationshipManagerPhone: text(values, 'relationshipManagerPhone'),
            relationshipManagerEmail: text(values, 'relationshipManagerEmail'),
            updatedBy: user.id,
            updatedByName: user.name,
            updatedAt: stamp,
          };

          const migrating = approvalMode === 'migrate';

          if (row.existing) {
            // Utilisation stays under the assignment workflow's control on update; only the
            // derived availability is refreshed for the new principal and margin. The
            // approval fields move together with the status so an update cannot leave a
            // record reading ACTIVE while its approval is still DRAFT.
            const fd = row.existing;
            const available = calculateAvailableAmount(financials.eligibleValue, Number(fd.bgUtilizedAmount || 0), Number(fd.lcUtilizedAmount || 0), Number(fd.reservedAmount || 0));
            batch.update(doc(db, FD_COLLECTIONS.deposits, fd.id), {
              ...shared,
              availableAmount: available,
              totalUtilizedAmount: roundTo(Number(fd.bgUtilizedAmount || 0) + Number(fd.lcUtilizedAmount || 0) + Number(fd.reservedAmount || 0), 2),
              status: migrating ? text(values, 'status') : 'DRAFT',
              approvalStatus: migrating ? 'APPROVED' : 'DRAFT',
              workflowStage: migrating ? 'COMPLETED' : 'DRAFT',
              approvalComments: migrating ? `Re-imported from ${fileName}` : '',
              ...(migrating ? { approvedBy: user.id, approvedByName: `${user.name} (migration)`, approvedAt: stamp } : {}),
              source: 'excel_import',
              importedFileName: fileName,
            });
            batch.set(doc(collection(db, FD_COLLECTIONS.audit)), {
              organizationId, module: 'Fixed Deposit Management', recordType: 'IMPORT', recordId: fd.id, fdId: fd.id,
              action: 'FD_IMPORT_UPDATED', summary: `${fd.referenceNumber} updated from ${fileName} row ${row.excelRow}`,
              previousValue: { principalAmount: fd.principalAmount, interestRate: fd.interestRate, maturityDate: fd.maturityDate },
              newValue: { principalAmount: shared.principalAmount, interestRate: shared.interestRate, sourceRow: row.excelRow, sheet: sheetName },
              userId: user.id, userName: user.name, userRole: user.role || '', page: `/fixed-deposit/${fd.id}`, createdAt: stamp,
            });
            updated += 1;
            return;
          }

          const fdRef = doc(collection(db, FD_COLLECTIONS.deposits));
          const referenceNumber = references.get(row.excelRow) || '';
          batch.set(fdRef, {
            ...shared,
            organizationId,
            organizationName,
            referenceNumber,
            fdNumber: text(values, 'fdNumber'),
            bankId: bank?.id || '',
            bankName: bank?.bankName || text(values, 'bankName'),
            bgUtilizedAmount: financials.openingBg,
            lcUtilizedAmount: financials.openingLc,
            reservedAmount: 0,
            totalUtilizedAmount: roundTo(financials.openingBg + financials.openingLc, 2),
            availableAmount: financials.availableAmount,
            status: migrating ? text(values, 'status') : 'DRAFT',
            renewalStatus: '',
            closureStatus: '',
            documentComplete: false,
            approvalStatus: migrating ? 'APPROVED' : 'DRAFT',
            approvalComments: migrating ? `Imported from ${fileName}` : '',
            workflowStage: migrating ? 'COMPLETED' : 'DRAFT',
            createdBy: user.id,
            createdByName: user.name,
            createdAt: stamp,
            ...(migrating ? { approvedBy: user.id, approvedByName: `${user.name} (migration)`, approvedAt: stamp } : {}),
            isDeleted: false,
            source: 'excel_import',
            importedFileName: fileName,
          });
          // Registers the same uniqueness guard the create form checks, so a later manual
          // entry cannot re-create an imported FD number. An existing key here can only be
          // orphaned — a live one would have surfaced as a duplicate during validation.
          if (bank) {
            batch.set(doc(db, 'fdUniqueKeys', `${organizationId}_${bank.id}_${text(values, 'fdNumber').toLowerCase()}`.replace(/[^A-Za-z0-9_-]/g, '_')), {
              organizationId, bankId: bank.id, fdNumber: text(values, 'fdNumber'), fdId: fdRef.id, createdAt: stamp,
            });
          }
          batch.set(doc(collection(db, FD_COLLECTIONS.audit)), {
            organizationId, module: 'Fixed Deposit Management', recordType: 'IMPORT', recordId: fdRef.id, fdId: fdRef.id,
            action: 'FD_IMPORTED', summary: `${referenceNumber || text(values, 'fdNumber')} imported from ${fileName} row ${row.excelRow}`,
            newValue: { fdNumber: text(values, 'fdNumber'), principalAmount: shared.principalAmount, bankName: bank?.bankName || text(values, 'bankName'), sourceRow: row.excelRow, sheet: sheetName, mode: approvalMode },
            userId: user.id, userName: user.name, userRole: user.role || '', page: `/fixed-deposit/${fdRef.id}`, createdAt: stamp,
          });
          inserted += 1;
        });

        try {
          // Sequential commits so progress is meaningful and one bad chunk cannot fail the rest.
          await batch.commit();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Firestore batch failed.';
          chunk.forEach((row) => failures.push({ excelRow: row.excelRow, reference: text(row.values, 'fdNumber'), message }));
          if (chunk.some((row) => row.existing)) updated -= chunk.filter((row) => row.existing).length;
          inserted -= chunk.filter((row) => !row.existing).length;
        }
        setProgress(Math.round(((offset + chunk.length) / readyRows.length) * 100));
      }

      const result: ImportOutcome = {
        fileName, sheetName, read: rows.length, inserted: Math.max(0, inserted), updated: Math.max(0, updated),
        skipped: errorRows.length, failures, finishedAt: new Date(),
      };
      setOutcome(result);
      setStep('summary');
      await logUserActivity({
        userId: user.id, userName: user.name, userEmail: user.email, module: 'Fixed Deposit Management',
        action: 'Import Fixed Deposits',
        details: {
          fileName, sheet: sheetName, headerRow, totalRows: rows.length, inserted: result.inserted, updated: result.updated,
          skippedByValidation: errorRows.length, failedRows: failures.length, approvalMode, duplicateHandling: duplicates,
          referenceMode, columnMap,
        },
      });
      toast({ title: `${result.inserted + result.updated} fixed deposits imported`, description: `${result.inserted} created, ${result.updated} updated, ${errorRows.length} skipped.` });
      await loadMasters();
    } catch (error) {
      console.error('FD import failed', error);
      toast({ title: 'Import failed', description: error instanceof Error ? error.message : 'No rows were committed.', variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  /* ── render ────────────────────────────────────────────────────────────── */

  if (authLoading || loadingMasters) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canView && !canImport) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to import fixed deposits.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  const currency = (value: number) => formatFdCurrency(value);

  return <div className="space-y-4">
    <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">FD Import &amp; Reconciliation</h1>
        <p className="text-sm text-muted-foreground">Map any workbook onto the FD register with master-data resolution, row-level validation, duplicate prevention and a full audit trail.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild><Link href="/fixed-deposit/export"><Download className="mr-2 h-4 w-4" />Export Centre</Link></Button>
        {step !== 'upload' && <Button variant="outline" onClick={resetWizard} disabled={importing}><RotateCcw className="mr-2 h-4 w-4" />Start Over</Button>}
      </div>
    </div>

    <StepIndicator current={step} />

    {/* Step 1 — upload */}
    {step === 'upload' && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="border-white/80 bg-white/90 shadow-sm">
        <CardHeader><CardTitle className="text-base">Upload workbook</CardTitle><CardDescription>Any .xlsx or .xls layout is accepted — the next step maps its columns onto FD fields.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cyan-200 bg-gradient-to-br from-cyan-50/60 to-blue-50/40 px-6 py-10 text-center transition-colors hover:border-cyan-400"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void openFile(file); }}>
            {reading ? <Loader2 className="h-8 w-8 animate-spin text-cyan-600" /> : <FileSpreadsheet className="h-8 w-8 text-cyan-600" />}
            <p className="text-sm font-medium text-slate-700">{reading ? 'Reading workbook…' : 'Drop a workbook here or click to browse'}</p>
            <p className="text-xs text-muted-foreground">Everything is parsed in your browser; nothing is uploaded until you confirm the import.</p>
            <Input type="file" accept=".xlsx,.xls" className="hidden" disabled={!canImport || reading}
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void openFile(file); event.target.value = ''; }} />
          </label>
          {!canImport && <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" />You can review the template and validation rules, but the Import permission is required to commit rows.</p>}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card className="border-white/80 bg-white/90 shadow-sm">
          <CardHeader><CardTitle className="text-base">Prepare the workbook</CardTitle><CardDescription>{FD_IMPORT_FIELDS.length} mappable columns, {FD_IMPORT_FIELDS.filter((field) => field.required).length} mandatory.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start" onClick={() => void template(false)}><Download className="mr-2 h-4 w-4" />Blank template</Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => void template(true)}><Wand2 className="mr-2 h-4 w-4" />Template with sample row</Button>
            <p className="text-[11px] leading-snug text-muted-foreground">Includes an <strong>Instructions</strong> sheet documenting every column and a <strong>Master Data</strong> sheet listing the {banks.length} bank accounts and {projects.length} projects that resolve on import.</p>
          </CardContent>
        </Card>
        <Card className="border-white/80 bg-white/90 shadow-sm">
          <CardHeader><CardTitle className="text-base">Register snapshot</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {[['Existing fixed deposits', String(existingDeposits.length)], ['Active bank accounts', String(banks.length)], ['Active projects', String(projects.length)], ['Reference prefix', settings.referencePrefix], ['TDS rate', `${settings.tdsPercentage}%`]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>)}
          </CardContent>
        </Card>
      </div>
    </div>}

    {/* Step 2 — mapping */}
    {step === 'mapping' && read && <Card className="border-white/80 bg-white/90 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div><CardTitle className="text-base">Map source columns</CardTitle><CardDescription>{fileName} · {read.rows.length} data rows · {read.headers.length} columns detected on row {read.headerRow}.</CardDescription></div>
          <Button variant="outline" size="sm" onClick={() => setColumnMap(autoMapColumns(FD_IMPORT_FIELDS, read.headers))}><Wand2 className="mr-2 h-4 w-4" />Re-run auto-map</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label className="text-xs">Worksheet</Label>
            <Select value={sheetName} onValueChange={(value) => readSheet(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sheetNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Header row</Label>
            <Input type="number" min={1} value={headerRow} onChange={(event) => { const next = Math.max(1, Number(event.target.value) || 1); setHeaderRow(next); readSheet(sheetName, next); }} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {unmappedRequired.length > 0
          ? <p className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />Map every mandatory column to continue: <strong>{unmappedRequired.map((field) => field.label).join(', ')}</strong></p>
          : <p className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />All mandatory columns are mapped. Unmapped optional columns fall back to their documented defaults.</p>}

        {FD_IMPORT_FIELD_GROUPS.map((group: ImportFieldGroup) => {
          const fields = FD_IMPORT_FIELDS.filter((field) => field.group === group);
          if (!fields.length) return null;
          return <div key={group} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{fields.map((field) => {
              const value = columnMap[field.key] || UNMAPPED;
              const isMapped = value !== UNMAPPED;
              return <div key={field.key} className={cn('space-y-1 rounded-lg border p-2.5', field.required && !isMapped ? 'border-rose-200 bg-rose-50/50' : isMapped ? 'border-emerald-100 bg-emerald-50/30' : 'border-slate-200 bg-white')}>
                <Label className="flex items-center gap-1 text-xs font-medium text-slate-700">{field.label}{field.required && <span className="text-rose-500">*</span>}</Label>
                <Select value={value} onValueChange={(next) => setColumnMap((current) => ({ ...current, [field.key]: next }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={UNMAPPED}>{field.fallback !== undefined ? `Not mapped — default "${String(field.fallback)}"` : 'Not mapped'}</SelectItem>{read.headers.map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}</SelectContent>
                </Select>
                {field.hint && <p className="text-[10px] leading-snug text-muted-foreground">{field.hint}</p>}
              </div>;
            })}</div>
          </div>;
        })}

        {unusedHeaders.length > 0 && <p className="text-xs text-muted-foreground"><strong>{unusedHeaders.length} source columns are unused:</strong> {unusedHeaders.join(', ')}</p>}
      </CardContent>
      <CardContent className="flex justify-between border-t pt-4">
        <Button variant="outline" onClick={() => setStep('upload')}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
        <Button onClick={() => setStep('validation')} disabled={unmappedRequired.length > 0 || !read.rows.length} className="bg-gradient-to-r from-cyan-600 to-blue-700">Validate {read.rows.length} rows<ArrowRight className="ml-2 h-4 w-4" /></Button>
      </CardContent>
    </Card>}

    {/* Step 3 — validation */}
    {step === 'validation' && read && <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Rows read', value: rows.length, tone: 'text-slate-900' },
          { label: 'Ready to import', value: readyRows.length, tone: 'text-emerald-700' },
          { label: 'With warnings', value: warningRows.length, tone: 'text-amber-700' },
          { label: 'Blocked', value: errorRows.length, tone: 'text-rose-700' },
        ].map((card) => <Card key={card.label} className="border-white/80 bg-white/90"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{card.label}</p><p className={cn('mt-1 text-2xl font-bold', card.tone)}>{card.value}</p></CardContent></Card>)}
      </div>

      <Card className="border-white/80 bg-white/90 shadow-sm">
        <CardHeader><CardTitle className="text-base">Import options</CardTitle><CardDescription>These change validation as well as the write — blocked rows are recalculated immediately.</CardDescription></CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approval treatment</Label>
            <RadioGroup value={approvalMode} onValueChange={(value) => setApprovalMode(value as ApprovalMode)} className="space-y-1.5">
              {[['migrate', 'Migrate as approved', 'Opening data — records land approved and active with you recorded as the migration approver.'], ['draft', 'Create as drafts', 'Rows land as DRAFT so they run through the normal approval workflow.']].map(([value, label, hint]) => <label key={value} className="flex cursor-pointer gap-2.5 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"><RadioGroupItem value={value} className="mt-0.5" /><span><span className="block text-sm font-medium">{label}</span><span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span></span></label>)}
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Existing FD numbers</Label>
            <RadioGroup value={duplicates} onValueChange={(value) => setDuplicates(value as DuplicateMode)} className="space-y-1.5">
              {[['skip', 'Skip duplicates', 'Any FD number already recorded against the same bank is blocked and reported.'], ['update', 'Update matching drafts', 'Overwrites unapproved, unutilised records. Approved or utilised FDs are still blocked.']].map(([value, label, hint]) => <label key={value} className="flex cursor-pointer gap-2.5 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"><RadioGroupItem value={value} className="mt-0.5" /><span><span className="block text-sm font-medium">{label}</span><span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span></span></label>)}
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reference numbers</Label>
            <RadioGroup value={referenceMode} onValueChange={(value) => setReferenceMode(value as ReferenceMode)} className="space-y-1.5">
              {[['generate', 'Allocate from FD counter', `Continues the ${settings.referencePrefix}/${fdOrgCode(organizationName)}/FY/0000 sequence used by the create form.`], ['file', 'Keep file references', 'Uses the FD Reference Number column when present, falling back to the counter when blank.']].map(([value, label, hint]) => <label key={value} className="flex cursor-pointer gap-2.5 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"><RadioGroupItem value={value} className="mt-0.5" /><span><span className="block text-sm font-medium">{label}</span><span className="block break-all text-[11px] leading-snug text-muted-foreground">{hint}</span></span></label>)}
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-white/80 bg-white/90 shadow-sm">
        <CardHeader className="gap-3">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div><CardTitle className="text-base">Row review</CardTitle><CardDescription>{visibleRows.length} of {rows.length} rows shown{rows.length > PREVIEW_LIMIT ? ` · preview capped at ${PREVIEW_LIMIT}` : ''}.</CardDescription></div>
            <div className="flex flex-wrap gap-2">
              {([['all', 'All', rows.length], ['ready', 'Clean', readyRows.length - warningRows.length], ['warning', 'Warnings', warningRows.length], ['error', 'Blocked', errorRows.length]] as const).map(([value, label, count]) => <Button key={value} size="sm" variant={rowFilter === value ? 'default' : 'outline'} onClick={() => setRowFilter(value)}>{label} <Badge variant="secondary" className="ml-1.5">{count}</Badge></Button>)}
              {canExportExceptions && (errorRows.length > 0 || warningRows.length > 0) && <Button size="sm" variant="outline" onClick={() => void exportExceptions()}><Download className="mr-2 h-4 w-4" />Export Exceptions</Button>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[520px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50"><TableRow><TableHead className="w-14">Row</TableHead><TableHead>FD / Bank</TableHead><TableHead>Holder / Project</TableHead><TableHead className="text-right">Principal</TableHead><TableHead>Value → Maturity</TableHead><TableHead className="text-right">Eligible / Available</TableHead><TableHead>Validation</TableHead></TableRow></TableHeader>
              <TableBody>
                {visibleRows.map((row) => <TableRow key={row.excelRow} className={row.errors.length ? 'bg-rose-50/40' : row.warnings.length ? 'bg-amber-50/30' : undefined}>
                  <TableCell className="text-xs text-muted-foreground">{row.excelRow}</TableCell>
                  <TableCell><p className="font-medium">{text(row.values, 'fdNumber') || '—'}</p><p className="text-xs text-muted-foreground">{row.bank ? bankLabel(row.bank) : text(row.values, 'bankName') || 'Unresolved bank'}</p></TableCell>
                  <TableCell><p className="text-sm">{text(row.values, 'holderName') || '—'}</p><p className="text-xs text-muted-foreground">{row.project?.projectName || text(row.values, 'projectName') || 'No project'}</p></TableCell>
                  <TableCell className="text-right font-medium">{currency(num(row.values, 'principalAmount'))}<p className="text-xs font-normal text-muted-foreground">{num(row.values, 'interestRate')}% · {row.financials.tenureDays}d</p></TableCell>
                  <TableCell className="text-xs">{asDate(row.values, 'valueDate')?.toLocaleDateString('en-IN') || '—'}<br />{asDate(row.values, 'maturityDate')?.toLocaleDateString('en-IN') || '—'}</TableCell>
                  <TableCell className="text-right text-xs">{currency(row.financials.eligibleValue)}<br /><span className="font-medium text-emerald-700">{currency(row.financials.availableAmount)}</span></TableCell>
                  <TableCell className="max-w-[420px]">
                    {!row.errors.length && !row.warnings.length && <Badge className="bg-emerald-600 hover:bg-emerald-600">Ready</Badge>}
                    {row.errors.length > 0 && <ul className="space-y-0.5">{row.errors.map((message, index) => <li key={index} className="flex gap-1.5 text-[11px] leading-snug text-rose-700"><XCircle className="mt-0.5 h-3 w-3 shrink-0" />{message}</li>)}</ul>}
                    {row.warnings.length > 0 && <ul className={cn('space-y-0.5', row.errors.length && 'mt-1')}>{row.warnings.map((message, index) => <li key={index} className="flex gap-1.5 text-[11px] leading-snug text-amber-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{message}</li>)}</ul>}
                  </TableCell>
                </TableRow>)}
                {!visibleRows.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-sm text-muted-foreground">No rows in this view.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        <CardContent className="flex flex-col justify-between gap-3 border-t pt-4 sm:flex-row sm:items-center">
          <Button variant="outline" onClick={() => setStep('mapping')} disabled={importing}><ArrowLeft className="mr-2 h-4 w-4" />Back to mapping</Button>
          <div className="flex items-center gap-3">
            {errorRows.length > 0 && <p className="text-xs text-muted-foreground">{errorRows.length} blocked rows will be skipped.</p>}
            <Button onClick={() => void runImport()} disabled={!canImport || importing || !readyRows.length} className="bg-gradient-to-r from-cyan-600 to-blue-700">
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import {readyRows.length} rows{updateCount ? ` (${insertCount} new, ${updateCount} updates)` : ''}
            </Button>
          </div>
        </CardContent>
        {importing && <CardContent className="border-t pt-4"><Progress value={progress} /><p className="mt-2 text-center text-xs text-muted-foreground">Committing… {progress}%</p></CardContent>}
      </Card>
    </div>}

    {/* Step 4 — summary */}
    {step === 'summary' && outcome && <div className="space-y-4">
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white shadow-sm">
        <CardHeader className="flex-row items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600"><CheckCircle2 className="h-5 w-5 text-white" /></div>
          <div><CardTitle className="text-base">Import complete</CardTitle><CardDescription>{outcome.fileName} · sheet &quot;{outcome.sheetName}&quot; · finished {outcome.finishedAt.toLocaleString('en-IN')}</CardDescription></div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-5">
          {[['Rows read', outcome.read, 'text-slate-900'], ['Created', outcome.inserted, 'text-emerald-700'], ['Updated', outcome.updated, 'text-blue-700'], ['Skipped by validation', outcome.skipped, 'text-amber-700'], ['Failed to write', outcome.failures.length, 'text-rose-700']].map(([label, value, tone]) => <div key={String(label)} className="rounded-lg border bg-white/80 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className={cn('mt-0.5 text-xl font-bold', tone as string)}>{value}</p></div>)}
        </CardContent>
        <CardContent className="flex flex-wrap gap-2 border-t pt-4">
          <Button asChild className="bg-gradient-to-r from-cyan-600 to-blue-700"><Link href="/fixed-deposit/register"><Database className="mr-2 h-4 w-4" />Open FD Register</Link></Button>
          {approvalMode === 'draft' && <Button variant="outline" asChild><Link href="/fixed-deposit/approvals">Review pending approvals</Link></Button>}
          {outcome.skipped > 0 && canExportExceptions && <Button variant="outline" onClick={() => void exportExceptions()}><Download className="mr-2 h-4 w-4" />Export {outcome.skipped} skipped rows</Button>}
          <Button variant="outline" onClick={resetWizard}><RotateCcw className="mr-2 h-4 w-4" />Import another file</Button>
        </CardContent>
      </Card>

      {outcome.failures.length > 0 && <Card className="border-rose-200 bg-white/90">
        <CardHeader><CardTitle className="text-base text-rose-700">Rows that failed to write</CardTitle><CardDescription>These passed validation but Firestore rejected the batch. Fix the cause and re-import them.</CardDescription></CardHeader>
        <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead className="w-20">Row</TableHead><TableHead>FD Number</TableHead><TableHead>Error</TableHead></TableRow></TableHeader><TableBody>{outcome.failures.map((failure) => <TableRow key={failure.excelRow}><TableCell>{failure.excelRow}</TableCell><TableCell>{failure.reference}</TableCell><TableCell className="text-xs text-rose-700">{failure.message}</TableCell></TableRow>)}</TableBody></Table></CardContent>
      </Card>}

      {outcome.inserted > 0 && (outcome.updated > 0 || approvalMode === 'migrate') && <Card className="border-white/80 bg-white/90">
        <CardContent className="flex items-start gap-2.5 p-4 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600" />
          <span>Imported deposits carry <code className="rounded bg-slate-100 px-1">source: excel_import</code> and the source file name, and every row wrote an <code className="rounded bg-slate-100 px-1">IMPORT</code> audit entry against the FD. Where opening BG/LC utilisation was supplied, create the matching assignments so the register&apos;s assignment-derived utilisation agrees with the stored balance.</span>
        </CardContent>
      </Card>}
    </div>}

    <Separator />
    <p className="text-[11px] text-muted-foreground">Validation covers {FD_IMPORT_FIELDS.length} fields: mandatory presence, number and date typing, enum membership, bank and project resolution, tenure and maturity consistency, opening utilisation against eligible value, and duplicates within the file and against the register.</p>
  </div>;
}
