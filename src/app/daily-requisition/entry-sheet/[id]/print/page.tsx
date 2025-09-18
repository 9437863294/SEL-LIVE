
'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { DailyRequisitionEntry, ExpenseRequest, Project } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Printer } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';

const PrintableContent = React.forwardRef<HTMLDivElement, { entry: DailyRequisitionEntry, expenseRequest?: ExpenseRequest | null, project?: Project | null }>(({ entry, expenseRequest, project }, ref) => {
    const { user } = useAuth();
    if (!entry) return null;

    const entryDate = entry.date && (entry.date as any).seconds
        ? format(new Date((entry.date as any).seconds * 1000), 'MMMM do, yyyy')
        : String(entry.date);

    return (
        <div ref={ref} className="p-8 bg-white text-black max-w-4xl mx-auto">
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
                    <span>{entryDate}</span>
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
                <p className="pl-4 min-h-[50px]">{entry.description}</p>
            </div>
            
            <div className="mt-16 grid grid-cols-2 gap-x-24 gap-y-12 text-sm">
                <div className="border-t border-black pt-1">Prepared by</div>
                <div className="border-t border-black pt-1">Authorised by</div>
                <div className="border-t border-black pt-1">Checked by</div>
                <div className="border-t border-black pt-1">Approved by</div>
                <div className="border-t border-black pt-1">Verified by</div>
                <div className="border-t border-black pt-1">A/c Dept</div>
            </div>

            <div className="mt-16 flex justify-between text-sm">
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
});
PrintableContent.displayName = 'PrintableContent';


export default function PrintChecklistPage() {
    const { id } = useParams() as { id: string };
    const [entry, setEntry] = useState<DailyRequisitionEntry | null>(null);
    const [project, setProject] = useState<Project | null>(null);
    const [expenseRequest, setExpenseRequest] = useState<ExpenseRequest | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const componentRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
    });
    
    useEffect(() => {
        if (!id) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                const entryDoc = await getDoc(doc(db, 'dailyRequisitions', id));
                if (!entryDoc.exists()) throw new Error("Requisition not found");
                const entryData = { id: entryDoc.id, ...entryDoc.data() } as DailyRequisitionEntry;
                setEntry(entryData);

                if (entryData.projectId) {
                    const projectDoc = await getDoc(doc(db, 'projects', entryData.projectId));
                    if (projectDoc.exists()) setProject(projectDoc.data() as Project);
                }

                if (entryData.depNo) {
                    const expenseQuery = query(collection(db, 'expenseRequests'), where('requestNo', '==', entryData.depNo));
                    const expenseSnap = await getDocs(expenseQuery);
                    if (!expenseSnap.empty) {
                        setExpenseRequest(expenseSnap.docs[0].data() as ExpenseRequest);
                    }
                }
            } catch (error) {
                console.error("Error fetching print data:", error);
            }
            setIsLoading(false);
        };
        fetchData();
    }, [id]);

    if (isLoading) {
        return <div className="p-8"><Skeleton className="h-[800px] w-full" /></div>;
    }

    if (!entry) {
        return <div className="p-8 text-center">Entry not found.</div>;
    }

    return (
        <div>
            <div className="p-4 text-center no-print">
                <Button onClick={handlePrint} variant="outline">
                    <Printer className="mr-2 h-4 w-4" />
                    Print / Download PDF
                </Button>
            </div>
            <PrintableContent ref={componentRef} entry={entry} project={project} expenseRequest={expenseRequest} />
        </div>
    );
}
