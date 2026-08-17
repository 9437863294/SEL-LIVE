'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import ExcelJS from 'exceljs';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Download,
  ExternalLink,
  FilePlus2,
  History,
  List,
  Loader2,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  compareCreatedAtDesc,
  formatVehicleTimestamp,
  getVehicleComplianceRequirements,
  getVehicleTimestampMillis,
  VEHICLE_COLLECTIONS,
  type VehicleComplianceRequirements,
} from '@/lib/vehicle-management';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useFieldControl } from './use-field-control';
import type { VMFormKey } from '@/lib/vehicle-management-field-registry';

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
  searchable?: boolean;
  helperText?: string;
  min?: number;
  max?: number;
  maxFileSizeMb?: number;
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
  /**
   * Field Control registry key — lets an admin show/hide, require, or relabel these fields from
   * Settings > Field Control. Omit this for callers outside the Vehicle Management module (this
   * component is also reused by Letter of Credit and Employee Trip Reimbursement, which don't
   * have a Field Control registry) — the field list is then used exactly as passed in.
   */
  formKey?: VMFormKey;
  columns: CrudColumnConfig[];
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canImport?: boolean;
  canExport?: boolean;
  exportFileName?: string;
  /** Storage root used for file fields. Defaults to the historical vehicle-management path. */
  uploadPathPrefix?: string;
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
  emptyMessage?: string;
  /** Pre-fill values when opening Add dialog (used by Renewals Hub "Renew Now" flow) */
  initialPrefill?: Record<string, string>;
  /** Firestore doc ID of the expired record being renewed — will be marked Archived after save */
  renewingFromId?: string;
  /**
   * Opt-in: when set, the "Active" tab becomes vehicle-driven instead of record-driven —
   * every vehicle that requires this compliance category (per getVehicleComplianceRequirements)
   * gets exactly one row: its current record if it has one, or a synthetic "Missing" row
   * (built via `buildMissingRow`) if it doesn't. Vehicles that don't require this category
   * (Sold/Scrapped, or manually turned off) are excluded entirely. Requires `buildMissingRow`.
   */
  vehicleRequirementKey?: keyof VehicleComplianceRequirements;
  /** Builds the synthetic row shown for a vehicle with no current record. Must return an
   * object with a unique `id`, `isMissingRecord: true`, and blank/"Missing" values for
   * whatever `columns`/`fields` keys this module uses. Required when `vehicleRequirementKey`
   * is set. */
  buildMissingRow?: (vehicle: Record<string, any>) => Record<string, any>;
  onBeforeSave?: (
    payload: Record<string, any>,
    currentRow: Record<string, any> | null
  ) => Record<string, any> | Promise<Record<string, any>>;
  onAfterFetch?: (rows: Record<string, any>[]) => Record<string, any>[];
  onAfterSave?: (args: {
    id: string;
    mode: 'create' | 'update';
    payload: Record<string, any>;
    previousRow: Record<string, any> | null;
    renewalSourceId?: string;
  }) => Promise<void> | void;
  onAfterDelete?: (args: {
    row: Record<string, any>;
  }) => Promise<void> | void;
  onBeforeDelete?: (args: {
    row: Record<string, any>;
  }) => Promise<void> | void;
}

const DEFAULT_PAGE_SIZE = 25;

function SearchableSelect({
  value,
  options,
  placeholder,
  onValueChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-11 w-full justify-between border-slate-200 bg-white px-3 text-[13px] font-normal sm:h-9"
        >
          <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
            {selected?.label || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${placeholder.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>No matching option found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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
    if (!row && field.type === 'select' && !field.searchable && field.options && field.options.length > 0) {
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
  fields: fieldsProp,
  formKey,
  columns,
  canView,
  canAdd,
  canEdit,
  canDelete,
  canImport,
  canExport,
  exportFileName,
  uploadPathPrefix = 'vehicle-management',
  defaultSort,
  emptyMessage = 'No records found.',
  initialPrefill,
  renewingFromId,
  vehicleRequirementKey,
  buildMissingRow,
  onBeforeSave,
  onAfterFetch,
  onAfterSave,
  onAfterDelete,
  onBeforeDelete,
}: GenericCrudPageProps) {
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get('tab') === 'history' ? 'history' : 'active';

  const { toast } = useToast();
  const { log } = useActivityLogger('Vehicle Management');
  const { field: fieldControl } = useFieldControl(formKey);
  // Field Control overrides (visible/required/label) applied on top of the page's own field
  // config — hidden fields are dropped entirely so every downstream consumer (rendering, submit
  // validation, import) sees the same, already-filtered list. `vehicleId` is locked in the
  // registry for every one of these forms, so it can never disappear from this list. Callers
  // outside Vehicle Management don't pass `formKey` at all, so the field list is used verbatim.
  const fields: CrudFieldConfig[] = !formKey
    ? fieldsProp
    : fieldsProp
        .filter((item) => fieldControl(item.key).visible)
        .map((item) => {
          const setting = fieldControl(item.key);
          return { ...item, required: setting.required, label: setting.label };
        });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
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
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [vehicleRows, setVehicleRows] = useState<Record<string, any>[]>([]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const prefillApplied = useRef(false);

  const allowImport = canImport ?? canAdd;
  const allowExport = canExport ?? canView;

  // Only fetch the vehicle list when a page opts into the vehicle-driven Missing-row view —
  // other GenericCrudPage consumers (maintenance, fuel, documents, etc.) pay no extra cost.
  useEffect(() => {
    if (!vehicleRequirementKey) return;
    (async () => {
      try {
        const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
        setVehicleRows(snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      } catch (error) {
        console.error('Failed to load vehicles for compliance merge', error);
      }
    })();
  }, [vehicleRequirementKey]);

  const loadRows = async () => {
    setIsLoading(true);
    setLoadError('');
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
      mapped.sort(compareCreatedAtDesc);
      setRows(mapped);
    } catch (error) {
      console.error(`Failed to load ${collectionName}`, error);
      setLoadError(`Unable to load ${itemName.toLowerCase()} records.`);
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
    if (renewingFromId && isLoading) return;
    const renewalSource = renewingFromId
      ? rows.find((row) => String(row.id) === String(renewingFromId)) || null
      : null;
    if (renewingFromId && !renewalSource) {
      prefillApplied.current = true;
      toast({
        title: 'Renewal Record Not Found',
        description: 'The original record could not be loaded. Open the Renewals Hub and try again.',
        variant: 'destructive',
      });
      return;
    }
    // The linked vehicle may no longer require this compliance type (Sold/Scrapped, or
    // manually turned off) — `onAfterFetch` already marks such rows "Not Applicable", so
    // don't pop a renewal dialog for a stray/bookmarked/notification `?renew=` link.
    if (renewalSource && renewalSource.alertStage === 'Not Applicable') {
      prefillApplied.current = true;
      toast({
        title: 'Renewal Not Required',
        description: 'This compliance record is no longer required for its vehicle.',
      });
      return;
    }
    prefillApplied.current = true;
    const merged = buildInitialForm(fields, renewalSource);
    fields.forEach((field) => {
      if (field.type === 'file') merged[field.key] = '';
    });
    Object.entries(initialPrefill).forEach(([k, v]) => {
      if (v !== undefined && v !== '') merged[k] = v;
    });
    setEditingRow(null);
    setFormState(merged);
    setFileState({});
    // Only badge/label this as a "renewal" when there's an actual prior record being
    // replaced — the Vehicle Health "Add Now" flow (no renewingFromId) is a plain Add.
    setIsRenewalMode(Boolean(renewingFromId));
    setDialogOpen(true);
  }, [canAdd, fields, initialPrefill, isLoading, renewingFromId, rows, toast]);

  // Vehicle-driven Active list (opt-in via vehicleRequirementKey): every vehicle that
  // requires this compliance category gets exactly one row — its current record if it has
  // one, or a synthetic "Missing" row otherwise — so a vehicle with zero records is no
  // longer invisible. Vehicles that don't require it are excluded entirely. When the prop
  // isn't set, this is just the plain non-archived row list (unchanged behavior).
  const mergedActiveRows = useMemo(() => {
    const activeRows = rows.filter((row) => row.isArchived !== true);
    if (!vehicleRequirementKey || !buildMissingRow) return activeRows;

    const latestByVehicle = new Map<string, Record<string, any>>();
    activeRows.forEach((row) => {
      const vid = String(row.vehicleId || '');
      if (!vid) return;
      const existing = latestByVehicle.get(vid);
      if (!existing || getVehicleTimestampMillis(row.createdAt) >= getVehicleTimestampMillis(existing.createdAt)) {
        latestByVehicle.set(vid, row);
      }
    });

    const merged: Record<string, any>[] = [];
    const knownVehicleIds = new Set(vehicleRows.map((vehicle) => String(vehicle.id)));

    vehicleRows.forEach((vehicle) => {
      const vid = String(vehicle.id);
      const requirements: VehicleComplianceRequirements = getVehicleComplianceRequirements(vehicle);
      if (!requirements[vehicleRequirementKey]) return;
      merged.push(latestByVehicle.get(vid) || buildMissingRow(vehicle));
    });

    // Don't silently drop a current record whose vehicle can't be resolved at all (e.g. the
    // vehicle was deleted from Vehicle Master) — still surface it. A vehicle that exists but
    // doesn't require this category (Sold/Scrapped, etc.) is intentionally NOT re-added here.
    latestByVehicle.forEach((row, vid) => {
      if (!knownVehicleIds.has(vid)) merged.push(row);
    });

    return merged;
  }, [rows, vehicleRows, vehicleRequirementKey, buildMissingRow]);

  const filteredRows = useMemo(() => {
    const base = activeTab === 'history' ? rows.filter((r) => r.isArchived === true) : mergedActiveRows;

    const term = query.trim().toLowerCase();
    if (!term) return base;
    const searchableKeys = Array.from(
      new Set([...columns.map((column) => column.key), ...fields.map((field) => field.key)])
    );
    return base.filter((row) =>
      searchableKeys.some((key) => toDisplay(row[key]).toLowerCase().includes(term))
    );
  }, [rows, mergedActiveRows, columns, fields, query, activeTab]);

  const activeCount = mergedActiveRows.length;
  const historyCount = useMemo(() => rows.filter((row) => row.isArchived === true).length, [rows]);
  // Missing rows only ever show an "Add" action (gated on canAdd), so the Actions column
  // must stay visible for vehicleRequirementKey pages even if canEdit/canDelete are both
  // false — this doesn't change behavior for other GenericCrudPage consumers.
  const showActionsColumn = canEdit || canDelete || Boolean(vehicleRequirementKey && canAdd);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / DEFAULT_PAGE_SIZE));
  const paginatedRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * DEFAULT_PAGE_SIZE, currentPage * DEFAULT_PAGE_SIZE),
    [currentPage, filteredRows]
  );

  useEffect(() => {
    setCurrentPage(1);
    setExpandedRowId(null);
  }, [activeTab, query]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

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

        let finalPayload: Record<string, any>;
        try {
          finalPayload = onBeforeSave ? await onBeforeSave(payload, null) : payload;
        } catch (error: any) {
          skipped += 1;
          if (skippedReasons.length < 5) {
            skippedReasons.push(`Row ${rowIndex}: ${error?.message || 'Validation failed'}`);
          }
          continue;
        }

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
      if (imported > 0) {
        void log(`Import ${itemName}`, { collectionName, imported, skipped });
      }
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
    setIsRenewalMode(false);
    setDialogOpen(true);
  };

  const openEditDialog = (row: Record<string, any>) => {
    if (!canEdit) return;
    setEditingRow(row);
    setFormState(buildInitialForm(fields, row));
    setFileState({});
    setDialogOpen(true);
  };

  // Used by the synthetic "Missing" rows — opens a blank Add form with the vehicle already
  // pre-selected (relies on the module's vehicle-select field being keyed 'vehicleId', the
  // convention every vehicleRequirementKey consumer uses).
  const openAddForVehicle = (row: Record<string, any>) => {
    if (!canAdd) return;
    setEditingRow(null);
    const next = buildInitialForm(fields, null);
    if (row.vehicleId) next.vehicleId = String(row.vehicleId);
    setFormState(next);
    setFileState({});
    setIsRenewalMode(false);
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
          if (field.min !== undefined && parsed < field.min) {
            toast({
              title: 'Validation Error',
              description: `${field.label} must be at least ${field.min}.`,
              variant: 'destructive',
            });
            return;
          }
          if (field.max !== undefined && parsed > field.max) {
            toast({
              title: 'Validation Error',
              description: `${field.label} must not exceed ${field.max}.`,
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

    try {
      setIsSaving(true);
      const finalPayload = onBeforeSave ? await onBeforeSave(payload, editingRow) : payload;
      const payloadWithUploads = { ...finalPayload };

      for (const field of fileFields) {
        const file = fileState[field.key];
        if (!file) continue;
        const maxFileSizeMb = field.maxFileSizeMb ?? 10;
        if (file.size > maxFileSizeMb * 1024 * 1024) {
          throw new Error(`${field.label} must be smaller than ${maxFileSizeMb} MB.`);
        }
        const safeName = file.name.replace(/\s+/g, '-');
        const rowKey = editingRow?.id || `new-${Date.now()}`;
        const uploadRef = ref(
          storage,
          `${uploadPathPrefix}/${collectionName}/${rowKey}/${Date.now()}-${safeName}`
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
            renewalSourceId: mode === 'create' && isRenewalMode ? renewingFromId : undefined,
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

      void log(`${mode === 'create' ? 'Add' : 'Edit'} ${itemName}`, {
        collectionName,
        recordId: savedId,
        reference:
          payloadWithUploads.vehicleNumber ||
          payloadWithUploads.driverName ||
          payloadWithUploads.documentNumber ||
          '',
      });

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
    } catch (error: any) {
      console.error(`Failed to save ${collectionName}`, error);
      toast({
        title: 'Error',
        description: error?.message || `Unable to save ${itemName.toLowerCase()}.`,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    try {
      if (onBeforeDelete) await onBeforeDelete({ row: deleteRow });
      await deleteDoc(doc(db, collectionName, deleteRow.id as string));
      let cleanupFailed = false;
      if (onAfterDelete) {
        try {
          await onAfterDelete({ row: deleteRow });
        } catch (error) {
          console.error(`Post-delete hook failed for ${collectionName}`, error);
          cleanupFailed = true;
        }
      }
      void log(`Delete ${itemName}`, {
        collectionName,
        recordId: deleteRow.id,
        reference: deleteRow.vehicleNumber || deleteRow.driverName || deleteRow.documentNumber || '',
      });
      toast(cleanupFailed
        ? { title: 'Deleted With Warning', description: `${itemName} was deleted, but a related cleanup failed.`, variant: 'destructive' }
        : { title: 'Deleted', description: `${itemName} deleted successfully.` });
      setDeleteRow(null);
      loadRows();
    } catch (error: any) {
      console.error(`Failed to delete ${collectionName}`, error);
      toast({
        title: 'Error',
        description: error?.message || `Unable to delete ${itemName.toLowerCase()}.`,
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
    <div className="space-y-3 sm:space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 animate-bb-gradient" />
        <CardHeader className="flex flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-6">
          <div>
            <CardTitle className="tracking-tight">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            <Badge variant="outline" className="col-span-2 w-fit bg-white/70 sm:col-span-1">
              {filteredRows.length === rows.length ? `${rows.length} records` : `${filteredRows.length} of ${rows.length}`}
            </Badge>
            <Button type="button" variant="outline" onClick={loadRows} disabled={isLoading} className="bg-white/80 hover:bg-white">
              <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
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
            {canAdd && (
              <Button
                type="button"
                onClick={openAddDialog}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[0_16px_36px_-22px_rgba(5,150,105,0.72)] hover:from-emerald-600 hover:to-teal-700"
              >
                Add {itemName}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-4 sm:px-6 sm:pb-6">
          {loadError && (
            <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{loadError}</span>
              <Button type="button" size="sm" variant="outline" onClick={loadRows} className="border-rose-200 bg-white text-rose-700">Try Again</Button>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={`Search ${itemName.toLowerCase()} records`}
                placeholder={`Search all ${itemName.toLowerCase()} fields...`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 w-full border-slate-200 bg-white pl-9 pr-9 focus-visible:ring-emerald-400/40 sm:h-10"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 rounded-md p-1 text-muted-foreground hover:bg-slate-100 hover:text-slate-800 -translate-y-1/2">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border border-white/70 bg-white/50 p-1 shadow-sm sm:w-fit">
              <button
                type="button"
                onClick={() => setActiveTab('active')}
                className={cn(
                  'flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                  activeTab === 'active' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:bg-white/50 hover:text-slate-700'
                )}
              >
                <List className="h-3.5 w-3.5" />
                Active <span className="text-[10px] opacity-70">{activeCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={cn(
                  'flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                  activeTab === 'history' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:bg-white/50 hover:text-slate-700'
                )}
              >
                <History className="h-3.5 w-3.5" />
                History <span className="text-[10px] opacity-70">{historyCount}</span>
              </button>
            </div>
          </div>
          <div className="space-y-2.5 sm:hidden">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-32 w-full rounded-xl" />)
            ) : filteredRows.length === 0 ? (
              <div className="rounded-xl border border-white/70 bg-white/85 px-3 py-8 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              paginatedRows.map((row) => {
                const rowId = String(row.id);
                const isExpanded = expandedRowId === rowId;
                const mobileColumns = isExpanded ? columns : columns.slice(0, 4);
                return (
                <div key={rowId} className="rounded-xl border border-white/70 bg-white/85 p-4 shadow-sm transition-transform active:scale-[0.99]">
                  <div className="space-y-2.5">
                    {mobileColumns.map((column) => (
                      <div key={column.key} className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                          {column.label}
                        </span>
                        <span className="max-w-[58%] break-words text-right text-sm font-medium text-slate-700">
                          {column.formatter ? column.formatter(row[column.key], row) : toDisplay(row[column.key])}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-start justify-between gap-2">
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Created Time</span>
                      <span className="max-w-[58%] text-right text-sm font-medium text-slate-700">{formatVehicleTimestamp(row.createdAt)}</span>
                    </div>
                    {columns.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setExpandedRowId(isExpanded ? null : rowId)}
                        className="w-full rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
                      >
                        {isExpanded ? 'Show Less' : `View ${columns.length - 4} More Details`}
                      </button>
                    )}
                  </div>
                  {showActionsColumn && (
                    <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                      {row.isMissingRecord ? (
                        <Button size="sm" onClick={() => openAddForVehicle(row)} disabled={!canAdd} className="h-10 flex-1 bg-emerald-600 text-white hover:bg-emerald-700">Add {itemName}</Button>
                      ) : (
                        <>
                          {canEdit && <Button variant="outline" size="sm" onClick={() => openEditDialog(row)} className="h-10 flex-1 bg-white/80">Edit</Button>}
                          {canDelete && <Button variant="destructive" size="sm" onClick={() => setDeleteRow(row)} className="h-10 flex-1">Delete</Button>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );})
            )}
          </div>
          <div className="hidden sm:block">
            {!isLoading && filteredRows.length === 0 ? (
              <div className="rounded-lg border border-white/70 bg-white/80 px-4 py-10 text-center text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              <div className="overflow-auto rounded-lg border border-white/70 bg-white/80 h-[calc(100vh-230px)]">
                <table className="w-full caption-bottom text-sm">
                  <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                    <TableRow>
                      {columns.map((column) => (
                        <TableHead key={column.key}>{column.label}</TableHead>
                      ))}
                      <TableHead>Created Time</TableHead>
                      {showActionsColumn && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 4 }).map((_, idx) => (
                        <TableRow key={idx}>
                          <TableCell colSpan={columns.length + 1 + (showActionsColumn ? 1 : 0)}>
                            <Skeleton className="h-8 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      paginatedRows.map((row) => (
                        <TableRow key={row.id as string} className="transition-colors hover:bg-emerald-50/70">
                          {columns.map((column) => (
                            <TableCell key={column.key}>
                              {column.formatter
                                ? column.formatter(row[column.key], row)
                                : toDisplay(row[column.key])}
                            </TableCell>
                          ))}
                          <TableCell className="whitespace-nowrap">{formatVehicleTimestamp(row.createdAt)}</TableCell>
                          {showActionsColumn && <TableCell className="w-[160px] text-right">
                            <div className="flex items-center justify-end gap-2">
                              {row.isMissingRecord ? (
                                <Button size="sm" onClick={() => openAddForVehicle(row)} disabled={!canAdd} className="h-8 bg-emerald-600 px-3 text-white hover:bg-emerald-700">
                                  Add {itemName}
                                </Button>
                              ) : (
                                <>
                                  {canEdit && <Button variant="outline" size="sm" onClick={() => openEditDialog(row)} className="h-8 bg-white/80 px-3">
                                    Edit
                                  </Button>}
                                  {canDelete && <Button variant="destructive" size="sm" onClick={() => setDeleteRow(row)} className="h-8 px-3">
                                    Delete
                                  </Button>}
                                </>
                              )}
                            </div>
                          </TableCell>}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </table>
              </div>
            )}
          </div>
          {!isLoading && filteredRows.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-white/70 bg-white/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {(currentPage - 1) * DEFAULT_PAGE_SIZE + 1}–{Math.min(currentPage * DEFAULT_PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
              </p>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1} className="h-8 bg-white">
                  <ChevronLeft className="mr-1 h-4 w-4" />Previous
                </Button>
                <span className="min-w-16 text-center text-xs font-semibold text-slate-600">{currentPage} / {totalPages}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages} className="h-8 bg-white">
                  Next<ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditingRow(null);
            setIsRenewalMode(false);
            setFormState(buildInitialForm(fields, null));
            setFileState({});
            return;
          }
          setDialogOpen(true);
        }}
      >
        <DialogContent className="vm-mobile-dialog flex max-h-[92dvh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl">

          {/* ── Sticky header ─────────────────────────────────── */}
          <div className="vm-dialog-header shrink-0 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-teal-50 px-4 py-4 pr-12 sm:px-6 sm:py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
                <FilePlus2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
            {isRenewalMode && (
              <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Renewing Expired Record
              </div>
            )}
            <DialogTitle className="text-lg font-semibold leading-snug text-slate-900">
              {editingRow ? `Edit ${itemName}` : isRenewalMode ? `Renew ${itemName}` : `Add ${itemName}`}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-sm text-muted-foreground">
              {isRenewalMode
                ? 'Pre-filled from the expired record — update the dates and upload the new document.'
                : 'Fill in the required fields below and save.'}
            </DialogDescription>
              </div>
              <div className="hidden items-center gap-1.5 sm:flex">
                <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Details</span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">Review & Save</span>
              </div>
            </div>
          </div>

          {/* ── Scrollable form body ───────────────────────────── */}
          <div className="vm-dialog-body min-h-0 flex-1 overflow-y-auto bg-slate-50/80 px-3 py-3 sm:px-6 sm:py-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <div><p className="text-sm font-semibold text-slate-800">Record Information</p><p className="text-xs text-muted-foreground">Enter accurate details for this record.</p></div>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-600">* Required</span>
              </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {fields.map((field) => {
                if (!isFieldVisible(field, formState, editingRow)) return null;
                const isWideField = field.type === 'textarea' || field.type === 'file';
                return (
                  <div
                    key={field.key}
                    className={cn(
                      'space-y-1.5',
                      isWideField && 'md:col-span-2 xl:col-span-3'
                    )}
                  >
                    <Label className="text-xs font-semibold tracking-wide text-slate-700">
                      {field.label}
                      {field.required && <span className="ml-1 text-rose-500">*</span>}
                    </Label>

                    {field.type === 'textarea' ? (
                      <Textarea
                        value={formState[field.key] ?? ''}
                        onChange={(e) => setFormState((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="min-h-[88px] resize-none border-slate-200 bg-white transition-colors focus-visible:border-emerald-400 focus-visible:ring-1 focus-visible:ring-emerald-400/50"
                      />
                    ) : field.type === 'file' ? (
                      <div className="space-y-1.5">
                        <label
                          htmlFor={`file-field-${field.key}`}
                          className={cn(
                            'flex h-11 w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 text-sm transition-colors sm:h-9',
                            fileState[field.key]
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-dashed border-slate-300 bg-slate-50 text-muted-foreground hover:border-emerald-400 hover:bg-emerald-50/60'
                          )}
                        >
                          <Upload className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-xs">
                            {fileState[field.key]?.name ?? (field.placeholder || 'Choose or drop a file…')}
                          </span>
                        </label>
                        <input
                          id={`file-field-${field.key}`}
                          type="file"
                          accept={field.accept}
                          onChange={(e) => {
                            const selectedFile = e.target.files?.[0] || null;
                            setFileState((prev) => ({ ...prev, [field.key]: selectedFile }));
                          }}
                          className="sr-only"
                        />
                        {!fileState[field.key] && formState[field.key] && (
                          <a
                            href={formState[field.key]}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View current file
                          </a>
                        )}
                      </div>
                    ) : field.type === 'select' && field.searchable ? (
                      <SearchableSelect
                        value={formState[field.key] || ''}
                        options={field.options || []}
                        placeholder={`Select ${field.label}`}
                        onValueChange={(value) => setFormState((prev) => ({ ...prev, [field.key]: value }))}
                      />
                    ) : field.type === 'select' ? (
                      <Select
                        value={formState[field.key] || undefined}
                        onValueChange={(value) => setFormState((prev) => ({ ...prev, [field.key]: value }))}
                      >
                        <SelectTrigger className="h-11 border-slate-200 bg-white text-[13px] transition-colors focus:ring-1 focus:ring-emerald-400/50 data-[state=open]:border-emerald-400 sm:h-9">
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
                        min={field.type === 'number' ? field.min : undefined}
                        max={field.type === 'number' ? field.max : undefined}
                        value={formState[field.key] ?? ''}
                        onChange={(e) => setFormState((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="h-11 border-slate-200 bg-white text-[13px] transition-colors focus-visible:border-emerald-400 focus-visible:ring-1 focus-visible:ring-emerald-400/50 sm:h-9"
                      />
                    )}
                    {field.helperText && <p className="text-[11px] leading-snug text-muted-foreground">{field.helperText}</p>}
                  </div>
                );
              })}
            </div>
            </div>
          </div>

          {/* ── Sticky footer ─────────────────────────────────── */}
          <div className="vm-dialog-footer shrink-0 border-t border-slate-200 bg-white px-3 py-3 shadow-[0_-10px_30px_-25px_rgba(15,23,42,0.5)] sm:px-6 sm:py-4">
            <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:justify-between sm:gap-3">
              <p className="col-span-2 text-xs text-muted-foreground sm:col-span-1">
                <span className="text-rose-500">*</span> Required fields
              </p>
              <div className="col-span-2 grid grid-cols-2 items-center gap-2 sm:col-span-1 sm:flex">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDialogOpen(false);
                    setEditingRow(null);
                    setIsRenewalMode(false);
                    setFormState(buildInitialForm(fields, null));
                    setFileState({});
                  }}
                  className="h-11 bg-white hover:bg-slate-50 sm:h-9"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={submitForm}
                  disabled={isSaving}
                  className="h-11 bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm hover:from-emerald-600 hover:to-teal-700 disabled:opacity-60 sm:h-9"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : editingRow ? (
                    'Update'
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteRow}
        onOpenChange={(open) => {
          if (!open) setDeleteRow(null);
        }}
      >
        <AlertDialogContent className="max-w-sm overflow-hidden p-0 vm-panel-strong">
          <div className="h-1 w-full bg-gradient-to-r from-rose-500 to-red-600" />
          <div className="px-6 pb-2 pt-5">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-base">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
                </div>
                Delete {itemName}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-2 space-y-2 text-sm">
                <span>This will permanently delete the record and cannot be undone.</span>
                {deleteRow && columns.length > 0 && (
                  <span className="mt-2 block rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 font-mono text-xs font-medium text-rose-700">
                    {columns
                      .slice(0, 2)
                      .map((col) => `${col.label}: ${toDisplay(deleteRow[col.key])}`)
                      .join(' · ')}
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter className="px-6 pb-5">
            <AlertDialogCancel className="bg-white hover:bg-slate-50">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
