
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trash2, Loader2, View, MoreHorizontal, Search } from 'lucide-react';
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DropdownMenuCheckboxItemProps } from "@radix-ui/react-dropdown-menu"
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import type { JmcEntry, Bill } from '@/lib/types';
import BoqItemDetailsDialog from '@/components/BoqItemDetailsDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';


type BoqItem = {
    id: string;
    'JMC Executed Qty'?: number;
    'Billed Qty'?: number;
    'Balance Qty'?: number;
    [key: string]: any;
};

const baseTableHeaders = [
    'Sl No',
    'Description',
    'UNIT',
    'BOQ QTY',
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
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  
  const [selectedBoqItem, setSelectedBoqItem] = useState<BoqItem | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => {
    // Initialize state from localStorage or default to all visible
    if (typeof window === 'undefined') {
        return baseTableHeaders.reduce((acc, header) => ({ ...acc, [header]: true }), {});
    }
    try {
      const saved = window.localStorage.getItem('boqColumnVisibility');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error("Failed to parse column visibility from localStorage", error);
    }
    // Default value if nothing is in localStorage or if it fails
    const defaults: Record<string, boolean> = {
        'Sl No': true,
        'Description': true,
        'UNIT': true,
        'BOQ QTY': true,
    };
    return baseTableHeaders.reduce((acc, header) => ({ ...acc, [header]: defaults[header] ?? false }), {});
  });
  
  // Save to localStorage whenever column visibility changes
  useEffect(() => {
    try {
      window.localStorage.setItem('boqColumnVisibility', JSON.stringify(columnVisibility));
    } catch (error) {
      console.error("Failed to save column visibility to localStorage", error);
    }
  }, [columnVisibility]);


  const fetchBoqItems = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const boqItemsRef = collection(db, 'boqItems');
      const jmcEntriesRef = collection(db, 'projects', projectSlug, 'jmcEntries');
      const billsRef = collection(db, 'projects', projectSlug, 'bills');

      const [boqSnapshot, jmcSnapshot, billsSnapshot] = await Promise.all([
        getDocs(query(boqItemsRef, where('projectSlug', '==', projectSlug))),
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
                billedQuantities[item.boqSlNo] = (billedQuantities[item.boqSlNo] || 0) + item.billedQty;
            }
        });
      });

      const items = boqSnapshot.docs.map(doc => {
        const data = doc.data();
        const slNo = data['Sl No'];
        const boqQty = parseFloat(data['BOQ QTY'] || '0');
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
  }, [projectSlug]);

  const handleRowClick = (item: BoqItem) => {
    setSelectedBoqItem(item);
    setIsDetailsDialogOpen(true);
  };
  
  const handleClearBoq = async () => {
    if (!user) return;
    setIsDeleting(true);
    try {
        const boqItemsRef = collection(db, 'boqItems');
        const querySnapshot = await getDocs(query(boqItemsRef, where('projectSlug', '==', projectSlug)));
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
  
  const handleDeleteSingle = async (id: string) => {
    if (!user) return;
    setIsDeleting(true);
    try {
        await deleteDoc(doc(db, 'boqItems', id));

        await logUserActivity({
            userId: user.id,
            action: 'Delete BOQ Item (Stock)',
            details: { project: projectSlug, itemId: id }
        });

        toast({
            title: 'Success',
            description: 'Item deleted successfully.',
        });
        fetchBoqItems();
    } catch (error) {
        console.error("Error deleting item:", error);
        toast({ title: 'Error', description: 'Failed to delete item.', variant: 'destructive' });
    }
    setIsDeleting(false);
  };

  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    return keys.find(key => key.toLowerCase().includes('price') && !key.toLowerCase().includes('total'));
  };

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
  
  const filteredItems = useMemo(() => {
    return boqItems.filter(item => 
        (String(item['Sl No'] || '').toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item['Description']?.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [boqItems, searchTerm]);

  const visibleHeaders = baseTableHeaders.filter(header => columnVisibility[header]);

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
                                      checked={selectedItemIds.length === filteredItems.length && filteredItems.length > 0}
                                      onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                  />
                              </TableHead>
                              {visibleHeaders.map((header) => (
                                  <TableHead key={header} className="whitespace-nowrap px-4">{header}</TableHead>
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
                                          let cellData = item[header];
                                          if (header === 'Description') {
                                              cellData = item['Description'] || item['DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'];
                                          }
                                          if(header === 'UNIT PRICE') {
                                            const priceKey = findBasicPriceKey(item);
                                            cellData = priceKey ? item[priceKey] : 'N/A';
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
