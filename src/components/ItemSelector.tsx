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
import type { MainItem, SubItem } from '@/lib/types';
import { ScrollArea } from './ui/scroll-area';

interface ItemSelectorProps {
  mainItems: MainItem[];
  subItems: SubItem[];
  selectedItemId: string | null;
  onSelect: (item: MainItem | SubItem | null, type: 'Main' | 'Sub') => void;
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedItem ? selectedItem.name : 'Select an item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command
            filter={(value, search) => {
                const [id, name, type] = value.split('__');
                const lowercasedSearch = search.toLowerCase();
                return name.toLowerCase().includes(lowercasedSearch) ? 1 : 0;
            }}
        >
          <CommandInput placeholder="Search items..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No item found.'}
            </CommandEmpty>
            <ScrollArea className="h-72">
              <CommandGroup heading="Main Items">
                {mainItems.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${item.id}__${item.name}__Main`}
                      onSelect={() => {
                        onSelect(item, 'Main');
                        setOpen(false);
                      }}
                    >
                      <Check className={cn('mr-2 h-4 w-4', selectedItemId === item.id ? 'opacity-100' : 'opacity-0')} />
                      <span>{item.name}</span>
                    </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
               <CommandGroup heading="Sub-Items">
                {subItems.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${item.id}__${item.name}__Sub`}
                      onSelect={() => {
                        onSelect(item, 'Sub');
                        setOpen(false);
                      }}
                    >
                      <Check className={cn('mr-2 h-4 w-4', selectedItemId === item.id ? 'opacity-100' : 'opacity-0')} />
                       <div className="flex justify-between items-center w-full">
                         <span>{item.name}</span>
                         <span className="text-xs text-muted-foreground">{item.unit}</span>
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
