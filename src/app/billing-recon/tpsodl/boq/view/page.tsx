
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch } from 'firebase/firestore';
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
  const [isClearing, setIsClearing] = useState(false);

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
    setIsClearing(true);
    try {
        const querySnapshot = await getDocs(collection(db, 'boqItems'));
        if (querySnapshot.empty) {
            toast({ title: 'No data to clear', description: 'The BOQ is already empty.' });
            setIsClearing(false);
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
        setIsClearing(false);
    }
  }

  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    return keys.find(key => key.toLowerCase().includes('price') && !key.toLowerCase().includes('total'));
  };

  const formatNumber = (value: any) => {
    if (typeof value === 'number') {
      return parseFloat(value.toFixed(4));
    }
    return value;
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/billing-recon/tpsodl/boq">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">View BOQ</h1>
        </div>
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isLoading || boqItems.length === 0 || isClearing}>
                    {isClearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
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
                <AlertDialogAction onClick={handleClearBoq} disabled={isClearing}>
                   {isClearing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                   Continue
                </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      </div>
      <Card>
        <CardContent className="p-0">
            <ResizablePanelGroup direction="horizontal" className="min-w-full rounded-lg border">
                <ResizablePanel defaultSize={100}>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    {tableHeaders.map((header) => (
                                        <TableHead key={header} className="whitespace-nowrap px-4">{header}</TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {tableHeaders.map((header, j) => (
                                            <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                                        ))}
                                    </TableRow>
                                    ))
                                ) : boqItems.length > 0 ? (
                                    boqItems.map((item) => (
                                        <TableRow key={item.id}>
                                            {tableHeaders.map(header => {
                                                let cellData = item[header];
                                                if(header === 'BASIC PRICE') {
                                                const priceKey = findBasicPriceKey(item);
                                                cellData = priceKey ? item[priceKey] : 'N/A';
                                                }
                                                return (
                                                    <TableCell key={`${item.id}-${header}`}>{formatNumber(cellData)}</TableCell>
                                                )
                                            })}
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={tableHeaders.length} className="text-center h-24">
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
