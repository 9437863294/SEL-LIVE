
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Settings } from 'lucide-react';
import type { BoqItem } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useParams } from 'next/navigation';
import { ConversionDialog } from '@/components/ConversionDialog';

export default function ConversionsPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [items, setItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<BoqItem | null>(null);

  const fetchItems = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const q = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
      const itemsSnapshot = await getDocs(q);
      const itemsData = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
      setItems(itemsData);
    } catch (error) {
      console.error("Error fetching items:", error);
      toast({ title: "Error", description: "Failed to fetch BOQ items.", variant: "destructive" });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    fetchItems();
  }, [projectSlug, toast]);

  const handleOpenDialog = (item: BoqItem) => {
    setSelectedItem(item);
    setIsDialogOpen(true);
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

  const getUnit = (item: BoqItem): string => {
    return String(item['UNIT'] || item['UNITS'] || 'N/A');
  }

  return (
    <>
      <div>
        <h1 className="text-3xl font-bold mb-6">Unit Conversions</h1>
        <Card>
          <CardHeader>
            <CardTitle>Define Item Unit Conversions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Base Unit</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-10" /></TableCell></TableRow>
                  ))
                ) : items.length > 0 ? (
                  items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{getItemDescription(item)}</TableCell>
                      <TableCell>{getUnit(item)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => handleOpenDialog(item)}>
                          <Settings className="mr-2 h-4 w-4" /> Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center h-24">No BOQ items found to define conversions.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      {selectedItem && (
        <ConversionDialog
          isOpen={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          item={selectedItem}
          onSaveSuccess={fetchItems}
        />
      )}
    </>
  );
}
