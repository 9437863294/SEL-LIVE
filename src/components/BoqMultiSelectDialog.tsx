
'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
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
import type { JmcEntry, JmcItem, Bill, BillItem, BoqItem } from '@/lib/types';
import { Search, Loader2, ArrowUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import type { CheckedState } from '@radix-ui/react-checkbox';

interface BoqMultiSelectDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (selectedItems: BoqItem[]) => void;
  boqItems: BoqItem[];
}

export function BoqMultiSelectDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  boqItems,
}: BoqMultiSelectDialogProps) {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState(''); // debounced
  const [isLoading, setIsLoading] = useState(false);
  const [sortKey, setSortKey] =
    useState<keyof BoqItem | 'description' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');


  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Helpers
  const getItemDescription = (item: BoqItem): string => {
    const descriptionKeys = ['Description', 'DESCRIPTION OF ITEMS'];
    for (const key of descriptionKeys) {
      if ((item as any)[key]) return String((item as any)[key]);
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? String((item as any)[fallbackKey]) : 'No Description';
  };

  const getBoqSlNo = (item: BoqItem): string => {
    return String(item['BOQ SL No'] || item['SL. No.'] || '');
  };

  const getRateNumber = (rate: unknown) => {
    if (typeof rate === 'number') return rate;
    const n = Number(rate);
    return Number.isFinite(n) ? n : 0;
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0);

  const filteredItems = useMemo(() => {
    let items = boqItems.filter((item) => {
      const q = searchTerm.toLowerCase();
      if (!q) return true;
      return (
        getBoqSlNo(item).toLowerCase().includes(q) ||
        getItemDescription(item).toLowerCase().includes(q)
      );
    });

    if (sortKey) {
      const dir = sortDirection === 'asc' ? 1 : -1;
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

      items.sort((a, b) => {
        const valA = sortKey === 'description' ? getItemDescription(a) : (a as any)[sortKey];
        const valB = sortKey === 'description' ? getItemDescription(b) : (b as any)[sortKey];

        if (valA === undefined || valA === null) return 1 * dir;
        if (valB === undefined || valB === null) return -1 * dir;
        
        if (typeof valA === 'number' && typeof valB === 'number') {
            return (valA - valB) * dir;
        }

        return collator.compare(String(valA), String(valB)) * dir;
      });
    }

    return items;
  }, [boqItems, searchTerm, sortKey, sortDirection]);

  // Select-all logic
  const allOnPageSelected =
    filteredItems.length > 0 && filteredItems.every((it) => selectedIds.has(it.id));
  const noneSelected = filteredItems.every((it) => !selectedIds.has(it.id));
  const selectAllState: CheckedState =
    allOnPageSelected ? true : noneSelected ? false : 'indeterminate';

  const handleSelectAll = (checked: CheckedState) => {
    if (checked) {
      setSelectedIds(new Set(filteredItems.map((i) => i.id)));
    } else {
      const next = new Set(selectedIds);
      filteredItems.forEach((i) => next.delete(i.id));
      setSelectedIds(next);
    }
  };

  const handleSelectRow = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSort = (key: keyof BoqItem | 'description') => {
    if (sortKey === key) {
      setSortDirection((p) => (p === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const handleConfirm = () => {
    const selectedBoqItems = boqItems.filter((item) => selectedIds.has(item.id));
    onConfirm(selectedBoqItems);
    onOpenChange(false);
    setSelectedIds(new Set());
    setSearchInput('');
    setSearchTerm('');
  };
  
  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const knownPriceKeys = ['UNIT PRICE', 'Unit Rate', 'Rate', 'UNIT PRICE'];
    for (const key of knownPriceKeys) {
        if (item.hasOwnProperty(key)) {
            return key;
        }
    }
    return Object.keys(item).find(key => key.toLowerCase().includes('rate') && !key.toLowerCase().includes('total'));
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
          <div className="flex flex-col sm:flex-row items-center gap-2 mb-4">
            <div className="relative flex-grow w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by Sl. No. or Description..."
                aria-label="Search items"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <ScrollArea className="h-96 border rounded-md">
            <div className="p-1">
              <div className="grid grid-cols-[auto_1fr_3fr_1fr_1fr] items-center px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted">
                <div className="w-[50px] flex justify-center">
                  <Checkbox
                    aria-label="Select all"
                    checked={selectAllState}
                    onCheckedChange={handleSelectAll}
                  />
                </div>
                <button
                  type="button"
                  className="cursor-pointer flex items-center text-left"
                  onClick={() => toggleSort('BOQ SL No')}
                  aria-label="Sort by BOQ Sl No"
                >
                  BOQ Sl.No.
                  {sortKey === 'BOQ SL No' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </button>
                <button
                  type="button"
                  className="cursor-pointer flex items-center text-left"
                  onClick={() => toggleSort('description')}
                  aria-label="Sort by Description"
                >
                  Description
                  {sortKey === 'description' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </button>
                <div className="text-right">Unit Rate</div>
                <div className="text-right">Unit</div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center h-full p-8">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredItems.length > 0 ? (
                filteredItems.map((item) => {
                  const rateKey = findBasicPriceKey(item);
                  const rate = rateKey ? getRateNumber(item[rateKey]) : 0;
                  const rowChecked = selectedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`grid grid-cols-[auto_1fr_3fr_1fr_1fr] items-center p-2 border-b last:border-b-0 cursor-pointer ${
                        rowChecked ? 'bg-muted' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => handleSelectRow(item.id, !rowChecked)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          handleSelectRow(item.id, !rowChecked);
                        }
                      }}
                    >
                      <div className="w-[50px] flex justify-center">
                        <Checkbox
                          aria-label={`Select ${getItemDescription(item) || getBoqSlNo(item)}`}
                          checked={rowChecked}
                          onCheckedChange={(checked) => {
                            handleSelectRow(item.id, Boolean(checked));
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="truncate pr-2">{getBoqSlNo(item)}</div>
                      <div className="truncate pr-2">{getItemDescription(item)}</div>
                      <div className="text-right pr-2">
                        {formatCurrency(rate)}
                      </div>
                      <div className="text-right pr-2">{(item as any).UNIT || (item as any).unit || 'N/A'}</div>
                    </div>
                  );
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
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
          >
            Add {selectedIds.size} Selected Item{selectedIds.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
