

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
  Edit,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch, doc, query, where, updateDoc, setDoc, getDoc } from 'firebase/firestore';
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
import type { FabricationBomItem, Project, JmcEntry, UserSettings } from '@/lib/types';
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
  'JMC Executed Qty',
  'Unit Rate',
  'Total Amount',
] as const;

export default function ViewBoqPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { project: projectSlug } = useParams() as { project: string };

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
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
        [h]: ['BOQ SL No', 'ERP SL NO', 'Description', 'Unit', 'QTY', 'JMC Executed Qty', 'Category 1'].includes(h as string),
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
  
  const isInitialMount = React.useRef(true);


  /*** CLIENT FLAG ***/
  useEffect(() => {
    setIsClient(true);
  }, []);

  const settingsKey = useMemo(() => {
    if (!projectSlug) return '';
    return `boqTable:${projectSlug}`;
  }, [projectSlug]);


  /*** LOAD/SAVE PREFERENCES ***/
    useEffect(() => {
    if (!user || !settingsKey) return;

    const fetchSettings = async () => {
      const settingsRef = doc(db, 'userSettings', user.id);
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
    };
    
    fetchSettings();
  }, [user, settingsKey]);
  
  const saveColumnSettings = useCallback(async () => {
    if (!user || !settingsKey) return;
    try {
        const settingsRef = doc(db, 'userSettings', user.id);
        const currentSettingsSnap = await getDoc(settingsRef);
        const currentSettings = currentSettingsSnap.exists() ? currentSettingsSnap.data() : { columnPreferences: {} };

        const newPreferences = {
            ...currentSettings.columnPreferences,
            [settingsKey]: {
                order: columnOrder,
                visibility: columnVisibility,
                names: columnNames,
                sort: { key: sortKey, direction: sortDirection },
            }
        };

        await setDoc(settingsRef, { ...currentSettings, columnPreferences: newPreferences }, { merge: true });
    } catch (e) {
        console.warn('Failed to save column settings to Firestore', e);
        toast({ title: "Error", description: "Could not save your column preferences.", variant: "destructive" });
    }
  }, [user, settingsKey, columnOrder, columnVisibility, columnNames, sortKey, sortDirection, toast]);
  
  useEffect(() => {
      if (isInitialMount.current) {
          isInitialMount.current = false;
          return;
      }
      if (user) {
          saveColumnSettings();
      }
  }, [columnOrder, columnVisibility, columnNames, sortKey, sortDirection, user, saveColumnSettings]);

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

      const jmcCollectionRef = collection(db, 'projects', projectSlug, 'jmcEntries');
      const jmcSnapshot = await getDocs(jmcCollectionRef);
      const jmcData = jmcSnapshot.docs.map(d => d.data() as JmcEntry);
      setJmcEntries(jmcData);

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

  const jmcQuantities = useMemo(() => {
    const quantities: Record<string, number> = {};
    jmcEntries.forEach(entry => {
      entry.items.forEach(item => {
        if (item.boqSlNo) {
          if (!quantities[item.boqSlNo]) {
            quantities[item.boqSlNo] = 0;
          }
          quantities[item.boqSlNo] += Number(item.executedQty || 0);
        }
      });
    });
    return quantities;
  }, [jmcEntries]);


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
    let filteredForOptions = boqItems;

    const scope1Options = [...new Set(filteredForOptions.map(item => item['Scope 1']).filter(Boolean))];
    
    if (filters['Scope 1'] !== 'all') {
      filteredForOptions = filteredForOptions.filter(item => item['Scope 1'] === filters['Scope 1']);
    }

    const scope2Options = [...new Set(filteredForOptions.map(item => item['Scope 2']).filter(Boolean))];

    if (filters['Scope 2'] !== 'all') {
      filteredForOptions = filteredForOptions.filter(item => item['Scope 2'] === filters['Scope 2']);
    }
    
    const category1Options = [...new Set(filteredForOptions.map(item => item['Category 1']).filter(Boolean))];

    return { 
      'Scope 1': scope1Options, 
      'Scope 2': scope2Options, 
      'Category 1': category1Options 
    };
  }, [boqItems, filters]);

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
     setFilters(prev => {
      const newFilters = { ...prev, [key]: value };
      if (key === 'Scope 1') {
        newFilters['Scope 2'] = 'all';
        newFilters['Category 1'] = 'all';
      }
      if (key === 'Scope 2') {
        newFilters['Category 1'] = 'all';
      }
      return newFilters;
    });
  };
  
  const clearFilters = () => {
    setFilters({
      search: '',
      'Scope 1': 'all',
      'Scope 2': 'all',
      'Category 1': 'all',
    });
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
  
  const handleOpenEditDialog = (e: React.MouseEvent, item: BoqItem) => {
    e.stopPropagation();
    setEditingItem({ ...item }); // Clone item to avoid direct state mutation
    setIsEditDialogOpen(true);
  };
  
  const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingItem) return;
    const { name, value } = e.target;
    setEditingItem(prev => (prev ? { ...prev, [name]: value } : null));
  };
  
  const handleSaveChanges = async () => {
    if (!editingItem) return;
    setIsSaving(true);
    try {
      const itemRef = doc(db, 'projects', projectSlug, 'boqItems', editingItem.id);
      const { id, ...dataToSave } = editingItem;
      await updateDoc(itemRef, dataToSave);
      toast({ title: 'Success', description: 'BOQ item updated.' });
      setIsEditDialogOpen(false);
      fetchBoqItems();
    } catch (e) {
      console.error("Failed to save changes:", e);
      toast({ title: 'Error', description: 'Could not save changes.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };


  /*** SORT HEADER CLICK ***/
  const handleSort = (key: string) => {
    if (sortKey === key) {
      const next = sortDirection === 'asc' ? 'desc' : 'asc';
      setSortDirection(next);
    } else {
      setSortKey(key);
      setSortDirection('asc');
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

  const visibleHeaders = columnOrder.filter((h) => columnVisibility[h]);

  const dialogFields: (keyof BoqItem)[] = [
    'Project Name', 'Sub-Division', 'Site', 'Scope 1', 'Scope 2',
    'Category 1', 'Category 2', 'Category 3', 'ERP SL NO', 'BOQ SL No',
    'Description', 'Unit', 'QTY', 'Unit Rate', 'Total Amount'
  ];

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
           <Button variant="secondary" onClick={clearFilters}>Clear Filters</Button>
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
                    <TableHead className="sticky top-0 bg-background z-20 w-[50px]">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={handleSelectAll}
                        aria-label="Select all rows"
                      />
                    </TableHead>
                    <TableHead className="sticky top-0 bg-background z-20 w-12"></TableHead>

                    {visibleHeaders
                      .map((header) => (
                        <TableHead
                          key={header}
                          className="sticky top-0 bg-background z-20 whitespace-nowrap px-4 cursor-pointer select-none"
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
                      <TableHead className="sticky top-0 bg-background z-20">Actions</TableHead>
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
                        {visibleHeaders
                          .map((header, j) => (
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
                            {visibleHeaders.map((header) => {
                                let raw = item[header];
                                if (header === 'JMC Executed Qty') {
                                  raw = jmcQuantities[item['BOQ SL No'] as string] || 0;
                                }

                                const value = (() => {
                                  if (header === 'Total Amount') {
                                    const qty = Number(item['QTY']);
                                    const rate = Number(item['Unit Rate']);
                                    const explicit = Number(raw);
                                    if (Number.isFinite(explicit)) return fmtNum(explicit);
                                    if (Number.isFinite(qty) && Number.isFinite(rate)) return fmtNum(qty * rate);
                                    return 'N/A';
                                  }
                                  if (header === 'QTY' || header === 'Unit Rate' || header === 'Total Qty' || header === 'JMC Executed Qty') return fmtNum(raw);
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
                              <TableCell className="text-right">
                                <Button variant="outline" size="sm" onClick={(e) => handleOpenEditDialog(e, item)}>
                                  <Edit className="mr-2 h-4 w-4" /> Edit
                                </Button>
                              </TableCell>
                          </TableRow>

                          {isExpanded && hasBom && (
                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                              <TableCell
                                colSpan={visibleHeaders.length + 3}
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
                        colSpan={visibleHeaders.length + 3}
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
      
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit BOQ Item</DialogTitle>
          </DialogHeader>
          <div className="py-4 grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
              {editingItem && dialogFields.map(key => (
                  <div className="space-y-1" key={key}>
                      <Label htmlFor={`edit-${String(key)}`}>{String(key)}</Label>
                      <Input
                          id={`edit-${String(key)}`}
                          name={String(key)}
                          value={editingItem[key] || ''}
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
                                }}
                              />
                              <Input
                                value={columnNames[header] || header}
                                onChange={(e) => {
                                  const next = { ...columnNames, [header]: e.target.value };
                                  setColumnNames(next);
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
