
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
      <PopoverContent className="w-[500px] p-0">
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
                    <div className="flex justify-between items-center px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        <div className="w-1/4">BOQ Sl. No.</div>
                        <div className="w-1/2">Description</div>
                        <div className="w-1/4 text-right">Available Qty</div>
                    </div>
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
                            className="flex justify-between items-center w-full cursor-pointer text-sm"
                          >
                            <div className="w-1/4 font-medium truncate">{slNo}</div>
                            <div className="w-1/2 truncate px-2">{description}</div>
                            <div className="w-1/4 text-right">{item.availableQuantity} {item.unit}</div>
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
