'use client';

import * as React from 'react';
import { Check, Search } from 'lucide-react';
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
  /** currently selected BOQ SL No (not id) */
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

  const getItemDescription = (item: BoqItem): string => {
    if (item['Description']) return String(item['Description']);
    const k = Object.keys(item).find((x) => x.toLowerCase().includes('description'));
    return k ? String(item[k]) : '';
  };
  const getBoqSlNo = (item: BoqItem) => String(item['BOQ SL No'] ?? item['SL. No.'] ?? '');
  const getErpSlNo = (item: BoqItem) => String(item['ERP SL NO'] ?? '');
  const getBoqQty  = (item: BoqItem) => String(item['QTY'] ?? item['Total Qty'] ?? '0');
  const findRateKey = (item: BoqItem) => {
    if ('Unit Rate' in item) return 'Unit Rate';
    return Object.keys(item).find(k => k.toLowerCase().includes('rate') && !k.toLowerCase().includes('total'));
  };

  // keep internal id in sync with external selectedSlNo
  React.useEffect(() => {
    if (!selectedSlNo) return setCurrentId('');
    const match = boqItems.find(i => getBoqSlNo(i).toLowerCase() === selectedSlNo.toLowerCase());
    setCurrentId(match?.id ?? '');
  }, [selectedSlNo, boqItems]);

  const selectedItem = React.useMemo(
    () => boqItems.find(i => i.id === currentId) ?? null,
    [boqItems, currentId]
  );

  const commitSelect = (id: string) => {
    const selected = boqItems.find(i => i.id === id) ?? null;
    onSelect(selected);
    setCurrentId(selected ? selected.id : '');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedItem ? getBoqSlNo(selectedItem) : 'Select BOQ Item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      {/* z-index + fixed strategy + pointer events to beat overlays/sticky/transform parents */}
      <PopoverContent
        className="w-[700px] p-0 z-[1000] pointer-events-auto"
        side="bottom"
        align="start"
        sideOffset={4}
        // @ts-ignore shadcn popover supports strategy via Radix
        strategy="fixed"
      >
        <Command>
          <CommandInput placeholder="Search by BOQ SL No, ERP SL No or Description..." />
          {/* CommandList MUST be the scroll container */}
          <CommandList className="max-h-72 overflow-y-auto">
            <CommandEmpty>{isLoading ? 'Loading...' : 'No BOQ item found.'}</CommandEmpty>

            <CommandGroup>
              <div className="grid grid-cols-[1fr_1fr_3fr_1fr_1fr] items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b">
                <div className="text-left">ERP SL No</div>
                <div className="text-left">BOQ SL No</div>
                <div className="text-left">Description</div>
                <div className="text-right">QTY</div>
                <div className="text-right">Rate</div>
              </div>

              {boqItems.map((item) => {
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
                    value={item.id}  // unique value for reliability
                    keywords={[boqSlNo, erpSlNo, description, String(boqQty), String(rate ?? '')].filter(Boolean)}
                    onSelect={(id) => commitSelect(id)} // keyboard path
                    // 🔑 force mouse/touch selection before focus changes
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      commitSelect(item.id);
                    }}
                    className={cn(
                      'p-2 cursor-pointer',
                      isSelected && 'bg-accent text-accent-foreground'
                    )}
                    aria-selected={isSelected}
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
