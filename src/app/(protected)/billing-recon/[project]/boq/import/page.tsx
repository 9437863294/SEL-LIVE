'use client';

/**
 * BOQ › Import BOQ — reads an .xlsx sheet, lets the user confirm which column is which, previews
 * it and adds every row to the BOQ Billing Recon reads for the project
 * (`billingReconRegister(project).boqItems`). An import adds rows; it never replaces the BOQ.
 *
 * Every column of the sheet is kept as it is. The mapped columns are also written under the names
 * the rest of the module reads — `BOQ SL No`, `Description`, `QTY`, `Unit Rate`, `Scope 1` … — so
 * a sheet that says "Quantity" or "Sl. No." still shows up in View BOQ, JMC and Reconciliation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Columns3,
  Eye,
  FileSpreadsheet,
  Info,
  Loader2,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { useParams } from 'next/navigation';
import { collection, doc, getCountFromServer, getDocs, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import type { Project } from '@/lib/types';
import { projectMatchesSlug } from '@/lib/project-slug';
import { billingReconRegister } from '@/lib/billing-recon/register';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { AppTile, BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BR_TONE } from '@/components/billing-recon/page-kit';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type BoqItem = Record<string, any>;
const RESOURCE = 'Billing Recon.BOQ';
const MAX_BATCH_WRITES = 500;
const PREVIEW_ROWS = 100;
const NONE = '__none__';

/* ---------- the columns the module reads ---------- */

type Target = 'BOQ SL No' | 'ERP SL NO' | 'Description' | 'Unit' | 'QTY' | 'Unit Rate' | 'Total Amount' | 'Scope 1' | 'Scope 2';

/**
 * Each target and the header spellings (letters and digits only, lower case) taken for it without
 * asking. Exact matches only: a looser "contains" guess once took the "Unit" column for the unit
 * rate and "BOQ SL No" for the quantity, and overwrote both with 0.
 */
const TARGETS: ReadonlyArray<{ key: Target; aliases: string[]; numeric?: boolean; hint: string }> = [
  { key: 'BOQ SL No', aliases: ['boqslno', 'boqsno', 'boqserialno', 'boqitemno', 'slno', 'sno', 'serialno', 'itemno'], hint: 'Required to match JMC / MVAC lines' },
  { key: 'ERP SL NO', aliases: ['erpslno', 'erpsno', 'erpno', 'erpserialno'], hint: 'Optional' },
  { key: 'Description', aliases: ['description', 'descriptionofitems', 'descriptionofitem', 'itemdescription', 'descriptionofwork', 'itemspec', 'particulars'], hint: 'Required' },
  { key: 'Unit', aliases: ['unit', 'uom', 'units'], hint: 'Unit of measure' },
  { key: 'QTY', aliases: ['qty', 'quantity', 'totalqty', 'boqqty', 'qnty'], numeric: true, hint: 'Stored as a number' },
  { key: 'Unit Rate', aliases: ['unitrate', 'rate', 'unitprice', 'rateperunit', 'rateinrs', 'unitrateinrs'], numeric: true, hint: 'Stored as a number' },
  { key: 'Total Amount', aliases: ['totalamount', 'amount', 'totalvalue', 'amountinrs', 'totalamountinrs', 'total'], numeric: true, hint: 'Blank or 0 → QTY × Unit Rate' },
  { key: 'Scope 1', aliases: ['scope1'], hint: 'Part of the matching key' },
  { key: 'Scope 2', aliases: ['scope2'], hint: 'Part of the matching key' },
];

type Mapping = Record<Target, string | null>;

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function guessMapping(headers: string[]): Mapping {
  const byNorm = new Map<string, string>();
  for (const h of headers) {
    const n = alnum(h);
    if (n && !byNorm.has(n)) byNorm.set(n, h);
  }
  const used = new Set<string>();
  const mapping = {} as Mapping;
  for (const target of TARGETS) {
    let found: string | null = null;
    for (const alias of target.aliases) {
      const header = byNorm.get(alias);
      if (header && !used.has(header)) {
        found = header;
        break;
      }
    }
    if (found) used.add(found);
    mapping[target.key] = found;
  }
  return mapping;
}

/* ---------- helpers ---------- */

function isEmptyRow(row: BoqItem): boolean {
  return Object.values(row).every((v) => v === null || v === undefined || String(v).trim() === '');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** A number from a cell: "₹ 1,234.50" → 1234.5; anything that is not a number → 0. */
const toNum = (v: any): number => {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.replace(/[,\s₹]/g, '').replace(/^rs\.?/i, '').trim();
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  // Excel may give Date or boolean etc.
  return 0;
};

/** What a cell holds, as a plain value: rich text and hyperlinks as text, formulas as their result. */
function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as Record<string, any>;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r?.text ?? '').join('');
    if ('formula' in o || 'sharedFormula' in o || 'result' in o) {
      const result = o.result;
      return result === null || result === undefined || (typeof result === 'object' && !(result instanceof Date)) ? '' : result;
    }
    // A hyperlink: its text, which may itself be rich text.
    if ('text' in o) return o.text !== null && typeof o.text === 'object' ? cellValue(o.text) : String(o.text ?? '');
    return '';
  }
  return v;
}

const cellText = (v: unknown) => {
  const value = cellValue(v);
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').trim();
};

/** The first of the top rows that names a BOQ SL No or Description column (BOQs often open with a title). */
function detectHeaderRow(worksheet: ExcelJS.Worksheet): number {
  const wanted = new Set([...TARGETS[0].aliases, ...TARGETS[2].aliases]);
  const last = Math.min(worksheet.rowCount, 20);
  for (let r = 1; r <= last; r++) {
    const row = worksheet.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      if (wanted.has(alnum(cellText(row.getCell(c).value)))) return r;
    }
  }
  return 1;
}

function worksheetToJson(worksheet: ExcelJS.Worksheet, headerRowNumber: number): { headers: string[]; rows: Record<string, any>[] } {
  const headRow = worksheet.getRow(headerRowNumber);
  const width = headRow.cellCount;
  const headers: string[] = [];
  const blankHeader: boolean[] = [];
  const seen = new Map<string, number>();
  for (let c = 1; c <= width; c++) {
    let name = cellText(headRow.getCell(c).value);
    blankHeader.push(!name);
    // A blank header cell is "Column N" (it used to become a field literally named "undefined"),
    // and a repeated header gets a number so the second column doesn't overwrite the first.
    if (!name) name = `Column${c}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    headers.push(count ? `${name} (${count + 1})` : name);
  }

  const rows: Record<string, any>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const rowData: Record<string, any> = {};
    for (let c = 1; c <= width; c++) rowData[headers[c - 1]] = cellValue(row.getCell(c).value);
    rows.push(rowData);
  });

  // Untitled columns with nothing in them are spreadsheet padding, not data.
  const keep = headers.filter((h, i) => !blankHeader[i] || rows.some((r) => String(r[h] ?? '').trim() !== ''));
  if (keep.length !== headers.length) {
    for (const r of rows) for (const h of headers) if (!keep.includes(h)) delete r[h];
  }
  return { headers: keep, rows: rows.filter((r) => !isEmptyRow(r)) };
}

/* ---------- component ---------- */

export default function ImportBoqPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const params = useParams();
  const projectSlug = (params?.project as string) || '';

  const canImport = can('Import', RESOURCE);

  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projectState, setProjectState] = useState<'loading' | 'ready' | 'not-found' | 'failed'>('loading');
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const reg = useMemo(() => billingReconRegister(currentProject), [currentProject]);

  const [file, setFile] = useState<File | null>(null);
  // Remounts the file input on Clear, so choosing the same file again fires onChange.
  const [inputKey, setInputKey] = useState(0);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<ExcelJS.Workbook | null>(null);
  const [headerRow, setHeaderRow] = useState(1);

  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parseProblem, setParseProblem] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<{ count: number; fileName: string } | null>(null);

  const [jsonData, setJsonData] = useState<BoqItem[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>(() => guessMapping([]));

  const totalRows = jsonData.length;

  /* ---------- fetch project by slug ---------- */
  useEffect(() => {
    if (authLoading || !canImport) return;
    let alive = true;
    const fetchProject = async () => {
      if (!projectSlug) return;

      try {
        const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
        if (!alive) return;

        const projectData = projectsSnapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Project))
          .find((p) => projectMatchesSlug((p as any).projectName || '', projectSlug));

        if (!projectData) {
          setProjectState('not-found');
          return;
        }
        setCurrentProject(projectData);
        setProjectState('ready');
        // How big the BOQ already is, so nobody imports the same file twice by mistake.
        try {
          const count = await getCountFromServer(collection(db, 'projects', projectData.id, billingReconRegister(projectData).boqItems));
          if (alive) setExistingCount(count.data().count);
        } catch {
          if (alive) setExistingCount(null);
        }
      } catch (err) {
        console.error('fetchProject error:', err);
        if (alive) setProjectState('failed');
        toast({ title: 'Error', description: 'Failed to load project.', variant: 'destructive' });
      }
    };

    void fetchProject();
    return () => {
      alive = false;
    };
  }, [projectSlug, toast, authLoading, canImport]);

  /* ---------- excel parsing ---------- */
  const parseSheet = useCallback((wb: ExcelJS.Workbook, sheetName: string, row?: number) => {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) {
      setParseProblem(`The sheet “${sheetName}” does not exist in the workbook.`);
      setJsonData([]);
      setHeaders([]);
      return;
    }

    const headerAt = row ?? detectHeaderRow(ws);
    setHeaderRow(headerAt);
    const parsed = worksheetToJson(ws, headerAt);

    setHeaders(parsed.headers);
    setMapping(guessMapping(parsed.headers));
    setJsonData(parsed.rows);
    if (parsed.headers.length === 0) setParseProblem(`Row ${headerAt} of “${sheetName}” is empty — choose the row that holds the column names.`);
    else if (parsed.rows.length === 0) setParseProblem(`“${sheetName}” has no data below row ${headerAt}.`);
    else setParseProblem(null);
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const valid =
      selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      selectedFile.name.toLowerCase().endsWith('.xlsx');

    if (!valid) {
      toast({
        title: 'Invalid File Type',
        description: 'Please upload a valid Excel file (.xlsx). Save an .xls or .csv as .xlsx first.',
        variant: 'destructive',
      });
      setInputKey((k) => k + 1);
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);
    setJsonData([]);
    setHeaders([]);
    setSheetNames([]);
    setActiveSheet(null);
    setWorkbook(null);
    setParseProblem(null);
    setLastImport(null);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      setWorkbook(wb);

      const names = wb.worksheets.map((ws) => ws.name);
      setSheetNames(names);

      const first = names[0] ?? null;
      setActiveSheet(first);

      if (!first) {
        setParseProblem('The workbook has no sheets.');
        return;
      }

      parseSheet(wb, first);
    } catch (error) {
      console.error('parseExcel error:', error);
      setParseProblem('Could not read the Excel file. It may be password-protected, damaged, or not a real .xlsx file.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleSheetChange = (sheet: string) => {
    if (!workbook) return;
    setActiveSheet(sheet);
    parseSheet(workbook, sheet);
  };

  const handleHeaderRowChange = (value: string) => {
    const n = Math.floor(Number(value));
    if (!workbook || !activeSheet || !Number.isFinite(n) || n < 1) return;
    parseSheet(workbook, activeSheet, n);
  };

  const handleClear = () => {
    setFile(null);
    setInputKey((k) => k + 1);
    setJsonData([]);
    setHeaders([]);
    setMapping(guessMapping([]));
    setSheetNames([]);
    setActiveSheet(null);
    setWorkbook(null);
    setHeaderRow(1);
    setParseProblem(null);
    setIsParsing(false);
    setIsImporting(false);
    setProgress(0);
  };

  /* ---------- checks ---------- */

  const mappedSource = (target: Target) => mapping[target];
  const rowsWithoutSlNo = useMemo(() => {
    const source = mapping['BOQ SL No'];
    if (!source) return jsonData.length;
    return jsonData.filter((row) => String(row[source] ?? '').trim() === '').length;
  }, [jsonData, mapping]);

  const targetOf = useMemo(() => {
    const map = new Map<string, Target[]>();
    for (const target of TARGETS) {
      const source = mapping[target.key];
      if (!source) continue;
      map.set(source, [...(map.get(source) ?? []), target.key]);
    }
    return map;
  }, [mapping]);

  /* ---------- import ---------- */
  const handleImport = async () => {
    if (jsonData.length === 0) {
      toast({ title: 'No data to import', description: 'Please select a file with data.', variant: 'destructive' });
      return;
    }
    if (!user) {
      toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive' });
      return;
    }
    if (!currentProject) {
      toast({ title: 'Project missing', description: 'Could not identify the current project.', variant: 'destructive' });
      return;
    }

    setIsImporting(true);
    setProgress(0);

    const fileName = file?.name ?? '';
    const qtyCol = mapping['QTY'];
    const unitRateCol = mapping['Unit Rate'];
    const totalAmountCol = mapping['Total Amount'];

    let written = 0;
    try {
      const nowMeta = {
        createdAt: serverTimestamp(),
        createdBy: user.id,
        source: 'excel_import',
        fileName: file?.name ?? null,
      };

      const items = jsonData.map((row) => {
        const qty = qtyCol ? toNum(row[qtyCol]) : 0;
        const unitRate = unitRateCol ? toNum(row[unitRateCol]) : 0;

        // Prefer explicit "total amount" if present; compute it when blank or zero.
        let totalAmount = totalAmountCol ? toNum(row[totalAmountCol]) : 0;
        if ((totalAmount === 0 || !Number.isFinite(totalAmount)) && qty > 0 && unitRate > 0) {
          totalAmount = qty * unitRate;
        }

        // Text columns under the module's own names (the sheet's column stays too).
        const named: Record<string, unknown> = {};
        for (const target of TARGETS) {
          if (target.numeric) continue;
          const source = mapping[target.key];
          if (source && source !== target.key) named[target.key] = row[source] ?? '';
        }

        return {
          ...row,
          ...nowMeta,
          ...named,
          // The sheet's own numeric columns become numbers (as before), and the module's names get them too.
          ...(qtyCol ? { [qtyCol]: qty } : {}),
          ...(unitRateCol ? { [unitRateCol]: unitRate } : {}),
          ...(totalAmountCol ? { [totalAmountCol]: totalAmount } : {}),
          QTY: qty,
          'Unit Rate': unitRate,
          'Total Amount': totalAmount,
        };
      });

      const chunks = chunk(items, MAX_BATCH_WRITES);
      const boqCollectionRef = collection(db, 'projects', (currentProject as any).id, reg.boqItems);

      for (let i = 0; i < chunks.length; i++) {
        const batch = writeBatch(db);
        chunks[i].forEach((item) => {
          const docRef = doc(boqCollectionRef); // auto-id
          batch.set(docRef, item);
        });
        await batch.commit();
        written += chunks[i].length;
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
      }
    } catch (error) {
      console.error('Error importing data: ', error);
      toast({
        title: written ? 'Import stopped part-way' : 'Import Failed',
        description: written
          ? `${written} of ${jsonData.length} rows were added before the error. Check View BOQ before importing again, or the added rows will be duplicated.`
          : 'An error occurred while importing the data.',
        variant: 'destructive',
      });
      if (written) setExistingCount((c) => (c === null ? c : c + written));
      setIsImporting(false);
      return;
    }

    // The rows are in. A failed activity log must not read as a failed import (and invite a
    // second import that duplicates every row).
    void logUserActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      module: 'Billing Recon',
      action: 'Import BOQ',
      details: {
        project: projectSlug,
        fileName: fileName || 'N/A',
        itemCount: jsonData.length,
        headers,
        sheet: activeSheet,
      },
    });

    toast({
      title: 'Import Successful',
      description: `${jsonData.length} items have been imported to the BOQ for this project.`,
    });
    setExistingCount((c) => (c === null ? c : c + jsonData.length));
    setLastImport({ count: jsonData.length, fileName });
    handleClear();
  };

  const previewNote = useMemo(() => {
    if (!totalRows) return '';
    if (totalRows > 5000) return 'Large dataset detected. Consider splitting the file for faster import.';
    if (totalRows > 1000) return 'This is a big import; it may take a moment.';
    return '';
  }, [totalRows]);

  /* ---------- render ---------- */

  const backHref = `/billing-recon/${projectSlug}/boq`;

  if (authLoading) return <BrPageSkeleton kpis={0} blocks={2} />;
  if (!canImport) return <BrAccessDenied message="You need Billing Recon › BOQ › Import to import a BOQ." />;

  const ready = jsonData.length > 0 && !parseProblem;
  const importDisabled = isImporting || isParsing || !ready || projectState !== 'ready';

  return (
    <BrPage tone={BR_TONE.boq}>
      <PageHeader
        title="Import BOQ"
        description="Upload an Excel sheet, confirm which column is which, check the preview, then import. Importing adds rows to the BOQ; it never replaces it."
        icon={UploadCloud}
        backHref={backHref}
        backLabel="Back to BOQ"
        meta={
          currentProject
            ? [
                { label: 'Project', value: currentProject.projectName },
                ...(existingCount !== null ? [{ label: 'Items in BOQ', value: existingCount.toLocaleString('en-IN') }] : []),
              ]
            : undefined
        }
        actions={
          jsonData.length > 0 ? (
            <>
              <Button variant="ghost" onClick={handleClear} disabled={isImporting || isParsing}>
                Clear
              </Button>
              <Button onClick={() => void handleImport()} disabled={importDisabled}>
                {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                {isImporting ? `Importing… ${progress}%` : `Import ${jsonData.length.toLocaleString('en-IN')} rows`}
              </Button>
            </>
          ) : undefined
        }
      />

      {projectState === 'not-found' && (
        <BrNotice tone="danger" icon={AlertTriangle} title="Project not found">
          This link does not match any project. It may have been renamed or removed.
        </BrNotice>
      )}
      {projectState === 'failed' && (
        <BrNotice tone="danger" icon={AlertTriangle} title="Could not load the project">
          Check your connection and reload the page.
        </BrNotice>
      )}
      {lastImport && (
        <BrNotice
          tone="success"
          icon={CheckCircle2}
          title={`${lastImport.count.toLocaleString('en-IN')} rows imported`}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={`/billing-recon/${projectSlug}/boq/view`}>
                <Eye className="mr-2 h-4 w-4" /> View BOQ
              </Link>
            </Button>
          }
        >
          {lastImport.fileName ? `From ${lastImport.fileName}. ` : ''}Check them in View BOQ.
        </BrNotice>
      )}

      {/* Step 1 — the file */}
      <Card className="min-w-0">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <AppTile tone="emerald" icon={FileSpreadsheet} size={30} />
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-tight text-foreground">1. Choose the file</h2>
              <p className="text-xs text-muted-foreground">An Excel workbook (.xlsx). Its first sheet opens; pick another below.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="excel-file">Excel file</Label>
              <Input
                key={inputKey}
                id="excel-file"
                type="file"
                onChange={(e) => void handleFileChange(e)}
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={isParsing || isImporting || projectState !== 'ready'}
                className="cursor-pointer file:cursor-pointer file:font-semibold file:text-primary"
              />
            </div>
            {workbook && activeSheet && (
              <div className="space-y-1.5">
                <Label htmlFor="header-row">Column names in row</Label>
                <Input
                  id="header-row"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={headerRow}
                  onChange={(e) => handleHeaderRowChange(e.target.value)}
                  disabled={isParsing || isImporting}
                />
              </div>
            )}
          </div>

          {file && (
            <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{(file.size / 1024).toFixed(0)} KB</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={handleClear}
                disabled={isParsing || isImporting}
                aria-label="Remove file"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )}

          {sheetNames.length > 1 && (
            <div className="text-sm">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Sheets</div>
              <div className="flex flex-wrap gap-2">
                {sheetNames.map((name) => (
                  <Button
                    key={name}
                    variant={activeSheet === name ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleSheetChange(name)}
                    disabled={isParsing || isImporting}
                    className="h-7 max-w-[16rem]"
                  >
                    <span className="truncate">{name}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {isParsing && (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Reading the file…
            </div>
          )}

          {parseProblem && (
            <BrNotice tone="danger" icon={AlertTriangle} title="Nothing to import yet">
              {parseProblem}
            </BrNotice>
          )}

          {isImporting && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Importing…</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}
        </CardContent>
      </Card>

      {headers.length > 0 && (
        /* Step 2 — which column is which */
        <Card className="min-w-0">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <AppTile tone="teal" icon={Columns3} size={30} />
              <div className="min-w-0">
                <h2 className="text-base font-bold leading-tight text-foreground">2. Match the columns</h2>
                <p className="text-xs text-muted-foreground">
                  Guessed from the column names — check each one. Every column of the sheet is imported; these are also stored under the names
                  View BOQ, JMC and Reconciliation read.
                </p>
              </div>
            </div>

            {existingCount !== null && existingCount > 0 && (
              <BrNotice tone="info" icon={Info} title={`This BOQ already has ${existingCount.toLocaleString('en-IN')} items`}>
                Importing adds {jsonData.length.toLocaleString('en-IN')} more; nothing is replaced. If this file is already in, importing it again duplicates every row.
              </BrNotice>
            )}
            {(!mappedSource('BOQ SL No') || !mappedSource('Description')) && (
              <BrNotice tone="warning" icon={AlertTriangle} title="BOQ SL No and Description should be matched">
                Without a BOQ SL No column the items can&apos;t be matched to JMC, MVAC or RA bill lines.
              </BrNotice>
            )}
            {mappedSource('BOQ SL No') && rowsWithoutSlNo > 0 && (
              <BrNotice tone="warning" icon={AlertTriangle} title={`${rowsWithoutSlNo.toLocaleString('en-IN')} rows have no BOQ SL No`}>
                They are imported, but JMC and MVAC lines can&apos;t find them. Section headings and sub-totals in the sheet are often the cause.
              </BrNotice>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {TARGETS.map((target) => {
                const value = mapping[target.key] ?? NONE;
                return (
                  <div key={target.key} className="min-w-0 space-y-1.5 rounded-xl border border-border bg-card p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor={`map-${alnum(target.key)}`} className="font-semibold">
                        {target.key}
                      </Label>
                      <span className="truncate text-[11px] text-muted-foreground">{target.hint}</span>
                    </div>
                    <Select
                      value={value}
                      onValueChange={(next) => setMapping((prev) => ({ ...prev, [target.key]: next === NONE ? null : next }))}
                      disabled={isImporting}
                    >
                      <SelectTrigger id={`map-${alnum(target.key)}`} className={cn('text-left', value === NONE && 'text-muted-foreground')}>
                        <span className="truncate">
                          <SelectValue placeholder="Not in this sheet" />
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not in this sheet</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {jsonData.length > 0 && (
        /* Step 3 — the preview */
        <TableCard
          title="3. Preview"
          icon={Eye}
          count={jsonData.length}
          noun="row"
          description={
            <>
              {`The first ${Math.min(PREVIEW_ROWS, jsonData.length)} rows as they will be imported. `}
              {previewNote}
            </>
          }
          actions={
            <Button onClick={() => void handleImport()} disabled={importDisabled}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              {isImporting ? `Importing… ${progress}%` : 'Import'}
            </Button>
          }
          footer={jsonData.length > PREVIEW_ROWS ? <>And {(jsonData.length - PREVIEW_ROWS).toLocaleString('en-IN')} more rows…</> : undefined}
        >
          <Table className="min-w-full table-auto">
            <TableHeader>
              <TableRow>
                {headers.map((h) => {
                  const targets = targetOf.get(h);
                  return (
                    <TableHead key={h} className="whitespace-nowrap align-bottom">
                      <div>{h}</div>
                      {targets && <div className="text-[10px] font-semibold normal-case text-emerald-700 dark:text-emerald-300">→ {targets.join(', ')}</div>}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {jsonData.slice(0, PREVIEW_ROWS).map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {headers.map((h) => {
                    const v = row[h];
                    const text = v instanceof Date ? v.toISOString().slice(0, 10) : v != null ? String(v) : '';
                    return (
                      <TableCell key={`${rowIndex}-${h}`} className="max-w-xs truncate whitespace-nowrap" title={text}>
                        {text}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </BrPage>
  );
}
