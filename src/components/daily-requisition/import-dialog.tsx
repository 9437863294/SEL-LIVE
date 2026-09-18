'use client';

/**
 * Bulk import of daily requisition entries.
 *
 * Paste is the primary input, not the fallback. This data lives in a sheet somebody already has
 * open, and selecting the rows and pressing Ctrl+V is a shorter path than Save As — so the dialog
 * opens on a paste box, with .xlsx upload beside it for a file that arrives by email.
 *
 * Every rule lives in `daily-requisition-import.ts` and is unit-tested there. This component reads
 * the input, shows what the rules decided, and writes what survived — nothing here decides whether a
 * row is valid.
 *
 * The preview is the point of the whole dialog. A register import that reports "11 imported" without
 * having shown which project each row resolved to is an import nobody can check afterwards, because
 * the sheet it came from is the only other copy.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { collection, doc, runTransaction, writeBatch, Timestamp } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import { exportWorkbook } from '@/lib/report-excel';
import type { Department, Project, SerialNumberConfig } from '@/lib/types';
import {
  allocateReceptionNos,
  buildRequisitionColumnMap,
  parseDelimitedGrid,
  parseRequisitionImportRows,
  readRequisitionSheet,
  REQUISITION_IMPORT_COLUMNS,
  REQUISITION_IMPORT_TEMPLATE_HEADERS,
  REQUISITION_IMPORT_TEMPLATE_SAMPLE,
  requisitionImportColumn,
  type ReceptionNoSource,
  type RequisitionColumnMap,
  type RequisitionImportFieldKey,
  type RequisitionImportResult,
  type RequisitionStatus,
} from '@/lib/daily-requisition-import';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const ROWS_PER_BATCH = 400;

const STATUSES: RequisitionStatus[] = [
  'Pending',
  'Received',
  'Verified',
  'Received for Payment',
  'Paid',
  'Needs Review',
  'Cancelled',
];

const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** An existing entry's key material, so a re-import can be recognised. */
export interface RequisitionImportExisting {
  receptionNos: readonly string[];
  fingerprints?: readonly string[];
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
 * a blank row mid-register must not shift every row number below it in the error report. exceljs is
 * imported on demand: it is a large dependency and only this dialog needs it.
 */
async function readWorkbookGrid(file: File): Promise<string[][]> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
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

export function DailyRequisitionImportDialog({
  open,
  onOpenChange,
  projects,
  departments,
  existing,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  departments: Department[];
  existing: RequisitionImportExisting;
  onImported: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'input' | 'preview' | 'summary'>('input');
  const [pasted, setPasted] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [grid, setGrid] = useState<string[][]>([]);
  const [overrides, setOverrides] = useState<RequisitionColumnMap>({});
  const [receptionNoSource, setReceptionNoSource] = useState<ReceptionNoSource>('file');
  const [status, setStatus] = useState<RequisitionStatus>('Pending');
  const [partyFromDescription, setPartyFromDescription] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<{ imported: number; skipped: number; gross: number } | null>(null);

  /**
   * The template is the sheet this dialog will accept, rather than a description of it: the data
   * sheet carries the exact headings auto-mapping looks for, Instructions documents every column
   * from the same metadata the mapping step reads, and Master Data lists the project and department
   * names that will resolve — so a sheet is filled with values that already match instead of being
   * corrected one rejection at a time.
   */
  const downloadTemplate = async () => {
    const headers = REQUISITION_IMPORT_TEMPLATE_HEADERS;
    const sample: Record<string, unknown> = {};
    headers.forEach((label, index) => {
      sample[label] = REQUISITION_IMPORT_TEMPLATE_SAMPLE[index] ?? '';
    });

    const masterRows = Array.from(
      { length: Math.max(projects.length, departments.length, 1) },
      (_, index) => ({
        'Project Name': projects[index]?.projectName ?? '',
        'Site Code': projects[index]?.siteCode ?? '',
        Department: departments[index]?.name ?? '',
      }),
    );

    await exportWorkbook('daily-requisition-import-template.xlsx', [
      {
        name: 'Requisitions',
        columns: headers.map((label) => ({
          header: label,
          key: label,
          width: Math.min(42, Math.max(14, label.length + 6)),
        })),
        rows: [sample],
      },
      {
        name: 'Instructions',
        columns: [
          { header: 'Column', key: 'Column', width: 22 },
          { header: 'Requirement', key: 'Requirement', width: 14 },
          { header: 'Accepted Values', key: 'Accepted Values', width: 38 },
          { header: 'Notes', key: 'Notes', width: 96 },
        ],
        rows: REQUISITION_IMPORT_COLUMNS.map((column) => ({
          Column: column.label,
          Requirement: column.required ? 'Mandatory' : 'Optional',
          'Accepted Values': column.accepted,
          Notes: column.hint,
        })),
      },
      {
        name: 'Master Data',
        columns: [
          { header: 'Project Name', key: 'Project Name', width: 38 },
          { header: 'Site Code', key: 'Site Code', width: 16 },
          { header: 'Department', key: 'Department', width: 30 },
        ],
        rows: masterRows,
      },
    ]);
  };

  /**
   * What the import refused, as a sheet. The rows that failed are the ones needing work in the
   * source register, and reading them off the screen one at a time is how a correction pass gets
   * abandoned half-done.
   */
  const downloadIssueReport = async () => {
    if (!result) return;
    const rows = [
      ...result.issues.map((issue) => ({
        Row: issue.row,
        Outcome: 'Rejected',
        Column: issue.field ?? '',
        Reason: issue.message,
      })),
      ...result.duplicates.map((issue) => ({
        Row: issue.row,
        Outcome: 'Skipped as duplicate',
        Column: issue.field ?? '',
        Reason: issue.message,
      })),
      ...result.rows
        .filter((row) => row.warnings.length)
        .map((row) => ({
          Row: row.row,
          Outcome: 'Imported with warnings',
          Column: '',
          Reason: row.warnings.join(' '),
        })),
    ].sort((a, b) => Number(a.Row) - Number(b.Row));

    await exportWorkbook('daily-requisition-import-report.xlsx', [
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

  const reset = useCallback(() => {
    setStep('input');
    setPasted('');
    setSourceLabel('');
    setGrid([]);
    setOverrides({});
    setReceptionNoSource('file');
    setStatus('Pending');
    setPartyFromDescription(true);
    setProgress(0);
    setSummary(null);
  }, []);

  const sheet = useMemo(() => (grid.length ? readRequisitionSheet(grid) : null), [grid]);

  /** Auto-mapping is a starting point; anything the user changed in the mapping step wins. */
  const columnMap = useMemo<RequisitionColumnMap>(() => {
    if (!sheet) return {};
    return { ...buildRequisitionColumnMap(sheet.headings), ...overrides };
  }, [sheet, overrides]);

  const result = useMemo<RequisitionImportResult | null>(() => {
    if (!sheet) return null;
    return parseRequisitionImportRows(
      sheet,
      columnMap,
      { projects, departments },
      {
        receptionNoSource,
        existingReceptionNos: existing.receptionNos,
        existingFingerprints: existing.fingerprints,
        partyFromDescription,
        status,
      },
    );
  }, [sheet, columnMap, projects, departments, receptionNoSource, existing, partyFromDescription, status]);

  const readPaste = () => {
    const parsed = parseDelimitedGrid(pasted);
    if (parsed.length < 2) {
      toast({
        variant: 'destructive',
        title: 'Nothing to read',
        description: 'Paste the heading row and at least one entry, copied straight out of the sheet.',
      });
      return;
    }
    setGrid(parsed);
    setSourceLabel(`pasted — ${parsed.length - 1} row${parsed.length === 2 ? '' : 's'}`);
    setStep('preview');
  };

  const readFile = async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      toast({
        variant: 'destructive',
        title: 'Only .xlsx files are supported',
        description: 'Open the file in Excel and use Save As › Excel Workbook (.xlsx), or paste the rows instead.',
      });
      return;
    }
    try {
      const parsed = await readWorkbookGrid(file);
      if (parsed.length < 2) {
        toast({ variant: 'destructive', title: 'That sheet has no rows below its headings.' });
        return;
      }
      setGrid(parsed);
      setSourceLabel(file.name);
      setStep('preview');
    } catch (error) {
      console.error('Failed to read workbook:', error);
      toast({
        variant: 'destructive',
        title: 'Could not read that file',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    }
  };

  /* ---- import ---- */

  const runImport = async () => {
    if (!result?.rows.length || !user) return;
    setIsImporting(true);
    setProgress(0);
    try {
      let receptionNos: string[];
      if (receptionNoSource === 'file') {
        receptionNos = result.rows.map((row) => row.draft.receptionNo as string);
      } else {
        const configRef = doc(db, 'serialNumberConfigs', 'daily-requisition');
        // One transaction for the whole block. The entry sheet's per-entry transaction run hundreds
        // of times is both slow and a way to leave an import half-numbered, and leaving the counter
        // short is how the next hand-keyed entry is handed a number an imported row already has.
        receptionNos = await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(configRef);
          if (!snapshot.exists()) {
            throw new Error(
              'Daily Requisition has no serial number configuration. Set one under Settings before importing with generated numbers.',
            );
          }
          const config = snapshot.data() as SerialNumberConfig;
          const allocated = allocateReceptionNos(config, result.rows.length);
          transaction.update(configRef, { startingIndex: allocated.nextIndex });
          return allocated.receptionNos;
        });
      }

      for (let offset = 0; offset < result.rows.length; offset += ROWS_PER_BATCH) {
        const batch = writeBatch(db);
        result.rows.slice(offset, offset + ROWS_PER_BATCH).forEach((row, index) => {
          const { draft } = row;
          batch.set(doc(collection(db, 'dailyRequisitions')), {
            receptionNo: receptionNos[offset + index],
            depNo: draft.depNo,
            date: Timestamp.fromDate(new Date(draft.date)),
            projectId: draft.projectId,
            departmentId: draft.departmentId,
            description: draft.description,
            partyName: draft.partyName,
            grossAmount: draft.grossAmount,
            netAmount: draft.netAmount,
            // The keying time from the sheet, not the import time — otherwise a year of history all
            // lands today and every monthly-trend report shows one enormous spike.
            createdAt: Timestamp.fromDate(new Date(draft.createdAt)),
            status: draft.status,
            documentStatus: 'Pending' as const,
            attachments: [],
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
        module: 'Daily Requisition',
        action: 'Import Daily Requisitions',
        details: {
          source: sourceLabel,
          imported: result.rows.length,
          skipped,
          totalGross: result.totalGross,
          totalNet: result.totalNet,
          receptionNoSource,
          status,
        },
      });

      setSummary({ imported: result.rows.length, skipped, gross: result.totalGross });
      setStep('summary');
      onImported();
    } catch (error: unknown) {
      console.error('Failed to import daily requisitions:', error);
      toast({
        variant: 'destructive',
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setIsImporting(false);
    }
  };

  /* ---- render ---- */

  const mappedCount = Object.values(columnMap).filter(Boolean).length;
  const missingRequired = REQUISITION_IMPORT_COLUMNS.filter(
    (column) => column.required && !columnMap[column.key],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isImporting) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[92dvh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" /> Import daily requisitions
          </DialogTitle>
          <DialogDescription className="text-xs">
            {step === 'input'
              ? 'Paste the rows straight out of your register, or upload the .xlsx. Column headings are matched for you.'
              : step === 'preview'
                ? `${sourceLabel} · headings on row ${result?.headerRow ?? 1}`
                : 'Done.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {step === 'input' && (
            <>
              <div>
                <Label className="flex items-center gap-1.5 text-xs font-semibold">
                  <ClipboardPaste className="h-3.5 w-3.5" /> Paste the register
                </Label>
                <p className="mb-1.5 mt-0.5 text-[11px] text-muted-foreground">
                  Select the heading row and the entries in Excel, copy, and paste here. Tabs and commas both
                  work, and a project name containing a comma survives either way.
                </p>
                <Textarea
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="font-mono text-[11px]"
                  placeholder={
                    'TIMESTAMP\tRECEPTION NO.\tDEP NO\tDATE\tNARRATION\tGROSS AMOUNT\tPROJECT NAME\tDEPARTMENT\tNET AMOUNT'
                  }
                />
                <Button className="mt-2 gap-1.5" size="sm" onClick={readPaste} disabled={!pasted.trim()}>
                  Read the pasted rows <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void readFile(file);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileInput.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> Choose an .xlsx file
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void downloadTemplate()}>
                    <Download className="h-3.5 w-3.5" /> Download template
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  The template carries the headings this reads, an Instructions sheet documenting every
                  column, and the project and department names that will resolve.
                </p>
              </div>
            </>
          )}

          {step === 'preview' && result && (
            <>
              {/* Mapping. Shown even when everything matched, because "it guessed right" is only
                  believable if you can see what it guessed. */}
              <section>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Columns · {mappedCount} matched
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {REQUISITION_IMPORT_COLUMNS.map((column) => (
                    <div key={column.key} className="flex items-center gap-2">
                      <span className="w-[130px] shrink-0 text-[11px]">
                        {column.label}
                        {column.required && <span className="text-destructive"> *</span>}
                      </span>
                      <Select
                        value={columnMap[column.key] ?? '__none'}
                        onValueChange={(next) =>
                          setOverrides((current) => ({
                            ...current,
                            [column.key as RequisitionImportFieldKey]: next === '__none' ? undefined : next,
                          }))
                        }
                      >
                        <SelectTrigger
                          className={cn(
                            'h-7 flex-1 text-xs',
                            column.required && !columnMap[column.key] && 'border-destructive text-destructive',
                          )}
                        >
                          <SelectValue placeholder="Not in the file" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">Not in the file</SelectItem>
                          {(sheet?.headings ?? []).map((heading) => (
                            <SelectItem key={heading} value={heading}>
                              {heading}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                {result.unmappedHeadings.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Ignored: {result.unmappedHeadings.join(', ')}
                  </p>
                )}
                {missingRequired.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-destructive">
                    Still needed: {missingRequired.map((column) => column.label).join(', ')}
                  </p>
                )}
              </section>

              {/* Options */}
              <section className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Reception numbers
                  </Label>
                  <RadioGroup
                    value={receptionNoSource}
                    onValueChange={(next) => setReceptionNoSource(next as ReceptionNoSource)}
                    className="mt-1.5 space-y-1.5"
                  >
                    <label className="flex cursor-pointer items-start gap-2 text-xs">
                      <RadioGroupItem value="file" className="mt-0.5" />
                      <span>
                        From the file
                        <span className="block text-[11px] text-muted-foreground">
                          Keeps the numbers the register already has. The counter is left alone.
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-xs">
                      <RadioGroupItem value="generate" className="mt-0.5" />
                      <span>
                        Allocate new ones
                        <span className="block text-[11px] text-muted-foreground">
                          Takes a block from the serial configuration and advances it past them.
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <div>
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Status for every imported entry
                    </Label>
                    <Select value={status} onValueChange={(next) => setStatus(next as RequisitionStatus)}>
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {entry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      History that has already been paid should not land in the Finance queue as Pending.
                    </p>
                  </div>
                  {!columnMap.partyName && (
                    <label className="flex cursor-pointer items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={partyFromDescription}
                        onChange={(event) => setPartyFromDescription(event.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        Use the narration as the party name
                        <span className="block text-[11px] text-muted-foreground">
                          There is no party column. The party-analysis report groups on the party name.
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              </section>

              {/* Counts */}
              <section className="flex flex-wrap items-center gap-2 border-t pt-3">
                <Badge className="bg-emerald-600 hover:bg-emerald-600">{result.rows.length} will import</Badge>
                {result.issues.length > 0 && (
                  <Badge variant="outline" className="border-destructive/40 text-destructive">
                    {result.issues.length} rejected
                  </Badge>
                )}
                {result.duplicates.length > 0 && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                    {result.duplicates.length} already recorded
                  </Badge>
                )}
                <span className="ml-auto text-xs">
                  Gross <span className="font-semibold tabular-nums">{money(result.totalGross)}</span>
                  {result.totalNet !== result.totalGross && (
                    <>
                      {' · Net '}
                      <span className="font-semibold tabular-nums">{money(result.totalNet)}</span>
                    </>
                  )}
                </span>
              </section>

              {result.rows.length > 0 && (
                <section className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="whitespace-nowrap">Row</TableHead>
                        <TableHead className="whitespace-nowrap">Reception</TableHead>
                        <TableHead className="whitespace-nowrap">Dep No</TableHead>
                        <TableHead className="whitespace-nowrap">Date</TableHead>
                        <TableHead>Narration</TableHead>
                        <TableHead className="whitespace-nowrap">Project</TableHead>
                        <TableHead className="whitespace-nowrap">Dept</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Gross</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.rows.map((row) => (
                        <TableRow key={row.row}>
                          <TableCell className="text-[11px] text-muted-foreground">{row.row}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-[11px]">
                            {row.draft.receptionNo || <span className="text-muted-foreground">allocated</span>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[11px]">{row.draft.depNo || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-[11px]">
                            {new Date(row.draft.date).toLocaleDateString('en-IN')}
                          </TableCell>
                          <TableCell className="max-w-[240px] text-[11px]">
                            <span className="line-clamp-1">{row.draft.description}</span>
                            {row.warnings.map((warning) => (
                              <span key={warning} className="block text-[10px] text-amber-700">
                                {warning}
                              </span>
                            ))}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[11px]">{row.draft.projectName}</TableCell>
                          <TableCell className="whitespace-nowrap text-[11px]">{row.draft.departmentName}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-[11px] tabular-nums">
                            {money(row.draft.grossAmount)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-[11px] tabular-nums">
                            {money(row.draft.netAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              )}

              {(result.issues.length > 0 || result.duplicates.length > 0) && (
                <section className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Not importing
                    </p>
                    {/* The refused rows need fixing in the source register, and reading them off
                        the screen one at a time is how a correction pass gets abandoned half-done. */}
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => void downloadIssueReport()}>
                      <Download className="h-3 w-3" /> Download report
                    </Button>
                  </div>
                  {[...result.issues, ...result.duplicates].map((issue, index) => (
                    <p
                      key={`${issue.row}-${index}`}
                      className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
                    >
                      <span className="font-medium">Row {issue.row}</span>
                      {issue.field ? ` · ${issue.field}` : ''} — {issue.message}
                    </p>
                  ))}
                </section>
              )}

              {isImporting && (
                <Progress value={result.rows.length ? (progress / result.rows.length) * 100 : 0} className="h-2" />
              )}
            </>
          )}

          {step === 'summary' && summary && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              <p className="text-sm font-semibold">
                {summary.imported} entr{summary.imported === 1 ? 'y' : 'ies'} imported
              </p>
              <p className="text-xs text-muted-foreground">
                {money(summary.gross)} gross
                {summary.skipped > 0 && ` · ${summary.skipped} row${summary.skipped === 1 ? '' : 's'} skipped`}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="border-t px-4 py-3">
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('input')} disabled={isImporting}>
                Back
              </Button>
              <Button
                onClick={() => void runImport()}
                disabled={isImporting || !result?.rows.length || missingRequired.length > 0}
              >
                {isImporting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Import {result?.rows.length ?? 0} entr{(result?.rows.length ?? 0) === 1 ? 'y' : 'ies'}
              </Button>
            </>
          )}
          {step !== 'preview' && (
            <Button
              variant={step === 'summary' ? 'default' : 'outline'}
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              {step === 'summary' ? 'Done' : 'Cancel'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
