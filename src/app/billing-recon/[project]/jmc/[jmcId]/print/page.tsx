
'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams, notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { JmcEntry, JmcItem, Project, Signature, BoqItem } from '@/lib/types';
import { format } from 'date-fns';
import { Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, getDocs, where } from 'firebase/firestore';
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

const getScope1 = (item: any): string | undefined => {
  if (!item) return undefined;
  const key = Object.keys(item).find(k => k.toLowerCase().replace(/\s+|\./g, '') === 'scope1');
  return key ? String(item[key] || '') : undefined;
}
const getScope2 = (item: any): string | undefined => {
  if (!item) return undefined;
  const key = Object.keys(item).find(k => k.toLowerCase().replace(/\s+/g, '') === 'scope2');
  return key ? String(item[key] || '') : undefined;
}
const getBoqSlNo = (item: any): string => String(item?.['BOQ SL No'] ?? item?.['SL. No.'] ?? item?.boqSlNo ?? '').trim();
const compositeKey = (scope1: unknown, scope2: unknown, slNo: unknown) =>
  `${String(scope1 ?? '').trim().toLowerCase()}__${String(scope2 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;


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
                setProject(projectData);

                const jmcDocRef = doc(db, 'projects', projectData.id, 'jmcEntries', jmcId);
                const jmcDocSnap = await getDoc(jmcDocRef);
                if (!jmcDocSnap.exists()) throw new Error("JMC not found.");
                const entry = { id: jmcDocSnap.id, ...jmcDocSnap.data() } as JmcEntry;
                setJmcEntry(entry);
                
                const allJmcsSnap = await getDocs(query(collection(db, 'projects', projectData.id, 'jmcEntries')));
                const allJmcEntries = allJmcsSnap.docs.map(d => d.data() as JmcEntry);
                
                const boqSnap = await getDocs(query(collection(db, 'projects', projectData.id, 'boqItems')));
                const boqItemsMap = new Map<string, BoqItem>();
                boqSnap.docs.forEach(doc => {
                    const item = doc.data() as BoqItem;
                    const key = compositeKey(getScope1(item), getScope2(item), getBoqSlNo(item));
                    if (key) {
                        boqItemsMap.set(key, item);
                    }
                });

                const currentEntryDate = toDateSafe(entry.jmcDate);
                
                const enriched = (entry.items || []).map(item => {
                    const itemScope1 = getScope1(item);
                    const itemScope2 = getScope2(item);
                    const itemSlNo = getBoqSlNo(item);
                    
                    const itemKey = compositeKey(itemScope1, itemScope2, itemSlNo);
                    const boqItem = boqItemsMap.get(itemKey);
                    
                    const previousCertifiedQty = allJmcEntries
                        .filter(e => {
                            const eDate = toDateSafe(e.jmcDate);
                            return eDate && currentEntryDate && eDate < currentEntryDate;
                        })
                        .flatMap(e => e.items)
                        .filter(i => {
                            const iKey = compositeKey(getScope1(i), getScope2(i), getBoqSlNo(i));
                            return iKey === itemKey;
                        })
                        .reduce((sum, i) => sum + (i.certifiedQty || 0), 0);
                        
                    return {
                        ...item,
                        boqQty: boqItem ? Number((boqItem as any).QTY || (boqItem as any)['Total Qty'] || 0) : 0,
                        previousCertifiedQty: previousCertifiedQty,
                    };
                });
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
                      JOINT MEASUREMENT CERTIFICATE
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
