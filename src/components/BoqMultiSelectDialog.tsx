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
import type { BillItem, BoqItem } from '@/lib/types';
import { Search, Loader2, ArrowUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import type { CheckedState } from '@radix-ui/react-checkbox';
import { usePathname } from 'next/navigation';

interface BoqMultiSelectDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (selectedItems: BoqItem[]) => void;
  boqItems: BoqItem[];
  alreadyAddedItems?: BillItem[];
}

type SortKey = 'erpSlNo' | 'boqSlNo' | 'description' | 'boqQty' | 'unit' | 'rate';

export function BoqMultiSelectDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  boqItems,
  alreadyAddedItems = [],
}: BoqMultiSelectDialogProps) {
  const { toast } = useToast();
  const pathname = usePathname();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState(''); // debounced
  const [isLoading, setIsLoading] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Filters with Site added
  const [filters, setFilters] = useState<{
    Site: 'all' | string;
    'Scope 1': 'all' | string;
    'Scope 2': 'all' | string;
    'Category 1': 'all' | string;
  }>({
    Site: 'all',
    'Scope 1': 'all',
    'Scope 2': 'all',
    'Category 1': 'all',
  });

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Default "Scope 2 = Civil" when dialog opens at the given path (but only if present in data)
  useEffect(() => {
    if (!isOpen) return;
    const onMadanpurEntryPage = pathname?.startsWith('/billing-recon/madanpur-rampur/jmc/entry');
    if (!onMadanpurEntryPage) return;

    const hasCivil = boqItems.some(
      (i: any) => String(i['Scope 2'] ?? '').toLowerCase() === 'civil'
    );

    if (!hasCivil) return;

    setFilters(prev => {
      // don't override if user already set a specific Scope 2
      if (prev['Scope 2'] !== 'all') return prev;
      return { ...prev, 'Scope 2': 'Civil', 'Category 1': 'all' };
    });
  }, [isOpen, pathname, boqItems]);

  // helpers
  const getRateNumber = (rate: unknown) => {
    if (typeof rate === 'number') return rate;
    const n = Number(typeof rate === 'string' ? rate.replace(/,/g, '').trim() : rate);
    return Number.isFinite(n) ? n : 0;
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0);

  const getNumeric = (v: unknown) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/,/g, '').trim());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const known = ['UNIT PRICE', 'Unit Rate', 'Rate', 'Unit Price', 'UNIT RATE'];
    for (const k of known) if (k in item) return k;
    return Object.keys(item).find(
      (k) => k.toLowerCase().includes('rate') && !k.toLowerCase().includes('total')
    );
  };

  const getSortValue = (item: BoqItem, key: SortKey) => {
    switch (key) {
      case 'erpSlNo':
        return (item as any)['ERP SL NO'] ?? '';
      case 'boqSlNo':
        return (item as any)['BOQ SL No'] ?? (item as any)['SL. No.'] ?? '';
      case 'description':
        return (item as any)['Description'] ?? '';
      case 'boqQty':
        return (item as any)['QTY'] ?? (item as any)['Total Qty'] ?? 0;
      case 'unit':
        return (item as any)['Unit'] ?? (item as any)['UNIT'] ?? '';
      case 'rate': {
        const rateKey = findBasicPriceKey(item);
        return rateKey ? (item as any)[rateKey] : 0;
      }
      default:
        return '';
    }
  };

  // Filter options: Site → Scope 1 → Scope 2 → Category 1
  const filterOptions = useMemo(() => {
    let base = [...boqItems];

    const siteOptions = [...new Set(base.map((i: any) => i['Site']).filter(Boolean))] as string[];

    if (filters.Site !== 'all') {
      base = base.filter((i: any) => i['Site'] === filters.Site);
    }

    const scope1Options = [...new Set(base.map((i: any) => i['Scope 1']).filter(Boolean))] as string[];

    if (filters['Scope 1'] !== 'all') {
      base = base.filter((i: any) => i['Scope 1'] === filters['Scope 1']);
    }

    const scope2Options = [...new Set(base.map((i: any) => i['Scope 2']).filter(Boolean))] as string[];

    if (filters['Scope 2'] !== 'all') {
      base = base.filter((i: any) => i['Scope 2'] === filters['Scope 2']);
    }

    const category1Options = [...new Set(base.map((i: any) => i['Category 1']).filter(Boolean))] as string[];

    return {
      Site: siteOptions,
      'Scope 1': scope1Options,
      'Scope 2': scope2Options,
      'Category 1': category1Options,
    };
  }, [boqItems, filters]);

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value as any };
      // Reset downstream on change
      if (key === 'Site') {
        next['Scope 1'] = 'all';
        next['Scope 2'] = 'all';
        next['Category 1'] = 'all';
      }
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

    let items = boqItems.filter((item: any) => {
      // if (addedItemIds.has(item.id)) return false; // optional

      const siteMatch = filters['Site'] === 'all' || item['Site'] === filters['Site'];
      const scope1Match = filters['Scope 1'] === 'all' || item['Scope 1'] === filters['Scope 1'];
      const scope2Match = filters['Scope 2'] === 'all' || item['Scope 2'] === filters['Scope 2'];
      const category1Match =
        filters['Category 1'] === 'all' || item['Category 1'] === filters['Category 1'];

      if (!(siteMatch && scope1Match && scope2Match && category1Match)) return false;

      if (!q) return true;
      return (
        String(item['ERP SL NO'] ?? '').toLowerCase().includes(q) ||
        String(item['BOQ SL No'] ?? item['SL. No.'] ?? '').toLowerCase().includes(q) ||
        String(item['Description'] ?? '').toLowerCase().includes(q)
      );
    });

    if (sortKey) {
      const dir = sortDirection === 'asc' ? 1 : -1;
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

      items = items
        .map((v, i) => ({ v, i }))
        .sort((a, b) => {
          const A = getSortValue(a.v, sortKey);
          const B = getSortValue(b.v, sortKey);

          let cmp = 0;
          if (sortKey === 'boqQty' || sortKey === 'rate') {
            cmp = (getNumeric(A) - getNumeric(B)) * dir;
          } else {
            cmp = collator.compare(String(A ?? ''), String(B ?? '')) * dir;
          }
          return cmp || (a.i - b.i);
        })
        .map((x) => x.v);
    }

    return items;
  }, [boqItems, searchTerm, filters, sortKey, sortDirection, addedItemIds]);

  // Select-all logic
  const allOnPageSelected =
    filteredItems.length > 0 && filteredItems.every((it: any) => selectedIds.has(it.id));
  const noneSelected = filteredItems.every((it: any) => !selectedIds.has(it.id));
  const selectAllState: CheckedState =
    allOnPageSelected ? true : noneSelected ? false : 'indeterminate';

  const handleSelectAll = (checked: CheckedState) => {
    if (checked) {
      setSelectedIds(new Set(filteredItems.map((i: any) => i.id)));
    } else {
      const next = new Set(selectedIds);
      filteredItems.forEach((i: any) => next.delete(i.id));
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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection((p) => (p === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const handleConfirm = () => {
    const selectedBoqItems = boqItems.filter((item: any) => selectedIds.has(item.id));
    onConfirm(selectedBoqItems);
    onOpenChange(false);
    setSelectedIds(new Set());
    setSearchInput('');
    setSearchTerm('');
  };

  // mimic loading state on open (optional)
  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    const t = setTimeout(() => setIsLoading(false), 150);
    return () => clearTimeout(t);
  }, [isOpen]);

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
                placeholder="Search by Sl. No. or Description..."
                aria-label="Search items"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>

            {(['Site', 'Scope 1', 'Scope 2', 'Category 1'] as const).map((key) => {
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
              <div className="grid grid-cols-[auto_1fr_1fr_3fr_1fr_1fr_1fr] items-center px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted">
                <div className="w-[50px] flex justify-center">
                  <Checkbox
                    aria-label="Select all"
                    checked={selectAllState}
                    onCheckedChange={handleSelectAll}
                  />
                </div>

                <div
                  className="cursor-pointer flex items-center text-left"
                  onClick={() => toggleSort('erpSlNo')}
                  aria-label="Sort by ERP Sl No"
                >
                  ERP Sl. No.
                  {sortKey === 'erpSlNo' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </div>

                <div
                  className="cursor-pointer flex items-center text-left"
                  onClick={() => toggleSort('boqSlNo')}
                  aria-label="Sort by BOQ Sl No"
                >
                  BOQ Sl.No.
                  {sortKey === 'boqSlNo' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </div>

                <div
                  className="cursor-pointer flex items-center text-left"
                  onClick={() => toggleSort('description')}
                  aria-label="Sort by Description"
                >
                  Description
                  {sortKey === 'description' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </div>

                <div
                  className="text-right cursor-pointer flex items-center justify-end"
                  onClick={() => toggleSort('boqQty')}
                  aria-label="Sort by BOQ Qty"
                >
                  BOQ Qty
                  {sortKey === 'boqQty' && <ArrowUpDown className="ml-1 h-3 w-3" />}
                </div>

                <div
                  className="text-right cursor-pointer flex items-center justify-end"
                  onClick={() => toggleSort('unit')}
                  aria-label="Sort by Unit"
                >
                  Unit
                  {sortKey === 'unit' && <ArrowUpDown className="ml-1 h-3 w-3" />}
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
                filteredItems.map((item: any) => {
                  const rowChecked = selectedIds.has(item.id);
                  const rateKey = findBasicPriceKey(item);
                  const rate = rateKey ? item[rateKey] : 0;
                  return (
                    <div
                      key={item.id}
                      className={`grid grid-cols-[auto_1fr_1fr_3fr_1fr_1fr_1fr] items-center p-2 border-b last:border-b-0 cursor-pointer ${
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
                          aria-label={`Select ${String(
                            item['Description'] ?? item['BOQ SL No'] ?? item['SL. No.'] ?? ''
                          )}`}
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
                      <div className="text-right pr-2">{item['QTY'] || item['Total Qty']}</div>
                      <div className="text-right pr-2">{item['Unit']}</div>
                      <div className="text-right pr-2">{formatCurrency(getRateNumber(rate))}</div>
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
          <Button type="button" onClick={handleConfirm} disabled={selectedIds.size === 0}>
            Add {selectedIds.size} Selected Item{selectedIds.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
