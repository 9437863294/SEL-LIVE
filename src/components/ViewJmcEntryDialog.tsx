'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { JmcEntry, BoqItem, Bill, JmcItem } from '@/lib/types';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { useMemo, useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Loader2, Save } from 'lucide-react';

/* ---------- helpers ---------- */
function toDateSafe(value: any): Date | null {
  if (!value) return null;
  // Firestore Timestamp
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(+d) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

function formatCurrency(amount: number | string) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return String(amount ?? '');
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  } catch {
    return `₹${num.toFixed(2)}`;
  }
}

type EnrichedJmcItem = JmcItem & {
  boqQty: number;
  previousCertifiedQty: number;
};

interface ViewJmcEntryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  boqItems: BoqItem[];
  bills: Bill[];
  isEditMode?: boolean;
  onVerify?: (
    taskId: string,
    action: string,
    comment: string,
    updatedItems: JmcItem[]
  ) => Promise<void>;
  isLoading?: boolean;
}

export default function ViewJmcEntryDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  boqItems,
  bills,
  isEditMode = false,
  onVerify,
  isLoading = false,
}: ViewJmcEntryDialogProps) {
  const [editableItems, setEditableItems] = useState<JmcItem[]>([]);

  useEffect(() => {
    if (jmcEntry?.items) {
      // Deep copy to avoid mutating parent state
      setEditableItems(JSON.parse(JSON.stringify(jmcEntry.items)) as JmcItem[]);
    } else {
      setEditableItems([]);
    }
  }, [jmcEntry, isOpen]);

  const enrichedItems: EnrichedJmcItem[] = useMemo(() => {
    if (!jmcEntry || !Array.isArray(boqItems)) return [];

    const itemsToDisplay = isEditMode ? editableItems : jmcEntry.items;
    const jmcDate =
      toDateSafe((jmcEntry as any).jmcDate) ??
      toDateSafe((jmcEntry as any).createdAt) ??
      new Date();

    return itemsToDisplay.map((item) => {
      // Match BOQ item by BOQ SL No / SL. No.
      const boqItem = boqItems.find(
        (b) =>
          String(
            (b as any)['BOQ SL No'] ?? (b as any)['SL. No.'] ?? (b as any)['SL No'] ?? ''
          ).trim() === String(item.boqSlNo ?? '').trim()
      );

      const boqQty = boqItem
        ? Number((boqItem as any).QTY ?? (boqItem as any)['Total Qty'] ?? 0)
        : 0;

      // ***** Prev. Certified logic *****
      // Prefer the value captured at JMC creation (same as entry page),
      // then fallback to legacy "sum of previous bills" if not present.
      let previousCertifiedQty = Number((item as any).totalCertifiedQty);
      if (!Number.isFinite(previousCertifiedQty)) {
        const previousBillItems = (bills ?? [])
          .filter((bill) => {
            const billDate = toDateSafe((bill as any).billDate);
            return billDate ? billDate < (jmcDate as Date) : false;
          })
          .flatMap((bill) => bill.items ?? [])
          .filter((bi) => bi.boqSlNo === item.boqSlNo);

        previousCertifiedQty = previousBillItems.reduce(
          (sum, bi) => sum + Number(bi.billedQty ?? 0),
          0
        );
      }

      return {
        ...item,
        boqQty,
        previousCertifiedQty: Number.isFinite(previousCertifiedQty) ? previousCertifiedQty : 0,
      } as EnrichedJmcItem;
    });
  }, [jmcEntry, boqItems, bills, isEditMode, editableItems]);

  const handleItemChange = (
    index: number,
    field: 'executedQty' | 'certifiedQty',
    value: string
  ) => {
    setEditableItems((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      const numValue = value === '' ? '' : Number(value);

      if (value === '') {
        (item as any)[field] = '';
      } else if (Number.isFinite(numValue)) {
        (item as any)[field] = Number(numValue);
      }

      // Recompute totalAmount from executedQty * rate
      const rate = Number(item.rate) || 0;
      const executedQty = Number(item.executedQty) || 0;
      item.totalAmount = executedQty * rate;

      next[index] = item;
      return next;
    });
  };

  const handleSaveChanges = async () => {
    if (!onVerify || !jmcEntry) return;
    await onVerify(jmcEntry.id, 'Verified', 'Verified with edits', editableItems);
  };

  if (!jmcEntry) return null;

  const formatDateSafe = (dateInput: any) => {
    const d = toDateSafe(dateInput);
    if (!d) return 'N/A';
    try {
      return format(d, 'dd MMM, yyyy');
    } catch {
      return 'Invalid Date';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Verify & Edit' : 'JMC Details'}: {jmcEntry.jmcNo}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>JMC No.</Label>
                <p className="font-medium">{jmcEntry.jmcNo ?? '-'}</p>
              </div>
              <div>
                <Label>Work Order No.</Label>
                <p className="font-medium">{jmcEntry.woNo ?? '-'}</p>
              </div>
              <div>
                <Label>JMC Date</Label>
                <p className="font-medium">{formatDateSafe((jmcEntry as any).jmcDate)}</p>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-lg font-semibold mb-2">Items</h3>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>BOQ Sl. No.</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>BOQ Qty</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Prev. Certified</TableHead>
                      <TableHead>Executed Qty</TableHead>
                      <TableHead>Certified Qty</TableHead>
                      <TableHead>Total Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrichedItems.map((item, index) => (
                      <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
                        <TableCell title={String(item.boqSlNo ?? '')}>
                          {item.boqSlNo ?? '-'}
                        </TableCell>
                        <TableCell className="max-w-xs truncate" title={item.description ?? ''}>
                          {item.description ?? '-'}
                        </TableCell>
                        <TableCell>{item.unit ?? '-'}</TableCell>
                        <TableCell>{Number(item.boqQty) || 0}</TableCell>
                        <TableCell>{formatCurrency(item.rate)}</TableCell>
                        <TableCell>{Number(item.previousCertifiedQty) || 0}</TableCell>
                        <TableCell>
                          {isEditMode ? (
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              value={item.executedQty ?? ''}
                              onChange={(e) => handleItemChange(index, 'executedQty', e.target.value)}
                            />
                          ) : (
                            item.executedQty ?? '-'
                          )}
                        </TableCell>
                        <TableCell>{item.certifiedQty ?? '-'}</TableCell>
                        <TableCell>{formatCurrency(item.totalAmount ?? 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="mt-4 pr-4">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>

          {isEditMode && (
            <Button onClick={handleSaveChanges} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save &amp; Verify
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
