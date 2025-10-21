
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Trash2, Loader2, Settings, ArrowUpDown, ChevronDown, ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch, doc, deleteDoc, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import type { BoqItem as BoqItemType, JmcEntry, Bill } from '@/lib/types';
import BoqItemDetailsDialog from '@/components/BoqItemDetailsDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { DragDropContext, Droppable, Draggable, OnDragEndResponder } from 'react-beautiful-dnd';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';

type BoqItem = {
  id: string;
  'JMC Executed Qty'?: number;
  'Billed Qty'?: number;
  'Balance Qty'?: number;
  [key: string]: any;
};

const baseTableHeaders = [
  'Project Name', 'Sub-Division', 'Site', 'Scope 1', 'Scope 2',
  'Category 1', 'Category 2', 'Category 3', 'ERP SL NO', 'BOQ SL No',
  'Description', 'Unit', 'QTY', 'Unit Rate', 'Total Amount'
];

export default function ViewBoqPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { project: projectSlug } = useParams() as { project: string };

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectedBoqItem, setSelectedBoqItem] = useState<BoqItem | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [sortKey, setSortKey] = useState<string>('ERP SL NO');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>(baseTableHeaders);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    baseTableHeaders.reduce((acc, h) => ({
      ...acc,
      [h]: ['BOQ SL No', 'Description', 'Unit', 'QTY', 'ERP SL NO', 'Category 1'].includes(h)
    }), {})
  );
  const [columnNames, setColumnNames] = useState<Record<string, string>>(
    baseTableHeaders.reduce((acc, h) => ({ ...acc, [h]: h }), {})
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => { setIsClient(true); }, []);

  const fetchBoqItems = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const boqItemsRef = collection(db, 'projects', projectSlug, 'boqItems');
      const [boqSnapshot] = await Promise.all([getDocs(boqItemsRef)]);
      const items = boqSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as BoqItem[];
      setBoqItems(items);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  useEffect(() => { fetchBoqItems(); }, [projectSlug]);

  const sortedBoqItems = useMemo(() => {
    const sorted = [...boqItems];
    if (sortKey) {
      sorted.sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        if (!isNaN(Number(valA)) && !isNaN(Number(valB))) {
          return sortDirection === 'asc'
            ? Number(valA) - Number(valB)
            : Number(valB) - Number(valA);
        }
        if (String(valA) < String(valB)) return sortDirection === 'asc' ? -1 : 1;
        if (String(valA) > String(valB)) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sorted;
  }, [boqItems, sortKey, sortDirection]);

  const handleRowClick = (item: BoqItem) => {
    setSelectedBoqItem(item);
    setIsDetailsDialogOpen(true);
  };

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    else setSortKey(key);
  };

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    setSelectedItemIds(checked ? boqItems.map(i => i.id) : []);
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedItemIds(prev => checked ? [...prev, id] : prev.filter(x => x !== id));
  };
  
  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows(prev => {
        const newSet = new Set(prev);
        if (newSet.has(itemId)) {
            newSet.delete(itemId);
        } else {
            newSet.add(itemId);
        }
        return newSet;
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] w-full px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="py-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Link href={`/billing-recon/${projectSlug}/boq`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">View BOQ</h1>
        </div>

        <div className="flex items-center gap-2">
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
                  <AlertDialogAction>Continue</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button variant="outline" onClick={() => setIsColumnEditorOpen(true)}>
            <Settings className="mr-2 h-4 w-4" /> Columns
          </Button>
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 min-h-0">
        <Card className="h-full">
            <CardContent className="p-0 h-full">
                <ScrollArea className="h-full">
                <Table className="min-w-full text-sm">
                    <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                    <TableRow>
                        <TableHead className="w-[50px]">
                        <Checkbox
                            checked={selectedItemIds.length === boqItems.length && boqItems.length > 0}
                            onCheckedChange={handleSelectAll}
                        />
                        </TableHead>
                         <TableHead className="w-12"></TableHead>
                        {columnOrder.filter(h => columnVisibility[h]).map((header) => (
                        <TableHead
                            key={header}
                            className="whitespace-nowrap px-4 cursor-pointer"
                            onClick={() => handleSort(header)}
                        >
                            <div className="flex items-center">
                            {columnNames[header] || header}
                            {sortKey === header && <ArrowUpDown className="ml-2 h-4 w-4" />}
                            </div>
                        </TableHead>
                        ))}
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                            <TableCell><Skeleton className="h-5 w-5" /></TableCell>
                            {columnOrder.filter(h => columnVisibility[h]).map((header, j) => (
                            <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
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
                              data-state={selectedItemIds.includes(item.id) && "selected"}
                              onClick={() => handleRowClick(item)}
                              className="cursor-pointer"
                            >
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={selectedItemIds.includes(item.id)}
                                  onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                />
                              </TableCell>
                               <TableCell className="px-2">
                                  {hasBom && (
                                    <Button size="icon" variant="ghost" onClick={(e) => {e.stopPropagation(); toggleRowExpansion(item.id)}}>
                                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </Button>
                                  )}
                              </TableCell>
                              {columnOrder.filter(h => columnVisibility[h]).map(header => (
                                <TableCell key={`${item.id}-${header}`} className={cn(
                                    (header === 'Description' || header === 'Category 1') && 'max-w-xs truncate'
                                )}>
                                  {item[header] || 'N/A'}
                                </TableCell>
                              ))}
                            </TableRow>
                             {isExpanded && hasBom && (
                              <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableCell colSpan={columnOrder.filter(h => columnVisibility[h]).length + 2} className="p-0">
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
                                        {item.bom!.map((bomItem, index) => (
                                          <TableRow key={index}>
                                            <TableCell>{bomItem.markNo}</TableCell>
                                            <TableCell>{bomItem.section}</TableCell>
                                            <TableCell>{bomItem.qtyPerSet}</TableCell>
                                            <TableCell>{bomItem.totalWtKg?.toFixed(3)}</TableCell>
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
                        <TableCell colSpan={columnOrder.filter(h => columnVisibility[h]).length + 2}
                            className="text-center h-24">
                            No BOQ items found.
                        </TableCell>
                        </TableRow>
                    )}
                    </TableBody>
                </Table>
                </ScrollArea>
            </CardContent>
        </Card>
      </div>

      {/* Column Editor Dialog */}
      <Dialog open={isColumnEditorOpen} onOpenChange={setIsColumnEditorOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Customize Columns</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-auto space-y-2 mt-2">
            {isClient && (
              <DragDropContext onDragEnd={() => {}}>
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
                                checked={columnVisibility[header]}
                                onCheckedChange={(checked) =>
                                  setColumnVisibility(prev => ({ ...prev, [header]: !!checked }))
                                }
                              />
                              <Input
                                value={columnNames[header] || header}
                                onChange={(e) =>
                                  setColumnNames(prev => ({ ...prev, [header]: e.target.value }))
                                }
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
            <Button variant="outline" onClick={() => setIsColumnEditorOpen(false)}>Cancel</Button>
            <Button onClick={() => setIsColumnEditorOpen(false)}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      <BoqItemDetailsDialog
        isOpen={isDetailsDialogOpen}
        onOpenChange={setIsDetailsDialogOpen}
        item={selectedBoqItem}
        jmcEntries={jmcEntries}
        bills={bills}
      />
    </div>
  );
}

