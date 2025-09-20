
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit } from 'lucide-react';
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

export default function PersonalInsurancePage() {
  const { toast } = useToast();
  const router = useRouter();
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
    fetchPolicies();
  }, [toast]);
  
  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A';
    return format(date, 'dd MMM, yyyy');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  return (
    <>
      <div className="w-full">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Personal Insurance</h1>
            <p className="text-sm text-muted-foreground">Manage all personal insurance policies.</p>
          </div>
          <Link href="/insurance/personal/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add New Policy
            </Button>
          </Link>
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
                        <Button variant="outline" size="sm">
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
    </>
  );
}
