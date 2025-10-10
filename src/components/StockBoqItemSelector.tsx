
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
import type { InventoryLog, BoqItem } from '@/lib/types';
import { ScrollArea } from './ui/scroll-area';

interface StockBoqItemSelectorProps {
  inventoryItems: InventoryLog[];
  boqItems: BoqItem[];
  selectedItemId: string | null;
  onSelect: (item: InventoryLog | null) => void;
  isLoading: boolean;
}

export function StockBoqItemSelector({
  inventoryItems,
  boqItems,
  selectedItemId,
  onSelect,
  isLoading,
}: StockBoqItemSelectorProps) {
  const [open, setOpen] = React.useState(false);
  
  const selectedItem = inventoryItems.find((item) => item.itemId === selectedItemId);

  const getItemDescription = (item: InventoryLog): string => {
    return item.itemName || 'No Description';
  };
  
  const getSlNo = (itemId: string): string => {
      const boqItem = boqItems.find(b => b.id === itemId);
      if (!boqItem) return 'N/A';
      return String(boqItem['Sl No'] || boqItem['SL. No.'] || '');
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
          {selectedItem
            ? `${getSlNo(selectedItem.itemId)}: ${getItemDescription(selectedItem).substring(0, 20)}...`
            : 'Select BOQ Item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command
            filter={(value, search) => {
                const item = inventoryItems.find(i => i.itemId.toLowerCase() === value.toLowerCase());
                if (!item) return 0;
                
                const slNo = getSlNo(item.itemId).toLowerCase();
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
              {isLoading ? 'Loading...' : 'No available items found.'}
            </CommandEmpty>
              <ScrollArea className="h-72">
                 <div className="p-1">
                    {inventoryItems.map((item) => {
                        const slNo = getSlNo(item.itemId);
                        const description = getItemDescription(item);
                        return (
                          <CommandItem
                            key={item.itemId}
                            value={item.itemId}
                            onSelect={() => {
                              onSelect(item);
                              setOpen(false);
                            }}
                            className="flex flex-col items-start"
                          >
                            <div className="flex justify-between w-full">
                                <span className="font-medium text-sm">{slNo}</span>
                                <span className="text-xs text-muted-foreground">{item.availableQuantity} {item.unit}</span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate w-full">{description}</p>
                          </CommandItem>
                        )
                    })}
                 </div>
              </ScrollArea>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
