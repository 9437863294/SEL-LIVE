
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, View, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  collectionGroup,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { Bill, Project, ProformaBill } from '@/lib/types';
import ViewBillDialog from '@/components/subcontractors-management/ViewBillDialog';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import ViewProformaBillDialog from '@/components/subcontractors-management/ViewProformaBillDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';


const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};


export default function BillLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const { can } = useAuthorization();

  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isDeductionDetailsOpen, setIsDeductionDetailsOpen] = useState(false);

  const canDeleteBill = can('Delete Bill', 'Subcontractors Management.Billing');

  const fetchBills = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      let billsQuery;
      
      const projectsQuery = query(collection(db, 'projects'));
      const projectSnap = await getDocs(projectsQuery);
      const allProjects = projectSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));

      if (projectSlug === 'all') {
        billsQuery = query(collectionGroup(db, 'bills'));
      } else {
        const project = allProjects.find(p => slugify(p.projectName) === projectSlug);
        if (!project) {
          console.error("Project not found");
          setIsLoading(false);
          return;
        }
        billsQuery = query(collection(db, 'projects', project.id, 'bills'));
      }
      
      const billsSnapshot = await getDocs(billsQuery);

      const billEntries = billsSnapshot.docs.map((doc) => {
        const data = doc.data();
         const projectId = doc.ref.parent.parent?.id;
        const project = allProjects.find(p => p.id === projectId);
        return {
          id: doc.id,
          ...data,
          projectName: project?.projectName || 'Unknown',
          billDate: format(new Date(data.billDate), 'dd MMM, yyyy'),
          totalAmount:
            data.totalAmount ||
            data.items.reduce(
              (sum: number, item: any) => sum + parseFloat(item.totalAmount || '0'),
              0
            ),
        } as Bill;
      });
      
      billEntries.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return dateB - dateA;
      });

      setBills(billEntries);
    } catch (error) {
      console.error('Error fetching bills: ', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch bills for this project.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    fetchBills();
  }, [projectSlug, toast]);

  const handleViewDetails = (bill: Bill) => {
    setSelectedBill(bill);
    setIsViewOpen(true);
  };
  
  const handleViewDeductionDetails = (e: React.MouseEvent, bill: Bill) => {
      e.stopPropagation();
      setSelectedBill(bill);
      setIsDeductionDetailsOpen(true);
  }
  
  const handleDeleteBill = async (billToDelete: Bill) => {
      if (!billToDelete.projectId) {
          toast({ title: 'Error', description: 'Cannot delete bill without project information.', variant: 'destructive'});
          return;
      }
      try {
          await deleteDoc(doc(db, 'projects', billToDelete.projectId, 'bills', billToDelete.id));
          toast({ title: 'Success', description: `Bill ${billToDelete.billNo} has been deleted.`});
          fetchBills();
      } catch (error) {
          console.error("Error deleting bill:", error);
          toast({ title: 'Error', description: 'Failed to delete the bill.', variant: 'destructive'});
      }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };
  
  const getBillType = (bill: Bill) => {
      if (bill.isRetentionBill) return { text: 'Retention', variant: 'secondary' };
      return { text: 'Regular', variant: 'default' };
  }

  return (
      <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}/billing`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Billing Log</h1>
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {projectSlug === 'all' && <TableHead>Project</TableHead>}
                  <TableHead>Bill No.</TableHead>
                  <TableHead>Bill Date</TableHead>
                  <TableHead>Bill Type</TableHead>
                  <TableHead>Work Order No.</TableHead>
                  <TableHead>Net Payable</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Deducted Advances</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={projectSlug === 'all' ? 9 : 8}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : bills.length > 0 ? (
                  bills.map((bill) => {
                    const billType = getBillType(bill);
                    const totalDeducted = (bill.advanceDeductions || []).reduce((sum, d) => sum + d.amount, 0);

                    return (
                    <TableRow
                      key={bill.id}
                      onClick={() => handleViewDetails(bill)}
                      className="cursor-pointer"
                    >
                      {projectSlug === 'all' && (
                        <TableCell className="font-medium">
                          {bill.projectName}
                        </TableCell>
                      )}
                      <TableCell className="font-medium">{bill.billNo}</TableCell>
                      <TableCell>{bill.billDate}</TableCell>
                      <TableCell>
                        <Badge variant={billType.variant as any}>
                           {billType.text}
                        </Badge>
                      </TableCell>
                      <TableCell>{bill.workOrderNo}</TableCell>
                      <TableCell>{formatCurrency(bill.netPayable || 0)}</TableCell>
                      <TableCell>{formatCurrency(bill.isRetentionBill ? -(bill.netPayable || 0) : (bill.retentionAmount || 0))}</TableCell>
                      <TableCell>
                        {totalDeducted > 0 ? (
                            <Button variant="link" className="p-0 h-auto" onClick={(e) => handleViewDeductionDetails(e, bill)}>
                                {formatCurrency(totalDeducted)}
                            </Button>
                        ) : (
                            <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDetails(bill);
                          }}
                        >
                          <View className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" disabled>
                            <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" disabled={!canDeleteBill} onClick={e => e.stopPropagation()}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent onClick={e => e.stopPropagation()}>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This will permanently delete bill {bill.billNo}. This action cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteBill(bill)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  )})
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={projectSlug === 'all' ? 9 : 8}
                      className="text-center h-24"
                    >
                      No bills found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ViewBillDialog
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        bill={selectedBill as Bill | null}
      />
      
      <Dialog open={isDeductionDetailsOpen} onOpenChange={setIsDeductionDetailsOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Advance Deductions for Bill {selectedBill?.billNo}</DialogTitle>
              </DialogHeader>
              <Table>
                  <TableHeader>
                      <TableRow>
                          <TableHead>Proforma Bill No.</TableHead>
                          <TableHead className="text-right">Deducted Amount</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {selectedBill?.advanceDeductions?.map(deduction => (
                          <TableRow key={deduction.id}>
                              <TableCell>{deduction.reference}</TableCell>
                              <TableCell className="text-right">{formatCurrency(deduction.amount)}</TableCell>
                          </TableRow>
                      ))}
                  </TableBody>
              </Table>
              <DialogFooter>
                  <DialogClose asChild>
                      <Button variant="outline">Close</Button>
                  </DialogClose>
              </DialogFooter>
          </DialogContent>
      </Dialog>
    </>
  );
}
