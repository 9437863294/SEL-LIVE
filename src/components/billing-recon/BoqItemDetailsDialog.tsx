

'use client';

import { useMemo, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
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
import type { BoqItem, JmcEntry, Bill, MvacEntry, MvacItem, Project } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import ViewJmcEntryDialog from './ViewJmcEntryDialog';
import { Eye, Maximize, Minimize, Loader2 } from 'lucide-react';
import { Timestamp, collection, getDocs, query } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import ViewMvacEntryDialog from './ViewMvacEntryDialog';
import { projectMatchesSlug } from '@/lib/project-slug';


/* ---------- Props ---------- */
interface BoqItemDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  item: BoqItem | null;
  /**
   * Firestore id of `projects/{id}`. Supply it whenever the caller already knows it: the dialog then
   * reads the related entries directly instead of scanning every project to match `item.projectSlug`
   * by name — a lookup that fails outright when the parent project document is missing or unnamed.
   */
  projectId?: string;
}

type MvacItemWithParent = MvacItem & {
  mvacEntry: MvacEntry;
};

/* ---------- Lightweight row types to avoid implicit any ---------- */
type JmcRow = {
  jmcNo?: string;
  jmcDate?: unknown;
  executedQty?: number;
  certifiedQty?: number;
  runningExecuted?: number;
  runningCertified?: number;
};

type BillRow = {
  billNo?: string;
  billDate?: unknown;
  billedQty?: number;
  totalAmount?: number;
};

/* ---------- Helpers ---------- */

const formatCurrency = (amount: unknown) => {
  const n =
    typeof amount === 'number'
      ? amount
      : typeof amount === 'string'
      ? Number(amount.replace(/[, ]/g, ''))
      : NaN;
  if (!Number.isFinite(n)) return String(amount ?? 'N/A');
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
};

function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const formatDateSafe = (dateInput: unknown) => {
  const d = toDateSafe(dateInput);
  if (!d) return 'N/A';
  try {
    return format(d, 'dd MMM, yyyy');
  } catch {
    return 'Invalid Date';
  }
};

const getBoqSlNo = (item: any): string =>
  String(item?.['BOQ SL No'] ?? item?.['SL. No.'] ?? item?.boqSlNo ?? '').trim();

const getItemDescription = (item: any): string =>
  String(item?.Description ?? item?.description ?? item?.['Item Spec'] ?? '').trim();

const getScope2 = (x: any): string | undefined => {
  if (!x) return undefined;
  const k = Object.keys(x).find((kk) => kk.toLowerCase().replace(/\s+|\./g, '') === 'scope2');
  const v = k ? (x as any)[k] : undefined;
  return typeof v === 'string' ? v.trim() : undefined;
};


const compositeKey = (scope2: unknown, slNo: unknown) =>
  `${String(scope2 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;

/**
 * The breakdowns render through the shared DataList so a phone gets one card per entry. On a
 * desktop these put back this dialog's own table look — sentence-case headers on the card
 * background — over the list's tinted small-caps header band.
 */
const BREAKDOWN_TABLE =
  '[&_thead]:bg-transparent [&_th]:h-12 [&_th]:text-sm [&_th]:font-medium [&_th]:normal-case [&_th]:tracking-normal [&_th]:text-muted-foreground';

/** The list's phone cards are near-white on near-white inside this dialog; a real border separates them. */
const breakdownCard = () => 'max-sm:border-border';

function BreakdownEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-24 items-center justify-center rounded-md border px-4 text-center text-sm sm:rounded-none sm:border-0">
      {children}
    </div>
  );
}

/* ---------- Component ---------- */

export default function BoqItemDetailsDialog({
  isOpen,
  onOpenChange,
  item,
  projectId,
}: BoqItemDetailsDialogProps) {
  const { toast } = useToast();

  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);
  const [isJmcViewOpen, setIsJmcViewOpen] = useState(false);
  const [selectedMvac, setSelectedMvac] = useState<MvacEntry | null>(null);
  const [isMvacViewOpen, setIsMvacViewOpen] = useState(false);
  const [dialogSize, setDialogSize] = useState<'xl' | '2xl' | 'full'>('2xl');

  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [mvacEntries, setMvacEntries] = useState<MvacEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /* -------- Fetch related project data (self-contained) -------- */
  const fetchRelatedData = useCallback(async () => {
    const projectSlug = item?.projectSlug;
    if (!projectId && !projectSlug) return;
    setIsLoading(true);
    try {
      let resolvedProjectId = projectId ?? '';

      if (!resolvedProjectId) {
        const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
        const projectData = projectsSnapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Project))
          .find((p) => projectMatchesSlug((p as any).projectName || '', projectSlug));

        if (!projectData) {
          throw new Error('Project not found for this BOQ item.');
        }
        resolvedProjectId = (projectData as any).id;
      }

      const [jmcSnapshot, billsSnapshot, mvacSnapshot] = await Promise.all([
        getDocs(collection(db, 'projects', resolvedProjectId, 'jmcEntries')),
        getDocs(collection(db, 'projects', resolvedProjectId, 'bills')),
        getDocs(collection(db, 'projects', resolvedProjectId, 'mvacEntries')),
      ]);

      setJmcEntries(jmcSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry)));
      setBills(billsSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Bill)));
      setMvacEntries(mvacSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MvacEntry)));
      
    } catch (error) {
      console.error('Error fetching related project data:', error);
      toast({ title: 'Error', description: 'Failed to fetch related project data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [item?.projectSlug, projectId, toast]);

  useEffect(() => {
    if (isOpen && (projectId || item?.projectSlug)) {
      fetchRelatedData();
    } else {
        setJmcEntries([]);
        setBills([]);
        setMvacEntries([]);
    }
  }, [isOpen, item?.projectSlug, projectId, fetchRelatedData]);

  /* -------- Data assembly -------- */
  const data = useMemo(() => {
    if (!item) return null;

    const boqSlNo = getBoqSlNo(item);
    if (!boqSlNo) return null;

    const description = getItemDescription(item);
    const rawBoqQty = (item as any)['Total Qty'] ?? (item as any)['qty'] ?? (item as any)['QTY'] ?? 0;
    const boqQty = Number(String(rawBoqQty).replace(/[, ]/g, '')) || 0;
    const scope2 = getScope2(item);
    const currentItemKey = compositeKey(scope2, boqSlNo);
    
    // JMC items for this BOQ item
    const relevantJmcItems = jmcEntries
      .flatMap((entry) =>
        (entry.items || [])
          .filter((jmcItem) => compositeKey(getScope2(jmcItem), getBoqSlNo(jmcItem)) === currentItemKey)
          .map((jmcItem) => ({ ...jmcItem, jmcNo: entry.jmcNo, jmcDate: entry.jmcDate }))
      )
      .sort((a, b) => {
        const A = toDateSafe((a as any).jmcDate)?.getTime() ?? 0;
        const B = toDateSafe((b as any).jmcDate)?.getTime() ?? 0;
        return A - B;
      });

    // MVAC items for this BOQ item
    const relevantMvacItems: MvacItemWithParent[] = mvacEntries
      .flatMap((entry) =>
        (entry.items || [])
          .filter((mvacItem) => compositeKey(getScope2(mvacItem), getBoqSlNo(mvacItem)) === currentItemKey)
          .map((mvacItem) => ({ ...mvacItem, mvacEntry: entry }))
      )
      .sort((a, b) => {
        const A = toDateSafe((a as any).mvacEntry?.mvacDate)?.getTime() ?? 0;
        const B = toDateSafe((b as any).mvacEntry?.mvacDate)?.getTime() ?? 0;
        return A - B;
      });

    // Totals
    const totalJmcExecutedQty = relevantJmcItems.reduce((s, r) => s + Number((r as any).executedQty || 0), 0);
    const totalMvacExecutedQty = relevantMvacItems.reduce((s, r) => s + Number((r as any).executedQty || 0), 0);
    const totalExecutedQty = totalJmcExecutedQty + totalMvacExecutedQty;

    const totalJmcCertifiedQty = relevantJmcItems.reduce((s, r) => s + Number((r as any).certifiedQty || 0), 0);
    const totalMvacCertifiedQty = relevantMvacItems.reduce((s, r) => s + Number((r as any).certifiedQty || 0), 0);
    const totalCertifiedQty = totalJmcCertifiedQty + totalMvacCertifiedQty;

    // Running totals for JMC
    let runningExecuted = 0;
    let runningCertified = 0;
    const jmcWithRunning: JmcRow[] = relevantJmcItems.map((r) => {
      runningExecuted += Number((r as any).executedQty || 0);
      runningCertified += Number((r as any).certifiedQty || 0);
      return {
        ...(r as any),
        runningExecuted,
        runningCertified,
      } as JmcRow;
    });

    // Running totals for MVAC
    let mvacRunExec = 0;
    let mvacRunCert = 0;
    const mvacWithRunning = relevantMvacItems.map((m) => {
        mvacRunExec += Number((m as any).executedQty || 0);
        mvacRunCert += Number((m as any).certifiedQty || 0);
        return {
          ...m,
          runningExecuted: mvacRunExec,
          runningCertified: mvacRunCert,
        } as MvacItemWithParent & { runningExecuted: number; runningCertified: number };
    });

    const relevantBillItems: BillRow[] =
      bills.flatMap((bill) =>
        (bill.items || [])
          .filter((b) => compositeKey(getScope2(b), getBoqSlNo(b)) === currentItemKey)
          .map((b) => ({ ...(b as any), billNo: bill.billNo, billDate: bill.billDate }))
      ) ?? [];

    const totalBilledQty = relevantBillItems.reduce((s, r) => s + Number(r.billedQty || 0), 0);

    return {
      boqSlNo,
      description,
      boqQty,
      scope2,
      jmcWithRunning,
      mvacWithRunning,
      totalExecutedQty,
      totalCertifiedQty,
      relevantBillItems,
      totalBilledQty,
    };
  }, [item, jmcEntries, mvacEntries, bills]);

  const handleViewJmc = (jmcNo: string) => {
    const jmc = jmcEntries.find((e) => e.jmcNo === jmcNo);
    if (jmc) {
      setSelectedJmc(jmc);
      setIsJmcViewOpen(true);
    }
  };
  
  const handleViewMvac = (mvacNo: string) => {
    const mvac = mvacEntries.find((e) => e.mvacNo === mvacNo);
    if (mvac) {
      setSelectedMvac(mvac);
      setIsMvacViewOpen(true);
    }
  };

  const toggleDialogSize = () => {
    setDialogSize((current) => {
      if (current === 'xl') return '2xl';
      if (current === '2xl') return 'full';
      return 'xl';
    });
  };

  if (!item) return null;

  const {
    boqSlNo,
    description,
    boqQty,
    scope2,
    jmcWithRunning,
    mvacWithRunning,
    totalExecutedQty,
    totalCertifiedQty,
    relevantBillItems,
    totalBilledQty,
  } = data || {};

  const dialogSizeClass =
    dialogSize === 'full' ? 'sm:max-w-[95vw]' : dialogSize === '2xl' ? 'sm:max-w-6xl' : 'sm:max-w-4xl';

  const scope2Lower = scope2?.toLowerCase();

  const quantitySummary = [
    { label: 'BOQ Quantity', value: boqQty ?? 0 },
    { label: 'JMC/MVAC Executed', value: totalExecutedQty ?? 0 },
    { label: 'JMC/MVAC Certified', value: totalCertifiedQty ?? 0 },
    { label: 'Billed Qty', value: totalBilledQty ?? 0 },
    { label: 'Balance Qty', value: (boqQty || 0) - (totalExecutedQty || 0) },
  ];

  const jmcColumns: ListColumn<JmcRow & { id: string }>[] = [
    { header: 'JMC No.', className: 'text-center', mobile: 'title', cell: (j) => j.jmcNo ?? '—' },
    { header: 'JMC Date', className: 'text-center', cell: (j) => formatDateSafe(j.jmcDate) },
    { header: 'Executed Qty', className: 'text-center', cell: (j) => j.executedQty ?? 0 },
    { header: 'Certified Qty', className: 'text-center', cell: (j) => j.certifiedQty ?? 0 },
    { header: 'Cumulative Executed', className: 'text-center', cell: (j) => j.runningExecuted ?? 0 },
    { header: 'Cumulative Certified', className: 'text-center', cell: (j) => j.runningCertified ?? 0 },
    {
      header: 'Actions',
      className: 'text-center',
      mobile: 'footer',
      cell: (j) => (
        <Button variant="ghost" size="sm" onClick={() => handleViewJmc(j.jmcNo || '')}>
          <Eye className="mr-2 h-4 w-4" />
          View
        </Button>
      ),
    },
  ];

  const mvacColumns: ListColumn<any>[] = [
    { header: 'MVAC No.', className: 'text-center', mobile: 'title', cell: (m) => m?.mvacEntry?.mvacNo ?? '—' },
    { header: 'Date', className: 'text-center', cell: (m) => formatDateSafe(m?.mvacEntry?.mvacDate) },
    { header: 'Executed Qty', className: 'text-center', cell: (m) => m?.executedQty ?? 0 },
    { header: 'Certified Qty', className: 'text-center', cell: (m) => m?.certifiedQty ?? 0 },
    { header: 'Status', className: 'text-center', mobile: 'aside', cell: (m) => m?.mvacEntry?.status ?? '—' },
    {
      header: 'Actions',
      className: 'text-center',
      mobile: 'footer',
      cell: (m) => (
        <Button variant="ghost" size="sm" onClick={() => handleViewMvac(m.mvacEntry?.mvacNo || '')}>
          <Eye className="mr-2 h-4 w-4" />View
        </Button>
      ),
    },
  ];

  const billColumns: ListColumn<BillRow & { id: string }>[] = [
    { header: 'Bill No.', className: 'text-center', mobile: 'title', cell: (b) => b.billNo ?? '—' },
    { header: 'Bill Date', className: 'text-center', cell: (b) => formatDateSafe(b.billDate) },
    { header: 'Billed Qty', className: 'text-center', cell: (b) => b.billedQty ?? 0 },
    { header: 'Total Amount', className: 'text-center', cell: (b) => formatCurrency(b.totalAmount) },
  ];

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        {/* Full-screen sheet on a phone (hr-mobile-dialog, see globals.css): the header and footer
            stay put and only the body scrolls. */}
        <DialogContent className={cn('hr-mobile-dialog h-[90vh] flex flex-col min-h-0', dialogSizeClass)}>
            <DialogHeader className="hr-dialog-header text-center shrink-0">
                <DialogTitle>Item Breakdown: Sl. No. {boqSlNo || '—'}</DialogTitle>
                <DialogDescription className="mx-auto max-w-3xl">{description || '—'}</DialogDescription>
            </DialogHeader>

            <ScrollArea className="hr-dialog-body flex-1 min-h-0 pr-6 -mr-6 max-sm:mr-0">
              {isLoading ? (
                <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : (
                <div className="space-y-6 mt-2 px-1 sm:mt-6">
                    <section>
                      <h3 className="text-base sm:text-lg font-semibold mb-2 text-center">Quantity Summary</h3>
                      {/* Five figures side by side do not fit a phone, so there they pair up as tiles. */}
                      <dl className="grid grid-cols-2 gap-2 sm:hidden">
                        {quantitySummary.map((fact, index) => (
                          <div
                            key={fact.label}
                            className={cn('rounded-md border p-3 text-center', index === quantitySummary.length - 1 && 'col-span-2')}
                          >
                            <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                            <dd className="mt-0.5 break-words text-base font-semibold">{fact.value}</dd>
                          </div>
                        ))}
                      </dl>
                      <div className="hidden border rounded-md sm:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {quantitySummary.map((fact) => (
                                <TableHead key={fact.label} className="text-center">{fact.label}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              {quantitySummary.map((fact) => (
                                <TableCell key={fact.label} className="text-center">{fact.value}</TableCell>
                              ))}
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </section>

                    <Separator />

                    { (scope2Lower === 'civil' || !scope2Lower) && (
                      <section>
                        <h3 className="text-base sm:text-lg font-semibold mb-2 text-center">JMC Breakdown</h3>
                        <div className="sm:border sm:rounded-md">
                          <DataList
                            rows={(jmcWithRunning ?? []).map((j: JmcRow, idx: number) => ({
                              ...j,
                              id: `jmc-${j.jmcNo ?? '—'}-${idx}`,
                            }))}
                            columns={jmcColumns}
                            frameless
                            tableClassName={BREAKDOWN_TABLE}
                            rowClassName={breakdownCard}
                            empty={<BreakdownEmpty>No JMC entries found for this item.</BreakdownEmpty>}
                          />
                        </div>
                      </section>
                    )}

                    { (scope2Lower === 'supply' || !scope2Lower) && (
                      <section>
                        <h3 className="text-base sm:text-lg font-semibold mb-2 text-center">MVAC Breakdown</h3>
                        <div className="sm:border sm:rounded-md">
                          <DataList
                            rows={(mvacWithRunning ?? []).map((m: any, idx: number) => ({
                              ...m,
                              id: `${m?.mvacEntry?.id ?? m?.mvacEntry?.mvacNo ?? '—'}-${idx}`,
                            }))}
                            columns={mvacColumns}
                            frameless
                            tableClassName={BREAKDOWN_TABLE}
                            rowClassName={breakdownCard}
                            empty={<BreakdownEmpty>No MVAC entries found.</BreakdownEmpty>}
                          />
                        </div>
                      </section>
                    )}

                    <Separator />

                    <section>
                      <h3 className="text-base sm:text-lg font-semibold mb-2 text-center">Billing Breakdown</h3>
                      <div className="sm:border sm:rounded-md">
                        <DataList
                          rows={(relevantBillItems ?? []).map((b: BillRow, idx: number) => ({
                            ...b,
                            id: `bill-${b.billNo ?? '—'}-${idx}`,
                          }))}
                          columns={billColumns}
                          frameless
                          tableClassName={BREAKDOWN_TABLE}
                          rowClassName={breakdownCard}
                          empty={<BreakdownEmpty>No bills found for this item.</BreakdownEmpty>}
                        />
                      </div>
                    </section>
                </div>
              )}
            </ScrollArea>

            <DialogFooter className="hr-dialog-footer mt-4 pr-4 sm:justify-between shrink-0 max-sm:mt-0 max-sm:[&>*]:col-span-2">
              <Button variant="outline" size="icon" onClick={toggleDialogSize} className="hidden sm:inline-flex">
                {dialogSize === 'full' ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </Button>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
            </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <ViewJmcEntryDialog
        isOpen={isJmcViewOpen}
        onOpenChange={setIsJmcViewOpen}
        jmcEntry={selectedJmc}
        boqItems={[]}
        bills={[]}
      />
      <ViewMvacEntryDialog
        isOpen={isMvacViewOpen}
        onOpenChange={setIsMvacViewOpen}
        MvacEntry={selectedMvac}
        boqItems={[]}
        bills={[]}
      />
    </>
  );
}
