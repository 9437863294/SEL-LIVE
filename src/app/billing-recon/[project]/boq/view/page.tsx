
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { FabricationBomItem, JmcEntry, UserSettings, Bill, Project } from '@/lib/types';
import BoqItemDetailsDialog from '@/components/BoqItemDetailsDialog';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CheckedState } from '@radix-ui/react-checkbox';

export type BoqItem = {
  id: string;
  'ERP SL NO'?: string | number;
  'BOQ SL No'?: string | number;
  'Description'?: string;
  'Unit'?: string;
  'QTY'?: number | string;
  'Unit Rate'?: number | string;
  'Total Amount'?: number | string;
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
  'JMC Executed Qty',
  'JMC Certified Qty',
  'JMC Amount',
] as const;

// composite key helper: (scope2 + boq sl no)
const compositeKey = (scope2: unknown, slNo: unknown) =>
  `${String(scope2 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;

const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');


export default function ViewBoqPage() {
  const { toast } = useToast();
  const { project: projectSlug } = useParams() as { project: string };

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
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
          'JMC Certified Qty',
          'JMC Amount',
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

  /** LOAD/SAVE PREFERENCES **/
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settingsRef = doc(db, 'userSettings', 'global'); // per-user? swap 'global' with uid
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          const settings = settingsSnap.data() as UserSettings;
          const pageSettings = settings.columnPreferences?.[settingsKey];
          if (pageSettings) {
            setColumnOrder(pageSettings.order || [...baseTableHeaders]);
            setColumnVisibility(pageSettings.visibility || {});
            setColumnNames(pageSettings.names || {});
            if (pageSettings.sort) {
              setSortKey(pageSettings.sort.key);
              setSortDirection(pageSettings.sort.direction);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to load column settings from Firestore', e);
      }
    };
    if (settingsKey) fetchSettings();
  }, [settingsKey]);

  const saveColumnSettings = useCallback(async () => {
    if (!settingsKey) return;
    try {
      const settingsRef = doc(db, 'userSettings', 'global');
      const currentSettingsSnap = await getDoc(settingsRef);
      const currentSettings = currentSettingsSnap.exists() ? currentSettingsSnap.data() : { columnPreferences: {} };

      const newPreferences = {
        ...currentSettings.columnPreferences,
        [settingsKey]: {
          order: columnOrder,
          visibility: columnVisibility,
          names: columnNames,
          sort: { key: sortKey, direction: sortDirection },
        },
      };

      await setDoc(settingsRef, { ...currentSettings, columnPreferences: newPreferences }, { merge: true });
    } catch (e) {
      console.warn('Failed to save column settings to Firestore', e);
      toast({ title: 'Error', description: 'Could not save your column preferences.', variant: 'destructive' });
    }
  }, [settingsKey, columnOrder, columnVisibility, columnNames, sortKey, sortDirection, toast]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    saveColumnSettings();
  }, [columnOrder, columnVisibility, columnNames, sortKey, sortDirection, saveColumnSettings]);

  /** NORMALIZE KEYS **/
  const normalizeKey = (obj: Record<string, unknown>, targetKey: string): string | undefined => {
    const needle = targetKey.toLowerCase().replace(/\s+/g, '');
    return Object.keys(obj).find((k) => k.toLowerCase().replace(/\s+/g, '') === needle);
  };

  /** FETCH DATA **/
  const fetchBoqItems = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);
        const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

        if (!projectData) {
            throw new Error("Project not found");
        }
        setCurrentProject(projectData);
        
        const projectId = projectData.id;

      const boqItemsRef = collection(db, 'projects', projectId, 'boqItems');
      const boqSnapshot = await getDocs(query(boqItemsRef));
      const items: BoqItem[] = boqSnapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const erpKey = normalizeKey(data, 'ERP SL NO');
        const boqKey = normalizeKey(data, 'BOQ SL No');
        return {
          id: d.id,
          ...data,
          'ERP SL NO': erpKey ? (data as any)[erpKey] : '',
          'BOQ SL No': boqKey ? (data as any)[boqKey] : '',
        };
      });
      setBoqItems(items);

      const jmcSnapshot = await getDocs(collection(db, 'projects', projectId, 'jmcEntries'));
      setJmcEntries(jmcSnapshot.docs.map((d) => d.data() as JmcEntry));

      const billsSnapshot = await getDocs(collection(db, 'projects', projectId, 'bills'));
      setBills(billsSnapshot.docs.map((d) => d.data() as Bill));
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    fetchBoqItems();
  }, [fetchBoqItems]);

  /** JMC QUANTITIES MAP (composite keyed) **/
  const jmcQuantities = useMemo(() => {
    const quantities: Record<string, { executed: number; certified: number }> = {};
    jmcEntries.forEach((entry) => {
      entry.items.forEach((it: any) => {
        const key = compositeKey(it.scope2, it.boqSlNo);
        if (!key) return;
        if (!quantities[key]) quantities[key] = { executed: 0, certified: 0 };
        quantities[key].executed += Number(it.executedQty || 0);
        quantities[key].certified += Number(it.certifiedQty || 0);
      });
    });
    return quantities;
  }, [jmcEntries]);

  /** FILTERS **/
  const filteredBoqItems = useMemo(() => {
    return boqItems.filter((item) => {
      const search = filters.search.toLowerCase();
      const searchMatch =
        filters.search === '' ||
        String(item['ERP SL NO'] ?? '').toLowerCase().includes(search) ||
        String(item['BOQ SL No'] ?? '').toLowerCase().includes(search) ||
        String(item['Description'] ?? '').toLowerCase().includes(search);

      const s1 = filters['Scope 1'];
      const s2 = filters['Scope 2'];
      const c1 = filters['Category 1'];

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

  /** SORT **/
  const parsedNumber = (v: unknown) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const s = v.replace(/[, ]/g, '');
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
  };

  const sortedBoqItems = useMemo(() => {
    const sorted = [...filteredBoqItems];

    const getComparableValue = (item: BoqItem, key: string): unknown => {
      const compKey = compositeKey(item['Scope 2'], item['BOQ SL No']);
      if (key === 'JMC Executed Qty') {
        return Number(jmcQuantities[compKey]?.executed || 0);
      }
      if (key === 'JMC Certified Qty') {
        return Number(jmcQuantities[compKey]?.certified || 0);
      }
      if (key === 'JMC Amount') {
        const qty = Number(jmcQuantities[compKey]?.certified || 0);
        const rate = parsedNumber(item['Unit Rate']);
        return Number.isFinite(qty) && Number.isFinite(rate) ? qty * (rate as number) : NaN;
      }
      return (item as any)[key];
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

        const aBad = aVal === undefined || aVal === null;
        const bBad = bVal === undefined || bVal === null;
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
  }, [filteredBoqItems, sortKey, sortDirection, jmcQuantities]);

  /** ROW ACTIONS **/
  const handleRowClick = (item: BoqItem) => {
    setSelectedBoqItem(item);
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
      const itemRef = doc(db, 'projects', currentProject.id, 'boqItems', editingItem.id);
      const { id, ...payload } = editingItem;
      await updateDoc(itemRef, payload);
      toast({ title: 'Success', description: 'BOQ item updated.' });
      setIsEditDialogOpen(false);
      fetchBoqItems();
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
        batch.delete(doc(db, 'projects', currentProject.id, 'boqItems', id));
      });
      await batch.commit();
      toast({ title: 'Deleted', description: `${selectedItemIds.length} item(s) removed.` });
      setSelectedItemIds([]);
      fetchBoqItems();
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to delete selected items.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  /** HELPERS **/
  const fmtNum = (v: unknown) => {
    const n = parsedNumber(v);
    return Number.isFinite(n)
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n)
      : typeof v === 'string'
      ? v
      : 'N/A';
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
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] w-full px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/billing-recon/${projectSlug}/boq`}>
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

          <Button variant="outline" onClick={() => setIsColumnEditorOpen(true)}>
            <Settings className="mr-2 h-4 w-4" /> Columns
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0">
        <div className="h-full border rounded-lg flex flex-col min-w-0">
          <div className="relative flex-1 min-h-0 w-full overflow-auto">
            <div className="min-w-max">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    {/* Sticky selection cell */}
                    <TableHead className="sticky left-0 top-0 bg-background z-30 w-[50px] shadow-[1px_0_0_0_var(--border)]">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
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
                              let raw: unknown = item[header];

                              if (
                                header === 'JMC Executed Qty' ||
                                header === 'JMC Certified Qty' ||
                                header === 'JMC Amount'
                              ) {
                                const key = `${String(item['Scope 2'] ?? '').trim().toLowerCase()}__${String(
                                  item['BOQ SL No'] ?? ''
                                ).trim()}`;
                                if (header === 'JMC Executed Qty') {
                                  raw = jmcQuantities[key]?.executed ?? 0;
                                } else if (header === 'JMC Certified Qty') {
                                  raw = jmcQuantities[key]?.certified ?? 0;
                                }
                              }

                              // produce a string | number ONLY for rendering
                              let display: string | number;

                              if (header === 'Total Amount') {
                                const explicit = parsedNumber(raw);
                                if (Number.isFinite(explicit)) {
                                  display = fmtNum(explicit);
                                } else {
                                  const qty = parsedNumber(item['QTY']);
                                  const rate = parsedNumber(item['Unit Rate']);
                                  display =
                                    Number.isFinite(qty) && Number.isFinite(rate) ? fmtNum(qty * rate) : 'N/A';
                                }
                              } else if (header === 'JMC Amount') {
                                const key = `${String(item['Scope 2'] ?? '').trim().toLowerCase()}__${String(
                                  item['BOQ SL No'] ?? ''
                                ).trim()}`;
                                const jmcQty = parsedNumber(jmcQuantities[key]?.certified ?? 0);
                                const rate = parsedNumber(item['Unit Rate']);
                                display =
                                  Number.isFinite(jmcQty) && Number.isFinite(rate) ? fmtNum(jmcQty * rate) : 'N/A';
                              } else if (
                                header === 'QTY' ||
                                header === 'Unit Rate' ||
                                header === 'JMC Executed Qty' ||
                                header === 'JMC Certified Qty'
                              ) {
                                // numeric-ish fields get formatted number (string)
                                display = fmtNum(raw);
                              } else if (typeof raw === 'string' || typeof raw === 'number') {
                                display = raw;
                              } else {
                                // anything else (objects like Timestamp, null/undefined, etc.)
                                display = 'N/A';
                              }

                              const title = typeof display === 'string' ? display : undefined;

                              return (
                                <TableCell
                                  key={`${item.id}-${header}`}
                                  className={cn(
                                    (header === 'Description' || header === 'Category 1') && 'max-w-xs truncate'
                                  )}
                                  title={title}
                                >
                                  {display}
                                </TableCell>
                              );
                            })}

                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => handleOpenEditDialog(e, item)}
                              >
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
                                      {item.bom!.map((bomItem: FabricationBomItem, index: number) => (
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
        jmcEntries={jmcEntries}
        bills={bills}
      />

      {/* Edit BOQ Item */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit BOQ Item</DialogTitle>
          </DialogHeader>
          <div className="py-4 grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
            {editingItem &&
              ([
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
              ] as const).map((key) => (
                <div className="space-y-1" key={key}>
                  <Label htmlFor={`edit-${String(key)}`}>{String(key)}</Label>
                  <Input
                    id={`edit-${String(key)}`}
                    name={String(key)}
                    value={(editingItem[key] as string | number | undefined) ?? ''}
                    onChange={handleEditFormChange}
                    readOnly={key === 'Project Name'}
                  />
                </div>
              ))}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSaveChanges} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Column Editor */}
      <Dialog open={isColumnEditorOpen} onOpenChange={setIsColumnEditorOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Columns</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {columnOrder.map((h, idx) => (
              <div key={h} className="grid grid-cols-12 items-center gap-3 border rounded-md p-3">
                {/* Visibility */}
                <div className="col-span-2 flex items-center gap-2">
                  <Checkbox
                    checked={!!columnVisibility[h]}
                    onCheckedChange={(checked) =>
                      setColumnVisibility((prev) => ({ ...prev, [h]: checked === true }))
                    }
                    id={`vis-${h}`}
                  />
                  <label htmlFor={`vis-${h}`} className="text-sm">Visible</label>
                </div>

                {/* Display name */}
                <div className="col-span-7">
                  <Label htmlFor={`name-${h}`} className="text-xs text-muted-foreground">
                    Display name
                  </Label>
                  <Input
                    id={`name-${h}`}
                    value={columnNames[h] ?? h}
                    onChange={(e) =>
                      setColumnNames((prev) => ({ ...prev, [h]: e.target.value }))
                    }
                  />
                  <div className="text-xs text-muted-foreground mt-1">Key: {h}</div>
                </div>

                {/* Reorder */}
                <div className="col-span-3 flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setColumnOrder((prev) => {
                        if (idx === 0) return prev;
                        const copy = [...prev];
                        [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                        return copy;
                      })
                    }
                    disabled={idx === 0}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setColumnOrder((prev) => {
                        if (idx === prev.length - 1) return prev;
                        const copy = [...prev];
                        [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                        return copy;
                      })
                    }
                    disabled={idx === columnOrder.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                // quick reset to defaults
                setColumnOrder([...baseTableHeaders]);
                setColumnVisibility(
                  [...baseTableHeaders].reduce((acc, h) => {
                    acc[h as string] = [
                      'BOQ SL No', 'ERP SL NO', 'Description', 'Unit', 'QTY',
                      'Unit Rate', 'JMC Certified Qty', 'JMC Amount', 'Total Amount',
                    ].includes(h as string);
                    return acc;
                  }, {} as Record<string, boolean>)
                );
                setColumnNames([...baseTableHeaders].reduce(
                  (acc, h) => ({ ...acc, [h]: h as string }), {} as Record<string, string>
                ));
              }}
            >
              Reset
            </Button>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
            <Button
              onClick={async () => {
                try {
                  await saveColumnSettings();
                } finally {
                  setIsColumnEditorOpen(false);
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
