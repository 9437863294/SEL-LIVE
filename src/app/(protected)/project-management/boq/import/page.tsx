'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ExcelJS from 'exceljs';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  ShieldAlert,
  TableProperties,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { logUserActivity } from '@/lib/activity-logger';
import { cn } from '@/lib/utils';
import {
  BOQ_COLUMN_SETTINGS_COLLECTION,
  BOQ_COLUMN_SETTINGS_DOC,
  mergeBoqColumns,
  type BoqColumnConfig,
  type BoqColumnDataType,
} from '@/lib/project-management-boq-columns';

type BoqItem = Record<string, any>;
type ImportStep = 'upload' | 'mapping' | 'validation' | 'summary';
type ValidationFilter = 'all' | 'valid' | 'invalid';
type FieldType = BoqColumnDataType;

type ImportField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  aliases?: string[];
  hint?: string;
};

type ValidatedRow = {
  rowNumber: number;
  data: BoqItem;
  errors: string[];
  valid: boolean;
};

type ImportSummary = {
  totalRows: number;
  validRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: { rowNumber: number; message: string }[];
};

const MAX_BATCH_WRITES = 500;
const SKIP_COLUMN = '__skip_column__';
const CALCULATED_COLUMN_KEYS = new Set([
  normalizeCalculatedColumn('F&I Price'),
  normalizeCalculatedColumn('Total Budget Price'),
]);
const NON_IMPORTABLE_COLUMN_KEYS = new Set([
  'JMC/MVAC Executed Qty',
  'JMC/MVAC Certified Qty',
  'JMC/MVAC Amount',
  'F&I Price',
  'Total Budget Price',
]);

function normalizeCalculatedColumn(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const IMPORT_STEPS: { key: ImportStep; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'mapping', label: 'Column Mapping' },
  { key: 'validation', label: 'Data Validation' },
  { key: 'summary', label: 'Import Summary' },
];

const BASE_IMPORT_FIELDS: ImportField[] = [
  { key: 'Project Name', label: 'Project Name', type: 'text', aliases: ['Project'] },
  { key: 'Sub-Division', label: 'Sub-Division', type: 'text', aliases: ['Subdivision'] },
  { key: 'Site', label: 'Site', type: 'text', aliases: ['Project Site', 'Location'] },
  { key: 'Scope 1', label: 'Scope 1', type: 'text' },
  { key: 'Scope 2', label: 'Scope 2', type: 'text' },
  { key: 'Category 1', label: 'Category 1', type: 'text' },
  { key: 'Category 2', label: 'Category 2', type: 'text' },
  { key: 'Category 3', label: 'Category 3', type: 'text' },
  { key: 'ERP SL NO', label: 'ERP SL NO', type: 'text', aliases: ['ERP Serial No'] },
  {
    key: 'BOQ SL No',
    label: 'BOQ SL No',
    type: 'text',
    required: true,
    aliases: ['BOQ Serial No', 'SL No', 'SL. No.'],
    hint: 'Unique within the same Scope 1 and Scope 2',
  },
  { key: 'Description', label: 'Description', type: 'text', required: true },
  { key: 'Unit', label: 'Unit', type: 'text', aliases: ['UOM'] },
  { key: 'QTY', label: 'QTY', type: 'number', required: true, aliases: ['Quantity'] },
  { key: 'Unit Rate', label: 'Unit Rate', type: 'number', aliases: ['Rate', 'Unit Price'] },
  { key: 'Total Amount', label: 'Total Amount', type: 'number', aliases: ['Amount'] },
  { key: 'Budget Price', label: 'Budget Price', type: 'number' },
  { key: 'F&I %', label: 'F&I %', type: 'percentage', aliases: ['F&I Percentage', 'FI %'] },
  { key: 'Start Date', label: 'Start Date', type: 'date', hint: 'YYYY-MM-DD or DD/MM/YYYY' },
  { key: 'End Date', label: 'End Date', type: 'date', hint: 'YYYY-MM-DD or DD/MM/YYYY' },
];

const BASE_IMPORT_FIELDS_BY_KEY = new Map(
  BASE_IMPORT_FIELDS.map((field) => [field.key, field]),
);

const SAMPLE_ROWS: Array<Record<string, string | number>> = [
  {
    'Project Name': 'Sample Project',
    'Sub-Division': 'Electrical',
    Site: 'Site A',
    'Scope 1': 'Supply',
    'Scope 2': 'HT Panel',
    'Category 1': 'Electrical Works',
    'Category 2': 'Panels',
    'Category 3': 'Indoor',
    'ERP SL NO': 'ERP-001',
    'BOQ SL No': '1.1',
    Description: 'Supply of HT panel complete with accessories',
    Unit: 'Nos',
    QTY: 2,
    'Unit Rate': 125000,
    'Total Amount': 250000,
    'Budget Price': 115000,
    'F&I %': 5,
    'F&I Price': 5750,
    'Total Budget Price': 230000,
    'Start Date': '2026-08-10',
    'End Date': '2026-08-25',
  },
  {
    'Project Name': 'Sample Project',
    'Sub-Division': 'Civil',
    Site: 'Site A',
    'Scope 1': 'Installation',
    'Scope 2': 'Foundation',
    'Category 1': 'Civil Works',
    'Category 2': 'Foundation',
    'Category 3': 'Outdoor',
    'ERP SL NO': 'ERP-002',
    'BOQ SL No': '2.1',
    Description: 'Equipment foundation including reinforcement',
    Unit: 'Cum',
    QTY: 12.5,
    'Unit Rate': 8500,
    'Total Amount': 106250,
    'Budget Price': 8000,
    'F&I %': 3,
    'F&I Price': 240,
    'Total Budget Price': 100000,
    'Start Date': '2026-08-15',
    'End Date': '2026-09-05',
  },
];

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function isBlank(value: unknown) {
  return value === null || value === undefined || String(value).trim() === '';
}

function isEmptyRow(row: BoqItem) {
  return Object.values(row).every(isBlank);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function cellValueToString(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    if (Array.isArray(objectValue.richText)) {
      return (objectValue.richText as { text?: string }[])
        .map((part) => part.text ?? '')
        .join('')
        .trim();
    }
    if ('result' in objectValue) return cellValueToString(objectValue.result);
    if ('text' in objectValue) return String(objectValue.text ?? '').trim();
  }
  return String(value ?? '').trim();
}

function sanitizeCustomValue(value: unknown): string | number | boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return cellValueToString(value);
}

function worksheetToJson(worksheet: ExcelJS.Worksheet): {
  headers: string[];
  rows: BoqItem[];
} {
  const headerValues = (worksheet.getRow(1).values as unknown[]).slice(1);
  const usedHeaders = new Map<string, number>();
  const headers = headerValues.map((value, index) => {
    const base = cellValueToString(value) || `Column ${index + 1}`;
    const count = (usedHeaders.get(base) ?? 0) + 1;
    usedHeaders.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });

  const rows: BoqItem[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const values = (worksheet.getRow(rowNumber).values as unknown[]).slice(1);
    const row: BoqItem = {};
    headers.forEach((header, index) => {
      let value = values[index] ?? '';
      if (value && typeof value === 'object' && 'result' in value) {
        value = (value as { result?: unknown }).result ?? '';
      }
      row[header] = value;
    });
    if (!isEmptyRow(row)) {
      row.__excelRowNumber = rowNumber;
      rows.push(row);
    }
  }
  return { headers, rows };
}

function autoMapColumns(headers: string[], fields: ImportField[]): Record<string, string> {
  const result: Record<string, string> = {};
  const used = new Set<string>();

  for (const field of fields) {
    const candidates = [field.key, field.label, ...(field.aliases ?? [])].map(normalize);
    let match = headers.find(
      (header) => !used.has(header) && candidates.includes(normalize(header)),
    );
    if (!match) {
      match = headers.find((header) => {
        if (used.has(header)) return false;
        const normalizedHeader = normalize(header);
        return candidates.some(
          (candidate) =>
            candidate.length >= 5 &&
            (normalizedHeader.includes(candidate) || candidate.includes(normalizedHeader)),
        );
      });
    }
    if (match) {
      result[field.key] = match;
      used.add(match);
    }
  }
  return result;
}

function buildDateOnly(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return '';
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toDateOnly(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return buildDateOnly(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelDate = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
    return excelDate.toISOString().slice(0, 10);
  }
  const text = cellValueToString(value);
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return buildDateOnly(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }
  const indianMatch = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (indianMatch) {
    return buildDateOnly(Number(indianMatch[3]), Number(indianMatch[2]), Number(indianMatch[1]));
  }
  return '';
}

function parseNumber(value: unknown): { value: number; valid: boolean; empty: boolean } {
  if (isBlank(value)) return { value: 0, valid: true, empty: true };
  const numericValue =
    typeof value === 'number'
      ? value
      : Number(cellValueToString(value).replace(/,/g, '').trim());
  return {
    value: Number.isFinite(numericValue) ? numericValue : 0,
    valid: Number.isFinite(numericValue),
    empty: false,
  };
}

function StepIndicator({ currentStep }: { currentStep: ImportStep }) {
  const activeIndex = IMPORT_STEPS.findIndex((step) => step.key === currentStep);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {IMPORT_STEPS.map((step, index) => (
        <Fragment key={step.key}>
          {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium',
              index === activeIndex && 'bg-primary text-primary-foreground',
              index < activeIndex && 'bg-emerald-100 text-emerald-700',
              index > activeIndex && 'bg-muted text-muted-foreground',
            )}
          >
            {index + 1}. {step.label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export default function ImportBoqPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get('project') ?? '';
  const canImport = can('Import', 'Project Management.BOQ');

  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [configuredColumns, setConfiguredColumns] = useState<BoqColumnConfig[]>(() =>
    mergeBoqColumns(undefined),
  );
  const [projectSlug, setProjectSlug] = useState('');
  const [step, setStep] = useState<ImportStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [workbook, setWorkbook] = useState<ExcelJS.Workbook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<BoqItem[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([]);
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>('all');
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const importFields = useMemo<ImportField[]>(
    () =>
      configuredColumns
        .filter((column) => !NON_IMPORTABLE_COLUMN_KEYS.has(column.key))
        .map((column) => {
          const baseField = BASE_IMPORT_FIELDS_BY_KEY.get(column.key);
          return {
            key: column.key,
            label: column.label,
            type: column.dataType,
            required: baseField?.required,
            aliases: baseField?.aliases,
            hint: baseField?.hint,
          };
        }),
    [configuredColumns],
  );

  const templateHeaders = useMemo(
    () =>
      configuredColumns
        .filter((column) => !column.key.startsWith('JMC/MVAC '))
        .map((column) => column.key),
    [configuredColumns],
  );

  useEffect(() => {
    const loadColumnSettings = async () => {
      try {
        const snapshot = await getDoc(
          doc(db, BOQ_COLUMN_SETTINGS_COLLECTION, BOQ_COLUMN_SETTINGS_DOC),
        );
        setConfiguredColumns(mergeBoqColumns(snapshot.data()?.columns));
      } catch (error) {
        console.error('Failed to load BOQ validation types:', error);
        setConfiguredColumns(mergeBoqColumns(undefined));
      }
    };
    void loadColumnSettings();
  }, []);

  useEffect(() => {
    const fetchProject = async () => {
      if (!mappingId) return;
      try {
        const mappingSnapshot = await getDoc(
          doc(db, 'projectManagementProjects', mappingId),
        );
        if (!mappingSnapshot.exists()) throw new Error('Project mapping not found');
        const mapping = mappingSnapshot.data() as {
          globalProjectId?: string;
          globalProjectName?: string;
        };
        if (!mapping.globalProjectId) throw new Error('Global project is not mapped');

        const projectSnapshot = await getDoc(doc(db, 'projects', mapping.globalProjectId));
        if (!projectSnapshot.exists()) throw new Error('Mapped global project not found');
        const project = { id: projectSnapshot.id, ...projectSnapshot.data() } as Project;
        setCurrentProject(project);
        setProjectSlug(
          (project.projectName || mapping.globalProjectName || '')
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, ''),
        );
      } catch (error) {
        console.error('Failed to load mapped project:', error);
        toast({
          title: 'Unable to load project',
          description: 'The mapped global project could not be loaded.',
          variant: 'destructive',
        });
      }
    };
    void fetchProject();
  }, [mappingId, toast]);

  const resetImport = useCallback(() => {
    setStep('upload');
    setFile(null);
    setWorkbook(null);
    setSheetNames([]);
    setActiveSheet('');
    setHeaders([]);
    setRawRows([]);
    setColumnMap({});
    setValidatedRows([]);
    setValidationFilter('all');
    setIsParsing(false);
    setIsImporting(false);
    setProgress(0);
    setSummary(null);
    setFileInputKey((current) => current + 1);
  }, []);

  const parseSheet = useCallback(
    (selectedWorkbook: ExcelJS.Workbook, sheetName: string) => {
      const worksheet = selectedWorkbook.getWorksheet(sheetName);
      if (!worksheet) {
        toast({ title: 'Sheet not found', variant: 'destructive' });
        return;
      }
      const parsed = worksheetToJson(worksheet);
      if (!parsed.headers.length || !parsed.rows.length) {
        toast({
          title: 'No BOQ rows found',
          description: 'The selected sheet must contain a header row and at least one data row.',
          variant: 'destructive',
        });
        return;
      }
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setColumnMap(autoMapColumns(parsed.headers, importFields));
      setValidatedRows([]);
      setSummary(null);
      setValidationFilter('all');
      setStep('mapping');
    },
    [importFields, toast],
  );

  useEffect(() => {
    if (!headers.length) return;
    setColumnMap((current) => ({
      ...autoMapColumns(headers, importFields),
      ...current,
    }));
  }, [headers, importFields]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;
    if (!selectedFile.name.toLowerCase().endsWith('.xlsx')) {
      toast({
        title: 'Invalid file type',
        description: 'Please select an Excel .xlsx file.',
        variant: 'destructive',
      });
      return;
    }

    setIsParsing(true);
    try {
      const selectedWorkbook = new ExcelJS.Workbook();
      await selectedWorkbook.xlsx.load(await selectedFile.arrayBuffer());
      const names = selectedWorkbook.worksheets.map((worksheet) => worksheet.name);
      if (!names.length) throw new Error('The workbook does not contain any sheets.');
      setFile(selectedFile);
      setWorkbook(selectedWorkbook);
      setSheetNames(names);
      setActiveSheet(names[0]);
      parseSheet(selectedWorkbook, names[0]);
    } catch (error) {
      console.error('Failed to parse BOQ workbook:', error);
      toast({
        title: 'Unable to read workbook',
        description: error instanceof Error ? error.message : 'The Excel file could not be read.',
        variant: 'destructive',
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleSheetChange = (sheetName: string) => {
    if (!workbook) return;
    setActiveSheet(sheetName);
    parseSheet(workbook, sheetName);
  };

  const downloadTemplate = async (includeSamples: boolean) => {
    const templateWorkbook = new ExcelJS.Workbook();
    templateWorkbook.creator = 'SEL Project Management';
    const worksheet = templateWorkbook.addWorksheet('BOQ Import');
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.addRow(templateHeaders);

    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell, columnNumber) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2563EB' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getColumn(columnNumber).width = Math.min(
        Math.max(templateHeaders[columnNumber - 1].length + 4, 14),
        42,
      );
    });
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: templateHeaders.length },
    };

    if (includeSamples) {
      SAMPLE_ROWS.forEach((sample) => {
        worksheet.addRow(templateHeaders.map((header) => sample[header] ?? ''));
      });
      worksheet.getColumn(templateHeaders.indexOf('Description') + 1).width = 52;
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true };
      });
    }

    const instructions = templateWorkbook.addWorksheet('Instructions');
    instructions.columns = [
      { header: 'Field', key: 'field', width: 24 },
      { header: 'Data Type', key: 'dataType', width: 18 },
      { header: 'Requirement', key: 'requirement', width: 18 },
      { header: 'Validation / Notes', key: 'notes', width: 62 },
    ];
    importFields.forEach((field) => {
      let notes = field.hint ?? '';
      if (field.type === 'number') notes = `${notes}${notes ? '. ' : ''}Must be a non-negative number.`;
      if (field.type === 'percentage') notes = 'Percentage from 0 to 100.';
      if (field.key === 'Start Date') notes = 'Optional, but Start Date and End Date must be supplied together.';
      if (field.key === 'End Date') notes = 'Must be on or after Start Date.';
      instructions.addRow({
        field: field.key === field.label ? field.label : `${field.label} (${field.key})`,
        dataType: field.type,
        requirement: field.required ? 'Required' : 'Optional',
        notes,
      });
    });
    instructions.addRow({
      field: 'F&I Price',
      dataType: 'number',
      requirement: 'Calculated',
      notes: 'Calculated during import: Budget Price × F&I % ÷ 100.',
    });
    instructions.addRow({
      field: 'Total Budget Price',
      dataType: 'number',
      requirement: 'Calculated',
      notes: 'Calculated during import: Budget Price × QTY.',
    });
    instructions.addRow({
      field: 'Custom columns',
      dataType: 'Configured in BOQ Settings',
      requirement: 'Optional',
      notes: 'Any source column not used in column mapping is preserved using its original heading.',
    });
    instructions.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    });
    instructions.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await templateWorkbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = includeSamples ? 'boq-import-sample.xlsx' : 'boq-import-template.xlsx';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const mappedSourceColumns = useMemo(
    () => new Set(Object.values(columnMap).filter(Boolean)),
    [columnMap],
  );

  const duplicateMappedColumns = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(columnMap)
      .filter(Boolean)
      .forEach((column) => counts.set(column, (counts.get(column) ?? 0) + 1));
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([column]) => column),
    );
  }, [columnMap]);

  const missingRequiredMappings = useMemo(
    () => importFields.filter((field) => field.required && !columnMap[field.key]),
    [columnMap, importFields],
  );

  const customColumns = useMemo(
    () =>
      headers.filter(
        (header) =>
          !mappedSourceColumns.has(header) &&
          !CALCULATED_COLUMN_KEYS.has(normalizeCalculatedColumn(header)),
      ),
    [headers, mappedSourceColumns],
  );

  const buildValidation = () => {
    if (missingRequiredMappings.length || duplicateMappedColumns.size) {
      toast({
        title: 'Fix column mapping',
        description: missingRequiredMappings.length
          ? `Map the required field${missingRequiredMappings.length === 1 ? '' : 's'}: ${missingRequiredMappings.map((field) => field.label).join(', ')}.`
          : 'Each Excel column can only be mapped to one BOQ field.',
        variant: 'destructive',
      });
      return;
    }

    const nextRows: ValidatedRow[] = rawRows.map((rawRow, rowIndex) => {
      const data: BoqItem = {};
      const errors: string[] = [];

      customColumns.forEach((column) => {
        data[column] = sanitizeCustomValue(rawRow[column]);
      });

      importFields.forEach((field) => {
        const sourceColumn = columnMap[field.key];
        const rawValue = sourceColumn ? rawRow[sourceColumn] : '';

        if (field.type === 'text') {
          const value = cellValueToString(rawValue);
          data[field.key] = value;
          if (field.required && !value) errors.push(`${field.label} is required.`);
          return;
        }

        if (field.type === 'number' || field.type === 'percentage') {
          const parsed = parseNumber(rawValue);
          data[field.key] = parsed.value;
          if (field.required && parsed.empty) errors.push(`${field.label} is required.`);
          if (!parsed.valid && field.key !== 'Budget Price') {
            errors.push(`${field.label} must be a valid number.`);
          }
          if (parsed.valid && !parsed.empty && parsed.value < 0) {
            errors.push(`${field.label} cannot be negative.`);
          }
          if (field.type === 'percentage' && parsed.valid && parsed.value > 100) {
            errors.push(`${field.label} cannot be greater than 100.`);
          }
          return;
        }

        const dateText = cellValueToString(rawValue);
        const dateValue = toDateOnly(rawValue);
        data[field.key] = dateValue;
        if (dateText && !dateValue) {
          errors.push(`${field.label} is not a valid date.`);
        }
      });

      if (!data['Project Name']) data['Project Name'] = currentProject?.projectName ?? '';

      const quantity = Number(data.QTY ?? 0);
      const unitRate = Number(data['Unit Rate'] ?? 0);
      if (
        !data['Total Amount'] &&
        Number.isFinite(quantity) &&
        Number.isFinite(unitRate) &&
        quantity &&
        unitRate
      ) {
        data['Total Amount'] = Math.round(quantity * unitRate * 100) / 100;
      }

      const parsedBudgetPrice = Number(data['Budget Price'] ?? 0);
      const parsedFiPercentage = Number(data['F&I %'] ?? 0);
      const budgetPrice = Number.isFinite(parsedBudgetPrice) ? parsedBudgetPrice : 0;
      const fiPercentage = Number.isFinite(parsedFiPercentage) ? parsedFiPercentage : 0;
      const fiPrice = Math.round(((budgetPrice * fiPercentage) / 100) * 100) / 100;
      data['F&I Price'] = fiPrice;
      data['Total Budget Price'] = Math.round(budgetPrice * quantity * 100) / 100;

      const startDate = String(data['Start Date'] ?? '');
      const endDate = String(data['End Date'] ?? '');
      if (Boolean(startDate) !== Boolean(endDate)) {
        errors.push('Start Date and End Date must be supplied together.');
      } else if (startDate && endDate && endDate < startDate) {
        errors.push('End Date cannot be before Start Date.');
      }

      return {
        rowNumber: Number(rawRow.__excelRowNumber ?? rowIndex + 2),
        data,
        errors,
        valid: errors.length === 0,
      };
    });

    setValidatedRows(nextRows);
    setValidationFilter('all');
    setStep('validation');
  };

  const validRows = useMemo(
    () => validatedRows.filter((row) => row.valid),
    [validatedRows],
  );
  const invalidRows = useMemo(
    () => validatedRows.filter((row) => !row.valid),
    [validatedRows],
  );
  const filteredValidationRows = useMemo(() => {
    if (validationFilter === 'valid') return validRows;
    if (validationFilter === 'invalid') return invalidRows;
    return validatedRows;
  }, [invalidRows, validRows, validatedRows, validationFilter]);

  const handleImport = async () => {
    if (!user || !currentProject || !validRows.length) {
      toast({
        title: 'Nothing to import',
        description: 'A project, signed-in user, and at least one valid BOQ row are required.',
        variant: 'destructive',
      });
      return;
    }

    setIsImporting(true);
    setProgress(0);
    let importedRows = 0;
    let processedRows = 0;
    const failedRows: { rowNumber: number; message: string }[] = [];
    const rowChunks = chunk(validRows, MAX_BATCH_WRITES);
    const boqCollection = collection(db, 'projects', currentProject.id, 'boqItems');

    for (const rows of rowChunks) {
      const batch = writeBatch(db);
      rows.forEach((row) => {
        batch.set(doc(boqCollection), {
          ...row.data,
          createdAt: serverTimestamp(),
          createdBy: user.id,
          source: 'excel_import',
          fileName: file?.name ?? '',
        });
      });

      try {
        await batch.commit();
        importedRows += rows.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Firestore batch failed.';
        rows.forEach((row) => failedRows.push({ rowNumber: row.rowNumber, message }));
      }
      processedRows += rows.length;
      setProgress(Math.round((processedRows / validRows.length) * 100));
    }

    const nextSummary: ImportSummary = {
      totalRows: validatedRows.length,
      validRows: validRows.length,
      importedRows,
      skippedRows: invalidRows.length,
      failedRows,
    };
    setSummary(nextSummary);
    setStep('summary');

    try {
      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: 'Project Management',
        action: 'Import BOQ',
        details: {
          project: projectSlug,
          fileName: file?.name || 'N/A',
          sheet: activeSheet,
          totalRows: validatedRows.length,
          importedRows,
          skippedRows: invalidRows.length,
          failedRows: failedRows.length,
          columnMap,
        },
      });
    } catch (error) {
      console.error('Failed to log BOQ import activity:', error);
    }

    toast({
      title: importedRows ? 'BOQ import completed' : 'BOQ import failed',
      description: `${importedRows} imported, ${invalidRows.length} skipped, ${failedRows.length} failed.`,
      variant: importedRows ? 'default' : 'destructive',
    });
    setIsImporting(false);
  };

  if (isAuthLoading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canImport) {
    return (
      <main className="p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to import Project Management BOQs.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management/boq?project=${encodeURIComponent(mappingId)}`} aria-label="Back to BOQ">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm">
            <UploadCloud className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Import BOQ</h1>
            <p className="text-sm text-muted-foreground">
              Map, validate, and import BOQ data into {currentProject?.projectName ?? 'the selected project'}.
            </p>
          </div>
        </div>
        <StepIndicator currentStep={step} />
      </div>

      {step === 'upload' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-primary" />
                Upload Excel BOQ
              </CardTitle>
              <CardDescription>
                Upload an .xlsx workbook. You will map its columns before any data is imported.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border-2 border-dashed p-8 text-center">
                <FileSpreadsheet className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
                <p className="font-medium">Select your BOQ workbook</p>
                <p className="mb-4 mt-1 text-sm text-muted-foreground">Excel .xlsx files only</p>
                <Input
                  key={fileInputKey}
                  type="file"
                  accept=".xlsx"
                  onChange={handleFileChange}
                  disabled={isParsing}
                  className="mx-auto max-w-md cursor-pointer"
                />
                {isParsing && (
                  <p className="mt-3 flex items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading workbook…
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                BOQ Templates
              </CardTitle>
              <CardDescription>
                Use the blank format or download sample rows showing valid values.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full justify-start" onClick={() => void downloadTemplate(false)}>
                <TableProperties className="mr-2 h-4 w-4" /> Download Blank Template
              </Button>
              <Button variant="outline" className="w-full justify-start" onClick={() => void downloadTemplate(true)}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Download Sample Template
              </Button>
              <p className="text-xs text-muted-foreground">
                Both files include an Instructions sheet. Calculated F&amp;I fields are regenerated during import.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 'mapping' && (
        <Card>
          <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Column Mapping</CardTitle>
              <CardDescription className="mt-1">
                {file?.name} · {rawRows.length} rows · {headers.length} source columns
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {sheetNames.length > 1 && (
                <Select value={activeSheet} onValueChange={handleSheetChange}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sheetNames.map((sheet) => <SelectItem key={sheet} value={sheet}>{sheet}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" onClick={() => setColumnMap(autoMapColumns(headers, importFields))}>
                <RotateCcw className="mr-2 h-4 w-4" /> Auto-map
              </Button>
              <Button variant="ghost" onClick={resetImport}>Change File</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>BOQ field</TableHead>
                    <TableHead>Source Excel column</TableHead>
                    <TableHead>Sample value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importFields.map((field) => {
                    const mappedColumn = columnMap[field.key] ?? '';
                    const duplicate = duplicateMappedColumns.has(mappedColumn);
                    return (
                      <TableRow key={field.key}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">
                              {field.label}{field.required && <span className="ml-1 text-destructive">*</span>}
                            </p>
                            <Badge variant="outline" className="capitalize">{field.type}</Badge>
                          </div>
                          {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                        </TableCell>
                        <TableCell className="min-w-64">
                          <Select
                            value={mappedColumn || SKIP_COLUMN}
                            onValueChange={(value) =>
                              setColumnMap((current) => ({
                                ...current,
                                [field.key]: value === SKIP_COLUMN ? '' : value,
                              }))
                            }
                          >
                            <SelectTrigger><SelectValue placeholder="Skip this field" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SKIP_COLUMN}>— Not mapped —</SelectItem>
                              {headers.map((header) => (
                                <SelectItem
                                  key={header}
                                  value={header}
                                  disabled={mappedSourceColumns.has(header) && mappedColumn !== header}
                                >
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="max-w-56 truncate text-sm text-muted-foreground">
                          {mappedColumn ? cellValueToString(rawRows[0]?.[mappedColumn]) || 'Empty' : '—'}
                        </TableCell>
                        <TableCell>
                          {duplicate ? (
                            <Badge variant="destructive">Duplicate mapping</Badge>
                          ) : mappedColumn ? (
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Mapped</Badge>
                          ) : field.required ? (
                            <Badge variant="destructive">Required</Badge>
                          ) : (
                            <Badge variant="outline">Skipped</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {customColumns.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-4">
                <p className="text-sm font-medium text-blue-800">Custom columns preserved</p>
                <p className="mt-1 text-xs text-blue-700">
                  Unmapped columns will be imported with their original headings and remain configurable in BOQ settings.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {customColumns.map((column) => <Badge key={column} variant="outline" className="bg-white">{column}</Badge>)}
                </div>
              </div>
            )}

            {(missingRequiredMappings.length > 0 || duplicateMappedColumns.size > 0) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {missingRequiredMappings.length > 0
                  ? `Map required fields: ${missingRequiredMappings.map((field) => field.label).join(', ')}.`
                  : 'A source column is mapped more than once. Select a unique source for each BOQ field.'}
              </div>
            )}

            <div className="flex justify-between gap-3">
              <Button variant="outline" onClick={resetImport}>Cancel</Button>
              <Button
                onClick={buildValidation}
                disabled={missingRequiredMappings.length > 0 || duplicateMappedColumns.size > 0}
              >
                Validate Data <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'validation' && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Data Validation</CardTitle>
                <CardDescription>Review row-level errors before importing valid BOQ items.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> {validRows.length} valid
                </Badge>
                <Badge className={cn(invalidRows.length ? 'bg-red-100 text-red-700 hover:bg-red-100' : 'bg-muted text-muted-foreground')}>
                  <XCircle className="mr-1 h-3.5 w-3.5" /> {invalidRows.length} invalid
                </Badge>
                <Badge variant="outline">{validatedRows.length} total</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-1 rounded-lg bg-muted p-1 sm:w-fit">
              {(['all', 'valid', 'invalid'] as ValidationFilter[]).map((filter) => (
                <Button
                  key={filter}
                  size="sm"
                  variant={validationFilter === filter ? 'default' : 'ghost'}
                  onClick={() => setValidationFilter(filter)}
                  className="capitalize"
                >
                  {filter}
                </Button>
              ))}
            </div>

            <div className="max-h-[55vh] overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Excel row</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>BOQ SL No</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>QTY</TableHead>
                    <TableHead>Unit Rate</TableHead>
                    <TableHead>Budget Price</TableHead>
                    <TableHead>F&amp;I %</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>End Date</TableHead>
                    <TableHead>Validation details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredValidationRows.length ? filteredValidationRows.map((row) => (
                    <TableRow key={row.rowNumber} className={cn(!row.valid && 'bg-red-50/60')}>
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell>
                        {row.valid ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-600" />
                        )}
                      </TableCell>
                      <TableCell>{String(row.data['BOQ SL No'] ?? '')}</TableCell>
                      <TableCell className="max-w-64 truncate" title={String(row.data.Description ?? '')}>
                        {String(row.data.Description ?? '')}
                      </TableCell>
                      <TableCell>{String(row.data.QTY ?? '')}</TableCell>
                      <TableCell>{String(row.data['Unit Rate'] ?? '')}</TableCell>
                      <TableCell>{String(row.data['Budget Price'] ?? '')}</TableCell>
                      <TableCell>{String(row.data['F&I %'] ?? '')}</TableCell>
                      <TableCell>{String(row.data['Start Date'] ?? '') || '—'}</TableCell>
                      <TableCell>{String(row.data['End Date'] ?? '') || '—'}</TableCell>
                      <TableCell className="min-w-72">
                        {row.valid ? (
                          <span className="text-sm text-emerald-700">Passed all validations</span>
                        ) : (
                          <ul className="list-disc space-y-1 pl-4 text-xs text-red-700">
                            {row.errors.map((error, index) => <li key={`${row.rowNumber}-${index}`}>{error}</li>)}
                          </ul>
                        )}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={11} className="h-28 text-center">No rows match this filter.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {invalidRows.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Invalid rows will be skipped. Return to column mapping or correct the Excel file to import them.
              </div>
            )}

            {isImporting && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span>Importing valid rows…</span><span>{progress}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse justify-between gap-3 sm:flex-row">
              <Button variant="outline" onClick={() => setStep('mapping')} disabled={isImporting}>Back to Mapping</Button>
              <Button onClick={() => void handleImport()} disabled={!validRows.length || isImporting}>
                {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                Import {validRows.length} Valid Row{validRows.length === 1 ? '' : 's'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'summary' && summary && (
        <Card>
          <CardHeader>
            <CardTitle>Import Summary</CardTitle>
            <CardDescription>{file?.name} · {activeSheet} · {currentProject?.projectName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border bg-muted/30 p-4 text-center">
                <p className="text-3xl font-bold">{summary.totalRows}</p><p className="text-sm text-muted-foreground">Rows Read</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                <p className="text-3xl font-bold text-emerald-700">{summary.importedRows}</p><p className="text-sm text-emerald-700">Imported</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
                <p className="text-3xl font-bold text-amber-700">{summary.skippedRows}</p><p className="text-sm text-amber-700">Skipped by Validation</p>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                <p className="text-3xl font-bold text-red-700">{summary.failedRows.length}</p><p className="text-sm text-red-700">Import Failed</p>
              </div>
            </div>

            {summary.importedRows > 0 && summary.failedRows.length === 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                <div><p className="font-medium">Import completed successfully</p><p className="text-sm">All valid BOQ rows were written to the mapped project.</p></div>
              </div>
            )}

            {summary.failedRows.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="mb-2 font-medium text-red-800">Firestore import failures</p>
                <div className="max-h-48 space-y-1 overflow-y-auto text-sm text-red-700">
                  {summary.failedRows.map((failure) => (
                    <p key={`${failure.rowNumber}-${failure.message}`}>Excel row {failure.rowNumber}: {failure.message}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse justify-between gap-3 sm:flex-row">
              <Button variant="outline" onClick={resetImport}>Import Another File</Button>
              <Button asChild>
                <Link href={`/project-management/boq/costing?project=${encodeURIComponent(mappingId)}`}>
                  View BOQ Costing <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
