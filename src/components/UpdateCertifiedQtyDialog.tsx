

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
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import type { JmcEntry, JmcItem } from '@/lib/types';
import { Loader2, Save } from 'lucide-react';

interface UpdateCertifiedQtyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry;
  projectSlug: string;
  onSaveSuccess: () => void;
}

export function UpdateCertifiedQtyDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  projectSlug,
  onSaveSuccess,
}: UpdateCertifiedQtyDialogProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<JmcItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setItems(JSON.parse(JSON.stringify(jmcEntry.items))); // Deep copy
    }
  }, [isOpen, jmcEntry]);

  const handleCertifiedQtyChange = (index: number, value: string) => {
    const newItems = [...items];
    const executedQty = Number(newItems[index].executedQty);
    let certifiedQty = parseFloat(value);
    
    if (isNaN(certifiedQty) || certifiedQty < 0) {
        certifiedQty = 0;
    } else if (certifiedQty > executedQty) {
      toast({
        title: 'Validation Error',
        description: `Certified quantity cannot exceed executed quantity (${executedQty}).`,
        variant: 'destructive',
      });
      certifiedQty = executedQty;
    }
    
    newItems[index] = { ...newItems[index], certifiedQty };
    setItems(newItems);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const jmcRef = doc(db, 'projects', projectSlug, 'jmcEntries', jmcEntry.id);
      await updateDoc(jmcRef, { items: items });
      toast({ title: 'Success', description: 'Certified quantities updated.' });
      onSaveSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating certified quantities:', error);
      toast({ title: 'Error', description: 'Failed to update quantities.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Update Certified Quantities</DialogTitle>
          <DialogDescription>
            JMC No: {jmcEntry.jmcNo}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Executed Qty</TableHead>
                <TableHead className="w-[150px]">Certified Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.executedQty}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.certifiedQty ?? ''}
                      onChange={(e) => handleCertifiedQtyChange(index, e.target.value)}
                      max={item.executedQty}
                      min={0}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Quantities
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
