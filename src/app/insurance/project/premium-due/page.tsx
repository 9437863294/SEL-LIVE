
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, RotateCw, CalendarClock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import type { ProjectInsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, isPast, isWithinInterval, addDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { ProjectRenewalDialog } from '@/components/ProjectRenewalDialog';
import { useAuthorization } from '@/hooks/useAuthorization';

export default function ProjectPremiumDuePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  
  const [policies, setPolicies] = useState<ProjectInsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPolicyForRenewal, setSelectedPolicyForRenewal] = useState<ProjectInsurancePolicy | null>(null);
  const [isRenewDialogOpen, setIsRenewDialogOpen] = useState(false);
  
  const canViewPage = can('View', 'Insurance.Project Insurance');
  const canRenewPolicy = can('Renew', 'Insurance.Project Insurance');

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'project_insurance_policies'), where('status', '==', 'Active'), orderBy('insured_until', 'asc'));
      const querySnapshot = await getDocs(q);
      const policiesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectInsurancePolicy));
      setPolicies(policiesData);
    } catch (error) {
      console.error("Error fetching policies:", error);
      toast({ title: 'Error', description: 'Failed to fetch insurance policies.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!authLoading && canViewPage) {
        fetchPolicies();
    } else {
        setIsLoading(false);
    }
  }, [authLoading, canViewPage, toast]);
  
  const getStatus = (expiryDate: any) => {
    if (!expiryDate) return { text: 'N/A', variant: 'secondary' as const, isDue: false };
    const date = expiryDate.toDate();
    if (isPast(date)) return { text: 'Expired', variant: 'destructive' as const, isDue: true };
    if (isWithinInterval(date, { start: new Date(), end: addDays(new Date(), 30) })) {
      return { text: 'Expires Soon', variant: 'default' as const, isDue: true };
    }
    return { text: 'Active', variant: 'secondary' as const, isDue: false };
  };

  const formatCurrency = (amount: number) => {
    if (typeof amount !== 'number') return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const handleRenewClick = (policy: ProjectInsurancePolicy) => {
    setSelectedPolicyForRenewal(policy);
    setIsRenewDialogOpen(true);
  };
  
  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return format(d, 'dd MMM, yyyy');
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
            <div className="mb-6"><h1 className="text-xl font-bold">Project Premium Due</h1></div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view this page.</CardDescription>
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
          <div className="flex items-center gap-2">
            <Link href="/insurance/project">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Project Premium Due</h1>
              <p className="text-sm text-muted-foreground">Upcoming and expired project policy renewals.</p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Name</TableHead>
                  <TableHead>Policy No.</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8" /></TableCell></TableRow>
                  ))
                ) : policies.length > 0 ? (
                  policies.map(policy => {
                    const status = getStatus(policy.insured_until);
                    return (
                      <TableRow key={policy.id}>
                        <TableCell className="font-medium">{policy.assetName}</TableCell>
                        <TableCell>{policy.policy_no}</TableCell>
                        <TableCell>{policy.policy_category}</TableCell>
                        <TableCell>{formatCurrency(policy.premium)}</TableCell>
                        <TableCell>{formatDate(policy.insured_until)}</TableCell>
                        <TableCell><Badge variant={status.variant}>{status.text}</Badge></TableCell>
                        <TableCell className="text-right">
                            <Button size="sm" disabled={!status.isDue || !canRenewPolicy} onClick={() => handleRenewClick(policy)}>
                                <RotateCw className="mr-2 h-4 w-4" /> Renew
                            </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">No policies with upcoming due dates.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {selectedPolicyForRenewal && (
        <ProjectRenewalDialog 
            isOpen={isRenewDialogOpen}
            onOpenChange={setIsRenewDialogOpen}
            policy={selectedPolicyForRenewal}
            onSuccess={fetchPolicies}
        />
      )}
    </>
  );
}
