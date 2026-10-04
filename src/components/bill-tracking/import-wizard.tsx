'use client';

/**
 * Excel import wizard (`/bill-tracking/import`).
 *
 *   1 Upload → 2 Sheet & headings → 3 Map columns → 4 Validate (projects, dates, numbers,
 *   duplicates, financial check) → 5 Import → result
 *
 * The browser only reads the workbook into plain cells. Validation, duplicate detection and the
 * financial check run on the server against the live masters, and nothing is written until the
 * user confirms the preview. The import then runs in chunks with a progress bar; if it stops
 * halfway the job page shows what was imported, what failed and what is pending, and resumes.
 */

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, History, Loader2, Upload, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { useToast } from '@/hooks/use-toast';
import { IMPORT_COLUMNS, LEGACY_TEMPLATE_HEADERS, SIMPLIFIED_TEMPLATE_KEYS, cellText, detectHeaderRow, readSheetLayout, type ImportCell, type ImportColumnMap, type ImportFieldKey } from '@/lib/bill-tracking/import';
import { pickBillSheet, sha256Hex, worksheetToGrid, type WorksheetLike } from '@/lib/bill-tracking/workbook';
import type { BillImportJob, ImportReconciliationTotals, ImportRowAction } from '@/lib/bill-tracking/types';
import type { ImportPreview, PreviewRow } from '@/lib/bill-tracking/server/import-service';
import { exportWorkbook } from '@/lib/report-excel';
import { cn } from '@/lib/utils';

import { btFetch, useBt, useLookups } from './bt-client';
import { Amount, BtError, Notice, dateText, downloadCsv } from './bt-ui';

type Step = 1 | 2 | 3 | 4 | 5 | 6;
const STEPS = ['Upload', 'Sheet', 'Map columns', 'Validate & preview', 'Import', 'Result'];

interface WorkbookState {
  file: File;
  checksum: string;
  sheets: { name: string; grid: ImportCell[][] }[];
}

export default function ImportWizard() {
  const lookups = useLookups();
  const { can } = useBt();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [workbook, setWorkbook] = useState<WorkbookState | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [projectOverrides, setProjectOverrides] = useState<Record<string, string>>({});
  const [confirmedFuzzy, setConfirmedFuzzy] = useState<string[]>([]);
  const [rowActions, setRowActions] = useState<Record<string, ImportRowAction>>({});
  const [rememberMappings, setRememberMappings] = useState(true);
  const [addUnknownBillTypes, setAddUnknownBillTypes] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<BillImportJob | null>(null);
  const [rowFilter, setRowFilter] = useState<'all' | 'error' | 'warning' | 'duplicate'>('all');

  const sheet = workbook?.sheets.find((entry) => entry.name === sheetName);
  const layout = useMemo(() => (sheet ? readSheetLayout(sheet.grid, headerRow) : null), [sheet, headerRow]);
  const columnMap: ImportColumnMap = useMemo(() => {
    const map: ImportColumnMap = { ...(layout?.columnMap ?? {}) };
    for (const [key, index] of Object.entries(overrides)) {
      for (const [other, value] of Object.entries(map)) if (value === index && other !== key) delete map[other as ImportFieldKey];
      if (index < 0) delete map[key as ImportFieldKey];
      else map[key as ImportFieldKey] = index;
    }
    return map;
  }, [layout, overrides]);

  /* step 1 */
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('Reading workbook…');
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const ExcelJS = (await import('exceljs')).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(buffer);
      const sheets = book.worksheets.map((worksheet) => ({ name: worksheet.name, grid: worksheetToGrid(worksheet as unknown as WorksheetLike) }));
      if (!sheets.length) throw new Error('The workbook has no sheets.');
      const chosen = pickBillSheet(sheets.map((entry) => entry.name)) ?? sheets[0].name;
      setWorkbook({ file, checksum: await sha256Hex(buffer), sheets });
      setSheetName(chosen);
      setHeaderRow(detectHeaderRow(sheets.find((entry) => entry.name === chosen)?.grid ?? []));
      setOverrides({});
      setPreview(null);
      setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? `Could not read the workbook: ${caught.message}` : 'Could not read the workbook.');
    } finally {
      setBusy(null);
    }
  };

  /* step 4 */
  const payload = (extra: Record<string, unknown> = {}) => ({
    fileName: workbook?.file.name ?? 'workbook.xlsx',
    fileSize: workbook?.file.size,
    checksum: workbook?.checksum,
    sheetName,
    headerRow,
    columnOverrides: overrides,
    // Columns past the last heading are never read; trimming them keeps the request small.
    grid: (sheet?.grid ?? []).map((row) => row.slice(0, Math.max(layout?.headings.length ?? 0, 1))),
    projectOverrides,
    confirmedFuzzy,
    rowActions,
    ...extra,
  });

  const runPreview = async (next: { projectOverrides?: Record<string, string>; confirmedFuzzy?: string[]; rowActions?: Record<string, ImportRowAction> } = {}) => {
    setBusy('Validating against SEL LIVE…');
    setError(null);
    try {
      const result = await btFetch<ImportPreview>('import/preview', { body: { ...payload(), ...next } });
      setPreview(result);
      setStep(4);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Validation failed.');
    } finally {
      setBusy(null);
    }
  };

  const updateProject = (key: string, projectId: string) => {
    const next = { ...projectOverrides, [key]: projectId };
    setProjectOverrides(next);
    void runPreview({ projectOverrides: next });
  };
  const confirmFuzzy = (key: string, on: boolean) => {
    const next = on ? [...new Set([...confirmedFuzzy, key])] : confirmedFuzzy.filter((entry) => entry !== key);
    setConfirmedFuzzy(next);
    void runPreview({ confirmedFuzzy: next });
  };
  const setActions = (rows: PreviewRow[], action: ImportRowAction) => {
    const next = { ...rowActions };
    rows.forEach((row) => (next[String(row.row)] = action));
    setRowActions(next);
    void runPreview({ rowActions: next });
  };

  /* step 5 */
  const runImport = async () => {
    setStep(5);
    setError(null);
    try {
      setBusy('Creating the import job…');
      const started = await btFetch<{ jobId: string }>('import/start', { body: payload({ rememberMappings, addUnknownBillTypes }) });
      if (workbook) {
        setBusy('Keeping the original workbook with the job…');
        const form = new FormData();
        form.set('file', workbook.file);
        await btFetch(`import/jobs/${started.jobId}/file`, { form }).catch(() => toast({ title: 'The original file could not be stored', description: 'The import continues; the rows themselves are kept with the job.', variant: 'destructive' }));
      }
      for (let guard = 0; guard < 500; guard += 1) {
        setBusy('Importing…');
        const result: { job: BillImportJob; processed: number } = await btFetch(`import/jobs/${started.jobId}/process`, { body: { chunkSize: 40 } });
        setJob(result.job);
        if (result.job.rowsPending === 0 || result.processed === 0) break;
      }
      setStep(6);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed.');
    } finally {
      setBusy(null);
    }
  };

  const downloadTemplate = async (kind: 'legacy' | 'simple') => {
    const headers = kind === 'legacy' ? LEGACY_TEMPLATE_HEADERS : SIMPLIFIED_TEMPLATE_KEYS.map((key) => IMPORT_COLUMNS.find((column) => column.key === key)?.label ?? key);
    await exportWorkbook(kind === 'legacy' ? 'Bill Tracking import template (legacy).xlsx' : 'Bill Tracking import template (simplified).xlsx', [{ name: 'Bill Tracking', columns: headers.map((header, index) => ({ header, key: `c${index}`, width: Math.max(12, Math.min(header.length + 4, 36)) })), rows: [] }]);
  };

  if (!can('Import', 'Import')) {
    return <Notice tone="rose" title="Import needs permission">You can view import history, but importing a workbook needs Bill Tracking · Import.</Notice>;
  }

  const filteredRows = (preview?.rows ?? []).filter((row) => (rowFilter === 'all' ? true : rowFilter === 'duplicate' ? row.duplicate.kind !== 'new' : row.validation === rowFilter));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FileSpreadsheet}
        title="Import Bill Tracking workbook"
        description="Bring in the finance team’s BILL TRACKING workbook (or any sheet with the same headings). Nothing is saved until you confirm the preview."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate('legacy')}>
              Download import template
            </Button>
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate('simple')}>
              Simplified template
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/bill-tracking/import/history">
                <History className="h-4 w-4" /> History
              </Link>
            </Button>
          </div>
        }
      />

      <ol className="flex flex-wrap gap-1.5" aria-label="Import steps">
        {STEPS.map((label, index) => {
          const number = (index + 1) as Step;
          return (
            <li key={label} className={cn('rounded-full border px-3 py-1 text-xs font-medium', number === step ? 'border-emerald-600 bg-emerald-600 text-white' : number < step ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500')} aria-current={number === step ? 'step' : undefined}>
              {number}. {label}
            </li>
          );
        })}
      </ol>

      <BtError message={error} />
      {busy ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> {busy}
        </div>
      ) : null}

      {step === 1 ? (
        <Card className="border-white/60 bg-white/85 shadow-sm">
          <CardContent className="p-6">
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-6 py-14 text-center hover:border-emerald-400"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void readFile(event.dataTransfer.files?.[0]);
              }}
            >
              <Upload className="h-10 w-10 text-emerald-600" />
              <span className="font-medium text-slate-800">Drop the .xlsx here, or click to choose</span>
              <span className="max-w-lg text-sm text-muted-foreground">The “Bill Tracking” sheet is picked automatically. Report sheets (QUERY / IMPORTRANGE formulas) are ignored — SEL LIVE rebuilds those reports from the data.</span>
              <input type="file" accept=".xlsx" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])} />
            </label>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 && workbook ? (
        <Card className="border-white/60 bg-white/85 shadow-sm">
          <CardContent className="space-y-4 p-4">
            <SectionHeader title="Sheet and heading row" as="h3" description={`${workbook.file.name} · ${(workbook.file.size / 1024).toFixed(0)} KB · ${workbook.sheets.length} sheets`} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Sheet</Label>
                <Select
                  value={sheetName}
                  onValueChange={(value) => {
                    setSheetName(value);
                    setHeaderRow(detectHeaderRow(workbook.sheets.find((entry) => entry.name === value)?.grid ?? []));
                    setOverrides({});
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workbook.sheets.map((entry) => (
                      <SelectItem key={entry.name} value={entry.name}>
                        {entry.name} ({entry.grid.length} rows)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Headings are on row</Label>
                <Select value={String(headerRow)} onValueChange={(value) => setHeaderRow(Number(value))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 15 }, (_, index) => index + 1).map((row) => (
                      <SelectItem key={row} value={String(row)}>
                        Row {row}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <p className="font-medium text-slate-700">Headings found ({layout?.headings.filter(Boolean).length ?? 0}):</p>
              <p className="mt-1 text-slate-600">{layout?.headings.filter(Boolean).join(' · ') || 'None — pick another row.'}</p>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)} disabled={!layout?.headings.filter(Boolean).length}>
                Next: map columns
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 && layout ? (
        <Card className="border-white/60 bg-white/85 shadow-sm">
          <CardContent className="space-y-4 p-4">
            <SectionHeader title="Map columns" as="h3" description="Matched automatically by heading (case, spacing and punctuation ignored). Change any that are wrong." />
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {IMPORT_COLUMNS.map((column) => {
                const index = columnMap[column.key];
                return (
                  <div key={column.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                    <span className="truncate text-sm">
                      {column.label}
                      {column.required ? <span className="text-rose-600"> *</span> : null}
                    </span>
                    <Select value={index === undefined ? 'none' : String(index)} onValueChange={(value) => setOverrides((current) => ({ ...current, [column.key]: value === 'none' ? -1 : Number(value) }))}>
                      <SelectTrigger className={cn('h-8 text-xs', index === undefined && column.required && 'border-rose-400')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="none">— not in this sheet —</SelectItem>
                        {layout.headings.map((heading, headingIndex) =>
                          heading ? (
                            <SelectItem key={headingIndex} value={String(headingIndex)}>
                              {heading}
                            </SelectItem>
                          ) : null,
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={() => void runPreview()} disabled={Boolean(busy) || columnMap.project === undefined || columnMap.billDate === undefined}>
                Validate
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 && preview ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {[
              ['Rows detected', preview.summary.detected, 'text-slate-800'],
              ['Valid', preview.summary.valid, 'text-emerald-700'],
              ['Warnings', preview.summary.warning, 'text-amber-700'],
              ['Errors', preview.summary.error, 'text-rose-700'],
              ['Exact duplicates', preview.summary.duplicateExact, 'text-slate-700'],
              ['Possible duplicates', preview.summary.duplicatePossible, 'text-amber-700'],
              ['Receipts to create', preview.summary.receipts, 'text-teal-700'],
              ['Undecided', preview.summary.undecided, 'text-rose-700'],
            ].map(([label, value, tone]) => (
              <div key={label as string} className="rounded-xl border border-white/60 bg-white/85 p-3 shadow-sm">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={`text-lg font-semibold ${tone}`}>{value as number}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {preview.blankRows} blank or template rows were ignored
            {preview.staleRows.length ? `, including ${preview.staleRows.length} that only held old formula results (rows ${preview.staleRows.map((row) => row.row).join(', ')})` : ''}.
          </p>

          {preview.missingRequired.length ? <Notice tone="rose" title="Required columns are not mapped">{preview.missingRequired.join(', ')}</Notice> : null}

          <ProjectMapper preview={preview} projectOverrides={projectOverrides} confirmedFuzzy={confirmedFuzzy} onProject={updateProject} onConfirm={confirmFuzzy} remember={rememberMappings} onRemember={setRememberMappings} />

          {preview.unknownBillTypes.length ? (
            <Card className="border-amber-200 bg-amber-50/70">
              <CardContent className="space-y-2 p-4 text-sm">
                <p className="font-semibold text-amber-900">Bill types not in the master: {preview.unknownBillTypes.join(', ')}</p>
                <label className="flex items-center gap-2">
                  <Checkbox checked={addUnknownBillTypes} onCheckedChange={(value) => setAddUnknownBillTypes(Boolean(value))} />
                  Add them to the Bill Type master on import (category inferred from the name; editable in Settings)
                </label>
              </CardContent>
            </Card>
          ) : null}

          <FinancialPanel excel={preview.excelTotals} calculated={preview.calculatedTotals} tolerance={lookups.config.settings.tolerance} />

          <Card className="border-white/60 bg-white/85 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <SectionHeader
                title="Preview"
                as="h3"
                description="Click a row's status to see its issues. Choose what happens to each duplicate."
                actions={
                  <div className="flex flex-wrap gap-2">
                    <Select value={rowFilter} onValueChange={(value) => setRowFilter(value as typeof rowFilter)}>
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All rows</SelectItem>
                        <SelectItem value="error">Errors only</SelectItem>
                        <SelectItem value="warning">Warnings only</SelectItem>
                        <SelectItem value="duplicate">Duplicates only</SelectItem>
                      </SelectContent>
                    </Select>
                    {preview.summary.duplicateExact + preview.summary.duplicatePossible > 0 ? (
                      <>
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setActions(preview.rows.filter((row) => row.duplicate.kind !== 'new'), 'skip')}>
                          Skip all duplicates
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setActions(preview.rows.filter((row) => row.duplicate.existingBillId), 'update')}>
                          Update all existing
                        </Button>
                      </>
                    ) : null}
                    {preview.summary.error > 0 ? (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setActions(preview.rows.filter((row) => row.validation === 'error'), 'skip')}>
                        Skip rows with errors
                      </Button>
                    ) : null}
                  </div>
                }
              />
              <ImportPreviewTable rows={filteredRows} onAction={(row, action) => setActions([row], action)} />
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" onClick={() => setStep(3)}>
              Back to mapping
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {preview.summary.toImport} new · {preview.summary.toUpdate} update · {preview.summary.toSkip} skip
              </span>
              <Button onClick={() => void runImport()} disabled={Boolean(busy) || preview.summary.undecided > 0 || preview.rows.some((row) => row.action !== 'skip' && row.validation === 'error') || preview.summary.toImport + preview.summary.toUpdate === 0}>
                Confirm & import
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 5 ? (
        <Card className="border-white/60 bg-white/85 shadow-sm">
          <CardContent className="space-y-3 p-6">
            <SectionHeader title="Importing" as="h3" description="Rows are written in small batches. You can leave this page — the job resumes from History." />
            {job ? (
              <>
                <Progress value={((job.rowsImported + job.rowsUpdated + job.rowsFailed) / Math.max(1, job.rowsImported + job.rowsUpdated + job.rowsFailed + job.rowsPending)) * 100} />
                <p className="text-sm text-muted-foreground">
                  {job.rowsImported} imported · {job.rowsUpdated} updated · {job.rowsFailed} failed · {job.rowsPending} pending
                </p>
              </>
            ) : (
              <Progress value={2} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {step === 6 && job ? <ImportResult job={job} /> : null}
    </div>
  );
}

function ProjectMapper({
  preview,
  projectOverrides,
  confirmedFuzzy,
  onProject,
  onConfirm,
  remember,
  onRemember,
}: {
  preview: ImportPreview;
  projectOverrides: Record<string, string>;
  confirmedFuzzy: string[];
  onProject: (key: string, projectId: string) => void;
  onConfirm: (key: string, on: boolean) => void;
  remember: boolean;
  onRemember: (value: boolean) => void;
}) {
  const lookups = useLookups();
  const needsAction = preview.projects.filter((project) => project.kind === 'unmatched' || (project.kind === 'fuzzy' && !confirmedFuzzy.includes(project.key)));
  return (
    <Card className={cn('shadow-sm', needsAction.length ? 'border-amber-300 bg-amber-50/40' : 'border-white/60 bg-white/85')}>
      <CardContent className="space-y-3 p-4">
        <SectionHeader
          title={`Project mapping (${preview.projects.length} names in the workbook)`}
          as="h3"
          description={needsAction.length ? `${needsAction.length} need your confirmation — similar names are suggested but never merged silently.` : 'Every project name is mapped.'}
          actions={
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={remember} onCheckedChange={(value) => onRemember(Boolean(value))} /> Remember mappings for future imports
            </label>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Excel project</th>
                <th className="px-3 py-2 text-left">Rows</th>
                <th className="px-3 py-2 text-left">SEL LIVE project</th>
                <th className="px-3 py-2 text-left">Match</th>
              </tr>
            </thead>
            <tbody>
              {preview.projects.map((project) => {
                const confirmed = confirmedFuzzy.includes(project.key);
                return (
                  <tr key={project.key} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{project.excelName}</td>
                    <td className="px-3 py-2">{project.rows}</td>
                    <td className="px-3 py-2">
                      <Select value={projectOverrides[project.key] ?? project.project?.id ?? 'none'} onValueChange={(value) => value !== 'none' && onProject(project.key, value)}>
                        <SelectTrigger className="h-8 min-w-[220px] text-xs">
                          <SelectValue placeholder="Choose project" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value="none">— choose —</SelectItem>
                          {project.candidates.map((candidate) => (
                            <SelectItem key={`c-${candidate.id}`} value={candidate.id}>
                              {candidate.name} · {Math.round(candidate.score * 100)}% similar
                            </SelectItem>
                          ))}
                          {lookups.projects
                            .filter((entry) => !project.candidates.some((candidate) => candidate.id === entry.id))
                            .map((entry) => (
                              <SelectItem key={entry.id} value={entry.id}>
                                {entry.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      {project.kind === 'exact' ? (
                        <StatusBadge tone="success">Exact</StatusBadge>
                      ) : project.kind === 'remembered' ? (
                        <StatusBadge tone="success">Remembered</StatusBadge>
                      ) : project.kind === 'override' ? (
                        <StatusBadge tone="info">Chosen</StatusBadge>
                      ) : project.kind === 'fuzzy' ? (
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox checked={confirmed} onCheckedChange={(value) => onConfirm(project.key, Boolean(value))} />
                          <span className={confirmed ? 'text-emerald-700' : 'font-medium text-amber-800'}>{confirmed ? 'Confirmed' : `Confirm (${Math.round(project.score * 100)}% similar)`}</span>
                        </label>
                      ) : (
                        <StatusBadge tone="danger">Not mapped</StatusBadge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {lookups.projects.length === 0 ? <Notice tone="rose">No projects are available to you. Imports can only post to projects in your Bill Tracking scope.</Notice> : null}
      </CardContent>
    </Card>
  );
}

export function FinancialPanel({ excel, calculated, tolerance, liveLabel = 'Calculated' }: { excel: ImportReconciliationTotals; calculated: ImportReconciliationTotals; tolerance: number; liveLabel?: string }) {
  const rows: [string, keyof ImportReconciliationTotals][] = [
    ['Bills', 'bills'],
    ['Taxable', 'taxable'],
    ['GST', 'gst'],
    ['Gross', 'gross'],
    ['Deduction', 'deduction'],
    ['Net', 'net'],
    ['Received', 'received'],
    ['Outstanding', 'outstanding'],
    ['Retention', 'retention'],
  ];
  return (
    <Card className="border-white/60 bg-white/85 shadow-sm">
      <CardContent className="space-y-2 p-4">
        <SectionHeader title="Financial validation" as="h3" description={`Workbook figures (its own Net, Total Deduction and Shortfall columns) against SEL LIVE’s calculation, over the rows selected for import. Tolerance ₹${tolerance}.`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2 text-right">Excel</th>
                <th className="px-3 py-2 text-right">{liveLabel}</th>
                <th className="px-3 py-2 text-right">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, key]) => {
                const difference = Math.round((calculated[key] - excel[key]) * 100) / 100;
                return (
                  <tr key={key} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{label}</td>
                    <td className="px-3 py-1.5 text-right">{key === 'bills' ? excel[key] : <Amount value={excel[key]} />}</td>
                    <td className="px-3 py-1.5 text-right">{key === 'bills' ? calculated[key] : <Amount value={calculated[key]} />}</td>
                    <td className={cn('px-3 py-1.5 text-right', Math.abs(difference) > tolerance ? 'font-semibold text-amber-700' : 'text-muted-foreground')}>{key === 'bills' ? difference : <Amount value={difference} signed />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportPreviewTable({ rows, onAction }: { rows: PreviewRow[]; onAction: (row: PreviewRow, action: ImportRowAction) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No rows match this filter.</p>;
  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            {['Row', 'Bill No', 'Invoice', 'Date', 'Project', 'Type', 'Taxable', 'GST', 'Deduction', 'Net', 'Received', 'Status', 'Validation', 'Action'].map((heading) => (
              <th key={heading} className={cn('whitespace-nowrap px-2 py-2', ['Taxable', 'GST', 'Deduction', 'Net', 'Received'].includes(heading) ? 'text-right' : 'text-left')}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.row}>
              <tr className={cn('border-t border-slate-100', row.validation === 'error' && 'bg-rose-50/60', row.action === 'skip' && 'opacity-60')}>
                <td className="px-2 py-1.5">{row.row}</td>
                <td className="px-2 py-1.5">{row.billSerialNumber ?? '—'}</td>
                <td className="px-2 py-1.5">{row.gstInvoiceNumber ?? 'NA'}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{dateText(row.billDate)}</td>
                <td className="max-w-[180px] truncate px-2 py-1.5" title={row.projectExcelName}>
                  {row.projectName ?? <span className="text-rose-700">{row.projectExcelName || '—'}</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">{row.billTypeName ?? '—'}</td>
                <td className="px-2 py-1.5 text-right">
                  <Amount value={row.taxableAmount} signed />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Amount value={row.gstAmount} signed />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Amount value={row.calculated.totalDeduction} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Amount value={row.calculated.net} signed />
                  {row.netMismatch ? <div className="text-[10px] text-amber-700">sheet {row.imported.netAmount}</div> : null}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Amount value={row.calculated.received} />
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {row.calculated.status.replace(/_/g, ' ')}
                  {row.legacyStatus ? <div className={cn('text-[10px]', row.statusMismatch ? 'text-amber-700' : 'text-muted-foreground')}>sheet: {row.legacyStatus}</div> : null}
                </td>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => setOpen(open === row.row ? null : row.row)} className="inline-flex items-center gap-1" aria-expanded={open === row.row}>
                    {row.validation === 'error' ? <XCircle className="h-4 w-4 text-rose-600" /> : row.validation === 'warning' ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    {row.duplicate.kind !== 'new' ? <StatusBadge tone={row.duplicate.kind === 'exact' ? 'neutral' : 'warning'}>{row.duplicate.kind === 'exact' ? 'Duplicate' : 'Possible dup.'}</StatusBadge> : null}
                    {row.issues.length ? <span className="text-[10px] text-muted-foreground">{row.issues.length}</span> : null}
                  </button>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    aria-label={`Action for row ${row.row}`}
                    value={row.action}
                    onChange={(event) => onAction(row, event.target.value as ImportRowAction)}
                    className={cn('h-7 rounded border px-1 text-xs', row.action === 'review' ? 'border-rose-400 bg-rose-50' : 'border-input bg-background')}
                  >
                    {row.action === 'review' ? <option value="review">Review…</option> : null}
                    <option value="import">{row.duplicate.kind === 'new' ? 'Import' : 'Import as new'}</option>
                    <option value="skip">Skip</option>
                    {row.duplicate.existingBillId ? <option value="update">Update existing</option> : null}
                  </select>
                </td>
              </tr>
              {open === row.row ? (
                <tr className="bg-slate-50">
                  <td colSpan={14} className="px-4 py-2">
                    {row.duplicate.reason ? (
                      <p className="text-xs text-slate-700">
                        <b>Duplicate:</b> {row.duplicate.reason}
                        {row.duplicate.existingBillId ? (
                          <>
                            {' '}
                            <Link className="text-emerald-700 hover:underline" href={`/bill-tracking/bills/${row.duplicate.existingBillId}`} target="_blank">
                              Open existing bill
                            </Link>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {row.issues.length ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                        {row.issues.map((issue, index) => (
                          <li key={index} className={issue.level === 'error' ? 'text-rose-700' : 'text-amber-800'}>
                            {issue.message}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-emerald-700">No issues.</p>
                    )}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportResult({ job }: { job: BillImportJob }) {
  const failed = job.rowsFailed;
  return (
    <Card className="border-white/60 bg-white/85 shadow-sm">
      <CardContent className="space-y-4 p-6">
        <SectionHeader title={job.status === 'completed' ? 'Import complete' : job.status === 'partial' ? 'Import finished with failures' : 'Import paused'} as="h3" description={`${job.jobNumber} · ${job.fileName}`} />
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Rows detected', job.rowsDetected],
            ['Imported', job.rowsImported],
            ['Updated', job.rowsUpdated],
            ['Skipped', job.rowsSkipped],
            ['Warnings', job.rowsWarning],
            ['Failed', job.rowsFailed],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border border-slate-200 bg-white p-3">
              <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold">{value as number}</dd>
            </div>
          ))}
        </dl>
        {failed ? <Notice tone="rose">Some rows failed. Open the job to see why, fix the cause, and retry them.</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/bill-tracking/import/${job.id}/reconciliation`}>Open reconciliation</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/bill-tracking/import/${job.id}`}>Job details{failed ? ' & failed rows' : ''}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/bill-tracking/bills">Go to bill register</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Error rows as a CSV, for fixing in Excel and re-importing. */
export function downloadErrorRows(rows: { row: number; cells: ImportCell[]; error?: string; issues: { level: string; message: string }[]; state: string }[], headings: string[], fileName: string) {
  const bad = rows.filter((row) => row.state === 'failed' || row.issues.some((issue) => issue.level === 'error'));
  downloadCsv({
    title: 'Error rows',
    fileName,
    rows: bad,
    columns: [
      { key: 'row', label: 'Sheet Row', value: (row) => row.row },
      { key: 'problem', label: 'Problem', value: (row) => [row.error, ...row.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message)].filter(Boolean).join(' | ') },
      ...headings.map((heading, index) => ({ key: `c${index}`, label: heading || `Column ${index + 1}`, value: (row: (typeof bad)[number]) => cellText(row.cells[index]) })),
    ],
  });
}
