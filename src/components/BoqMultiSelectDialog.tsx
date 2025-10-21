
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { JmcEntry, JmcItem, Bill, BillItem } from '@/lib/types';
import { Search, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useParams } from 'next/navigation';


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
    billedQty: number;
    availableQty: number;
}

export function JmcItemSelectorDialog({ isOpen, onOpenChange, onConfirm, alreadyAddedItems }: JmcItemSelectorDialogProps) {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [jmcItems, setJmcItems] = useState<JmcItemWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !projectSlug) return;

    const fetchJmcAndBillData = async () => {
        setIsLoading(true);
        try {
            const jmcCollectionRef = collection(db, 'projects', projectSlug, 'jmcEntries');
            const billsCollectionRef = collection(db, 'projects', projectSlug, 'bills');

            const [jmcSnapshot, billsSnapshot] = await Promise.all([
                getDocs(jmcCollectionRef),
                getDocs(billsCollectionRef)
            ]);

            const allJmcEntries = jmcSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JmcEntry));
            const allBills = billsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill));
            
            const billedQuantities: { [jmcItemId: string]: number } = {};

            allBills.forEach(bill => {
                bill.items.forEach(item => {
                    billedQuantities[item.jmcItemId] = (billedQuantities[item.jmcItemId] || 0) + parseFloat(item.billedQty);
                });
            });

            const processedJmcItems: JmcItemWithDetails[] = [];
            allJmcEntries.forEach(entry => {
                entry.items.forEach((item, index) => {
                    const jmcItemId = `${entry.id}-${index}`; // Create a unique ID for each JMC item
                    const executedQty = parseFloat(item.executedQty || '0');
                    const billedQty = billedQuantities[jmcItemId] || 0;
                    const availableQty = executedQty - billedQty;

                    if (availableQty > 0) {
                        processedJmcItems.push({
                            ...item,
                            id: jmcItemId,
                            jmcEntryId: entry.id,
                            jmcNo: entry.jmcNo,
                            billedQty,
                            availableQty,
                        });
                    }
                });
            });

            setJmcItems(processedJmcItems);

        } catch (error) {
            console.error("Error fetching data for item selection:", error);
            toast({ title: "Error", description: "Could not load available JMC items for this project.", variant: "destructive" });
        }
        setIsLoading(false);
    };

    fetchJmcAndBillData();
  }, [isOpen, projectSlug, toast]);

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
        rate: String(item.rate),
        executedQty: String(item.availableQty), // Available qty for billing
        billedQty: '', // User will fill this
        totalAmount: ''
    }));
    onConfirm(billItems);
    onOpenChange(false);
    setSelectedIds(new Set());
    setSearchTerm('');
  };
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
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
                <div className="p-1">
                    <div className="grid grid-cols-[auto_1fr_1fr_2fr_1fr_1fr] items-center px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted">
                        <div className="w-[50px] flex justify-center">
                            <Checkbox
                                checked={filteredItems.length > 0 && selectedIds.size === filteredItems.length}
                                onCheckedChange={handleSelectAll}
                            />
                        </div>
                        <div>JMC No.</div>
                        <div>BOQ Sl.No.</div>
                        <div>Description</div>
                        <div className="text-right">Available Qty</div>
                        <div className="text-right">Unit Rate</div>
                    </div>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full p-8">
                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : filteredItems.length > 0 ? (
                        filteredItems.map(item => (
                            <div 
                                key={item.id} 
                                className={`grid grid-cols-[auto_1fr_1fr_2fr_1fr_1fr] items-center p-2 border-b last:border-b-0 cursor-pointer ${selectedIds.has(item.id) ? 'bg-muted' : 'hover:bg-muted/50'}`}
                                onClick={() => handleSelectRow(item.id, !selectedIds.has(item.id))}
                            >
                                <div className="w-[50px] flex justify-center">
                                    <Checkbox
                                        checked={selectedIds.has(item.id)}
                                        onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                    />
                                </div>
                                <div className="truncate pr-2">{item.jmcNo}</div>
                                <div className="truncate pr-2">{item.boqSlNo}</div>
                                <div className="truncate pr-2">{item.description}</div>
                                <div className="text-right pr-2">{item.availableQty}</div>
                                <div className="text-right pr-2">{formatCurrency(item.rate)}</div>
                            </div>
                        ))
                    ) : (
                        <div className="text-center p-8 text-muted-foreground">
                            No available items found.
                        </div>
                    )}
                </div>
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
