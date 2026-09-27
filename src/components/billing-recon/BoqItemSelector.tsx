
'use client';

import * as React from 'react';
import { Check, Search, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandGroup,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { BoqItem } from '@/lib/types';

interface BoqItemSelectorProps {
  boqItems: BoqItem[];
  selectedSlNo: string | null;
  onSelect?: (item: BoqItem | null) => void;
  isLoading: boolean;
}

export function BoqItemSelector({
  boqItems,
  selectedSlNo,
  onSelect = () => {},
  isLoading,
}: BoqItemSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [currentId, setCurrentId] = React.useState<string>('');
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');

  const toggleSort = () => setSortDirection(p => (p === 'asc' ? 'desc' : 'asc'));

  const getItemDescription = (item: BoqItem): string => {
    if (item['Description']) return String(item['Description']);
    const k = Object.keys(item).find(x => x.toLowerCase().includes('description'));
    return k ? String(item[k]) : '';
  };
  const getBoqSlNo = (item: BoqItem) => String(item['BOQ SL No'] ?? item['SL. No.'] ?? '');
  const getErpSlNo = (item: BoqItem) => String(item['ERP SL NO'] ?? '');
  const getBoqQty  = (item: BoqItem) => String(item['QTY'] ?? item['Total Qty'] ?? '0');
  const findRateKey = (item: BoqItem) => {
    if ('Unit Rate' in item) return 'Unit Rate';
    return Object.keys(item).find(k => k.toLowerCase().includes('rate') && !k.toLowerCase().includes('total'));
  };

  React.useEffect(() => {
    if (!selectedSlNo) { setCurrentId(''); return; }
    const match = boqItems.find(i => getBoqSlNo(i).toLowerCase() === selectedSlNo.toLowerCase());
    setCurrentId(match?.id ?? '');
  }, [selectedSlNo, boqItems]);

  const selectedItem = React.useMemo(
    () => boqItems.find(i => i.id === currentId) ?? null,
    [boqItems, currentId]
  );

  const sortedItems = React.useMemo(() => {
    const list = [...boqItems];
    const dir = sortDirection === 'asc' ? 1 : -1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return list.sort((a, b) => collator.compare(getErpSlNo(a), getErpSlNo(b)) * dir);
  }, [boqItems, sortDirection]);

  const commitSelect = (id: string) => {
    const selected = boqItems.find(i => i.id === id) ?? null;
    onSelect(selected);
    setCurrentId(selected ? selected.id : '');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
          <span className="truncate">{selectedItem ? getBoqSlNo(selectedItem) : 'Select BOQ Item...'}</span>
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      {/* Capped to the viewport so a phone does not get a 700px panel hanging off its edge. */}
      <PopoverContent
        className="w-[min(700px,calc(100vw_-_1.5rem))] p-0 z-[99999]"
        side="bottom"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandInput placeholder="Search by BOQ SL No, ERP SL No or Description..." />
          <CommandList className="max-h-72 overflow-y-auto">
            <CommandEmpty>{isLoading ? 'Loading...' : 'No BOQ item found.'}</CommandEmpty>

            <CommandGroup>
              {/* On a phone the rows stack into labelled lines, so only the sort control is kept here. */}
              <div className="flex items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b sm:grid sm:grid-cols-[1fr_1fr_3fr_1fr_1fr]">
                <button
                  type="button"
                  onClick={toggleSort}
                  className="flex items-center gap-1 cursor-pointer select-none text-left"
                  title="Sort by ERP SL No"
                >
                  ERP SL No
                  <ArrowUpDown className={cn('h-3 w-3 transition-transform', sortDirection === 'desc' && 'rotate-180')} />
                </button>
                <div className="hidden text-left sm:block">BOQ SL No</div>
                <div className="hidden text-left sm:block">Description</div>
                <div className="hidden text-right sm:block">QTY</div>
                <div className="hidden text-right sm:block">Rate</div>
              </div>

              {sortedItems.map((item) => {
                const rateKey = findRateKey(item);
                const rate = rateKey ? (item as any)[rateKey] : 'N/A';
                const boqSlNo = getBoqSlNo(item);
                const erpSlNo = getErpSlNo(item);
                const description = getItemDescription(item);
                const unit = (item as any)['Unit'] || (item as any)['Units'] || (item as any)['UNIT'] || '';
                const boqQty = getBoqQty(item);
                const isSelected = currentId === item.id;

                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    keywords={[boqSlNo, erpSlNo, description, String(boqQty), String(rate ?? '')].filter(Boolean)}
                    onSelect={(id) => commitSelect(id)}
                    className={cn('px-2 py-2', isSelected && 'bg-accent text-accent-foreground')}
                  >
                    {/* Phone: ERP | BOQ, then the description across, then QTY | rate. */}
                    <div className="grid w-full grid-cols-2 items-center gap-x-2 gap-y-0.5 sm:grid-cols-[1fr_1fr_3fr_1fr_1fr] sm:gap-2">
                      <div className="text-sm flex items-center gap-2">
                        {isSelected && <Check className="h-4 w-4 text-primary" />}
                        <span className="text-xs text-muted-foreground sm:hidden">ERP</span>
                        {erpSlNo}
                      </div>
                      <div className="text-sm max-sm:text-right">
                        <span className="text-xs text-muted-foreground sm:hidden">BOQ </span>
                        {boqSlNo}
                      </div>
                      <div className="col-span-2 text-sm font-medium truncate pr-2 sm:col-span-1">{description}</div>
                      <div className="text-sm sm:text-right">
                        <span className="text-xs text-muted-foreground sm:hidden">QTY </span>
                        {boqQty}
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        {rate} {unit && `/ ${unit}`}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
