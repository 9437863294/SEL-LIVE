'use client';

/**
 * Excel Import (`/master-drawing-list/import`) — two kinds of workbook:
 *
 *   - A project's own MDL workbook, as the team keeps it (sheets such as Supply / Civil, a header
 *     row "SL NO | Description | … | R0_submission | comments date | … | Approval date | Status").
 *     The page reads every sheet, guesses each column (`workbook-import.ts`), and shows the guess
 *     to correct: which sheets to take, their schedule and scope, and what each column is. The rows
 *     go into a drawing list chosen here.
 *   - The consolidated workbook (Projects, Items and Revisions sheets), which creates its lists.
 *
 * Either way: a dry run on the server first (counts, statuses, rows it had to skip or correct),
 * then Import. Items already in the register are skipped, or replaced when asked if nobody has
 * edited them since they were imported.
 */

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BookmarkCheck, CheckCircle2, Download, FileSpreadsheet, FileUp, Layers, Loader2, Sparkles, TriangleAlert, Upload } from 'lucide-react';

import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { exportWorkbook } from '@/lib/report-excel';
import { OVERALL_STATUSES } from '@/lib/master-drawing-list/drawings';
import { ITEM_COLUMNS, PROJECT_COLUMNS, REVISION_COLUMNS, gridFromWorkbook, type ImportGrid } from '@/lib/master-drawing-list/import';
import type { ImportRecord, ImportResult } from '@/lib/master-drawing-list/server/import';
import { allNames } from '@/lib/master-drawing-list/settings';
import { STATUS_LABEL, type MdlSchedule, type MdlScope, type MdlStatus } from '@/lib/master-drawing-list/types';
import { COLUMN_ROLES, ROLE_LABEL, applyTemplates, detectSheet, parseProjectWorkbook, rawSheetsFromWorkbook, rolesForHeader, type ColumnRole, type MappingTemplate, type RawSheet, type SheetMapping } from '@/lib/master-drawing-list/workbook-import';
import { cn } from '@/lib/utils';

import { ImportHistory } from './import-history';
import { ImportValidation } from './import-validation';
import { mdlFetch, useMdl, useMdlQuery, useMdlSettings } from './mdl-client';
import { MdlError, ProjectSelect, StatCard } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';

const SHOWN = 50;
const DATE_STATUSES: MdlStatus[] = ['approved', 'under_review', 'comments_received', 'not_submitted', 'vendor_not_finalised'];
const colName = (index: number) => (index < 26 ? String.fromCharCode(65 + index) : `${String.fromCharCode(64 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`);

type Loaded =
  | { kind: 'consolidated'; fileName: string; grid: ImportGrid }
  | { kind: 'project'; fileName: string; sheets: RawSheet[]; mappings: SheetMapping[]; applied: (MappingTemplate | null)[] };

function Lines({ title, lines, tone }: { title: string; lines: string[]; tone: 'amber' | 'slate' }) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const shown = all ? lines : lines.slice(0, SHOWN);
  return (
    <div className={tone === 'amber' ? 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900' : 'rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700'}>
      <p className="flex items-center gap-2 font-medium">
        {tone === 'amber' && <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />}
        {title} ({lines.length.toLocaleString('en-IN')})
      </p>
      <ul className="mt-1.5 max-h-72 list-disc space-y-0.5 overflow-auto pl-6 [overflow-wrap:anywhere]">
        {shown.map((line, index) => (
          <li key={`${index}-${line}`}>{line}</li>
        ))}
      </ul>
      {lines.length > SHOWN && (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer' : `Show all ${lines.length.toLocaleString('en-IN')}`}
        </Button>
      )}
    </div>
  );
}

/** One sheet of a project workbook: take it or not, its schedule and scope, and what each column is. */
function SheetCard({ sheet, mapping, lists, applied, onChange, onUseDetected }: { sheet: RawSheet; mapping: SheetMapping; lists: { schedules: string[]; scopes: string[] }; applied: MappingTemplate | null; onChange: (next: SheetMapping) => void; onUseDetected: () => void }) {
  const header = sheet.rows.find((row) => row.n === mapping.headerRow)?.cells ?? [];
  const width = Math.max(header.length, mapping.columns.length);
  const sample = sheet.rows.filter((row) => row.n > mapping.headerRow && row.cells.some(Boolean)).slice(0, 4);
  const mapped = mapping.columns.map((role, index) => ({ role, index })).filter((entry) => entry.role !== 'ignore');
  const setRole = (index: number, role: ColumnRole) => {
    const columns = Array.from({ length: width }, (_, i) => mapping.columns[i] ?? 'ignore');
    // A role belongs to one column: picking it here frees it elsewhere.
    if (role !== 'ignore') for (let i = 0; i < columns.length; i += 1) if (columns[i] === role) columns[i] = 'ignore';
    columns[index] = role;
    onChange({ ...mapping, columns });
  };
  return (
    <Card className={cn('min-w-0', !mapping.include && 'opacity-70')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-0 items-center gap-2">
            <Checkbox checked={mapping.include} onCheckedChange={(checked) => onChange({ ...mapping, include: checked === true })} aria-label={`Import sheet ${sheet.name}`} />
            <span className="truncate font-semibold text-slate-800">{sheet.name.trim() || 'Untitled sheet'}</span>
          </label>
          <span className="text-xs text-muted-foreground">{sheet.rows.length.toLocaleString('en-IN')} rows</span>
          {mapping.include && !mapping.columns.includes('description') && <span className="text-xs font-medium text-rose-700">Mark the Description column</span>}
        </div>
        {applied && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <BookmarkCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              Saved mapping applied — confirmed by {applied.savedByName} on {new Date(applied.savedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} for “{applied.sheetName}” of {applied.fileName}.
            </span>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onUseDetected}>
              Use the detected layout
            </Button>
          </div>
        )}
        {mapping.include && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Header row</Label>
                <Input
                  type="number"
                  min={1}
                  value={mapping.headerRow}
                  onChange={(event) => {
                    const headerRow = Math.max(1, Number(event.target.value) || 1);
                    onChange({ ...mapping, headerRow, columns: rolesForHeader(sheet.rows.find((row) => row.n === headerRow)?.cells ?? []) });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Schedule</Label>
                <Select value={mapping.schedule} onValueChange={(schedule) => onChange({ ...mapping, schedule: schedule as MdlSchedule })}>
                  <SelectTrigger className="text-left">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.schedules.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Scope</Label>
                <Select value={mapping.scope} onValueChange={(scope) => onChange({ ...mapping, scope: scope as MdlScope })}>
                  <SelectTrigger className="text-left">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.scopes.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Columns</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: width }, (_, index) => ({ index, heading: header[index] })).filter((entry) => entry.heading || mapping.columns[entry.index] !== 'ignore').map(({ index, heading }) => (
                  <div key={index} className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/20 px-2 py-1.5">
                    <span className="w-6 shrink-0 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">{colName(index)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={heading ?? ''}>
                      {heading || '—'}
                    </span>
                    <Select value={mapping.columns[index] ?? 'ignore'} onValueChange={(role) => setRole(index, role as ColumnRole)}>
                      <SelectTrigger className={cn('h-8 w-40 shrink-0 text-left text-xs', (mapping.columns[index] ?? 'ignore') === 'ignore' && 'text-muted-foreground')} aria-label={`Column ${colName(index)} is`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {COLUMN_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {ROLE_LABEL(role)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
            {sample.length > 0 && mapped.length > 0 && (
              <div className="min-w-0">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">First rows, as they will be read</p>
                <Table containerClassName="rounded-lg border">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Row</TableHead>
                      {mapped.map(({ role, index }) => (
                        <TableHead key={index} className="whitespace-nowrap">
                          {ROLE_LABEL(role)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sample.map((row) => (
                      <TableRow key={row.n}>
                        <TableCell className="tabular-nums text-muted-foreground">{row.n}</TableCell>
                        {mapped.map(({ index }) => (
                          <TableCell key={index} className="max-w-[16rem] truncate">
                            {row.cells[index] ?? ''}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ExcelImport() {
  const { lookups, can, reload } = useMdl();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'reading' | 'previewing' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [remember, setRemember] = useState(true);
  const templates = useMdlQuery<{ templates: MappingTemplate[] }>('import/mappings');
  const history = useMdlQuery<{ imports: ImportRecord[] }>('import/history');
  const canImport = can('Import', 'Import');
  const { masterData } = useMdlSettings();
  const lists = { schedules: allNames(masterData.schedules), scopes: allNames(masterData.scopes) };
  const projects = lookups?.projects ?? [];
  const targetCode = target ?? projects[0]?.code ?? null;

  const body = (mode: 'preview' | 'import') => {
    if (!loaded) return null;
    if (loaded.kind === 'consolidated') return { mode, overwrite, fileName: loaded.fileName, grid: loaded.grid };
    return { mode, overwrite, rememberMappings: remember, source: { kind: 'project', projectCode: targetCode, fileName: loaded.fileName, sheets: loaded.sheets.filter((sheet) => loaded.mappings.some((m) => m.include && m.sheet === sheet.name)), mappings: loaded.mappings.filter((m) => m.include) } };
  };

  const runPreview = async (next: Loaded | null = loaded) => {
    if (!next) return;
    const payload = next === loaded ? body('preview') : null;
    setBusy('previewing');
    setError(null);
    setDone(null);
    try {
      const request = payload ?? (next.kind === 'consolidated' ? { mode: 'preview', overwrite: false, fileName: next.fileName, grid: next.grid } : null);
      if (!request) return;
      setPreview(await mdlFetch<ImportResult>('import', { body: request }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The dry run failed.');
    } finally {
      setBusy(null);
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setLoaded(null);
    setPreview(null);
    setDone(null);
    setError(null);
    setBusy('reading');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await file.arrayBuffer());
      const names = book.worksheets.map((ws) => ws.name.trim().toLowerCase());
      if (['projects', 'items', 'revisions'].every((name) => names.includes(name))) {
        const next: Loaded = { kind: 'consolidated', fileName: file.name, grid: gridFromWorkbook(book) };
        setLoaded(next);
        setBusy(null);
        await runPreview(next);
        return;
      }
      const sheets = rawSheetsFromWorkbook(book as unknown as Parameters<typeof rawSheetsFromWorkbook>[0]);
      const detected = sheets.map((sheet) => detectSheet(sheet, file.name, lists));
      const { mappings, applied } = applyTemplates(sheets, detected, templates.data?.templates ?? [], targetCode);
      setLoaded({ kind: 'project', fileName: file.name, sheets, mappings, applied });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The workbook could not be read.');
    } finally {
      setBusy((current) => (current === 'reading' ? null : current));
      if (input.current) input.current.value = '';
    }
  };

  const runImport = async () => {
    const payload = body('import');
    if (!payload) return;
    setBusy('importing');
    setError(null);
    try {
      const result = await mdlFetch<ImportResult>('import', { body: payload });
      setDone(result);
      toast({ title: 'Imported', description: `${result.written?.written ?? 0} items written, ${result.written?.skipped ?? 0} skipped.` });
      void reload();
      history.reload();
      templates.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The import failed.');
    } finally {
      setBusy(null);
    }
  };

  // The row check, live: the same reader the server runs on Import.
  const check = useMemo(
    () => (loaded?.kind === 'project' && targetCode ? parseProjectWorkbook(loaded.sheets, loaded.mappings.filter((m) => m.include), targetCode, loaded.fileName, { schedules: allNames(masterData.schedules), scopes: allNames(masterData.scopes) }) : null),
    [loaded, targetCode, masterData],
  );

  /** The rows to correct as a workbook: one line per problem, with the cell and its value. */
  const downloadErrorReport = async () => {
    if (!loaded) return;
    const columns = [
      { header: 'Sheet', key: 'sheet', width: 16 },
      { header: 'Row', key: 'row', width: 7 },
      { header: 'Sl. No.', key: 'slNo', width: 8 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Problem', key: 'problem', width: 55 },
      { header: 'Cell', key: 'cell', width: 10 },
      { header: 'Value in the workbook', key: 'value', width: 24 },
    ];
    const rows: Record<string, unknown>[] = [];
    if (loaded.kind === 'project' && check) {
      for (const row of check.rows) {
        const raw = loaded.sheets.find((sheet) => sheet.name === row.sheet)?.rows.find((entry) => entry.n === row.n);
        for (const issue of row.issues) {
          rows.push({
            sheet: row.sheet.trim(),
            row: row.n,
            slNo: row.slNo ?? '',
            description: row.description ?? '',
            problem: issue.text,
            cell: issue.cols.map((col) => `${String.fromCharCode(65 + col)}${row.n}`).join(', '),
            value: issue.cols.map((col) => raw?.cells[col] ?? '').filter(Boolean).join(' / '),
          });
        }
      }
    } else {
      for (const problem of (done ?? preview)?.summary.problems ?? []) rows.push({ sheet: '', row: '', slNo: '', description: '', problem, cell: '', value: '' });
    }
    await exportWorkbook(`MDL-rows-to-correct-${loaded.fileName.replace(/\.[^.]+$/, '')}.xlsx`, [{ name: 'Rows to correct', columns, rows }]);
  };

  const downloadTemplate = () =>
    void exportWorkbook('MDL-import-template.xlsx', [
      { name: 'Projects', columns: PROJECT_COLUMNS.map((header) => ({ header, key: header, width: Math.max(14, header.length + 4) })), rows: [] },
      { name: 'Items', columns: ITEM_COLUMNS.map((header) => ({ header, key: header, width: header === 'Description' ? 60 : Math.max(12, header.length + 4) })), rows: [] },
      { name: 'Revisions', columns: REVISION_COLUMNS.map((header) => ({ header, key: header, width: Math.max(12, header.length + 4) })), rows: [] },
    ]);

  const summary = (done ?? preview)?.summary;
  const sheetsResult = (done ?? preview)?.sheets;
  const included = loaded?.kind === 'project' ? loaded.mappings.filter((m) => m.include) : [];
  const projectReady = loaded?.kind === 'project' && targetCode && included.length > 0 && included.every((m) => m.columns.includes('description'));
  const targetProject = projects.find((project) => project.code === targetCode) ?? null;

  return (
    <>
      <PageHeader
        icon={FileUp}
        title="Excel Import"
        description="Bring a project's drawing list in from Excel — your own sheets as they are, or the consolidated workbook. You see a dry run first; nothing is written until you press Import."
        actions={
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Consolidated template
          </Button>
        }
      />

      <Card className="min-w-0">
        <CardContent className="p-4 sm:p-5">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void choose(event.dataTransfer.files?.[0]);
            }}
            className={cn('flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors', dragging ? 'border-primary bg-primary/5' : 'border-slate-200')}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FileSpreadsheet className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium text-slate-800">{loaded ? loaded.fileName : 'Drop the workbook here, or choose it'}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {loaded ? (loaded.kind === 'consolidated' ? 'Consolidated workbook: Projects, Items and Revisions sheets.' : `Project workbook: ${loaded.sheets.length} sheet${loaded.sheets.length === 1 ? '' : 's'} read; check the layout below.`) : '.xlsx or .xlsm — a project MDL such as Supply / Civil sheets, or the consolidated three-sheet file.'}
              </p>
            </div>
            <input ref={input} type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => void choose(event.target.files?.[0])} />
            <Button onClick={() => input.current?.click()} disabled={busy !== null}>
              {busy === 'reading' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
              {busy === 'reading' ? 'Reading…' : loaded ? 'Choose another workbook' : 'Choose workbook'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <MdlError message={error} />

      {loaded?.kind === 'project' && (
        <>
          <Card className="min-w-0">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <SectionHeader icon={Layers} title="Into which drawing list?" description="The rows of the sheets you take become items of this list. Create a list in Settings first if it is not here." />
              {projects.length ? (
                <ProjectSelect projects={projects} value={targetCode} onChange={setTarget} className="sm:w-72" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No drawing list yet.{' '}
                  {can('Settings', 'Manage') ? (
                    <Link href={`${MDL_BASE}/settings`} className="font-medium text-primary underline underline-offset-2">
                      Create one in Settings
                    </Link>
                  ) : (
                    'Ask an administrator to create one in Settings.'
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          <SectionHeader
            icon={Sparkles}
            title="Sheets and columns"
            description="Each sheet's header row, schedule, scope and columns are worked out from its headings. Correct anything that is wrong; rows without a Sl. No. and without dates become group headings."
          />
          <div className="space-y-3">
            {loaded.sheets.map((sheet, index) => (
              <SheetCard
                key={`${sheet.name}-${index}`}
                sheet={sheet}
                lists={lists}
                mapping={loaded.mappings[index]}
                applied={loaded.applied[index]}
                onChange={(next) => {
                  setPreview(null);
                  setDone(null);
                  setLoaded({ ...loaded, mappings: loaded.mappings.map((m, i) => (i === index ? next : m)) });
                }}
                onUseDetected={() => {
                  setPreview(null);
                  setDone(null);
                  setLoaded({ ...loaded, mappings: loaded.mappings.map((m, i) => (i === index ? detectSheet(sheet, loaded.fileName, lists) : m)), applied: loaded.applied.map((a, i) => (i === index ? null : a)) });
                }}
              />
            ))}
          </div>
          {check && (
            <ImportValidation
              rows={check.rows}
              sheets={loaded.sheets}
              mappings={loaded.mappings}
              onEditCell={(sheetName, n, col, value) => {
                setPreview(null);
                setDone(null);
                setLoaded({
                  ...loaded,
                  sheets: loaded.sheets.map((sheet) =>
                    sheet.name !== sheetName
                      ? sheet
                      : { ...sheet, rows: sheet.rows.map((row) => (row.n !== n ? row : { ...row, cells: Array.from({ length: Math.max(row.cells.length, col + 1) }, (_, i) => (i === col ? value.trim() || null : (row.cells[i] ?? null))) })) },
                  ),
                });
              }}
              onToggleSkip={(sheetName, n) => {
                setPreview(null);
                setDone(null);
                setLoaded({
                  ...loaded,
                  mappings: loaded.mappings.map((m) => {
                    if (m.sheet !== sheetName) return m;
                    const skip = new Set(m.skipRows ?? []);
                    if (skip.has(n)) skip.delete(n);
                    else skip.add(n);
                    return { ...m, skipRows: [...skip].sort((a, b) => a - b) };
                  }),
                });
              }}
            />
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">
              {included.length} of {loaded.sheets.length} sheet{loaded.sheets.length === 1 ? '' : 's'} taken{targetProject ? ` into ${targetProject.short}` : ''}.
            </span>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <Switch checked={remember} onCheckedChange={setRemember} aria-label="Remember these column mappings" />
              Remember these column mappings
            </label>
            <Button variant="outline" onClick={() => void downloadErrorReport()} disabled={!check || !check.rows.some((row) => row.issues.length)}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Rows to correct (.xlsx)
            </Button>
            <Button onClick={() => void runPreview()} disabled={!projectReady || busy !== null}>
              {busy === 'previewing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Dry run
            </Button>
          </div>
        </>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <StatCard label="Drawing lists" value={summary.projects.length} icon={Layers} tone="bg-slate-100 text-slate-700" />
            <StatCard label="Items" value={summary.itemCount.toLocaleString('en-IN')} icon={FileSpreadsheet} tone="bg-sky-100 text-sky-700" />
            <StatCard label="Revisions" value={summary.revisionCount.toLocaleString('en-IN')} icon={FileUp} tone="bg-indigo-100 text-indigo-700" />
            {DATE_STATUSES.map((status) => (
              <StatCard
                key={status}
                label={STATUS_LABEL[status]}
                value={summary.totals[status].toLocaleString('en-IN')}
                icon={status === 'approved' ? CheckCircle2 : TriangleAlert}
                tone={status === 'approved' ? 'bg-emerald-100 text-emerald-700' : status === 'under_review' ? 'bg-blue-100 text-blue-700' : status === 'comments_received' ? 'bg-amber-100 text-amber-700' : status === 'vendor_not_finalised' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}
              />
            ))}
          </div>

          <Card className="min-w-0">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <SectionHeader title={done ? 'Imported' : 'Dry run'} description={done ? 'What the import read and wrote.' : 'What the import would write. Nothing has been written yet.'} />
              <p className="text-sm text-muted-foreground">
                The figures above are the workbook&apos;s statuses, read from its dates. In the register each item gets an overall status:{' '}
                {OVERALL_STATUSES.filter((status) => summary.overall[status]).map((status, index) => (
                  <span key={status}>
                    {index ? ' · ' : ''}
                    <b className="font-medium text-slate-700">{status}</b> {summary.overall[status].toLocaleString('en-IN')}
                  </span>
                ))}
                . Each round&apos;s status is set from its dates too, and can be changed in the register.
              </p>
              {sheetsResult?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sheet</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Group headings</TableHead>
                      <TableHead className="text-right">Revisions</TableHead>
                      <TableHead>Schedule / scope switches</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheetsResult.map((sheet) => (
                      <TableRow key={sheet.sheet}>
                        <TableCell className="font-medium">{sheet.sheet}</TableCell>
                        <TableCell className="text-right tabular-nums">{sheet.items}</TableCell>
                        <TableCell className="text-right tabular-nums">{sheet.groups}</TableCell>
                        <TableCell className="text-right tabular-nums">{sheet.revisions}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{sheet.sections?.length ? sheet.sections.join('; ') : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Drawing list</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      {DATE_STATUSES.map((status) => (
                        <TableHead key={status} className="text-right">
                          {STATUS_LABEL[status]}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.projects.map((project) => (
                      <TableRow key={project.code}>
                        <TableCell className="whitespace-nowrap font-medium">{project.code}</TableCell>
                        <TableCell className="min-w-[12rem]">
                          <span className="font-medium">{project.short}</span>
                          <span className="block text-xs text-muted-foreground">{project.name}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{project.items.toLocaleString('en-IN')}</TableCell>
                        {DATE_STATUSES.map((status) => (
                          <TableCell key={status} className="text-right tabular-nums">
                            {project.counts[status].toLocaleString('en-IN')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Lines title="Entries to correct — left blank and kept on the item" lines={summary.problems} tone="amber" />
              <Lines title="Items whose status differs from the workbook's own status column" lines={summary.differs} tone="slate" />

              {done?.written ? (
                <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    {done.written.projects ? `Wrote ${done.written.projects} drawing list${done.written.projects === 1 ? '' : 's'} and ` : 'Wrote '}
                    {done.written.written.toLocaleString('en-IN')} items. Skipped {done.written.skipped.toLocaleString('en-IN')} already in the register.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={`${MDL_BASE}/register${loaded?.kind === 'project' && targetCode ? `?project=${encodeURIComponent(targetCode)}` : ''}`}>Open the register</Link>
                    </Button>
                    {loaded?.kind === 'consolidated' && can('Settings', 'View') && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`${MDL_BASE}/settings`}>Link to ERP projects</Link>
                      </Button>
                    )}
                  </div>
                </div>
              ) : canImport ? (
                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Switch id="mdl-import-overwrite" checked={overwrite} onCheckedChange={setOverwrite} />
                    <Label htmlFor="mdl-import-overwrite" className="font-normal leading-snug">
                      Replace items imported before, if nobody has edited them in the ERP since
                    </Label>
                  </div>
                  <Button onClick={() => void runImport()} disabled={busy !== null || !summary.itemCount}>
                    {busy === 'importing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Import {summary.itemCount.toLocaleString('en-IN')} items
                  </Button>
                </div>
              ) : (
                <p className="border-t pt-4 text-sm text-muted-foreground">You may preview a workbook. Importing it needs Master Drawing List · Import · Import.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ImportHistory records={history.data?.imports ?? []} loading={history.loading} onChanged={history.reload} />
    </>
  );
}
