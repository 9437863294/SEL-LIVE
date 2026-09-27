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
import type { JmcEntry, BoqItem, Bill, JmcItem, Project } from '@/lib/types';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, Save, Printer, Maximize, Minimize } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';

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
  const key = Object.keys(item).find(k => k.toLowerCase().replace(/\s+|\./g, '') === 'scope1');
  return key ? String(item[key] || '') : '';
};

const getScope2 = (item: any): string => {
  if (!item) return '';
  const key = Object.keys(item).find(k => k.toLowerCase().replace(/\s+|\./g, '') === 'scope2');
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

type EnrichedJmcItem = JmcItem & {
  boqQty: number;
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
  bills, // eslint-disable-line @typescript-eslint/no-unused-vars
  isEditMode = false,
  onVerify,
  isLoading = false,
}: ViewJmcEntryDialogProps) {
  const [editableItems, setEditableItems] = useState<JmcItem[]>([]);
  const [dialogSize, setDialogSize] = useState<'xl' | '2xl' | 'full'>('xl');
  const [currentProject, setCurrentProject] =
    useState<(Project & { signatures?: any[] }) | null>(null);

  // split-axis scrolling refs
  const xScrollRef = useRef<HTMLDivElement | null>(null);
  const hBarRef = useRef<HTMLDivElement | null>(null);
  const hBarInnerRef = useRef<HTMLDivElement | null>(null);

  /* ---------- sync editableItems with jmcEntry ---------- */
  useEffect(() => {
    if (jmcEntry?.items && Array.isArray(jmcEntry.items)) {
      setEditableItems(JSON.parse(JSON.stringify(jmcEntry.items)) as JmcItem[]);
    } else {
      setEditableItems([]);
    }
  }, [jmcEntry, isOpen]);

  /* ---------- load project ---------- */
  useEffect(() => {
    const fetchProjectData = async () => {
      const projectId = (jmcEntry as any)?.projectId || undefined;
      if (!projectId) {
        setCurrentProject(null);
        return;
      }
      try {
        const projectSnap = await getDoc(doc(db, 'projects', projectId));

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
      } catch (e) {
        console.error('Failed to load project data:', e);
        setCurrentProject(null);
      }
    };

    if (isOpen && jmcEntry) {
      fetchProjectData();
    }
  }, [jmcEntry, isOpen]);

  /* ---------- enriched items: BOQ qty + previous certified qty ---------- */
  const enrichedItems: EnrichedJmcItem[] = useMemo(() => {
    if (!jmcEntry || !Array.isArray(boqItems)) return [];

    const itemsToDisplay = isEditMode ? editableItems : (jmcEntry.items || []);

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
              (boqItem as any)['Qty'] ??
              (boqItem as any)['Total Qty'] ??
              0
          )
        : 0;

      return {
        ...(item as JmcItem),
        boqQty,
        previousCertifiedQty: Number(item.totalCertifiedQty || 0),
      };
    });
  }, [jmcEntry, boqItems, isEditMode, editableItems]);

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
    if (!onVerify || !jmcEntry) return;
    await onVerify(
      jmcEntry.id,
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

  const hasJmc = !!jmcEntry;

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
  }, [rows.length, dialogSize, hasJmc]);

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
    (jmcEntry as any)?.projectSlug ||
    (currentProject?.projectName ? slugify(currentProject.projectName as any) : '');

  /* ---------- PRINT URL + HANDLER ---------- */
  const printUrl =
    hasJmc && resolvedProjectSlug && jmcEntry?.id
      ? `/billing-recon/${resolvedProjectSlug}/jmc/${jmcEntry.id}/print`
      : '';

  const handlePrintClick = () => {
    if (!printUrl) return;
    window.open(printUrl, '_blank', 'noopener,noreferrer');
  };

  /* ---------- RENDER ---------- */

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {/* `hr-mobile-dialog` & co. (globals.css, ≤640px): a full-screen sheet on a phone in which only
          the body scrolls, the centred modal from `sm` up. */}
      <DialogContent
        className={`hr-mobile-dialog ${dialogWidthClass} sm:max-h-[90vh] flex flex-col min-h-0`}
      >
        {/* HEADER */}
        <div className="hr-dialog-header pb-2">
          <DialogHeader>
            <DialogTitle className="text-center">
              {isEditMode ? 'Verify & Edit' : 'JMC Details'}:{' '}
              {jmcEntry?.jmcNo ?? '-'}
            </DialogTitle>
          </DialogHeader>
          {jmcEntry && (
            <p className="text-center text-xs text-muted-foreground">
              Date: {formatDateSafe(jmcEntry.jmcDate)}
            </p>
          )}
        </div>

        {/* BODY */}
        <div className="hr-dialog-body flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain sm:rounded-t-md sm:border">
          {!hasJmc ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
              No JMC selected.
            </div>
          ) : (
            <>
            {/* Phone: one card per item. The 88rem table below would be a long sideways swipe
                for every row, so it is kept for `sm` and up. */}
            <div className="space-y-2.5 sm:hidden">
              {enrichedItems.map((item, index) => {
                const rate = Number((item as any).rate) || 0;
                const execQty = Number((item as any).executedQty) || 0;
                const certQty = Number((item as any).certifiedQty) || 0;
                const prevCert = Number((item as any).previousCertifiedQty) || 0;
                const figures: Array<[string, React.ReactNode]> = [
                  ['Unit', item.unit ?? '-'],
                  ['BOQ Qty', Number(item.boqQty) || 0],
                  ['Rate', formatCurrency(rate)],
                  ['Prev. Certified', prevCert],
                  [
                    'Executed in this JMC',
                    isEditMode ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={(item as any).executedQty ?? ''}
                        onChange={(e) =>
                          handleItemChange(index, 'executedQty', e.target.value)
                        }
                        className="h-8 w-full"
                        aria-label={`Executed in this JMC for ${item.boqSlNo ?? 'item'}`}
                      />
                    ) : (
                      execQty || '-'
                    ),
                  ],
                  ['Certified in this JMC', certQty || '-'],
                  ['Up to Date Certified Qty', prevCert + certQty || 0],
                  ['Amount Executed', formatCurrency(rate * execQty)],
                  ['Amount Certified', formatCurrency(rate * certQty)],
                ];
                return (
                  <div
                    key={`${item.boqSlNo ?? 'NA'}-${index}`}
                    className="rounded-xl border border-border/60 bg-card p-3.5 shadow-sm"
                  >
                    <p className="text-sm font-semibold">{item.boqSlNo ?? '-'}</p>
                    <p className="mt-0.5 line-clamp-4 whitespace-pre-line break-words text-xs text-muted-foreground">
                      {item.description ?? '-'}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border/60 pt-2">
                      {figures.map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="break-words text-sm">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              })}
            </div>
            <div ref={xScrollRef} className="hidden w-full overflow-x-auto no-scrollbar sm:block">
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
                    <TableHead className="text-center text-[11px] px-2">
                      BOQ Sl. No.
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      Description
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      Unit
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      BOQ Qty
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      Rate
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      Prev. Certified
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      Executed in this JMC
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      Certified in this JMC
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      Up to Date Certified Qty
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      Amount Executed
                    </TableHead>
                    <TableHead className="text-center text-[11px] px-2">
                      Amount Certified
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>{rows}</TableBody>
              </Table>
            </div>
            </>
          )}
        </div>

        {/* BOTTOM H-SCROLLBAR */}
        <div
          ref={hBarRef}
          className="hidden h-4 overflow-x-auto overflow-y-hidden rounded-b-md border-t sm:block"
          style={{ scrollbarGutter: 'stable both-edges' }}
          aria-hidden
        >
          <div ref={hBarInnerRef} className="h-4" />
        </div>

        {/* FOOTER */}
        <div className="hidden pt-4 sm:block">
          <Separator />
        </div>
        {/* On a phone the groups dissolve into the footer's two-column grid: Save & Verify across
            the top, Print | Close beneath. The size toggle has nothing to resize on a full-screen
            sheet, so it is hidden there. */}
        <DialogFooter className="hr-dialog-footer pt-3 sm:justify-between">
          <div className="flex gap-2 max-sm:contents">
            <Button
              variant="outline"
              onClick={handlePrintClick}
              disabled={!printUrl}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={toggleDialogSize}
              className="hidden sm:inline-flex"
              aria-label={dialogSize === 'full' ? 'Shrink dialog' : 'Enlarge dialog'}
            >
              {dialogSize === 'full' ? (
                <Minimize className="h-4 w-4" />
              ) : (
                <Maximize className="h-4 w-4" />
              )}
            </Button>
          </div>

          <div className="flex gap-2 max-sm:contents">
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>

            {isEditMode && (
              <Button
                onClick={handleSaveChanges}
                disabled={isLoading || !hasJmc}
                className="max-sm:order-first max-sm:col-span-2"
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
      </DialogContent>
    </Dialog>
  );
}
