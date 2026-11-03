'use client';

/**
 * BOQ › View BOQ — every BOQ item of the project with the JMC / MVAC quantities executed and
 * certified against it: filters, sorting, a column picker (remembered in this browser), Excel
 * export, editing one item and deleting a selection.
 *
 * Quantities find their BOQ item exactly as the reconciliation finds it — scope 1 / scope 2 /
 * BOQ SL No (src/lib/billing-recon/lines.ts) — and rejected or cancelled entries are left out, so
 * this page and Reconciliation agree on every figure.
 */

import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Columns3,
  Download,
  Edit,
  Gauge,
  IndianRupee,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { collection, doc, getDocs, query, updateDoc, writeBatch } from 'firebase/firestore';
import type { CheckedState } from '@radix-ui/react-checkbox';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { resolveProjectBySlug } from '@/lib/project-slug';
import { billingReconRegister } from '@/lib/billing-recon/register';
import {
  compareNatural,
  entryIsVoid,
  formatAmount,
  formatAmountCompact,
  lineKey,
  readBoqRow,
  readBoqSlNo,
  readEntryLine,
} from '@/lib/billing-recon/lines';
import type { FabricationBomItem, JmcEntry, MvacEntry, Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BR_TONE } from '@/components/billing-recon/page-kit';
import BoqItemDetailsDialog from '@/components/billing-recon/BoqItemDetailsDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type BoqItem = {
  id: string;
  'ERP SL NO'?: string | number;
  'BOQ SL No'?: string | number;
  'SL. No.'?: string | number; // common alt key
  'Description'?: string;
  'Unit'?: string;
  'QTY'?: number | string;
  'Unit Rate'?: number | string;
  'Total Amount'?: number | string;
  'Scope 1'?: string;
  'Scope 2'?: string;
  'Category 1'?: string;
  'Category 2'?: string;
  'Category 3'?: string;
  'Project Name'?: string;
  projectSlug?: string; // stamped on load so the details dialog can fetch related data
  bom?: FabricationBomItem[];
  [key: string]: any;
};

const RESOURCE = 'Billing Recon.BOQ';

const EXECUTED = 'JMC/MVAC Executed Qty';
const CERTIFIED = 'JMC/MVAC Certified Qty';
const CERTIFIED_AMOUNT = 'JMC/MVAC Amount';

const baseTableHeaders = [
  'Project Name',
  'Sub-Division',
  'Site',
  'Scope 1',
  'Scope 2',
  'Category 1',
  'Category 2',
  'Category 3',
  'ERP SL NO',
  'BOQ SL No',
  'Description',
  'Unit',
  'QTY',
  'Unit Rate',
  'Total Amount',
  EXECUTED,
  CERTIFIED,
  CERTIFIED_AMOUNT,
] as const;

const DEFAULT_VISIBLE = new Set<string>([
  'BOQ SL No',
  'ERP SL NO',
  'Description',
  'Unit',
  'QTY',
  'Unit Rate',
  EXECUTED,
  CERTIFIED,
  CERTIFIED_AMOUNT,
  'Total Amount',
]);

const defaultOrder = (): string[] => [...baseTableHeaders];
const defaultVisibility = (): Record<string, boolean> =>
  Object.fromEntries(baseTableHeaders.map((h) => [h, DEFAULT_VISIBLE.has(h)]));

const NUMERIC_COLUMNS = new Set<string>(['QTY', 'Unit Rate', 'Total Amount', EXECUTED, CERTIFIED, CERTIFIED_AMOUNT]);
const TRUNCATED_COLUMNS = new Set<string>(['Description', 'Category 1', 'Category 2', 'Category 3']);

/** The fields the edit dialog shows, in order. Project Name is shown read-only. */
const EDIT_FIELDS = [
  'Project Name',
  'Sub-Division',
  'Site',
  'Scope 1',
  'Scope 2',
  'Category 1',
  'Category 2',
  'Category 3',
  'ERP SL NO',
  'BOQ SL No',
  'Description',
  'Unit',
  'QTY',
  'Unit Rate',
  'Total Amount',
] as const;
const NUMERIC_EDIT_FIELDS = new Set<string>(['QTY', 'Unit Rate', 'Total Amount']);
/** Fields the loader copies under a canonical name; an edit writes back to the item's own spelling. */
const NORMALISED_FIELDS = new Set<string>(['ERP SL NO', 'BOQ SL No']);
/** Changing these moves the item to another scope / SL No key, away from its JMC / MVAC lines. */
const KEY_FIELDS = ['Scope 1', 'Scope 2', 'BOQ SL No'] as const;

const PAGE_SIZES = [50, 100, 250] as const;
/** Firestore allows 500 writes per batch; stay under it. */
const DELETE_CHUNK = 450;

type FilterKey = 'Scope 1' | 'Scope 2' | 'Category 1';
const FILTER_KEYS: readonly FilterKey[] = ['Scope 1', 'Scope 2', 'Category 1'];
const FILTER_ALL_LABEL: Record<FilterKey, string> = {
  'Scope 1': 'Every scope 1',
  'Scope 2': 'Every scope 2',
  'Category 1': 'Every category 1',
};
const EMPTY_FILTERS: Record<'search' | FilterKey, string> = {
  search: '',
  'Scope 1': 'all',
  'Scope 2': 'all',
  'Category 1': 'all',
};

type QtyAgg = { executed: number; certified: number };
const ZERO: QtyAgg = { executed: 0, certified: 0 };

interface Derived {
  executed: number;
  certified: number;
  rate: number;
  amount: number;
  certifiedValue: number;
}

/** "1,234.5" → 1234.5; NaN when there is no number. */
const parsedNumber = (v: unknown) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.replace(/[, ]/g, '');
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const fmtNum = (v: unknown) => {
  const n = parsedNumber(v);
  return Number.isFinite(n) ? NUMBER_FORMAT.format(n) : typeof v === 'string' && v.trim() ? v : '—';
};

/** The first key of `obj` that spells `targetKey` once case and spaces are ignored. */
const normalizeKey = (obj: Record<string, unknown>, targetKey: string): string | undefined => {
  const needle = targetKey.toLowerCase().replace(/\s+/g, '');
  return Object.keys(obj).find((k) => k.toLowerCase().replace(/\s+/g, '') === needle);
};

/** A filter value as text, so a number in a Scope / Category column still filters. */
const filterText = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—');

const columnsStorageKey = (slug: string) => `billingRecon.boqColumns.${slug}`;

function readSavedColumns(slug: string): { order: string[]; visibility: Record<string, boolean> } | null {
  try {
    const raw = window.localStorage.getItem(columnsStorageKey(slug));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { order?: unknown; visibility?: unknown };
    const known = new Set<string>(baseTableHeaders);
    const order = Array.isArray(saved.order) ? saved.order.filter((h): h is string => typeof h === 'string' && known.has(h)) : [];
    // Columns added since the layout was saved go at the end.
    for (const h of baseTableHeaders) if (!order.includes(h)) order.push(h);
    const visibility = defaultVisibility();
    if (saved.visibility && typeof saved.visibility === 'object') {
      for (const [h, on] of Object.entries(saved.visibility as Record<string, unknown>)) {
        if (known.has(h) && typeof on === 'boolean') visibility[h] = on;
      }
    }
    return { order, visibility };
  } catch {
    return null;
  }
}

function saveColumns(slug: string, order: string[], visibility: Record<string, boolean>) {
  try {
    window.localStorage.setItem(columnsStorageKey(slug), JSON.stringify({ order, visibility }));
  } catch {
    // Private window or blocked storage: the layout just isn't remembered.
  }
}

export default function ViewBoqPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const { project: projectSlug } = useParams() as { project: string };

  const canView = can('View', RESOURCE);
  const canDelete = can('Delete Items', RESOURCE);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [mvacEntries, setMvacEntries] = useState<MvacEntry[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const reg = useMemo(() => billingReconRegister(currentProject), [currentProject]);
  // Memoised so the details dialog's fetch does not re-run on every render.
  const detailsRegister = useMemo(
    () => ({ jmcEntries: reg.jmcEntries, mvacEntries: reg.mvacEntries, bills: reg.raBills, billsAreRaBills: true }),
    [reg],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<'not-found' | 'failed' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectedBoqItem, setSelectedBoqItem] = useState<BoqItem | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [sortKey, setSortKey] = useState<string>('ERP SL NO');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(100);

  // Column picker (remembered per project in this browser).
  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>(defaultOrder);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(defaultVisibility);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BoqItem | null>(null);
  const [editingOriginal, setEditingOriginal] = useState<BoqItem | null>(null);
  const [editErrors, setEditErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  /** FETCH DATA **/
  const fetchProjectAndBoq = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const projectsSnapshot = await getDocs(query(collection(db, 'projects')));

      // The viewer's column layout for this project, once we are in the browser.
      const saved = readSavedColumns(projectSlug);
      if (saved) {
        setColumnOrder(saved.order);
        setColumnVisibility(saved.visibility);
      }

      const projectData = resolveProjectBySlug(
        projectsSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Project)),
        projectSlug,
      );

      if (!projectData) {
        // Distinct from a read failure: the project genuinely isn't resolvable from this URL.
        console.error(`No project matches the URL slug "${projectSlug}".`);
        setLoadError('not-found');
        setIsLoading(false);
        return;
      }
      setCurrentProject(projectData);

      const projectId = (projectData as any).id;
      const projectReg = billingReconRegister(projectData);

      // BOQ items
      const boqSnapshot = await getDocs(query(collection(db, 'projects', projectId, projectReg.boqItems)));
      const items: BoqItem[] = boqSnapshot.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown> | undefined;
          if (!data) return null;

          const erpKey = normalizeKey(data, 'ERP SL NO');
          const boqKey = normalizeKey(data, 'BOQ SL No');
          const altBoqKey = normalizeKey(data, 'SL. No.');
          const bom = Array.isArray((data as any).bom) ? (data as any).bom : undefined;

          const result: BoqItem = {
            id: d.id,
            ...data,
            ...(erpKey ? { 'ERP SL NO': (data as any)[erpKey] } : {}),
            ...(boqKey ? { 'BOQ SL No': (data as any)[boqKey] } : {}),
            ...(altBoqKey ? { 'SL. No.': (data as any)[altBoqKey] } : {}),
            ...(bom ? { bom } : {}),
            projectSlug, // stamped for the details dialog; never written back
          };
          return result;
        })
        .filter(Boolean) as BoqItem[];
      setBoqItems(items);
      // A deleted or renamed item may still be selected; keep only ids that still exist.
      const live = new Set(items.map((i) => i.id));
      setSelectedItemIds((prev) => prev.filter((id) => live.has(id)));

      // JMC / MVAC. (Subcontractors' `bills` are what the company pays, not client billing, so
      // Billing Recon does not read them.)
      const [jmcSnapshot, mvacSnapshot] = await Promise.all([
        getDocs(collection(db, 'projects', projectId, projectReg.jmcEntries)),
        getDocs(collection(db, 'projects', projectId, projectReg.mvacEntries)),
      ]);

      setJmcEntries(jmcSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry)));
      setMvacEntries(mvacSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MvacEntry)));
    } catch (error) {
      console.error(error);
      setLoadError('failed');
      toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    if (!authLoading && canView) void fetchProjectAndBoq();
  }, [fetchProjectAndBoq, authLoading, canView]);

  /** EXECUTED / CERTIFIED PER BOQ KEY (rejected and cancelled entries left out) **/
  const qtyByKey = useMemo(() => {
    const map = new Map<string, QtyAgg>();
    const add = (entries: ReadonlyArray<JmcEntry | MvacEntry>) => {
      for (const entry of entries) {
        if (entryIsVoid(entry.status)) continue;
        for (const raw of Array.isArray(entry.items) ? entry.items : []) {
          const line = readEntryLine(raw);
          if (!line.boqSlNo) continue;
          const key = lineKey(raw);
          const prev = map.get(key) ?? { executed: 0, certified: 0 };
          prev.executed += line.executedQty;
          prev.certified += line.certifiedQty;
          map.set(key, prev);
        }
      }
    };
    add(jmcEntries);
    add(mvacEntries);
    return map;
  }, [jmcEntries, mvacEntries]);

  const derived = useMemo(() => {
    const map = new Map<string, Derived>();
    for (const item of boqItems) {
      const row = readBoqRow(item);
      const q = readBoqSlNo(item) ? qtyByKey.get(lineKey(item)) ?? ZERO : ZERO;
      map.set(item.id, {
        executed: q.executed,
        certified: q.certified,
        rate: row.rate,
        amount: row.amount,
        certifiedValue: q.certified * row.rate,
      });
    }
    return map;
  }, [boqItems, qtyByKey]);
  const derivedOf = useCallback(
    (item: BoqItem): Derived => derived.get(item.id) ?? { ...ZERO, rate: 0, amount: 0, certifiedValue: 0 },
    [derived],
  );

  /** FILTERS **/
  const filteredBoqItems = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return boqItems.filter((item) => {
      const searchMatch =
        !search ||
        ['ERP SL NO', 'BOQ SL No', 'SL. No.', 'Description', 'Category 1', 'Category 2', 'Category 3'].some((key) =>
          String(item[key] ?? '').toLowerCase().includes(search),
        );
      if (!searchMatch) return false;
      return FILTER_KEYS.every((key) => filters[key] === 'all' || filterText(item[key]) === filters[key]);
    });
  }, [boqItems, filters]);

  const filterOptions = useMemo(() => {
    const distinct = (list: BoqItem[], key: FilterKey) =>
      [...new Set(list.map((i) => filterText(i[key])).filter(Boolean))].sort(compareNatural);
    let base = boqItems;
    const s1 = distinct(base, 'Scope 1');
    if (filters['Scope 1'] !== 'all') base = base.filter((i) => filterText(i['Scope 1']) === filters['Scope 1']);
    const s2 = distinct(base, 'Scope 2');
    if (filters['Scope 2'] !== 'all') base = base.filter((i) => filterText(i['Scope 2']) === filters['Scope 2']);
    const c1 = distinct(base, 'Category 1');
    return { 'Scope 1': s1, 'Scope 2': s2, 'Category 1': c1 } as Record<FilterKey, string[]>;
  }, [boqItems, filters]);

  const handleFilterChange = (key: 'search' | FilterKey, value: string) => {
    setPage(1);
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'Scope 1') {
        next['Scope 2'] = 'all';
        next['Category 1'] = 'all';
      } else if (key === 'Scope 2') {
        next['Category 1'] = 'all';
      }
      return next;
    });
  };

  const clearFilters = () => {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  };

  const activeFilterCount = FILTER_KEYS.filter((k) => filters[k] !== 'all').length;

  /** SORT **/
  const sortedBoqItems = useMemo(() => {
    const sorted = [...filteredBoqItems];

    const comparable = (item: BoqItem, key: string): unknown => {
      if (key === EXECUTED) return derivedOf(item).executed;
      if (key === CERTIFIED) return derivedOf(item).certified;
      if (key === CERTIFIED_AMOUNT) return derivedOf(item).certifiedValue;
      const raw = item[key];
      const num = parsedNumber(raw);
      return Number.isFinite(num) ? num : (raw ?? '');
    };

    if (sortKey) {
      const dir = sortDirection === 'asc' ? 1 : -1;
      sorted.sort((a, b) => {
        const aVal = comparable(a, sortKey);
        const bVal = comparable(b, sortKey);
        const aBlank = aVal === '' || aVal === null || aVal === undefined;
        const bBlank = bVal === '' || bVal === null || bVal === undefined;
        // Blanks last, whichever way round.
        if (aBlank && !bBlank) return 1;
        if (!aBlank && bBlank) return -1;
        if (aBlank && bBlank) return 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
        // "1.10" after "1.9", "10" after "2".
        return compareNatural(aVal, bVal) * dir;
      });
    }

    return sorted;
  }, [filteredBoqItems, sortKey, sortDirection, derivedOf]);

  const pageCount = Math.max(1, Math.ceil(sortedBoqItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = useMemo(() => sortedBoqItems.slice(pageStart, pageStart + pageSize), [sortedBoqItems, pageStart, pageSize]);

  /** FIGURES (for what the filters show) **/
  const figures = useMemo(() => {
    let boqValue = 0;
    let certifiedValue = 0;
    let started = 0;
    let fullyCertified = 0;
    for (const item of filteredBoqItems) {
      const d = derivedOf(item);
      boqValue += d.amount;
      certifiedValue += d.certifiedValue;
      if (d.executed > 0) started += 1;
      const qty = readBoqRow(item).qty;
      if (qty > 0 && d.certified >= qty) fullyCertified += 1;
    }
    return { boqValue, certifiedValue, started, fullyCertified };
  }, [filteredBoqItems, derivedOf]);

  /** ROW ACTIONS **/
  const handleRowClick = (item: BoqItem) => {
    setSelectedBoqItem({ ...item, projectSlug });
    setIsDetailsDialogOpen(true);
  };

  const handleOpenEditDialog = (e: React.MouseEvent, item: BoqItem) => {
    e.stopPropagation();
    setEditingItem({ ...item });
    setEditingOriginal(item);
    setEditErrors([]);
    setIsEditDialogOpen(true);
  };

  const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditingItem((prev) => (prev ? { ...prev, [name]: value } : null));
  };

  const editKeyChanged =
    editingItem && editingOriginal
      ? KEY_FIELDS.some((f) => filterText(editingItem[f]) !== filterText(editingOriginal[f]))
      : false;
  const editLinked = editingOriginal ? derivedOf(editingOriginal).executed > 0 || derivedOf(editingOriginal).certified > 0 : false;

  const handleSaveChanges = async () => {
    if (!editingItem || !editingOriginal || !currentProject) return;
    // Only the fields that were changed are written, each under the item's own spelling of it,
    // and numbers stay numbers — so an edit never turns QTY into text or duplicates a field.
    const changes: Record<string, any> = {};
    const errors: string[] = [];
    for (const field of EDIT_FIELDS) {
      if (field === 'Project Name') continue;
      const before = editingOriginal[field];
      const typed = editingItem[field];
      if (String(typed ?? '') === String(before ?? '')) continue;
      const text = String(typed ?? '').trim();
      let value: unknown = text;
      if (NUMERIC_EDIT_FIELDS.has(field) && text !== '') {
        const n = parsedNumber(text);
        if (!Number.isFinite(n)) {
          errors.push(`${field} must be a number.`);
          continue;
        }
        value = n;
      }
      const target = NORMALISED_FIELDS.has(field) ? normalizeKey(editingOriginal, field) ?? field : field;
      changes[target] = value;
    }
    if (errors.length) {
      setEditErrors(errors);
      return;
    }
    if (Object.keys(changes).length === 0) {
      toast({ title: 'Nothing changed', description: 'The item is as it was.' });
      setIsEditDialogOpen(false);
      return;
    }
    setIsSaving(true);
    try {
      const itemRef = doc(db, 'projects', (currentProject as any).id, reg.boqItems, editingOriginal.id);
      await updateDoc(itemRef, changes);
      toast({ title: 'Saved', description: 'BOQ item updated.' });
      setIsEditDialogOpen(false);
      void fetchProjectAndBoq();
    } catch (e) {
      console.error('Failed to save changes:', e);
      toast({ title: 'Error', description: 'Could not save changes.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  /** SORT HEADER CLICK **/
  const handleSort = (key: string) => {
    setPage(1);
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  /** SELECTION (every row the filters show, across pages) **/
  const visibleHeaders = useMemo(() => columnOrder.filter((h) => columnVisibility[h]), [columnOrder, columnVisibility]);
  const visibleRowIds = useMemo(() => sortedBoqItems.map((i) => i.id), [sortedBoqItems]);
  const selectedSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);

  const allSelected = visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedSet.has(id));
  const someSelected = !allSelected && visibleRowIds.some((id) => selectedSet.has(id));
  const selectAllState: CheckedState = allSelected ? true : someSelected ? 'indeterminate' : false;

  const handleSelectAll = (checked: CheckedState) => {
    if (checked === true) {
      setSelectedItemIds((prev) => Array.from(new Set([...prev, ...visibleRowIds])));
    } else {
      const shown = new Set(visibleRowIds);
      setSelectedItemIds((prev) => prev.filter((id) => !shown.has(id)));
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedItemIds((prev) => (checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  };

  const selectedLinked = useMemo(
    () =>
      boqItems.filter((i) => selectedSet.has(i.id)).filter((i) => {
        const d = derivedOf(i);
        return d.executed > 0 || d.certified > 0;
      }).length,
    [boqItems, selectedSet, derivedOf],
  );

  /** EXPAND/COLLAPSE **/
  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  /** COLUMNS **/
  const setColumns = (order: string[], visibility: Record<string, boolean>) => {
    setColumnOrder(order);
    setColumnVisibility(visibility);
    saveColumns(projectSlug, order, visibility);
  };
  const toggleColumn = (header: string, on: boolean) => setColumns(columnOrder, { ...columnVisibility, [header]: on });
  const moveColumn = (header: string, by: -1 | 1) => {
    const from = columnOrder.indexOf(header);
    const to = from + by;
    if (from < 0 || to < 0 || to >= columnOrder.length) return;
    const next = [...columnOrder];
    [next[from], next[to]] = [next[to], next[from]];
    setColumns(next, columnVisibility);
  };
  const resetColumns = () => setColumns(defaultOrder(), defaultVisibility());

  /** DELETE **/
  const handleDelete = async () => {
    if (!currentProject || selectedItemIds.length === 0 || !canDelete) return;
    setIsDeleting(true);
    const ids = [...selectedItemIds];
    try {
      // Chunked: a single batch is capped at 500 writes, so a large selection failed outright.
      for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
        const batch = writeBatch(db);
        ids.slice(i, i + DELETE_CHUNK).forEach((id) => {
          batch.delete(doc(db, 'projects', (currentProject as any).id, reg.boqItems, id));
        });
        await batch.commit();
      }
      toast({ title: 'Deleted', description: `${ids.length} item(s) removed.` });
      setSelectedItemIds([]);
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to delete selected items.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      void fetchProjectAndBoq();
    }
  };

  /** EXPORT **/
  const handleExportItems = async () => {
    if (!sortedBoqItems.length) return;
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('BOQ Items');
      ws.columns = visibleHeaders.map((header) => ({
        header,
        key: header,
        width: Math.max(12, header.length + 2),
      }));

      sortedBoqItems.forEach((item) => {
        const d = derivedOf(item);
        const row: Record<string, unknown> = {};
        visibleHeaders.forEach((header) => {
          if (header === EXECUTED) {
            row[header] = d.executed;
          } else if (header === CERTIFIED) {
            row[header] = d.certified;
          } else if (header === CERTIFIED_AMOUNT) {
            row[header] = d.certifiedValue;
          } else if (header === 'Total Amount') {
            const explicit = parsedNumber(item[header]);
            if (Number.isFinite(explicit)) {
              row[header] = explicit;
            } else {
              const qty = parsedNumber(item['QTY']);
              const rate = parsedNumber(item['Unit Rate']);
              row[header] = Number.isFinite(qty) && Number.isFinite(rate) ? qty * rate : '';
            }
          } else {
            const raw = item[header];
            row[header] = typeof raw === 'string' || typeof raw === 'number' ? raw : '';
          }
        });
        ws.addRow(row);
      });

      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `boq_${projectSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoking straight after click() can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: 'Export complete', description: `${sortedBoqItems.length} item(s) exported.` });
    } catch (error) {
      console.error('Export failed:', error);
      toast({ title: 'Export Failed', description: 'Could not generate the Excel file.', variant: 'destructive' });
    }
  };

  /** CELL TEXT **/
  const cellText = (item: BoqItem, header: string): string => {
    const d = derivedOf(item);
    if (header === EXECUTED) return fmtNum(d.executed);
    if (header === CERTIFIED) return fmtNum(d.certified);
    if (header === CERTIFIED_AMOUNT) return fmtNum(d.certifiedValue);
    const raw = item[header];
    if (header === 'Total Amount') {
      const explicit = parsedNumber(raw);
      if (Number.isFinite(explicit)) return fmtNum(explicit);
      const qty = parsedNumber(item['QTY']);
      const rate = parsedNumber(item['Unit Rate']);
      return Number.isFinite(qty) && Number.isFinite(rate) ? fmtNum(qty * rate) : '—';
    }
    if (header === 'QTY' || header === 'Unit Rate') return fmtNum(raw);
    if (typeof raw === 'number') return String(raw);
    if (typeof raw === 'string' && raw.trim()) return raw;
    return '—';
  };

  /* ── states ───────────────────────────────────────────────────────────────────────────────── */

  const backHref = `/billing-recon/${projectSlug}/boq`;

  if (authLoading) return <BrPageSkeleton kpis={4} />;
  if (!canView) return <BrAccessDenied message="You need Billing Recon › BOQ › View to see this project's BOQ." />;

  const header = (
    <PageHeader
      title="View BOQ"
      description="Every BOQ item with the JMC and MVAC quantities executed and certified against it. Open an item for its entries and RA bills."
      icon={ClipboardList}
      backHref={backHref}
      backLabel="Back to BOQ"
      meta={currentProject ? [{ label: 'Project', value: currentProject.projectName }] : undefined}
    />
  );

  if (loadError === 'not-found') {
    return (
      <BrPage tone={BR_TONE.boq}>
        {header}
        <BrNotice tone="danger" icon={AlertTriangle} title="Project not found">
          This link does not match any project. It may have been renamed or removed.
        </BrNotice>
      </BrPage>
    );
  }

  const loadingFigures = isLoading && boqItems.length === 0;
  const dash = '—';
  const filtered = filteredBoqItems.length !== boqItems.length;

  return (
    <BrPage tone={BR_TONE.boq}>
      {header}

      {loadError === 'failed' && (
        <BrNotice
          tone="danger"
          icon={AlertTriangle}
          title="Could not load the BOQ"
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => void fetchProjectAndBoq()}>
              Try again
            </Button>
          }
        >
          Check your connection and try again.
        </BrNotice>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="BOQ items"
          value={loadingFigures ? dash : filteredBoqItems.length.toLocaleString('en-IN')}
          hint={loadingFigures ? undefined : filtered ? `of ${boqItems.length.toLocaleString('en-IN')} — filtered` : 'In this BOQ'}
          icon={ClipboardList}
          tone="emerald"
          accent
        />
        <KpiCard
          label="BOQ value"
          value={loadingFigures ? dash : formatAmountCompact(figures.boqValue)}
          hint={loadingFigures ? undefined : formatAmount(figures.boqValue)}
          icon={IndianRupee}
          tone="teal"
          accent
        />
        <KpiCard
          label="Certified value"
          value={loadingFigures ? dash : formatAmountCompact(figures.certifiedValue)}
          hint={loadingFigures ? undefined : `${percent(figures.certifiedValue, figures.boqValue)} of the BOQ value`}
          icon={CheckCircle2}
          tone="cyan"
          accent
          info="JMC and MVAC certified quantities × the BOQ rate. Rejected and cancelled entries are left out."
        />
        <KpiCard
          label="Items started"
          value={loadingFigures ? dash : figures.started.toLocaleString('en-IN')}
          hint={loadingFigures ? undefined : `${figures.fullyCertified.toLocaleString('en-IN')} fully certified`}
          icon={Gauge}
          tone="blue"
          accent
        />
      </div>

      <TableCard
        title="BOQ items"
        icon={ClipboardList}
        count={isLoading && boqItems.length === 0 ? undefined : sortedBoqItems.length}
        total={boqItems.length}
        noun="item"
        actions={
          <>
            {canDelete && selectedItemIds.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={isDeleting}>
                    {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Delete ({selectedItemIds.length})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedItemIds.length} BOQ item{selectedItemIds.length === 1 ? '' : 's'}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      They are removed from this project&apos;s BOQ for good.
                      {selectedLinked > 0
                        ? ` ${selectedLinked} of them ${selectedLinked === 1 ? 'has' : 'have'} JMC or MVAC quantities, which will show as unmatched lines in Reconciliation.`
                        : ''}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button variant="outline" onClick={() => setIsColumnEditorOpen(true)}>
              <Columns3 className="mr-2 h-4 w-4" /> Columns
            </Button>
          </>
        }
        toolbar={
          <FilterBar
            search={{ value: filters.search, onChange: (v) => handleFilterChange('search', v), placeholder: 'SL No, description, category' }}
            activeCount={activeFilterCount}
            onClear={clearFilters}
            summary={
              canDelete && selectedItemIds.length > 0 ? (
                <button type="button" className="hover:text-foreground hover:underline" onClick={() => setSelectedItemIds([])}>
                  {selectedItemIds.length} selected · clear
                </button>
              ) : undefined
            }
            actions={
              <Button variant="outline" onClick={() => void handleExportItems()} disabled={sortedBoqItems.length === 0}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            }
          >
            {FILTER_KEYS.map((key) => {
              const options = filterOptions[key];
              if (!options.length && filters[key] === 'all') return null;
              return (
                <Select key={key} value={filters[key]} onValueChange={(v) => handleFilterChange(key, v)}>
                  <SelectTrigger aria-label={key} className="text-left sm:max-w-[16rem]">
                    <span className="truncate">
                      <SelectValue placeholder={key} />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{FILTER_ALL_LABEL[key]}</SelectItem>
                    {options.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            })}
          </FilterBar>
        }
        footer={
          sortedBoqItems.length > PAGE_SIZES[0] ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="tabular-nums">
                {(pageStart + 1).toLocaleString('en-IN')}–{Math.min(pageStart + pageSize, sortedBoqItems.length).toLocaleString('en-IN')} of{' '}
                {sortedBoqItems.length.toLocaleString('en-IN')}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger aria-label="Rows per page" className="h-8 w-[7.5rem] text-left text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size} per page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="tabular-nums">
                  Page {currentPage} of {pageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Next page"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <Table className="min-w-max">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 !z-30 w-[50px] shadow-[1px_0_0_0_var(--border)]">
                {canDelete && (
                  <Checkbox
                    checked={selectAllState}
                    onCheckedChange={(state) => handleSelectAll(state)}
                    aria-label="Select every item the filters show"
                    title="Select every item the filters show (all pages)"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </TableHead>
              <TableHead className="sticky left-[50px] !z-30 w-12 shadow-[1px_0_0_0_var(--border)]">
                <span className="sr-only">Bill of materials</span>
              </TableHead>

              {visibleHeaders.map((h) => (
                <TableHead
                  key={h}
                  className={cn('cursor-pointer select-none whitespace-nowrap', NUMERIC_COLUMNS.has(h) && 'text-right')}
                  onClick={() => handleSort(h)}
                  title="Sort"
                  aria-sort={sortKey === h ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className={cn('inline-flex items-center gap-1', NUMERIC_COLUMNS.has(h) && 'flex-row-reverse')}>
                    {h}
                    {sortKey === h ? (
                      sortDirection === 'asc' ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                    )}
                  </span>
                </TableHead>
              ))}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {isLoading && boqItems.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="sticky left-0 z-10 bg-card shadow-[1px_0_0_0_var(--border)]">
                    <Skeleton className="h-5 w-5" />
                  </TableCell>
                  <TableCell className="sticky left-[50px] z-10 bg-card shadow-[1px_0_0_0_var(--border)]">
                    <Skeleton className="h-5 w-5" />
                  </TableCell>
                  {visibleHeaders.map((_, j) => (
                    <TableCell key={`${i}-${j}`}>
                      <Skeleton className="h-5 w-full min-w-[4rem]" />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Skeleton className="h-8 w-16" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length > 0 ? (
              pageRows.map((item) => {
                const isExpanded = expandedRows.has(item.id);
                const hasBom = !!(item.bom && item.bom.length > 0);
                const isSelected = selectedSet.has(item.id);
                const stickyBg = isSelected ? 'bg-muted' : 'bg-card';

                return (
                  <Fragment key={item.id}>
                    <TableRow data-state={isSelected ? 'selected' : undefined} onClick={() => handleRowClick(item)} className="cursor-pointer">
                      <TableCell className={cn('sticky left-0 z-10 shadow-[1px_0_0_0_var(--border)]', stickyBg)} onClick={(e) => e.stopPropagation()}>
                        {canDelete && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(state) => handleSelectRow(item.id, state === true)}
                            aria-label={`Select BOQ item ${readBoqSlNo(item) || item.id}`}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </TableCell>

                      <TableCell className={cn('sticky left-[50px] z-10 shadow-[1px_0_0_0_var(--border)]', stickyBg)}>
                        {hasBom ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRowExpansion(item.id);
                            }}
                            aria-label={isExpanded ? 'Hide the bill of materials' : 'Show the bill of materials'}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        ) : null}
                      </TableCell>

                      {visibleHeaders.map((h) => {
                        const text = cellText(item, h);
                        return (
                          <TableCell
                            key={`${item.id}-${h}`}
                            className={cn(
                              TRUNCATED_COLUMNS.has(h) ? 'max-w-xs' : 'whitespace-nowrap',
                              NUMERIC_COLUMNS.has(h) && 'text-right tabular-nums',
                              h === CERTIFIED_AMOUNT && derivedOf(item).certifiedValue > 0 && 'font-medium text-foreground',
                            )}
                          >
                            <span className={cn('block', TRUNCATED_COLUMNS.has(h) && 'truncate')} title={text}>
                              {text}
                            </span>
                          </TableCell>
                        );
                      })}

                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={(e) => handleOpenEditDialog(e, item)}>
                          <Edit className="mr-2 h-4 w-4" /> Edit
                        </Button>
                      </TableCell>
                    </TableRow>

                    {isExpanded && hasBom && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={visibleHeaders.length + 3} className="p-0">
                          <div className="p-4">
                            <h4 className="mb-2 ml-2 text-sm font-semibold">Bill of materials</h4>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Mark No.</TableHead>
                                  <TableHead>Section</TableHead>
                                  <TableHead className="text-right">Qty/Set</TableHead>
                                  <TableHead className="text-right">Total Wt (KG)</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(item.bom ?? []).map((bomItem: FabricationBomItem, index: number) => (
                                  <TableRow key={index}>
                                    <TableCell>{bomItem.markNo ?? '—'}</TableCell>
                                    <TableCell>{bomItem.section ?? '—'}</TableCell>
                                    <TableCell className="text-right tabular-nums">{fmtNum(bomItem.qtyPerSet)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{fmtNum(bomItem.totalWtKg)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <TableEmpty colSpan={visibleHeaders.length + 3}>
                {boqItems.length === 0 ? 'This project has no BOQ items yet. Import the BOQ or add items from the BOQ page.' : 'No BOQ items match these filters.'}
              </TableEmpty>
            )}
          </TableBody>
        </Table>
      </TableCard>

      <BoqItemDetailsDialog
        isOpen={isDetailsDialogOpen}
        onOpenChange={setIsDetailsDialogOpen}
        item={selectedBoqItem}
        projectId={currentProject?.id}
        register={detailsRegister}
      />

      {/* Column picker */}
      <Dialog open={isColumnEditorOpen} onOpenChange={setIsColumnEditorOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Columns</DialogTitle>
            <DialogDescription>Choose the columns to show and their order. Remembered for this project in this browser.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] min-h-0 space-y-1.5 overflow-y-auto py-2 pr-1">
            {columnOrder.map((h, index) => (
              <div key={h} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
                <Checkbox id={`boq-col-${index}`} checked={!!columnVisibility[h]} onCheckedChange={(checked) => toggleColumn(h, checked === true)} />
                <Label htmlFor={`boq-col-${index}`} className="min-w-0 flex-1 truncate font-normal">
                  {h}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Move ${h} up`}
                  disabled={index === 0}
                  onClick={() => moveColumn(h, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Move ${h} down`}
                  disabled={index === columnOrder.length - 1}
                  onClick={() => moveColumn(h, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" onClick={resetColumns}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reset
            </Button>
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit one item */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Edit BOQ item</DialogTitle>
            <DialogDescription>
              {editingOriginal ? `${readBoqSlNo(editingOriginal) || 'No SL No'} · ${String(editingOriginal['Description'] ?? '').slice(0, 80) || 'No description'}` : 'Change the item’s details.'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] min-h-0 space-y-4 overflow-y-auto py-2 pr-1">
            {editKeyChanged && editLinked && (
              <BrNotice tone="warning" icon={AlertTriangle} title="This item has JMC / MVAC quantities">
                Its scope or BOQ SL No is how those lines find it. Changing it leaves them unmatched in Reconciliation until they are corrected too.
              </BrNotice>
            )}
            {editErrors.length > 0 && (
              <BrNotice tone="danger" icon={AlertTriangle} title="Check these fields">
                {editErrors.join(' ')}
              </BrNotice>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {editingItem &&
                EDIT_FIELDS.map((key, index) => (
                  <div className={cn('space-y-1.5', key === 'Description' && 'sm:col-span-2')} key={key}>
                    <Label htmlFor={`boq-edit-${index}`}>{key}</Label>
                    <Input
                      id={`boq-edit-${index}`}
                      name={key}
                      value={(editingItem as any)[key] ?? ''}
                      onChange={handleEditFormChange}
                      readOnly={key === 'Project Name'}
                      inputMode={NUMERIC_EDIT_FIELDS.has(key) ? 'decimal' : undefined}
                      className={cn(key === 'Project Name' && 'bg-muted', NUMERIC_EDIT_FIELDS.has(key) && 'tabular-nums')}
                    />
                  </div>
                ))}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={() => void handleSaveChanges()} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BrPage>
  );
}
