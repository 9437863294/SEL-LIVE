
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
import type { ProjectInsurancePolicy, Project } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export default function ProjectInsurancePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  
  const [policies, setPolicies] = useState<ProjectInsurancePolicy[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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
              due_date: data.due_date ? data.due_date.toDate() : null,
          } as ProjectInsurancePolicy
      });
      setPolicies(policiesData);

      const projectsSnapshot = await getDocs(collection(db, 'projects'));
      setProjects(projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));

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

  const getProjectName = (projectId: string) => {
      return projects.find(p => p.id === projectId)?.projectName || 'Unknown Project';
  }
  
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
                  <TableHead>Due Date</TableHead>
                  <TableHead>Sum Insured</TableHead>
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
                    <TableCell className="font-medium">{getProjectName(policy.projectId)}</TableCell>
                    <TableCell>{policy.policy_no}</TableCell>
                    <TableCell>{policy.insurance_company}</TableCell>
                    <TableCell>{policy.policy_category}</TableCell>
                    <TableCell>{formatCurrency(policy.premium)}</TableCell>
                    <TableCell>{formatDate(policy.due_date)}</TableCell>
                    <TableCell>{formatCurrency(policy.sum_insured)}</TableCell>
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            <Card>
                <CardHeader>
                    <CardTitle>Property Insurance</CardTitle>
                </CardHeader>
                <CardContent>
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="item-1">
                            <AccordionTrigger>How it Works</AccordionTrigger>
                            <AccordionContent className="space-y-4">
                                <div>
                                    <h4 className="font-semibold">Proposal & Issuance</h4>
                                    <p className="text-sm text-muted-foreground">You submit details of property (location, type, value, usage). Insurance company issues a policy with coverage, exclusions, premium, and validity (usually 1 year).</p>
                                </div>
                                <div>
                                    <h4 className="font-semibold">Coverage Period</h4>
                                    <p className="text-sm text-muted-foreground">The property is protected against insured risks during the policy term. Any damage/loss should be reported immediately.</p>
                                </div>
                                <div>
                                    <h4 className="font-semibold">Claim Process</h4>
                                    <p className="text-sm text-muted-foreground">Report damage → Surveyor inspection → Loss assessment → Claim settlement (repair cost or replacement value, depending on policy).</p>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="item-2">
                            <AccordionTrigger>Key Points on Renewal</AccordionTrigger>
                            <AccordionContent>
                                <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-2">
                                    <li>Both Property and WC policies are typically yearly.</li>
                                    <li>Timely renewal is critical—a lapse means no coverage.</li>
                                    <li>Premium may change based on claims history or updated property value.</li>
                                    <li>Most insurers offer a grace period (7–30 days), but coverage may not be active until renewal is complete.</li>
                                </ul>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Workmen’s Compensation (WC) Insurance</CardTitle>
                </CardHeader>
                <CardContent>
                     <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="item-1">
                            <AccordionTrigger>How it Works</AccordionTrigger>
                            <AccordionContent className="space-y-4">
                                <div>
                                    <h4 className="font-semibold">Proposal & Issuance</h4>
                                    <p className="text-sm text-muted-foreground">Employer provides details like number of employees, nature of work, wages, and risk category. Insurer issues policy covering employer’s liability under the WC Act.</p>
                                </div>
                                <div>
                                    <h4 className="font-semibold">Coverage Period</h4>
                                    <p className="text-sm text-muted-foreground">Policy is valid usually for 1 year and covers all accidents/injuries occurring during work in this period.</p>
                                </div>
                                 <div>
                                    <h4 className="font-semibold">Claim Process</h4>
                                    <p className="text-sm text-muted-foreground">If an employee gets injured/dies → employer informs insurer. Insurer verifies details, medical reports, wages, liability under WC Act. Compensation is paid to employee or nominee.</p>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                         <AccordionItem value="item-2">
                            <AccordionTrigger>Key Points on Renewal</AccordionTrigger>
                            <AccordionContent>
                                <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-2">
                                    <li>Annual renewal is standard.</li>
                                    <li>Premium depends on employee strength, payroll, and risk classification.</li>
                                    <li>You must update employee data at each renewal (new joiners, wage changes, etc.).</li>
                                </ul>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
            </Card>
        </div>

      </div>
    </>
  );
}
