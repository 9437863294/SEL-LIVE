
'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams, notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { JmcEntry, JmcItem, Project, Signature } from '@/lib/types';
import { format } from 'date-fns';
import { Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, getDocs } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';

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

type EnrichedJmcItem = JmcItem & {
    boqQty: number;
    previousCertifiedQty: number;
};

const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

const PrintableJmcStyles = () => (
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
      #printable-jmc-sheet {
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
      .desc-cell { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal; }
      .no-print { display: none !important; }
      .signatures { page-break-inside: avoid; }
    }
  `}</style>
);


export default function PrintJmcPage() {
    const params = useParams();
    const { toast } = useToast();
    const { project: projectSlug, jmcId } = params as { project: string, jmcId: string };
    const [jmcEntry, setJmcEntry] = useState<JmcEntry | null>(null);
    const [project, setProject] = useState<(Project & {signatures?: any[]}) | null>(null);
    const [enrichedItems, setEnrichedItems] = useState<EnrichedJmcItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchPrintData = async () => {
            if (!projectSlug || !jmcId) return;
            setIsLoading(true);
            try {
                const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
                const projectData = projectsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);
                
                if (!projectData) throw new Error("Project not found.");
                setCurrentProject(projectData);

                const jmcDocRef = doc(db, 'projects', projectData.id, 'jmcEntries', jmcId);
                const jmcDocSnap = await getDoc(jmcDocRef);
                if (!jmcDocSnap.exists()) throw new Error("JMC not found.");
                const entry = { id: jmcDocSnap.id, ...jmcDocSnap.data() } as JmcEntry;
                setJmcEntry(entry);
                
                // You will need to pass BOQ Items and other context if needed for enrichment
                // For now, let's assume enrichment happens on the client from basic data
                const enriched = (entry.items || []).map(item => ({
                    ...item,
                    boqQty: 0, // Placeholder
                    previousCertifiedQty: 0, // Placeholder
                }));
                setEnrichedItems(enriched);
            } catch(e) {
                console.error(e);
                toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        };
        fetchPrintData();
    }, [projectSlug, jmcId, toast]);

    useEffect(() => {
      if (!isLoading && jmcEntry) {
        // Trigger print dialog automatically after content has rendered
        setTimeout(() => window.print(), 500);
      }
    }, [isLoading, jmcEntry]);

    const calculateUpToDateQty = (item: EnrichedJmcItem) => (Number(item.previousCertifiedQty) || 0) + (Number(item.executedQty) || 0);

    if (isLoading) {
        return <div className="p-8"><Skeleton className="h-[80vh]" /></div>;
    }
    if (!jmcEntry) {
        return <div className="p-8">JMC Entry not found.</div>;
    }
    
    const workDetails = {
        orderNo: project?.woNo || 'N/A',
        projectName: project?.projectDescription || project?.projectName || 'N/A',
        projectSite: project?.projectSite || 'N/A',
        jmcDate: formatDateSafe(jmcEntry.jmcDate),
        jmcNo: jmcEntry.jmcNo,
    };
    
    const getDisplayValue = (v: number | undefined) => (v === 0 ? 0 : v ?? '');

    return (
        <>
            <PrintableJmcStyles />
            <div className="bg-white">
                <div id="printable-jmc-sheet">
                  {/* Header */}
                   <div className="text-center">
                        <p className="text-lg font-extrabold">SIDDHARTHA ENGINEERING LIMITED</p>
                        <p className="text-[7pt] font-semibold">ELECTRICAL ENGINEERS, CONTRACTORS (EHV) & CONSULTANTS</p>
                        <p className="text-[7pt]">PLOT NO.1015, NAYAPALLI, N.H.5, BHUBANESWAR - 751012 (ODISHA)</p>
                        <p className="text-[7pt]">Phone: 0674-2561911-914, 3291287, Fax: 0674-2561915</p>
                        <p className="text-[7pt]">E-mail: sel.techhead@gmail.com</p>
                    </div>

                    <p className="text-center font-bold text-sm border-y-2 border-black py-1 my-2">
                      JOINT MEASUREMENT CERTIFICATE FOR
                    </p>

                    <div className="text-[9pt] space-y-1 mb-2 border border-black p-2">
                      <div className="flex justify-between">
                        <span><strong>JMC No.:</strong> {workDetails.jmcNo}</span>
                        <span><strong>DATE:</strong> {workDetails.jmcDate}</span>
                      </div>
                      <p><strong>Order No.</strong> {workDetails.orderNo}</p>
                      <p><strong>Name of the project:-</strong> {workDetails.projectName}</p>
                      <p><strong>Project Site :</strong> {workDetails.projectSite}</p>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto border border-black">
                      <Table className="w-full table-auto text-[8pt]">
                        <TableHeader>
                          <TableRow>
                            <TableHead rowSpan={2} className="w-[4%] border-black text-center align-middle">SL. NO.</TableHead>
                            <TableHead rowSpan={2} className="w-[28%] border-black text-center align-middle">Description of Items</TableHead>
                            <TableHead rowSpan={2} className="w-[6%] border-black text-center align-middle">Unit</TableHead>
                            <TableHead rowSpan={2} className="w-[8%] border-black text-center align-middle">BOQ Qty</TableHead>
                            <TableHead colSpan={3} className="border-black text-center font-bold">QNTY EXECUTED</TableHead>
                          </TableRow>
                          <TableRow>
                            <TableHead className="w-[8%] border-black text-center">Up to Previous</TableHead>
                            <TableHead className="w-[8%] border-black text-center">In this JMC</TableHead>
                            <TableHead className="w-[8%] border-black text-center">Up to date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {enrichedItems.map((item, index) => {
                            const upToDateQty = calculateUpToDateQty(item);
                            return (
                              <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
                                <TableCell className="text-center border-black">{item.boqSlNo ?? '-'}</TableCell>
                                <TableCell className="border-black"><div className="desc-cell">{item.description ?? '-'}</div></TableCell>
                                <TableCell className="text-center border-black">{item.unit ?? '-'}</TableCell>
                                <TableCell className="text-right border-black">{getDisplayValue(item.boqQty)}</TableCell>
                                <TableCell className="text-right border-black">{getDisplayValue(item.previousCertifiedQty)}</TableCell>
                                <TableCell className="text-right border-black">{getDisplayValue(item.executedQty)}</TableCell>
                                <TableCell className="text-right border-black">{getDisplayValue(upToDateQty)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="signatures flex justify-between mt-16 text-[9pt] px-4">
                      <div className="w-1/3 text-center">
                          <p className="border-t border-black pt-1 mt-8">Site In charge</p>
                          <p className="font-bold">{project?.projectSite}</p>
                      </div>
                    </div>
                </div>
            </div>
        </>
    );
}

```</content>
  </change>
  <change>
    <file>/home/user/studio/src/app/billing-recon/[project]/mvac/[mvacId]/print/page.tsx</file>
    <content><![CDATA[
'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams, notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MvacEntry, MvacItem, Project, Signature } from '@/lib/types';
import { format } from 'date-fns';
import { Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, getDocs } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';

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

type EnrichedMvacItem = MvacItem & {
    boqQty: number;
    previousCertifiedQty: number;
};

const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

const PrintableMvacStyles = () => (
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
      #printable-mvac-sheet {
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
      .desc-cell { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal; }
      .no-print { display: none !important; }
      .signatures { page-break-inside: avoid; }
    }
  `}</style>
);


export default function PrintMvacPage() {
    const params = useParams();
    const { toast } = useToast();
    const { project: projectSlug, mvacId } = params as { project: string, mvacId: string };
    const [mvacEntry, setMvacEntry] = useState<MvacEntry | null>(null);
    const [project, setProject] = useState<(Project & {signatures?: any[]}) | null>(null);
    const [enrichedItems, setEnrichedItems] = useState<EnrichedMvacItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchPrintData = async () => {
            if (!projectSlug || !mvacId) return;
            setIsLoading(true);
            try {
                const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
                const projectData = projectsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);
                
                if (!projectData) throw new Error("Project not found.");
                setProject(projectData);

                const mvacDocRef = doc(db, 'projects', projectData.id, 'mvacEntries', mvacId);
                const mvacDocSnap = await getDoc(mvacDocRef);
                if (!mvacDocSnap.exists()) throw new Error("MVAC not found.");
                const entry = { id: mvacDocSnap.id, ...mvacDocSnap.data() } as MvacEntry;
                setMvacEntry(entry);
                
                const enriched = (entry.items || []).map(item => ({
                    ...item,
                    boqQty: 0, // Placeholder
                    previousCertifiedQty: 0, // Placeholder
                }));
                setEnrichedItems(enriched);
            } catch(e) {
                console.error(e);
                toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        };
        fetchPrintData();
    }, [projectSlug, mvacId, toast]);

    useEffect(() => {
      if (!isLoading && mvacEntry) {
        setTimeout(() => window.print(), 500);
      }
    }, [isLoading, mvacEntry]);

    const calculateUpToDateQty = (item: EnrichedMvacItem) => (Number(item.previousCertifiedQty) || 0) + (Number(item.executedQty) || 0);

    if (isLoading) {
        return <div className="p-8"><Skeleton className="h-[80vh]" /></div>;
    }
    if (!mvacEntry) {
        return <div className="p-8">MVAC Entry not found.</div>;
    }
    
    const workDetails = {
        orderNo: project?.woNo || 'N/A',
        projectName: project?.projectDescription || project?.projectName || 'N/A',
        projectSite: project?.projectSite || 'N/A',
        mvacDate: formatDateSafe(mvacEntry.mvacDate),
        mvacNo: mvacEntry.mvacNo,
    };
    
    const getDisplayValue = (v: number | undefined) => (v === 0 ? 0 : v ?? '');

    return (
        <>
            <PrintableMvacStyles />
            <div className="bg-white">
                <div id="printable-mvac-sheet">
                   <div className="text-center">
                        <p className="text-lg font-extrabold">SIDDHARTHA ENGINEERING LIMITED</p>
                        <p className="text-[7pt] font-semibold">ELECTRICAL ENGINEERS, CONTRACTORS (EHV) & CONSULTANTS</p>
                        <p className="text-[7pt]">PLOT NO.1015, NAYAPALLI, N.H.5, BHUBANESWAR - 751012 (ODISHA)</p>
                        <p className="text-[7pt]">Phone: 0674-2561911-914, 3291287, Fax: 0674-2561915</p>
                        <p className="text-[7pt]">E-mail: sel.techhead@gmail.com</p>
                    </div>

                    <p className="text-center font-bold text-sm border-y-2 border-black py-1 my-2">
                      MATERIAL VERIFICATION AND ACCEPTANCE CERTIFICATE
                    </p>

                    <div className="text-[9pt] space-y-1 mb-2 border border-black p-2">
                      <div className="flex justify-between">
                        <span><strong>MVAC No.:</strong> {workDetails.mvacNo}</span>
                        <span><strong>DATE:</strong> {workDetails.mvacDate}</span>
                      </div>
                      <p><strong>Order No.</strong> {workDetails.orderNo}</p>
                      <p><strong>Name of the project:-</strong> {workDetails.projectName}</p>
                      <p><strong>Project Site :</strong> {workDetails.projectSite}</p>
                    </div>

                    <div className="overflow-x-auto border border-black">
                      <Table className="w-full table-auto text-[8pt]">
                        <TableHeader>
                          <TableRow>
                            <TableHead rowSpan={2} className="w-[4%] border-black text-center align-middle">SL. NO.</TableHead>
                            <TableHead rowSpan={2} className="w-[28%] border-black text-center align-middle">Description of Items</TableHead>
                            <TableHead rowSpan={2} className="w-[6%] border-black text-center align-middle">Unit</TableHead>
                            <TableHead rowSpan={2} className="w-[8%] border-black text-center align-middle">BOQ Qty</TableHead>
                            <TableHead colSpan={3} className="border-black text-center font-bold">QNTY EXECUTED</TableHead>
                          </TableRow>
                          <TableRow>
                            <TableHead className="w-[8%] border-black text-center">Up to Previous</TableHead>
                            <TableHead className="w-[8%] border-black text-center">In this MVAC</TableHead>
                            <TableHead className="w-[8%] border-black text-center">Up to date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {enrichedItems.map((item, index) => {
                            const upToDateQty = calculateUpToDateQty(item);
                            return (
                              <TableRow key={`${item.boqSlNo ?? 'NA'}-${index}`}>
                                <TableCell className="text-center border-black">{item.boqSlNo ?? '-'}</TableCell>
                                <TableCell className="border-black"><div className="desc-cell">{item.description ?? '-'}</div></TableCell>
                                <TableCell className="text-center border-black">{item.unit ?? '-'}</TableCell>
                                <TableCell className="text-right border-black">{getDisplayValue(item.boqQty)}</TableCell>
                                <TableCell className="text-right border-black">{getDisplayValue(item.previousCertifiedQty)}</TableCell>
                                <TableCell className="text-right border-black">{getDisplayValue(item.executedQty)}</TableCell>
                                <TableCell className="text-right border-black">{getDisplayValue(upToDateQty)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="signatures flex justify-between mt-16 text-[9pt] px-4">
                      <div className="w-1/3 text-center">
                          <p className="border-t border-black pt-1 mt-8">Site In charge</p>
                          <p className="font-bold">{project?.projectSite}</p>
                      </div>
                    </div>
                </div>
            </div>
        </>
    );
}
```</content>
  </change>
  <change>
    <file>/home/user/studio/src/components/ViewJmcEntryDialog.tsx</file>
    <content><![CDATA[
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
import { collection, getDocs, doc, updateDoc, writeBatch, Timestamp, runTransaction, getDoc } from 'firebase/firestore';
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
  const [projectJmcEntries, setProjectJmcEntries] = useState<JmcEntry[]>([]);
  const [dialogSize, setDialogSize] = useState<'xl' | '2xl' | 'full'>('xl');
  const [currentProject, setCurrentProject] = useState<(Project & {signatures?: any[]}) | null>(null);

  // refs for split-axis scrolling
  const xScrollRef = useRef<HTMLDivElement | null>(null);     // inner container that actually scrolls horizontally (contains table)
  const hBarRef = useRef<HTMLDivElement | null>(null);        // fixed bottom horizontal scrollbar
  const hBarInnerRef = useRef<HTMLDivElement | null>(null);   // spacer that mirrors content scrollWidth

  useEffect(() => {
    setEditableItems(jmcEntry?.items ? (JSON.parse(JSON.stringify(jmcEntry.items)) as JmcItem[]) : []);
  }, [jmcEntry, isOpen]);

  useEffect(() => {
    const fetchProjectData = async () => {
      const projectId = (jmcEntry as any)?.projectId || undefined;
      if (!projectId) {
        setProjectJmcEntries([]);
        setCurrentProject(null);
        return;
      }
      try {
        const [projectSnap, jmcSnap] = await Promise.all([
            getDoc(doc(db, 'projects', projectId)),
            getDocs(collection(db, 'projects', projectId, 'jmcEntries'))
        ]);
        
        if (projectSnap.exists()) {
            setCurrentProject({ id: projectSnap.id, ...projectSnap.data() } as Project);
        }

        const all = jmcSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry));
        setProjectJmcEntries(all);
      } catch (e) {
        console.error('Failed to load project JMCs:', e);
        setProjectJmcEntries([]);
      }
    };
    if (isOpen && jmcEntry) {
      fetchProjectData();
    }
  }, [jmcEntry, isOpen]);

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
      : 'sm:max-w-4xl';

  // columns and min table width (to force horizontal overflow when needed)
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
  
  const toggleDialogSize = () => {
    setDialogSize(current => {
      if (current === 'xl') return '2xl';
      if (current === '2xl') return 'full';
      return 'xl';
    });
  };

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
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain rounded-t-md border">
            {!hasJmc ? (
              <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                No JMC selected.
              </div>
            ) : (
              // This element actually scrolls horizontally.
              <div ref={xScrollRef} className="w-full overflow-x-auto no-scrollbar">
                <Table className="w-full table-fixed" style={{ minWidth: `${tableMinWidthRem}rem` }}>
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

                  {/* Sticky header */}
                  <TableHeader className="sticky top-0 z-20 bg-background shadow-sm">
                    <TableRow>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">BOQ Sl. No.</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">Description</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">Unit</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">BOQ Qty</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">Rate</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">Prev. Certified</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">Executed in this JMC</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">Certified in this JMC</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">Up to Date Certified Qty</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">Amount Executed</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center text-[11px] px-2">Amount Certified</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>{rows}</TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Dedicated horizontal scrollbar, docked at dialog bottom */}
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
                 <Link href={`/billing-recon/${projectSlug}/jmc/${jmcEntry?.id}/print`} target="_blank">
                    <Button variant="outline" disabled={!hasJmc}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print
                    </Button>
                </Link>
                 <Button variant="outline" size="icon" onClick={toggleDialogSize}>
                    {dialogSize === 'full' ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button variant="outline">Close</Button>
                </DialogClose>
                {isEditMode && (
                  <Button onClick={handleSaveChanges} disabled={isLoading || !hasJmc}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save & Verify
                  </Button>
                )}
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```</content>
  </change>
  <change>
    <file>/home/user/studio/src/components/PrintJmcDialog.tsx</file>
    <content><![CDATA[