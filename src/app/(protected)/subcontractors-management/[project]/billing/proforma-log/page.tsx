'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, View, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { ProformaBill, Project, Bill } from '@/lib/types';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

interface EnrichedProformaBill extends ProformaBill {
    deductedAmount: number;
    availableForDeduction: number;
    deductingBills: { billNo: string; amount: number }[];
}

export default function ProformaBillLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [proformaBills, setProformaBills] = useState<EnrichedProformaBill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchBills = async () => {
      if (!projectSlug) return;
      setIsLoading(true);
      try {
        const projectsQuery = query(collection(db, 'projects'));
        const projectSnap = await getDocs(projectsQuery);
        
        const project = projectSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as Project))
            .find(p => slugify(p.projectName) === projectSlug);

        if (!project) {
            console.error("Project not found");
            return;
        }
        const projectId = project.id;

        const proformaQuery = query(collection(db, 'projects', projectId, 'proformaBills'), orderBy('createdAt', 'desc'));
        const billsQuery = query(collection(db, 'projects', projectId, 'bills'));

        const [proformaSnapshot, billsSnapshot] = await Promise.all([
          getDocs(proformaQuery),
          getDocs(billsQuery)
        ]);

        const allBills = billsSnapshot.docs.map(doc => doc.data() as Bill);

        const entries = proformaSnapshot.docs.map(doc => {
          const data = doc.data() as ProformaBill;

          const deductions = allBills
            .flatMap(bill => bill.advanceDeductions || [])
            .filter(deduction => deduction.reference === doc.id);
          
          const deductedAmount = deductions.reduce((sum, d) => sum + d.amount, 0);
          const availableForDeduction = (data.payableAmount || 0) - deductedAmount;

          const deductingBills = allBills
            .filter(bill => bill.advanceDeductions?.some(d => d.reference === doc.id))
            .map(bill => ({
              billNo: bill.billNo,
              amount: bill.advanceDeductions.find(d => d.reference === doc.id)?.amount || 0
            }));
          
          return {
            id: doc.id,
            ...data,
            date: format(new Date(data.date), 'dd MMM, yyyy'),
            deductedAmount,
            availableForDeduction,
            deductingBills
          } as EnrichedProformaBill;
        });
        setProformaBills(entries);
      } catch (error) {
        console.error("Error fetching proforma bills: ", error);
        toast({ title: 'Error', description: 'Failed to fetch proforma bills for this project.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchBills();
  }, [projectSlug, toast]);
  
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
                  <TableHead>Proforma No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Work Order No.</TableHead>
                  <TableHead>Payable Amount</TableHead>
                  <TableHead>Deducted Amount</TableHead>
                  <TableHead>Available for Deduction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : proformaBills.length > 0 ? (
                  proformaBills.map((bill) => (
                    <Fragment key={bill.id}>
                      <TableRow className="cursor-pointer" onClick={() => toggleRowExpansion(bill.id)}>
                        <TableCell>
                          {bill.deductingBills.length > 0 && (
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                               {expandedRows.has(bill.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{bill.proformaNo}</TableCell>
                        <TableCell>{bill.date}</TableCell>
                        <TableCell>{bill.workOrderNo}</TableCell>
                        <TableCell>{formatCurrency(bill.payableAmount || 0)}</TableCell>
                        <TableCell>{formatCurrency(bill.deductedAmount)}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(bill.availableForDeduction)}</TableCell>
                      </TableRow>
                      {expandedRows.has(bill.id) && bill.deductingBills.length > 0 && (
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableCell colSpan={7} className="p-0">
                                <div className="p-4">
                                    <h4 className="font-semibold text-sm mb-2 ml-2">Deducted In Bills:</h4>
                                    <div className="flex flex-wrap gap-2">
                                    {bill.deductingBills.map((deduction, index) => (
                                        <Badge key={index} variant="outline" className="text-xs">
                                           {deduction.billNo}: {formatCurrency(deduction.amount)}
                                        </Badge>
                                    ))}
                                    </div>
                                </div>
                            </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">
                      No proforma/advance bills found.
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
