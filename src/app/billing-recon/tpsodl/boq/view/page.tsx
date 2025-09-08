
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

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
    'BASIC PRICE'
];


export default function ViewBoqPage() {
  const { toast } = useToast();
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchBoqItems = async () => {
      setIsLoading(true);
      try {
        const querySnapshot = await getDocs(collection(db, 'boqItems'));
        const items = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
        setBoqItems(items);
        
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

    fetchBoqItems();
  }, [toast]);

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/billing-recon/tpsodl/boq">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">View BOQ</h1>
      </div>
      <Card>
        <CardContent className="p-0">
            <Table>
                <TableHeader>
                    <TableRow>
                        {tableHeaders.map(header => <TableHead key={header}>{header}</TableHead>)}
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
                                {tableHeaders.map(header => (
                                    <TableCell key={`${item.id}-${header}`}>{item[header]}</TableCell>
                                ))}
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
        </CardContent>
      </Card>
    </div>
  );
}
