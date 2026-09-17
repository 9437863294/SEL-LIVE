'use client';

/**
 * Bulk import of expense requests for one department — a four-step wizard
 * (upload → map columns → preview & validate → import).
 *
 * The rules live in `@/lib/expenses-import`, not here: this component reads the workbook, lets the
 * user correct the auto-detected column mapping, shows what will and will not be written, and then
 * commits. Nothing is written until the user has seen the preview, and a row that failed validation
 * is never written in a partial form.
 *
 * Numbering is the part worth understanding. In `generate` mode the department's
 * `departmentSerialConfigs` counter is bumped **once** by the number of valid rows inside a
 * transaction, and the returned block is handed out in order — so an import of 300 rows takes one
 * transaction rather than 300, and cannot interleave with somebody using the create form at the
 * same time. In `file` mode the numbers come from the sheet, for history that already has them, and
 * the counter is left alone.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { collection, doc, runTransaction, writeBatch } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  RotateCcw,
  Upload,
  Wand2,
  XCircle,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import { exportWorkbook } from '@/lib/report-excel';
import type {
  AccountHead,
  Department,
  ExpenseRequest,
  Project,
  SerialNumberConfig,
  SubAccountHead,
} from '@/lib/types';
import {
  EXPENSE_IMPORT_COLUMNS,
  EXPENSE_IMPORT_TEMPLATE_HEADERS,
  EXPENSE_IMPORT_TEMPLATE_SAMPLE,
  allocateRequestNos,
  buildExpenseColumnMap,
  buildExpenseTemplateInstructions,
  expenseFingerprint,
  localDateKeyOf,
  parseExpenseImportRows,
  readExpenseSheet,
  type ExpenseColumnMap,
  type ExpenseImportFieldKey,
  type ExpenseImportResult,
  type ExpenseSheet,
  type RequestNoSource,
} from '@/lib/expenses-import';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/* ── constants ───────────────────────────────────────────────────────────── */

type Step = 'upload' | 'mapping' | 'preview' | 'summary';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'upload', label: 'Upload' },
  { id: 'mapping', label: 'Map Columns' },
  { id: 'preview', label: 'Preview & Validate' },
  { id: 'summary', label: 'Import' },
];

const SKIP = '__skip__';

/** Each row is a single document write, so this stays well inside Firestore's 500-op batch limit. */
const ROWS_PER_BATCH = 400;

/** Rows drawn in the preview table. Every row is still validated and imported. */
const PREVIEW_LIMIT = 200;

/** Columns shown in the preview, in reading order. */
const PREVIEW_KEYS: ExpenseImportFieldKey[] = [
  'date',
  'projectName',
  'partyName',
  'subHeadOfAccount',
  'headOfAccount',
  'amount',
  'description',
];

type PreviewFilter = 'all' | 'ready' | 'warnings' | 'rejected' | 'duplicates';

interface ImportSummary {
  imported: number;
  skipped: number;
  firstRequestNo: string;
  lastRequestNo: string;
}

/* ── workbook reading ────────────────────────────────────────────────────── */

const pad = (value: number) => String(value).padStart(2, '0');

const cellToText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // exceljs hands back UTC midnight for a date-formatted cell, so read it back in UTC — local
    // getters would shift the day for anyone west of Greenwich.
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === 'object') {
    const cell = value as {
      text?: unknown;
      result?: unknown;
      error?: unknown;
      richText?: Array<{ text?: string }>;
      hyperlink?: string;
    };
    if (Array.isArray(cell.richText)) return cell.richText.map((run) => run.text ?? '').join('');
    if (cell.text !== undefined) return cellToText(cell.text);
    if (cell.result !== undefined) return cellToText(cell.result);
    if (cell.error !== undefined) return '';
    return '';
  }
  return String(value);
};

/**
 * Reads an .xlsx into a string grid, keeping row numbers aligned with what the user sees in Excel —
 * a blank row in the middle of a register must not shift every row number below it in the error
 * report. exceljs is imported on demand: it is a large dependency and only this dialog needs it.
 */
async function readWorkbookGrid(file: File): Promise<string[][]> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  // A re-uploaded template carries Instructions and Master Data sheets too; the data sheet is the
  // one named like the template's, falling back to the first sheet for any other file.
  const sheet =
    workbook.worksheets.find((candidate) => /expense/i.test(candidate.name)) ?? workbook.worksheets[0];
  if (!sheet) return [];

  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    // exceljs row values are 1-based with a leading hole, and an empty row can hand back nothing.
    const values = ((row.values as unknown[] | undefined) ?? []).slice(1);
    grid[row.number - 1] = values.map(cellToText);
  });
  for (let index = 0; index < grid.length; index += 1) if (!grid[index]) grid[index] = [];
  return grid;
}

/* ── component ───────────────────────────────────────────────────────────── */

export function ExpenseImportDialog({
  open,
  onOpenChange,
  department,
  projects,
  accountHeads,
  subAccountHeads,
  existingExpenses,
  onImported,
  duplicateDetection = true,
  defaultRequestNoSource = 'generate',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: Department | null;
  projects: Project[];
  accountHeads: AccountHead[];
  subAccountHeads: SubAccountHead[];
  /** This department's existing requests — what duplicate detection compares against. */
  existingExpenses: ExpenseRequest[];
  onImported: () => void;
  /** From the module data rules; off means a re-import creates the rows again. */
  duplicateDetection?: boolean;
  /** From the module data rules; which numbering option the wizard opens on. */
  defaultRequestNoSource?: RequestNoSource;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [requestNoSource, setRequestNoSource] = useState<RequestNoSource>(defaultRequestNoSource);
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [sheet, setSheet] = useState<ExpenseSheet | null>(null);
  const [columnMap, setColumnMap] = useState<ExpenseColumnMap>({});
  const [result, setResult] = useState<ExpenseImportResult | null>(null);
  const [filter, setFilter] = useState<PreviewFilter>('all');
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const masters = useMemo(
    () => ({ projects, accountHeads, subAccountHeads }),
    [projects, accountHeads, subAccountHeads],
  );

  const existing = useMemo(
    () => ({
      requestNos: existingExpenses.map((expense) => expense.requestNo).filter(Boolean),
      fingerprints: existingExpenses.map((expense) =>
        expenseFingerprint({
          projectId: expense.projectId,
          amount: expense.amount || 0,
          partyName: expense.partyName || '',
          description: expense.description || '',
          createdAt: expense.createdAt || '',
        }),
      ),
    }),
    [existingExpenses],
  );

  const reset = useCallback(() => {
    setStep('upload');
    setFileName('');
    setIsDragging(false);
    setIsReading(false);
    setSheet(null);
    setColumnMap({});
    setResult(null);
    setFilter('all');
    setProgress(0);
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = (next: boolean) => {
    if (isImporting) return;
    if (!next) reset();
    onOpenChange(next);
  };

  /* ---- template ---- */

  const downloadTemplate = async () => {
    const header = EXPENSE_IMPORT_TEMPLATE_HEADERS;
    const sample: Record<string, unknown> = {};
    header.forEach((label, index) => {
      sample[label] = EXPENSE_IMPORT_TEMPLATE_SAMPLE[index] ?? '';
    });

    // Every project and sub-head that will resolve on import, so the sheet is filled with values
    // the importer already accepts rather than corrected one rejection at a time.
    const masterRowCount = Math.max(projects.length, subAccountHeads.length, 1);
    const masterRows = Array.from({ length: masterRowCount }, (_, index) => {
      const subHead = subAccountHeads[index];
      const head = subHead ? accountHeads.find((candidate) => candidate.id === subHead.headId) : undefined;
      return {
        'Project Name': projects[index]?.projectName ?? '',
        'Site Code': projects[index]?.siteCode ?? '',
        'Sub-Head of A/c': subHead?.name ?? '',
        'Head of A/c (derived)': head?.name ?? '',
      };
    });

    await exportWorkbook(`expense-import-template-${department?.name ?? 'department'}.xlsx`, [
      {
        name: 'Expense Requests',
        columns: header.map((label) => ({
          header: label,
          key: label,
          width: Math.min(42, Math.max(14, label.length + 6)),
        })),
        rows: [sample],
      },
      {
        name: 'Instructions',
        columns: [
          { header: 'Column', key: 'Column', width: 24 },
          { header: 'Requirement', key: 'Requirement', width: 14 },
          { header: 'Accepted Values', key: 'Accepted Values', width: 34 },
          { header: 'Notes', key: 'Notes', width: 90 },
        ],
        rows: buildExpenseTemplateInstructions(requestNoSource),
      },
      {
        name: 'Master Data',
        columns: [
          { header: 'Project Name', key: 'Project Name', width: 38 },
          { header: 'Site Code', key: 'Site Code', width: 16 },
          { header: 'Sub-Head of A/c', key: 'Sub-Head of A/c', width: 32 },
          { header: 'Head of A/c (derived)', key: 'Head of A/c (derived)', width: 32 },
        ],
        rows: masterRows,
      },
    ]);
  };

  /* ---- upload ---- */

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      toast({
        title: 'Only .xlsx files are supported',
        description: 'Open the file in Excel and use Save As › Excel Workbook (.xlsx).',
        variant: 'destructive',
      });
      return;
    }
    setIsReading(true);
    setFileName(file.name);
    try {
      const grid = await readWorkbookGrid(file);
      const read = readExpenseSheet(grid);
      if (!read.headings.length) {
        toast({
          title: 'No column headings found',
          description: 'The first filled row of the sheet must be the column headings.',
          variant: 'destructive',
        });
        reset();
        return;
      }
      setSheet(read);
      setColumnMap(buildExpenseColumnMap(read.headings));
      setStep('mapping');
    } catch (error) {
      console.error('Failed to read the expense sheet:', error);
      toast({
        title: 'Could not read the file',
        description: 'Save it as .xlsx and try again.',
        variant: 'destructive',
      });
      reset();
    } finally {
      setIsReading(false);
    }
  };

  /* ---- validate ---- */

  const buildPreview = () => {
    if (!sheet) return;
    setResult(
      parseExpenseImportRows(sheet, columnMap, masters, {
        requestNoSource,
        // Duplicate detection is a module data rule. With it off, nothing is compared against what
        // is already recorded and a re-import creates the rows a second time.
        existingRequestNos: duplicateDetection ? existing.requestNos : [],
        existingFingerprints: duplicateDetection ? existing.fingerprints : [],
      }),
    );
    setFilter('all');
    setStep('preview');
  };

  const downloadIssueReport = async () => {
    if (!result) return;
    const rows = [
      ...result.issues.map((issue) => ({ Row: issue.row, Outcome: 'Rejected', Column: issue.field ?? '', Reason: issue.message })),
      ...result.duplicates.map((issue) => ({ Row: issue.row, Outcome: 'Skipped as duplicate', Column: issue.field ?? '', Reason: issue.message })),
      ...result.rows
        .filter((row) => row.warnings.length)
        .map((row) => ({ Row: row.row, Outcome: 'Imported with warnings', Column: '', Reason: row.warnings.join(' ') })),
    ].sort((a, b) => a.Row - b.Row);

    await exportWorkbook(`expense-import-report-${fileName.replace(/\.xlsx$/i, '')}.xlsx`, [
      {
        name: 'Import Report',
        columns: [
          { header: 'Row', key: 'Row', width: 8 },
          { header: 'Outcome', key: 'Outcome', width: 24 },
          { header: 'Column', key: 'Column', width: 22 },
          { header: 'Reason', key: 'Reason', width: 96 },
        ],
        rows,
      },
    ]);
  };

  /* ---- import ---- */

  const runImport = async () => {
    if (!result?.rows.length || !department || !user) return;
    setIsImporting(true);
    setProgress(0);
    try {
      let requestNos: string[];
      if (requestNoSource === 'file') {
        requestNos = result.rows.map((row) => row.draft.requestNo as string);
      } else {
        const configRef = doc(db, 'departmentSerialConfigs', department.id);
        // One transaction for the whole block: the create form's per-request transaction run
        // hundreds of times is both slow and a way to leave an import half-numbered.
        requestNos = await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(configRef);
          if (!snapshot.exists()) {
            throw new Error(
              `${department.name} has no serial number configuration. Set one under Expenses › Settings › Department-wise Serial Number.`,
            );
          }
          const config = snapshot.data() as SerialNumberConfig;
          const allocated = allocateRequestNos(config, result.rows.length);
          transaction.update(configRef, { startingIndex: allocated.nextIndex });
          return allocated.requestNos;
        });
      }

      for (let offset = 0; offset < result.rows.length; offset += ROWS_PER_BATCH) {
        const batch = writeBatch(db);
        result.rows.slice(offset, offset + ROWS_PER_BATCH).forEach((row, index) => {
          const { projectName: _resolvedName, requestNo: _fromFile, ...draft } = row.draft;
          batch.set(doc(collection(db, 'expenseRequests')), {
            ...draft,
            requestNo: requestNos[offset + index],
            departmentId: department.id,
            generatedByDepartment: department.name,
            generatedByUser: user.name || 'Unknown',
            generatedByUserId: user.id || 'Unknown',
          });
        });
        await batch.commit();
        setProgress(Math.min(offset + ROWS_PER_BATCH, result.rows.length));
      }

      const skipped = result.issues.length + result.duplicates.length;
      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: 'Expenses',
        action: 'Import Expense Requests',
        details: {
          department: department.name,
          file: fileName,
          imported: result.rows.length,
          skipped,
          totalAmount: result.totalAmount,
          requestNoSource,
        },
      });

      setSummary({
        imported: result.rows.length,
        skipped,
        firstRequestNo: requestNos[0] ?? '',
        lastRequestNo: requestNos[requestNos.length - 1] ?? '',
      });
      setStep('summary');
      onImported();
    } catch (error: unknown) {
      console.error('Failed to import expense requests:', error);
      toast({
        title: 'The import did not finish',
        description:
          error instanceof Error
            ? error.message
            : 'Some requests may have been created. Reload the register before retrying.',
        variant: 'destructive',
        duration: 10000,
      });
    } finally {
      setIsImporting(false);
    }
  };

  /* ---- derived ---- */

  const unmappedRequired = EXPENSE_IMPORT_COLUMNS.filter(
    (column) =>
      (column.required || (column.key === 'requestNo' && requestNoSource === 'file')) && !columnMap[column.key],
  );

  const warningCount = result?.rows.filter((row) => row.warnings.length).length ?? 0;

  const previewRows = useMemo(() => {
    if (!result) return [];
    type Line = {
      row: number;
      kind: 'ready' | 'rejected' | 'duplicate';
      values: Partial<Record<ExpenseImportFieldKey, string>>;
      messages: string[];
    };
    const lines: Line[] = [
      ...result.rows.map((row) => ({
        row: row.row,
        kind: 'ready' as const,
        values: {
          // Local, not the ISO string's UTC slice — otherwise a row dated the 15th previews as the 14th.
          date: localDateKeyOf(row.draft.createdAt),
          projectName: row.draft.projectName,
          partyName: row.draft.partyName,
          subHeadOfAccount: row.draft.subHeadOfAccount,
          headOfAccount: row.draft.headOfAccount,
          amount: `₹${row.draft.amount.toLocaleString('en-IN')}`,
          description: row.draft.description,
        },
        messages: row.warnings,
      })),
      ...result.issues
        .filter((issue) => issue.row !== result.headerRow)
        .map((issue) => ({ row: issue.row, kind: 'rejected' as const, values: {}, messages: [issue.message] })),
      ...result.duplicates.map((issue) => ({
        row: issue.row,
        kind: 'duplicate' as const,
        values: {},
        messages: [issue.message],
      })),
    ].sort((a, b) => a.row - b.row);

    return lines.filter((line) => {
      if (filter === 'ready') return line.kind === 'ready';
      if (filter === 'warnings') return line.kind === 'ready' && line.messages.length > 0;
      if (filter === 'rejected') return line.kind === 'rejected';
      if (filter === 'duplicates') return line.kind === 'duplicate';
      return true;
    });
  }, [result, filter]);

  const headerIssue = result?.issues.find((issue) => issue.row === result.headerRow && !issue.field);

  /* ================================================================== */

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-2 border-b border-border/60 px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-primary" />
            Import expense requests
            {department ? <span className="text-muted-foreground font-normal">— {department.name}</span> : null}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Load a register as .xlsx. Column order does not matter — headings are matched by name and you can
            correct the mapping before anything is written.
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-1.5">
            {STEPS.map((entry, index) => {
              const currentIndex = STEPS.findIndex((candidate) => candidate.id === step);
              return (
                <span
                  key={entry.id}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                    index === currentIndex
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : index < currentIndex
                        ? 'text-muted-foreground/60 line-through'
                        : 'text-muted-foreground/60',
                  )}
                >
                  {index + 1}. {entry.label}
                </span>
              );
            })}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* ─── STEP 1: Upload ─── */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Request numbers
                </Label>
                <RadioGroup
                  value={requestNoSource}
                  onValueChange={(value) => setRequestNoSource(value as RequestNoSource)}
                  className="mt-2.5 grid gap-2 sm:grid-cols-2"
                >
                  <label
                    htmlFor="request-no-generate"
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                      requestNoSource === 'generate' ? 'border-primary/40 bg-primary/5' : 'border-border/60',
                    )}
                  >
                    <RadioGroupItem value="generate" id="request-no-generate" className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">Allocate from the department series</span>
                      <span className="block text-xs text-muted-foreground">
                        Continues this department&apos;s serial configuration, exactly as the create form does.
                      </span>
                    </span>
                  </label>
                  <label
                    htmlFor="request-no-file"
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                      requestNoSource === 'file' ? 'border-primary/40 bg-primary/5' : 'border-border/60',
                    )}
                  >
                    <RadioGroupItem value="file" id="request-no-file" className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">Take them from the file</span>
                      <span className="block text-xs text-muted-foreground">
                        For history that already has its numbers. The department counter is left untouched.
                      </span>
                    </span>
                  </label>
                </RadioGroup>
              </div>

              <div
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors sm:p-12',
                  isDragging ? 'border-primary/50 bg-primary/5' : 'border-border/60 bg-muted/20 hover:border-primary/40',
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  void handleFile(event.dataTransfer.files?.[0]);
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                {isReading ? (
                  <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary/60" />
                ) : (
                  <FileSpreadsheet className="mb-3 h-10 w-10 text-primary/40" />
                )}
                <p className="text-sm font-semibold">
                  {isReading ? 'Reading the workbook…' : 'Drop your .xlsx file here'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  or click to browse — a title row above the headings is fine
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />

              <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Recognised columns
                  </p>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void downloadTemplate()}>
                    <Download className="h-3.5 w-3.5" /> Download template
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {EXPENSE_IMPORT_COLUMNS.map((column) => {
                    const required = column.required || (column.key === 'requestNo' && requestNoSource === 'file');
                    return (
                      <Badge
                        key={column.key}
                        variant="outline"
                        className={cn(
                          'text-xs font-normal',
                          required
                            ? 'border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400'
                            : 'border-border/60 text-muted-foreground',
                        )}
                      >
                        {column.label}
                        {required && <span className="ml-0.5 text-rose-500">*</span>}
                      </Badge>
                    );
                  })}
                </div>
                <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  The template carries an Instructions sheet and a Master Data sheet listing the project and
                  sub-head names that will resolve on import.
                </p>
              </div>
            </div>
          )}

          {/* ─── STEP 2: Map columns ─── */}
          {step === 'mapping' && sheet && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{fileName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{sheet.rows.length}</span> data rows ·{' '}
                    <span className="font-medium text-foreground">{sheet.headings.length}</span> columns · headings on
                    row {sheet.headerRow}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => setColumnMap(buildExpenseColumnMap(sheet.headings))}
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Re-detect
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={reset}>
                    <RotateCcw className="h-3.5 w-3.5" /> Change file
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border/60">
                <div className="hidden grid-cols-[1fr_1fr_auto] gap-4 border-b border-border/60 bg-muted/40 px-4 py-2 sm:grid">
                  {['Expense field', 'Your column', ''].map((label, index) => (
                    <span key={index} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {label}
                    </span>
                  ))}
                </div>
                <div className="divide-y divide-border/60">
                  {EXPENSE_IMPORT_COLUMNS.map((column) => {
                    const required = column.required || (column.key === 'requestNo' && requestNoSource === 'file');
                    const mapped = columnMap[column.key] ?? '';
                    return (
                      <div
                        key={column.key}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_1fr_auto] sm:gap-4"
                      >
                        <div>
                          <span className="text-sm">{column.label}</span>
                          {required && <span className="ml-1.5 text-[10px] font-medium text-rose-500">required</span>}
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{column.hint}</p>
                        </div>
                        <Select
                          value={mapped || SKIP}
                          onValueChange={(value) =>
                            setColumnMap((previous) => ({
                              ...previous,
                              [column.key]: value === SKIP ? undefined : value,
                            }))
                          }
                        >
                          <SelectTrigger className="col-span-2 h-9 text-sm sm:col-span-1 sm:h-8">
                            <SelectValue placeholder="— Not in my file —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP}>— Not in my file —</SelectItem>
                            {sheet.headings.map((heading) => (
                              <SelectItem key={heading} value={heading}>
                                {heading}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex w-6 items-center justify-center">
                          {mapped ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : required ? (
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                          ) : (
                            <span className="text-xs text-muted-foreground/40">–</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {unmappedRequired.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Map a column to {unmappedRequired.map((column) => `"${column.label}"`).join(', ')} — nothing can be
                  imported without it.
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 3: Preview & validate ─── */}
          {step === 'preview' && result && (
            <div className="space-y-4">
              {headerIssue ? (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {headerIssue.message}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="gap-1 border-emerald-500/20 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {result.rows.length} ready
                  </Badge>
                  {warningCount > 0 && (
                    <Badge className="gap-1 border-amber-500/20 bg-amber-500/10 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> {warningCount} with warnings
                    </Badge>
                  )}
                  {result.duplicates.length > 0 && (
                    <Badge className="gap-1 border-blue-500/20 bg-blue-500/10 text-blue-700 hover:bg-blue-500/10 dark:text-blue-400">
                      {result.duplicates.length} duplicates skipped
                    </Badge>
                  )}
                  {result.issues.length > 0 && (
                    <Badge className="gap-1 border-rose-500/20 bg-rose-500/10 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400">
                      <XCircle className="h-3.5 w-3.5" /> {result.issues.length} rejected
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-muted-foreground">
                    ₹{result.totalAmount.toLocaleString('en-IN')} total
                  </Badge>
                </div>
                <div className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 p-0.5">
                  {(['all', 'ready', 'warnings', 'rejected', 'duplicates'] as PreviewFilter[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setFilter(mode)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                        filter === mode ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {result.unmappedHeadings.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Ignored columns: {result.unmappedHeadings.join(', ')}
                </p>
              )}

              <div className="overflow-auto rounded-xl border border-border/60" style={{ maxHeight: '48vh' }}>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
                    <TableRow>
                      <TableHead className="w-14 text-[11px] font-semibold uppercase tracking-wider">Row</TableHead>
                      {PREVIEW_KEYS.map((key) => (
                        <TableHead
                          key={key}
                          className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider"
                        >
                          {EXPENSE_IMPORT_COLUMNS.find((column) => column.key === key)?.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={PREVIEW_KEYS.length + 1} className="py-10 text-center text-sm text-muted-foreground">
                          No rows match this filter.
                        </TableCell>
                      </TableRow>
                    ) : (
                      previewRows.slice(0, PREVIEW_LIMIT).map((line) => (
                        <TableRow
                          key={`${line.kind}-${line.row}`}
                          className={cn(
                            line.kind === 'rejected' && 'bg-rose-500/5',
                            line.kind === 'duplicate' && 'bg-blue-500/5',
                          )}
                        >
                          <TableCell className="align-top text-xs text-muted-foreground">{line.row}</TableCell>
                          {line.kind === 'ready' ? (
                            PREVIEW_KEYS.map((key, index) => (
                              <TableCell key={key} className="align-top text-xs">
                                <span className="block max-w-[220px] truncate" title={line.values[key] ?? ''}>
                                  {line.values[key] || <span className="italic text-muted-foreground/50">—</span>}
                                </span>
                                {index === PREVIEW_KEYS.length - 1 && line.messages.length > 0 && (
                                  <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">
                                    {line.messages.join(' ')}
                                  </span>
                                )}
                              </TableCell>
                            ))
                          ) : (
                            <TableCell
                              colSpan={PREVIEW_KEYS.length}
                              className={cn(
                                'align-top text-xs',
                                line.kind === 'rejected' ? 'text-rose-600 dark:text-rose-400' : 'text-blue-700 dark:text-blue-400',
                              )}
                            >
                              {line.messages.join(' ')}
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {previewRows.length > PREVIEW_LIMIT
                    ? `Showing the first ${PREVIEW_LIMIT} of ${previewRows.length} rows — all of them are validated and imported.`
                    : 'Rejected and duplicate rows are skipped; everything else is written.'}
                </p>
                {result.issues.length + result.duplicates.length + warningCount > 0 && (
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void downloadIssueReport()}>
                    <Download className="h-3.5 w-3.5" /> Download report
                  </Button>
                )}
              </div>

              {isImporting && (
                <div className="space-y-1.5">
                  <Progress value={(progress / Math.max(1, result.rows.length)) * 100} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">
                    Writing {progress} of {result.rows.length}…
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 4: Summary ─── */}
          {step === 'summary' && summary && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                  <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{summary.imported}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Requests created</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-center">
                  <p className="text-3xl font-bold">{summary.skipped}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Rows skipped</p>
                </div>
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-center">
                  <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                    {summary.firstRequestNo}
                    {summary.lastRequestNo && summary.lastRequestNo !== summary.firstRequestNo
                      ? ` → ${summary.lastRequestNo}`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Request numbers</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <div>
                  <p className="text-sm font-semibold">The register has been refreshed.</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {summary.skipped > 0
                      ? 'Skipped rows were not written — fix them in the sheet and import it again; rows already created will be detected as duplicates.'
                      : 'Every row in the file was imported.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => handleClose(false)} disabled={isImporting}>
            {step === 'summary' ? 'Close' : 'Cancel'}
          </Button>
          <div className="flex items-center gap-2">
            {step === 'mapping' && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setStep('upload')}>
                  Back
                </Button>
                <Button size="sm" className="gap-2" onClick={buildPreview} disabled={unmappedRequired.length > 0}>
                  Preview &amp; validate <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            {step === 'preview' && result && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setStep('mapping')} disabled={isImporting}>
                  Back
                </Button>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => void runImport()}
                  disabled={result.rows.length === 0 || isImporting}
                >
                  {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {isImporting
                    ? 'Importing…'
                    : `Import ${result.rows.length} request${result.rows.length === 1 ? '' : 's'}`}
                </Button>
              </>
            )}
            {step === 'summary' && (
              <Button size="sm" onClick={() => handleClose(false)}>
                Done
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
