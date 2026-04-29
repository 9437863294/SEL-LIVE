'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import ExcelJS from 'exceljs';
import { Download, Upload, History, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

export type CrudFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'file';

export interface CrudFieldConfig {
  key: string;
  label: string;
  type: CrudFieldType;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
  step?: string;
  accept?: string;
  showWhen?: (context: {
    formState: Record<string, string>;
    editingRow: Record<string, any> | null;
  }) => boolean;
}

export interface CrudColumnConfig {
  key: string;
  label: string;
  formatter?: (value: any, row: Record<string, any>) => React.ReactNode;
}

interface GenericCrudPageProps {
  title: string;
  description: string;
  itemName: string;
  collectionName: string;
  fields: CrudFieldConfig[];
  columns: CrudColumnConfig[];
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canImport?: boolean;
  canExport?: boolean;
  exportFileName?: string;
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
  emptyMessage?: string;
  /** Pre-fill values when opening Add dialog (used by Renewals Hub "Renew Now" flow) */
  initialPrefill?: Record<string, string>;
  /** Firestore doc ID of the expired record being renewed — will be marked Archived after save */
  renewingFromId?: string;
  onBeforeSave?: (payload: Record<string, any>, currentRow: Record<string, any> | null) => Record<string, any>;
  onAfterFetch?: (rows: Record<string, any>[]) => Record<string, any>[];
  onAfterSave?: (args: {
    id: string;
    mode: 'create' | 'update';
    payload: Record<string, any>;
    previousRow: Record<string, any> | null;
  }) => Promise<void> | void;
}

const toDisplay = (value: any) => {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const normalizeToken = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const excelSerialToDate = (serial: number) => {
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
};

const toIsoDate = (value: any): string => {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const converted = excelSerialToDate(value);
    if (!Number.isNaN(converted.getTime())) {
      return converted.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
};

const extractCellPrimitive = (cellValue: any): string => {
  if (cellValue === null || cellValue === undefined) return '';
  if (typeof cellValue === 'object') {
    if (cellValue?.text) return String(cellValue.text);
    if (cellValue?.result !== undefined && cellValue?.result !== null) return String(cellValue.result);
    if (cellValue instanceof Date) return cellValue.toISOString().slice(0, 10);
    return '';
  }
  return String(cellValue);
};

const buildInitialForm = (fields: CrudFieldConfig[], row: Record<string, any> | null): Record<string, string> => {
  const next: Record<string, string> = {};
  fields.forEach((field) => {
    const rowValue = row ? row[field.key] : undefined;
    if (rowValue !== null && rowValue !== undefined && rowValue !== '') {
      next[field.key] = String(rowValue);
      return;
    }
    if (!row && field.defaultValue !== undefined) {
      next[field.key] = field.defaultValue;
      return;
    }
    if (!row && field.type === 'select' && field.options && field.options.length > 0) {
      next[field.key] = field.options[0].value;
      return;
    }
    next[field.key] = '';
  });
  return next;
};

const isFieldVisible = (
  field: CrudFieldConfig,
  formState: Record<string, string>,
  editingRow: Record<string, any> | null
) => {
  if (!field.showWhen) return true;
  return field.showWhen({ formState, editingRow });
};

export default function GenericCrudPage({
  title,
  description,
  itemName,
  collectionName,
  fields,
  columns,
  canView,
  canAdd,
  canEdit,
  canDelete,
  canImport,
  canExport,
  exportFileName,
  defaultSort,
  emptyMessage = 'No records found.',
  initialPrefill,
  renewingFromId,
  onBeforeSave,
  onAfterFetch,
  onAfterSave,
}: GenericCrudPageProps) {
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get('tab') === 'history' ? 'history' : 'active';

  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>(initialTab);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Record<string, any> | null>(null);
  const [deleteRow, setDeleteRow] = useState<Record<string, any> | null>(null);
  const [formState, setFormState] = useState<Record<string, string>>(buildInitialForm(fields, null));
  const [fileState, setFileState] = useState<Record<string, File | null>>({});
  const [isRenewalMode, setIsRenewalMode] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const prefillApplied = useRef(false);

  const allowImport = canImport ?? canAdd;
  const allowExport = canExport ?? canView;

  const loadRows = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, collectionName));
      let mapped: Record<string, any>[] = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      if (onAfterFetch) {
        mapped = onAfterFetch(mapped);
      }
      if (defaultSort) {
        mapped.sort((a, b) => {
          const aValue = a[defaultSort.key];
          const bValue = b[defaultSort.key];
          if (aValue === bValue) return 0;
          if (aValue === undefined || aValue === null) return 1;
          if (bValue === undefined || bValue === null) return -1;
          const compare = String(aValue).localeCompare(String(bValue), undefined, { numeric: true });
          return defaultSort.direction === 'asc' ? compare : -compare;
        });
      }
      setRows(mapped);
    } catch (error) {
      console.error(`Failed to load ${collectionName}`, error);
      toast({
        title: 'Error',
        description: `Unable to load ${itemName.toLowerCase()} records.`,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open Add dialog when initialPrefill is provided (Renew Now flow)
  useEffect(() => {
    if (!initialPrefill || prefillApplied.current || !canAdd) return;
    prefillApplied.current = true;
    const merged = buildInitialForm(fields, null);
    Object.entries(initialPrefill).forEach(([k, v]) => {
      if (v !== undefined && v !== '') merged[k] = v;
    });
    setEditingRow(null);
    setFormState(merged);
    setFileState({});
    setIsRenewalMode(true);
    setDialogOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrefill, canAdd]);

  const filteredRows = useMemo(() => {
    let base = rows;
    if (activeTab === 'history') {
      base = base.filter((r) => r.isArchived === true);
    } else {
      base = base.filter((r) => r.isArchived !== true);
    }

    const term = query.trim().toLowerCase();
    if (!term) return base;
    return base.filter((row) =>
      columns.some((column) => toDisplay(row[column.key]).toLowerCase().includes(term))
    );
  }, [rows, columns, query, activeTab]);

  const triggerImport = () => {
    if (!allowImport || isImporting) return;
    importInputRef.current?.click();
  };

  const exportExcel = async () => {
    if (!allowExport || isExporting) return;
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(itemName);
      const exportFields = fields;
      worksheet.columns = exportFields.map((field) => ({
        header: field.label,
        key: field.key,
        width: Math.max(16, field.label.length + 2),
      }));

      filteredRows.forEach((row) => {
        const record: Record<string, any> = {};
        exportFields.forEach((field) => {
          const value = row[field.key];
          if (field.type === 'date') {
            record[field.key] = toIsoDate(value);
            return;
          }
          record[field.key] = value === null || value === undefined ? '' : extractCellPrimitive(value);
        });
        worksheet.addRow(record);
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${exportFileName || collectionName}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({
        title: 'Export Complete',
        description: `${filteredRows.length} ${itemName.toLowerCase()} record(s) exported.`,
      });
    } catch (error) {
      console.error(`Failed to export ${collectionName}`, error);
      toast({
        title: 'Export Failed',
        description: `Unable to export ${itemName.toLowerCase()} records.`,
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const importExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast({
        title: 'Invalid File',
        description: 'Please upload a valid Excel file (.xlsx).',
        variant: 'destructive',
      });
      event.target.value = '';
      return;
    }

    setIsImporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const buffer = await file.arrayBuffer();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      if (!worksheet) {
        throw new Error('No worksheet found in the uploaded file.');
      }

      const fieldByToken = new Map<string, CrudFieldConfig>();
      fields.forEach((field) => {
        fieldByToken.set(normalizeToken(field.key), field);
        fieldByToken.set(normalizeToken(field.label), field);
      });

      const columnFieldMap: Record<number, CrudFieldConfig> = {};
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        const token = normalizeToken(extractCellPrimitive(cell.value));
        const field = fieldByToken.get(token);
        if (field) columnFieldMap[colNumber] = field;
      });

      if (Object.keys(columnFieldMap).length === 0) {
        throw new Error('No valid column headers found. Use field labels as Excel headers.');
      }

      let imported = 0;
      let skipped = 0;
      const skippedReasons: string[] = [];
      const selectOptionMaps: Record<string, Record<string, string>> = {};

      fields.forEach((field) => {
        if (field.type !== 'select' || !field.options) return;
        const optionMap: Record<string, string> = {};
        field.options.forEach((option) => {
          optionMap[normalizeToken(option.value)] = option.value;
          optionMap[normalizeToken(option.label)] = option.value;
        });
        selectOptionMaps[field.key] = optionMap;
      });

      for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
        const row = worksheet.getRow(rowIndex);
        const payload: Record<string, any> = {};
        let hasAnyValue = false;

        fields.forEach((field) => {
          if (field.defaultValue !== undefined) {
            payload[field.key] = field.defaultValue;
          } else {
            payload[field.key] = '';
          }
        });

        Object.entries(columnFieldMap).forEach(([columnNo, field]) => {
          const cellValue = row.getCell(Number(columnNo)).value;
          const rawText = extractCellPrimitive(cellValue).trim();
          if (rawText !== '') hasAnyValue = true;

          if (field.type === 'date') {
            payload[field.key] = toIsoDate(cellValue) || toIsoDate(rawText);
            return;
          }

          if (field.type === 'number') {
            if (rawText === '') {
              payload[field.key] = '';
              return;
            }
            const parsed = Number(rawText);
            payload[field.key] = Number.isFinite(parsed) ? parsed : rawText;
            return;
          }

          if (field.type === 'select') {
            const optionMap = selectOptionMaps[field.key] || {};
            payload[field.key] = optionMap[normalizeToken(rawText)] || rawText;
            return;
          }

          payload[field.key] = rawText;
        });

        if (!hasAnyValue) continue;

        const validationErrors: string[] = [];
        fields.forEach((field) => {
          const value = payload[field.key];
          const isEmpty = value === '' || value === null || value === undefined;
          if (field.required && isEmpty) {
            validationErrors.push(`${field.label} is required`);
          }
          if (field.type === 'number' && !isEmpty && !Number.isFinite(Number(value))) {
            validationErrors.push(`${field.label} must be numeric`);
          }
        });

        if (validationErrors.length > 0) {
          skipped += 1;
          if (skippedReasons.length < 5) {
            skippedReasons.push(`Row ${rowIndex}: ${validationErrors.join(', ')}`);
          }
          continue;
        }

        const finalPayload = onBeforeSave ? onBeforeSave(payload, null) : payload;
        const createdRef = await addDoc(collection(db, collectionName), {
          ...finalPayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (onAfterSave) {
          try {
            await onAfterSave({
              id: createdRef.id,
              mode: 'create',
              payload: finalPayload,
              previousRow: null,
            });
          } catch (error) {
            console.error(`Post-import hook failed for row ${rowIndex}`, error);
          }
        }

        imported += 1;
      }

      await loadRows();

      const extra =
        skippedReasons.length > 0
          ? ` Skipped: ${skipped}. ${skippedReasons.join(' | ')}`
          : skipped > 0
          ? ` Skipped: ${skipped}.`
          : '';

      toast({
        title: 'Import Complete',
        description: `Imported ${imported} record(s).${extra}`,
      });
    } catch (error: any) {
      console.error(`Failed to import ${collectionName}`, error);
      toast({
        title: 'Import Failed',
        description: error?.message || `Unable to import ${itemName.toLowerCase()} data.`,
        variant: 'destructive',
      });
    } finally {
      event.target.value = '';
      setIsImporting(false);
    }
  };

  const openAddDialog = () => {
    if (!canAdd) return;
    setEditingRow(null);
    setFormState(buildInitialForm(fields, null));
    setFileState({});
    setDialogOpen(true);
  };

  const openEditDialog = (row: Record<string, any>) => {
    if (!canEdit) return;
    setEditingRow(row);
    setFormState(buildInitialForm(fields, row));
    setFileState({});
    setDialogOpen(true);
  };

  const submitForm = async () => {
    if (isSaving) return;
    const payload: Record<string, any> = {};
    const fileFields = fields.filter((field) => field.type === 'file');
    for (const field of fields) {
      const visible = isFieldVisible(field, formState, editingRow);
      if (!visible) {
        if (field.type === 'file') {
          payload[field.key] = '';
        } else if (field.type === 'number') {
          payload[field.key] = '';
        } else {
          payload[field.key] = '';
        }
        continue;
      }

      const raw = (formState[field.key] ?? '').trim();
      if (field.required && raw === '') {
        if (field.type !== 'file' || !fileState[field.key]) {
          toast({
            title: 'Validation Error',
            description: `${field.label} is required.`,
            variant: 'destructive',
          });
          return;
        }
      }

      if (field.type === 'file') {
        payload[field.key] = raw;
        continue;
      }

      if (field.required && raw === '') {
        toast({
          title: 'Validation Error',
          description: `${field.label} is required.`,
          variant: 'destructive',
        });
        return;
      }

      if (field.type === 'number') {
        if (raw === '') {
          payload[field.key] = '';
        } else {
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) {
            toast({
              title: 'Validation Error',
              description: `${field.label} must be a valid number.`,
              variant: 'destructive',
            });
            return;
          }
          payload[field.key] = parsed;
        }
      } else {
        payload[field.key] = raw;
      }
    }

    const finalPayload = onBeforeSave ? onBeforeSave(payload, editingRow) : payload;

    try {
      setIsSaving(true);
      const payloadWithUploads = { ...finalPayload };

      for (const field of fileFields) {
        const file = fileState[field.key];
        if (!file) continue;
        const safeName = file.name.replace(/\s+/g, '-');
        const rowKey = editingRow?.id || `new-${Date.now()}`;
        const uploadRef = ref(
          storage,
          `vehicle-management/${collectionName}/${rowKey}/${Date.now()}-${safeName}`
        );
        await uploadBytes(uploadRef, file);
        payloadWithUploads[field.key] = await getDownloadURL(uploadRef);
      }

      const mode: 'create' | 'update' = editingRow ? 'update' : 'create';
      let savedId = '';
      if (editingRow) {
        await updateDoc(doc(db, collectionName, editingRow.id as string), {
          ...payloadWithUploads,
          updatedAt: serverTimestamp(),
        });
        savedId = editingRow.id as string;
        toast({ title: 'Updated', description: `${itemName} updated successfully.` });
      } else {
        const createdRef = await addDoc(collection(db, collectionName), {
          ...payloadWithUploads,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        savedId = createdRef.id;
        toast({ title: 'Created', description: `${itemName} created successfully.` });
      }

      if (onAfterSave && savedId) {
        try {
          await onAfterSave({
            id: savedId,
            mode,
            payload: payloadWithUploads,
            previousRow: editingRow,
          });
        } catch (error) {
          console.error(`Post-save hook failed for ${collectionName}`, error);
          toast({
            title: 'Saved With Warning',
            description: `${itemName} was saved, but a related update failed.`,
            variant: 'destructive',
          });
        }
      }

      // Renewal flow: archive the old expired record
      if (mode === 'create' && isRenewalMode && renewingFromId) {
        try {
          await updateDoc(doc(db, collectionName, renewingFromId), {
            renewalStatus: 'Renewed',
            renewedById: savedId,
            renewedAt: serverTimestamp(),
            isArchived: true,
          });
        } catch (err) {
          console.error('Failed to archive old record', err);
        }
      }

      setDialogOpen(false);
      setEditingRow(null);
      setIsRenewalMode(false);
      setFormState(buildInitialForm(fields, null));
      setFileState({});
      loadRows();
    } catch (error) {
      console.error(`Failed to save ${collectionName}`, error);
      toast({
        title: 'Error',
        description: `Unable to save ${itemName.toLowerCase()}.`,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    try {
      await deleteDoc(doc(db, collectionName, deleteRow.id as string));
      toast({ title: 'Deleted', description: `${itemName} deleted successfully.` });
      setDeleteRow(null);
      loadRows();
    } catch (error) {
      console.error(`Failed to delete ${collectionName}`, error);
      toast({
        title: 'Error',
        description: `Unable to delete ${itemName.toLowerCase()}.`,
        variant: 'destructive',
      });
    }
  };

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view this section.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 animate-bb-gradient" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="tracking-tight">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Badge variant="outline" className="bg-white/70">
              {rows.length} records
            </Badge>
            <Button variant="outline" onClick={loadRows} className="bg-white/80 hover:bg-white">
              Refresh
            </Button>
            {allowExport && (
              <Button variant="outline" onClick={exportExcel} disabled={isExporting} className="bg-white/80 hover:bg-white">
                <Download className="mr-2 h-4 w-4" />
                {isExporting ? 'Exporting...' : 'Export Excel'}
              </Button>
            )}
            {allowImport && (
              <>
                <Input
                  ref={importInputRef}
                  type="file"
                  accept=".xlsx"
                  onChange={importExcel}
                  className="hidden"
                />
                <Button variant="outline" onClick={triggerImport} disabled={isImporting} className="bg-white/80 hover:bg-white">
                  <Upload className="mr-2 h-4 w-4" />
                  {isImporting ? 'Importing...' : 'Import Excel'}
                </Button>
              </>
            )}
            <Button
              onClick={openAddDialog}
              disabled={!canAdd}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_16px_36px_-22px_rgba(14,116,205,0.85)] hover:from-cyan-600 hover:to-blue-700"
            >
              Add {itemName}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              placeholder={`Search ${itemName.toLowerCase()}...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-white/80 border-white/70 focus-visible:ring-cyan-400/40 w-full sm:max-w-xs"
            />
            <div className="flex items-center gap-1 rounded-lg bg-white/50 p-1 border border-white/70 shadow-sm w-fit">
              <button
                onClick={() => setActiveTab('active')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all',
                  activeTab === 'active' ? 'bg-white shadow-sm text-cyan-700' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                )}
              >
                <List className="h-3.5 w-3.5" />
                Active
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all',
                  activeTab === 'history' ? 'bg-white shadow-sm text-cyan-700' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                )}
              >
                <History className="h-3.5 w-3.5" />
                History
              </button>
            </div>
          </div>
          <div className="space-y-3 sm:hidden">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-32 w-full rounded-xl" />)
            ) : filteredRows.length === 0 ? (
              <div className="rounded-xl border border-white/70 bg-white/85 px-3 py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              filteredRows.map((row) => (
                <div key={row.id as string} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                  <div className="space-y-2">
                    {columns.map((column) => (
                      <div key={column.key} className="flex items-start justify-between gap-3">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {column.label}
                        </span>
                        <span className="max-w-[64%] text-right text-sm">
                          {column.formatter ? column.formatter(row[column.key], row) : toDisplay(row[column.key])}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(row)} disabled={!canEdit} className="bg-white/80">
                      Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setDeleteRow(row)} disabled={!canDelete}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-white/70 bg-white/80 sm:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  {columns.map((column) => (
                    <TableHead key={column.key}>{column.label}</TableHead>
                  ))}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell colSpan={columns.length + 1}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length + 1} className="h-20 text-center text-muted-foreground">
                      {emptyMessage}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => (
                    <TableRow key={row.id as string} className="hover:bg-cyan-50/70 transition-colors">
                      {columns.map((column) => (
                        <TableCell key={column.key}>
                          {column.formatter
                            ? column.formatter(row[column.key], row)
                            : toDisplay(row[column.key])}
                        </TableCell>
                      ))}
                      <TableCell className="space-x-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(row)} disabled={!canEdit} className="bg-white/80">
                          Edit
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeleteRow(row)} disabled={!canDelete}>
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditingRow(null);
            setFormState(buildInitialForm(fields, null));
            setFileState({});
            return;
          }
          setDialogOpen(true);
        }}
      >
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto vm-panel-strong">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isRenewalMode && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Renewing Expired Record
                </span>
              )}
              {editingRow ? `Edit ${itemName}` : isRenewalMode ? `Renew ${itemName}` : `Add ${itemName}`}
            </DialogTitle>
            <DialogDescription>
              {isRenewalMode
                ? 'Vehicle and details are pre-filled from the expired record. Update dates and upload new documents.'
                : 'Fill all required fields and save.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-1">
            {fields.map((field) => {
              if (!isFieldVisible(field, formState, editingRow)) return null;
              return (
              <div
                key={field.key}
                className={`space-y-2 ${field.type === 'textarea' ? 'md:col-span-2' : ''}`}
              >
                <Label>
                  {field.label}
                  {field.required ? ' *' : ''}
                </Label>

                {field.type === 'textarea' ? (
                  <Textarea
                    value={formState[field.key] ?? ''}
                    onChange={(e) => setFormState((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                  />
                ) : field.type === 'file' ? (
                  <div className="space-y-2">
                    <Input
                      type="file"
                      accept={field.accept}
                      onChange={(e) => {
                        const selectedFile = e.target.files?.[0] || null;
                        setFileState((prev) => ({ ...prev, [field.key]: selectedFile }));
                      }}
                      className="bg-white/80 border-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-600 file:px-3 file:py-1 file:text-white"
                    />
                    {fileState[field.key] ? (
                      <p className="text-xs text-muted-foreground">Selected: {fileState[field.key]?.name}</p>
                    ) : formState[field.key] ? (
                      <a
                        href={formState[field.key]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-cyan-700 underline underline-offset-2"
                      >
                        View current file
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">No file uploaded yet.</p>
                    )}
                  </div>
                ) : field.type === 'select' ? (
                  <Select
                    value={formState[field.key] || undefined}
                    onValueChange={(value) => setFormState((prev) => ({ ...prev, [field.key]: value }))}
                  >
                    <SelectTrigger className="bg-white/80 border-white/70">
                      <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options || []).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={field.type === 'number' ? 'number' : field.type}
                    step={field.type === 'number' ? field.step || '0.01' : undefined}
                    value={formState[field.key] ?? ''}
                    onChange={(e) => setFormState((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="bg-white/80 border-white/70"
                  />
                )}
              </div>
            );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={isSaving}>
              {isSaving ? 'Saving...' : editingRow ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteRow}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteRow(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {itemName}</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
