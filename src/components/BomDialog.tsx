'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import type { BoqItem } from '@/lib/types';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { ItemSelector } from './ItemSelector'; // Assuming this will be adapted for BOQ items

interface BomItemEntry {
  boqItemId: string;
  name: string;
  unit: string;
  quantity: number;
}

interface BomDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  mainItem: BoqItem;
  allBoqItems: BoqItem[];
  onSaveSuccess: () => void;
}

export function BomDialog({ isOpen, onOpenChange, mainItem, allBoqItems, onSaveSuccess }: BomDialogProps) {
  const { toast } = useToast();
  const [bomItems, setBomItems] = useState<BomItemEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && mainItem.bom) {
      const populatedBom = mainItem.bom.map((bomItem: { boqItemId: string, quantity: number }) => {
        const fullItem = allBoqItems.find(item => item.id === bomItem.boqItemId);
        return {
          boqItemId: bomItem.boqItemId,
          name: fullItem ? (fullItem['Description'] || fullItem['DESCRIPTION OF ITEMS'] || 'Unknown') : 'Unknown Item',
          unit: fullItem ? (fullItem['UNIT'] || fullItem['UNITS'] || 'N/A') : 'N/A',
          quantity: bomItem.quantity,
        };
      }).filter(item => item.name !== 'Unknown Item');
      setBomItems(populatedBom);
    } else if (isOpen) {
      setBomItems([]);
    }
  }, [isOpen, mainItem, allBoqItems]);

  const subItemsAvailable = useMemo(() => {
    const bomItemIds = new Set(bomItems.map(item => item.boqItemId));
    return allBoqItems.filter(item => item.id !== mainItem.id && !bomItemIds.has(item.id));
  }, [allBoqItems, mainItem, bomItems]);

  const handleAddItem = (item: BoqItem) => {
    setBomItems(prev => [...prev, {
      boqItemId: item.id,
      name: item['Description'] || item['DESCRIPTION OF ITEMS'],
      unit: item['UNIT'] || item['UNITS'],
      quantity: 1
    }]);
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const newItems = [...bomItems];
    newItems[index].quantity = quantity;
    setBomItems(newItems);
  };

  const handleRemoveItem = (index: number) => {
    setBomItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const bomToSave = bomItems.map(item => ({
        boqItemId: item.boqItemId,
        quantity: item.quantity,
      }));
      await updateDoc(doc(db, 'boqItems', mainItem.id), { bom: bomToSave });
      toast({ title: 'Success', description: 'Bill of Materials saved successfully.' });
      onSaveSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving BOM:", error);
      toast({ title: 'Error', description: 'Failed to save Bill of Materials.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };
  
  const getItemDescription = (item: BoqItem): string => {
    const descriptionKeys = ['Description', 'DESCRIPTION OF ITEMS'];
    for (const key of descriptionKeys) {
      if (item[key]) return String(item[key]);
    }
    return 'No Description';
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bill of Materials for: {getItemDescription(mainItem)}</DialogTitle>
          <DialogDescription>
            Define the sub-components and quantities required to build this item.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="mb-4">
            <ItemSelector
              mainItems={[]} // Not used in this context
              subItems={subItemsAvailable.map(i => ({...i, name: getItemDescription(i)}))}
              selectedItemId={null}
              onSelect={(item, type) => {
                if (item) handleAddItem(item as BoqItem);
              }}
              isLoading={false}
            />
          </div>

          <ScrollArea className="h-72 border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sub-Item Name</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bomItems.map((item, index) => (
                  <TableRow key={item.boqItemId}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => handleQuantityChange(index, parseFloat(e.target.value) || 0)}
                        className="w-24"
                      />
                    </TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(index)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save BOM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
