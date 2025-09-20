
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import type { InsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, isPast, isWithinInterval, addDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';

export default function PremiumDuePage() {
  const { toast } = useToast();
  const router = useRouter();
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPolicies = async () => {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'insurance_policies'), where('due_date', '!=', null), orderBy('due_date', 'asc'));
        const querySnapshot = await getDocs(q);
        const policiesData = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                due_date: data.due_date ? data.due_date.toDate() : null,
            } as InsurancePolicy
        });
        setPolicies(policiesData);
      } catch (error) {
        console.error("Error fetching policies:", error);
        toast({ title: 'Error', description: 'Failed to fetch insurance policies.', variant: 'destructive' });
      }
      setIsLoading(false);
    };

    fetchPolicies();
  }, [toast]);
  
  const getStatus = (dueDate: Date | null) => {
    if (!dueDate) return { text: 'N/A', variant: 'secondary' as const };
    if (isPast(dueDate)) return { text: 'Overdue', variant: 'destructive' as const };
    if (isWithinInterval(dueDate, { start: new Date(), end: addDays(new Date(), 30) })) {
      return { text: 'Due Soon', variant: 'default' as const };
    }
    return { text: 'Upcoming', variant: 'secondary' as const };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const handleRowClick = (policyId: string) => {
    router.push(`/insurance/personal/${policyId}`);
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/insurance"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <div>
            <h1 className="text-xl font-bold">Premium Due</h1>
            <p className="text-sm text-muted-foreground">Upcoming and overdue insurance premium payments.</p>
          </div>
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
                <TableHead>Premium</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}><Skeleton className="h-8" /></TableCell>
                  </TableRow>
                ))
              ) : policies.length > 0 ? (
                policies.map(policy => {
                  const status = getStatus(policy.due_date);
                  return (
                    <TableRow key={policy.id} onClick={() => handleRowClick(policy.id)} className="cursor-pointer">
                      <TableCell className="font-medium">{policy.insured_person}</TableCell>
                      <TableCell>{policy.policy_no}</TableCell>
                      <TableCell>{policy.insurance_company}</TableCell>
                      <TableCell>{formatCurrency(policy.premium)}</TableCell>
                      <TableCell>{policy.due_date ? format(policy.due_date, 'dd MMM, yyyy') : 'N/A'}</TableCell>
                      <TableCell><Badge variant={status.variant}>{status.text}</Badge></TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">No policies with upcoming due dates found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
