
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
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { InventoryLog } from '@/lib/types';
import { ScrollArea } from './ui/scroll-area';

interface ItemSelectorProps {
  items: InventoryLog[];
  selectedItemId: string | null;
  onSelect: (item: InventoryLog | null) => void;
  isLoading: boolean;
}

export function ItemSelector({
  items,
  selectedItemId,
  onSelect,
  isLoading,
}: ItemSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const selectedItem = items.find((item) => item.itemId === selectedItemId);

  const getItemDescription = (item: InventoryLog): string => {
    return item.itemName || 'No Description';
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
          {selectedItem ? getItemDescription(selectedItem) : 'Select an item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command
            filter={(value, search) => {
                const item = items.find(i => i.itemId === value);
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
            <CommandGroup>
              <ScrollArea className="h-72">
                {items.map((item) => (
                    <CommandItem
                      key={item.itemId}
                      value={item.itemId}
                      onSelect={() => {
                        onSelect(item);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn('mr-2 h-4 w-4', selectedItemId === item.itemId ? 'opacity-100' : 'opacity-0')} />
                       <div className="flex justify-between items-center w-full">
                         <div className="flex-1 pr-2">
                             <p className="text-sm font-medium truncate">{getItemDescription(item)}</p>
                             <p className="text-xs text-muted-foreground">Available: {item.availableQuantity}</p>
                         </div>
                         <span className="text-xs text-muted-foreground">{item.unit}</span>
                       </div>
                    </CommandItem>
                ))}
              </ScrollArea>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
