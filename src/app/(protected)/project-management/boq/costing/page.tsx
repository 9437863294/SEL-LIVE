
'use client';

import React, { useState, useEffect, useMemo, useRef, Fragment, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Calculator,
  Trash2,
  ListPlus,
  Loader2,
  Settings,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  Edit,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch, doc, updateDoc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
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
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { FabricationBomItem, JmcEntry, Bill, Project, MvacEntry } from '@/lib/types';
import {
  BOQ_COLUMN_SETTINGS_COLLECTION,
  BOQ_COLUMN_SETTINGS_DOC,
  mergeBoqColumns,
  YES_NO_OPTIONS,
} from '@/lib/project-management-boq-columns';
import { PO_COLLECTION, type PurchaseOrder } from '@/lib/purchase-orders';
import { MDL_COLLECTION, mdlOverallStatusStyles, type MdlDrawing } from '@/lib/mdl';
import BoqItemDetailsDialog from '@/components/billing-recon/BoqItemDetailsDialog';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CheckedState } from '@radix-ui/react-checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';


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
  'Budget Price'?: number | string;
  'F&I %'?: number | string;
  'F&I Price'?: number | string;
  'Total Budget Price'?: number | string;
  'Start Date'?: string;
  'End Date'?: string;
  'Scope 1'?: string;
  'Scope 2'?: string;
  'Category 1'?: string;
  'Category 2'?: string;
  'Category 3'?: string;
  'Project Name'?: string;
  projectSlug?: string; // <-- add slug so the details dialog can fetch related data
  bom?: FabricationBomItem[];
  [key: string]: any;
};

type IndentLineItem = {
  boqItemId: string;
  requestedQty: number | string;
};

type IndentRecord = {
  id: string;
  status: string;
  items: IndentLineItem[];
};

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
    'JMC/MVAC Executed Qty',
    'JMC/MVAC Certified Qty',
    'JMC/MVAC Amount',
    'Indent Qty',
    'PO Qty',
    'Budget Price',
    'F&I %',
    'F&I Price',
    'Total Budget Price',
    'Start Date',
    'End Date',
] as const;

const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

const compositeKey = (scope1: unknown, scope2: unknown, slNo: unknown) =>
  `${String(scope1 ?? '').trim().toLowerCase()}__${String(scope2 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;

const toDateInputValue = (value: unknown) => {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return toDateInputValue((value as any).toDate());
  }
  return '';
};

const formatBoqDate = (value: unknown) => {
  const normalized = toDateInputValue(value);
  if (!normalized) return typeof value === 'string' && value.trim() ? value : 'N/A';
  const date = new Date(`${normalized}T00:00:00`);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export default function ViewBoqPage() {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const canAddManual = can('Add Manual', 'Project Management.BOQ');
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get('project') ?? '';
  // Arriving with ?scope2=Supply/Civil/Erection means we came from that module's own page —
  // send Back there instead of the generic BOQ hub.
  const scope2Param = (searchParams?.get('scope2') ?? '').trim().toLowerCase();
  const scopeBackPaths: Record<string, string> = { supply: 'supply', civil: 'civil', erection: 'erection' };
  const backHref = scopeBackPaths[scope2Param]
    ? `/project-management/${scopeBackPaths[scope2Param]}?project=${encodeURIComponent(mappingId)}`
    : `/project-management/boq?project=${encodeURIComponent(mappingId)}`;
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [mvacEntries, setMvacEntries] = useState<MvacEntry[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [indents, setIndents] = useState<IndentRecord[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [mdlDrawings, setMdlDrawings] = useState<MdlDrawing[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projectSlug, setProjectSlug] = useState('');
  const [globalProjectId, setGlobalProjectId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectedBoqItem, setSelectedBoqItem] = useState<BoqItem | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [sortKey, setSortKey] = useState<string>('ERP SL NO');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Column editor state
  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>([...baseTableHeaders]);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    [...baseTableHeaders].reduce(
      (acc, h) => ({
        ...acc,
        [h]: [
          'BOQ SL No',
          'ERP SL NO',
          'Description',
          'Unit',
          'QTY',
          'Unit Rate',
          'JMC/MVAC Executed Qty',
          'JMC/MVAC Certified Qty',
          'JMC/MVAC Amount',
          'Indent Qty',
          'PO Qty',
          'Total Amount',
          'Budget Price',
          'F&I %',
          'F&I Price',
          'Total Budget Price',
          'Start Date',
          'End Date',
        ].includes(h as string),
      }),
      {} as Record<string, boolean>
    )
  );
  const [columnNames, setColumnNames] = useState<Record<string, string>>(
    [...baseTableHeaders].reduce((acc, h) => ({ ...acc, [h]: h as string }), {} as Record<string, string>)
  );

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState(() => ({
    search: '',
    'Scope 1': 'all',
    'Scope 2': searchParams?.get('scope2') ?? 'all',
    'Category 1': 'all',
  }));

  // If the page was opened with a ?scope2= param (e.g. from the Supply/Civil module cards),
  // snap it to the exact casing found in the data once loaded — matching is already
  // case-insensitive below, this just keeps the dropdown's displayed value looking right.
  const appliedUrlScope2Ref = useRef(false);
  useEffect(() => {
    if (appliedUrlScope2Ref.current) return;
    const urlScope2 = searchParams?.get('scope2');
    if (!urlScope2 || !boqItems.length) return;
    appliedUrlScope2Ref.current = true;
    const match = boqItems.find(
      (item) => String(item['Scope 2'] ?? '').trim().toLowerCase() === urlScope2.trim().toLowerCase(),
    );
    if (match) {
      setFilters((prev) => ({ ...prev, 'Scope 2': String(match['Scope 2']) }));
    }
  }, [boqItems, searchParams]);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BoqItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadColumnConfiguration = async () => {
      try {
        const settingsSnapshot = await getDoc(
          doc(db, BOQ_COLUMN_SETTINGS_COLLECTION, BOQ_COLUMN_SETTINGS_DOC),
        );
        const configuredColumns = mergeBoqColumns(
          settingsSnapshot.data()?.columns,
        );
        const costingColumns = configuredColumns.filter(
          (column) => column.showInCosting,
        );

        setColumnOrder(costingColumns.map((column) => column.key));
        setColumnVisibility(
          Object.fromEntries(costingColumns.map((column) => [column.key, true])),
        );
        setColumnNames(
          Object.fromEntries(
            configuredColumns.map((column) => [column.key, column.label]),
          ),
        );
      } catch (error) {
        console.error('Failed to load BOQ column configuration:', error);
      }
    };

    void loadColumnConfiguration();
  }, []);

  /** NORMALIZE KEYS **/
  const normalizeKey = (obj: Record<string, unknown>, targetKey: string): string | undefined => {
    const needle = targetKey.toLowerCase().replace(/\s+/g, '');
    return Object.keys(obj).find((k) => k.toLowerCase().replace(/\s+/g, '') === needle);
  };
  const getBoqSlNo = (item: any): string => String(item?.['BOQ SL No'] ?? item?.['SL. No.'] ?? item?.boqSlNo ?? '').trim();
  const getScope1 = (x: any): string => {
    if (!x) return '';
    const k = Object.keys(x).find((kk) => kk.toLowerCase().replace(/\s+|\./g, '') === 'scope1');
    const v = k ? (x as any)[k] : undefined;
    return typeof v === 'string' ? v.trim() : '';
  };
  const getScope2 = (x: any): string => {
    if (!x) return '';
    const k = Object.keys(x).find((kk) => kk.toLowerCase().replace(/\s+|\./g, '') === 'scope2');
    const v = k ? (x as any)[k] : undefined;
    return typeof v === 'string' ? v.trim() : '';
  };

  /** FETCH DATA **
   * Resolves the project mapping, then fires every other read (project doc, BOQ items, JMC,
   * MVAC, bills, indents, POs, MDL drawings) in a single parallel batch — this used to be
   * 3-4 sequential round-trips (including fetching the project doc twice), which is the
   * biggest single contributor to this page feeling slow to load.
   */
  const fetchProjectAndBoq = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      toast({
        title: 'Select a project',
        description: 'Choose a Project Management project before opening BOQ Costing.',
        variant: 'destructive',
      });
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, 'projectManagementProjects', mappingId));
      if (!mappingSnapshot.exists()) throw new Error('Project mapping not found');
      const mapping = mappingSnapshot.data() as { globalProjectId?: string; globalProjectName?: string };
      if (!mapping.globalProjectId) throw new Error('Global project is not mapped');
      const projectId = mapping.globalProjectId;

      const [projectSnapshot, boqSnapshot, jmcSnapshot, mvacSnapshot, billsSnapshot, indentSnapshot, poSnapshot, mdlSnapshot] =
        await Promise.all([
          getDoc(doc(db, 'projects', projectId)),
          getDocs(collection(db, 'projects', projectId, 'boqItems')),
          getDocs(collection(db, 'projects', projectId, 'jmcEntries')),
          getDocs(collection(db, 'projects', projectId, 'mvacEntries')),
          getDocs(collection(db, 'projects', projectId, 'bills')),
          getDocs(collection(db, 'projects', projectId, 'indents')),
          getDocs(collection(db, 'projects', projectId, PO_COLLECTION)),
          getDocs(collection(db, 'projects', projectId, MDL_COLLECTION)),
        ]);

      if (!projectSnapshot.exists()) throw new Error('Project not found');
      const projectData = { id: projectSnapshot.id, ...(projectSnapshot.data() as any) } as Project;
      const globalProjectName = (projectData as any).projectName ?? mapping.globalProjectName;
      if (!globalProjectName) throw new Error('Mapped global project not found');
      const slug = slugify(globalProjectName);

      setCurrentProject(projectData);
      setProjectSlug(slug);
      setGlobalProjectId(projectId);

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
            projectSlug: slug, // <-- stamp slug on each item for the details dialog
          };
          return result;
        })
        .filter(Boolean) as BoqItem[];
      setBoqItems(items);

      setJmcEntries(jmcSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry)));
      setMvacEntries(mvacSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MvacEntry)));
      setBills(billsSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Bill)));
      setIndents(indentSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as IndentRecord)));
      setPurchaseOrders(poSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as PurchaseOrder)));
      setMdlDrawings(mdlSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MdlDrawing)));
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch BOQ items.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, toast]);

  useEffect(() => {
    if (isClient) void fetchProjectAndBoq();
  }, [fetchProjectAndBoq, isClient]);

  /** PRE-AGGREGATE EXECUTED/CERTIFIED COUNTS (fast lookups) **/
  type QtyAgg = { executed: number; certified: number };
  const jmcAggBySlNo = useMemo(() => {
    const map = new Map<string, QtyAgg>();
    for (const entry of jmcEntries) {
      const items = Array.isArray(entry.items) ? entry.items : [];
      for (const it of items) {
        const key = compositeKey(getScope1(it), getScope2(it), getBoqSlNo(it));
        if (!key) continue;
        const prev = map.get(key) ?? { executed: 0, certified: 0 };
        prev.executed += Number(it.executedQty || 0);
        prev.certified += Number(it.certifiedQty || 0);
        map.set(key, prev);
      }
    }
    return map;
  }, [jmcEntries]);

  const mvacAggBySlNo = useMemo(() => {
    const map = new Map<string, QtyAgg>();
    for (const entry of mvacEntries) {
      const items = Array.isArray(entry.items) ? entry.items : [];
      for (const it of items) {
        const key = compositeKey(getScope1(it), getScope2(it), getBoqSlNo(it));
        if (!key) continue;
        const prev = map.get(key) ?? { executed: 0, certified: 0 };
        prev.executed += Number(it.executedQty || 0);
        prev.certified += Number(it.certifiedQty || 0);
        map.set(key, prev);
      }
    }
    return map;
  }, [mvacEntries]);
  
  /** PRE-AGGREGATE INDENT/PO QUANTITIES BY BOQ ITEM ID **/
  const indentQtyByBoqItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const indent of indents) {
      if (['Rejected', 'Cancelled'].includes(indent.status)) continue;
      for (const it of indent.items ?? []) {
        if (!it.boqItemId) continue;
        map.set(it.boqItemId, (map.get(it.boqItemId) ?? 0) + Number(it.requestedQty || 0));
      }
    }
    return map;
  }, [indents]);

  const poQtyByBoqItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const po of purchaseOrders) {
      if (po.status === 'Cancelled') continue;
      for (const it of po.items ?? []) {
        if (!it.boqItemId) continue;
        map.set(it.boqItemId, (map.get(it.boqItemId) ?? 0) + Number(it.qty || 0));
      }
    }
    return map;
  }, [purchaseOrders]);

  const mdlStatusByBoqItemId = useMemo(() => {
    const map = new Map<string, MdlDrawing['status']>();
    for (const drawing of mdlDrawings) {
      if (!drawing.boqItemId) continue;
      map.set(drawing.boqItemId, drawing.status ?? 'Pending');
    }
    return map;
  }, [mdlDrawings]);

  const getQuantities = useCallback(
    (scope1: string, scope2: string, boqSlNo: string) => {
      const key = compositeKey(scope1, scope2, boqSlNo);
      if (!boqSlNo.trim()) return { executed: 0, certified: 0 };

      const jmc = jmcAggBySlNo.get(key) ?? { executed: 0, certified: 0 };
      const mvac = mvacAggBySlNo.get(key) ?? { executed: 0, certified: 0 };

      return { executed: jmc.executed + mvac.executed, certified: jmc.certified + mvac.certified };
    },
    [jmcAggBySlNo, mvacAggBySlNo]
  );

  /** FILTERS **/
  const filteredBoqItems = useMemo(() => {
    const search = filters.search.toLowerCase();
    const s1 = filters['Scope 1'];
    const s2 = filters['Scope 2'];
    const c1 = filters['Category 1'];

    return boqItems.filter((item) => {
      const searchMatch =
        filters.search === '' ||
        String(item['ERP SL NO'] ?? '').toLowerCase().includes(search) ||
        String(item['BOQ SL No'] ?? item['SL. No.'] ?? '').toLowerCase().includes(search) ||
        String(item['Description'] ?? '').toLowerCase().includes(search) ||
        String(item['Category 1'] ?? '').toLowerCase().includes(search) ||
        String(item['Category 2'] ?? '').toLowerCase().includes(search) ||
        String(item['Category 3'] ?? '').toLowerCase().includes(search);

      const scope1Match = s1 === 'all' || item['Scope 1'] === s1;
      const scope2Match =
        s2 === 'all' || String(item['Scope 2'] ?? '').trim().toLowerCase() === s2.trim().toLowerCase();
      const category1Match = c1 === 'all' || item['Category 1'] === c1;

      return searchMatch && scope1Match && scope2Match && category1Match;
    });
  }, [boqItems, filters]);

  const filterOptions = useMemo(() => {
    let base = boqItems;

    const s1Options = [...new Set(base.map((i) => i['Scope 1']).filter(Boolean))] as string[];

    if (filters['Scope 1'] !== 'all') {
      base = base.filter((i) => i['Scope 1'] === filters['Scope 1']);
    }

    // Dedupe case-insensitively — the same scope often appears with inconsistent casing in imports.
    const s2Options = Array.from(
      new Map(
        base
          .map((i) => i['Scope 2'])
          .filter(Boolean)
          .map((v) => [String(v).trim().toLowerCase(), v]),
      ).values(),
    ) as string[];

    if (filters['Scope 2'] !== 'all') {
      const s2Filter = filters['Scope 2'].trim().toLowerCase();
      base = base.filter((i) => String(i['Scope 2'] ?? '').trim().toLowerCase() === s2Filter);
    }

    const c1Options = [...new Set(base.map((i) => i['Category 1']).filter(Boolean))] as string[];

    return { 'Scope 1': s1Options, 'Scope 2': s2Options, 'Category 1': c1Options };
  }, [boqItems, filters]);

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
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
    setFilters({ search: '', 'Scope 1': 'all', 'Scope 2': 'all', 'Category 1': 'all' });
  };

  /** NUMBERS **/
  const parsedNumber = (v: unknown) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const s = v.replace(/[, ]/g, '');
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
  };

  const fmtNum = (v: unknown) => {
    const n = parsedNumber(v);
    return Number.isFinite(n)
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n as number)
      : typeof v === 'string'
      ? v
      : 'N/A';
  };

  const getBudgetValues = (item: BoqItem) => {
    const parsedBudgetPrice = parsedNumber(item['Budget Price']);
    const parsedFiPercentage = parsedNumber(item['F&I %']);
    const parsedQuantity = parsedNumber(item['QTY']);
    const budgetPrice = Number.isFinite(parsedBudgetPrice) ? parsedBudgetPrice : 0;
    const fiPercentage = Number.isFinite(parsedFiPercentage) ? parsedFiPercentage : 0;
    const quantity = Number.isFinite(parsedQuantity) ? parsedQuantity : 0;
    const fiPrice = Math.round(((budgetPrice * fiPercentage) / 100) * 100) / 100;
    const totalBudgetPrice = Math.round(budgetPrice * quantity * 100) / 100;

    return { budgetPrice, fiPercentage, fiPrice, totalBudgetPrice };
  };

  /** SORT **/
  const sortedBoqItems = useMemo(() => {
    const sorted = [...filteredBoqItems];

    const getComparableValue = (item: BoqItem, key: string): unknown => {
      const scope1 = getScope1(item);
      const scope2 = getScope2(item);
      const boqSlNo = getBoqSlNo(item);
      const { executed, certified } = getQuantities(scope1, scope2, boqSlNo);

      if (key === 'JMC/MVAC Executed Qty') return executed;
      if (key === 'JMC/MVAC Certified Qty') return certified;
      if (key === 'JMC/MVAC Amount') {
        const rate = parsedNumber(item['Unit Rate']);
        const val = Number.isFinite(rate) ? certified * (rate as number) : NaN;
        return Number.isFinite(val) ? val : 0;
      }
      if (key === 'Indent Qty') return indentQtyByBoqItemId.get(item.id) ?? 0;
      if (key === 'PO Qty') return poQtyByBoqItemId.get(item.id) ?? 0;
      if (key === 'MDL Status') {
        const isMdl = String(item.MDL ?? '').trim().toLowerCase() === 'yes';
        return isMdl ? mdlStatusByBoqItemId.get(item.id) ?? 'Pending' : '';
      }
      if (key === 'Budget Price') return getBudgetValues(item).budgetPrice;
      if (key === 'F&I %') return getBudgetValues(item).fiPercentage;
      if (key === 'F&I Price') return getBudgetValues(item).fiPrice;
      if (key === 'Total Budget Price') return getBudgetValues(item).totalBudgetPrice;

      const raw = (item as any)[key];
      const num = parsedNumber(raw);
      return Number.isFinite(num) ? num : (raw ?? '');
    };

    if (sortKey) {
      sorted.sort((a, b) => {
        const aVal = getComparableValue(a, sortKey);
        const bVal = getComparableValue(b, sortKey);

        const aNum = parsedNumber(aVal);
        const bNum = parsedNumber(bVal);

        const bothNumeric = Number.isFinite(aNum) && Number.isFinite(bNum);

        if (bothNumeric) {
          return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
        }

        const aBad = aVal === undefined || aVal === null || (typeof aVal === 'number' && !Number.isFinite(aVal));
        const bBad = bVal === undefined || bVal === null || (typeof bVal === 'number' && !Number.isFinite(bVal));
        if (aBad && !bBad) return 1;
        if (!aBad && bBad) return -1;
        if (aBad && bBad) return 0;

        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        if (aStr < bStr) return sortDirection === 'asc' ? -1 : 1;
        if (aStr > bStr) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return sorted;
  }, [filteredBoqItems, sortKey, sortDirection, getQuantities, indentQtyByBoqItemId, poQtyByBoqItemId, mdlStatusByBoqItemId]);

  /** ROW ACTIONS **/
  const handleRowClick = (item: BoqItem) => {
    // ensure the dialog has the slug it needs
    setSelectedBoqItem({ ...item, projectSlug });
    setIsDetailsDialogOpen(true);
  };

  const handleOpenEditDialog = (e: React.MouseEvent, item: BoqItem) => {
    e.stopPropagation();
    const { fiPrice, totalBudgetPrice } = getBudgetValues(item);
    setEditingItem({
      ...item,
      'F&I Price': fiPrice,
      'Total Budget Price': totalBudgetPrice,
      'Start Date': toDateInputValue(item['Start Date']),
      'End Date': toDateInputValue(item['End Date']),
    });
    setIsEditDialogOpen(true);
  };

  const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingItem) return;
    const { name, value } = e.target;
    setEditingItem((prev) => {
      if (!prev) return null;
      const next = { ...prev, [name]: value };
      if (name === 'Budget Price' || name === 'F&I %' || name === 'QTY') {
        const { fiPrice, totalBudgetPrice } = getBudgetValues(next);
        next['F&I Price'] = fiPrice;
        next['Total Budget Price'] = totalBudgetPrice;
      }
      return next;
    });
  };

  const handleSaveChanges = async () => {
    if (!editingItem || !currentProject) return;

    const startDate = String(editingItem['Start Date'] ?? '').trim();
    const endDate = String(editingItem['End Date'] ?? '').trim();
    if (Boolean(startDate) !== Boolean(endDate)) {
      toast({
        title: 'Complete the item timeline',
        description: 'Select both the start date and end date for this BOQ item.',
        variant: 'destructive',
      });
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      toast({
        title: 'Invalid item timeline',
        description: 'The BOQ item end date cannot be before its start date.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const itemRef = doc(db, 'projects', (currentProject as any).id, 'boqItems', editingItem.id);
      const { fiPrice, totalBudgetPrice } = getBudgetValues(editingItem);
      const { id, ...payload } = {
        ...editingItem,
        'F&I Price': fiPrice,
        'Total Budget Price': totalBudgetPrice,
        'Start Date': startDate,
        'End Date': endDate,
      };
      await updateDoc(itemRef, payload as any);
      toast({ title: 'Success', description: 'BOQ item updated.' });
      setIsEditDialogOpen(false);
      fetchProjectAndBoq();
    } catch (e) {
      console.error('Failed to save changes:', e);
      toast({ title: 'Error', description: 'Could not save changes.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  /** SORT HEADER CLICK **/
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  /** SELECTION (respect visible rows) **/
  const visibleHeaders = useMemo(() => columnOrder.filter((h) => columnVisibility[h]), [columnOrder, columnVisibility]);
  const visibleRowIds = useMemo(() => sortedBoqItems.map((i) => i.id), [sortedBoqItems]);

  const allSelected = visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedItemIds.includes(id));
  const someSelected = visibleRowIds.some((id) => selectedItemIds.includes(id)) && !allSelected;

  const handleSelectAll = (checked: CheckedState) => {
    if (checked === true) {
      setSelectedItemIds((prev) => Array.from(new Set([...prev, ...visibleRowIds])));
    } else {
      setSelectedItemIds((prev) => prev.filter((id) => !visibleRowIds.includes(id)));
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedItemIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  /** EXPAND/COLLAPSE **/
  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

  /** DELETE **/
  const handleDelete = async () => {
    if (!currentProject || selectedItemIds.length === 0) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach((id) => {
        batch.delete(doc(db, 'projects', (currentProject as any).id, 'boqItems', id));
      });
      await batch.commit();
      toast({ title: 'Deleted', description: `${selectedItemIds.length} item(s) removed.` });
      setSelectedItemIds([]);
      fetchProjectAndBoq();
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to delete selected items.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const dialogFields: (keyof BoqItem)[] = [
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
    'Budget Price',
    'F&I %',
    'F&I Price',
    'Total Budget Price',
    'Start Date',
    'End Date',
    'MDL',
  ];

  const selectAllState: CheckedState = allSelected ? true : someSelected ? 'indeterminate' : false;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] w-full px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={backHref}>
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
            <Calculator className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-xl font-bold">View BOQ</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canAddManual && (
            <Link href={`/project-management/boq/add?project=${encodeURIComponent(mappingId)}`}>
              <Button variant="outline">
                <ListPlus className="mr-2 h-4 w-4" /> Add Items
              </Button>
            </Link>
          )}

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className="pl-8"
            />
          </div>

          {Object.keys(filterOptions).map((key) => {
            const options = filterOptions[key as keyof typeof filterOptions] as string[];
            if (!options || options.length === 0) return null;
            return (
              <Select
                key={key}
                value={filters[key as keyof typeof filters]}
                onValueChange={(v) => handleFilterChange(key as keyof typeof filters, v)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={`Filter by ${key}`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All {key}s</SelectItem>
                  {options.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}

          <Button variant="secondary" onClick={clearFilters}>
            Clear Filters
          </Button>

          {selectedItemIds.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  {isDeleting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete ({selectedItemIds.length})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete {selectedItemIds.length} item(s).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Continue</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <Dialog open={isColumnEditorOpen} onOpenChange={setIsColumnEditorOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Settings className="mr-2 h-4 w-4" /> Columns
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Customize Columns</DialogTitle>
                    <DialogDescription>Reorder and toggle visibility of columns.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="h-[60vh]">
                    <div className="py-4 space-y-2 pr-6">
                        {columnOrder.map((header) => (
                            <div key={header} className="flex items-center gap-2 p-2 border rounded-md">
                                <Checkbox
                                    id={`vis-${header}`}
                                    checked={!!columnVisibility[header]}
                                    onCheckedChange={(checked) => setColumnVisibility((prev) => ({ ...prev, [header]: !!checked }))}
                                />
                                <Label htmlFor={`vis-${header}`} className="flex-1">
                                    {columnNames[header] || header}
                                </Label>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button>Done</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0">
        <div className="h-full border rounded-lg flex flex-col min-w-0">
          <div className="relative flex-1 min-h-0 w-full">
              <div className="h-full">
                <Table className="text-sm" containerClassName="h-full overflow-auto">
                  <TableHeader>
                    <TableRow>
                      {/* Sticky selection cell */}
                      <TableHead
                        className="sticky left-0 top-0 bg-background z-30 w-[50px] shadow-[1px_0_0_0_var(--border)]"
                        aria-sort="none"
                      >
                        <Checkbox
                          checked={selectAllState}
                          onCheckedChange={(state) => handleSelectAll(state)}
                          aria-label="Select all rows"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableHead>
                      {/* Sticky expand cell */}
                      <TableHead className="sticky left-[50px] top-0 bg-background z-30 w-12 shadow-[1px_0_0_0_var(--border)]">
                        <span className="sr-only">Expand</span>
                      </TableHead>

                      {visibleHeaders.map((header) => (
                        <TableHead
                          key={header}
                          className="sticky top-0 bg-background z-20 whitespace-nowrap px-4 cursor-pointer select-none"
                          onClick={() => handleSort(header)}
                          title="Sort"
                          aria-sort={sortKey === header ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <div className="flex items-center gap-1">
                            {columnNames[header] || header}
                            {sortKey === header ? (
                              sortDirection === 'asc' ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )
                            ) : (
                              <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
                            )}
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="sticky top-0 bg-background z-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="sticky left-0 bg-background z-10 shadow-[1px_0_0_0_var(--border)]">
                            <Skeleton className="h-5 w-5" />
                          </TableCell>
                          <TableCell className="sticky left-[50px] bg-background z-10 shadow-[1px_0_0_0_var(--border)] px-2">
                            <Skeleton className="h-5 w-5" />
                          </TableCell>
                          {visibleHeaders.map((_, j) => (
                            <TableCell key={`${i}-${j}`}>
                              <Skeleton className="h-5 w-full" />
                            </TableCell>
                          ))}
                          <TableCell>
                            <Skeleton className="h-8 w-16" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : sortedBoqItems.length > 0 ? (
                      sortedBoqItems.map((item) => {
                        const isExpanded = expandedRows.has(item.id);
                        const hasBom = !!(item.bom && item.bom.length > 0);
                        const scope1 = getScope1(item);
                        const scope2 = getScope2(item);
                        const boqSlNo = getBoqSlNo(item);
                        const budgetValues = getBudgetValues(item);

                        return (
                          <Fragment key={item.id}>
                            <TableRow
                              data-state={selectedItemIds.includes(item.id) && 'selected'}
                              onClick={() => handleRowClick(item)}
                              className="cursor-pointer"
                            >
                              {/* Sticky selection cell */}
                              <TableCell
                                className="sticky left-0 bg-background z-10 shadow-[1px_0_0_0_var(--border)]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Checkbox
                                  checked={selectedItemIds.includes(item.id)}
                                  onCheckedChange={(state) => handleSelectRow(item.id, state === true)}
                                  aria-label={`Select row ${item.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </TableCell>

                              {/* Sticky expand cell */}
                              <TableCell className="sticky left-[50px] bg-background z-10 shadow-[1px_0_0_0_var(--border)] px-2">
                                {hasBom ? (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleRowExpansion(item.id);
                                    }}
                                    aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                                  >
                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </Button>
                                ) : null}
                              </TableCell>

                              {visibleHeaders.map((header) => {
                                let display: React.ReactNode;

                                if (
                                  header === 'JMC/MVAC Executed Qty' ||
                                  header === 'JMC/MVAC Certified Qty' ||
                                  header === 'JMC/MVAC Amount'
                                ) {
                                  const { executed, certified } = getQuantities(scope1, scope2, boqSlNo);
                                  if (header === 'JMC/MVAC Executed Qty') {
                                    display = fmtNum(executed);
                                  } else if (header === 'JMC/MVAC Certified Qty') {
                                    display = fmtNum(certified);
                                  } else {
                                    const rate = parsedNumber(item['Unit Rate']);
                                    const val = Number.isFinite(rate) ? certified * (rate as number) : 0;
                                    display = fmtNum(val);
                                  }
                                } else if (header === 'Indent Qty') {
                                  display = fmtNum(indentQtyByBoqItemId.get(item.id) ?? 0);
                                } else if (header === 'PO Qty') {
                                  display = fmtNum(poQtyByBoqItemId.get(item.id) ?? 0);
                                } else if (header === 'MDL Status') {
                                  const isMdl = String(item.MDL ?? '').trim().toLowerCase() === 'yes';
                                  if (!isMdl) {
                                    display = <span className="text-muted-foreground">—</span>;
                                  } else {
                                    const status = mdlStatusByBoqItemId.get(item.id) ?? 'Pending';
                                    display = (
                                      <span
                                        className={cn(
                                          'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                                          mdlOverallStatusStyles[status],
                                        )}
                                      >
                                        {status}
                                      </span>
                                    );
                                  }
                                } else {
                                  const raw = item[header];
                                  if (
                                    header === 'Budget Price' ||
                                    header === 'F&I %' ||
                                    header === 'F&I Price' ||
                                    header === 'Total Budget Price'
                                  ) {
                                    if (header === 'Budget Price') display = fmtNum(budgetValues.budgetPrice);
                                    if (header === 'F&I %') display = `${fmtNum(budgetValues.fiPercentage)}%`;
                                    if (header === 'F&I Price') display = fmtNum(budgetValues.fiPrice);
                                    if (header === 'Total Budget Price') display = fmtNum(budgetValues.totalBudgetPrice);
                                  } else if (header === 'Start Date' || header === 'End Date') {
                                    display = formatBoqDate(raw);
                                  } else if (header === 'Total Amount') {
                                    const explicit = parsedNumber(raw);
                                    if (Number.isFinite(explicit)) {
                                      display = fmtNum(explicit);
                                    } else {
                                      const qty = parsedNumber(item['QTY']);
                                      const rate = parsedNumber(item['Unit Rate']);
                                      display = Number.isFinite(qty) && Number.isFinite(rate) ? fmtNum(qty * rate) : 'N/A';
                                    }
                                  } else if (header === 'QTY' || header === 'Unit Rate') {
                                    display = fmtNum(raw);
                                  } else if (typeof raw === 'string' || typeof raw === 'number') {
                                    display = raw;
                                  } else {
                                    display = 'N/A';
                                  }
                                }

                                const shouldTruncate = ['Description', 'Category 1', 'Category 2', 'Category 3'].includes(
                                  header
                                );
                                const titleText = typeof display === 'string' || typeof display === 'number' ? String(display) : undefined;

                                return (
                                  <TableCell key={`${item.id}-${header}`} className={cn(shouldTruncate && 'max-w-xs')}>
                                    <p className="truncate" title={titleText}>{display}</p>
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
                                    <h4 className="font-semibold mb-2 ml-2 text-sm">Bill of Materials</h4>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Mark No.</TableHead>
                                          <TableHead>Section</TableHead>
                                          <TableHead>Qty/Set</TableHead>
                                          <TableHead>Total Wt (KG)</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {(item.bom ?? []).map((bomItem: FabricationBomItem, index: number) => (
                                          <TableRow key={index}>
                                            <TableCell>{bomItem.markNo ?? '—'}</TableCell>
                                            <TableCell>{bomItem.section ?? '—'}</TableCell>
                                            <TableCell>{fmtNum(bomItem.qtyPerSet)}</TableCell>
                                            <TableCell>{fmtNum(bomItem.totalWtKg)}</TableCell>
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
                      <TableRow>
                        <TableCell colSpan={visibleHeaders.length + 3} className="text-center h-24">
                          No BOQ items found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
          </div>
        </div>
      </div>

      <BoqItemDetailsDialog
        isOpen={isDetailsDialogOpen}
        onOpenChange={setIsDetailsDialogOpen}
        item={selectedBoqItem}
      />

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit BOQ Item</DialogTitle></DialogHeader>
          <div className="py-4 grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
              {editingItem && dialogFields.map((key: keyof BoqItem) => (
                  <div className="space-y-1" key={key}>
                      <Label htmlFor={`edit-${String(key)}`}>
                        {String(key)}
                        {key === 'MDL' && <span className="font-normal text-muted-foreground"> (Master Drawing List)</span>}
                      </Label>
                      {key === 'MDL' ? (
                        <Select
                          value={String((editingItem as any)[key] ?? '')}
                          onValueChange={(value) =>
                            setEditingItem((prev) => (prev ? { ...prev, MDL: value } : null))
                          }
                        >
                          <SelectTrigger id="edit-MDL"><SelectValue placeholder="Select..." /></SelectTrigger>
                          <SelectContent>
                            {YES_NO_OPTIONS.map((option) => (
                              <SelectItem key={option} value={option}>{option}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                            id={`edit-${String(key)}`}
                            name={String(key)}
                            value={(editingItem as any)[key] ?? ''}
                            onChange={handleEditFormChange}
                            type={
                              ['Start Date', 'End Date'].includes(String(key))
                                ? 'date'
                                : ['Budget Price', 'F&I %', 'F&I Price', 'Total Budget Price'].includes(String(key))
                                  ? 'number'
                                  : 'text'
                            }
                            step={['Budget Price', 'F&I %'].includes(String(key)) ? '0.01' : undefined}
                            min={key === 'End Date' ? String(editingItem['Start Date'] ?? '') || undefined : undefined}
                            max={key === 'Start Date' ? String(editingItem['End Date'] ?? '') || undefined : undefined}
                            readOnly={key === 'Project Name' || key === 'F&I Price' || key === 'Total Budget Price'}
                        />
                      )}
                  </div>
              ))}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSaveChanges} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
