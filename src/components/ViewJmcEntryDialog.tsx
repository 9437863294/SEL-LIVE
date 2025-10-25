
'use client';

import { useMemo, useState, useEffect } from 'react';
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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { JmcEntry, BoqItem, Bill, JmcItem, ActionConfig } from '@/lib/types';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { Input } from './ui/input';
import { Loader2, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type EnrichedJmcItem = JmcItem & {
  boqQty: number;
  totalCertifiedQty: number;
  __certStr?: string;
  __error?: string | null;
};

interface ViewJmcEntryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  boqItems: BoqItem[];
  bills: Bill[]; // kept for API parity, not used here
  isEditMode?: boolean;
  onVerify?: (
    taskId: string,
    action: string | ActionConfig,
    comment: string,
    updatedItems: JmcItem[]
  ) => Promise<void>;
  isLoading?: boolean;
}

function safeFormatDate(d: unknown): string {
  try {
    // Firestore Timestamp support
    // @ts-expect-error - runtime guard
    if (d && typeof d === 'object' && typeof (d as any).toDate === 'function') {
      return format((d as any).toDate(), 'dd MMM, yyyy');
    }
    if (typeof d === 'number') return format(new Date(d), 'dd MMM, yyyy');
    if (typeof d === 'string') return format(new Date(d), 'dd MMM, yyyy');
    if (d instanceof Date) return format(d, 'dd MMM, yyyy');
  } catch {
    /* noop */
  }
  return '—';
}

export default function ViewJmcEntryDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  boqItems,
  bills, // eslint-disable-line @typescript-eslint/no-unused-vars
  isEditMode = false,
  onVerify,
  isLoading,
}: ViewJmcEntryDialogProps) {
  const { toast } = useToast();

  const [editableItems, setEditableItems] = useState<EnrichedJmcItem[]>([]);
  const [initialItems, setInitialItems] = useState<EnrichedJmcItem[]>([]);


  // Build the initial enriched items only when the dialog opens for a specific entry.
  useEffect(() => {
    if (!isOpen || !jmcEntry) {
      setInitialItems([]);
      setEditableItems([]);
      return;
    };
    
    const enriched: EnrichedJmcItem[] = (jmcEntry.items || []).map(item => {
        const boqItem = boqItems.find(b => b['BOQ SL No'] === item.boqSlNo);
        const boqQty = Number(boqItem?.QTY || 0);

        return {
            ...item,
            boqQty,
            totalCertifiedQty: 0, // This will be calculated in another effect if needed.
            __certStr: String(item.certifiedQty ?? ''),
            __error: null,
        }
    });

    setInitialItems(enriched);
    setEditableItems(enriched);

  }, [jmcEntry, isOpen, boqItems]);


  const hasErrors = useMemo(() => editableItems.some((i) => i.__error), [editableItems]);
  const itemsToDisplay = isEditMode ? editableItems : initialItems;


  const handleItemChange = (
    index: number,
    field: 'executedQty' | 'certifiedQty',
    value: string
  ) => {
    setEditableItems((prev) => {
      const next = [...prev];
      const numValue = Number(value);
      const item = { ...next[index] };

      if (field === 'executedQty') {
        (item as any).executedQty = Number.isFinite(numValue) ? numValue : undefined;
      } else {
        item.__certStr = value;
        if (!Number.isNaN(numValue)) {
          const executedQty = Number(item.executedQty) || 0;
          const totalPreviousCertified = item.totalCertifiedQty || 0;
          const availableToCertify = executedQty - totalPreviousCertified;

          if (numValue < 0) {
            item.__error = 'Cannot be negative';
          } else if (numValue > availableToCertify) {
            item.__error = `Max available: ${availableToCertify.toFixed(3)}`;
          } else {
            item.__error = null;
          }
          item.certifiedQty = numValue;
        } else {
          // Empty or invalid input resets certified value
          item.certifiedQty = undefined as any;
          item.__error = null;
        }
      }

      const rate = Number(item.rate) || 0;
      const executedQty = Number(item.executedQty) || 0;
      item.totalAmount = executedQty * rate;

      next[index] = item;
      return next;
    });
  };


  const handleSaveAndVerify = () => {
    if (hasErrors) {
      toast({
        title: 'Validation Error',
        description: 'Please correct the errors in the certified quantities before saving.',
        variant: 'destructive',
      });
      return;
    }
    if (onVerify && jmcEntry) {
      const itemsToSave: JmcItem[] = editableItems.map(
        ({ boqQty, totalCertifiedQty, __error, __certStr, ...rest }) => ({
          ...rest,
          certifiedQty:
            rest.certifiedQty === undefined || rest.certifiedQty === null
              ? undefined
              : Number(rest.certifiedQty),
        })
      );
      // fire-and-forget; parent can handle promise state via isLoading
      void onVerify(jmcEntry.id, 'Verified', 'Verified with edits', itemsToSave);
    }
  };

  const formatCurrency = (amount: number | string) => {
    const num = Number(amount);
    if (Number.isNaN(num)) return String(amount ?? '');
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
    // If you need raw number: return new Intl.NumberFormat('en-IN').format(num);
  };


  if (!jmcEntry) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Verify & Edit' : 'JMC Details'}: {jmcEntry.jmcNo}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>JMC No.</Label>
                <p className="font-medium">{jmcEntry.jmcNo}</p>
              </div>
              <div>
                <Label>Work Order No.</Label>
                <p className="font-medium">{jmcEntry.woNo}</p>
              </div>
              <div>
                <Label>JMC Date</Label>
                <p className="font-medium">{safeFormatDate(jmcEntry.jmcDate)}</p>
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
                      <TableHead className="max-w-[200px]">Description</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>BOQ QTY</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Total Certified QTY</TableHead>
                      <TableHead>Executed Qty</TableHead>
                      <TableHead>Certified Qty</TableHead>
                      <TableHead>Total Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsToDisplay.map((item, index) => (
                      <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
                        <TableCell>{item.boqSlNo}</TableCell>
                        <TableCell className="truncate max-w-[200px]">{item.description}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{item.boqQty}</TableCell>
                        <TableCell>{formatCurrency(item.rate)}</TableCell>
                        <TableCell>{item.totalCertifiedQty}</TableCell>
                        <TableCell>
                          {isEditMode ? (
                            <Input
                              type="number"
                              inputMode="decimal"
                              value={
                                Number.isFinite(Number(item.executedQty))
                                  ? String(item.executedQty)
                                  : ''
                              }
                              onChange={(e) => handleItemChange(index, 'executedQty', e.target.value)}
                            />
                          ) : (
                            item.executedQty
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditMode ? (
                            <div>
                              <Input
                                type="number"
                                inputMode="decimal"
                                value={item.__certStr ?? ''}
                                onChange={(e) => handleItemChange(index, 'certifiedQty', e.target.value)}
                                className={item.__error ? 'border-destructive' : ''}
                              />
                              {item.__error && (
                                <p className="text-xs text-destructive mt-1">{item.__error}</p>
                              )}
                            </div>
                          ) : (
                            item.certifiedQty ?? 'N/A'
                          )}
                        </TableCell>
                        <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
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
            <Button onClick={handleSaveAndVerify} disabled={isLoading || hasErrors}>
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

