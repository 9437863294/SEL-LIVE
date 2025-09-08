
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

  const selectedItem = boqItems.find((item) => item['SL. No.'] === selectedSlNo);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedSlNo && selectedItem
            ? selectedItem['SL. No.']
            : 'Select BOQ Item...'}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[500px] p-0">
        <Command
            filter={(value, search) => {
                const item = boqItems.find(i => i.id === value);
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
                {boqItems.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => {
                      onSelect(item);
                      setOpen(false);
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
                    <div className="flex flex-col">
                        <span className="font-medium">{item['SL. No.']}</span>
                        <span className="text-xs text-muted-foreground">{item['DESCRIPTION OF ITEMS']}</span>
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
