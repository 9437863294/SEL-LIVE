

'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trash2, Loader2, View, MoreHorizontal, Search, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch, doc, deleteDoc, query, where } from 'firebase/firestore';
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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import type { BoqItem as BoqItemType, JmcEntry, Bill } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';
import BoqItemDetailsDialog from '@/components/BoqItemDetailsDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DragDropContext, Droppable, Draggable, OnDragEndResponder } from 'react-beautiful-dnd';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type BoqItem = {
    id: string;
    'JMC Executed Qty'?: number;
    'Billed Qty'?: number;
    'Balance Qty'?: number;
    [key: string]: any;
};

const baseTableHeaders = [
    'Project Name', 'Sub-Division', 'Site', 'Scope 1', 'Scope 2', 'Category 1', 
    'Category 2', 'Category 3', 'BOQ SL No', 'Description', 'Unit', 'QTY', 
    'Unit Rate', 'Total Amount'
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

  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>(baseTableHeaders);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    baseTableHeaders.reduce((acc, h) => ({ ...acc, [h]: true }), {})
  );
  const [columnNames, setColumnNames] = useState<Record<string, string>>(
    baseTableHeaders.reduce((acc, h) => ({ ...acc, [h]: h }), {})
  );

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedOrder = localStorage.getItem(`billingReconBoqColumnOrder_${projectSlug}`);
        const savedVisibility = localStorage.getItem(`billingReconBoqColumnVisibility_${projectSlug}`);
        const savedNames = localStorage.getItem(`billingReconBoqColumnNames_${projectSlug}`);

        if (savedOrder) setColumnOrder(JSON.parse(savedOrder));
        if (savedVisibility) setColumnVisibility(JSON.parse(savedVisibility));
        if (savedNames) setColumnNames(JSON.parse(savedNames));

      } catch (error) {
        console.error("Failed to parse column preferences from localStorage", error);
      }
    }
  }, [projectSlug]);

  const saveColumnPrefs = () => {
    try {
      localStorage.setItem(`billingReconBoqColumnOrder_${projectSlug}`, JSON.stringify(columnOrder));
      localStorage.setItem(`billingReconBoqColumnVisibility_${projectSlug}`, JSON.stringify(columnVisibility));
      localStorage.setItem(`billingReconBoqColumnNames_${projectSlug}`, JSON.stringify(columnNames));
      toast({ title: 'Success', description: 'Column preferences saved.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Could not save column preferences.', variant: 'destructive'});
    }
  };
  
  const onDragEnd: OnDragEndResponder = (result) => {
    if (!result.destination) return;
    const items = Array.from(columnOrder);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColumnOrder(items);
  };

  const fetchBoqItems = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const boqItemsRef = collection(db, 'projects', projectSlug, 'boqItems');
      const jmcEntriesRef = collection(db, 'projects', projectSlug, 'jmcEntries');
      const billsRef = collection(db, 'projects', projectSlug, 'bills');

      const [boqSnapshot, jmcSnapshot, billsSnapshot] = await Promise.all([
        getDocs(boqItemsRef),
        getDocs(jmcEntriesRef),
        getDocs(billsRef),
      ]);

      const fetchedJmcEntries = jmcSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JmcEntry));
      setJmcEntries(fetchedJmcEntries);
      const fetchedBills = billsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill));
      setBills(fetchedBills);

      const jmcQuantities: Record<string, number> = {};
      fetchedJmcEntries.forEach(entry => {
        entry.items.forEach(item => {
            if (item.boqSlNo) {
                jmcQuantities[item.boqSlNo] = (jmcQuantities[item.boqSlNo] || 0) + parseFloat(item.executedQty || '0');
            }
        });
      });

      const billedQuantities: Record<string, number> = {};
      fetchedBills.forEach(bill => {
        bill.items.forEach(item => {
            if (item.boqSlNo) {
                billedQuantities[item.boqSlNo] = (billedQuantities[item.boqSlNo] || 0) + parseFloat(item.billedQty);
            }
        });
      });

      const items = boqSnapshot.docs.map(doc => {
        const data = doc.data();
        const slNo = data['SL. No.'];
        const boqQty = parseFloat(data['Total Qty'] || '0');
        const jmcQty = jmcQuantities[slNo] || 0;
        const billedQty = billedQuantities[slNo] || 0;

        return { 
            id: doc.id, 
            ...data,
            'JMC Executed Qty': jmcQty,
            'Billed Qty': billedQty,
            'Balance Qty': boqQty - jmcQty,
        } as BoqItem;
      });
      
      const sortedItems = items.sort((a, b) => {
        const slNoA = Number(a['SL. No.']);
        const slNoB = Number(b['SL. No.']);
        if (isNaN(slNoA) || isNaN(slNoB)) {
          return 0; 
        }
        return slNoA - slNoB;
      });

      setBoqItems(sortedItems);
      
    } catch (error) {
      console.error("Error fetching BOQ items: ", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch BOQ items.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchBoqItems();
  }, [projectSlug]);

  const handleRowClick = (item: BoqItem) => {
    setSelectedBoqItem(item);
    setIsDetailsDialogOpen(true);
  };
  
  const handleClearBoq = async () => {
    if (!user) return;
    setIsDeleting(true);
    try {
        const boqItemsRef = collection(db, 'projects', projectSlug, 'boqItems');
        const querySnapshot = await getDocs(boqItemsRef);
        if (querySnapshot.empty) {
            toast({ title: 'No data to clear', description: 'The BOQ is already empty.' });
            setIsDeleting(false);
            return;
        }

        const batch = writeBatch(db);
        querySnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();

        await logUserActivity({
            userId: user.id,
            action: 'Clear BOQ',
            details: { project: projectSlug, clearedItemCount: querySnapshot.size }
        });

        toast({
            title: 'BOQ Cleared',
            description: 'All items have been successfully deleted.',
        });
        fetchBoqItems(); // Refresh the table
    } catch (error) {
        console.error("Error clearing BOQ: ", error);
        toast({
            title: 'Error',
            description: 'Failed to clear BOQ.',
            variant: 'destructive',
        });
    } finally {
        setIsDeleting(false);
    }
  }

  const handleDeleteSelected = async () => {
    if (!user) return;
    setIsDeleting(true);
    const batch = writeBatch(db);
    const boqItemsRef = collection(db, 'projects', projectSlug, 'boqItems');
    selectedItemIds.forEach(id => {
        batch.delete(doc(boqItemsRef, id));
    });

    try {
        await batch.commit();

        await logUserActivity({
            userId: user.id,
            action: 'Delete BOQ Items',
            details: { project: projectSlug, deletedItemCount: selectedItemIds.length }
        });

        toast({
            title: 'Success',
            description: `${selectedItemIds.length} item(s) deleted successfully.`,
        });
        setSelectedItemIds([]);
        fetchBoqItems();
    } catch (error) {
        console.error("Error deleting selected items:", error);
        toast({ title: 'Error', description: 'Failed to delete selected items.', variant: 'destructive' });
    }
    setIsDeleting(false);
  };

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
      setSelectedItemIds(checked ? boqItems.map(item => item.id) : []);
  };
  
  const handleSelectRow = (id: string, checked: boolean) => {
      setSelectedItemIds(prev => checked ? [...prev, id] : prev.filter(itemId => itemId !== id));
  };


  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
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
                                  This will permanently delete {selectedItemIds.length} item(s). This action cannot be undone.
                              </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteSelected}>Continue</AlertDialogAction>
                          </AlertDialogFooter>
                      </AlertDialogContent>
                  </AlertDialog>
              )}
                <Button variant="outline" onClick={() => setIsColumnEditorOpen(true)}>
                    <Settings className="mr-2 h-4 w-4" /> Columns
                </Button>

              <AlertDialog>
                  <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={isLoading || boqItems.length === 0 || isDeleting}>
                          {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Clear BOQ
                      </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                      <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete all {boqItems.length} items from the BOQ.
                      </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleClearBoq} disabled={isDeleting}>
                        {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Continue
                      </AlertDialogAction>
                      </AlertDialogFooter>
                  </AlertDialogContent>
              </AlertDialog>
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
              <div className="overflow-x-auto rounded-lg border">
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead className="w-[50px]">
                                  <Checkbox 
                                      checked={selectedItemIds.length === boqItems.length && boqItems.length > 0}
                                      onCheckedChange={handleSelectAll}
                                  />
                              </TableHead>
                              {columnOrder.filter(h => columnVisibility[h]).map((header) => (
                                  <TableHead key={header} className="whitespace-nowrap px-4">{columnNames[header] || header}</TableHead>
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
                          ) : boqItems.length > 0 ? (
                              boqItems.map((item) => (
                                  <TableRow 
                                    key={item.id} 
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
                                      {columnOrder.filter(h => columnVisibility[h]).map(header => (
                                          <TableCell key={`${item.id}-${header}`}>
                                              {item[header] || 'N/A'}
                                          </TableCell>
                                      ))}
                                  </TableRow>
                              ))
                          ) : (
                              <TableRow>
                                  <TableCell colSpan={columnOrder.filter(h => columnVisibility[h]).length + 1} className="text-center h-24">
                                      No BOQ items found.
                                  </TableCell>
                              </TableRow>
                          )}
                      </TableBody>
                  </Table>
              </div>
          </CardContent>
        </Card>
      </div>

       <Dialog open={isColumnEditorOpen} onOpenChange={setIsColumnEditorOpen}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Customize Columns</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">Drag to reorder, check to show/hide, and rename columns.</p>
                <ScrollArea className="h-96 pr-4">
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
                </ScrollArea>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setIsColumnEditorOpen(false)}>Cancel</Button>
                    <Button onClick={() => { saveColumnPrefs(); setIsColumnEditorOpen(false); }}>Save Preferences</Button>
                </div>
            </DialogContent>
        </Dialog>
        
      <BoqItemDetailsDialog
        isOpen={isDetailsDialogOpen}
        onOpenChange={setIsDetailsDialogOpen}
        item={selectedBoqItem}
        jmcEntries={jmcEntries}
        bills={bills}
      />
    </>
  );
}


