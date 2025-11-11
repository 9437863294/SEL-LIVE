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
import type { JmcEntry, JmcItem, Bill, BillItem, BoqItem, Project } from '@/lib/types';
import { Search, Loader2, ArrowUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CheckedState } from '@radix-ui/react-checkbox';

interface BoqMultiSelectDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (selectedItems: BoqItem[]) => void;
  boqItems: BoqItem[];
  alreadyAddedItems?: BillItem[];
  projectId?: string;
}

/* Utility to avoid TS2783 (`id` duplicated when spreading Firestore data) */
function stripId<T extends object>(obj: T & { id?: any }): Omit<T, 'id'> {
  const { id: _ignored, ...rest } = obj as any;
  return rest as Omit<T, 'id'>;
}

export function BoqMultiSelectDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  boqItems,
  alreadyAddedItems = [],
  projectId,
}: BoqMultiSelectDialogProps) {
  const { toast } = useToast();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState(''); // debounced
  const [isLoading, setIsLoading] = useState(false);

  // ✅ Default sort is always ERP SL NO when dialog opens
  const [sortKey, setSortKey] =
    useState<'erpSlNo' | 'boqSlNo' | 'description' | 'qty' | 'rate' | null>('erpSlNo');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (isOpen) {
      setSortKey('erpSlNo');
      setSortDirection('asc');
    }
  }, [isOpen]);

  const [filters, setFilters] = useState<{
    'Scope 1': 'all' | string;
    'Scope 2': 'all' | string;
    'Category 1': 'all' | string;
  }>({
    'Scope 1': 'all',
    'Scope 2': 'all',
    'Category 1': 'all',
  });

  // Debounce search input -> searchTerm
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const getRateNumber = (rate: unknown) => {
    if (typeof rate === 'number') return rate;
    const n = Number(rate);
    return Number.isFinite(n) ? n : 0;
  };

  const getSlNo = (item: BoqItem): string => {
    return String((item as any)['BOQ SL No'] ?? (item as any)['SL. No.'] ?? (item as any)['SL No'] ?? '');
  };

  const getErpSlNo = (item: BoqItem): string => {
    return String((item as any)['ERP SL NO'] ?? (item as any)['ERP Sl No'] ?? '');
  };

  const getItemDescription = (item: BoqItem): string => {
    return String((item as any)['Description'] ?? '');
  };

  const getBoqQty = (item: BoqItem): string => {
    return String((item as any)['QTY'] ?? (item as any)['Total Qty'] ?? '0');
  };

  const getUnit = (item: BoqItem): string => {
    return String((item as any)['UNIT'] ?? (item as any)['Unit'] ?? '');
  };

  const findRateKey = (item: BoqItem): string | undefined => {
    const specificKeys = ['Unit Rate', 'UNIT PRICE'];
    for (const key of specificKeys) {
      if (key in item) return key;
    }
    return Object.keys(item).find(
      (k) => k.toLowerCase().includes('rate') && !k.toLowerCase().includes('total'),
    );
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0);

  // Cascading filter options
  const filterOptions = useMemo(() => {
    let base = [...boqItems];

    const scope1Options = [...new Set(base.map((i) => (i as any)['Scope 1']).filter(Boolean))] as string[];

    if (filters['Scope 1'] !== 'all') {
      base = base.filter((i) => (i as any)['Scope 1'] === filters['Scope 1']);
    }

    const scope2Options = [...new Set(base.map((i) => (i as any)['Scope 2']).filter(Boolean))] as string[];

    if (filters['Scope 2'] !== 'all') {
      base = base.filter((i) => (i as any)['Scope 2'] === filters['Scope 2']);
    }

    const category1Options = [
      ...new Set(base.map((i) => (i as any)['Category 1']).filter(Boolean)),
    ] as string[];

    return {
      'Scope 1': scope1Options,
      'Scope 2': scope2Options,
      'Category 1': category1Options,
    };
  }, [boqItems, filters]);

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
    () => new Set(alreadyAddedItems.map((it: BillItem) => (it as any).jmcItemId)),
    [alreadyAddedItems],
  );

  const filteredItems = useMemo(() => {
    const q = searchTerm.toLowerCase();

    let items = boqItems.filter((item: BoqItem) => {
      if (addedItemIds.has((item as any).id)) return false;

      const scope1Match = filters['Scope 1'] === 'all' || (item as any)['Scope 1'] === filters['Scope 1'];
      const scope2Match = filters['Scope 2'] === 'all' || (item as any)['Scope 2'] === filters['Scope 2'];
      const category1Match = filters['Category 1'] === 'all' || (item as any)['Category 1'] === filters['Category 1'];

      if (!(scope1Match && scope2Match && category1Match)) return false;

      if (!q) return true;
      return (
        getSlNo(item).toLowerCase().includes(q) ||
        getErpSlNo(item).toLowerCase().includes(q) ||
        getItemDescription(item).toLowerCase().includes(q)
      );
    });

    // Sorting (default ERP SL NO asc; with ERP as stable tiebreaker)
    const dir = sortDirection === 'asc' ? 1 : -1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    items.sort((a: BoqItem, b: BoqItem) => {
      const erpA = getErpSlNo(a);
      const erpB = getErpSlNo(b);

      const compareByKey = () => {
        switch (sortKey) {
          case 'erpSlNo':
            return collator.compare(erpA, erpB);
          case 'boqSlNo':
            return collator.compare(getSlNo(a), getSlNo(b));
          case 'description':
            return collator.compare(getItemDescription(a), getItemDescription(b));
          case 'qty':
            return collator.compare(getBoqQty(a), getBoqQty(b));
          case 'rate': {
            const rateKeyA = findRateKey(a);
            const rateKeyB = findRateKey(b);
            const ra = getRateNumber(rateKeyA ? (a as any)[rateKeyA] : 0);
            const rb = getRateNumber(rateKeyB ? (b as any)[rateKeyB] : 0);
            return ra === rb ? 0 : ra < rb ? -1 : 1;
          }
          default:
            // no sortKey? default to ERP SL NO
            return collator.compare(erpA, erpB);
        }
      };

      let cmp = compareByKey();
      if (cmp === 0) {
        // stable tiebreaker by ERP SL NO
        cmp = collator.compare(erpA, erpB);
      }
      return cmp * dir;
    });

    return items;
  }, [boqItems, searchTerm, filters, sortKey, sortDirection, addedItemIds]);

  // Select-all logic
  const allOnPageSelected =
    filteredItems.length > 0 && filteredItems.every((it: BoqItem) => selectedIds.has((it as any).id));
  const noneSelected = filteredItems.every((it: BoqItem) => !selectedIds.has((it as any).id));
  const selectAllState: CheckedState =
    allOnPageSelected ? true : noneSelected ? false : 'indeterminate';

  const handleSelectAll = (checked: CheckedState) => {
    setSelectedIds(new Set(checked ? filteredItems.map((i: BoqItem) => (i as any).id) : []));
  };

  const handleSelectRow = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSort = (key: 'erpSlNo' | 'boqSlNo' | 'description' | 'qty' | 'rate') => {
    if (sortKey === key) {
      setSortDirection((p) => (p === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const handleConfirm = () => {
    const selectedBoqItems = boqItems.filter((item: BoqItem) => selectedIds.has((item as any).id));
    onConfirm(selectedBoqItems);
    onOpenChange(false);
    setSelectedIds(new Set());
    setSearchInput('');
    setSearchTerm('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Select BOQ Items</DialogTitle>
          <DialogDescription>
            Filter by Site / Scope and select multiple BOQ items to add.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex flex-col sm:flex-row items-center gap-2 mb-4">
            <div className="relative flex-grow w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
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
                    {options.map((opt: string) => (
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
              <div className="grid grid-cols-[auto_1fr_1fr_3fr_1fr_1fr_1fr] items-center px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted">
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
                  onClick={() => toggleSort('erpSlNo')}
                >
                  ERP Sl. No.
                  {sortKey === 'erpSlNo' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </button>
                <button
                  type="button"
                  className="cursor-pointer flex items-center text-left"
                  onClick={() => toggleSort('boqSlNo')}
                >
                  BOQ Sl.No.
                  {sortKey === 'boqSlNo' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </button>
                <button
                  type="button"
                  className="cursor-pointer flex items-center text-left"
                  onClick={() => toggleSort('description')}
                >
                  Description
                  {sortKey === 'description' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </button>
                <button
                  type="button"
                  className="text-right cursor-pointer flex items-center justify-end"
                  onClick={() => toggleSort('qty')}
                >
                  BOQ Qty
                  {sortKey === 'qty' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </button>
                <div className="text-left">Unit</div>
                <button
                  type="button"
                  className="text-right cursor-pointer flex items-center justify-end"
                  onClick={() => toggleSort('rate')}
                >
                  Unit Rate
                  {sortKey === 'rate' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </button>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center h-full p-8">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredItems.length > 0 ? (
                filteredItems.map((item: BoqItem) => {
                  const rowChecked = selectedIds.has((item as any).id);
                  const rateKey = findRateKey(item);
                  const rate = rateKey ? (item as any)[rateKey] : 0;

                  return (
                    <div
                      key={(item as any).id}
                      className={`grid grid-cols-[auto_1fr_1fr_3fr_1fr_1fr_1fr] items-center p-2 border-b last:border-b-0 cursor-pointer ${
                        rowChecked ? 'bg-muted' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => handleSelectRow((item as any).id, !rowChecked)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          handleSelectRow((item as any).id, !rowChecked);
                        }
                      }}
                    >
                      <div className="w-[50px] flex justify-center">
                        <Checkbox
                          aria-label={`Select ${getItemDescription(item)}`}
                          checked={rowChecked}
                          onCheckedChange={(checked) => {
                            // Avoid double-toggle from parent onClick
                            handleSelectRow((item as any).id, Boolean(checked));
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="truncate pr-2">{getErpSlNo(item)}</div>
                      <div className="truncate pr-2">{getSlNo(item)}</div>
                      <div className="truncate pr-2">{getItemDescription(item)}</div>
                      <div className="text-right pr-2">{getBoqQty(item)}</div>
                      <div className="truncate pr-2">{getUnit(item)}</div>
                      <div className="text-right pr-2">{formatCurrency(getRateNumber(rate))}</div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center p-8 text-muted-foreground">No available items found.</div>
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
          <Button type="button" onClick={handleConfirm} disabled={selectedIds.size === 0}>
            Add {selectedIds.size} Selected Item{selectedIds.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
