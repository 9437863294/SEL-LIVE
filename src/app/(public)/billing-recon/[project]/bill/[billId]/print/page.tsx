
'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Bill, Project, WorkOrder, Subcontractor } from '@/lib/types';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, getDocs } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';

/* ---------- Helpers ---------- */

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

const formatDateSafe = (dateInput: any) => {
  const d = toDateSafe(dateInput);
  if (!d) return 'N/A';
  try {
    return format(d, 'dd.MM.yyyy');
  } catch {
    return 'Invalid Date';
  }
};

const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return String(amount || '0');
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
}

/* ---------- Print Styles ---------- */

const PrintableStyles = () => (
  <style>{`
    @media print {
      @page {
        size: A4 portrait;
        margin: 0;
      }
      html, body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        margin: 0;
        padding: 0;
        background: #fff !important;
      }
      #printable-sheet {
        padding: 10mm;
        width: 210mm;
        height: 297mm;
        box-sizing: border-box;
      }
      body { zoom: 0.95; }
      table { width: 100%; border-collapse: collapse; border: 1px solid #000; page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
      th, td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; font-size: 9pt; }
      th { font-weight: bold; text-align: center; }
      .no-print { display: none !important; }
      .signatures { page-break-inside: avoid; }
    }
  `}</style>
);

/* ---------- Component ---------- */

export default function PrintBillPage() {
  const params = useParams();
  const { toast } = useToast();

  const { project: projectSlug, billId } = params as {
    project: string;
    billId: string;
  };

  const [bill, setBill] = useState<Bill | null>(null);
  const [project, setProject] = useState<(Project & { signatures?: any[] }) | null>(null);
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [subcontractor, setSubcontractor] = useState<Subcontractor | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /* ----- Fetch data ----- */
  useEffect(() => {
    const fetchPrintData = async () => {
      if (!projectSlug || !billId) return;

      setIsLoading(true);
      try {
        const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
        const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
        const projectData = projectsSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() } as Project))
          .find((p) => slugify(p.projectName) === projectSlug);

        if (!projectData) throw new Error('Project not found.');
        setProject(projectData);

        const billDocRef = doc(db, 'projects', projectData.id, 'bills', billId);
        const billDocSnap = await getDoc(billDocRef);
        if (!billDocSnap.exists()) throw new Error('Bill not found.');
        const billData = { id: billDocSnap.id, ...billDocSnap.data() } as Bill;
        setBill(billData);
        
        const woDocRef = doc(db, 'projects', projectData.id, 'workOrders', billData.workOrderId!);
        const woDocSnap = await getDoc(woDocRef);
        if(woDocSnap.exists()) setWorkOrder(woDocSnap.data() as WorkOrder);

        const subDocRef = doc(db, 'projects', projectData.id, 'subcontractors', woDocSnap.data()?.subcontractorId);
        const subDocSnap = await getDoc(subDocRef);
        if(subDocSnap.exists()) setSubcontractor(subDocSnap.data() as Subcontractor);

      } catch (e) {
        console.error(e);
        toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchPrintData();
  }, [projectSlug, billId, toast]);

  /* ----- Auto-print when ready ----- */
  useEffect(() => {
    if (!isLoading && bill) {
      const id = setTimeout(() => {
        if (typeof window !== 'undefined') window.print();
      }, 500);
      return () => clearTimeout(id);
    }
  }, [isLoading, bill]);
  
  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-[80vh]" /></div>;
  }

  if (!bill) {
    return <div className="p-8">Bill not found.</div>;
  }

  const workDetails = {
    orderNo: bill.workOrderNo || 'N/A',
    projectName: project?.projectName || 'N/A',
    projectSite: project?.projectSite || 'N/A',
    billDate: formatDateSafe(bill.billDate),
    billNo: bill.billNo,
  };

  return (
    <>
      <PrintableStyles />
      <div className="bg-white">
        <div id="printable-sheet">
          <div className="text-center">
            <h1 className="text-lg font-extrabold">BILL</h1>
          </div>
          
          <div className="text-[9pt] space-y-1 mb-2 mt-4 border border-black p-2">
            <p><strong>Work Order No:</strong> {workDetails.orderNo}</p>
            <p><strong>Subcontractor:</strong> {subcontractor?.legalName || 'N/A'}</p>
            <p><strong>Name of the project:</strong> {workDetails.projectName}</p>
            <div className="flex justify-between">
              <span><strong>Bill No.:</strong> {workDetails.billNo}</span>
              <span><strong>DATE:</strong> {workDetails.billDate}</span>
            </div>
          </div>
          
          <div className="overflow-x-auto border border-black">
            <Table className="w-full table-auto text-[8pt]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[8%] border-black text-center">JMC No.</TableHead>
                  <TableHead className="w-[8%] border-black text-center">Sl. No.</TableHead>
                  <TableHead className="w-[42%] border-black text-center">Description of Item</TableHead>
                  <TableHead className="w-[8%] border-black text-center">Unit</TableHead>
                  <TableHead className="w-[10%] border-black text-center">Quantity</TableHead>
                  <TableHead className="w-[12%] border-black text-center">Rate</TableHead>
                  <TableHead className="w-[15%] border-black text-center">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.items.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell className="text-center border-black">{item.jmcNo}</TableCell>
                    <TableCell className="text-center border-black">{item.boqSlNo}</TableCell>
                    <TableCell className="border-black">{item.description}</TableCell>
                    <TableCell className="text-center border-black">{item.unit}</TableCell>
                    <TableCell className="text-right border-black">{item.billedQty}</TableCell>
                    <TableCell className="text-right border-black">{formatCurrency(item.rate)}</TableCell>
                    <TableCell className="text-right border-black">{formatCurrency(item.totalAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          <div className="flex justify-end mt-2">
            <div className="w-1/3 text-[9pt]">
                <Table>
                    <TableBody>
                        <TableRow><TableCell className="font-bold">Subtotal</TableCell><TableCell className="text-right font-bold">{formatCurrency(bill.subtotal)}</TableCell></TableRow>
                        <TableRow><TableCell>GST ({bill.gstPercentage || 'Manual'})</TableCell><TableCell className="text-right">{formatCurrency(bill.gstAmount)}</TableCell></TableRow>
                        <TableRow><TableCell className="font-bold">Gross Amount</TableCell><TableCell className="text-right font-bold">{formatCurrency(bill.grossAmount)}</TableCell></TableRow>
                        <TableRow><TableCell className="text-red-600">Retention</TableCell><TableCell className="text-right text-red-600">-{formatCurrency(bill.retentionAmount)}</TableCell></TableRow>
                        {(bill.advanceDeductions || []).map((adv, i) => (
                           <TableRow key={i}><TableCell className="text-red-600">Advance (Ref: {adv.reference})</TableCell><TableCell className="text-right text-red-600">-{formatCurrency(adv.amount)}</TableCell></TableRow>
                        ))}
                        {bill.otherDeduction > 0 && <TableRow><TableCell className="text-red-600">Other Deductions</TableCell><TableCell className="text-right text-red-600">-{formatCurrency(bill.otherDeduction)}</TableCell></TableRow>}
                        <TableRow><TableCell className="font-bold border-t-2 border-black">Net Payable</TableCell><TableCell className="text-right font-bold border-t-2 border-black">{formatCurrency(bill.netPayable)}</TableCell></TableRow>
                    </TableBody>
                </Table>
            </div>
          </div>
          
          <div className="signatures flex justify-between mt-16 text-[9pt] px-4">
             {(project?.signatures || []).map(
              (sig: any, index: number) => (
                <div
                  key={sig.id || index}
                  className="w-1/3 text-center"
                >
                  <p className="border-t border-black pt-1 mt-8">
                    {sig.designation}
                  </p>
                  <p className="font-bold">
                    {sig.name}
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </>
  );
}
