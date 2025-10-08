
'use client';

import { useState, useEffect } from 'react';
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
import type { BoqItem, FabricationBomItem } from '@/lib/types';
import { Plus, Trash2, Loader2 } from 'lucide-react';

const initialBomItemState: Omit<FabricationBomItem, 'id'> = {
    markNo: '',
    section: '',
    grade: '',
    length: 0,
    width: 0,
    unitWt: 0,
    wtPerPc: 0,
    totalWtPerSet: 0,
    qtyPerSet: 0,
    totalWtKg: 0,
};


interface BomDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  mainItem: BoqItem;
  onSaveSuccess: () => void;
}

export function BomDialog({ isOpen, onOpenChange, mainItem, onSaveSuccess }: BomDialogProps) {
  const { toast } = useToast();
  const [bomItems, setBomItems] = useState<(Omit<FabricationBomItem, 'id'> & { id: string })[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const initialBom = mainItem.bom?.map(item => ({ 
        id: crypto.randomUUID(), 
        ...initialBomItemState, // ensure all fields are present
        ...item 
      })) || [];

      if(initialBom.length === 0) {
        setBomItems([{ id: crypto.randomUUID(), ...initialBomItemState }]);
      } else {
        setBomItems(initialBom);
      }
    } else {
       setBomItems([]); // Reset on close
    }
  }, [isOpen, mainItem.bom]);

  const handleItemChange = (index: number, field: keyof Omit<FabricationBomItem, 'id'>, value: string | number) => {
    const newItems = [...bomItems];
    const item = { ...newItems[index] };
    
    if (typeof value === 'string' && ['markNo', 'section', 'grade'].includes(field)) {
      (item[field] as any) = value;
    } else {
      const numericValue = typeof value === 'number' ? value : parseFloat(value);
      (item[field] as any) = isNaN(numericValue) ? 0 : numericValue;
    }

    // Auto-calculate
    if (field === 'unitWt' || field === 'length') {
        item.wtPerPc = (item.unitWt || 0) * (item.length || 0) / 1000;
    }
    if (field === 'wtPerPc' || field === 'qtyPerSet') {
        item.totalWtPerSet = (item.wtPerPc || 0) * (item.qtyPerSet || 0);
    }
    
    if (field === 'totalWtPerSet' || field === 'wtPerPc' || field === 'qtyPerSet') {
        item.totalWtKg = (item.totalWtPerSet || 0);
    }

    newItems[index] = item;
    setBomItems(newItems);
  };
  
  const handleAddItem = () => {
    setBomItems(prev => [...prev, { id: crypto.randomUUID(), ...initialBomItemState }]);
  };

  const handleRemoveItem = (id: string) => {
    if (bomItems.length > 1) {
        setBomItems(prev => prev.filter(item => item.id !== id));
    } else {
        setBomItems([{ id: crypto.randomUUID(), ...initialBomItemState }]);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const bomToSave = bomItems.map(({ id, ...rest }) => rest);
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
      <DialogContent className="max-w-7xl">
        <DialogHeader>
          <DialogTitle>Bill of Materials for: {getItemDescription(mainItem)}</DialogTitle>
          <DialogDescription>
            Define the raw materials and quantities required for fabrication.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[60vh] border rounded-md">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Mark No.</TableHead>
                        <TableHead>Section (MM)</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead>Length</TableHead>
                        <TableHead>Width (MM)</TableHead>
                        <TableHead>Unit Wt.</TableHead>
                        <TableHead>Wt/Pc (KG)</TableHead>
                        <TableHead>QTY/ PCS</TableHead>
                        <TableHead>Total Wt./Set</TableHead>
                        <TableHead>Total Wt./KG</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {bomItems.map((item, index) => (
                        <TableRow key={item.id}>
                            <TableCell><Input value={item.markNo} onChange={(e) => handleItemChange(index, 'markNo', e.target.value)} /></TableCell>
                            <TableCell><Input value={item.section} onChange={(e) => handleItemChange(index, 'section', e.target.value)} /></TableCell>
                            <TableCell><Input value={item.grade} onChange={(e) => handleItemChange(index, 'grade', e.target.value)} /></TableCell>
                            <TableCell><Input type="number" value={item.length || ''} onChange={(e) => handleItemChange(index, 'length', e.target.value)} /></TableCell>
                            <TableCell><Input type="number" value={item.width || ''} onChange={(e) => handleItemChange(index, 'width', e.target.value)} /></TableCell>
                            <TableCell><Input type="number" value={item.unitWt || ''} onChange={(e) => handleItemChange(index, 'unitWt', e.target.value)} /></TableCell>
                            <TableCell><Input type="number" value={item.wtPerPc || ''} onChange={(e) => handleItemChange(index, 'wtPerPc', e.target.value)} /></TableCell>
                            <TableCell><Input type="number" value={item.qtyPerSet || ''} onChange={(e) => handleItemChange(index, 'qtyPerSet', e.target.value)} /></TableCell>
                            <TableCell><Input type="number" value={item.totalWtPerSet || ''} readOnly className="bg-muted" /></TableCell>
                            <TableCell><Input type="number" value={item.totalWtKg || ''} readOnly className="bg-muted" /></TableCell>
                            <TableCell className="text-right">
                                <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(item.id)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </ScrollArea>
        <div className="flex justify-start">
            <Button variant="outline" size="sm" onClick={handleAddItem}>
                <Plus className="mr-2 h-4 w-4" /> Add Row
            </Button>
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
