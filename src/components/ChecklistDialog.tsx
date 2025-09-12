
'use client';

import { useRef } from 'react';
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
import { format } from 'date-fns';

interface ChecklistDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  entry: DailyRequisitionEntry | null;
  expenseRequest?: ExpenseRequest | null;
  project?: Project | null;
}

export function ChecklistDialog({ isOpen, onOpenChange, entry, expenseRequest, project }: ChecklistDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);
  
  const handlePrint = () => {
    window.print();
  };
  
  if (!entry) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Check List for Payment</DialogTitle>
          <DialogDescription>
            This checklist has been generated for Reception No. {entry.receptionNo}.
          </DialogDescription>
        </DialogHeader>
        
        <div className="max-h-[70vh] overflow-y-auto p-1" >
           <div ref={printRef} className="printable p-6 border rounded-lg">
            <h2 className="text-xl font-bold text-center mb-2">SIDDHARTHA ENGINEERING LIMITED</h2>
            <h3 className="text-lg font-semibold text-center mb-4">Check List for Payment</h3>
            
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="font-medium">Reception No:</span>
                    <span>{entry.receptionNo}</span>
                </div>
                 <div className="flex justify-between">
                    <span className="font-medium">Reception Date:</span>
                    <span>{entry.date}</span>
                </div>
                <div className="flex justify-between">
                    <span className="font-medium">DEP No:</span>
                    <span>{entry.depNo}</span>
                </div>
                <div className="flex justify-between">
                    <span className="font-medium">Project Name:</span>
                    <span>{project?.projectName || 'N/A'}</span>
                </div>
            </div>

            <Separator className="my-4" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 text-sm">
              <div>
                <p><span className="font-medium">Name of the party:</span> {entry.partyName}</p>
                <p><span className="font-medium">Description:</span> {entry.description}</p>
              </div>
              <div className="text-right">
                <p><span className="font-medium">Gross Amount:</span> {entry.grossAmount.toLocaleString()}</p>
                <p><span className="font-medium">Net Amount:</span> {entry.netAmount.toLocaleString()}</p>
              </div>
            </div>

            <Separator className="my-4" />
            
            <div className="space-y-2 text-sm">
                <p><span className="font-medium">Head of A/c:</span> {expenseRequest?.headOfAccount || 'N/A'}</p>
                <p><span className="font-medium">Sub-Head of A/c:</span> {expenseRequest?.subHeadOfAccount || 'N/A'}</p>
            </div>
            
            <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
                <div className="space-y-12">
                    <p className="border-t pt-1">Prepared by</p>
                    <p className="border-t pt-1">Checked by</p>
                    <p className="border-t pt-1">Verified by</p>
                </div>
                <div className="space-y-12">
                     <p className="border-t pt-1">Authorised by</p>
                     <p className="border-t pt-1">Approved by</p>
                     <p className="border-t pt-1">A/c Dept</p>
                </div>
            </div>
          </div>
        </div>

        <DialogFooter className="no-print">
            <Button variant="outline" onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Print Checklist
            </Button>
            <DialogClose asChild>
                <Button type="button">Close</Button>
            </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
