
'use client';

import { useState, useMemo, useEffect } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { WorkOrder, WorkOrderItem, BillItem } from '@/lib/types';
import type { CheckedState } from '@radix-ui/react-checkbox';

interface WorkOrderItemSelectorDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (selectedItems: WorkOrderItem[]) => void;
  workOrder: WorkOrder | null;
  alreadyAddedItems?: BillItem[];
}

export function WorkOrderItemSelectorDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  workOrder,
  alreadyAddedItems = [],
}: WorkOrderItemSelectorDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const addedItemIds = useMemo(
    () => new Set(alreadyAddedItems.map((it) => it.jmcItemId)), // jmcItemId holds the WorkOrderItem ID here
    [alreadyAddedItems]
  );

  const availableItems = useMemo(() => {
    if (!workOrder) return [];
    return workOrder.items.filter((item) => !addedItemIds.has(item.id));
  }, [workOrder, addedItemIds]);
  
  // Reset selection when dialog opens or items change
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set());
    }
  }, [isOpen]);

  const allOnPageSelected =
    availableItems.length > 0 && availableItems.every((it) => selectedIds.has(it.id));
  const noneSelected = availableItems.every((it) => !selectedIds.has(it.id));
  const selectAllState: CheckedState =
    allOnPageSelected ? true : noneSelected ? false : 'indeterminate';

  const handleSelectAll = (checked: CheckedState) => {
    setSelectedIds(new Set(checked ? availableItems.map((i) => i.id) : []));
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  
  const handleConfirm = () => {
    if (!workOrder) return;
    const selectedWoItems = workOrder.items.filter((item) => selectedIds.has(item.id));
    onConfirm(selectedWoItems);
    onOpenChange(false);
  };
  
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Select Items from Work Order</DialogTitle>
          <DialogDescription>
            Choose items to add to the bill. Items already added are not shown.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96 border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                    <Checkbox
                        aria-label="Select all"
                        checked={selectAllState}
                        onCheckedChange={handleSelectAll}
                    />
                </TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Ordered Qty</TableHead>
                <TableHead>Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {availableItems.length > 0 ? (
                availableItems.map((item) => (
                    <TableRow key={item.id} onClick={() => handleSelectRow(item.id, !selectedIds.has(item.id))} className="cursor-pointer">
                        <TableCell>
                            <Checkbox
                                checked={selectedIds.has(item.id)}
                                onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                            />
                        </TableCell>
                        <TableCell>{item.description}</TableCell>
                        <TableCell>{item.orderQty} {item.unit}</TableCell>
                        <TableCell>{formatCurrency(item.rate)}</TableCell>
                    </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No available items in this work order.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleConfirm} disabled={selectedIds.size === 0}>
            Add {selectedIds.size} Selected Item{selectedIds.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
