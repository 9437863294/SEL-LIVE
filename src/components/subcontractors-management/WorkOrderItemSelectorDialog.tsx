// /src/app/(protected)/billing-recon/[project]/billing/create/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { WorkOrder, WorkOrderItem } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface WorkOrderItemSelectorDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  workOrder: { items: WorkOrderItem[] } | null;
  onConfirm: (selectedItems: WorkOrderItem[]) => void;
  alreadyAddedItems?: WorkOrderItem[];
}

export default function WorkOrderItemSelectorDialog({
  isOpen,
  onOpenChange,
  workOrder,
  onConfirm,
  alreadyAddedItems = [],
}: WorkOrderItemSelectorDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      setSelectedIds(new Set());
    }
  }, [isOpen]);

  const availableItems = useMemo(() => {
    if (!workOrder) return [];
    const addedIds = new Set(alreadyAddedItems.map(item => item.id));
    return workOrder.items.filter(item => !addedIds.has(item.id));
  }, [workOrder, alreadyAddedItems]);

  const handleSelect = (itemId: string, checked: boolean) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
      }
      return newSet;
    });
  };

  const handleConfirm = () => {
    const selected = workOrder?.items.filter(item => selectedIds.has(item.id)) || [];
    onConfirm(selected);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Select Work Order Items</DialogTitle>
          <DialogDescription>Select items to add to the bill. Already added items are not shown.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>BOQ Sl. No.</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Order Qty</TableHead>
                <TableHead>Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {availableItems.map(item => (
                <TableRow key={item.id} onClick={() => handleSelect(item.id, !selectedIds.has(item.id))} className="cursor-pointer">
                  <TableCell>
                    <Checkbox checked={selectedIds.has(item.id)} />
                  </TableCell>
                  <TableCell>{item.boqSlNo}</TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.orderQty}</TableCell>
                  <TableCell>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(item.rate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={selectedIds.size === 0}>
            Add {selectedIds.size} Selected Item(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
