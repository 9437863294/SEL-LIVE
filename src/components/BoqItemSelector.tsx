
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

  // ✅ Field helpers
  const getItemDescription = (item: BoqItem): string => {
    const possibleKeys = ['Description', 'Item Description'];
    for (const key of possibleKeys) {
      if (item[key]) return String(item[key]);
    }
    const fallbackKey = Object.keys(item).find(k =>
      k.toLowerCase().includes('description')
    );
    return fallbackKey ? String(item[fallbackKey]) : '';
  };

  const getSlNo = (item: BoqItem): string => {
    return String(item['BOQ SL No'] || item['ERP SL NO'] || '');
  };

  const selectedItem = boqItems.find(item => getSlNo(item) === currentValue);

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
            ? `${getSlNo(selectedItem)}: ${getItemDescription(selectedItem).substring(0, 25)}...`
            : 'Select BOQ Item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[520px] p-0">
        <Command
          filter={(value, search) => {
            const item = boqItems.find(i => getSlNo(i) === value);
            if (!item) return 0;
            const slNo = getSlNo(item).toLowerCase();
            const desc = getItemDescription(item).toLowerCase();
            const searchTerm = search.toLowerCase();
            return slNo.includes(searchTerm) || desc.includes(searchTerm) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search by BOQ SL No or Description..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No BOQ item found.'}
            </CommandEmpty>

            <CommandGroup>
              {/* Header */}
              <div className="grid grid-cols-[1fr_3fr_1fr] items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b">
                <div className="text-left">BOQ SL No</div>
                <div className="text-left">Description</div>
                <div className="text-right">Rate</div>
              </div>

              <ScrollArea className="h-72">
                {boqItems.map(item => {
                  const rateKey = findRateKey(item);
                  const rate = rateKey ? item[rateKey] : 'N/A';
                  const slNo = getSlNo(item);
                  const description = getItemDescription(item);
                  const isSelected = currentValue === slNo;
                  const unit = item['Unit'] || item['Units'] || item['UNIT'] || '';

                  return (
                    <CommandItem
                      key={item.id}
                      value={slNo}
                      onSelect={(value) => {
                        const selected = boqItems.find(
                          i => getSlNo(i).toLowerCase() === value.toLowerCase()
                        );
                        onSelect(selected || null);
                        setCurrentValue(selected ? getSlNo(selected) : '');
                        setOpen(false);
                      }}
                      className={cn(
                        'p-2 cursor-pointer',
                        isSelected && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <div className="grid grid-cols-[1fr_3fr_1fr] w-full items-center gap-2">
                        <div className="text-sm flex items-center gap-2">
                          {isSelected && <Check className="h-4 w-4 text-primary" />}
                          {slNo}
                        </div>
                        <div className="text-sm font-medium truncate pr-2">
                          {description}
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
