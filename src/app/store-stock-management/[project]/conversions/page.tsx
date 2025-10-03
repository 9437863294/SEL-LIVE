
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save } from 'lucide-react';
import type { BoqItem } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useParams } from 'next/navigation';

interface Conversion {
  fromUnit: string;
  fromQty: number;
  toUnit: string;
  toQty: number;
}

interface ItemWithConversion extends BoqItem {
  conversion?: Conversion;
}

export default function ConversionsPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [items, setItems] = useState<ItemWithConversion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchItems = async () => {
      if (!projectSlug) return;
      setIsLoading(true);
      try {
        const q = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
        const itemsSnapshot = await getDocs(q);
        const itemsData = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ItemWithConversion));
        setItems(itemsData);
      } catch (error) {
        console.error("Error fetching items:", error);
        toast({ title: "Error", description: "Failed to fetch BOQ items.", variant: "destructive" });
      }
      setIsLoading(false);
    };
    fetchItems();
  }, [projectSlug, toast]);

  const handleConversionChange = (itemId: string, field: keyof Conversion, value: string | number) => {
    setItems(prevItems =>
      prevItems.map(item => {
        if (item.id === itemId) {
          const updatedConversion = { ...item.conversion, [field]: value };
          return { ...item, conversion: updatedConversion as Conversion };
        }
        return item;
      })
    );
  };
  
  const handleSaveConversion = async (itemId: string) => {
    const itemToSave = items.find(item => item.id === itemId);
    if (!itemToSave || !itemToSave.conversion) {
      toast({ title: 'No data to save', variant: 'destructive' });
      return;
    }
    
    const { fromQty, toQty } = itemToSave.conversion;
    if (isNaN(Number(fromQty)) || isNaN(Number(toQty))) {
        toast({ title: 'Invalid quantity', description: 'Quantities must be numbers.', variant: 'destructive'});
        return;
    }

    setIsSaving(prev => ({ ...prev, [itemId]: true }));
    try {
      const itemRef = doc(db, 'boqItems', itemId);
      await updateDoc(itemRef, {
        conversion: {
            ...itemToSave.conversion,
            fromQty: Number(fromQty),
            toQty: Number(toQty),
        }
      });
      toast({ title: 'Success', description: `Conversion for ${getItemDescription(itemToSave)} saved.` });
    } catch (error) {
      console.error("Error saving conversion:", error);
      toast({ title: 'Error', description: 'Failed to save conversion.', variant: 'destructive' });
    } finally {
      setIsSaving(prev => ({ ...prev, [itemId]: false }));
    }
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
                <TableHead colSpan={3} className="text-center">Conversion Rule</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-10" /></TableCell></TableRow>
                ))
              ) : items.length > 0 ? (
                items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{getItemDescription(item)}</TableCell>
                    <TableCell>{getUnit(item)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        placeholder="e.g., 1"
                        value={item.conversion?.fromQty || ''}
                        onChange={(e) => handleConversionChange(item.id, 'fromQty', e.target.value)}
                        className="w-24"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        placeholder="e.g., Set"
                        value={item.conversion?.fromUnit || ''}
                        onChange={(e) => handleConversionChange(item.id, 'fromUnit', e.target.value)}
                        className="w-24"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>=</span>
                        <Input
                          type="number"
                          placeholder="e.g., 5"
                          value={item.conversion?.toQty || ''}
                          onChange={(e) => handleConversionChange(item.id, 'toQty', e.target.value)}
                          className="w-24"
                        />
                        <Input
                            placeholder="e.g., Mtr"
                            value={item.conversion?.toUnit || ''}
                            onChange={(e) => handleConversionChange(item.id, 'toUnit', e.target.value)}
                            className="w-24"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => handleSaveConversion(item.id)} disabled={isSaving[item.id]}>
                        {isSaving[item.id] ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">No BOQ items found to define conversions.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
