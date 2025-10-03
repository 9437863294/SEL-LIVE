
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
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { MainItem, SubItem, BoqItem } from '@/lib/types';
import { ScrollArea } from './ui/scroll-area';

interface ItemSelectorProps {
  mainItems: BoqItem[];
  subItems: BoqItem[];
  selectedItemId: string | null;
  onSelect: (item: BoqItem | null, type: 'Main' | 'Sub') => void;
  isLoading: boolean;
}

export function ItemSelector({
  mainItems,
  subItems,
  selectedItemId,
  onSelect,
  isLoading,
}: ItemSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const allItems = [...mainItems, ...subItems];
  const selectedItem = allItems.find((item) => item.id === selectedItemId);

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedItem ? getItemDescription(selectedItem) : 'Select an item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command
            filter={(value, search) => {
                const item = allItems.find(i => i.id === value);
                if (!item) return 0;
                
                const name = getItemDescription(item).toLowerCase();
                const searchTerm = search.toLowerCase();
                
                return name.includes(searchTerm) ? 1 : 0;
            }}
        >
          <CommandInput placeholder="Search items..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No item found.'}
            </CommandEmpty>
            <ScrollArea className="h-72">
              <CommandGroup heading="Sub-Items">
                {subItems.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => {
                        onSelect(item, 'Sub');
                        setOpen(false);
                      }}
                    >
                      <Check className={cn('mr-2 h-4 w-4', selectedItemId === item.id ? 'opacity-100' : 'opacity-0')} />
                       <div className="flex justify-between items-center w-full">
                         <span>{getItemDescription(item)}</span>
                         <span className="text-xs text-muted-foreground">{item['UNIT'] || item['UNITS']}</span>
                       </div>
                    </CommandItem>
                ))}
              </CommandGroup>
            </ScrollArea>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
