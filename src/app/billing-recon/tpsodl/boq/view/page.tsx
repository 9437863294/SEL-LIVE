
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trash2, Loader2, View, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch, doc, deleteDoc } from 'firebase/firestore';
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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { DropdownMenuCheckboxItemProps } from "@radix-ui/react-dropdown-menu"
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';


type BoqItem = {
    id: string;
    [key: string]: any;
};

const tableHeaders = [
    'ITEMS SPECS',
    'SL. No.',
    'Amended SL No',
    'Activity Description',
    'DESCRIPTION OF ITEMS',
    'UNITS',
    'Total Qty',
    'BASIC PRICE',
    'TOTAL AMOUNT',
    'GST @ 18% PER UNIT',
    'TOTAL PRICE PER UNIT ( In Rs)',
    'TOTAL PRICE FOR THE TENDER QUANTITY'
];


export default function ViewBoqPage() {
  const { toast } = useToast();
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => {
    // Initialize state from localStorage or default to all visible
    if (typeof window === 'undefined') {
        return tableHeaders.reduce((acc, header) => ({ ...acc, [header]: true }), {});
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
    return tableHeaders.reduce((acc, header) => ({ ...acc, [header]: true }), {});
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
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'boqItems'));
      const items = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
      
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
  }, []);
  
  const handleClearBoq = async () => {
    setIsDeleting(true);
    try {
        const querySnapshot = await getDocs(collection(db, 'boqItems'));
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
    setIsDeleting(true);
    const batch = writeBatch(db);
    selectedItemIds.forEach(id => {
        batch.delete(doc(db, 'boqItems', id));
    });

    try {
        await batch.commit();
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
    setIsDeleting(true);
    try {
        await deleteDoc(doc(db, 'boqItems', id));
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

  const visibleHeaders = tableHeaders.filter(header => columnVisibility[header]);
  
  const handleSelectAll = (checked: boolean | 'indeterminate') => {
      setSelectedItemIds(checked ? boqItems.map(item => item.id) : []);
  };
  
  const handleSelectRow = (id: string, checked: boolean) => {
      setSelectedItemIds(prev => checked ? [...prev, id] : prev.filter(itemId => itemId !== id));
  };


  return (
    <div className="w-full mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/billing-recon/tpsodl/boq">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">View BOQ</h1>
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
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                        <View className="mr-2 h-4 w-4" />
                        Columns
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {tableHeaders.map(header => (
                        <DropdownMenuCheckboxItem
                            key={header}
                            className="capitalize"
                            checked={columnVisibility[header]}
                            onCheckedChange={(value) =>
                                setColumnVisibility(prev => ({...prev, [header]: !!value}))
                            }
                        >
                            {header}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

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
            <ResizablePanelGroup direction="horizontal" className="min-w-full rounded-lg border">
                <ResizablePanel defaultSize={100}>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[50px]">
                                        <Checkbox 
                                            checked={selectedItemIds.length === boqItems.length && boqItems.length > 0}
                                            onCheckedChange={handleSelectAll}
                                        />
                                    </TableHead>
                                    {visibleHeaders.map((header) => (
                                        <TableHead key={header} className="whitespace-nowrap px-4">{header}</TableHead>
                                    ))}
                                    <TableHead className="text-right">Actions</TableHead>
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
                                         <TableCell><Skeleton className="h-5 w-10" /></TableCell>
                                    </TableRow>
                                    ))
                                ) : boqItems.length > 0 ? (
                                    boqItems.map((item) => (
                                        <TableRow key={item.id} data-state={selectedItemIds.includes(item.id) && "selected"}>
                                            <TableCell>
                                                <Checkbox 
                                                    checked={selectedItemIds.includes(item.id)}
                                                    onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                                />
                                            </TableCell>
                                            {visibleHeaders.map(header => {
                                                let cellData = item[header];
                                                if(header === 'BASIC PRICE') {
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
                                            <TableCell className="text-right">
                                                <AlertDialog>
                                                     <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" className="h-8 w-8 p-0">
                                                                <span className="sr-only">Open menu</span>
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem>Edit</DropdownMenuItem>
                                                            <AlertDialogTrigger asChild>
                                                                <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                                                            </AlertDialogTrigger>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                            <AlertDialogDescription>This will permanently delete the item. This action cannot be undone.</AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => handleDeleteSingle(item.id)}>Delete</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={visibleHeaders.length + 2} className="text-center h-24">
                                            No BOQ items found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
            </ResizablePanelGroup>
        </CardContent>
      </Card>
    </div>
  );
}
