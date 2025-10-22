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
import type { BoqItem } from '@/lib/types';
import { Search, Loader2, ArrowUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useParams } from 'next/navigation';


interface JmcItemSelectorDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (selectedItems: BoqItem[]) => void;
  boqItems: BoqItem[];
}

export function JmcItemSelectorDialog({ isOpen, onOpenChange, onConfirm, boqItems }: JmcItemSelectorDialogProps) {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');


  const filteredItems = useMemo(() => {
    let items = boqItems.filter(item =>
        (item['Description']?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         (item['SL. No.'] || '').toString().toLowerCase().includes(searchTerm.toLowerCase()) ||
         (item['ERP SL NO'] || '').toString().toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (sortKey) {
        items.sort((a, b) => {
            const valA = a[sortKey];
            const valB = b[sortKey];

            if (valA === undefined || valA === null) return 1;
            if (valB === undefined || valB === null) return -1;
            
            if (!isNaN(Number(valA)) && !isNaN(Number(valB))) {
                return sortDirection === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
            }

            if (String(valA) < String(valB)) return sortDirection === 'asc' ? -1 : 1;
            if (String(valA) > String(valB)) return sortDirection === 'asc' ? 1 : -1;
            
            return 0;
        });
    }

    return items;
  }, [boqItems, searchTerm, sortKey, sortDirection]);

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
  
  const handleSort = (key: string) => {
    if (sortKey === key) {
        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
        setSortKey(key);
        setSortDirection('asc');
    }
  }

  const handleConfirm = () => {
    const selectedBoqItems = boqItems.filter(item => selectedIds.has(item.id));
    onConfirm(selectedBoqItems);
    onOpenChange(false);
    setSelectedIds(new Set());
    setSearchTerm('');
  };
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }
  
  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const knownPriceKeys = ['UNIT PRICE', 'Unit Rate', 'Rate', 'UNIT PRICE'];
    for (const key of knownPriceKeys) {
        if (item.hasOwnProperty(key)) {
            return key;
        }
    }
    return Object.keys(item).find(key => key.toLowerCase().includes('rate') && !key.toLowerCase().includes('total'));
};

  const getCombinedSlNo = (item: BoqItem): string => {
      const erpSlNo = item['ERP SL NO'] || '';
      const boqSlNo = item['BOQ SL No'] || item['SL. No.'] || '';
      if (erpSlNo && boqSlNo) {
          return `${erpSlNo} / ${boqSlNo}`;
      }
      return erpSlNo || boqSlNo || '';
  };


  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Select BOQ Items</DialogTitle>
          <DialogDescription>
            Select multiple items from the Bill of Quantities to add.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
            <div className="relative mb-4">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by Sl. No. or Description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                />
            </div>
            <ScrollArea className="h-96 border rounded-md">
                <div className="p-1">
                    <div className="grid grid-cols-[auto_1fr_1fr_3fr_1fr_1fr] items-center px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted">
                        <div className="w-[50px] flex justify-center">
                            <Checkbox
                                checked={filteredItems.length > 0 && selectedIds.size === filteredItems.length}
                                onCheckedChange={handleSelectAll}
                            />
                        </div>
                        <div className="cursor-pointer flex items-center" onClick={() => handleSort('ERP SL NO')}>
                            ERP Sl. No.
                            {sortKey === 'ERP SL NO' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                        </div>
                        <div className="cursor-pointer flex items-center" onClick={() => handleSort('BOQ SL No')}>
                            BOQ Sl. No.
                             {sortKey === 'BOQ SL No' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                        </div>
                        <div>Description</div>
                        <div className="text-right cursor-pointer" onClick={() => handleSort(findBasicPriceKey(filteredItems[0] || {}) || 'rate')}>
                            Unit Rate
                            {sortKey === (findBasicPriceKey(filteredItems[0] || {}) || 'rate') && <ArrowUpDown className="ml-1 h-3 w-3 inline-flex" />}
                        </div>
                        <div className="text-right">Unit</div>
                    </div>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full p-8">
                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : filteredItems.length > 0 ? (
                        filteredItems.map(item => {
                             const rateKey = findBasicPriceKey(item);
                             const rate = rateKey ? item[rateKey] : 0;
                             return (
                                <div 
                                    key={item.id} 
                                    className={`grid grid-cols-[auto_1fr_1fr_3fr_1fr_1fr] items-center p-2 border-b last:border-b-0 cursor-pointer ${selectedIds.has(item.id) ? 'bg-muted' : 'hover:bg-muted/50'}`}
                                    onClick={() => handleSelectRow(item.id, !selectedIds.has(item.id))}
                                >
                                    <div className="w-[50px] flex justify-center">
                                        <Checkbox
                                            checked={selectedIds.has(item.id)}
                                            onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                        />
                                    </div>
                                    <div className="truncate pr-2">{item['ERP SL NO']}</div>
                                    <div className="truncate pr-2">{item['BOQ SL No'] || item['SL. No.']}</div>
                                    <div className="truncate pr-2">{item['Description']}</div>
                                    <div className="text-right pr-2">{formatCurrency(rate)}</div>
                                    <div className="text-right pr-2">{item['Unit']}</div>
                                </div>
                             )
                        })
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