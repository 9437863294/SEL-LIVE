
'use client';

import * as React from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
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
  onSelect: (item: BoqItem | null) => void;
  isLoading: boolean;
}

export function BoqItemSelector({
  boqItems,
  selectedSlNo,
  onSelect,
  isLoading,
}: BoqItemSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [currentValue, setCurrentValue] = React.useState(selectedSlNo || "");

  React.useEffect(() => {
    setCurrentValue(selectedSlNo || "");
  }, [selectedSlNo]);

  const getItemDescription = (item: BoqItem): string => {
    const descriptionKeys = [
      'Description',
      'DESCRIPTION OF ITEMS',
      'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'
    ];
    for (const key of descriptionKeys) {
      if (item[key]) {
        return String(item[key]);
      }
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? String(item[fallbackKey]) : '';
  };
  
  const getSlNo = (item: BoqItem): string => {
    return String(item['Sl No'] || item['SL. No.'] || '');
  }

  const selectedItem = boqItems.find((item) => getSlNo(item) === currentValue);
  
  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    const specificKey = 'UNIT PRICE';
    if(keys.includes(specificKey)) return specificKey;
    
    return keys.find(key => key.toLowerCase().includes('price') && !key.toLowerCase().includes('total'));
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
            ? `${getSlNo(selectedItem)}: ${getItemDescription(selectedItem).substring(0, 20)}...`
            : 'Select BOQ Item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[500px] p-0">
        <Command
            filter={(value, search) => {
                const item = boqItems.find(i => getSlNo(i) === value);
                if (!item) return 0;
                
                const slNo = getSlNo(item).toLowerCase();
                const desc = getItemDescription(item).toLowerCase();
                const searchTerm = search.toLowerCase();
                
                if (slNo.includes(searchTerm) || desc.includes(searchTerm)) {
                  return 1;
                }
                return 0;
            }}
        >
          <CommandInput placeholder="Search by Sl. No. or Description..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No BOQ item found.'}
            </CommandEmpty>
            <CommandGroup>
              <ScrollArea className="h-72">
                {boqItems.map((item) => {
                  const rateKey = findBasicPriceKey(item);
                  const rate = rateKey ? item[rateKey] : 'N/A';
                  const slNo = getSlNo(item);
                  const description = getItemDescription(item);
                  return (
                    <CommandItem
                      key={item.id}
                      value={slNo}
                      onSelect={(currentValue) => {
                        const selected = boqItems.find(i => getSlNo(i).toLowerCase() === currentValue.toLowerCase());
                        onSelect(selected || null);
                        setCurrentValue(selected ? getSlNo(selected) : "");
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          currentValue === slNo
                            ? 'opacity-100'
                            : 'opacity-0'
                        )}
                      />
                       <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <span className="font-medium text-sm">{slNo}</span>
                          <span className="text-xs text-right">
                              <strong>Rate:</strong> {rate}
                          </span>
                        </div>
                         <div className="flex justify-between items-end mt-1">
                            <p className="text-xs text-muted-foreground flex-1 pr-2 truncate">{description}</p>
                            <span className="text-xs text-muted-foreground text-right">
                                <strong>Unit:</strong> {item['UNIT'] || item['UNITS'] || 'N/A'}
                            </span>
                         </div>
                      </div>
                    </CommandItem>
                  )
                })}
              </ScrollArea>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
