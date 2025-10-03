
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PlusCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { BoqItem } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { BomDialog } from '@/components/BomDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';

export default function AssemblyPage() {
  const params = useParams();
  const projectSlug = params.project as string;
  const { toast } = useToast();
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<BoqItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchBoqItems = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
      const boqSnapshot = await getDocs(q);
      const items = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
      setBoqItems(items);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (projectSlug) {
      fetchBoqItems();
    }
  }, [projectSlug]);

  const handleOpenDialog = (item: BoqItem) => {
    setSelectedItem(item);
    setIsDialogOpen(true);
  };
  
  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    const specificKey = 'UNIT PRICE';
    if(keys.includes(specificKey)) return specificKey;
    return keys.find(key => key.toLowerCase().includes('price') && !key.toLowerCase().includes('total'));
  };

  const getItemDescription = (item: BoqItem) => {
    const descriptionKeys = [
      'Description',
      'DESCRIPTION OF ITEMS',
      'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'
    ];
    for (const key of descriptionKeys) {
      if (item[key]) return String(item[key]);
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? String(item[fallbackKey]) : '';
  };
  
  const getSlNo = (item: BoqItem): string => {
    return String(item['Sl No'] || item['SL. No.'] || '');
  }
  
  const formatCurrency = (value: any) => {
    const num = parseFloat(value);
    if(isNaN(num)) return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  const getBoqQty = (item: BoqItem): string => {
    return String(item['BOQ QTY'] || item['Total Qty'] || '0');
  }

  const filteredBoqItems = useMemo(() => {
    if (!searchTerm) {
      return boqItems;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return boqItems.filter(item => {
      const description = getItemDescription(item).toLowerCase();
      const slNo = getSlNo(item).toLowerCase();
      return description.includes(lowercasedFilter) || slNo.includes(lowercasedFilter);
    });
  }, [boqItems, searchTerm]);

  return (
    <>
      <div>
        <h1 className="text-3xl font-bold mb-6">BOM Management</h1>
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>BOQ Items</CardTitle>
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by Sl. No. or Description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[calc(100vh-22rem)]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>BOQ Sl. No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>BOQ Qty</TableHead>
                    <TableHead>Unit Price</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredBoqItems.length > 0 ? (
                    filteredBoqItems.map(item => {
                        const rateKey = findBasicPriceKey(item);
                        const rate = rateKey ? item[rateKey] : '0';
                        return (
                          <TableRow key={item.id}>
                            <TableCell>{getSlNo(item)}</TableCell>
                            <TableCell>{getItemDescription(item)}</TableCell>
                            <TableCell>{getBoqQty(item)}</TableCell>
                            <TableCell>{formatCurrency(rate)}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="outline" size="sm" onClick={() => handleOpenDialog(item)}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                {item.bom && item.bom.length > 0 ? 'Edit' : 'Add'} BOM
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                    })
                  ) : (
                     <TableRow>
                        <TableCell colSpan={5} className="text-center h-24">No BOQ Items found for this project.</TableCell>
                     </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
      {selectedItem && (
        <BomDialog
          isOpen={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          mainItem={selectedItem}
          onSaveSuccess={fetchBoqItems}
        />
      )}
    </>
  );
}
