
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, CalendarClock, ShieldCheck, ShieldAlert, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { InsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { AddPolicyDialog } from './AddPolicyDialog';

export default function AllPoliciesTab() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddPolicyOpen, setIsAddPolicyOpen] = useState(false);

  const canViewPage = can('View', 'Insurance.Personal Insurance');
  const canAdd = can('Add', 'Insurance.Personal Insurance');
  const canEdit = can('Edit', 'Insurance.Personal Insurance');

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'insurance_policies'));
      const policiesData = querySnapshot.docs.map(doc => {
          const data = doc.data();
          return {
              id: doc.id,
              ...data,
              due_date: data.due_date ? data.due_date.toDate() : null,
              date_of_comm: data.date_of_comm ? data.date_of_comm.toDate() : null,
              date_of_maturity: data.date_of_maturity ? data.date_of_maturity.toDate() : null,
              last_premium_date: data.last_premium_date ? data.last_premium_date.toDate() : null,
          } as InsurancePolicy
      });
      setPolicies(policiesData);
    } catch (error) {
      console.error("Error fetching policies:", error);
      toast({ title: 'Error', description: 'Failed to fetch insurance policies.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    if (canViewPage) {
      fetchPolicies();
    } else {
      setIsLoading(false);
    }
  }, [authLoading, canViewPage, toast]);
  
  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A';
    return format(date, 'dd MMM, yyyy');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  if (authLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-96 mb-6" />
            <Skeleton className="h-[500px] w-full" />
        </div>
    );
  }

  if (!canViewPage) {
    return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold">All Policies</h1>
                </div>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view personal insurance policies.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
            </Card>
        </div>
    );
  }

  return (
    <>
      <div className="w-full">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">All Policies</h1>
            <p className="text-sm text-muted-foreground">Manage all personal insurance policies.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={!canAdd} onClick={() => setIsAddPolicyOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add New Policy
            </Button>
          </div>
        </div>
        
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy Holder</TableHead>
                  <TableHead>Policy No.</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Policy Name</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Next Due Date</TableHead>
                  <TableHead>Maturity Date</TableHead>
                  <TableHead>Sum Insured</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({length: 5}).map((_, i) => (
                      <TableRow key={i}>
                          <TableCell colSpan={9}><Skeleton className="h-8" /></TableCell>
                      </TableRow>
                  ))
                ) : policies.length > 0 ? (
                  policies.map(policy => (
                  <TableRow key={policy.id} onClick={() => router.push(`/insurance/personal/${policy.id}`)} className="cursor-pointer">
                    <TableCell className="font-medium">{policy.insured_person}</TableCell>
                    <TableCell>{policy.policy_no}</TableCell>
                    <TableCell>{policy.insurance_company}</TableCell>
                    <TableCell>{policy.policy_name}</TableCell>
                    <TableCell>{formatCurrency(policy.premium)}</TableCell>
                    <TableCell>{formatDate(policy.due_date)}</TableCell>
                    <TableCell>{formatDate(policy.date_of_maturity)}</TableCell>
                    <TableCell>{formatCurrency(policy.sum_insured)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/insurance/personal/edit/${policy.id}`} onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" disabled={!canEdit}>
                          <Edit className="mr-2 h-4 w-4" /> Edit
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center h-24">No policies found.</TableCell>
                  </TableRow>
                )
              }
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <AddPolicyDialog isOpen={isAddPolicyOpen} onOpenChange={setIsAddPolicyOpen} onPolicyAdded={fetchPolicies} />
    </>
  );
}
