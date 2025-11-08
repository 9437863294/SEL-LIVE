
'use client';

import React, { useState, useEffect, useMemo, Fragment, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Trash2,
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
import { collection, getDocs, writeBatch, doc, query, updateDoc, setDoc, getDoc, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
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
import type { FabricationBomItem, JmcEntry, UserSettings, Bill, Project, MvacEntry, MvacItem } from '@/lib/types';
import BoqItemDetailsDialog from '@/components/BoqItemDetailsDialog';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CheckedState } from '@radix-ui/react-checkbox';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
] as const;

const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

const compositeKey = (scope1: unknown, scope2: unknown, slNo: unknown) =>
  `${String(scope1 ?? '').trim().toLowerCase()}__${String(scope2 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;

export default function ViewBoqPage() {
  const { toast } = useToast();
  const { project: projectSlug } = useParams() as { project: string };
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [mvacEntries, setMvacEntries] = useState<MvacEntry[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
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
          'Total Amount',
        ].includes(h as string),
      }),
      {} as Record<string, boolean>
    )
  );
  const [columnNames, setColumnNames] = useState<Record<string, string>>(
    [...baseTableHeaders].reduce((acc, h) => ({ ...acc, [h]: h as string }), {} as Record<string, string>)
  );

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState({
    search: '',
    'Scope 1': 'all',
    'Scope 2': 'all',
    'Category 1': 'all',
  });

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BoqItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isInitialMount = useRef(true);

  /** SETTINGS KEY **/
  const settingsKey = useMemo(() => {
    if (!projectSlug) return '';
    return `boqTable:${projectSlug}`;
  }, [projectSlug]);

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

  const getErpSlNo = (item: any): string => String(item?.['ERP SL NO'] ?? '').trim();


  /** FETCH DATA **/
  const fetchProjectAndBoq = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
      const projectData = projectsSnapshot.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) } as Project))
        .find((p) => slugify((p as any).projectName || '') === projectSlug);

      if (!projectData) {
        throw new Error('Project not found');
      }
      setCurrentProject(projectData);

      const projectId = (projectData as any).id;

      // BOQ items
      const boqSnapshot = await getDocs(query(collection(db, 'projects', projectId, 'boqItems')));
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
            projectSlug, // <-- stamp slug on each item for the details dialog
          };
          return result;
        })
        .filter(Boolean) as BoqItem[];
      setBoqItems(items);

      // JMC / MVAC / Bills
      const [jmcSnapshot, mvacSnapshot, billsSnapshot] = await Promise.all([
        getDocs(collection(db, 'projects', projectId, 'jmcEntries')),
        getDocs(collection(db, 'projects', projectId, 'mvacEntries')),
        getDocs(collection(db, 'projects', projectId, 'bills')),
      ]);

      setJmcEntries(jmcSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry)));
      setMvacEntries(mvacSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MvacEntry)));
      setBills(billsSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Bill)));
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    if (isClient) fetchProjectAndBoq();
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
        String(getErpSlNo(item) ?? '').toLowerCase().includes(search) ||
        String(getBoqSlNo(item) ?? '').toLowerCase().includes(search) ||
        String(item['Description'] ?? '').toLowerCase().includes(search) ||
        String(item['Category 1'] ?? '').toLowerCase().includes(search) ||
        String(item['Category 2'] ?? '').toLowerCase().includes(search) ||
        String(item['Category 3'] ?? '').toLowerCase().includes(search);

      const scope1Match = s1 === 'all' || item['Scope 1'] === s1;
      const scope2Match = s2 === 'all' || item['Scope 2'] === s2;
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

    const s2Options = [...new Set(base.map((i) => i['Scope 2']).filter(Boolean))] as string[];

    if (filters['Scope 2'] !== 'all') {
      base = base.filter((i) => i['Scope 2'] === filters['Scope 2']);
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
  }, [filteredBoqItems, sortKey, sortDirection, getQuantities]);

  /** ROW ACTIONS **/
  const handleRowClick = (item: BoqItem) => {
    // ensure the dialog has the slug it needs
    setSelectedBoqItem({ ...item, projectSlug });
    setIsDetailsDialogOpen(true);
  };

  const handleOpenEditDialog = (e: React.MouseEvent, item: BoqItem) => {
    e.stopPropagation();
    setEditingItem({ ...item });
    setIsEditDialogOpen(true);
  };

  const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingItem) return;
    const { name, value } = e.target;
    setEditingItem((prev) => (prev ? { ...prev, [name]: value } : null));
  };

  const handleSaveChanges = async () => {
    if (!editingItem || !currentProject) return;
    setIsSaving(true);
    try {
      const itemRef = doc(db, 'projects', (currentProject as any).id, 'boqItems', editingItem.id);
      const { id, ...payload } = editingItem;
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
  const selectAllState: CheckedState = allSelected ? true : someSelected ? 'indeterminate' : false;

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

  const allMvacItems = useMemo(() => mvacEntries.flatMap((entry) => entry.items ?? []), [mvacEntries]);

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
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] w-full px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/store-stock-management/${projectSlug}/boq`}>
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">View BOQ</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
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
          <div className="relative flex-1 min-h-0 w-full overflow-auto">
            <TooltipProvider>
              <div className="min-w-max">
                <Table className="text-sm">
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
                                } else {
                                  const raw = item[header];
                                  if (header === 'Total Amount') {
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

                                return (
                                  <TableCell key={`${item.id}-${header}`} className={cn(shouldTruncate && 'max-w-xs')}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <p className="truncate">{display}</p>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="max-w-md">{display as any}</p>
                                      </TooltipContent>
                                    </Tooltip>
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
            </TooltipProvider>
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
              {editingItem && dialogFields.map(key => (
                  <div className="space-y-1" key={key}>
                      <Label htmlFor={`edit-${String(key)}`}>{String(key)}</Label>
                      <Input
                          id={`edit-${String(key)}`}
                          name={String(key)}
                          value={editingItem[key as keyof BoqItem] || ''}
                          onChange={handleEditFormChange}
                          readOnly={key === 'Project Name'}
                      />
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
