
'use client';

import React, { useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from './ui/separator';
import type { DailyRequisitionEntry, ExpenseRequest, Project } from '@/lib/types';
import { Printer } from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import { format } from 'date-fns';
import { useReactToPrint } from 'react-to-print';

interface ChecklistDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  entry: DailyRequisitionEntry | null;
  expenseRequest?: ExpenseRequest | null;
  project?: Project | null;
}

const PrintableContent = React.forwardRef<HTMLDivElement, Omit<ChecklistDialogProps, 'isOpen' | 'onOpenChange'>>(({ entry, expenseRequest, project }, ref) => {
    const { user } = useAuth();
    if (!entry) return null;

    const entryDate = entry.date && (entry.date as any).toDate 
        ? format((entry.date as any).toDate(), 'MMMM do, yyyy')
        : String(entry.date);

    return (
        <div ref={ref}>
            <div className="p-6 bg-white text-black">
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

                <Separator className="my-4 bg-gray-300" />

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
        </div>
    );
});
PrintableContent.displayName = 'PrintableContent';

export function ChecklistDialog({ isOpen, onOpenChange, entry, expenseRequest, project }: ChecklistDialogProps) {
  const componentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
      content: () => componentRef.current,
  });

  if (!entry) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Check List for Payment</DialogTitle>
          <DialogDescription>
            This is a preview of the checklist for Reception No. {entry.receptionNo}.
          </DialogDescription>
        </DialogHeader>
        
        <div className="max-h-[70vh] overflow-y-auto p-1" >
             <PrintableContent ref={componentRef} entry={entry} expenseRequest={expenseRequest} project={project} />
        </div>

        <DialogFooter>
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print / Download PDF
            </Button>
            <DialogClose asChild>
                <Button type="button">Close</Button>
            </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
