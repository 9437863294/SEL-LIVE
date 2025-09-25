
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import type { MainItem, SubItem, BomItem } from '@/lib/types';
import { Plus, Trash2 } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';

interface BomDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  mainItem: MainItem | null;
  subItems: SubItem[];
  onBomUpdate: () => void;
}

export function BomDialog({ isOpen, onOpenChange, mainItem, subItems, onBomUpdate }: BomDialogProps) {
  const { toast } = useToast();
  const [bom, setBom] = useState<BomItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (mainItem) {
      setBom(mainItem.bom || []);
    }
  }, [mainItem]);

  const handleAddBomItem = () => {
    setBom([...bom, { subItemId: '', quantity: 1 }]);
  };

  const handleBomItemChange = (index: number, field: 'subItemId' | 'quantity', value: string) => {
    const newBom = [...bom];
    if (field === 'quantity') {
      newBom[index][field] = parseFloat(value) || 0;
    } else {
      newBom[index][field] = value;
    }
    setBom(newBom);
  };
  
  const handleRemoveBomItem = (index: number) => {
      setBom(bom.filter((_, i) => i !== index));
  }

  const handleSaveBom = async () => {
    if (!mainItem) return;
    setIsSaving(true);
    try {
      const mainItemRef = doc(db, 'main_items', mainItem.id);
      await updateDoc(mainItemRef, { bom: bom });
      toast({ title: 'Success', description: 'Bill of Materials updated.' });
      onBomUpdate(); // Refresh data in parent
      onOpenChange(false);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to update BOM.', variant: 'destructive' });
    }
    setIsSaving(false);
  };

  if (!mainItem) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Bill of Materials for: {mainItem.name}</DialogTitle>
          <DialogDescription>
            Define the sub-items and quantities required to make one main item.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Sub-Item</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {bom.map((item, index) => {
                        const selectedSubItem = subItems.find(si => si.id === item.subItemId);
                        return (
                             <TableRow key={index}>
                                <TableCell>
                                    <Select value={item.subItemId} onValueChange={value => handleBomItemChange(index, 'subItemId', value)}>
                                        <SelectTrigger><SelectValue placeholder="Select Sub-Item"/></SelectTrigger>
                                        <SelectContent>
                                            {subItems.map(si => (
                                                <SelectItem key={si.id} value={si.id}>{si.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </TableCell>
                                <TableCell>{selectedSubItem?.unit || 'N/A'}</TableCell>
                                <TableCell>
                                    <Input 
                                        type="number" 
                                        value={item.quantity} 
                                        onChange={e => handleBomItemChange(index, 'quantity', e.target.value)}
                                        className="w-24"
                                    />
                                </TableCell>
                                <TableCell>
                                    <Button variant="ghost" size="icon" onClick={() => handleRemoveBomItem(index)}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        )
                    })}
                </TableBody>
            </Table>
        </ScrollArea>
        <Button variant="outline" onClick={handleAddBomItem} className="mt-2">
            <Plus className="mr-2 h-4 w-4" /> Add Item to BOM
        </Button>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSaveBom} disabled={isSaving}>Save BOM</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
