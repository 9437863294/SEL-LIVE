
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, CalendarClock, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import type { ProjectInsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';

export default function ProjectInsurancePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  
  const [policies, setPolicies] = useState<ProjectInsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canViewPage = can('View', 'Insurance.Project Insurance');
  const canAdd = can('Add', 'Insurance.Project Insurance');
  const canEdit = can('Edit', 'Insurance.Project Insurance');

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const policiesSnapshot = await getDocs(collection(db, 'project_insurance_policies'));
      const policiesData = policiesSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
              id: doc.id,
              ...data,
              insurance_start_date: data.insurance_start_date ? data.insurance_start_date.toDate() : null,
              insured_until: data.insured_until ? data.insured_until.toDate() : null,
          } as ProjectInsurancePolicy
      });
      setPolicies(policiesData);
    } catch (error) {
      console.error("Error fetching policies:", error);
      toast({ title: 'Error', description: 'Failed to fetch project insurance policies.', variant: 'destructive' });
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
                    <h1 className="text-xl font-bold">Project Insurance</h1>
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
    <>
      <div className="w-full">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Project Insurance</h1>
            <p className="text-sm text-muted-foreground">Manage all project-specific insurance policies.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/insurance/project/new">
              <Button disabled={!canAdd}>
                <Plus className="mr-2 h-4 w-4" /> Add New Policy
              </Button>
            </Link>
          </div>
        </div>
        
        <Card className="mb-6">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project Name/Site</TableHead>
                  <TableHead>Policy No.</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Policy Category</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Insured Until</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({length: 5}).map((_, i) => (
                      <TableRow key={i}>
                          <TableCell colSpan={8}><Skeleton className="h-8" /></TableCell>
                      </TableRow>
                  ))
                ) : policies.length > 0 ? (
                  policies.map(policy => (
                  <TableRow key={policy.id} onClick={() => router.push(`/insurance/project/${policy.id}`)} className="cursor-pointer">
                    <TableCell className="font-medium">{policy.assetName}</TableCell>
                    <TableCell>{policy.policy_no}</TableCell>
                    <TableCell>{policy.insurance_company}</TableCell>
                    <TableCell>{policy.policy_category}</TableCell>
                    <TableCell>{formatCurrency(policy.premium)}</TableCell>
                    <TableCell>{formatDate(policy.insured_until)}</TableCell>
                    <TableCell><Badge>{policy.status || 'N/A'}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Link href={`/insurance/project/${policy.id}`} onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" disabled={!canEdit}>
                          <Edit className="mr-2 h-4 w-4" /> Details
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-24">No policies found.</TableCell>
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
