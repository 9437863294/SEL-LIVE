
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BoqItemSelector({
  boqItems,
  selectedSlNo,
  onSelect,
  isLoading,
  open,
  onOpenChange,
}: BoqItemSelectorProps) {
  const selectedItem = boqItems.find((item) => item['SL. No.'] === selectedSlNo);
  
  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    return keys.find(key => key.toLowerCase().includes('price') && !key.toLowerCase().includes('total'));
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedItem
            ? selectedItem['SL. No.']
            : 'Select BOQ Item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[500px] p-0">
        <Command
            filter={(value, search) => {
                const itemSlNo = value.split(' - ')[0];
                const item = boqItems.find(i => i['SL. No.'] === itemSlNo);
                if (!item) return 0;

                const slNo = item['SL. No.']?.toLowerCase() || '';
                const desc = item['DESCRIPTION OF ITEMS']?.toLowerCase() || '';
                const searchTerm = search.toLowerCase();
                
                return slNo.includes(searchTerm) || desc.includes(searchTerm) ? 1 : 0;
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
                  return (
                    <CommandItem
                      key={item.id}
                      value={`${item['SL. No.'] || ''} - ${item['DESCRIPTION OF ITEMS'] || ''}`}
                      onSelect={() => {
                        onSelect(item);
                        onOpenChange(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          selectedSlNo === item['SL. No.']
                            ? 'opacity-100'
                            : 'opacity-0'
                        )}
                      />
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <span className="font-medium text-sm">{item['SL. No.']}</span>
                          <span className="text-xs text-right">
                              <strong>Rate:</strong> {rate}
                          </span>
                        </div>
                         <div className="flex justify-between items-end mt-1">
                            <p className="text-xs text-muted-foreground flex-1 pr-2">{item['DESCRIPTION OF ITEMS']}</p>
                            <span className="text-xs text-muted-foreground text-right">
                                <strong>Unit:</strong> {item['UNITS'] || 'N/A'}
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
