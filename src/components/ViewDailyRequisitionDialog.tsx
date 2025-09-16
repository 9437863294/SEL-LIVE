

'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { DailyRequisitionEntry, Project, Department, ExpenseRequest } from '@/lib/types';
import { Printer, Paperclip, Download } from 'lucide-react';
import Link from 'next/link';

interface ViewDailyRequisitionDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  entry: DailyRequisitionEntry | null;
  project?: Project;
  department?: Department;
  expenseRequest?: ExpenseRequest | null;
}

export default function ViewDailyRequisitionDialog({ isOpen, onOpenChange, entry, project, department, expenseRequest }: ViewDailyRequisitionDialogProps) {

  const handlePrint = () => {
    window.print();
  };

  if (!entry) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <div className="printable-area">
            <DialogHeader className="no-print">
              <DialogTitle>Details for {entry.receptionNo}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 p-4">
               <div className="text-center mb-6 hidden print:block">
                  <h2 className="text-xl font-bold">Daily Requisition - {entry.receptionNo}</h2>
               </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><Label>Reception No.</Label><p className="font-medium">{entry.receptionNo}</p></div>
                <div><Label>Date</Label><p className="font-medium">{entry.date}</p></div>
                <div><Label>Created At</Label><p className="font-medium">{entry.createdAt}</p></div>
                <div><Label>Project</Label><p className="font-medium">{project?.projectName || 'N/A'}</p></div>
                <div><Label>Department</Label><p className="font-medium">{department?.name || 'N/A'}</p></div>
                <div><Label>DEP No.</Label><p className="font-medium">{entry.depNo || 'N/A'}</p></div>
              </div>

              <Separator />
              
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label>Party Name</Label>
                  <p className="font-medium">{entry.partyName}</p>
                </div>
                <div>
                  <Label>Description</Label>
                  <p className="font-medium p-2 bg-muted rounded-md min-h-[60px]">{entry.description}</p>
                </div>
              </div>

              <Separator />
              
              {expenseRequest && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>Head of A/c</Label><p className="font-medium">{expenseRequest.headOfAccount}</p></div>
                    <div><Label>Sub-Head of A/c</Label><p className="font-medium">{expenseRequest.subHeadOfAccount}</p></div>
                  </div>
                  <Separator />
                </>
              )}


              <div className="grid grid-cols-2 gap-4">
                <div><Label>Gross Amount</Label><p className="font-medium">{formatCurrency(entry.grossAmount)}</p></div>
                <div><Label>Net Amount</Label><p className="font-medium">{formatCurrency(entry.netAmount)}</p></div>
              </div>
              
              {entry.attachments && entry.attachments.length > 0 && (
                <div>
                  <Label>Attachments</Label>
                  <div className="mt-2 space-y-2">
                    {entry.attachments.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-muted rounded-md">
                         <div className="flex items-center gap-2">
                           <Paperclip className="h-4 w-4" />
                           <span className="text-sm font-medium">{file.name}</span>
                         </div>
                         <Button asChild variant="outline" size="sm">
                           <Link href={file.url} target="_blank" rel="noopener noreferrer">
                              <Download className="mr-2 h-4 w-4" /> Download
                           </Link>
                         </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
        </div>

        <DialogFooter className="mt-4 pr-4 no-print">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
