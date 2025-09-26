
'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import type { DailyRequisitionEntry, ExpenseRequest, Project } from '@/lib/types';
import { Printer } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { format } from 'date-fns';
import { useReactToPrint } from 'react-to-print';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

const PrintableContent = React.forwardRef<HTMLDivElement, { entry: DailyRequisitionEntry | null, expenseRequest?: ExpenseRequest | null, project?: Project | null }>(({ entry, expenseRequest, project }, ref) => {
    const { user } = useAuth();
    if (!entry) return null;

    const entryDate = entry.date && (entry.date as any).toDate 
        ? format((entry.date as any).toDate(), 'MMMM do, yyyy')
        : String(entry.date);

    return (
        <div ref={ref} className="p-8 bg-white text-black font-sans">
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
                    <span>{entry.date ? format(new Date(entry.date as string), 'MMMM do, yyyy') : 'N/A'}</span>
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
});
PrintableContent.displayName = 'PrintableContent';

export default function PrintChecklistPage({ params }: { params: { id: string } }) {
    const { id } = params;
    const router = useRouter();
    const componentRef = useRef<HTMLDivElement>(null);
    const [entry, setEntry] = useState<DailyRequisitionEntry | null>(null);
    const [project, setProject] = useState<Project | null>(null);
    const [expenseRequest, setExpenseRequest] = useState<ExpenseRequest | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `Checklist-${entry?.receptionNo || 'entry'}`,
    });
    
    useEffect(() => {
        if (!id) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                const entryDocRef = doc(db, 'dailyRequisitions', id);
                const entryDocSnap = await getDoc(entryDocRef);

                if (!entryDocSnap.exists()) {
                    router.push('/daily-requisition/entry-sheet');
                    return;
                }
                
                const entryData = entryDocSnap.data() as DailyRequisitionEntry;
                setEntry(entryData);

                if (entryData.projectId) {
                    const projectDocRef = doc(db, 'projects', entryData.projectId);
                    const projectDocSnap = await getDoc(projectDocRef);
                    if (projectDocSnap.exists()) {
                        setProject(projectDocSnap.data() as Project);
                    }
                }
                
                if(entryData.depNo) {
                    const expenseQuery = query(collection(db, 'expenseRequests'), where('requestNo', '==', entryData.depNo));
                    const expenseSnap = await getDocs(expenseQuery);
                    if (!expenseSnap.empty) {
                        setExpenseRequest(expenseSnap.docs[0].data() as ExpenseRequest);
                    }
                }

            } catch (error) {
                console.error("Error fetching checklist data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [id, router]);


    return (
        <div className="p-4 md:p-8">
            <div className="flex justify-end gap-2 mb-4 no-print">
                <Button variant="outline" onClick={handlePrint} disabled={isLoading || !entry}>
                    {isLoading || !entry ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                    Print / Download PDF
                </Button>
            </div>
            <div className="bg-white border rounded-lg max-w-4xl mx-auto">
                 {isLoading ? (
                    <div className="p-8">
                        <Skeleton className="h-96 w-full" />
                    </div>
                ) : (
                    <PrintableContent ref={componentRef} entry={entry} project={project} expenseRequest={expenseRequest} />
                )}
            </div>
        </div>
    );
}
