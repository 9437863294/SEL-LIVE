
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
  alreadyAddedItems?: BillItem[];
}

type JmcItemWithDetails = JmcItem & {
  id: string;
  jmcEntryId: string;
  jmcNo: string;
  billedQty: number;
  availableQty: number;
  ['Scope 1']?: string;
  ['Scope 2']?: string;
  ['Category 1']?: string;
};

export function BoqMultiSelectDialog({ isOpen, onOpenChange, onConfirm, boqItems, alreadyAddedItems = [] }: BoqMultiSelectDialogProps) {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState(''); // debounced
  const [jmcItems, setJmcItems] = useState<JmcItemWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sortKey, setSortKey] =
    useState<'jmcNo' | 'boqSlNo' | 'availableQty' | 'rate' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [filters, setFilters] = useState<{
    'Scope 1': 'all' | string;
    'Scope 2': 'all' | string;
    'Category 1': 'all' | string;
  }>({
    'Scope 1': 'all',
    'Scope 2': 'all',
    'Category 1': 'all',
  });

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!isOpen || !projectSlug) return;

    const fetchJmcAndBillData = async () => {
      setIsLoading(true);
      try {
        const jmcCollectionRef = collection(db, 'projects', projectSlug, 'jmcEntries');
        const billsCollectionRef = collection(db, 'projects', projectSlug, 'bills');
        
        const [jmcSnapshot, billsSnapshot] = await Promise.all([
          getDocs(jmcCollectionRef),
          getDocs(billsCollectionRef),
        ]);

        const allJmcEntries = jmcSnapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as JmcEntry)
        );
        const allBills = billsSnapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as Bill)
        );

        // Accumulate billed quantities keyed by our synthetic item id
        const billedQuantities: Record<string, number> = {};
        allBills.forEach((bill) => {
          (bill.items ?? []).forEach((it) => {
            const k = it.jmcItemId;
            const inc = Number.parseFloat(it.billedQty || '0') || 0;
            billedQuantities[k] = (billedQuantities[k] || 0) + inc;
          });
        });

        const processed: JmcItemWithDetails[] = [];
        allJmcEntries.forEach((entry) => {
          (entry.items ?? []).forEach((item, index) => {
            const jmcItemId = `${entry.id}-${index}`;
            const executedQty = Number.parseFloat((item as any).executedQty ?? '0') || 0;
            const billedQty = billedQuantities[jmcItemId] || 0;
            const availableQty = executedQty - billedQty;

            if (availableQty > 0) {
              processed.push({
                ...(item as JmcItem),
                id: jmcItemId,
                jmcEntryId: entry.id,
                jmcNo: String((entry as any).jmcNo ?? ''),
                billedQty,
                availableQty,
              });
            }
          });
        });

        setJmcItems(processed);
      } catch (error) {
        console.error('Error fetching data for item selection:', error);
        toast({
          title: 'Error',
          description: 'Could not load available JMC items for this project.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchJmcAndBillData();
  }, [isOpen, projectSlug, toast]);

  // Helpers
  const getRateNumber = (rate: unknown) => {
    if (typeof rate === 'number') return rate;
    const n = Number(rate);
    return Number.isFinite(n) ? n : 0;
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0);

  // Cascading filter options
  const filterOptions = useMemo(() => {
    let base = [...jmcItems];

    const scope1Options = [...new Set(base.map((i) => i['Scope 1']).filter(Boolean))] as string[];

    if (filters['Scope 1'] !== 'all') {
      base = base.filter((i) => i['Scope 1'] === filters['Scope 1']);
    }

    const scope2Options = [...new Set(base.map((i) => i['Scope 2']).filter(Boolean))] as string[];

    if (filters['Scope 2'] !== 'all') {
      base = base.filter((i) => i['Scope 2'] === filters['Scope 2']);
    }

    const category1Options = [
      ...new Set(base.map((i) => i['Category 1']).filter(Boolean)),
    ] as string[];

    return {
      'Scope 1': scope1Options,
      'Scope 2': scope2Options,
      'Category 1': category1Options,
    };
  }, [jmcItems, filters]);

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'Scope 1') {
        next['Scope 2'] = 'all';
        next['Category 1'] = 'all';
      }
      if (key === 'Scope 2') {
        next['Category 1'] = 'all';
      }
      return next;
    });
    setSelectedIds(new Set());
  };

  const addedItemIds = useMemo(
    () => new Set(alreadyAddedItems.map((it) => it.jmcItemId)),
    [alreadyAddedItems]
  );

  const filteredItems = useMemo(() => {
    const q = searchTerm.toLowerCase();

    let items = boqItems.filter((item) => {
      // if (addedItemIds.has(item.id)) return false;

      const scope1Match = filters['Scope 1'] === 'all' || item['Scope 1'] === filters['Scope 1'];
      const scope2Match = filters['Scope 2'] === 'all' || item['Scope 2'] === filters['Scope 2'];
      const category1Match =
        filters['Category 1'] === 'all' || item['Category 1'] === filters['Category 1'];

      if (!(scope1Match && scope2Match && category1Match)) return false;

      if (!q) return true;
      return (
        item.jmcNo?.toLowerCase().includes(q) ||
        (item as any).boqSlNo?.toLowerCase?.().includes(q) || // if present on JmcItem
        (item as any).description?.toLowerCase?.().includes(q)
      );
    });

    if (sortKey) {
      const dir = sortDirection === 'asc' ? 1 : -1;
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

      items = items
        .map((v, i) => ({ v, i })) // stable
        .sort((a, b) => {
          const A = a.v;
          const B = b.v;

          let cmp = 0;
          if (sortKey === 'availableQty') {
            cmp = ((A.availableQty ?? 0) - (B.availableQty ?? 0)) * dir;
          } else if (sortKey === 'rate') {
            // rate lives on JmcItem (string | number). We normalize.
            cmp = (getRateNumber((A as any).rate) - getRateNumber((B as any).rate)) * dir;
          } else {
            cmp =
              collator.compare(String((A as any)[sortKey] ?? ''), String((B as any)[sortKey] ?? '')) *
              dir;
          }

          return cmp || a.i - b.i;
        })
        .map((x) => x.v);
    }

    return items;
  }, [boqItems, searchTerm, filters, sortKey, sortDirection, addedItemIds]);

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

  const toggleSort = (key: 'jmcNo' | 'boqSlNo' | 'availableQty' | 'rate') => {
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

            {(['Scope 1', 'Scope 2', 'Category 1'] as const).map((key) => {
              const options = filterOptions[key];
              if (!options || options.length === 0) return null;
              return (
                <Select
                  key={key}
                  value={filters[key]}
                  onValueChange={(v) => handleFilterChange(key, v)}
                >
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder={`Filter by ${key}`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All {key}s</SelectItem>
                    {options.map((opt) => (
                      <SelectItem key={`${key}-${opt}`} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            })}
          </div>

          <ScrollArea className="h-96 border rounded-md">
            <div className="p-1">
              <div className="grid grid-cols-[auto_1fr_1fr_3fr_1fr_1fr] items-center px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted">
                <div className="w-[50px] flex justify-center">
                  <Checkbox
                    aria-label="Select all"
                    checked={selectAllState}
                    onCheckedChange={handleSelectAll}
                  />
                </div>

                <div
                  className="cursor-pointer flex items-center text-left"
                  onClick={() => toggleSort('jmcNo')}
                  aria-label="Sort by ERP Sl No"
                >
                  ERP Sl. No.
                  {sortKey === 'jmcNo' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </div>

                <div
                  className="cursor-pointer flex items-center text-left"
                  onClick={() => toggleSort('boqSlNo')}
                  aria-label="Sort by BOQ Sl No"
                >
                  BOQ Sl.No.
                  {sortKey === 'boqSlNo' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </div>

                <div>Description</div>

                <div
                  className="text-right cursor-pointer flex items-center justify-end"
                  onClick={() => toggleSort('availableQty')}
                  aria-label="Sort by Available Qty"
                >
                  Unit
                  {sortKey === 'availableQty' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </div>

                <div
                  className="text-right cursor-pointer flex items-center justify-end"
                  onClick={() => toggleSort('rate')}
                  aria-label="Sort by Unit Rate"
                >
                  Unit Rate
                  {sortKey === 'rate' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center h-full p-8">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredItems.length > 0 ? (
                filteredItems.map((item) => {
                  const rowChecked = selectedIds.has(item.id);
                  const rateKey = findBasicPriceKey(item);
                  const rate = rateKey ? item[rateKey] : 0;
                  return (
                    <div
                      key={item.id}
                      className={`grid grid-cols-[auto_1fr_1fr_3fr_1fr_1fr] items-center p-2 border-b last:border-b-0 cursor-pointer ${
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
                          aria-label={`Select ${String((item as any).description ?? (item as any).boqSlNo ?? item.jmcNo)}`}
                          checked={rowChecked}
                          onCheckedChange={(checked) => {
                            // Avoid double-toggle from parent onClick
                            handleSelectRow(item.id, Boolean(checked));
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="truncate pr-2">{item['ERP SL NO']}</div>
                      <div className="truncate pr-2">{item['BOQ SL No'] || item['SL. No.']}</div>
                      <div className="truncate pr-2">{item['Description']}</div>
                      <div className="text-right pr-2">{item['UNIT']}</div>
                      <div className="text-right pr-2">
                        {formatCurrency(getRateNumber(rate))}
                      </div>
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
