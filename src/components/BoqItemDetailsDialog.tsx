
'use client';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
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
import type { BoqItem, JmcEntry, Bill, MvacItem, Project, MvacEntry } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { format } from 'date-fns';
import ViewJmcEntryDialog from './ViewJmcEntryDialog';
import { Eye, Maximize, Minimize, Loader2 } from 'lucide-react';
import { Timestamp, collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';

interface BoqItemDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  item: BoqItem | null;
}

// --- Robust Helper Functions ---

const formatCurrency = (amount: string | number) => {
  const num = parseFloat(String(amount));
  if (isNaN(num)) return String(amount ?? 'N/A');
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(num);
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

const formatDateSafe = (dateInput: any) => {
    const d = toDateSafe(dateInput);
    if (!d) return 'N/A';
    try {
      return format(d, 'dd MMM, yyyy');
    } catch (error) {
      return 'Invalid Date';
    }
};

const getBoqSlNo = (item: any): string => {
    if (!item) return '';
    return String(item['BOQ SL No'] || item['SL. No.'] || item.boqSlNo || '').trim();
};

const getItemDescription = (item: any): string => {
    if (!item) return '';
    return String(item.Description || item.description || item['Item Spec'] || '').trim();
}

// --- Main Component ---

export default function BoqItemDetailsDialog({
  isOpen,
  onOpenChange,
  item,
}: BoqItemDetailsDialogProps) {
  const { toast } = useToast();
  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);
  const [isJmcViewOpen, setIsJmcViewOpen] = useState(false);
  const [dialogSize, setDialogSize] = useState<'xl' | '2xl' | 'full'>('xl');
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [mvacEntries, setMvacEntries] = useState<MvacEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const fetchRelatedData = useCallback(async () => {
    if (!item?.projectSlug) return;
    setIsLoading(true);
    try {
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);
        const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
        const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === item.projectSlug);

        if (projectData) {
            const projectId = projectData.id;
            const jmcSnapshot = await getDocs(collection(db, 'projects', projectId, 'jmcEntries'));
            setJmcEntries(jmcSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry)));

            const billsSnapshot = await getDocs(collection(db, 'projects', projectId, 'bills'));
            setBills(billsSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Bill)));
            
            const mvacSnapshot = await getDocs(collection(db, 'projects', projectId, 'mvacEntries'));
            setMvacEntries(mvacSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MvacEntry)));
        }
    } catch (error) {
        console.error("Error fetching related project data:", error);
        toast({ title: 'Error', description: 'Failed to fetch related project data.', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  }, [item?.projectSlug, toast]);

  useEffect(() => {
      if (isOpen && item) {
          fetchRelatedData();
      }
  }, [isOpen, item, fetchRelatedData]);


  const handleViewJmc = (jmcNo: string) => {
    const jmc = jmcEntries.find(entry => entry.jmcNo === jmcNo);
    if (jmc) {
      setSelectedJmc(jmc);
      setIsJmcViewOpen(true);
    }
  };

  const data = useMemo(() => {
    if (!item) return null;

    const boqSlNo = getBoqSlNo(item);
    
    if (!boqSlNo) return null; 

    const description = getItemDescription(item);
    const boqQty = Number(item['Total Qty'] || item['qty'] || item['QTY'] || 0);

    const relevantJmcItems = (jmcEntries || [])
      .flatMap((entry) =>
        (entry.items || [])
          .filter((jmcItem) => getBoqSlNo(jmcItem) === boqSlNo)
          .map((jmcItem) => ({ ...jmcItem, jmcNo: entry.jmcNo, jmcDate: entry.jmcDate }))
      )
      .sort((a, b) => {
        const dateA = toDateSafe(a.jmcDate);
        const dateB = toDateSafe(b.jmcDate);
        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
      });
      
    const relevantMvacEntries = (mvacEntries || [])
      .filter((entry) => (entry.items || []).some(mvacItem => getBoqSlNo(mvacItem) === boqSlNo));
      
    const allMvacItemsForBoq = relevantMvacEntries.flatMap(entry => entry.items.filter(mvacItem => getBoqSlNo(mvacItem) === boqSlNo));

    const totalJmcExecutedQty = relevantJmcItems.reduce((sum, jmcItem) => sum + Number(jmcItem.executedQty || 0), 0);
    const totalMvacExecutedQty = allMvacItemsForBoq.reduce((sum, mvacItem) => sum + Number(mvacItem.executedQty || 0), 0);
    const totalExecutedQty = totalJmcExecutedQty + totalMvacExecutedQty;
    
    const totalJmcCertifiedQty = relevantJmcItems.reduce((sum, jmcItem) => sum + Number(jmcItem.certifiedQty || 0), 0);
    const totalMvacCertifiedQty = allMvacItemsForBoq.reduce((sum, mvacItem) => sum + Number(mvacItem.certifiedQty || 0), 0);
    const totalCertifiedQty = totalJmcCertifiedQty + totalMvacCertifiedQty;
    
    const relevantBillItems = (bills || [])
      .flatMap((bill) =>
        (bill.items || [])
          .filter((billItem) => getBoqSlNo(billItem) === boqSlNo)
          .map((billItem) => ({ ...billItem, billNo: bill.billNo, billDate: bill.billDate }))
      );

    const totalBilledQty = relevantBillItems.reduce((sum, billItem) => sum + Number(billItem.billedQty || 0), 0);
    
    let runningExecuted = 0;
    let runningCertified = 0;
    const jmcItemsWithRunningTotals = relevantJmcItems.map(jmcItem => {
        runningExecuted += Number(jmcItem.executedQty || 0);
        runningCertified += Number(jmcItem.certifiedQty || 0);
        return { ...jmcItem, runningExecuted, runningCertified };
    });

    return {
      boqSlNo, description, boqQty,
      scope2: item['Scope 2'],
      relevantJmcItems: jmcItemsWithRunningTotals,
      totalExecutedQty, totalCertifiedQty,
      relevantMvacEntries,
      relevantBillItems, totalBilledQty,
    };
  }, [item, jmcEntries, bills, mvacEntries]);
  
  const toggleDialogSize = () => {
    setDialogSize(current => current === 'xl' ? '2xl' : current === '2xl' ? 'full' : 'xl');
  };

  if (!isClient || !item) return null;

  const {
    boqSlNo, description, boqQty, scope2,
    relevantJmcItems, totalExecutedQty, totalCertifiedQty,
    relevantMvacEntries, relevantBillItems, totalBilledQty,
  } = data || {};

  const content = (
    <>
      {isLoading ? (
          <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : (
        <div className={isPanel ? 'p-4' : ''}>
          {isPanel ? (
            <div>
              <h3 className="text-lg font-semibold">Item Breakdown: Sl. No. {boqSlNo}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ) : (
            <DialogHeader>
              <DialogTitle>Item Breakdown: Sl. No. {boqSlNo}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
          )}
          <div className="space-y-6 mt-4">
            <div>
              <h3 className="text-lg font-semibold mb-2">Quantity Summary</h3>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>BOQ Quantity</TableHead>
                      <TableHead>JMC/MVAC Executed</TableHead>
                      <TableHead>JMC/MVAC Certified</TableHead>
                      <TableHead>Billed Qty</TableHead>
                      <TableHead>Balance Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>{boqQty}</TableCell>
                      <TableCell>{totalExecutedQty}</TableCell>
                      <TableCell>{totalCertifiedQty}</TableCell>
                      <TableCell>{totalBilledQty}</TableCell>
                      <TableCell>{(boqQty || 0) - (totalExecutedQty || 0)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            <Separator />

            {scope2 === 'Civil' && (
              <div>
                <h3 className="text-lg font-semibold mb-2">JMC Breakdown</h3>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader><TableRow><TableHead>JMC No.</TableHead><TableHead>JMC Date</TableHead><TableHead>Executed Qty</TableHead><TableHead>Certified Qty</TableHead><TableHead>Cumulative Executed</TableHead><TableHead>Cumulative Certified</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {relevantJmcItems && relevantJmcItems.length > 0 ? (
                        relevantJmcItems.map((jmcItem, index) => (
                          <TableRow key={`jmc-${jmcItem.jmcNo}-${index}`}>
                            <TableCell>{jmcItem.jmcNo}</TableCell><TableCell>{formatDateSafe(jmcItem.jmcDate)}</TableCell>
                            <TableCell>{jmcItem.executedQty}</TableCell><TableCell>{jmcItem.certifiedQty || 0}</TableCell>
                            <TableCell>{jmcItem.runningExecuted}</TableCell><TableCell>{jmcItem.runningCertified}</TableCell>
                            <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => handleViewJmc(jmcItem.jmcNo)}><Eye className="mr-2 h-4 w-4" /> View</Button></TableCell>
                          </TableRow>
                        ))
                      ) : (<TableRow><TableCell colSpan={7} className="text-center h-24">No JMC entries found.</TableCell></TableRow>)}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            
            {scope2 === 'Supply' && (
               <div>
                <h3 className="text-lg font-semibold mb-2">MVAC Details</h3>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader><TableRow><TableHead>MVAC No.</TableHead><TableHead>Date</TableHead><TableHead>Executed Qty</TableHead><TableHead>Certified Qty</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                       {relevantMvacEntries && relevantMvacEntries.length > 0 ? (
                        relevantMvacEntries.map((mvacEntry) => {
                            const mvacItem = mvacEntry.items.find(mi => getBoqSlNo(mi) === boqSlNo);
                            if (!mvacItem) return null;
                            return (<TableRow key={mvacEntry.id}><TableCell>{mvacEntry.mvacNo}</TableCell><TableCell>{formatDateSafe(mvacEntry.mvacDate)}</TableCell><TableCell>{mvacItem.executedQty}</TableCell><TableCell>{mvacItem.certifiedQty || 0}</TableCell><TableCell>{mvacEntry.status}</TableCell></TableRow>)
                        })
                      ) : (<TableRow><TableCell colSpan={5} className="text-center h-24">No MVAC entries found.</TableCell></TableRow>)}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <Separator />

            <div>
              <h3 className="text-lg font-semibold mb-2">Billing Breakdown</h3>
              <div className="border rounded-md">
                <Table>
                  <TableHeader><TableRow><TableHead>Bill No.</TableHead><TableHead>Bill Date</TableHead><TableHead>Billed Qty</TableHead><TableHead>Total Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {relevantBillItems && relevantBillItems.length > 0 ? (
                      relevantBillItems.map((billItem, index) => (
                        <TableRow key={`bill-${billItem.billNo}-${index}`}>
                          <TableCell>{billItem.billNo}</TableCell><TableCell>{formatDateSafe(billItem.billDate)}</TableCell>
                          <TableCell>{billItem.billedQty}</TableCell><TableCell>{formatCurrency(billItem.totalAmount)}</TableCell>
                        </TableRow>
                      ))
                    ) : (<TableRow><TableCell colSpan={4} className="text-center h-24">No bills found.</TableCell></TableRow>)}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      )}
      <ViewJmcEntryDialog isOpen={isJmcViewOpen} onOpenChange={setIsJmcViewOpen} jmcEntry={selectedJmc} boqItems={[]} bills={[]} />
    </>
  );

  if (isPanel) {
    return <>{content}</>;
  }

  const dialogSizeClass =
    dialogSize === 'full' ? 'sm:max-w-[95vw]' :
    dialogSize === '2xl' ? 'sm:max-w-6xl' :
    'sm:max-w-4xl';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={cn("sm:max-w-4xl", dialogSizeClass)}>
        <ScrollArea className="max-h-[70vh] p-1 pr-4">{content}</ScrollArea>
        <DialogFooter className="mt-4 pr-4 sm:justify-between">
            <Button variant="outline" size="icon" onClick={toggleDialogSize} className="hidden sm:inline-flex">
                {dialogSize === 'full' ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
