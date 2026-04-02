
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
import { doc, updateDoc, collection, getDocs } from 'firebase/firestore';
import type { BoqItem, Conversion, Site } from '@/lib/types';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';

interface ConversionDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  item: BoqItem;
  onSaveSuccess: () => void;
}

export function ConversionDialog({ isOpen, onOpenChange, item, onSaveSuccess }: ConversionDialogProps) {
  const { toast } = useToast();
  const [conversions, setConversions] = useState<(Conversion)[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [units, setUnits] = useState<Site[]>([]);
  
  const baseUnit = item['UNIT'] || item['UNITS'] || 'N/A';
  
  const initialConversionState: Omit<Conversion, 'id'> = {
    fromUnit: baseUnit,
    fromQty: 1,
    toUnit: '',
    toQty: 1,
  };


  useEffect(() => {
    const fetchUnits = async () => {
        try {
            const unitsSnapshot = await getDocs(collection(db, 'units'));
            setUnits(unitsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site)));
        } catch (error) {
            console.error("Failed to fetch units:", error);
        }
    };
    fetchUnits();
  }, []);

  useEffect(() => {
    if (isOpen) {
      const existingConversions = item.conversions?.map(c => ({ ...c, id: c.id || crypto.randomUUID() })) || [];
      if (existingConversions.length === 0) {
        setConversions([{ ...initialConversionState, id: crypto.randomUUID() }]);
      } else {
        setConversions(existingConversions);
      }
    }
  }, [isOpen, item.conversions, baseUnit]);

  const handleItemChange = (id: string, field: keyof Omit<Conversion, 'id'>, value: string | number) => {
    setConversions(prev =>
      prev.map(conv => (conv.id === id ? { ...conv, [field]: value } : conv))
    );
  };
  
  const handleAddItem = () => {
    setConversions(prev => [...prev, { ...initialConversionState, id: crypto.randomUUID() }]);
  };

  const handleRemoveItem = (id: string) => {
    if (conversions.length > 1) {
      setConversions(prev => prev.filter(item => item.id !== id));
    } else {
      setConversions([{ ...initialConversionState, id: crypto.randomUUID() }]);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const conversionsToSave = conversions.map(({ id, ...rest }) => ({
          ...rest,
          fromQty: Number(rest.fromQty),
          toQty: Number(rest.toQty)
      }));

      if (conversionsToSave.some(c => !c.fromUnit || !c.toUnit || isNaN(c.fromQty) || isNaN(c.toQty) || c.fromQty <= 0 || c.toQty <= 0)) {
        toast({ title: 'Validation Error', description: 'All fields must be filled and quantities must be positive numbers.', variant: 'destructive'});
        setIsSaving(false);
        return;
      }
      
      await updateDoc(doc(db, 'boqItems', item.id), { conversions: conversionsToSave });
      toast({ title: 'Success', description: 'Conversions saved successfully.' });
      onSaveSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving conversions:", error);
      toast({ title: 'Error', description: 'Failed to save conversions.', variant: 'destructive' });
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
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Unit Conversions for: {getItemDescription(item)}</DialogTitle>
          <DialogDescription>
            Define multiple conversion rules for this item. E.g., 1 Box = 10 Pcs. The "From Unit" is the base unit from BOQ.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[60vh] border rounded-md">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>From Qty</TableHead>
                        <TableHead>Base Unit (from BOQ)</TableHead>
                        <TableHead className="w-10 text-center">=</TableHead>
                        <TableHead>To Qty</TableHead>
                        <TableHead>To Unit</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {conversions.map((conv) => (
                        <TableRow key={conv.id}>
                            <TableCell><Input type="number" value={conv.fromQty} onChange={(e) => handleItemChange(conv.id, 'fromQty', e.target.valueAsNumber)} /></TableCell>
                            <TableCell>
                                <Input value={baseUnit} readOnly className="bg-muted font-medium" />
                            </TableCell>
                            <TableCell className="text-center font-bold">=</TableCell>
                            <TableCell><Input type="number" value={conv.toQty} onChange={(e) => handleItemChange(conv.id, 'toQty', e.target.valueAsNumber)} /></TableCell>
                            <TableCell>
                                <Select value={conv.toUnit} onValueChange={(value) => handleItemChange(conv.id, 'toUnit', value)}>
                                    <SelectTrigger><SelectValue placeholder="Select Unit" /></SelectTrigger>
                                    <SelectContent>
                                        {units.map(u => <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </TableCell>
                            <TableCell className="text-right">
                                <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(conv.id)}>
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
                <Plus className="mr-2 h-4 w-4" /> Add Rule
            </Button>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Conversions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
