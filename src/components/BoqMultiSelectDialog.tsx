
'use client';

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { BoqItem } from '@/lib/types';
import { Search } from 'lucide-react';

interface BoqMultiSelectDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  boqItems: BoqItem[];
  onConfirm: (selectedItems: BoqItem[]) => void;
}

export function BoqMultiSelectDialog({ isOpen, onOpenChange, boqItems, onConfirm }: BoqMultiSelectDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  const filteredItems = useMemo(() => {
    if (!searchTerm) return boqItems;
    const lowercasedFilter = searchTerm.toLowerCase();
    return boqItems.filter(item =>
      (item['SL. No.'] && item['SL. No.'].toLowerCase().includes(lowercasedFilter)) ||
      (item['DESCRIPTION OF ITEMS'] && item['DESCRIPTION OF ITEMS'].toLowerCase().includes(lowercasedFilter))
    );
  }, [boqItems, searchTerm]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filteredItems.map(item => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    const newSelectedIds = new Set(selectedIds);
    if (checked) {
      newSelectedIds.add(id);
    } else {
      newSelectedIds.delete(id);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleConfirm = () => {
    const selectedItems = boqItems.filter(item => selectedIds.has(item.id));
    onConfirm(selectedItems);
    onOpenChange(false);
    setSelectedIds(new Set());
    setSearchTerm('');
  };

  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    return keys.find(key => key.toLowerCase().includes('price') && !key.toLowerCase().includes('total'));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Select BOQ Items</DialogTitle>
          <DialogDescription>
            Search and select multiple items to add to the JMC entry.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
            <div className="relative mb-4">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by Sl. No. or Description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                />
            </div>
            <ScrollArea className="h-96 border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <Checkbox
                                    checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
                            <TableHead>Sl. No.</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Unit</TableHead>
                            <TableHead>Rate</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredItems.map(item => {
                            const rateKey = findBasicPriceKey(item);
                            const rate = rateKey ? item[rateKey] : 'N/A';
                            return (
                                <TableRow key={item.id} data-state={selectedIds.has(item.id) && "selected"}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedIds.has(item.id)}
                                            onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                        />
                                    </TableCell>
                                    <TableCell>{item['SL. No.']}</TableCell>
                                    <TableCell>{item['DESCRIPTION OF ITEMS']}</TableCell>
                                    <TableCell>{item['UNITS']}</TableCell>
                                    <TableCell>{rate}</TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleConfirm}>
            Add {selectedIds.size} Selected Item(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
