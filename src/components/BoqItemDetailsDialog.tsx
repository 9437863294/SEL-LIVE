
'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { format } from 'date-fns';
import ViewJmcEntryDialog from './ViewJmcEntryDialog';
import { Eye, Maximize, Minimize, Loader2 } from 'lucide-react';
import { Timestamp, collection, getDocs, query } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import ViewMvacEntryDialog from './ViewMvacEntryDialog';


/* ---------- Props ---------- */
interface BoqItemDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  item: BoqItem | null;
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

const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

const compositeKey = (scope2: unknown, slNo: unknown) =>
  `${String(scope2 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;

/* ---------- Component ---------- */

export default function BoqItemDetailsDialog({ isOpen, onOpenChange, item }: BoqItemDetailsDialogProps) {
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
    if (!item?.projectSlug) return;
    setIsLoading(true);
    try {
      const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
      const projectData = projectsSnapshot.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) } as Project))
        .find((p) => slugify((p as any).projectName || '') === item.projectSlug);

      if (!projectData) {
        throw new Error('Project not found for this BOQ item.');
      }

      const projectId = (projectData as any).id;

      const [jmcSnapshot, billsSnapshot, mvacSnapshot] = await Promise.all([
        getDocs(collection(db, 'projects', projectId, 'jmcEntries')),
        getDocs(collection(db, 'projects', projectId, 'bills')),
        getDocs(collection(db, 'projects', projectId, 'mvacEntries')),
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
  }, [item?.projectSlug, toast]);

  useEffect(() => {
    if (isOpen && item?.projectSlug) {
      fetchRelatedData();
    } else {
        setJmcEntries([]);
        setBills([]);
        setMvacEntries([]);
    }
  }, [isOpen, item?.projectSlug, fetchRelatedData]);

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

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={cn('h-[90vh] flex flex-col overflow-hidden', dialogSizeClass)}>
            <DialogHeader className="text-center shrink-0">
                <DialogTitle>Item Breakdown: Sl. No. {boqSlNo || '—'}</DialogTitle>
                <DialogDescription className="mx-auto max-w-3xl">{description || '—'}</DialogDescription>
            </DialogHeader>

            <ScrollArea className="h-[70vh] p-1 pr-4">
              {isLoading ? (
                <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : (
                <div className="space-y-6 mt-6 px-4">
                    <section>
                      <h3 className="text-lg font-semibold mb-2 text-center">Quantity Summary</h3>
                      <div className="border rounded-md">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-center">BOQ Quantity</TableHead>
                              <TableHead className="text-center">JMC/MVAC Executed</TableHead>
                              <TableHead className="text-center">JMC/MVAC Certified</TableHead>
                              <TableHead className="text-center">Billed Qty</TableHead>
                              <TableHead className="text-center">Balance Qty</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell className="text-center">{boqQty ?? 0}</TableCell>
                              <TableCell className="text-center">{totalExecutedQty ?? 0}</TableCell>
                              <TableCell className="text-center">{totalCertifiedQty ?? 0}</TableCell>
                              <TableCell className="text-center">{totalBilledQty ?? 0}</TableCell>
                              <TableCell className="text-center">{(boqQty || 0) - (totalExecutedQty || 0)}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </section>
                    
                    <Separator />

                    {(scope2Lower === 'civil' || (jmcWithRunning?.length ?? 0) > 0) && (
                      <section>
                        <h3 className="text-lg font-semibold mb-2 text-center">JMC Breakdown</h3>
                        <div className="border rounded-md">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-center">JMC No.</TableHead>
                                <TableHead className="text-center">JMC Date</TableHead>
                                <TableHead className="text-center">Executed Qty</TableHead>
                                <TableHead className="text-center">Certified Qty</TableHead>
                                <TableHead className="text-center">Cumulative Executed</TableHead>
                                <TableHead className="text-center">Cumulative Certified</TableHead>
                                <TableHead className="text-center">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {jmcWithRunning?.length ? (
                                jmcWithRunning.map((j: JmcRow, idx: number) => (
                                  <TableRow key={`jmc-${j.jmcNo ?? '—'}-${idx}`}>
                                    <TableCell className="text-center">{j.jmcNo ?? '—'}</TableCell>
                                    <TableCell className="text-center">{formatDateSafe(j.jmcDate)}</TableCell>
                                    <TableCell className="text-center">{j.executedQty ?? 0}</TableCell>
                                    <TableCell className="text-center">{j.certifiedQty ?? 0}</TableCell>
                                    <TableCell className="text-center">{j.runningExecuted ?? 0}</TableCell>
                                    <TableCell className="text-center">{j.runningCertified ?? 0}</TableCell>
                                    <TableCell className="text-center">
                                      <Button variant="ghost" size="sm" onClick={() => handleViewJmc(j.jmcNo || '')}>
                                        <Eye className="mr-2 h-4 w-4" />
                                        View
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))
                              ) : (
                                <TableRow>
                                  <TableCell colSpan={7} className="text-center h-24">No JMC entries found for this item.</TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </section>
                    )}
                    
                    {(scope2Lower === 'supply' || (mvacWithRunning?.length ?? 0) > 0) && (
                      <section>
                        <h3 className="text-lg font-semibold mb-2 text-center">MVAC Breakdown</h3>
                        <div className="border rounded-md">
                           <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-center">MVAC No.</TableHead>
                                    <TableHead className="text-center">Date</TableHead>
                                    <TableHead className="text-center">Executed Qty</TableHead>
                                    <TableHead className="text-center">Certified Qty</TableHead>
                                    <TableHead className="text-center">Status</TableHead>
                                    <TableHead className="text-center">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {mvacWithRunning?.length ? (
                                    mvacWithRunning.map((m: any, idx: number) => (
                                        <TableRow key={m?.mvacEntry?.id ?? `${m?.mvacEntry?.mvacNo ?? '—'}-${idx}`}>
                                            <TableCell className="text-center">{m?.mvacEntry?.mvacNo ?? '—'}</TableCell>
                                            <TableCell className="text-center">{formatDateSafe(m?.mvacEntry?.mvacDate)}</TableCell>
                                            <TableCell className="text-center">{m?.executedQty ?? 0}</TableCell>
                                            <TableCell className="text-center">{m?.certifiedQty ?? 0}</TableCell>
                                            <TableCell className="text-center">{m?.mvacEntry?.status ?? '—'}</TableCell>
                                            <TableCell className="text-center">
                                                <Button variant="ghost" size="sm" onClick={() => handleViewMvac(m.mvacEntry?.mvacNo || '')}>
                                                    <Eye className="mr-2 h-4 w-4" />View
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow><TableCell colSpan={6} className="text-center h-24">No MVAC entries found.</TableCell></TableRow>
                                )}
                            </TableBody>
                           </Table>
                        </div>
                      </section>
                    )}

                    <Separator />

                    <section>
                      <h3 className="text-lg font-semibold mb-2 text-center">Billing Breakdown</h3>
                      <div className="border rounded-md">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-center">Bill No.</TableHead>
                              <TableHead className="text-center">Bill Date</TableHead>
                              <TableHead className="text-center">Billed Qty</TableHead>
                              <TableHead className="text-center">Total Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {relevantBillItems?.length ? (
                              relevantBillItems.map((b: BillRow, idx: number) => (
                                <TableRow key={`bill-${b.billNo ?? '—'}-${idx}`}>
                                  <TableCell className="text-center">{b.billNo ?? '—'}</TableCell>
                                  <TableCell className="text-center">{formatDateSafe(b.billDate)}</TableCell>
                                  <TableCell className="text-center">{b.billedQty ?? 0}</TableCell>
                                  <TableCell className="text-center">{formatCurrency(b.totalAmount)}</TableCell>
                                </TableRow>
                              ))
                            ) : (
                              <TableRow><TableCell colSpan={4} className="text-center h-24">No bills found for this item.</TableCell></TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </section>
                </div>
              )}
            </ScrollArea>
            
            <DialogFooter className="mt-4 pr-4 sm:justify-between shrink-0">
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

    