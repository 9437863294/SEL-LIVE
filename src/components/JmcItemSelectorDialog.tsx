
'use client';

import { useState, useMemo, useEffect } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { JmcEntry, JmcItem, Bill, BillItem } from '@/lib/types';
import { Search, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface JmcItemSelectorDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (selectedItems: BillItem[]) => void;
  alreadyAddedItems: BillItem[];
}

interface JmcItemWithDetails extends JmcItem {
    id: string; // Unique ID for each JMC item
    jmcEntryId: string;
    jmcNo: string;
    executedQty: number;
    billedQty: number;
    availableQty: number;
}

export function JmcItemSelectorDialog({ isOpen, onOpenChange, onConfirm, alreadyAddedItems }: JmcItemSelectorDialogProps) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [jmcItems, setJmcItems] = useState<JmcItemWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const fetchJmcAndBillData = async () => {
        setIsLoading(true);
        try {
            const [jmcSnapshot, billsSnapshot] = await Promise.all([
                getDocs(collection(db, 'jmcEntries')),
                getDocs(collection(db, 'bills'))
            ]);

            const allJmcEntries = jmcSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JmcEntry));
            const allBills = billsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill));
            
            const billedQuantities: { [jmcItemId: string]: number } = {};

            allBills.forEach(bill => {
                bill.items.forEach(item => {
                    billedQuantities[item.jmcItemId] = (billedQuantities[item.jmcItemId] || 0) + item.billedQty;
                });
            });

            const processedJmcItems: JmcItemWithDetails[] = [];
            allJmcEntries.forEach(entry => {
                entry.items.forEach((item, index) => {
                    const jmcItemId = `${entry.id}-${index}`; // Create a unique ID for each JMC item
                    const executedQty = parseFloat(item.executedQty);
                    const billedQty = billedQuantities[jmcItemId] || 0;
                    const availableQty = executedQty - billedQty;

                    if (availableQty > 0) {
                        processedJmcItems.push({
                            ...item,
                            id: jmcItemId,
                            jmcEntryId: entry.id,
                            jmcNo: entry.jmcNo,
                            executedQty,
                            billedQty,
                            availableQty,
                        });
                    }
                });
            });

            setJmcItems(processedJmcItems);

        } catch (error) {
            console.error("Error fetching data for item selection:", error);
            toast({ title: "Error", description: "Could not load available JMC items.", variant: "destructive" });
        }
        setIsLoading(false);
    };

    fetchJmcAndBillData();
  }, [isOpen, toast]);

  const filteredItems = useMemo(() => {
    const lowercasedFilter = searchTerm.toLowerCase();
    const addedItemIds = new Set(alreadyAddedItems.map(item => item.jmcItemId));

    return jmcItems.filter(item =>
      !addedItemIds.has(item.id) &&
      (
        item.jmcNo.toLowerCase().includes(lowercasedFilter) ||
        item.boqSlNo.toLowerCase().includes(lowercasedFilter) ||
        item.description.toLowerCase().includes(lowercasedFilter)
      )
    );
  }, [jmcItems, searchTerm, alreadyAddedItems]);

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(filteredItems.map(item => item.id)) : new Set());
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    const newSelectedIds = new Set(selectedIds);
    if (checked) {
      newSelectedIds.add(id);
    } else {
      newSelectedIds.delete(id);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleConfirm = () => {
    const selectedJmcItems = jmcItems.filter(item => selectedIds.has(item.id));
    const billItems: BillItem[] = selectedJmcItems.map(item => ({
        jmcItemId: item.id,
        jmcEntryId: item.jmcEntryId,
        jmcNo: item.jmcNo,
        boqSlNo: item.boqSlNo,
        description: item.description,
        unit: item.unit,
        rate: item.rate,
        executedQty: String(item.availableQty), // Available qty for billing
        billedQty: '', // User will fill this
        totalAmount: ''
    }));
    onConfirm(billItems);
    onOpenChange(false);
    setSelectedIds(new Set());
    setSearchTerm('');
  };
  
  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount);
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Select Items to Add to Bill</DialogTitle>
          <DialogDescription>
            Only items with a remaining quantity to be billed are shown.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
            <div className="relative mb-4">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by JMC No, Sl. No. or Description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                />
            </div>
            <ScrollArea className="h-96 border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <Checkbox
                                    checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
                            <TableHead>JMC No.</TableHead>
                            <TableHead>BOQ Sl.No.</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Available Qty</TableHead>
                            <TableHead>Rate</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                                </TableCell>
                            </TableRow>
                        ) : filteredItems.length > 0 ? (
                           filteredItems.map(item => (
                            <TableRow key={item.id} data-state={selectedIds.has(item.id) && "selected"}>
                                <TableCell>
                                    <Checkbox
                                        checked={selectedIds.has(item.id)}
                                        onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                    />
                                </TableCell>
                                <TableCell>{item.jmcNo}</TableCell>
                                <TableCell>{item.boqSlNo}</TableCell>
                                <TableCell>{item.description}</TableCell>
                                <TableCell>{item.availableQty}</TableCell>
                                <TableCell>{formatCurrency(item.rate)}</TableCell>
                            </TableRow>
                           ))
                        ) : (
                             <TableRow>
                                <TableCell colSpan={6} className="text-center h-24">
                                   No available items found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleConfirm} disabled={selectedIds.size === 0}>
            Add {selectedIds.size} Selected Item(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
