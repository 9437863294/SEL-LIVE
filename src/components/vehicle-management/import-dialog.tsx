'use client';

import { useState, useRef, useCallback } from 'react';
import ExcelJS from 'exceljs';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Public types                                                         */
/* ------------------------------------------------------------------ */

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  /** Hint shown in the mapping step. */
  hint?: string;
  /** Coerce value to number before passing to onSaveRow. */
  type?: 'string' | 'number' | 'date';
  /** Return an error string, or null if valid. */
  validate?: (value: string) => string | null;
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display title inside the dialog. */
  title: string;
  /** Ordered field definitions used for mapping + validation. */
  fields: ImportField[];
  /** Called once per valid row. Throw to mark that row as failed. */
  onSaveRow: (row: Record<string, any>) => Promise<void>;
  /** Called after the import run finishes so the parent can refresh. */
  onImportComplete?: () => void;
}

/* ------------------------------------------------------------------ */
/* Internal types                                                       */
/* ------------------------------------------------------------------ */

type Step = 'upload' | 'map' | 'preview' | 'summary';
type FilterMode = 'all' | 'valid' | 'invalid';

interface ParsedRow {
  /** 1-based spreadsheet row number (header = 1, first data row = 2). */
  rowNumber: number;
  mapped: Record<string, string>;
  /** All validation error messages for this row. */
  errors: string[];
  valid: boolean;
}

interface ImportSummary {
  total: number;
  imported: number;
  failed: { row: number; message: string }[];
}

const SKIP = '__skip__';

/* ------------------------------------------------------------------ */
/* Fuzzy auto-map: try to match source columns to expected field labels */
/* ------------------------------------------------------------------ */

function autoMap(fields: ImportField[], cols: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const field of fields) {
    const targets = [normalize(field.label), normalize(field.key)];
    const match = cols.find((col) => {
      const n = normalize(col);
      return targets.some(
        (t) => n === t || n.includes(t) || t.includes(n)
      );
    });
    if (match) result[field.key] = match;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Step header pill                                                     */
/* ------------------------------------------------------------------ */

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map Columns' },
  { id: 'preview', label: 'Preview & Validate' },
  { id: 'summary', label: 'Summary' },
];

function StepBreadcrumb({ current }: { current: Step }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="mt-3 flex items-center gap-1.5 flex-wrap">
      {STEPS.map((step, i) => (
        <span key={step.id} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300 shrink-0" />}
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-medium',
              i === currentIdx
                ? 'bg-emerald-100 text-emerald-700'
                : i < currentIdx
                ? 'text-slate-400 line-through decoration-slate-300'
                : 'text-slate-400'
            )}
          >
            {i + 1}. {step.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                       */
/* ------------------------------------------------------------------ */

export function VehicleImportDialog({
  open,
  onOpenChange,
  title,
  fields,
  onSaveRow,
  onImportComplete,
}: ImportDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  /* fieldKey → source column name ('' = skip) */
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [rawData, setRawData] = useState<Record<string, string>[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---- reset ---- */
  const reset = useCallback(() => {
    setStep('upload');
    setIsDragging(false);
    setFileName('');
    setSourceColumns([]);
    setColumnMap({});
    setRawData([]);
    setParsedRows([]);
    setFilter('all');
    setIsImporting(false);
    setImportProgress(0);
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = () => {
    if (isImporting) return;
    reset();
    onOpenChange(false);
  };

  /* ---- template download ---- */
  const downloadTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Template');
    const headers = fields.map((f) => f.label);
    ws.addRow(headers);
    const row1 = ws.getRow(1);
    row1.eachCell((cell, col) => {
      cell.font = { bold: true, color: { argb: 'FF1E293B' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F8F4' } };
      cell.alignment = { horizontal: 'left' };
      ws.getColumn(col).width = Math.max(headers[col - 1].length + 6, 16);
    });
    // Sample row
    const sampleValues = fields.map((f) => {
      if (f.type === 'number') return '0';
      if (f.key.toLowerCase().includes('date')) return 'YYYY-MM-DD';
      return `Sample ${f.label}`;
    });
    ws.addRow(sampleValues);
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---- parse file → step map ---- */
  const parseFile = async (file: File) => {
    if (!file.name.endsWith('.xlsx')) return;
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 1) return;

    // Extract column headers
    const cols: string[] = [];
    ws.getRow(1).eachCell((cell) => {
      const v = String(cell.value ?? '').trim();
      if (v) cols.push(v);
    });
    setSourceColumns(cols);

    // Extract data rows (skip header)
    const dataRows: Record<string, string>[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const rowObj: Record<string, string> = {};
      let hasData = false;
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, colNum) => {
        const col = cols[colNum - 1];
        if (col) {
          const v = String(cell.value ?? '').trim();
          rowObj[col] = v;
          if (v) hasData = true;
        }
      });
      if (hasData) dataRows.push(rowObj);
    }
    setRawData(dataRows);
    setColumnMap(autoMap(fields, cols));
    setStep('map');
  };

  /* ---- validate + build preview ---- */
  const buildPreview = () => {
    const result: ParsedRow[] = rawData.map((raw, idx) => {
      const mapped: Record<string, string> = {};
      const errors: string[] = [];

      for (const field of fields) {
        const srcCol = columnMap[field.key] || '';
        const value = srcCol ? (raw[srcCol] ?? '') : '';
        mapped[field.key] = value;

        if (field.required && !value.trim()) {
          errors.push(`"${field.label}" is required`);
        } else if (value && field.type === 'number' && isNaN(Number(value))) {
          errors.push(`"${field.label}" must be a number (got "${value}")`);
        } else if (value && field.validate) {
          const msg = field.validate(value);
          if (msg) errors.push(msg);
        }
      }

      return { rowNumber: idx + 2, mapped, errors, valid: errors.length === 0 };
    });
    setParsedRows(result);
    setFilter('all');
    setStep('preview');
  };

  /* ---- run import ---- */
  const runImport = async () => {
    setIsImporting(true);
    setImportProgress(0);
    const valid = parsedRows.filter((r) => r.valid);
    const failed: { row: number; message: string }[] = [];
    let imported = 0;

    for (let i = 0; i < valid.length; i++) {
      const row = valid[i];
      try {
        const typed: Record<string, any> = {};
        for (const field of fields) {
          const raw = row.mapped[field.key] ?? '';
          typed[field.key] = field.type === 'number' ? (raw ? Number(raw) : undefined) : raw;
        }
        await onSaveRow(typed);
        imported++;
      } catch (err) {
        failed.push({ row: row.rowNumber, message: String(err) });
      }
      setImportProgress(i + 1);
    }

    setSummary({ total: valid.length, imported, failed });
    setStep('summary');
    setIsImporting(false);
    if (imported > 0) onImportComplete?.();
  };

  /* ---- derived ---- */
  const validCount = parsedRows.filter((r) => r.valid).length;
  const invalidCount = parsedRows.filter((r) => !r.valid).length;
  const filteredRows =
    filter === 'valid'
      ? parsedRows.filter((r) => r.valid)
      : filter === 'invalid'
      ? parsedRows.filter((r) => !r.valid)
      : parsedRows;

  /* ================================================================== */
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 vm-panel-strong">
        {/* ── Header ── */}
        <div className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-emerald-500/5 to-teal-500/5 px-6 pb-4 pt-5 pr-12">
          <DialogTitle className="text-base font-semibold text-slate-900">{title}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-slate-500">
            Import records from an Excel (.xlsx) file with column mapping and per-row validation.
          </DialogDescription>
          <StepBreadcrumb current={step} />
        </div>

        {/* ── Body ── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ─── STEP 1: Upload ─── */}
          {step === 'upload' && (
            <div className="p-6 space-y-5">
              <div
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-14 text-center transition-colors',
                  isDragging
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-slate-200 bg-slate-50/60 hover:border-emerald-300 hover:bg-slate-50'
                )}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); void parseFile(e.dataTransfer.files[0]); }}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileSpreadsheet className="mb-4 h-14 w-14 text-emerald-300" />
                <p className="text-sm font-semibold text-slate-700">Drop your .xlsx file here</p>
                <p className="mt-1 text-xs text-slate-400">or click to browse — only .xlsx files are supported</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void parseFile(f); }}
              />

              {/* Expected columns + template */}
              <div className="rounded-xl border border-slate-200 bg-white/70 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expected Columns</p>
                  <button
                    onClick={() => void downloadTemplate()}
                    className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" /> Download Template
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {fields.map((f) => (
                    <Badge
                      key={f.key}
                      variant="outline"
                      className={cn(
                        'text-xs',
                        f.required
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : 'border-slate-200 bg-white text-slate-600'
                      )}
                    >
                      {f.label}
                      {f.required && <span className="ml-0.5 text-rose-500">*</span>}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-slate-400"><span className="text-rose-500">*</span> Required fields</p>
              </div>
            </div>
          )}

          {/* ─── STEP 2: Map Columns ─── */}
          {step === 'map' && (
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{fileName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    <span className="font-medium text-emerald-600">{rawData.length}</span> data rows detected ·{' '}
                    <span className="font-medium text-slate-600">{sourceColumns.length}</span> columns found
                  </p>
                </div>
                <button
                  onClick={reset}
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Change file
                </button>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white/80">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-4 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expected Field</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Your Column</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {fields.map((field) => {
                    const mapped = columnMap[field.key] || '';
                    const isAutoMapped = !!mapped;
                    return (
                      <div key={field.key} className="grid grid-cols-[1fr_1fr_auto] items-center gap-4 px-4 py-2.5">
                        <div>
                          <span className="text-sm text-slate-700">{field.label}</span>
                          {field.required && <span className="ml-1 text-[10px] font-medium text-rose-500">required</span>}
                          {field.hint && <p className="text-[11px] text-slate-400 mt-0.5">{field.hint}</p>}
                        </div>
                        <Select
                          value={mapped || SKIP}
                          onValueChange={(val) =>
                            setColumnMap((prev) => ({ ...prev, [field.key]: val === SKIP ? '' : val }))
                          }
                        >
                          <SelectTrigger className="h-8 border-slate-200 bg-white text-sm">
                            <SelectValue placeholder="— Skip this field —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP}>— Skip this field —</SelectItem>
                            {sourceColumns.map((col) => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center justify-center w-8">
                          {mapped ? (
                            <span title="Auto-detected" className="flex items-center">
                              <CheckCircle2 className={cn('h-4 w-4', isAutoMapped ? 'text-emerald-400' : 'text-slate-300')} />
                            </span>
                          ) : field.required ? (
                            <AlertTriangle className="h-4 w-4 text-amber-400" title="Required — please map this column" />
                          ) : (
                            <span className="text-xs text-slate-300">–</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Unmapped required warning */}
              {fields.some((f) => f.required && !columnMap[f.key]) && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Some required fields are not mapped — rows missing those values will fail validation.
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 3: Preview & Validate ─── */}
          {step === 'preview' && (
            <div className="p-6 space-y-4">
              {/* Summary bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {validCount} valid
                  </Badge>
                  {invalidCount > 0 && (
                    <Badge className="gap-1 bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-100">
                      <XCircle className="h-3.5 w-3.5" /> {invalidCount} invalid
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-slate-500">
                    {parsedRows.length} total rows
                  </Badge>
                </div>
                {/* Filter pills */}
                <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-0.5">
                  {(['all', 'valid', 'invalid'] as FilterMode[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-medium capitalize transition-all',
                        filter === f
                          ? 'bg-white text-slate-800 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Data table */}
              <div className="overflow-auto rounded-xl border border-slate-200 bg-white/80" style={{ maxHeight: '420px' }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-12">#</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-16">Status</th>
                      {fields.map((f) => (
                        <th key={f.key} className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={fields.length + 2} className="py-10 text-center text-sm text-slate-400">
                          No rows match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => (
                        <tr
                          key={row.rowNumber}
                          className={cn(
                            'group transition-colors',
                            row.valid ? 'hover:bg-emerald-50/30' : 'bg-rose-50/20 hover:bg-rose-50/40'
                          )}
                        >
                          <td className="px-3 py-2 text-xs text-slate-400">{row.rowNumber}</td>
                          <td className="px-3 py-2">
                            {row.valid ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <div className="relative">
                                <XCircle className="h-4 w-4 text-rose-500 cursor-help" />
                                {/* Hover tooltip */}
                                <div className="pointer-events-none absolute left-6 top-0 z-50 hidden w-64 rounded-lg border border-rose-200 bg-white p-2.5 shadow-xl group-hover:block">
                                  <p className="mb-1 text-[11px] font-semibold text-rose-700">Validation Errors</p>
                                  {row.errors.map((e, i) => (
                                    <p key={i} className="text-[11px] text-rose-600 leading-relaxed">• {e}</p>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                          {fields.map((f) => {
                            const hasError = row.errors.some((e) => e.includes(`"${f.label}"`));
                            const val = row.mapped[f.key];
                            return (
                              <td
                                key={f.key}
                                className={cn(
                                  'max-w-[140px] truncate px-3 py-2 text-xs',
                                  hasError
                                    ? 'font-semibold text-rose-600'
                                    : val
                                    ? 'text-slate-700'
                                    : 'italic text-slate-300'
                                )}
                                title={val || ''}
                              >
                                {val || 'empty'}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {invalidCount > 0 && validCount > 0 && (
                <p className="text-xs text-slate-500">
                  Invalid rows will be skipped. Only the <strong>{validCount} valid</strong> rows will be imported.
                </p>
              )}
              {validCount === 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  <XCircle className="h-4 w-4 shrink-0" />
                  No valid rows to import. Fix the errors or go back and adjust the column mapping.
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 4: Summary ─── */}
          {step === 'summary' && summary && (
            <div className="p-6 space-y-5">
              {/* Stat tiles */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                  <p className="text-3xl font-bold text-slate-800">{summary.total}</p>
                  <p className="mt-1 text-xs text-slate-500">Rows Processed</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <p className="text-3xl font-bold text-emerald-700">{summary.imported}</p>
                  <p className="mt-1 text-xs text-emerald-600">Imported Successfully</p>
                </div>
                <div
                  className={cn(
                    'rounded-xl border p-4 text-center',
                    summary.failed.length > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'
                  )}
                >
                  <p className={cn('text-3xl font-bold', summary.failed.length > 0 ? 'text-rose-700' : 'text-slate-300')}>
                    {summary.failed.length}
                  </p>
                  <p className={cn('mt-1 text-xs', summary.failed.length > 0 ? 'text-rose-500' : 'text-slate-400')}>
                    Failed
                  </p>
                </div>
              </div>

              {/* All-success message */}
              {summary.imported === summary.total && summary.total > 0 && (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-500" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-700">All records imported successfully!</p>
                    <p className="text-xs text-emerald-600 mt-0.5">The list has been refreshed automatically.</p>
                  </div>
                </div>
              )}

              {/* Partial success */}
              {summary.imported > 0 && summary.failed.length > 0 && (
                <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <AlertTriangle className="h-6 w-6 shrink-0 text-amber-500" />
                  <div>
                    <p className="text-sm font-semibold text-amber-700">{summary.imported} of {summary.total} records imported.</p>
                    <p className="text-xs text-amber-600 mt-0.5">{summary.failed.length} rows failed — see the error list below.</p>
                  </div>
                </div>
              )}

              {/* Error list */}
              {summary.failed.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-rose-700">Row Errors</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                    {summary.failed.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-rose-700">
                        <span className="shrink-0 font-medium">Row {e.row}:</span>
                        <span className="text-rose-600">{e.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <Button variant="ghost" onClick={handleClose} disabled={isImporting} className="text-slate-500">
            {step === 'summary' ? 'Close' : 'Cancel'}
          </Button>

          <div className="flex items-center gap-2">
            {/* Import progress */}
            {isImporting && (
              <span className="text-xs text-slate-500">
                {importProgress} / {parsedRows.filter((r) => r.valid).length}…
              </span>
            )}

            {step === 'map' && (
              <>
                <Button variant="ghost" onClick={() => setStep('upload')} className="text-slate-500">
                  Back
                </Button>
                <Button onClick={buildPreview} disabled={rawData.length === 0}>
                  Preview &amp; Validate <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            )}

            {step === 'preview' && (
              <>
                <Button variant="ghost" onClick={() => setStep('map')} disabled={isImporting} className="text-slate-500">
                  Back
                </Button>
                <Button
                  onClick={() => void runImport()}
                  disabled={validCount === 0 || isImporting}
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700"
                >
                  {isImporting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…</>
                  ) : (
                    <>Import {validCount} Record{validCount !== 1 ? 's' : ''} <ArrowRight className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
              </>
            )}

            {step === 'summary' && (
              <Button
                onClick={() => { reset(); onOpenChange(false); }}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700"
              >
                Done
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
