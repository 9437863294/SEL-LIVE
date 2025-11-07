
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
import { Separator } from '@/components/ui/separator';
import type { MvacEntry, BoqItem, Bill, MvacItem, Project } from '@/lib/types';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, Save, Printer, Maximize, Minimize } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import Link from 'next/link';

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

const getScope1 = (item: any): string => {
  if (!item) return '';
  const key = Object.keys(item).find(
    (k) => k.toLowerCase().replace(/\s+|\./g, '') === 'scope1'
  );
  return key ? String(item[key] || '') : '';
};

const getScope2 = (item: any): string => {
  if (!item) return '';
  const key = Object.keys(item).find(
    (k) => k.toLowerCase().replace(/\s+|\./g, '') === 'scope2'
  );
  return key ? String(item[key] || '') : '';
};

const getBoqSlNo = (item: any): string =>
  String(
    item?.['BOQ SL No'] ??
      item?.['BOQ SL NO'] ??
      item?.['SL. No.'] ??
      item?.['SL No'] ??
      item?.['SL'] ??
      item?.boqSlNo ??
      ''
  ).trim();

const compositeKey = (scope1: unknown, scope2: unknown, slNo: unknown) =>
  `${String(scope1 ?? '').trim().toLowerCase()}__${String(scope2 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;

type EnrichedMvacItem = MvacItem & {
  boqQty: number;
  previousCertifiedQty: number;
};

interface ViewMvacEntryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  MvacEntry: MvacEntry | null;
  boqItems: BoqItem[];
  bills: Bill[];
  isEditMode?: boolean;
  onVerify?: (
    taskId: string,
    action: string,
    comment: string,
    updatedItems: MvacItem[]
  ) => Promise<void>;
  isLoading?: boolean;
}

export default function ViewMvacEntryDialog({
  isOpen,
  onOpenChange,
  MvacEntry,
  boqItems,
  bills, // eslint-disable-line @typescript-eslint/no-unused-vars
  isEditMode = false,
  onVerify,
  isLoading = false,
}: ViewMvacEntryDialogProps) {
  const [editableItems, setEditableItems] = useState<MvacItem[]>([]);
  const [projectMvacEntries, setProjectMvacEntries] = useState<MvacEntry[]>([]);
  const [dialogSize, setDialogSize] = useState<'xl' | '2xl' | 'full'>('xl');
  const [currentProject, setCurrentProject] =
    useState<(Project & { signatures?: any[] }) | null>(null);

  // split-axis scroll refs
  const xScrollRef = useRef<HTMLDivElement | null>(null);
  const hBarRef = useRef<HTMLDivElement | null>(null);
  const hBarInnerRef = useRef<HTMLDivElement | null>(null);

  /* ---------- sync editableItems with MvacEntry ---------- */
  useEffect(() => {
    if (MvacEntry?.items && Array.isArray(MvacEntry.items)) {
      setEditableItems(
        JSON.parse(JSON.stringify(MvacEntry.items)) as MvacItem[]
      );
    } else {
      setEditableItems([]);
    }
  }, [MvacEntry, isOpen]);

  /* ---------- load project + all MVACs of project ---------- */
  useEffect(() => {
    const fetchProjectData = async () => {
      const projectId = (MvacEntry as any)?.projectId || undefined;
      if (!projectId) {
        setProjectMvacEntries([]);
        setCurrentProject(null);
        return;
      }
      try {
        const [projectSnap, mvacSnap] = await Promise.all([
          getDoc(doc(db, 'projects', projectId)),
          getDocs(collection(db, 'projects', projectId, 'mvacEntries')),
        ]);

        if (projectSnap.exists()) {
          setCurrentProject(
            {
              id: projectSnap.id,
              ...(projectSnap.data() as any),
            } as Project & { signatures?: any[] }
          );
        } else {
          setCurrentProject(null);
        }

        const all = mvacSnap.docs.map(
          (d) =>
            ({
              id: d.id,
              ...(d.data() as any),
            } as MvacEntry)
        );
        setProjectMvacEntries(all);
      } catch (e) {
        console.error('Failed to load project MVACs:', e);
        setProjectMvacEntries([]);
        setCurrentProject(null);
      }
    };

    if (isOpen && MvacEntry) {
      fetchProjectData();
    }
  }, [MvacEntry, isOpen]);

  /* ---------- enriched items: BOQ qty + previous certified qty ---------- */
  const enrichedItems: EnrichedMvacItem[] = useMemo(() => {
    if (!MvacEntry || !Array.isArray(boqItems)) return [];
  
    const itemsToDisplay = isEditMode ? editableItems : MvacEntry.items || [];
    
    const boqItemsMap = new Map<string, BoqItem>();
    boqItems.forEach(b => {
        const key = compositeKey(getScope1(b), getScope2(b), getBoqSlNo(b));
        boqItemsMap.set(key, b);
    });
  
    return itemsToDisplay.map((item: any) => {
      const itemKey = compositeKey(getScope1(item), getScope2(item), getBoqSlNo(item));
      const boqItem = boqItemsMap.get(itemKey);
  
      const boqQty = boqItem
        ? Number(
            (boqItem as any).QTY ??
              (boqItem as any).Qty ??
              (boqItem as any)['Total Qty'] ??
              0
          )
        : 0;
  
      return {
        ...(item as MvacItem),
        boqQty,
        previousCertifiedQty: Number(item.totalCertifiedQty || 0), // Directly use the stored value
      };
    });
  }, [MvacEntry, boqItems, isEditMode, editableItems]);

  /* ---------- editing ---------- */
  const handleItemChange = (
    index: number,
    field: 'executedQty' | 'certifiedQty',
    value: string
  ) => {
    setEditableItems((prev) => {
      const next = [...prev];
      const item: any = { ...(next[index] as any) };

      if (value === '') {
        item[field] = '';
      } else {
        const num = Number(value);
        if (Number.isFinite(num)) item[field] = num;
      }

      const rate = Number(item.rate) || 0;
      const executedQty = Number(item.executedQty) || 0;
      item.totalAmount = executedQty * rate;

      next[index] = item;
      return next;
    });
  };

  const handleSaveChanges = async () => {
    if (!onVerify || !MvacEntry) return;
    await onVerify(
      MvacEntry.id,
      'Verified',
      'Verified with edits',
      editableItems
    );
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
      : 'sm:max-w-4xl';

  const COLS = {
    sl: '6rem',
    desc: '22rem',
    unit: '4rem',
    boq: '6rem',
    rate: '6rem',
    prev: '6rem',
    exec: '8rem',
    cert: '6rem',
    upToDate: '6rem',
    execAmt: '8rem',
    certAmt: '8rem',
  } as const;

  const tableMinWidthRem = 88;

  /* ---------- rows ---------- */
  const rows = useMemo(
    () =>
      enrichedItems.map((item, index) => {
        const rate = Number((item as any).rate) || 0;
        const execQty = Number((item as any).executedQty) || 0;
        const certQty = Number((item as any).certifiedQty) || 0;
        const prevCert = Number((item as any).previousCertifiedQty) || 0;

        const upToDateCertifiedQty = prevCert + certQty;
        const executedAmount = rate * execQty;
        const certifiedAmount = rate * certQty;

        return (
          <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
            <TableCell className="text-center font-medium truncate">
              {item.boqSlNo ?? '-'}
            </TableCell>
            {/* Description: max 4 lines */}
            <TableCell className="align-top">
              <div
                className="line-clamp-4 break-words whitespace-pre-line"
                title={item.description ?? ''}
              >
                {item.description ?? '-'}
              </div>
            </TableCell>

            <TableCell className="whitespace-nowrap align-top">
              {item.unit ?? '-'}
            </TableCell>

            <TableCell className="text-right whitespace-nowrap align-top">
              {Number(item.boqQty) || 0}
            </TableCell>

            <TableCell className="text-right whitespace-nowrap align-top">
              {formatCurrency(rate)}
            </TableCell>

            <TableCell className="text-right whitespace-nowrap align-top">
              {prevCert}
            </TableCell>

            <TableCell className="text-right whitespace-nowrap align-top">
              {isEditMode ? (
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={(item as any).executedQty ?? ''}
                  onChange={(e) =>
                    handleItemChange(index, 'executedQty', e.target.value)
                  }
                  className="h-8"
                />
              ) : (
                execQty || '-'
              )}
            </TableCell>

            <TableCell className="text-right whitespace-nowrap align-top">
              {certQty || '-'}
            </TableCell>

            <TableCell className="text-right whitespace-nowrap align-top font-semibold">
              {upToDateCertifiedQty || 0}
            </TableCell>

            <TableCell className="text-right whitespace-nowrap align-top">
              {formatCurrency(executedAmount)}
            </TableCell>

            <TableCell className="text-right whitespace-nowrap align-top">
              {formatCurrency(certifiedAmount)}
            </TableCell>
          </TableRow>
        );
      }),
    [enrichedItems, isEditMode]
  );

  const hasMvac = !!MvacEntry;

  /* ---------- split-axis scroll sync ---------- */
  useEffect(() => {
    const x = xScrollRef.current;
    const bar = hBarRef.current;
    const inner = hBarInnerRef.current;
    if (!x || !bar || !inner) return;

    const syncFromBar = () => {
      x.scrollLeft = bar.scrollLeft;
    };
    const syncFromX = () => {
      bar.scrollLeft = x.scrollLeft;
    };

    const setWidths = () => {
      inner.style.width = `${x.scrollWidth}px`;
    };
    setWidths();

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
  }, [rows.length, dialogSize, hasMvac]);

  const toggleDialogSize = () => {
    setDialogSize((current) => {
      if (current === 'xl') return '2xl';
      if (current === '2xl') return 'full';
      return 'xl';
    });
  };

  const slugify = (text: string | undefined) =>
    text
      ? text
          .toString()
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^\w-]+/g, '')
      : '';

  const resolvedProjectSlug =
    (MvacEntry as any)?.projectSlug ||
    (currentProject?.projectName
      ? slugify(currentProject.projectName as any)
      : '');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className={`${dialogWidthClass} max-h-[90vh] flex flex-col min-h-0`}
      >
        {/* HEADER */}
        <div className="pb-2">
          <DialogHeader>
            <DialogTitle className="text-center">
              {isEditMode ? 'Verify & Edit' : 'MVAC Details'}:{' '}
              {MvacEntry?.mvacNo ?? '-'}
            </DialogTitle>
          </DialogHeader>
          {MvacEntry && (
            <p className="text-center text-xs text-muted-foreground">
              Date: {formatDateSafe(MvacEntry.mvacDate)}
            </p>
          )}
        </div>

        {/* BODY */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain rounded-t-md border">
          {!hasMvac ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
              No MVAC selected.
            </div>
          ) : (
            <div ref={xScrollRef} className="w-full overflow-x-auto no-scrollbar">
              <Table
                className="w-full table-fixed"
                style={{ minWidth: `${tableMinWidthRem}rem` }}
              >
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

                <TableHeader className="sticky top-0 z-20 bg-background shadow-sm">
                  <TableRow>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      BOQ Sl. No.
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      Description
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      Unit
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      BOQ Qty
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      Rate
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      Prev. Certified
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      Executed in this MVAC
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      Certified in this MVAC
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      Up to Date Certified Qty
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      Amount Executed
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">
                      Amount Certified
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>{rows}</TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* BOTTOM H-SCROLLBAR */}
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
            <div className="flex gap-2">
              <Link
                href={
                  hasMvac &&
                  resolvedProjectSlug &&
                  MvacEntry?.id
                    ? `/billing-recon/${resolvedProjectSlug}/mvac/${MvacEntry.id}/print`
                    : '#'
                }
                target="_blank"
              >
                <Button
                  variant="outline"
                  disabled={!hasMvac || !resolvedProjectSlug}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
              </Link>

              <Button
                variant="outline"
                size="icon"
                onClick={toggleDialogSize}
              >
                {dialogSize === 'full' ? (
                  <Minimize className="h-4 w-4" />
                ) : (
                  <Maximize className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>

              {isEditMode && (
                <Button
                  onClick={handleSaveChanges}
                  disabled={isLoading || !hasMvac}
                >
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save &amp; Verify
                </Button>
              )}
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
