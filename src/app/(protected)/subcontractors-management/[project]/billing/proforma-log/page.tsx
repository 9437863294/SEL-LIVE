
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, View, ChevronDown, ChevronRight, Trash2, Edit } from 'lucide-react';
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
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import ViewProformaBillDialog from '@/components/subcontractors-management/ViewProformaBillDialog';
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

const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

interface EnrichedProformaBill extends ProformaBill {
  deductedAmount: number;
  availableForDeduction: number;
  deductingBills: { billNo: string; billDate: string; amount: number }[];
  projectName?: string;
}

export default function ProformaBillLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const { can } = useAuthorization();

  const [proformaBills, setProformaBills] = useState<EnrichedProformaBill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<ProformaBill | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const canDeleteBill = can('Delete Bill', 'Subcontractors Management.Billing');

  const fetchBills = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      let proformaQuery;
      let billsQuery;

      const projectsQuery = query(collection(db, 'projects'));
      const projectSnap = await getDocs(projectsQuery);
      const allProjects = projectSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));

      if (projectSlug === 'all') {
          proformaQuery = query(collectionGroup(db, 'proformaBills'));
          billsQuery = query(collectionGroup(db, 'bills'));
      } else {
          const project = allProjects.find(p => slugify(p.projectName) === projectSlug);
          if (!project) {
              console.error("Project not found");
              setIsLoading(false);
              return;
          }
          const projectId = project.id;
          proformaQuery = query(collection(db, 'projects', projectId, 'proformaBills'));
          billsQuery = query(collection(db, 'projects', projectId, 'bills'));
      }

      const [proformaSnapshot, billsSnapshot] = await Promise.all([
        getDocs(proformaQuery),
        getDocs(billsQuery)
      ]);

      const allBills = billsSnapshot.docs.map(doc => doc.data() as Bill);

      const entries = proformaSnapshot.docs.map(doc => {
        const { id, ...data } = doc.data() as ProformaBill;
        const projectId = doc.ref.parent.parent?.id;
        const project = allProjects.find(p => p.id === projectId);

        const deductions = allBills
          .flatMap(bill => bill.advanceDeductions || [])
          .filter(deduction => deduction.reference === doc.id);
        
        const deductedAmount = deductions.reduce((sum, d) => sum + d.amount, 0);
        const availableForDeduction = (data.payableAmount || 0) - deductedAmount;

        const deductingBills = allBills
          .filter(bill => bill.advanceDeductions?.some(d => d.reference === doc.id))
          .map(bill => ({
            billNo: bill.billNo,
            billDate: bill.billDate,
            amount: bill.advanceDeductions?.find(d => d.reference === doc.id)?.amount || 0
          }));
        
        return {
          id: doc.id,
          ...data,
          projectName: project?.projectName || 'Unknown',
          date: format(new Date(data.date), 'dd MMM, yyyy'),
          deductedAmount,
          availableForDeduction,
          deductingBills
        } as EnrichedProformaBill;
      });

      // Client-side sorting
      entries.sort((a, b) => {
          const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return dateB - dateA;
      });

      setProformaBills(entries);
    } catch (error) {
      console.error("Error fetching proforma bills: ", error);
      toast({ title: 'Error', description: 'Failed to fetch proforma bills for this project.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    fetchBills();
  }, [projectSlug, toast]);
  
  const handleViewDetails = (bill: ProformaBill) => {
    setSelectedBill(bill);
    setIsViewOpen(true);
  };

  const handleDeleteBill = async (billToDelete: ProformaBill) => {
    if (!billToDelete.projectId) {
        toast({ title: 'Error', description: 'Cannot delete bill without project information.', variant: 'destructive'});
        return;
    }
    try {
        await deleteDoc(doc(db, 'projects', billToDelete.projectId, 'proformaBills', billToDelete.id));
        toast({ title: 'Success', description: `Proforma Bill ${billToDelete.proformaNo} has been deleted.`});
        fetchBills();
    } catch (error) {
        console.error("Error deleting proforma bill:", error);
        toast({ title: 'Error', description: 'Failed to delete the proforma bill.', variant: 'destructive'});
    }
  }
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  const toggleRowExpansion = (proformaId: string) => {
    setExpandedRows(prev => {
        const newSet = new Set(prev);
        if (newSet.has(proformaId)) {
            newSet.delete(proformaId);
        } else {
            newSet.add(proformaId);
        }
        return newSet;
    });
  };

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
            <h1 className="text-2xl font-bold">Proforma/Advance Bill Log</h1>
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  {projectSlug === 'all' && <TableHead>Project</TableHead>}
                  <TableHead>Proforma No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Work Order No.</TableHead>
                  <TableHead>Payable %</TableHead>
                  <TableHead>Payable Amount</TableHead>
                  <TableHead>Deducted Amount</TableHead>
                  <TableHead>Available for Deduction</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={projectSlug === 'all' ? 10 : 9}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : proformaBills.length > 0 ? (
                  proformaBills.map((bill) => {
                    const isExpanded = expandedRows.has(bill.id);
                    return (
                        <Fragment key={bill.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggleRowExpansion(bill.id)}>
                            <TableCell>
                                {bill.deductingBills.length > 0 && (
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                        {isExpanded ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
                                    </Button>
                                )}
                            </TableCell>
                            {projectSlug === 'all' && <TableCell className="font-medium">{bill.projectName}</TableCell>}
                            <TableCell className="font-medium">{bill.proformaNo}</TableCell>
                            <TableCell>{bill.date}</TableCell>
                            <TableCell>{bill.workOrderNo}</TableCell>
                            <TableCell>{bill.payablePercentage}%</TableCell>
                            <TableCell>{formatCurrency(bill.payableAmount || 0)}</TableCell>
                            <TableCell>{formatCurrency(bill.deductedAmount)}</TableCell>
                            <TableCell className="font-semibold">{formatCurrency(bill.availableForDeduction)}</TableCell>
                            <TableCell className="text-right">
                                <Button variant="ghost" size="icon" onClick={(e) => {e.stopPropagation(); handleViewDetails(bill)}}>
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
                                            <AlertDialogDescription>This will permanently delete proforma bill {bill.proformaNo}. This action cannot be undone.</AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDeleteBill(bill)}>Delete</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </TableCell>
                        </TableRow>
                        {isExpanded && bill.deductingBills.length > 0 && (
                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableCell colSpan={projectSlug === 'all' ? 10 : 9} className="p-2">
                                    <div className="p-2 bg-background rounded-md">
                                        <h4 className="font-semibold text-sm mb-2 ml-2">Deducted In Bills:</h4>
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Bill No.</TableHead>
                                                    <TableHead>Bill Date</TableHead>
                                                    <TableHead>Deducted Amount</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {bill.deductingBills.map((deduction, index) => (
                                                    <TableRow key={index}>
                                                        <TableCell>{deduction.billNo}</TableCell>
                                                        <TableCell>{format(new Date(deduction.billDate), 'dd MMM, yyyy')}</TableCell>
                                                        <TableCell>{formatCurrency(deduction.amount)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                        </Fragment>
                    )
                })
                ) : (
                  <TableRow>
                    <TableCell colSpan={projectSlug === 'all' ? 10 : 9} className="text-center h-24">
                      No proforma/advance bills found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ViewProformaBillDialog
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        bill={selectedBill}
      />
    </>
  );
}
