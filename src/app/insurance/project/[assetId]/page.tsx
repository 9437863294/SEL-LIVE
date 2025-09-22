
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit, Plus, RotateCw, History, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, orderBy } from 'firebase/firestore';
import type { ProjectInsurancePolicy, InsuredAsset, Project, ProjectPolicyRenewal } from '@/lib/types';
import { format, isBefore, subDays } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface PolicyWithHistory extends ProjectInsurancePolicy {
  history: ProjectPolicyRenewal[];
}

export default function AssetPoliciesPage() {
  const { assetId } = useParams() as { assetId: string };
  const router = useRouter();
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [asset, setAsset] = useState<InsuredAsset | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [policies, setPolicies] = useState<PolicyWithHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canViewPage = can('View', 'Insurance.Project Insurance');
  const canAddPolicy = can('Add', 'Insurance.Project Insurance');
  const canEditPolicy = can('Edit', 'Insurance.Project Insurance');

  const fetchAssetData = async () => {
    if (!assetId) return;
    setIsLoading(true);
    try {
      const assetDocRef = doc(db, 'insuredAssets', assetId);
      const assetDocSnap = await getDoc(assetDocRef);
      if (!assetDocSnap.exists()) {
        toast({ title: "Error", description: "Asset not found.", variant: "destructive" });
        return;
      }
      const assetData = { id: assetDocSnap.id, ...assetDocSnap.data() } as InsuredAsset;
      setAsset(assetData);

      if (assetData.type === 'Project' && assetData.projectId) {
        const projectDocRef = doc(db, 'projects', assetData.projectId);
        const projectDocSnap = await getDoc(projectDocRef);
        if (projectDocSnap.exists()) {
          setProject(projectDocSnap.data() as Project);
        }
      }

      const policiesQuery = query(collection(db, 'project_insurance_policies'), where('assetId', '==', assetId));
      const policiesSnapshot = await getDocs(policiesQuery);
      const policiesData = policiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectInsurancePolicy));
      
      const policiesWithHistory: PolicyWithHistory[] = await Promise.all(
        policiesData.map(async (policy) => {
          const historyQuery = query(collection(db, 'project_insurance_policies', policy.id, 'history'), orderBy('renewalDate', 'desc'));
          const historySnapshot = await getDocs(historyQuery);
          const history = historySnapshot.docs.map(doc => doc.data() as ProjectPolicyRenewal);
          return { ...policy, history };
        })
      );
      
      setPolicies(policiesWithHistory);

    } catch (error) {
      console.error("Error fetching asset policies:", error);
      toast({ title: 'Error', description: 'Failed to fetch asset policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthLoading) return;
    if (canViewPage) {
      fetchAssetData();
    } else {
      setIsLoading(false);
    }
  }, [assetId, isAuthLoading, canViewPage]);

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return format(d, 'dd MMM, yyyy');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-96 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
    );
  }
  
  if (!canViewPage) {
      return (
          <div className="w-full">
              <CardHeader>
                  <CardTitle>Access Denied</CardTitle>
                  <CardDescription>You do not have permission to view project insurance policies.</CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
          </div>
      );
  }

  const assetName = asset?.type === 'Project' && project ? project.projectName : asset?.name;

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Insurance Policies for {assetName}</h1>
          <p className="text-sm text-muted-foreground">
            {asset?.type}: {asset?.type === 'Project' && project ? project.location : asset?.location}
          </p>
        </div>
        <div className="flex items-center gap-2">
            <Link href="/insurance/project">
              <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />Back to Assets</Button>
            </Link>
            <Link href={`/insurance/project/new?assetId=${assetId}`}>
                <Button disabled={!canAddPolicy}><Plus className="mr-2 h-4 w-4" /> Add New Policy</Button>
            </Link>
        </div>
      </div>
      
      <Accordion type="single" collapsible className="w-full space-y-4">
        {policies.length > 0 ? policies.map(policy => (
            <AccordionItem value={policy.id} key={policy.id} className="border rounded-lg bg-card">
              <AccordionTrigger className="p-4 hover:no-underline text-left">
                <div className="flex flex-1 items-center justify-between pr-4 w-full">
                    <div className="flex-1 space-y-1">
                        <p className="font-semibold">{policy.policy_category}</p>
                        <p className="text-sm text-muted-foreground">{policy.policy_no} - {policy.insurance_company}</p>
                    </div>
                    <div className="flex-1 text-center">
                        <Badge variant={policy.status === 'Renewable' ? 'default' : 'secondary'}>{policy.status}</Badge>
                    </div>
                    <div className="flex-1 text-center">
                        <p className="text-sm text-muted-foreground">Insured Until</p>
                        <p className="font-medium">{formatDate(policy.insured_until)}</p>
                    </div>
                    <div className="flex-1 text-right">
                         <p className="text-sm text-muted-foreground">Premium</p>
                         <p className="font-medium">{formatCurrency(policy.premium)}</p>
                    </div>
                     <div className="ml-4">
                        <Link href={`/insurance/project/policy/${policy.id}`} onClick={(e) => e.stopPropagation()}>
                            <Button variant="outline" size="sm" disabled={!canEditPolicy}>
                               <Edit className="mr-2 h-4 w-4"/> View/Edit
                            </Button>
                        </Link>
                    </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="p-4 border-t">
                    <h4 className="font-semibold mb-2 text-sm text-muted-foreground">Renewal History</h4>
                    {policy.history && policy.history.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Renewed On</TableHead>
                                    <TableHead>Policy No.</TableHead>
                                    <TableHead>Start Date</TableHead>
                                    <TableHead>End Date</TableHead>
                                    <TableHead>Premium</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {policy.history.map((h, i) => (
                                    <TableRow key={i}>
                                        <TableCell>{formatDate(h.renewalDate)}</TableCell>
                                        <TableCell>{h.policyNo}</TableCell>
                                        <TableCell>{formatDate(h.startDate)}</TableCell>
                                        <TableCell>{formatDate(h.endDate)}</TableCell>
                                        <TableCell>{formatCurrency(h.premium)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <p className="text-sm text-center text-muted-foreground py-4">No renewal history for this policy.</p>
                    )}
                </div>
              </AccordionContent>
            </AccordionItem>
        )) : (
            <Card>
                <CardContent className="h-48 flex flex-col items-center justify-center">
                    <p className="text-muted-foreground">No insurance policies found for this asset.</p>
                    <Link href={`/insurance/project/new?assetId=${assetId}`}>
                        <Button variant="link" disabled={!canAddPolicy}>Add the first one</Button>
                    </Link>
                </CardContent>
            </Card>
        )}
      </Accordion>
    </div>
  );
}
