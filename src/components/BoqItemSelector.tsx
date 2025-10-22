
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
  const [currentValue, setCurrentValue] = React.useState(selectedSlNo || '');

  React.useEffect(() => {
    setCurrentValue(selectedSlNo || '');
  }, [selectedSlNo]);

  const getItemDescription = (item: BoqItem): string => {
    const possibleKeys = ['Description'];
    for (const key of possibleKeys) {
      if (item[key]) return String(item[key]);
    }
    const fallbackKey = Object.keys(item).find(k =>
      k.toLowerCase().includes('description')
    );
    return fallbackKey ? String(item[fallbackKey]) : '';
  };
  
  const getBoqSlNo = (item: BoqItem): string => {
    return String(item['BOQ SL No'] || item['SL. No.'] || '');
  };
  
  const getErpSlNo = (item: BoqItem): string => {
    return String(item['ERP SL NO'] || '');
  }

  const getBoqQty = (item: BoqItem): string => {
    return String(item['QTY'] || item['Total Qty'] || '0');
  }

  const selectedItem = boqItems.find(item => getBoqSlNo(item) === currentValue);

  const findRateKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    const specificKey = 'Unit Rate';
    if (keys.includes(specificKey)) return specificKey;
    return keys.find(
      key => key.toLowerCase().includes('rate') && !key.toLowerCase().includes('total')
    );
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
          {currentValue && selectedItem
            ? `${getBoqSlNo(selectedItem)}`
            : 'Select BOQ Item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[700px] p-0">
        <Command
          filter={(value, search) => {
            const item = boqItems.find(i => getBoqSlNo(i) === value);
            if (!item) return 0;
            const boqSlNo = getBoqSlNo(item).toLowerCase();
            const erpSlNo = getErpSlNo(item).toLowerCase();
            const desc = getItemDescription(item).toLowerCase();
            const searchTerm = search.toLowerCase();
            return boqSlNo.includes(searchTerm) || erpSlNo.includes(searchTerm) || desc.includes(searchTerm) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search by BOQ SL No, ERP SL No or Description..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No BOQ item found.'}
            </CommandEmpty>

            <CommandGroup>
              <div className="grid grid-cols-[1fr_1fr_3fr_1fr_1fr] items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b">
                <div className="text-left">ERP SL No</div>
                <div className="text-left">BOQ SL No</div>
                <div className="text-left">Description</div>
                <div className="text-right">QTY</div>
                <div className="text-right">Rate</div>
              </div>

              <ScrollArea className="h-72">
                {boqItems.map(item => {
                  const rateKey = findRateKey(item);
                  const rate = rateKey ? item[rateKey] : 'N/A';
                  const boqSlNo = getBoqSlNo(item);
                  const erpSlNo = getErpSlNo(item);
                  const description = getItemDescription(item);
                  const isSelected = currentValue === boqSlNo;
                  const unit = item['Unit'] || item['Units'] || item['UNIT'] || '';
                  const boqQty = getBoqQty(item);

                  return (
                    <CommandItem
                      key={item.id}
                      value={boqSlNo}
                      onSelect={(value) => {
                        const selected = boqItems.find(
                          i => getBoqSlNo(i).toLowerCase() === value.toLowerCase()
                        );
                        onSelect(selected || null);
                        setCurrentValue(selected ? getBoqSlNo(selected) : '');
                        setOpen(false);
                      }}
                      className={cn(
                        'p-2 cursor-pointer',
                        isSelected && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <div className="grid grid-cols-[1fr_1fr_3fr_1fr_1fr] w-full items-center gap-2">
                        <div className="text-sm flex items-center gap-2">
                          {isSelected && <Check className="h-4 w-4 text-primary" />}
                          {erpSlNo}
                        </div>
                        <div className="text-sm">{boqSlNo}</div>
                        <div className="text-sm font-medium truncate pr-2">
                          {description}
                        </div>
                        <div className="text-right text-sm">
                          {boqQty}
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          {rate} {unit && `/ ${unit}`}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </ScrollArea>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
