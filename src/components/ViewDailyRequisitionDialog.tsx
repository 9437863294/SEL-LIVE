
'use client';

import React, { Fragment, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc, Timestamp, writeBatch } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project, Department, ExpenseRequest, Attachment } from '@/lib/types';
import { format } from 'date-fns';
import { useAuth } from './auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Loader2, Printer, Paperclip, Download, Eye } from 'lucide-react';
import { Separator } from './ui/separator';

interface ViewDailyRequisitionDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  entry: DailyRequisitionEntry | null;
  projects: Project[];
  departments: Department[];
  expenseRequest?: ExpenseRequest | null;
  onActionComplete?: () => void;
}

const formatDateSafe = (date: any) => {
    if (!date) return 'N/A';
    if (date instanceof Timestamp) {
        return format(date.toDate(), 'dd MMM, yyyy');
    }
    if (date instanceof Date) {
        return format(date, 'dd MMM, yyyy');
    }
    try {
        const parsedDate = new Date(date);
        if (!isNaN(parsedDate.getTime())) {
            return format(parsedDate, 'dd MMM, yyyy');
        }
    } catch (e) {
        // fall through
    }
    return String(date);
};

export default function ViewDailyRequisitionDialog({ isOpen, onOpenChange, entry, projects, departments, expenseRequest, onActionComplete }: ViewDailyRequisitionDialogProps) {
  const { can } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isActionLoading, setIsActionLoading] = React.useState(false);

  const handlePrint = () => {
    if (!entry) return;
    window.open(`/daily-requisition/entry-sheet/${entry.id}/print`, '_blank');
  };

  const handleStatusUpdate = async (newStatus: 'Pending' | 'Received' | 'Cancelled') => {
      if (!entry || !user) return;
      setIsActionLoading(true);
      try {
          const updateData: any = { status: newStatus };
          if (newStatus === 'Received') {
            updateData.receivedAt = new Date();
            updateData.receivedById = user?.id;
          }
          if(newStatus === 'Pending') {
            updateData.receivedAt = null;
            updateData.receivedById = null;
          }
          await updateDoc(doc(db, 'dailyRequisitions', entry.id), updateData);
          
          toast({
            title: 'Success',
            description: `Entry marked as ${newStatus.toLowerCase()}.`,
          });
          onActionComplete?.();
          onOpenChange(false);
      } catch (error) {
        console.error("Error updating entry status: ", error);
        toast({ title: 'Error', description: 'Failed to update status.', variant: 'destructive' });
      } finally {
          setIsActionLoading(false);
      }
  };

  const handleDocumentStatusUpdate = async (newDocStatus: 'Missing' | 'Not Required') => {
    if (!entry || !user) return;
    setIsActionLoading(true);
    try {
        await updateDoc(doc(db, 'dailyRequisitions', entry.id), {
            documentStatus: newDocStatus,
            documentStatusUpdatedById: user.id,
            documentStatusUpdatedAt: new Date(),
        });
        toast({ title: 'Success', description: `Document status set to ${newDocStatus}.` });
        onActionComplete?.();
        onOpenChange(false);
    } catch (error) {
        console.error("Error updating document status:", error);
        toast({ title: 'Error', description: 'Failed to update document status.', variant: 'destructive' });
    } finally {
        setIsActionLoading(false);
    }
  };


  if (!entry) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const canReceive = can('Mark as Received', 'Daily Requisition.Receiving at Finance');
  const canReturn = can('Return to Pending', 'Daily Requisition.Receiving at Finance');
  const canCancel = can('Cancel', 'Daily Requisition.Receiving at Finance');
  const canMarkMissing = can('Mark as Missing', 'Daily Requisition.Manage Documents');
  const canMarkNotRequired = can('Mark as Not Required', 'Daily Requisition.Manage Documents');

  const projectName = projects.find(p => p.id === entry.projectId)?.projectName || 'N/A';
  const departmentName = departments.find(d => d.id === entry.departmentId)?.name || 'N/A';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <div className="printable-area">
            <DialogHeader className="no-print">
              <DialogTitle>Details for {entry.receptionNo}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-3 p-4">
               <div className="text-center mb-4 hidden print:block">
                  <h2 className="text-lg font-bold">Daily Requisition - {entry.receptionNo}</h2>
               </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div><Label className="text-xs">Reception No.</Label><p className="font-medium">{entry.receptionNo}</p></div>
                <div><Label className="text-xs">Date</Label><p className="font-medium">{formatDateSafe(entry.date)}</p></div>
                <div><Label className="text-xs">Created At</Label><p className="font-medium">{formatDateSafe(entry.createdAt)}</p></div>
                <div><Label className="text-xs">Project</Label><p className="font-medium">{projectName}</p></div>
                <div><Label className="text-xs">Department</Label><p className="font-medium">{departmentName}</p></div>
                <div><Label className="text-xs">DEP No.</Label><p className="font-medium">{entry.depNo || 'N/A'}</p></div>
              </div>

              <Separator />
              
              <div className="grid grid-cols-1 gap-3 text-sm">
                <div>
                  <Label className="text-xs">Party Name</Label>
                  <p className="font-medium">{entry.partyName}</p>
                </div>
                <div>
                  <Label className="text-xs">Description</Label>
                  <p className="font-medium p-2 bg-muted rounded-md min-h-[40px]">{entry.description}</p>
                </div>
              </div>

              <Separator />
              
              {expenseRequest && (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><Label className="text-xs">Head of A/c</Label><p className="font-medium">{expenseRequest.headOfAccount}</p></div>
                    <div><Label className="text-xs">Sub-Head of A/c</Label><p className="font-medium">{expenseRequest.subHeadOfAccount}</p></div>
                  </div>
                  <Separator />
                </>
              )}


              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><Label className="text-xs">Gross Amount</Label><p className="font-medium">{formatCurrency(entry.grossAmount)}</p></div>
                <div><Label className="text-xs">Net Amount</Label><p className="font-medium">{formatCurrency(entry.netAmount)}</p></div>
              </div>
              
              {entry.attachments && entry.attachments.length > 0 && (
                <div>
                  <Label className="text-xs">Attachments</Label>
                  <div className="mt-1 space-y-2">
                    {entry.attachments.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-muted rounded-md">
                         <div className="flex items-center gap-2 overflow-hidden">
                           <Paperclip className="h-4 w-4 shrink-0" />
                           <span className="text-sm font-medium truncate">{file.name}</span>
                         </div>
                         <div className="flex items-center shrink-0">
                             <Button asChild variant="outline" size="sm" className="mr-2 h-7">
                               <a href={file.url} target="_blank" rel="noopener noreferrer">
                                  <Eye className="mr-2 h-3 w-3" /> View
                               </a>
                             </Button>
                             <Button asChild variant="outline" size="sm" className="h-7">
                               <a href={file.url} download={file.name}>
                                  <Download className="mr-2 h-3 w-3" /> Download
                               </a>
                             </Button>
                         </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
        </div>

        <DialogFooter className="mt-2 pr-4 no-print flex-wrap justify-end gap-1">
          <Button variant="outline" onClick={handlePrint} size="sm">
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          <DialogClose asChild>
            <Button variant="outline" size="sm">Close</Button>
          </DialogClose>
          {entry.status !== 'Received' && entry.status !== 'Cancelled' && canReceive && (
            <Button onClick={() => handleStatusUpdate('Received')} disabled={isActionLoading} size="sm">
                {isActionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Mark as Received
            </Button>
          )}
          {entry.status === 'Received' && canReturn && (
            <Button variant="secondary" onClick={() => handleStatusUpdate('Pending')} disabled={isActionLoading} size="sm">
                {isActionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Return to Pending
            </Button>
          )}
           {entry.documentStatus === 'Pending' && canMarkMissing && (
            <Button variant="secondary" onClick={() => handleDocumentStatusUpdate('Missing')} disabled={isActionLoading} size="sm">
                {isActionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Mark as Missing
            </Button>
          )}
          {entry.documentStatus === 'Pending' && canMarkNotRequired && (
            <Button variant="secondary" onClick={() => handleDocumentStatusUpdate('Not Required')} disabled={isActionLoading} size="sm">
                {isActionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Mark as Not Required
            </Button>
          )}
          {entry.status !== 'Cancelled' && canCancel && (
             <Button variant="destructive" onClick={() => handleStatusUpdate('Cancelled')} disabled={isActionLoading} size="sm">
                {isActionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
