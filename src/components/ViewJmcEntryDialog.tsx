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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, Save, Printer } from 'lucide-react';

import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

import PrintJmcDialog from '@/components/PrintJmcDialog';

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

function getScope2(x: any): string | undefined {
  if (!x) return undefined;
  const k = Object.keys(x).find((kk) => kk.toLowerCase().replace(/\s+|\./g, '') === 'scope2');
  const v = k ? x[k] : undefined;
  return typeof v === 'string' ? v.trim() : undefined;
}

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
  bills: Bill[];
  isEditMode?: boolean;
  onVerify?: (
    taskId: string,
    action: string,
    comment: string,
    updatedItems: JmcItem[]
  ) => Promise<void>;
  isLoading?: boolean;
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
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);

  // refs for split-axis scrolling
  const xScrollRef = useRef<HTMLDivElement | null>(null);     // inner container that actually scrolls horizontally (contains table)
  const hBarRef = useRef<HTMLDivElement | null>(null);        // fixed bottom horizontal scrollbar
  const hBarInnerRef = useRef<HTMLDivElement | null>(null);   // spacer that mirrors content scrollWidth

  useEffect(() => {
    setEditableItems(jmcEntry?.items ? (JSON.parse(JSON.stringify(jmcEntry.items)) as JmcItem[]) : []);
  }, [jmcEntry, isOpen]);

  useEffect(() => {
    const fetchProjectJmcs = async () => {
      const projectId = (jmcEntry as any)?.projectId || undefined;
      if (!projectId) {
        setProjectJmcEntries([]);
        return;
      }
      try {
        const snap = await getDocs(collection(db, 'projects', projectId, 'jmcEntries'));
        const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry));
        setProjectJmcEntries(all);
      } catch (e) {
        console.error('Failed to load project JMCs:', e);
        setProjectJmcEntries([]);
      }
    };
    fetchProjectJmcs();
  }, [jmcEntry]);

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

  const enrichedItems: EnrichedJmcItem[] = useMemo(() => {
    if (!jmcEntry || !Array.isArray(boqItems)) return [];
    const itemsToDisplay = isEditMode ? editableItems : jmcEntry.items;
    return itemsToDisplay.map((item) => {
      const sl = String(item.boqSlNo ?? '').trim();
      const boqItem = boqItems.find((b: any) => {
        const bSl = String(b['BOQ SL No'] ?? b['SL. No.'] ?? b['SL No'] ?? b['SL'] ?? '').trim();
        return bSl === sl;
      });
      const boqQty = boqItem ? Number((boqItem as any).QTY ?? (boqItem as any)['Total Qty'] ?? 0) : 0;
      const scope2 = getScope2(item) ?? getScope2(boqItem);
      const key = compositeKey(scope2, sl);
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

  const formatDateSafe = (dateInput: any) => {
    const d = toDateSafe(dateInput);
    if (!d) return 'N/A';
    try {
      return format(d, 'dd MMM, yyyy');
    } catch {
      return 'Invalid Date';
    }
  };

  const dialogWidthClass =
    dialogSize === 'full'
      ? 'sm:max-w-[95vw]'
      : dialogSize === '2xl'
      ? 'sm:max-w-[80rem]'
      : dialogSize === 'xl'
      ? 'sm:max-w-[64rem]'
      : 'sm:max-w-4xl';

  // columns and min table width (to force horizontal overflow when needed)
  const COLS = {
    sl: '6rem',
    desc: '22rem',
    unit: '4rem',
    boq: '6rem',
    rate: '6rem',
    prev: '6rem',
    exec: '6rem',
    cert: '6rem',
    upToDate: '6rem',
    execAmt: '8rem',
    certAmt: '8rem',
  } as const;
  const tableMinWidthRem = 86;

  // rows
  const rows = useMemo(() => {
    return enrichedItems.map((item, index) => {
      const rate = Number((item as any).rate) || 0;
      const execQty = Number((item as any).executedQty) || 0;
      const certQty = Number((item as any).certifiedQty) || 0;
      const prevCert = Number((item as any).previousCertifiedQty) || 0;
      const upToDateCertifiedQty = prevCert + certQty;
      const executedAmount = rate * execQty;
      const certifiedAmount = rate * certQty;

      return (
        <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
          <TableCell className="text-center font-medium truncate">{item.boqSlNo ?? '-'}</TableCell>
          {/* Description clamped to 4 lines */}
          <TableCell className="align-top">
            <div className="line-clamp-4 break-words whitespace-pre-line" title={item.description ?? ''}>
              {item.description ?? '-'}
            </div>
          </TableCell>
          <TableCell className="whitespace-nowrap align-top">{item.unit ?? '-'}</TableCell>
          <TableCell className="text-right whitespace-nowrap align-top">{Number(item.boqQty) || 0}</TableCell>
          <TableCell className="text-right whitespace-nowrap align-top">{formatCurrency(rate)}</TableCell>
          <TableCell className="text-right whitespace-nowrap align-top">{prevCert}</TableCell>
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
              execQty || '-'
            )}
          </TableCell>
          {/* Certified in this JMC (non-editable) */}
          <TableCell className="text-right whitespace-nowrap align-top">{certQty || '-'}</TableCell>
          <TableCell className="text-right whitespace-nowrap align-top font-semibold">{upToDateCertifiedQty || 0}</TableCell>
          <TableCell className="text-right whitespace-nowrap align-top">{formatCurrency(executedAmount)}</TableCell>
          <TableCell className="text-right whitespace-nowrap align-top">{formatCurrency(certifiedAmount)}</TableCell>
        </TableRow>
      );
    });
  }, [enrichedItems, isEditMode]);

  const hasJmc = !!jmcEntry;

  /* ---------- split-axis scroll sync ---------- */
  useEffect(() => {
    const x = xScrollRef.current;
    const bar = hBarRef.current;
    const inner = hBarInnerRef.current;
    if (!x || !bar || !inner) return;

    const syncFromBar = () => { x.scrollLeft = bar.scrollLeft; };
    const syncFromX = () => { bar.scrollLeft = x.scrollLeft; };

    // set width of fake inner to match content scroll width
    const setWidths = () => {
      inner.style.width = `${x.scrollWidth}px`;
    };
    setWidths();

    // observe size changes
    const ro = new ResizeObserver(setWidths);
    ro.observe(x);

    bar.addEventListener('scroll', syncFromBar, { passive: true });
    x.addEventListener('scroll', syncFromX, { passive: true });
    window.addEventListener('resize', setWidths);

    return () => {
      ro.disconnect();
      bar.removeEventListener('scroll', syncFromBar);
      x.removeEventListener('scroll', syncFromX);
      window.removeEventListener('resize', setWidths);
    };
  }, [rows.length, dialogSize, hasJmc]);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        {/* height constrained; inner owns scroll */}
        <DialogContent className={`${dialogWidthClass} max-h-[90vh] flex flex-col min-h-0`}>
          {/* HEADER */}
          <div className="pb-2">
            <DialogHeader>
              <DialogTitle className="text-center">
                {isEditMode ? 'Verify & Edit' : 'JMC Details'}: {jmcEntry?.jmcNo ?? '-'}
              </DialogTitle>
            </DialogHeader>
          </div>

          {/* BODY: vertical scroller (Y) + hidden X; inside it we keep a real X scroller */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-t-md border">
            {!hasJmc ? (
              <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                No JMC selected.
              </div>
            ) : (
              // This is the element that actually scrolls horizontally.
              <div ref={xScrollRef} className="w-full overflow-x-auto no-scrollbar">
                <Table className="w-full table-fixed" style={{ minWidth: `${86}rem` }}>
                  <colgroup>
                    <col style={{ width: COLS.sl }} />
                    <col style={{ width: COLS.desc }} />
                    <col style={{ width: COLS.unit }} />
                    <col style={{ width: COLS.boq }} />
                    <col style={{ width: COLS.rate }} />
                    <col style={{ width: COLS.prev }} />
                    <col style={{ width: COLS.exec }} />
                    <col style={{ width: COLS.cert }} />
                    <col style={{ width: COLS.upToDate }} />
                    <col style={{ width: COLS.execAmt }} />
                    <col style={{ width: COLS.certAmt }} />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center text-[11px] px-2">BOQ Sl. No.</TableHead>
                      <TableHead className="text-center text-[11px] px-2">Description</TableHead>
                      <TableHead className="text-center text-[11px] px-2">Unit</TableHead>
                      <TableHead className="text-center text-[11px] px-2">BOQ Qty</TableHead>
                      <TableHead className="text-center text-[11px] px-2">Rate</TableHead>
                      <TableHead className="text-center text-[11px] px-2">Prev. Certified</TableHead>
                      <TableHead className="text-center text-[11px] px-2">Executed in this JMC</TableHead>
                      <TableHead className="text-center text-[11px] px-2">Certified in this JMC</TableHead>
                      <TableHead className="text-center text-[11px] px-2">Up to Date Certified Qty</TableHead>
                      <TableHead className="text-center text-[11px] px-2">Amount Executed</TableHead>
                      <TableHead className="text-center text-[11px] px-2">Amount Certified</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{rows}</TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* DEDICATED HORIZONTAL SCROLLBAR, DOCKED AT DIALOG BOTTOM */}
          <div
            ref={hBarRef}
            className="h-4 overflow-x-auto overflow-y-hidden rounded-b-md border-t"
            style={{ scrollbarGutter: 'stable both-edges' }}
            aria-hidden
          >
            <div ref={hBarInnerRef} className="h-4" />
          </div>

          {/* FOOTER */}
          <div className="pt-4">
            <Separator />
            <DialogFooter className="pt-3 sm:justify-between">
              <div>
                <Button variant="outline" onClick={() => setIsPrintDialogOpen(true)} disabled={!hasJmc}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
              </div>
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button variant="outline">Close</Button>
                </DialogClose>
                {isEditMode && (
                  <Button onClick={handleSaveChanges} disabled={isLoading || !hasJmc}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save &amp; Verify
                  </Button>
                )}
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <PrintJmcDialog
        isOpen={isPrintDialogOpen}
        onOpenChange={setIsPrintDialogOpen}
        jmcEntry={jmcEntry}
        enrichedItems={enrichedItems}
      />
    </>
  );
}
