'use client';

import { useState, useEffect, useMemo, Fragment, useCallback } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch, doc, query, where } from 'firebase/firestore';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import type { FabricationBomItem } from '@/lib/types';
import BoqItemDetailsDialog from '@/components/BoqItemDetailsDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** TYPES **/
export type BoqItem = {
  id: string;
  'ERP SL NO'?: string | number;
  'BOQ SL No'?: string | number;
  'Description'?: string;
  'Unit'?: string;
  'QTY'?: number;
  'Unit Rate'?: number;
  'Total Amount'?: number;
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
] as const;

export default function ViewBoqPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { project: projectSlug } = useParams() as { project: string };

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectedBoqItem, setSelectedBoqItem] = useState<BoqItem | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [sortKey, setSortKey] = useState<string>('ERP SL NO');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>([...baseTableHeaders]);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    [...baseTableHeaders].reduce(
      (acc, h) => ({
        ...acc,
        [h]: ['BOQ SL No', 'ERP SL NO', 'Description', 'Unit', 'QTY', 'Category 1'].includes(h as string),
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

  /*** CLIENT FLAG ***/
  useEffect(() => {
    setIsClient(true);
  }, []);

  /*** PERSISTENCE KEYS ***/
  const userKey = useMemo(() => {
    if (!user) return 'guest';
    if (typeof user === 'object' && 'uid' in user && (user as any).uid) return (user as any).uid as string;
    if (typeof user === 'object' && 'id' in user && (user as any).id) return (user as any).id as string;
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('auth:uid');
      if (stored) return stored;
    }
    return 'guest';
  }, [user]);

  const prefKey = useMemo(() => (projectSlug ? `boqTable:${projectSlug}:${userKey}` : ''), [projectSlug, userKey]);

  /*** LOAD/SAVE PREFERENCES ***/
  useEffect(() => {
    if (!prefKey) return;
    try {
      const raw = localStorage.getItem(prefKey);
      if (!raw) return;
      const { order, visibility, names, sort } = JSON.parse(raw);
      if (Array.isArray(order)) setColumnOrder(order);
      if (visibility) setColumnVisibility(visibility);
      if (names) setColumnNames(names);
      if (sort?.key && sort?.direction) {
        setSortKey(sort.key);
        setSortDirection(sort.direction);
      }
    } catch (e) {
      console.warn('Failed to load prefs', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefKey]);

  const savePrefs = useCallback(
    (
      next?: Partial<{
        order: string[];
        visibility: Record<string, boolean>;
        names: Record<string, string>;
        sort: { key: string; direction: 'asc' | 'desc' };
      }>
    ) => {
      if (!prefKey) return;
      try {
        const current = localStorage.getItem(prefKey);
        const payload = {
          order: columnOrder,
          visibility: columnVisibility,
          names: columnNames,
          sort: { key: sortKey, direction: sortDirection },
          ...(current ? JSON.parse(current) : {}),
          ...(next || {}),
        };
        localStorage.setItem(prefKey, JSON.stringify(payload));
      } catch (e) {
        console.warn('Failed to save prefs', e);
      }
    },
    [prefKey, columnOrder, columnVisibility, columnNames, sortKey, sortDirection]
  );

  /*** NORMALIZE KEYS FROM FIRESTORE ***/
  const normalizeKey = (obj: any, targetKey: string): string | undefined => {
    const foundKey = Object.keys(obj).find(
      (k) => k.toLowerCase().replace(/\s+/g, '') === targetKey.toLowerCase().replace(/\s+/g, '')
    );
    return foundKey;
  };

  /*** FETCH ***/
  const fetchBoqItems = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const boqItemsRef = collection(db, 'projects', projectSlug, 'boqItems');
      const q = query(boqItemsRef); // simplified query
      const boqSnapshot = await getDocs(q);
      const items = boqSnapshot.docs.map((d) => {
        const data = d.data() as any;
        const erpKey = normalizeKey(data, 'ERP SL NO');
        const boqKey = normalizeKey(data, 'BOQ SL No');
        return {
          id: d.id,
          ...data,
          'ERP SL NO': erpKey ? (data as any)[erpKey] : '',
          'BOQ SL No': boqKey ? (data as any)[boqKey] : '',
        } as BoqItem;
      });
      setBoqItems(items);
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

  const filteredBoqItems = useMemo(() => {
    return boqItems.filter(item => {
      const searchMatch = filters.search === '' || 
        String(item['ERP SL NO'] || '').toLowerCase().includes(filters.search.toLowerCase()) ||
        String(item['BOQ SL No'] || '').toLowerCase().includes(filters.search.toLowerCase()) ||
        String(item['Description'] || '').toLowerCase().includes(filters.search.toLowerCase());
      
      const scope1Match = filters['Scope 1'] === 'all' || item['Scope 1'] === filters['Scope 1'];
      const scope2Match = filters['Scope 2'] === 'all' || item['Scope 2'] === filters['Scope 2'];
      const category1Match = filters['Category 1'] === 'all' || item['Category 1'] === filters['Category 1'];

      return searchMatch && scope1Match && scope2Match && category1Match;
    })
  }, [boqItems, filters]);

  const filterOptions = useMemo(() => {
    const scope1 = [...new Set(boqItems.map(item => item['Scope 1']).filter(Boolean))];
    const scope2 = [...new Set(boqItems.map(item => item['Scope 2']).filter(Boolean))];
    const category1 = [...new Set(boqItems.map(item => item['Category 1']).filter(Boolean))];
    return { 'Scope 1': scope1, 'Scope 2': scope2, 'Category 1': category1 };
  }, [boqItems]);

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilters(prev => ({...prev, [key]: value}));
  };

  /*** SORTED DATA ***/
  const sortedBoqItems = useMemo(() => {
    const sorted = [...filteredBoqItems];
    if (sortKey) {
      sorted.sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        const numA = Number(valA);
        const numB = Number(valB);
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
          return sortDirection === 'asc' ? numA - numB : numB - numA;
        }
        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        if (strA < strB) return sortDirection === 'asc' ? -1 : 1;
        if (strA > strB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sorted;
  }, [filteredBoqItems, sortKey, sortDirection]);

  /*** ROW CLICK ***/
  const handleRowClick = (item: BoqItem) => {
    setSelectedBoqItem(item);
    setIsDetailsDialogOpen(true);
  };

  /*** SORT HEADER CLICK ***/
  const handleSort = (key: string) => {
    if (sortKey === key) {
      const next = sortDirection === 'asc' ? 'desc' : 'asc';
      setSortDirection(next);
      savePrefs({ sort: { key, direction: next } });
    } else {
      setSortKey(key);
      setSortDirection('asc');
      savePrefs({ sort: { key, direction: 'asc' } });
    }
  };

  /*** SELECTION ***/
  const allSelected = selectedItemIds.length === boqItems.length && boqItems.length > 0;
  const someSelected = selectedItemIds.length > 0 && selectedItemIds.length < boqItems.length;

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked) setSelectedItemIds(boqItems.map((i) => i.id));
    else setSelectedItemIds([]);
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedItemIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  /*** EXPAND/COLLAPSE ***/
  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

  /*** DELETE ***/
  const handleDelete = async () => {
    if (!projectSlug || selectedItemIds.length === 0) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach((id) => {
        batch.delete(doc(db, 'projects', projectSlug, 'boqItems', id));
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

  /*** DND — COLUMN REORDER ***/
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { source, destination } = result;
    if (source.index === destination.index) return;
    setColumnOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      savePrefs({ order: next });
      return next;
    });
  };

  /*** HELPERS ***/
  const fmtNum = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n)
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n)
      : String(v ?? 'N/A');
  };

  // Reusable class for sticky header cells
  const stickyHead = 'sticky top-0 bg-background z-20';

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] w-full px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/billing-recon/${projectSlug}/boq`}>
            <Button variant="ghost" size="icon">
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
          {Object.keys(filterOptions).map(key => {
            const options = filterOptions[key as keyof typeof filterOptions];
            if (options.length === 0) return null;
            return (
              <Select key={key} value={filters[key as keyof typeof filters]} onValueChange={(v) => handleFilterChange(key as keyof typeof filters, v)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={`Filter by ${key}`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All {key}s</SelectItem>
                  {options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                </SelectContent>
              </Select>
            )
          })}
          {selectedItemIds.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
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
        {/* Outer container ensures the scrollbar track spans full width */}
        <div className="h-full border rounded-lg flex flex-col min-w-0">
          {/* Header + Body share the same horizontal scroll via this wrapper */}
          <div className="relative flex-1 min-h-0 w-full overflow-auto">
            {/* Keep table at least as wide as its content */}
            <div className="min-w-max">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    {/* Make every header cell sticky */}
                    <TableHead className={`${stickyHead} w-[50px]`}>
                      <Checkbox
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={handleSelectAll}
                        aria-label="Select all rows"
                      />
                    </TableHead>
                    <TableHead className={`${stickyHead} w-12`}></TableHead>

                    {columnOrder
                      .filter((h) => columnVisibility[h])
                      .map((header) => (
                        <TableHead
                          key={header}
                          className={`${stickyHead} whitespace-nowrap px-4 cursor-pointer select-none`}
                          onClick={() => handleSort(header)}
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
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-5 w-5" />
                        </TableCell>
                        <TableCell className="px-2">
                          <Skeleton className="h-5 w-5" />
                        </TableCell>
                        {columnOrder
                          .filter((h) => columnVisibility[h])
                          .map((header, j) => (
                            <TableCell key={`${i}-${j}`}>
                              <Skeleton className="h-5 w-full" />
                            </TableCell>
                          ))}
                      </TableRow>
                    ))
                  ) : sortedBoqItems.length > 0 ? (
                    sortedBoqItems.map((item) => {
                      const isExpanded = expandedRows.has(item.id);
                      const hasBom = item.bom && item.bom.length > 0;
                      return (
                        <Fragment key={item.id}>
                          <TableRow
                            data-state={selectedItemIds.includes(item.id) && 'selected'}
                            onClick={() => handleRowClick(item)}
                            className="cursor-pointer"
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedItemIds.includes(item.id)}
                                onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                aria-label={`Select row ${item.id}`}
                              />
                            </TableCell>
                            <TableCell className="px-2">
                              {hasBom && (
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
                              )}
                            </TableCell>
                            {columnOrder
                              .filter((h) => columnVisibility[h])
                              .map((header) => {
                                const raw = item[header];
                                const value = (() => {
                                  if (header === 'Total Amount') {
                                    const qty = Number(item['QTY']);
                                    const rate = Number(item['Unit Rate']);
                                    const explicit = Number(raw);
                                    if (Number.isFinite(explicit)) return fmtNum(explicit);
                                    if (Number.isFinite(qty) && Number.isFinite(rate)) return fmtNum(qty * rate);
                                    return 'N/A';
                                  }
                                  if (header === 'QTY' || header === 'Unit Rate') return fmtNum(raw);
                                  return raw ?? 'N/A';
                                })();

                                return (
                                  <TableCell
                                    key={`${item.id}-${header}`}
                                    className={cn(
                                      (header === 'Description' || header === 'Category 1') && 'max-w-xs truncate'
                                    )}
                                    title={typeof value === 'string' ? value : undefined}
                                  >
                                    {value}
                                  </TableCell>
                                );
                              })}
                          </TableRow>

                          {isExpanded && hasBom && (
                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                              <TableCell
                                colSpan={columnOrder.filter((h) => columnVisibility[h]).length + 2}
                                className="p-0"
                              >
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
                      <TableCell
                        colSpan={columnOrder.filter((h) => columnVisibility[h]).length + 2}
                        className="text-center h-24"
                      >
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
        onOpenChange={(open: boolean) => setIsDetailsDialogOpen(open)}
        item={selectedBoqItem}
        jmcEntries={[]}
        bills={[]}
      />

      {/* Column Editor */}
      <Dialog open={isColumnEditorOpen} onOpenChange={setIsColumnEditorOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Customize Columns</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-auto space-y-2 mt-2">
            {isClient && (
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="columns">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                      {columnOrder.map((header, index) => (
                        <Draggable key={header} draggableId={header} index={index}>
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className="flex items-center gap-2 p-2 border rounded-md bg-muted/50"
                            >
                              <Checkbox
                                checked={!!columnVisibility[header]}
                                onCheckedChange={(checked) => {
                                  const next = { ...columnVisibility, [header]: !!checked };
                                  setColumnVisibility(next);
                                  savePrefs({ visibility: next });
                                }}
                              />
                              <Input
                                value={columnNames[header] || header}
                                onChange={(e) => {
                                  const next = { ...columnNames, [header]: e.target.value };
                                  setColumnNames(next);
                                  savePrefs({ names: next });
                                }}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setIsColumnEditorOpen(false)}>
              Close
            </Button>
            <Button onClick={() => setIsColumnEditorOpen(false)}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
