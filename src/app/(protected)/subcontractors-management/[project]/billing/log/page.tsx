
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, View, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  Timestamp,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format, getYear } from 'date-fns';
import type { Bill, Project, ProformaBill, Subcontractor, WorkOrder } from '@/lib/types';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

type UnifiedBill = (Omit<Bill, 'id'> | Omit<ProformaBill, 'id'>) & {
  id: string;
  type: 'Regular' | 'Retention' | 'Proforma';
  sortDate: Date;
  projectName?: string;
  projectId?: string;
  workOrderNo: string;
  subcontractorName: string;
  subcontractorId: string;
  netPayable: number;
  retentionAmount?: number;
  advanceDeductions?: Bill['advanceDeductions'];
};

function stripId<T extends object>(obj: T & { id?: any }): Omit<T, 'id'> {
  const { id: _ignored, ...rest } = obj as any;
  return rest as Omit<T, 'id'>;
}

function toDateSafe(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

export default function BillLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const { can } = useAuthorization();

  const [allBills, setAllBills] = useState<UnifiedBill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [proformaBills, setProformaBills] = useState<ProformaBill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<UnifiedBill | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isDeductionDetailsOpen, setIsDeductionDetailsOpen] = useState(false);
  
  const [filters, setFilters] = useState({
    project: projectSlug === 'all' ? 'all' : projectSlug,
    workOrder: 'all',
    subcontractor: 'all',
    year: 'all',
    month: 'all',
    type: 'all',
  });

  const canDeleteBill = can('Delete Bill', 'Subcontractors Management.Billing');

  const fetchBills = async () => {
    setIsLoading(true);
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectSnap = await getDocs(projectsQuery);
      const allProjects = projectSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setProjects(allProjects);

      const allSubcontractors: Subcontractor[] = [];
      const subsQueryPromises = allProjects.map(p => getDocs(collection(db, 'projects', p.id, 'subcontractors')));
      const subsSnaps = await Promise.all(subsQueryPromises);
      subsSnaps.forEach(snap => {
        allSubcontractors.push(...snap.docs.map(d => ({id: d.id, ...d.data()} as Subcontractor)));
      });
      setSubcontractors(allSubcontractors);

      const allWorkOrders: WorkOrder[] = [];
      const woQueryPromises = allProjects.map(p => getDocs(collection(db, 'projects', p.id, 'workOrders')));
      const woSnaps = await Promise.all(woQueryPromises);
      woSnaps.forEach(snap => {
        allWorkOrders.push(...snap.docs.map(d => ({id: d.id, ...d.data()} as WorkOrder)));
      });
      setWorkOrders(allWorkOrders);

      const billsQuery = query(collectionGroup(db, 'bills'));
      const proformaQuery = query(collectionGroup(db, 'proformaBills'));
      
      const [billsSnapshot, proformaSnapshot] = await Promise.all([
        getDocs(billsQuery),
        getDocs(proformaQuery),
      ]);

      const billEntries: UnifiedBill[] = billsSnapshot.docs.map((doc) => {
        const data = doc.data() as Bill;
        const projectId = doc.ref.parent.parent?.id;
        const project = allProjects.find(p => p.id === projectId);
        return {
          ...stripId(data as any),
          id: doc.id,
          projectId: projectId,
          projectName: project?.projectName || 'Unknown',
          type: data.isRetentionBill ? 'Retention' : 'Regular',
          sortDate: toDateSafe(data.createdAt) || toDateSafe(data.billDate) || new Date(),
        } as UnifiedBill;
      });

      const proformaData = proformaSnapshot.docs.map((doc) => ({id: doc.id, ...stripId(doc.data() as any)} as ProformaBill));
      setProformaBills(proformaData);

      const proformaEntries: UnifiedBill[] = proformaData.map((data) => {
        const projectId = data.projectId;
        const project = allProjects.find(p => p.id === projectId);
        return {
          ...data,
          id: data.id,
          billNo: data.proformaNo,
          billDate: data.date,
          netPayable: data.payableAmount,
          projectName: project?.projectName || 'Unknown',
          type: 'Proforma',
          sortDate: toDateSafe(data.createdAt) || toDateSafe(data.date) || new Date(),
        } as UnifiedBill;
      });

      const combined = [...billEntries, ...proformaEntries];
      combined.sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime());
      setAllBills(combined);

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

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({...prev, [field]: value}));
  }

  const filteredBills = useMemo(() => {
    return allBills.filter(bill => {
      const projectMatch = filters.project === 'all' || slugify(bill.projectName || '') === filters.project;
      const woMatch = filters.workOrder === 'all' || bill.workOrderNo === filters.workOrder;
      const subMatch = filters.subcontractor === 'all' || bill.subcontractorId === filters.subcontractor;
      const yearMatch = filters.year === 'all' || getYear(bill.sortDate).toString() === filters.year;
      const monthMatch = filters.month === 'all' || bill.sortDate.getMonth().toString() === filters.month;
      const typeMatch = filters.type === 'all' || bill.type === filters.type;

      return projectMatch && woMatch && subMatch && yearMatch && monthMatch && typeMatch;
    });
  }, [allBills, filters]);
  
  const filterOptions = useMemo(() => {
    const visibleProjects = projects.filter(p => allBills.some(b => b.projectId === p.id));
    const visibleWOs = workOrders.filter(wo => allBills.some(b => b.workOrderNo === wo.workOrderNo));
    const visibleSubs = subcontractors.filter(s => allBills.some(b => b.subcontractorId === s.id));
    const years = [...new Set(allBills.map(b => getYear(b.sortDate).toString()))].sort((a,b) => parseInt(b) - parseInt(a));
    const months = Array.from({length: 12}, (_, i) => ({ value: i.toString(), label: format(new Date(0, i), 'MMMM') }));

    return { projects: visibleProjects, workOrders: visibleWOs, subcontractors: visibleSubs, years, months };
  }, [allBills, projects, workOrders, subcontractors]);

  const handleViewDetails = (bill: UnifiedBill) => {
    setSelectedBill(bill);
    setIsViewOpen(true);
  };
  
  const handleViewDeductionDetails = (e: React.MouseEvent, bill: UnifiedBill) => {
      e.stopPropagation();
      setSelectedBill(bill);
      setIsDeductionDetailsOpen(true);
  }
  
  const handleDeleteBill = async (billToDelete: UnifiedBill) => {
      const collectionName = billToDelete.type === 'Proforma' ? 'proformaBills' : 'bills';
      if (!billToDelete.projectId) {
          toast({ title: 'Error', description: 'Cannot delete bill without project information.', variant: 'destructive'});
          return;
      }
      try {
          await deleteDoc(doc(db, 'projects', billToDelete.projectId, collectionName, billToDelete.id));
          toast({ title: 'Success', description: `Bill ${billToDelete.type === 'Proforma' ? (billToDelete as ProformaBill).proformaNo : (billToDelete as Bill).billNo} has been deleted.`});
          fetchBills();
      } catch (error) {
          console.error("Error deleting bill:", error);
          toast({ title: 'Error', description: 'Failed to delete the bill.', variant: 'destructive'});
      }
  }

  const formatCurrency = (amount: number) => {
    if (isNaN(amount)) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };

  const formatDateSafe = (dateInput: any): string => {
    const date = toDateSafe(dateInput);
    if (!date) return 'N/A';
    try {
      return format(date, 'dd MMM, yyyy');
    } catch {
      return 'Invalid Date';
    }
  };

  return (
      <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug === 'all' ? '' : projectSlug}`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Billing Log</h1>
          </div>
        </div>
        
        <Card className="mb-6">
            <CardHeader className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {projectSlug === 'all' && (
                        <Select value={filters.project} onValueChange={(v) => handleFilterChange('project', v)}>
                            <SelectTrigger><SelectValue placeholder="All Projects" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Projects</SelectItem>
                                {filterOptions.projects.map(p => <SelectItem key={p.id} value={slugify(p.projectName)}>{p.projectName}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                     <Select value={filters.workOrder} onValueChange={(v) => handleFilterChange('workOrder', v)}>
                        <SelectTrigger><SelectValue placeholder="All Work Orders" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Work Orders</SelectItem>
                            {filterOptions.workOrders.map(wo => <SelectItem key={wo.id} value={wo.workOrderNo}>{wo.workOrderNo}</SelectItem>)}
                        </SelectContent>
                    </Select>
                     <Select value={filters.subcontractor} onValueChange={(v) => handleFilterChange('subcontractor', v)}>
                        <SelectTrigger><SelectValue placeholder="All Subcontractors" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Subcontractors</SelectItem>
                            {filterOptions.subcontractors.map(s => <SelectItem key={s.id} value={s.id}>{s.legalName}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={filters.type} onValueChange={(v) => handleFilterChange('type', v)}>
                        <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Types</SelectItem>
                            <SelectItem value="Regular">Regular</SelectItem>
                            <SelectItem value="Retention">Retention</SelectItem>
                            <SelectItem value="Proforma">Proforma</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={filters.year} onValueChange={(v) => handleFilterChange('year', v)}>
                        <SelectTrigger><SelectValue placeholder="All Years" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Years</SelectItem>
                            {filterOptions.years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                        </SelectContent>
                    </Select>
                     <Select value={filters.month} onValueChange={(v) => handleFilterChange('month', v)}>
                        <SelectTrigger><SelectValue placeholder="All Months" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Months</SelectItem>
                            {filterOptions.months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </CardHeader>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {projectSlug === 'all' && <TableHead>Project</TableHead>}
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Work Order No.</TableHead>
                  <TableHead>Net Amount</TableHead>
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
                ) : filteredBills.length > 0 ? (
                  filteredBills.map((bill) => {
                    const billDate = toDateSafe(bill.type === 'Proforma' ? (bill as ProformaBill).date : (bill as Bill).billDate);
                    const retentionAmount = bill.type === 'Retention' ? -(bill.netPayable || 0) : (bill.retentionAmount || 0);
                    const totalDeducted = bill.type === 'Regular' ? (bill.advanceDeductions || []).reduce((sum, d) => sum + d.amount, 0) : 0;
                    
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
                      <TableCell>{formatDateSafe(billDate)}</TableCell>
                      <TableCell>
                        <Badge variant={bill.type === 'Regular' ? 'default' : (bill.type === 'Retention' ? 'secondary' : 'outline')}>{bill.type}</Badge>
                      </TableCell>
                      <TableCell>{bill.workOrderNo}</TableCell>
                      <TableCell>{formatCurrency(bill.netPayable)}</TableCell>
                      <TableCell>{formatCurrency(retentionAmount)}</TableCell>
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
                                    <AlertDialogDescription>This will permanently delete this document. This action cannot be undone.</AlertDialogDescription>
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

      {selectedBill && (selectedBill.type === 'Proforma' ? (
        <ViewProformaBillDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          bill={selectedBill as ProformaBill | null}
        />
      ) : (
        <ViewBillDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          bill={selectedBill as Bill | null}
          proformaBills={proformaBills}
        />
      ))}
      
      <Dialog open={isDeductionDetailsOpen} onOpenChange={setIsDeductionDetailsOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Advance Deductions for Bill {(selectedBill as Bill)?.billNo}</DialogTitle>
              </DialogHeader>
              <Table>
                  <TableHeader>
                      <TableRow>
                          <TableHead>Proforma Bill No.</TableHead>
                          <TableHead className="text-right">Deducted Amount</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {(selectedBill as Bill)?.advanceDeductions?.map((deduction, index) => {
                          const proforma = proformaBills.find(p => p.id === deduction.reference);
                          return (
                            <TableRow key={deduction.id || index}>
                                <TableCell>{proforma?.proformaNo || deduction.reference}</TableCell>
                                <TableCell className="text-right">{formatCurrency(deduction.amount)}</TableCell>
                            </TableRow>
                          )
                      })}
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
