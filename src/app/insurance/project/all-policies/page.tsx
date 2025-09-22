
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import type { ProjectInsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useRouter } from 'next/navigation';

export default function AllProjectPoliciesPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [policies, setPolicies] = useState<ProjectInsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canViewPage = can('View', 'Insurance.Project Insurance');

  useEffect(() => {
    if (isAuthLoading) return;
    if (canViewPage) {
      fetchPolicies();
    } else {
      setIsLoading(false);
    }
  }, [isAuthLoading, canViewPage]);

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'project_insurance_policies'), orderBy('insurance_start_date', 'desc'));
      const querySnapshot = await getDocs(q);
      const policiesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectInsurancePolicy));
      setPolicies(policiesData);
    } catch (error) {
      console.error("Error fetching all policies:", error);
      toast({ title: 'Error', description: 'Failed to fetch policies.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  const handleRowClick = (assetId: string) => {
    router.push(`/insurance/project/${assetId}`);
  };

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return format(d, 'dd-MMM-yy');
  };

  const formatCurrency = (amount: number) => {
    if (typeof amount !== 'number') return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
    );
  }

  if (!canViewPage) {
     return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold">All Project Policies</h1>
                </div>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view project insurance policies.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
            </Card>
        </div>
    );
  }


  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
           <Link href="/insurance/project">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">All Project Policies</h1>
              <p className="text-sm text-muted-foreground">A consolidated list of all project-related insurance policies.</p>
            </div>
        </div>
      </div>
      
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset Name</TableHead>
                <TableHead>Policy Category</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Insurance Company</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Sum Insured</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>Insured Until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : policies.length > 0 ? (
                policies.map(policy => (
                  <TableRow key={policy.id} onClick={() => handleRowClick(policy.assetId)} className="cursor-pointer">
                      <TableCell className="font-medium">{policy.assetName}</TableCell>
                      <TableCell>{policy.policy_category}</TableCell>
                      <TableCell>{policy.policy_no}</TableCell>
                      <TableCell>{policy.insurance_company}</TableCell>
                      <TableCell>{formatCurrency(policy.premium)}</TableCell>
                      <TableCell>{formatCurrency(policy.sum_insured)}</TableCell>
                      <TableCell>{formatDate(policy.insurance_start_date)}</TableCell>
                      <TableCell>{formatDate(policy.insured_until)}</TableCell>
                  </TableRow>
                ))
              ) : (
                 <TableRow>
                    <TableCell colSpan={8} className="text-center h-24">
                        No insurance policies found.
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
