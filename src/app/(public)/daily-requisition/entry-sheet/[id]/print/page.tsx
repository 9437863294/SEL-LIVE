
'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, query, where, documentId, Timestamp } from 'firebase/firestore';
import type { DailyRequisitionEntry, ExpenseRequest, Project } from '@/lib/types';
import { Printer } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { format } from 'date-fns';
import { useReactToPrint } from 'react-to-print';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

const toDateSafe = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
};

// A new simple component to render the printable content.
// It doesn't need a forwardRef.
const PrintableContent = ({ entry, expenseRequest, project }: { entry: DailyRequisitionEntry, expenseRequest?: ExpenseRequest | null, project?: Project | null }) => {
    const { user } = useAuth();
    if (!entry) return null;

    const entryDate = toDateSafe(entry.date);

    return (
        <div className="p-8 bg-white text-black font-sans">
            <div className="text-center mb-4">
                <h2 className="text-xl font-bold">SIDDHARTHA ENGINEERING LIMITED</h2>
                <p className="text-sm font-medium">Nayapalli, Bhubaneswar</p>
            </div>
            <h3 className="text-lg font-semibold text-center mb-4 underline">Check List for Payment</h3>
            
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm mb-4">
                <div className="flex">
                    <span className="font-medium w-32 shrink-0">Reception No:</span>
                    <span>{entry.receptionNo}</span>
                </div>
                 <div className="flex">
                    <span className="font-medium w-32 shrink-0">Reception Date:</span>
                    <span>{entryDate ? format(entryDate, 'MMMM do, yyyy') : 'N/A'}</span>
                </div>
                <div className="flex">
                    <span className="font-medium w-32 shrink-0">DEP No:</span>
                    <span>{entry.depNo}</span>
                </div>
                <div className="flex">
                    <span className="font-medium w-32 shrink-0">Project Name:</span>
                    <span>{project?.projectName || 'N/A'}</span>
                </div>
            </div>

            <Separator className="my-4 bg-gray-400" />

            <div className="grid grid-cols-2 gap-x-8 text-sm mb-2">
                <div className="flex">
                    <span className="font-medium w-32 shrink-0">Name of the party:</span>
                    <span className="font-semibold">{entry.partyName}</span>
                </div>
                 <div className="flex gap-x-4">
                    <div className="flex"><span className="font-medium w-24 shrink-0">Gross Amount:</span><span>{entry.grossAmount.toLocaleString()}</span></div>
                    <div className="flex"><span className="font-medium w-24 shrink-0">Net Amount:</span><span>{entry.netAmount.toLocaleString()}</span></div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-x-8 text-sm mb-4">
                <div className="flex">
                    <span className="font-medium w-32 shrink-0">Head of A/c:</span>
                    <span>{expenseRequest?.headOfAccount || 'N/A'}</span>
                </div>
                 <div className="flex">
                    <span className="font-medium w-32 shrink-0">Sub-Head of A/c:</span>
                    <span>{expenseRequest?.subHeadOfAccount || 'N/A'}</span>
                </div>
            </div>

            <div className="space-y-2 text-sm mb-8">
                <p className="font-medium">Description:</p>
                <p className="pl-4 min-h-[50px] border-l-2 border-gray-200">{entry.description}</p>
            </div>
            
            <div className="mt-24 grid grid-cols-2 gap-x-24 gap-y-16 text-sm">
                <div className="border-t border-black pt-1">Prepared by</div>
                <div className="border-t border-black pt-1">Authorised by</div>
                <div className="border-t border-black pt-1">Checked by</div>
                <div className="border-t border-black pt-1">Approved by</div>
                <div className="border-t border-black pt-1">Verified by</div>
                <div className="border-t border-black pt-1">A/c Dept</div>
            </div>

            <div className="mt-24 flex justify-between text-xs text-gray-500">
                <div>
                    <span className="font-medium">Printed By:</span>
                    <span> {user?.name || 'N/A'}</span>
                </div>
                 <div>
                    <span className="font-medium">Timestamp:</span>
                    <span> {format(new Date(), 'dd-MMM-yyyy HH:mm:ss')}</span>
                </div>
            </div>
        </div>
    );
};


export default function PrintChecklistPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();

    const id = params.id as string;
    const idsFromQuery = searchParams.get('ids')?.split(',');
    
    // The ref is now on a simple div that will wrap our printable content.
    const componentToPrintRef = useRef<HTMLDivElement>(null);
    const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [expenseRequests, setExpenseRequests] = useState<ExpenseRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const handlePrint = useReactToPrint({
        content: () => componentToPrintRef.current,
        documentTitle: `Checklist-${id || 'batch'}`,
        onAfterPrint: () => router.back(),
    });
    
    useEffect(() => {
        const idsToFetch = idsFromQuery || (id ? [id] : []);
        if (idsToFetch.length === 0) {
            router.push('/daily-requisition/entry-sheet');
            return;
        }

        const fetchData = async () => {
            setIsLoading(true);
            try {
                const entryQuery = query(collection(db, 'dailyRequisitions'), where(documentId(), 'in', idsToFetch));
                const entrySnap = await getDocs(entryQuery);

                if (entrySnap.empty) {
                    router.push('/daily-requisition/entry-sheet');
                    return;
                }
                
                const entriesData = entrySnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyRequisitionEntry));
                setEntries(entriesData);
                
                const projectIds = [...new Set(entriesData.map(e => e.projectId).filter(Boolean))];
                if(projectIds.length > 0) {
                    const projectQuery = query(collection(db, 'projects'), where(documentId(), 'in', projectIds));
                    const projectSnap = await getDocs(projectQuery);
                    setProjects(projectSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
                }

                const depNos = [...new Set(entriesData.map(e => e.depNo).filter(Boolean))];
                if(depNos.length > 0) {
                    const expenseQuery = query(collection(db, 'expenseRequests'), where('requestNo', 'in', depNos));
                    const expenseSnap = await getDocs(expenseQuery);
                    setExpenseRequests(expenseSnap.docs.map(doc => doc.data() as ExpenseRequest));
                }

            } catch (error) {
                console.error("Error fetching checklist data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [id, idsFromQuery, router]);
    
     useEffect(() => {
        if (!isLoading && entries.length > 0) {
            const timer = setTimeout(() => {
                handlePrint();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [isLoading, entries, handlePrint]);

    return (
        <div className="p-4 md:p-8 bg-gray-100">
            <div className="hidden">
                 {/* This div is what react-to-print will capture. */}
                 <div ref={componentToPrintRef}>
                    {isLoading ? (
                        <div className="bg-white border rounded-lg max-w-4xl mx-auto p-8">
                            <Skeleton className="h-96 w-full" />
                        </div>
                    ) : (
                        entries.map((entry, index) => (
                            <div key={entry.receptionNo} className="page-break">
                                <PrintableContent 
                                    entry={entry} 
                                    project={projects.find(p => p.id === entry.projectId)} 
                                    expenseRequest={expenseRequests.find(er => er.requestNo === entry.depNo)} 
                                />
                            </div>
                        ))
                    )}
                </div>
            </div>
             <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)]">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
                <p className="mt-4 text-muted-foreground">Preparing your document for printing...</p>
            </div>

            <style jsx global>{`
                @media print {
                    .no-print {
                        display: none !important;
                    }
                    body {
                        background-color: #fff;
                        margin: 0;
                    }
                    .page-break {
                        page-break-after: always;
                    }
                    .page-break:last-child {
                        page-break-after: auto;
                    }
                }
            `}</style>
        </div>
    );
}
