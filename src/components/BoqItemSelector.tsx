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
import { ScrollArea } from './ui/scroll-area';

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
          {selectedItem ? getBoqSlNo(selectedItem) : 'Select BOQ Item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[700px] p-0 z-[99999] pointer-events-auto"
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
              <div className="grid grid-cols-[1fr_1fr_3fr_1fr_1fr] items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b">
                <button
                  type="button"
                  onClick={toggleSort}
                  className="flex items-center gap-1 cursor-pointer select-none text-left"
                  title="Sort by ERP SL No"
                >
                  ERP SL No
                  <ArrowUpDown className={cn('h-3 w-3 transition-transform', sortDirection === 'desc' && 'rotate-180')} />
                </button>
                <div className="text-left">BOQ SL No</div>
                <div className="text-left">Description</div>
                <div className="text-right">QTY</div>
                <div className="text-right">Rate</div>
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
                    onSelect={(id) => commitSelect(id)} // keyboard path still works
                    className={cn('p-0', isSelected && 'bg-accent text-accent-foreground')}
                    aria-selected={isSelected}
                    asChild
                  >
                    {/* Render a real button so the cursor is a hand and clicks always work */}
                    <button
                      type="button"
                      className="w-full px-2 py-2 cursor-pointer pointer-events-auto"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); commitSelect(item.id); }}
                      onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); commitSelect(item.id); }}
                    >
                      <div className="grid grid-cols-[1fr_1fr_3fr_1fr_1fr] w-full items-center gap-2">
                        <div className="text-sm flex items-center gap-2">
                          {isSelected && <Check className="h-4 w-4 text-primary" />}
                          {erpSlNo}
                        </div>
                        <div className="text-sm">{boqSlNo}</div>
                        <div className="text-sm font-medium truncate pr-2">{description}</div>
                        <div className="text-right text-sm">{boqQty}</div>
                        <div className="text-right text-xs text-muted-foreground">
                          {rate} {unit && `/ ${unit}`}
                        </div>
                      </div>
                    </button>
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