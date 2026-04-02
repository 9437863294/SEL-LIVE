
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit, Save, Loader2, RefreshCw, X, Eye, FilePlus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { doc, getDoc, updateDoc, collection, getDocs, Timestamp, arrayUnion, runTransaction } from 'firebase/firestore';
import type { InsurancePolicy, PolicyRenewal, Attachment, EMI } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { format, addMonths, addYears, addQuarters, isPast, isWithinInterval, addDays } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RenewalDialog } from '@/components/RenewalDialog';

export default function PolicyDetailsPage() {
  const { policyId } = useParams() as { policyId: string };
  const { toast } = useToast();
  const router = useRouter();
  const [policy, setPolicy] = useState<InsurancePolicy | null>(null);
  const [renewals, setRenewals] = useState<PolicyRenewal[]>([]);
  const [premiumSchedule, setPremiumSchedule] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRenewOpen, setIsRenewOpen] = useState(false);
  const [selectedEmiForRenewal, setSelectedEmiForRenewal] = useState<any | null>(null);


  const fetchPolicyData = async () => {
    if (!policyId) return;
    setIsLoading(true);
    try {
      const policyDocRef = doc(db, 'insurance_policies', policyId);
      const policyDocSnap = await getDoc(policyDocRef);

      if (policyDocSnap.exists()) {
        const policyData = { id: policyDocSnap.id, ...policyDocSnap.data() } as InsurancePolicy;
        setPolicy(policyData);

        const renewalsCollectionRef = collection(db, 'insurance_policies', policyId, 'renewals');
        const renewalsSnapshot = await getDocs(renewalsCollectionRef);
        const renewalsData = renewalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyRenewal));
        renewalsData.sort((a, b) => b.paymentDate.toMillis() - a.paymentDate.toMillis());
        setRenewals(renewalsData);
        
      } else {
        toast({ title: "Error", description: "Policy not found.", variant: "destructive" });
        router.push('/insurance/personal');
      }
    } catch (error) {
      console.error("Error fetching policy data:", error);
      toast({ title: "Error", description: "Failed to fetch policy details.", variant: "destructive" });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    fetchPolicyData();
  }, [policyId, toast, router]);

  const getStatus = (dueDate: Date | null) => {
    if (!dueDate) return { text: 'N/A', variant: 'secondary' as const, isDue: false };
    if (isPast(dueDate)) return { text: 'Overdue', variant: 'destructive' as const, isDue: true };
    if (isWithinInterval(dueDate, { start: new Date(), end: addDays(new Date(), 30) })) {
      return { text: 'Due Soon', variant: 'default' as const, isDue: true };
    }
    return { text: 'Upcoming', variant: 'secondary' as const, isDue: false };
  };
  
  useEffect(() => {
    if (!policy) return;

    const schedule: any[] = [];
    const startDate = policy.date_of_comm?.toDate();
    if (!startDate || !policy.tenure) {
        setPremiumSchedule([]);
        return;
    }

    let paymentCount = 0;
    
    if (policy.payment_type === 'One-Time') {
        paymentCount = 1;
    } else if (policy.payment_type === 'Monthly') {
        paymentCount = policy.tenure * 12;
    } else if (policy.payment_type === 'Quarterly') {
        paymentCount = policy.tenure * 4;
    } else if (policy.payment_type === 'Yearly') {
        paymentCount = policy.tenure;
    }

    for (let i = 0; i < paymentCount; i++) {
        let dueDate: Date;
        if (policy.payment_type === 'Monthly') {
            dueDate = addMonths(startDate, i);
        } else if (policy.payment_type === 'Quarterly') {
            dueDate = addQuarters(startDate, i);
        } else if (policy.payment_type === 'Yearly') {
            dueDate = addYears(startDate, i);
        } else {
            dueDate = startDate; // One-Time
        }

        const renewal = renewals.find(r => format(r.paymentDate.toDate(), 'yyyy-MM-dd') === format(dueDate, 'yyyy-MM-dd'));
        const statusDetails = getStatus(dueDate);
        
        schedule.push({
            no: i + 1,
            dueDate,
            status: renewal ? 'Paid' : statusDetails.text,
            isDue: renewal ? false : statusDetails.isDue,
            statusVariant: renewal ? 'default' : statusDetails.variant,
            renewalDetails: renewal || null,
        });
    }

    setPremiumSchedule(schedule);

  }, [policy, renewals]);

  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A';
    return format(date, 'dd MMM, yyyy');
  };
  
  const openRenewDialog = (emi: any) => {
    setSelectedEmiForRenewal(emi);
    setIsRenewOpen(true);
  }
  
  if (isLoading) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-64 mb-6" />
            <Skeleton className="h-48 mb-6" />
            <Skeleton className="h-96" />
        </div>
    )
  }

  if (!policy) return null;

  return (
    <>
    <div className="w-full">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{policy.policy_name}</h1>
            <p className="text-muted-foreground">{policy.policy_no} - {policy.insured_person}</p>
          </div>
          <Link href={`/insurance/personal/edit/${policy.id}`}>
            <Button variant="outline">
              <Edit className="mr-2 h-4 w-4" /> Edit Policy
            </Button>
          </Link>
        </div>
        
        <Card className="mb-6">
            <CardHeader>
                <CardTitle>Policy Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                <div><Label>Company</Label><p className="font-semibold">{policy.insurance_company}</p></div>
                <div><Label>Premium</Label><p className="font-semibold">{formatCurrency(policy.premium)}</p></div>
                <div><Label>Sum Insured</Label><p className="font-semibold">{formatCurrency(policy.sum_insured)}</p></div>
                <div><Label>Payment Type</Label><p className="font-semibold">{policy.payment_type}</p></div>
                <div><Label>Start Date</Label><p className="font-semibold">{formatDate(policy.date_of_comm?.toDate() ?? null)}</p></div>
                <div><Label>Maturity Date</Label><p className="font-semibold">{formatDate(policy.date_of_maturity?.toDate() ?? null)}</p></div>
                <div><Label>Tenure</Label><p className="font-semibold">{policy.tenure} years</p></div>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle>Premium Schedule & Renewals</CardTitle>
                <CardDescription>History of all premium payments for this policy.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Due Date</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Payment Date</TableHead>
                            <TableHead>Payment Type</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {premiumSchedule.map((emi) => (
                            <TableRow key={emi.no}>
                                <TableCell>{emi.no}</TableCell>
                                <TableCell>{formatDate(emi.dueDate)}</TableCell>
                                <TableCell><Badge variant={emi.statusVariant}>{emi.status}</Badge></TableCell>
                                <TableCell>{emi.renewalDetails ? formatDate(emi.renewalDetails.paymentDate.toDate()) : 'N/A'}</TableCell>
                                <TableCell>{emi.renewalDetails ? emi.renewalDetails.paymentType : 'N/A'}</TableCell>
                                <TableCell className="text-right">
                                    {emi.status !== 'Paid' && (
                                        <Button size="sm" onClick={() => openRenewDialog(emi)} disabled={!emi.isDue}>
                                            <RotateCcw className="mr-2 h-4 w-4" /> Renew
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    </div>
    {selectedEmiForRenewal && (
        <RenewalDialog 
            isOpen={isRenewOpen}
            onOpenChange={setIsRenewOpen}
            policy={policy}
            onSuccess={fetchPolicyData}
            defaultPaymentDate={selectedEmiForRenewal.dueDate}
        />
    )}
    </>
  );
}
