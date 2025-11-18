
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Plus, Edit, Trash2, ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, deleteDoc, query, where, collectionGroup } from 'firebase/firestore';
import type { Subcontractor, Project, ContactPerson, WorkOrder, Bill, ProformaBill } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { format } from 'date-fns';

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export default function ManageSubcontractorsPage() {
  const { toast } = useToast();
  const params = useParams();
  const router = useRouter();
  const projectSlug = params.project as string;
  const { can, isLoading: authLoading } = useAuthorization();

  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [proformaBills, setProformaBills] = useState<ProformaBill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedWorkOrders, setExpandedWorkOrders] = useState<Set<string>>(new Set());

  const canViewPage = can('View', 'Subcontractors Management.Manage Subcontractors');
  const canAdd = can('Add', 'Subcontractors Management.Manage Subcontractors');
  const canEdit = can('Edit', 'Subcontractors Management.Manage Subcontractors');
  const canDelete = can('Delete', 'Subcontractors Management.Manage Subcontractors');

  const fetchData = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const project = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

      if (project) {
        setCurrentProject(project);
      }
      
      const [subsSnap, woSnap, billsSnap, proformaSnap] = await Promise.all([
        getDocs(collection(db, 'subcontractors')),
        getDocs(collectionGroup(db, 'workOrders')),
        getDocs(collectionGroup(db, 'bills')),
        getDocs(collectionGroup(db, 'proformaBills')),
      ]);

      const subsData = subsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subcontractor));
      setSubcontractors(subsData);

      const woData = woSnap.docs.map(d => ({ id: d.id, ...d.data() } as WorkOrder));
      setWorkOrders(woData);
      
      const billsData = billsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Bill));
      setBills(billsData);
      
      const proformaData = proformaSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProformaBill));
      setProformaBills(proformaData);

    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    if (!authLoading && canViewPage) {
      fetchData();
    } else if (!authLoading) {
      setIsLoading(false);
    }
  }, [projectSlug, authLoading, canViewPage, toast]);


  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'subcontractors', id));
      toast({ title: 'Success', description: 'Subcontractor deleted.'});
      fetchData();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete subcontractor.', variant: 'destructive'});
    }
  };
  
  const getPrimaryContact = (sub: Subcontractor) => {
      const projContact = sub.contacts?.find(c => c.type === 'Project');
      return projContact || sub.contacts?.[0] || { name: 'N/A', mobile: 'N/A' };
  }
  
  const toggleRowExpansion = (subcontractorId: string) => {
    setExpandedRows(prev => {
        const newSet = new Set(prev);
        if (newSet.has(subcontractorId)) {
            newSet.delete(subcontractorId);
        } else {
            newSet.add(subcontractorId);
        }
        return newSet;
    });
  };

  const toggleWorkOrderExpansion = (workOrderId: string) => {
    setExpandedWorkOrders(prev => {
        const newSet = new Set(prev);
        if (newSet.has(workOrderId)) {
            newSet.delete(workOrderId);
        } else {
            newSet.add(workOrderId);
        }
        return newSet;
    });
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  const formatDate = (date: any) => date ? format(new Date(date), 'dd MMM, yyyy') : 'N/A';

  const enrichedWorkOrdersBySubcontractor = useMemo(() => {
    const map = new Map<string, any[]>();

    workOrders.forEach(wo => {
        const woBills = bills.filter(b => b.workOrderId === wo.id);
        const totalBilled = woBills.reduce((sum, bill) => sum + (bill.netPayable || 0), 0);

        const woProformaBills = proformaBills.filter(pb => pb.workOrderId === wo.id);
        const totalAdvanceTaken = woProformaBills.reduce((sum, bill) => sum + (bill.payableAmount || 0), 0);

        const allAdvanceDeductions = bills.flatMap(b => b.advanceDeductions || []);
        const deductedForThisWo = allAdvanceDeductions
            .filter(deduction => woProformaBills.some(proforma => proforma.id === deduction.reference))
            .reduce((sum, d) => sum + d.amount, 0);

        const advanceBalance = totalAdvanceTaken - deductedForThisWo;
        const workOrderBalance = wo.totalAmount - totalBilled;

        const billsWithDeductionsForThisWO = bills.filter(b =>
            b.advanceDeductions?.some(d => woProformaBills.some(pb => pb.id === d.reference))
        ).map(bill => {
            const relevantDeductions = bill.advanceDeductions?.filter(d => woProformaBills.some(pb => pb.id === d.reference))
            return {
                billNo: bill.billNo,
                billDate: bill.billDate,
                deductedAmount: relevantDeductions?.reduce((sum, d) => sum + d.amount, 0),
            }
        });

        const enrichedWO = {
            ...wo,
            totalBilled,
            totalAdvanceTaken,
            totalAdvanceDeducted: deductedForThisWo,
            advanceBalance,
            workOrderBalance,
            billsWithDeductionsForThisWO
        };

        if (!map.has(wo.subcontractorId)) {
            map.set(wo.subcontractorId, []);
        }
        map.get(wo.subcontractorId)!.push(enrichedWO);
    });
    return map;
  }, [workOrders, bills, proformaBills]);

  if (authLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-10 w-32" />
            </div>
            <Card>
                <CardContent className="p-0">
                    <Skeleton className="h-96 w-full" />
                </CardContent>
            </Card>
        </div>
    );
  }
  
  if (!canViewPage) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center gap-2">
              <Link href={`/subcontractors-management/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
              <h1 className="text-2xl font-bold">Manage Subcontractors</h1>
          </div>
          <Card>
              <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
              <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
          </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Manage Subcontractors</h1>
        </div>
        <Link href={`/subcontractors-management/${projectSlug}/manage/add`}>
            <Button disabled={!canAdd}><Plus className="mr-2 h-4 w-4"/> Add Subcontractor</Button>
        </Link>
      </div>
      
       <Card>
          <CardContent className="p-0">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Legal Name</TableHead>
                        <TableHead>DBA Name</TableHead>
                        <TableHead>Primary Contact</TableHead>
                        <TableHead>GST No.</TableHead>
                        <TableHead>PAN No.</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-8" /></TableCell></TableRow>
                        ))
                    ) : subcontractors.length > 0 ? (
                        subcontractors.map(sub => {
                            const primaryContact = getPrimaryContact(sub);
                            const isExpanded = expandedRows.has(sub.id);
                            const subcontractorWorkOrders = enrichedWorkOrdersBySubcontractor.get(sub.id) || [];
                            return (
                                <Fragment key={sub.id}>
                                <TableRow>
                                    <TableCell>
                                        {subcontractorWorkOrders.length > 0 && (
                                            <Button size="icon" variant="ghost" onClick={() => toggleRowExpansion(sub.id)}>
                                                {isExpanded ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
                                            </Button>
                                        )}
                                    </TableCell>
                                    <TableCell className="font-medium">{sub.legalName}</TableCell>
                                    <TableCell>{sub.dbaName || 'N/A'}</TableCell>
                                    <TableCell>{primaryContact.name} ({primaryContact.mobile})</TableCell>
                                    <TableCell>{sub.gstNumber || 'N/A'}</TableCell>
                                    <TableCell>{sub.panNumber || 'N/A'}</TableCell>
                                    <TableCell><Badge variant={sub.status === 'Active' ? 'default' : 'secondary'}>{sub.status}</Badge></TableCell>
                                    <TableCell className="text-right space-x-2">
                                        <Link href={`/subcontractors-management/${projectSlug}/manage/edit/${sub.id}`}>
                                            <Button variant="outline" size="sm" disabled={!canEdit}>
                                                <Edit className="mr-2 h-4 w-4" />Edit
                                            </Button>
                                        </Link>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" size="sm" disabled={!canDelete}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete "{sub.legalName}".</AlertDialogDescription></AlertDialogHeader>
                                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(sub.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </TableCell>
                                </TableRow>
                                {isExpanded && (
                                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                                        <TableCell colSpan={8} className="p-0">
                                            <div className="p-4">
                                                <h4 className="font-semibold mb-2 ml-2">Work Orders</h4>
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead className="w-12"></TableHead>
                                                            <TableHead>WO No.</TableHead>
                                                            <TableHead>Date</TableHead>
                                                            <TableHead>WO Value</TableHead>
                                                            <TableHead>Billed</TableHead>
                                                            <TableHead>Advance Taken</TableHead>
                                                            <TableHead>Advance Deducted</TableHead>
                                                            <TableHead>Advance Balance</TableHead>
                                                            <TableHead>WO Balance</TableHead>
                                                            <TableHead>Status</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {subcontractorWorkOrders.map(wo => {
                                                            const isWoExpanded = expandedWorkOrders.has(wo.id);
                                                            return (
                                                            <Fragment key={wo.id}>
                                                                <TableRow onClick={() => toggleWorkOrderExpansion(wo.id)} className="cursor-pointer">
                                                                    <TableCell>
                                                                        {wo.billsWithDeductionsForThisWO.length > 0 && (
                                                                            <Button size="icon" variant="ghost">
                                                                                {isWoExpanded ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
                                                                            </Button>
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell>{wo.workOrderNo}</TableCell>
                                                                    <TableCell>{formatDate(wo.date)}</TableCell>
                                                                    <TableCell>{formatCurrency(wo.totalAmount)}</TableCell>
                                                                    <TableCell>{formatCurrency(wo.totalBilled)}</TableCell>
                                                                    <TableCell>{formatCurrency(wo.totalAdvanceTaken)}</TableCell>
                                                                    <TableCell>{formatCurrency(wo.totalAdvanceDeducted)}</TableCell>
                                                                    <TableCell className="font-semibold">{formatCurrency(wo.advanceBalance)}</TableCell>
                                                                    <TableCell className="font-semibold">{formatCurrency(wo.workOrderBalance)}</TableCell>
                                                                    <TableCell>{wo.status || 'Active'}</TableCell>
                                                                </TableRow>
                                                                {isWoExpanded && (
                                                                    <TableRow className="bg-background hover:bg-background">
                                                                        <TableCell colSpan={10} className="p-2">
                                                                            <div className="p-2 border rounded-md">
                                                                                <h5 className="font-semibold text-sm mb-2 ml-2">Deducted In Bills</h5>
                                                                                <Table>
                                                                                    <TableHeader>
                                                                                        <TableRow>
                                                                                            <TableHead>Bill No.</TableHead>
                                                                                            <TableHead>Bill Date</TableHead>
                                                                                            <TableHead>Deducted Amount</TableHead>
                                                                                        </TableRow>
                                                                                    </TableHeader>
                                                                                    <TableBody>
                                                                                        {wo.billsWithDeductionsForThisWO.map((bill: any, index: number) => (
                                                                                            <TableRow key={index}>
                                                                                                <TableCell>{bill.billNo}</TableCell>
                                                                                                <TableCell>{formatDate(bill.billDate)}</TableCell>
                                                                                                <TableCell>{formatCurrency(bill.deductedAmount)}</TableCell>
                                                                                            </TableRow>
                                                                                        ))}
                                                                                    </TableBody>
                                                                                </Table>
                                                                            </div>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                )}
                                                            </Fragment>
                                                            );
                                                        })}
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
                            <TableCell colSpan={8} className="text-center h-24">
                                No subcontractors found for this project.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
          </CardContent>
       </Card>
    </div>
  );
}
