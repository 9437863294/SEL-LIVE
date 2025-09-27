
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
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import type { JmcEntry, Bill } from '@/lib/types';
import BoqItemDetailsDialog from '@/components/BoqItemDetailsDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { DragDropContext, Droppable, Draggable, OnDragEndResponder, DraggableProvided } from 'react-beautiful-dnd';
import { Label } from '@/components/ui/label';

type BoqItem = {
    id: string;
    'JMC Executed Qty'?: number;
    'Billed Qty'?: number;
    'Balance Qty'?: number;
    [key: string]: any;
};

const baseTableHeaders = [
    'Project',
    'Site',
    'Scope',
    'Sl No',
    'Description',
    'UNIT',
    'BOQ QTY',
    'UNIT PRICE',
    'TOTAL PRICE FOR THE TENDER QUANTITY',
    'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'
];

// Custom Droppable component to fix strict mode issue with react-beautiful-dnd
const StrictModeDroppable = ({ children, ...props }: any) => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const animation = requestAnimationFrame(() => setEnabled(true));
    return () => {
      cancelAnimationFrame(animation);
      setEnabled(false);
    };
  }, []);

  if (!enabled) {
    return null;
  }

  return <Droppable {...props}>{children}</Droppable>;
};

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
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);

  // Column Customization State
  const [columnOrder, setColumnOrder] = useState<string[]>(baseTableHeaders);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    baseTableHeaders.reduce((acc, h, i) => ({ ...acc, [h]: i < 7 || h === 'UNIT PRICE' }), {})
  );
  const [columnNames, setColumnNames] = useState<Record<string, string>>(
    baseTableHeaders.reduce((acc, h) => {
        if(h === 'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)') {
            acc[h] = 'Description';
        } else {
            acc[h] = h;
        }
        return acc;
    }, {} as Record<string, string>)
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
        const savedOrder = localStorage.getItem(`boqColumnOrder_${projectSlug}`);
        const savedVisibility = localStorage.getItem(`boqColumnVisibility_${projectSlug}`);
        const savedNames = localStorage.getItem(`boqColumnNames_${projectSlug}`);

        if (savedOrder) setColumnOrder(JSON.parse(savedOrder));
        if (savedVisibility) setColumnVisibility(JSON.parse(savedVisibility));
        if (savedNames) setColumnNames(JSON.parse(savedNames));
    }
  }, [projectSlug]);
  
  const saveColumnPrefs = () => {
    localStorage.setItem(`boqColumnOrder_${projectSlug}`, JSON.stringify(columnOrder));
    localStorage.setItem(`boqColumnVisibility_${projectSlug}`, JSON.stringify(columnVisibility));
    localStorage.setItem(`boqColumnNames_${projectSlug}`, JSON.stringify(columnNames));
    toast({ title: 'Success', description: 'Column preferences saved.' });
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
      const boqItemsRef = collection(db, 'boqItems');
      const q = query(boqItemsRef, where('projectSlug', '==', projectSlug));
      const boqSnapshot = await getDocs(q);

      const items = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
      
      const sortedItems = items.sort((a, b) => {
        const slNoA = Number(a['Sl No']);
        const slNoB = Number(b['Sl No']);
        if (isNaN(slNoA) || isNaN(slNoB)) {
          return 0; 
        }
        return slNoA - slNoB;
      });

      setBoqItems(sortedItems);
      
    } catch (error: any) {
      console.error("Error fetching BOQ items: ", error);
      if (error.code === 'failed-precondition') {
          toast({
              title: 'Database Index Required',
              description: 'An index is required for this query. Please create a composite index on the `boqItems` collection for the `projectSlug` field.',
              variant: 'destructive',
              duration: 10000,
          });
      } else {
        toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchBoqItems();
  }, [projectSlug, toast]);

  const handleRowClick = (item: BoqItem) => {
    setSelectedBoqItem(item);
    setIsDetailsDialogOpen(true);
  };
  
  const handleClearBoq = async () => {
    if (!user) return;
    setIsDeleting(true);
    try {
        const boqItemsRef = collection(db, 'boqItems');
        const q = query(boqItemsRef, where('projectSlug', '==', projectSlug));
        const querySnapshot = await getDocs(q);
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
            action: 'Clear BOQ (Stock)',
            details: { project: projectSlug, clearedItemCount: querySnapshot.size }
        });

        toast({
            title: 'BOQ Cleared',
            description: 'All items have been successfully deleted.',
        });
        fetchBoqItems();
    } catch (error) {
        console.error("Error clearing BOQ: ", error);
        toast({ title: 'Error', description: 'Failed to clear BOQ.', variant: 'destructive' });
    } finally {
        setIsDeleting(false);
    }
  }

  const handleDeleteSelected = async () => {
    if (!user) return;
    setIsDeleting(true);
    const batch = writeBatch(db);
    const boqItemsRef = collection(db, 'boqItems');
    selectedItemIds.forEach(id => {
        batch.delete(doc(boqItemsRef, id));
    });

    try {
        await batch.commit();

        await logUserActivity({
            userId: user.id,
            action: 'Delete BOQ Items (Stock)',
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
  
  const getItemDescription = (item: BoqItem) => {
    const descriptionKeys = [
      'Description',
      'DESCRIPTION OF ITEMS',
      'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'
    ];
    for (const key of descriptionKeys) {
      if (item[key]) {
        return item[key];
      }
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? item[fallbackKey] : '';
  };

  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    const specificKey = 'UNIT PRICE';
    if(keys.includes(specificKey)) return specificKey;
    
    return keys.find(key => key.toLowerCase().includes('price') && !key.toLowerCase().includes('total'));
  };
  
  const filteredItems = useMemo(() => {
    return boqItems.filter(item => {
        const description = getItemDescription(item);
        const slNo = String(item['Sl No'] || '');
        
        return (
            slNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            String(description).toLowerCase().includes(searchTerm.toLowerCase())
        );
    });
  }, [boqItems, searchTerm]);
  
  const formatNumber = (value: any) => {
    if (typeof value === 'number') {
      return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    }
    return value;
  };
  
  const isNumeric = (value: any) => {
    return typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)) && isFinite(value as any));
  }
  
  const handleSelectAll = (checked: boolean) => {
      setSelectedItemIds(checked ? boqItems.map(item => item.id) : []);
  };
  
  const handleSelectRow = (id: string, checked: boolean) => {
      setSelectedItemIds(prev => checked ? [...prev, id] : prev.filter(itemId => itemId !== id));
  };

  const visibleHeaders = columnOrder.filter(header => columnVisibility[header]);

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
              <Link href={`/store-stock-management/${projectSlug}/boq`}>
                  <Button variant="ghost" size="icon">
                      <ArrowLeft className="h-6 w-6" />
                  </Button>
              </Link>
              <h1 className="text-xl font-bold">View BOQ</h1>
          </div>
          <div className="flex items-center gap-2">
               <Input
                  placeholder="Search BOQ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-sm"
              />
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
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-15rem)]">
                  <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow>
                              <TableHead className="w-[50px]">
                                  <Checkbox 
                                      checked={selectedItemIds.length > 0 && selectedItemIds.length === filteredItems.length}
                                      onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                  />
                              </TableHead>
                              {visibleHeaders.map((header) => (
                                  <TableHead key={header} className="whitespace-nowrap px-4">{columnNames[header] || header}</TableHead>
                              ))}
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {isLoading ? (
                              Array.from({ length: 5 }).map((_, i) => (
                              <TableRow key={i}>
                                  <TableCell><Skeleton className="h-5 w-5" /></TableCell>
                                  {visibleHeaders.map((header, j) => (
                                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                                  ))}
                              </TableRow>
                              ))
                          ) : filteredItems.length > 0 ? (
                              filteredItems.map((item) => (
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
                                      {visibleHeaders.map(header => {
                                          let cellData;
                                          if (header === 'Description') {
                                                cellData = getItemDescription(item);
                                          } else if (header === 'UNIT PRICE') {
                                            const priceKey = findBasicPriceKey(item);
                                            cellData = priceKey ? item[priceKey] : 'N/A';
                                          }
                                          else {
                                              cellData = item[header];
                                          }
                                          const formattedData = formatNumber(cellData);
                                          const numeric = isNumeric(cellData);
                                          return (
                                              <TableCell key={`${item.id}-${header}`} className={cn(numeric && 'text-right')}>
                                                  {formattedData}
                                              </TableCell>
                                          )
                                      })}
                                  </TableRow>
                              ))
                          ) : (
                              <TableRow>
                                  <TableCell colSpan={visibleHeaders.length + 1} className="text-center h-24">
                                      No BOQ items found for this project.
                                  </TableCell>
                              </TableRow>
                          )}
                      </TableBody>
                  </Table>
              </ScrollArea>
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
                    <DragDropContext onDragEnd={onDragEnd}>
                        <StrictModeDroppable droppableId="columns">
                            {(provided: any) => (
                                <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                                    {columnOrder.map((header, index) => (
                                        <Draggable key={header} draggableId={header} index={index}>
                                            {(provided: any) => (
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
                        </StrictModeDroppable>
                    </DragDropContext>
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
