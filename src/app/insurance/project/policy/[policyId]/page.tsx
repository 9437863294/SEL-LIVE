
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit, Save, Loader2, RefreshCw, X, Eye, FilePlus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import type { ProjectInsurancePolicy, InsuredAsset, Project, ProjectPolicyRenewal } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { format, addYears, addMonths } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ProjectRenewalDialog } from '@/components/ProjectRenewalDialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export default function ProjectPolicyDetailsPage() {
  const { policyId } = useParams() as { policyId: string };
  const { toast } = useToast();
  const router = useRouter();
  const [policy, setPolicy] = useState<ProjectInsurancePolicy | null>(null);
  const [asset, setAsset] = useState<InsuredAsset | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [history, setHistory] = useState<ProjectPolicyRenewal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRenewOpen, setIsRenewOpen] = useState(false);

  const fetchPolicyData = useCallback(async () => {
    if (!policyId) return;
    setIsLoading(true);
    try {
      const policyDocRef = doc(db, 'project_insurance_policies', policyId);
      const policyDocSnap = await getDoc(policyDocRef);

      if (policyDocSnap.exists()) {
        const policyData = { id: policyDocSnap.id, ...policyDocSnap.data() } as ProjectInsurancePolicy;
        setPolicy(policyData);
        
        const assetDocRef = doc(db, 'insuredAssets', policyData.assetId);
        const assetDocSnap = await getDoc(assetDocRef);
        if (assetDocSnap.exists()) {
            const assetData = assetDocSnap.data() as InsuredAsset;
            setAsset(assetData);
            if (assetData.type === 'Project' && assetData.projectId) {
                const projectDocRef = doc(db, 'projects', assetData.projectId);
                const projectDocSnap = await getDoc(projectDocRef);
                if (projectDocSnap.exists()) {
                    setProject(projectDocSnap.data() as Project);
                }
            }
        }
        
        const historyCollectionRef = collection(db, 'project_insurance_policies', policyId, 'history');
        const historySnapshot = await getDocs(query(historyCollectionRef, orderBy('renewalDate', 'desc')));
        const historyData = historySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectPolicyRenewal));
        setHistory(historyData);

      } else {
        toast({ title: "Error", description: "Policy not found.", variant: "destructive" });
        router.push('/insurance/project');
      }
    } catch (error) {
      console.error("Error fetching policy data:", error);
      toast({ title: "Error", description: "Failed to fetch policy details.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [policyId, toast, router]);
  
  useEffect(() => {
    fetchPolicyData();
  }, [fetchPolicyData]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return format(d, 'dd MMM, yyyy');
  };
  
  if (isLoading) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-64 mb-6" />
            <Skeleton className="h-48 mb-6" />
            <Skeleton className="h-96" />
        </div>
    )
  }

  if (!policy || !asset) return null;

  const assetName = asset?.type === 'Project' && project ? project.projectName : asset?.name;

  return (
    <>
    <div className="w-full">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{policy.policy_no}</h1>
            <p className="text-muted-foreground">{policy.policy_category} for {assetName}</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/insurance/project/edit/${policy.id}`}>
              <Button variant="outline">
                <Edit className="mr-2 h-4 w-4" /> Edit Policy
              </Button>
            </Link>
            <Button onClick={() => setIsRenewOpen(true)} disabled={policy.status !== 'Renewable'}>
              <RefreshCw className="mr-2 h-4 w-4" /> Renew Policy
            </Button>
          </div>
        </div>
        
        <Card className="mb-6">
            <CardHeader>
                <CardTitle>Policy Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                <div><Label>Company</Label><p className="font-semibold">{policy.insurance_company}</p></div>
                <div><Label>Premium</Label><p className="font-semibold">{formatCurrency(policy.premium)}</p></div>
                <div><Label>Sum Insured</Label><p className="font-semibold">{formatCurrency(policy.sum_insured)}</p></div>
                <div><Label>Status</Label><p><Badge variant={policy.status === 'Renewable' ? 'default' : 'secondary'}>{policy.status}</Badge></p></div>
                <div><Label>Start Date</Label><p className="font-semibold">{formatDate(policy.insurance_start_date)}</p></div>
                <div><Label>Insured Until</Label><p className="font-semibold">{formatDate(policy.insured_until)}</p></div>
                <div><Label>Tenure</Label><p className="font-semibold">{policy.tenure_years} years, {policy.tenure_months} months</p></div>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle>Renewal History</CardTitle>
                <CardDescription>History of all renewals for this policy.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Renewed On</TableHead>
                            <TableHead>Old Policy No.</TableHead>
                            <TableHead>Old Premium</TableHead>
                            <TableHead>Old Period</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {history.length > 0 ? history.map((h) => (
                            <TableRow key={h.id}>
                                <TableCell>{formatDate(h.renewalDate)}</TableCell>
                                <TableCell>{h.policyNo}</TableCell>
                                <TableCell>{formatCurrency(h.premium)}</TableCell>
                                <TableCell>{formatDate(h.startDate)} to {formatDate(h.endDate)}</TableCell>
                            </TableRow>
                        )) : (
                           <TableRow><TableCell colSpan={4} className="h-24 text-center">No renewal history found.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    </div>
    {policy && (
        <ProjectRenewalDialog 
            isOpen={isRenewOpen}
            onOpenChange={setIsRenewOpen}
            policy={policy}
            onSuccess={fetchPolicyData}
        />
    )}
    </>
  );
}
