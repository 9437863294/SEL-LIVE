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
import { useMemo, useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Loader2, Save } from 'lucide-react';

/* Firestore to fetch other JMC entries in the SAME project */
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

/* ---------- helpers ---------- */
function toDateSafe(value: any): Date | null {
  if (!value) return null;
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
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `₹${num.toFixed(2)}`;
  }
}

/** Read "Scope 2" from an arbitrary object (row, BOQ, entry, etc.) */
function getScope2(x: any): string | undefined {
  if (!x) return undefined;
  const k = Object.keys(x).find((kk) => kk.toLowerCase().replace(/\s+|\./g, '') === 'scope2');
  const v = k ? x[k] : undefined;
  return typeof v === 'string' ? v.trim() : undefined;
}

/** Composite key for (scope2 + slNo) */
const compositeKey = (scope2: unknown, slNo: unknown) =>
  `${String(scope2 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;

type EnrichedJmcItem = JmcItem & {
  boqQty: number;
  previousCertifiedQty: number;
};

interface ViewJmcEntryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  boqItems: BoqItem[];
  bills: Bill[]; // kept for API compatibility; not used in this “same as entry page” calc
  isEditMode?: boolean;
  onVerify?: (
    taskId: string,
    action: string,
    comment: string,
    updatedItems: JmcItem[]
  ) => Promise<void>;
  isLoading?: boolean;
  /** Control dialog width */
  dialogSize?: 'default' | 'xl' | '2xl' | 'full';
}

export default function ViewJmcEntryDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  boqItems,
  bills, // eslint-disable-line @typescript-eslint/no-unused-vars
  isEditMode = false,
  onVerify,
  isLoading = false,
  dialogSize = 'default',
}: ViewJmcEntryDialogProps) {
  const [editableItems, setEditableItems] = useState<JmcItem[]>([]);
  const [projectJmcEntries, setProjectJmcEntries] = useState<JmcEntry[]>([]);

  /* Clone items for edit mode */
  useEffect(() => {
    setEditableItems(jmcEntry?.items ? (JSON.parse(JSON.stringify(jmcEntry.items)) as JmcItem[]) : []);
  }, [jmcEntry, isOpen]);

  /* Fetch ALL JMC entries in the SAME project to mirror the Entry page’s calculation */
  useEffect(() => {
    const fetchProjectJmcs = async () => {
      const projectId =
        (jmcEntry as any)?.projectId ||
        // some of your JMCs might store project under a different key; fallback to undefined
        undefined;

      if (!projectId) {
        setProjectJmcEntries([]);
        return;
      }

      try {
        const snap = await getDocs(collection(db, 'projects', projectId, 'jmcEntries'));
        const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry));
        setProjectJmcEntries(all);
      } catch (e) {
        // On failure, just fallback to zero; don’t break the dialog
        console.error('Failed to load project JMCs for totalCertifiedQty map:', e);
        setProjectJmcEntries([]);
      }
    };
    fetchProjectJmcs();
  }, [jmcEntry]);

  /* Build the same totalCertifiedQty map as in the JMC Entry page */
  const totalCertifiedQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    projectJmcEntries.forEach((entry) => {
      (entry.items ?? []).forEach((it: any) => {
        const key = compositeKey(it?.scope2, it?.boqSlNo);
        if (!String(it?.boqSlNo || '').trim()) return;
        map[key] = (map[key] || 0) + (Number(it?.certifiedQty) || 0);
      });
    });
    return map;
  }, [projectJmcEntries]);

  /* Enrich items for display/edit */
  const enrichedItems: EnrichedJmcItem[] = useMemo(() => {
    if (!jmcEntry || !Array.isArray(boqItems)) return [];

    const itemsToDisplay = isEditMode ? editableItems : jmcEntry.items;

    return itemsToDisplay.map((item) => {
      // Match BOQ by SL No
      const sl = String(item.boqSlNo ?? '').trim();
      const boqItem = boqItems.find((b: any) => {
        const bSl = String(b['BOQ SL No'] ?? b['SL. No.'] ?? b['SL No'] ?? b['SL'] ?? '').trim();
        return bSl === sl;
      });

      const boqQty = boqItem ? Number((boqItem as any).QTY ?? (boqItem as any)['Total Qty'] ?? 0) : 0;

      // Scope2 can come from the row, else try BOQ
      const scope2 = getScope2(item) ?? getScope2(boqItem);
      const key = compositeKey(scope2, sl);

      // Prefer explicit per-row totalCertifiedQty; else use project-wide map (same as Entry page)
      let previousCertifiedQty = Number((item as any).totalCertifiedQty);
      if (!Number.isFinite(previousCertifiedQty)) {
        previousCertifiedQty = totalCertifiedQtyMap[key] || 0;
      }

      return {
        ...(item as any),
        boqQty,
        previousCertifiedQty: Number.isFinite(previousCertifiedQty) ? previousCertifiedQty : 0,
      } as EnrichedJmcItem;
    });
  }, [jmcEntry, boqItems, isEditMode, editableItems, totalCertifiedQtyMap]);

  const handleItemChange = (
    index: number,
    field: 'executedQty' | 'certifiedQty',
    value: string
  ) => {
    setEditableItems((prev) => {
      const next = [...prev];
      const item = { ...(next[index] as any) };
      const numValue = value === '' ? '' : Number(value);

      if (value === '') item[field] = '';
      else if (Number.isFinite(numValue)) item[field] = Number(numValue);

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

  // Dialog width presets (works with your DialogContent)
  const dialogWidthClass =
    dialogSize === 'full'
      ? 'sm:max-w-[95vw]'
      : dialogSize === '2xl'
      ? 'sm:max-w-[80rem]'
      : dialogSize === 'xl'
      ? 'sm:max-w-[64rem]'
      : 'sm:max-w-4xl';

  // Fixed column widths (sum = 112rem) to keep columns visible.
  const COLS = {
    sl: '6rem',
    desc: '20rem',
    unit: '4rem',
    boq: '8rem',
    rate: '8rem',
    prev: '8rem',
    exec: '8rem',
    cert: '8rem',
    total: '12rem',
  } as const;
  const tableMinWidth = 82; // rem

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={dialogWidthClass}>
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Verify & Edit' : 'JMC Details'}: {jmcEntry.jmcNo}
          </DialogTitle>
        </DialogHeader>

        {/* Vertical scrolling only; table itself handles horizontal */}
        <div className="max-h-[70vh] overflow-y-auto">
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
                <div className="w-full overflow-x-auto">
                  <Table className="w-full table-fixed" style={{ minWidth: `${tableMinWidth}rem` }}>
                    <colgroup>
                      <col style={{ width: COLS.sl }} />
                      <col style={{ width: COLS.desc }} />
                      <col style={{ width: COLS.unit }} />
                      <col style={{ width: COLS.boq }} />
                      <col style={{ width: COLS.rate }} />
                      <col style={{ width: COLS.prev }} />
                      <col style={{ width: COLS.exec }} />
                      <col style={{ width: COLS.cert }} />
                      <col style={{ width: COLS.total }} />
                    </colgroup>

                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-center whitespace-nowrap">BOQ Sl. No.</TableHead>
                        <TableHead className="whitespace-nowrap">Description</TableHead>
                        <TableHead className="whitespace-nowrap">Unit</TableHead>
                        <TableHead className="text-right whitespace-nowrap">BOQ Qty</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Rate</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Prev. Certified</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Executed Qty</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Certified Qty</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Total Amount</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {enrichedItems.map((item, index) => (
                        <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
                          <TableCell className="text-center font-medium truncate" title={String(item.boqSlNo ?? '')}>
                            {item.boqSlNo ?? '-'}
                          </TableCell>

                          <TableCell className="align-top">
                            <div className="line-clamp-2 break-words" title={item.description ?? ''}>
                              {item.description ?? '-'}
                            </div>
                          </TableCell>

                          <TableCell className="whitespace-nowrap align-top">{item.unit ?? '-'}</TableCell>

                          <TableCell className="text-right whitespace-nowrap align-top">{Number(item.boqQty) || 0}</TableCell>
                          <TableCell className="text-right whitespace-nowrap align-top">
                            {formatCurrency((item as any).rate)}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap align-top">
                            {Number((item as any).previousCertifiedQty) || 0}
                          </TableCell>

                          <TableCell className="text-right whitespace-nowrap align-top">
                            {isEditMode ? (
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="any"
                                value={(item as any).executedQty ?? ''}
                                onChange={(e) => handleItemChange(index, 'executedQty', e.target.value)}
                                className="h-8"
                              />
                            ) : (
                              (item as any).executedQty ?? '-'
                            )}
                          </TableCell>

                          <TableCell className="text-right whitespace-nowrap align-top">
                            {(item as any).certifiedQty ?? '-'}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap align-top">
                            {formatCurrency((item as any).totalAmount ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4 pr-4">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>

          {isEditMode && (
            <Button onClick={handleSaveChanges} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save &amp; Verify
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
