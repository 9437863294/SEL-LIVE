
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { PrintableContent } from '@/components/ChecklistDialog';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project, ExpenseRequest } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { useRef } from 'react';
import { format } from 'date-fns';

export default function PrintChecklistPage() {
    const { id } = useParams() as { id: string };
    const [entry, setEntry] = useState<DailyRequisitionEntry | null>(null);
    const [project, setProject] = useState<Project | null>(null);
    const [expenseRequest, setExpenseRequest] = useState<ExpenseRequest | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const componentRef = useRef(null);

    useEffect(() => {
        if (!id) return;
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const entryDocRef = doc(db, 'dailyRequisitions', id);
                const entryDocSnap = await getDoc(entryDocRef);

                if (entryDocSnap.exists()) {
                    const entryData = { id: entryDocSnap.id, ...entryDocSnap.data() };
                    
                    // Convert Firestore Timestamps to formatted strings
                    const formattedEntry = {
                        ...entryData,
                        date: entryData.date?.toDate ? format(entryData.date.toDate(), 'MMMM do, yyyy') : entryData.date,
                        createdAt: entryData.createdAt?.toDate ? format(entryData.createdAt.toDate(), 'dd MMM, yyyy HH:mm') : entryData.createdAt,
                    } as DailyRequisitionEntry;
                    
                    setEntry(formattedEntry);

                    // Fetch related data
                    if (entryData.projectId) {
                        const projectDocRef = doc(db, 'projects', entryData.projectId);
                        const projectDocSnap = await getDoc(projectDocRef);
                        if (projectDocSnap.exists()) {
                            setProject({ id: projectDocSnap.id, ...projectDocSnap.data() } as Project);
                        }
                    }

                    if (entryData.depNo) {
                        const expenseQuery = query(collection(db, 'expenseRequests'), where('requestNo', '==', entryData.depNo));
                        const expenseSnap = await getDocs(expenseQuery);
                        if (!expenseSnap.empty) {
                           setExpenseRequest({ id: expenseSnap.docs[0].id, ...expenseSnap.docs[0].data()} as ExpenseRequest);
                        }
                    }
                }
            } catch (error) {
                console.error("Error fetching data for printing:", error);
            }
            setIsLoading(false);
        };
        fetchData();
    }, [id]);
    
    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
    });


    if (isLoading) {
        return <div className="p-10"><Skeleton className="h-screen w-full" /></div>;
    }

    if (!entry) {
        return <div className="p-10 text-center">Entry not found.</div>;
    }

    return (
        <div className="bg-gray-100 min-h-screen p-8">
            <div className="max-w-4xl mx-auto">
                <div className="mb-4 flex justify-end no-print">
                    <Button onClick={handlePrint}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print
                    </Button>
                </div>
                <PrintableContent 
                    ref={componentRef}
                    entry={entry}
                    project={project || undefined}
                    expenseRequest={expenseRequest || undefined}
                />
            </div>
        </div>
    );
}
