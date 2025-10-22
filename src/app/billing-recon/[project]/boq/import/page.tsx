
'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  UploadCloud,
  FileSpreadsheet,
  Loader2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { db } from '@/lib/firebase';
import {
  collection,
  writeBatch,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

type BoqItem = Record<string, any>;
const MAX_BATCH_WRITES = 500;

function isEmptyRow(row: BoqItem): boolean {
  return Object.values(row).every(
    (v) => v === null || v === undefined || String(v).trim() === ''
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function ImportBoqPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const params = useParams();
  const projectSlug = params.project as string;

  const [file, setFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const [jsonData, setJsonData] = useState<BoqItem[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);

  const totalRows = jsonData.length;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const selectedFile = e.target.files[0];

    const valid =
      selectedFile.type ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      selectedFile.type === 'application/vnd.ms-excel' ||
      selectedFile.name.endsWith('.xlsx') ||
      selectedFile.name.endsWith('.xls');

    if (!valid) {
      toast({
        title: 'Invalid File Type',
        description: 'Please upload a valid Excel file (.xlsx, .xls).',
        variant: 'destructive',
      });
      return;
    }

    setFile(selectedFile);
    await parseExcel(selectedFile);
  };

  const parseExcel = async (fileToParse: File) => {
    setIsParsing(true);
    setJsonData([]);
    setHeaders([]);
    setSheetNames([]);
    setActiveSheet(null);

    try {
      const buffer = await fileToParse.arrayBuffer();
      const workbook = XLSX.read(buffer, {
        type: 'array',
        cellDates: true,
        raw: false,
      });

      const names = workbook.SheetNames || [];
      setSheetNames(names);
      const sheetName = names[0];
      setActiveSheet(sheetName || null);

      if (!sheetName) {
        toast({
          title: 'No sheets found',
          description: 'The workbook has no sheets.',
          variant: 'destructive',
        });
        return;
      }

      const ws = workbook.Sheets[sheetName];
      const rawJson = XLSX.utils.sheet_to_json<BoqItem>(ws, {
        defval: '',
        blankrows: false,
      });

      if (rawJson.length === 0) {
        toast({
          title: 'No data detected',
          description: 'The first sheet appears to be empty.',
        });
        return;
      }

      const filteredData = rawJson.filter(row => !isEmptyRow(row));

      setJsonData(filteredData);
      setHeaders(Object.keys(filteredData[0] || {}));

      toast({
        title: 'File parsed',
        description: `Loaded "${sheetName}" with ${filteredData.length} rows.`,
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
    if (!projectSlug) {
      toast({
        title: 'Project missing',
        description: 'No project slug found in the URL.',
        variant: 'destructive',
      });
      return;
    }

    setIsImporting(true);
    setProgress(0);

    try {
      const nowMeta = {
        createdAt: serverTimestamp(),
        createdBy: user.id,
        projectSlug: projectSlug,
        source: 'excel_import',
        fileName: file?.name ?? null,
      };

      const items = jsonData.map((row) => ({
        ...row,
        ...nowMeta,
      }));

      const chunks = chunk(items, MAX_BATCH_WRITES);
      const boqCollectionRef = collection(db, 'projects', projectSlug, 'boqItems');

      for (let i = 0; i < chunks.length; i++) {
        const batch = writeBatch(db);
        chunks[i].forEach((item) => {
          const docRef = doc(boqCollectionRef);
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
    setIsParsing(false);
    setIsImporting(false);
    setProgress(0);
  };

  const previewNote = useMemo(() => {
    if (!totalRows) return '';
    if (totalRows > 5000)
      return 'Large dataset detected. Consider splitting the file for faster import.';
    if (totalRows > 1000) return 'This is a big import; it may take a moment.';
    return '';
  }, [totalRows]);

  return (
    <div className="h-screen flex flex-col min-h-0 overflow-hidden px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Link href={`/billing-recon/${projectSlug}/boq`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Import BOQ from Excel</h1>
        </div>

        {jsonData.length > 0 && (
          <div className="flex items-center gap-2">
            <Button onClick={handleImport} disabled={isImporting}>
              {isImporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="mr-2 h-4 w-4" />
              )}
              {isImporting ? `Importing… ${progress}%` : 'Import Data'}
            </Button>
            <Button variant="ghost" onClick={handleClear}>
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        <Card className="flex flex-col shrink-0">
          <CardHeader>
            <CardTitle>Upload File</CardTitle>
            <CardDescription>
              Select an Excel file (.xlsx or .xls). The data will be previewed before import.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Input
                id="excel-file"
                type="file"
                onChange={handleFileChange}
                accept=".xlsx, .xls"
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
              <div className="text-sm text-muted-foreground">
                Sheets detected:&nbsp;
                <span className="font-medium">{sheetNames.join(', ')}</span>
                <span className="ml-1">
                  (loaded: <span className="font-medium">{activeSheet}</span>)
                </span>
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
              <div
                className="h-full overflow-auto overscroll-contain"
              >
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
                    {jsonData.slice(0, 100).map((row, rowIndex) => ( // Preview limited rows for performance
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
                    <p className="text-center text-sm text-muted-foreground p-4">And {jsonData.length - 100} more rows...</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
