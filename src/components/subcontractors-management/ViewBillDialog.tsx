
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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { Bill, WorkflowStep, ActionLog } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { ScrollArea } from '../ui/scroll-area';
import { Printer, Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Textarea } from '../ui/textarea';

interface ViewBillDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  bill: Bill | null;
  workflow: WorkflowStep[];
  onAction: (taskId: string, action: string, comment: string) => Promise<void>;
  isActionLoading: boolean;
}

const formatDateSafe = (dateInput: any) => {
    if (!dateInput) return 'N/A';
    // Add any date formatting logic you need here
    return String(dateInput);
}

const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
}

export default function ViewBillDialog({
  isOpen,
  onOpenChange,
  bill,
  workflow,
  onAction,
  isActionLoading
}: ViewBillDialogProps) {
  const params = useParams();
  const projectSlug = params.project as string;
  const [actionComment, setActionComment] = useState('');

  if (!bill) return null;
  
  const handlePrint = () => {
    if (!bill || !projectSlug) return;
    window.open(
      `/billing-recon/${projectSlug}/bill/${bill.id}/print`,
      '_blank'
    );
  };
  
  const currentStep = workflow.find(s => s.id === bill.currentStepId);
  const availableActions = currentStep?.actions || [];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col min-h-0">
        <DialogHeader className="shrink-0">
          <DialogTitle>Bill Details: {bill.billNo}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 pr-6 -mr-6">
            <ScrollArea className="h-full pr-6">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Bill No.</Label>
                    <p className="font-medium">{bill.billNo}</p>
                  </div>
                  <div>
                    <Label>Work Order No.</Label>
                    <p className="font-medium">{bill.workOrderNo}</p>
                  </div>
                  <div>
                    <Label>Bill Date</Label>
                    <p className="font-medium">{formatDateSafe(bill.billDate)}</p>
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <h3 className="text-lg font-semibold mb-2">Billed Items</h3>
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>JMC No.</TableHead>
                          <TableHead>BOQ Sl.No.</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead>Rate</TableHead>
                          <TableHead>Billed Qty</TableHead>
                          <TableHead>Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bill.items.map((item, index) => (
                          <TableRow key={index}>
                            <TableCell>{item.jmcNo}</TableCell>
                            <TableCell>{item.boqSlNo}</TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell>{item.unit}</TableCell>
                            <TableCell>{formatCurrency(item.rate)}</TableCell>
                            <TableCell>{item.billedQty}</TableCell>
                            <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <Separator />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Financial Summary</h3>
                  <div className="text-sm p-4 border rounded-md space-y-2">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                        <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(bill.subtotal)}</span></div>
                        <div className="flex justify-between"><span>GST ({bill.gstType === 'percentage' ? `${bill.gstPercentage}%` : 'Manual'})</span><span>{formatCurrency(bill.gstAmount)}</span></div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1 pt-2 border-t">
                        <div className="flex justify-between font-bold"><span>Gross Amount</span><span>{formatCurrency(bill.grossAmount)}</span></div>
                    </div>
                     <div className="grid grid-cols-2 gap-x-8 gap-y-1 pt-2 border-t text-red-600">
                        <div className="flex justify-between"><span>Retention ({bill.retentionType === 'percentage' ? `${bill.retentionPercentage}%` : 'Manual'})</span><span>-{formatCurrency(bill.retentionAmount)}</span></div>
                        <div className="flex justify-between"><span>Advance Deduction</span><span>-{formatCurrency((bill.advanceDeductions || []).reduce((sum, d) => sum + d.amount, 0))}</span></div>
                        <div className="flex justify-between"><span>Other Deductions</span><span>-{formatCurrency(bill.otherDeduction)}</span></div>
                        <div className="flex justify-between"><span>Total Deductions</span><span>-{formatCurrency(bill.totalDeductions)}</span></div>
                    </div>
                     <div className="grid grid-cols-1 gap-x-8 gap-y-1 pt-2 border-t">
                         <div className="flex justify-between font-bold text-lg"><span>Net Payable Amount</span><span>{formatCurrency(bill.netPayable)}</span></div>
                    </div>
                  </div>
                </div>

                {bill.status !== 'Completed' && bill.status !== 'Rejected' && (
                  <div className="pt-4 space-y-4 border-t">
                      <h3 className="text-lg font-semibold">Workflow Actions</h3>
                      <Textarea 
                          placeholder="Add a comment for your action (optional)..."
                          value={actionComment}
                          onChange={(e) => setActionComment(e.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                          {availableActions.map(action => {
                              const actionName = typeof action === 'string' ? action : action.name;
                              return (
                                <Button 
                                  key={actionName}
                                  onClick={() => onAction(bill.id, actionName, actionComment)}
                                  disabled={isActionLoading}
                                >
                                    {isActionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                                    {actionName}
                                </Button>
                              );
                          })}
                      </div>
                  </div>
                )}
              </div>
            </ScrollArea>
        </div>
        <DialogFooter className="mt-4 pr-4 sm:justify-between shrink-0">
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
