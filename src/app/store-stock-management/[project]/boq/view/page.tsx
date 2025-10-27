
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
import { collection, getDocs, writeBatch, doc, query, where, updateDoc } from 'firebase/firestore';
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
import type { FabricationBomItem, Project } from '@/lib/types';
import BoqItemDetailsDialog from '@/components/BoqItemDetailsDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
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
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

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
  
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BoqItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const fetchProjectAndBoq = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);
        const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
        const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

        if (!projectData) {
            toast({ title: 'Error', description: 'Project not found.', variant: 'destructive' });
            setIsLoading(false);
            return;
        }
        setCurrentProject(projectData);

        const boqItemsRef = collection(db, 'projects', projectData.id, 'boqItems');
        const boqSnapshot = await getDocs(query(boqItemsRef));
        const items = boqSnapshot.docs.map((d) => {
            const data = d.data() as any;
            const erpKey = normalizeKey(data, 'ERP SL NO');
            const boqKey = normalizeKey(data, 'BOQ SL No');
            return {
                id: d.id,
                ...data,
                'ERP SL NO': erpKey ? data[erpKey] : '',
                'BOQ SL No': boqKey ? data[boqKey] : '',
            } as BoqItem;
        });
        setBoqItems(items);
    } catch (error) {
        console.error("Error fetching BOQ items:", error);
        toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    fetchProjectAndBoq();
  }, [fetchProjectAndBoq]);


  /*** NORMALIZE KEYS FROM FIRESTORE ***/
  const normalizeKey = (obj: any, targetKey: string): string | undefined => {
    const foundKey = Object.keys(obj).find(
      (k) => k.toLowerCase().replace(/\s+/g, '') === targetKey.toLowerCase().replace(/\s+/g, '')
    );
    return foundKey;
  };

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
    if (!editingItem || !currentProject) return;
    setIsSaving(true);
    try {
      const itemRef = doc(db, 'boqItems', editingItem.id);
      const { id, ...dataToSave } = editingItem;
      await updateDoc(itemRef, dataToSave);
      toast({ title: 'Success', description: 'BOQ item updated.' });
      setIsEditDialogOpen(false);
      fetchProjectAndBoq();
    } catch (e) {
      console.error("Failed to save changes:", e);
      toast({ title: 'Error', description: 'Could not save changes.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const allSelected = selectedItemIds.length === boqItems.length && boqItems.length > 0;
  const someSelected = selectedItemIds.length > 0 && selectedItemIds.length < boqItems.length;

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked) setSelectedItemIds(boqItems.map((i) => i.id));
    else setSelectedItemIds([]);
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedItemIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

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
      {/* ... Header remains the same ... */}
      <div className="flex-1 min-h-0">
        <div className="h-full border rounded-lg flex flex-col min-w-0">
          <div className="relative flex-1 min-h-0 w-full overflow-auto">
             {/* ... Table structure remains same, just data source changes ... */}
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
                                  if (header === 'QTY' || header === 'Unit Rate' || header === 'Total Qty') return fmtNum(raw);
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
    </div>
  );
}
