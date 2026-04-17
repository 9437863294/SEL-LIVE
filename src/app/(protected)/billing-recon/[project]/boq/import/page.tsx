'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, UploadCloud, FileSpreadsheet, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

import ExcelJS from 'exceljs';

import { db } from '@/lib/firebase';
import {
  collection,
  writeBatch,
  doc,
  serverTimestamp,
  getDocs,
  query,
} from 'firebase/firestore';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import type { Project } from '@/lib/types';

type BoqItem = Record<string, any>;
const MAX_BATCH_WRITES = 500;

/* ---------- helpers ---------- */
function isEmptyRow(row: BoqItem): boolean {
  return Object.values(row).every((v) => v === null || v === undefined || String(v).trim() === '');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const toNum = (v: any): number => {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.replace(/,/g, '').trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  // Excel may give Date or boolean etc.
  return 0;
};

const normalize = (s: string) => s.toLowerCase().replace(/\s|_/g, '');

const possibleNames = (base: string) => {
  // basic variations we’ll accept for column names
  const b = base.toLowerCase();
  const variants: string[] = [b, `${b}(nos)`, `${b}(qty)`, `${b}(quantity)`];
  if (b === 'qty') variants.push('quantity', 'qnty', 'qnt', 'q');
  if (b === 'unitrate') variants.push('rate', 'unitprice', 'unit_cost', 'unit', 'u/r', 'u-rate', 'ur');
  if (b === 'totalamount') variants.push('amount', 'total', 'value', 'amt');
  return variants;
};

function resolveColumnName(headers: string[], wanted: 'qty' | 'unitrate' | 'totalamount') {
  const targets = possibleNames(wanted);
  const map = new Map(headers.map((h) => [normalize(h), h] as const));

  for (const t of targets) {
    // try exact normalized match
    if (map.has(t)) return map.get(t)!;
    // try contains (e.g., "Total Amount (₹)")
    for (const [norm, original] of map) {
      if (norm.includes(t)) return original;
    }
  }
  // not found; return first reasonable guess for each category
  if (wanted === 'qty') return headers.find((h) => /qty|quant|qnty/i.test(h)) ?? null;
  if (wanted === 'unitrate') return headers.find((h) => /rate|unit/i.test(h)) ?? null;
  if (wanted === 'totalamount') return headers.find((h) => /amount|total|value|amt/i.test(h)) ?? null;
  return null;
}

function worksheetToJson(worksheet: ExcelJS.Worksheet): Record<string, any>[] {
  const headers: string[] = [];
  const result: Record<string, any>[] = [];

  worksheet.eachRow((row, rowNumber) => {
    const vals = (row.values as any[]).slice(1);
    if (rowNumber === 1) {
      headers.push(
        ...vals.map((v: any, i: number) => (v != null ? String(v) : `Column${i + 1}`))
      );
    } else {
      const rowData: Record<string, any> = {};
      for (let i = 0; i < headers.length; i++) {
        let v = vals[i] ?? '';
        if (v && typeof v === 'object' && 'richText' in v) v = v.richText.map((r: any) => r.text).join('');
        if (v && typeof v === 'object' && 'result' in v) v = v.result ?? '';
        rowData[headers[i]] = v;
      }
      result.push(rowData);
    }
  });

  return result;
}

/* ---------- component ---------- */
export default function ImportBoqPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const params = useParams();
  const projectSlug = (params?.project as string) || '';

  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<ExcelJS.Workbook | null>(null);

  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const [jsonData, setJsonData] = useState<BoqItem[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);

  const totalRows = jsonData.length;

  /* ---------- fetch project by slug ---------- */
  useEffect(() => {
    const fetchProject = async () => {
      if (!projectSlug) return;

      try {
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);

        const slugify = (text: string) =>
          text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

        const projectData = projectsSnapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Project))
          .find((p) => slugify((p as any).projectName || '') === projectSlug);

        if (projectData) {
          setCurrentProject(projectData);
        } else {
          toast({
            title: 'Error',
            description: 'Project not found.',
            variant: 'destructive',
          });
        }
      } catch (err) {
        console.error('fetchProject error:', err);
        toast({
          title: 'Error',
          description: 'Failed to load project.',
          variant: 'destructive',
        });
      }
    };

    fetchProject();
  }, [projectSlug, toast]);

  /* ---------- excel parsing ---------- */
  const parseSheet = useCallback(
    (wb: ExcelJS.Workbook, sheetName: string) => {
      const ws = wb.getWorksheet(sheetName);
      if (!ws) {
        toast({
          title: 'Sheet not found',
          description: `Sheet "${sheetName}" does not exist in the workbook.`,
          variant: 'destructive',
        });
        return;
      }

      const rawJson = worksheetToJson(ws);

      if (rawJson.length === 0) {
        setJsonData([]);
        setHeaders([]);
        toast({
          title: 'No data detected',
          description: `The sheet "${sheetName}" appears to be empty.`,
        });
        return;
      }

      const filtered = rawJson.filter((row) => !isEmptyRow(row));
      setJsonData(filtered);
      setHeaders(Object.keys(filtered[0] || {}));
    },
    [toast]
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const valid =
      selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      selectedFile.name.endsWith('.xlsx');

    if (!valid) {
      toast({
        title: 'Invalid File Type',
        description: 'Please upload a valid Excel file (.xlsx).',
        variant: 'destructive',
      });
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);
    setJsonData([]);
    setHeaders([]);
    setSheetNames([]);
    setActiveSheet(null);
    setWorkbook(null);

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
        toast({
          title: 'No sheets found',
          description: 'The workbook has no sheets.',
          variant: 'destructive',
        });
        return;
      }

      parseSheet(wb, first);

      toast({
        title: 'File parsed',
        description: `Loaded "${first}".`,
      });
    } catch (error) {
      console.error('parseExcel error:', error);
      toast({
        title: 'File Read Error',
        description: 'Could not read the Excel file.',
        variant: 'destructive',
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleSheetChange = (sheet: string) => {
    if (!workbook) return;
    setActiveSheet(sheet);
    parseSheet(workbook, sheet);
  };

  /* ---------- import ---------- */
  const handleImport = async () => {
    if (jsonData.length === 0) {
      toast({
        title: 'No data to import',
        description: 'Please select a file with data.',
        variant: 'destructive',
      });
      return;
    }
    if (!user) {
      toast({
        title: 'Authentication Error',
        description: 'You must be logged in.',
        variant: 'destructive',
      });
      return;
    }
    if (!currentProject) {
      toast({
        title: 'Project missing',
        description: 'Could not identify the current project.',
        variant: 'destructive',
      });
      return;
    }

    setIsImporting(true);
    setProgress(0);

    try {
      // Resolve columns robustly
      const qtyCol = resolveColumnName(headers, 'qty');
      const unitRateCol = resolveColumnName(headers, 'unitrate');
      const totalAmountCol = resolveColumnName(headers, 'totalamount');

      const nowMeta = {
        createdAt: serverTimestamp(),
        createdBy: user.id,
        source: 'excel_import',
        fileName: file?.name ?? null,
      };

      const items = jsonData.map((row) => {
        const qty = qtyCol ? toNum(row[qtyCol]) : 0;
        const unitRate = unitRateCol ? toNum(row[unitRateCol]) : 0;

        // Prefer explicit "total amount" if present
        let totalAmount = totalAmountCol ? toNum(row[totalAmountCol]) : 0;

        // Compute if missing/zero but qty*unitRate is valid
        if ((totalAmount === 0 || !Number.isFinite(totalAmount)) && qty > 0 && unitRate > 0) {
          totalAmount = qty * unitRate;
        }

        return {
          ...row,
          ...nowMeta,
          ...(qtyCol ? { [qtyCol]: qty } : { QTY: qty }),
          ...(unitRateCol ? { [unitRateCol]: unitRate } : { 'Unit Rate': unitRate }),
          ...(totalAmountCol ? { [totalAmountCol]: totalAmount } : { 'Total Amount': totalAmount }),
        };
      });

      const chunks = chunk(items, MAX_BATCH_WRITES);
      const boqCollectionRef = collection(db, 'projects', (currentProject as any).id, 'boqItems');

      for (let i = 0; i < chunks.length; i++) {
        const batch = writeBatch(db);
        chunks[i].forEach((item) => {
          const docRef = doc(boqCollectionRef); // auto-id
          batch.set(docRef, item);
        });
        await batch.commit();
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
      }

      await logUserActivity({
        userId: user.id,
        action: 'Import BOQ',
        details: {
          project: projectSlug,
          fileName: file?.name || 'N/A',
          itemCount: jsonData.length,
          headers,
          sheet: activeSheet,
        },
      });

      toast({
        title: 'Import Successful',
        description: `${jsonData.length} items have been imported to the BOQ for this project.`,
      });

      handleClear();
    } catch (error) {
      console.error('Error importing data: ', error);
      toast({
        title: 'Import Failed',
        description: 'An error occurred while importing the data.',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setJsonData([]);
    setHeaders([]);
    setSheetNames([]);
    setActiveSheet(null);
    setWorkbook(null);
    setIsParsing(false);
    setIsImporting(false);
    setProgress(0);
  };

  const previewNote = useMemo(() => {
    if (!totalRows) return '';
    if (totalRows > 5000) return 'Large dataset detected. Consider splitting the file for faster import.';
    if (totalRows > 1000) return 'This is a big import; it may take a moment.';
    return '';
  }, [totalRows]);

  return (
    <div className="h-screen flex flex-col min-h-0 overflow-hidden px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Link href={`/billing-recon/${projectSlug}/boq`}>
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Import BOQ from Excel</h1>
        </div>

        {jsonData.length > 0 && (
          <div className="flex items-center gap-2">
            <Button onClick={handleImport} disabled={isImporting}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              {isImporting ? `Importing… ${progress}%` : 'Import Data'}
            </Button>
            <Button variant="ghost" onClick={handleClear} disabled={isImporting || isParsing}>
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        <Card className="flex flex-col shrink-0">
          <CardHeader>
            <CardTitle>Upload File</CardTitle>
            <CardDescription>Select an Excel file (.xlsx). The data will be previewed before import.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Input
                id="excel-file"
                type="file"
                onChange={handleFileChange}
                accept=".xlsx"
                disabled={isParsing || isImporting}
                className="cursor-pointer file:cursor-pointer file:text-primary file:font-semibold"
              />
            </div>

            {file && (
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-5 w-5 text-green-600" />
                <span className="truncate max-w-[50ch]">{file.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
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
                <div className="text-muted-foreground mb-1">Sheets detected:</div>
                <div className="flex flex-wrap gap-2">
                  {sheetNames.map((name) => (
                    <Button
                      key={name}
                      variant={activeSheet === name ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSheetChange(name)}
                      disabled={isParsing || isImporting}
                      className="h-7"
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {isParsing && (
              <div className="flex items-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Parsing file…
              </div>
            )}
          </CardContent>
        </Card>

        {jsonData.length > 0 && (
          <Card className="flex-1 min-h-0 flex flex-col">
            <CardHeader className="shrink-0">
              <CardTitle>Preview Data</CardTitle>
              <CardDescription>
                {`Found ${jsonData.length} row${jsonData.length === 1 ? '' : 's'}. `}{previewNote}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex-1 min-h-0 p-0">
              <div className="h-full overflow-auto overscroll-contain">
                <Table className="min-w-full table-auto">
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      {headers.map((header) => (
                        <TableHead key={header} className="whitespace-nowrap px-2 py-1">
                          {header}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jsonData.slice(0, 100).map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {headers.map((header) => (
                          <TableCell
                            key={`${rowIndex}-${header}`}
                            className="whitespace-nowrap px-2 py-1 text-xs"
                            title={row[header] != null ? String(row[header]) : ''}
                          >
                            {row[header] != null ? String(row[header]) : ''}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {jsonData.length > 100 && (
                  <p className="text-center text-sm text-muted-foreground p-4">
                    And {jsonData.length - 100} more rows...
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
