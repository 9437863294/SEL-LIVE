

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit, Save, Loader2, Paperclip, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, Timestamp, collection, getDocs, query, where } from 'firebase/firestore';
import type { ProjectInsurancePolicy, Project, InsuranceCompany, PolicyCategory } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ProjectPolicyDetailsPage() {
  const { policyId } = useParams() as { policyId: string };
  const { toast } = useToast();
  const router = useRouter();
  const { can } = useAuthorization();
  
  const [policy, setPolicy] = useState<ProjectInsurancePolicy | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [insuranceCompanies, setInsuranceCompanies] = useState<InsuranceCompany[]>([]);
  const [policyCategories, setPolicyCategories] = useState<PolicyCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedPolicy, setEditedPolicy] = useState<Partial<ProjectInsurancePolicy>>({});
  const [isSaving, setIsSaving] = useState(false);

  const canEdit = can('Edit', 'Insurance.Project Insurance');

  useEffect(() => {
    if (!policyId) return;

    const fetchPolicyData = async () => {
      setIsLoading(true);
      try {
        const [policyDocSnap, projectsSnapshot, companiesSnapshot, categoriesSnapshot] = await Promise.all([
          getDoc(doc(db, 'project_insurance_policies', policyId)),
          getDocs(collection(db, 'projects')),
          getDocs(query(collection(db, 'insuranceCompanies'), where('status', '==', 'Active'))),
          getDocs(query(collection(db, 'policyCategories'), where('status', '==', 'Active')))
        ]);

        if (policyDocSnap.exists()) {
          const policyData = { id: policyDocSnap.id, ...policyDocSnap.data() } as ProjectInsurancePolicy;
          setPolicy(policyData);
          setEditedPolicy({
            ...policyData,
            due_date: policyData.due_date ? policyData.due_date.toDate() : null,
          });
        } else {
          toast({ title: "Error", description: "Policy not found.", variant: "destructive" });
          router.push('/insurance/project');
        }
        
        setProjects(projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setInsuranceCompanies(companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceCompany)));
        setPolicyCategories(categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyCategory)));

      } catch (error) {
        console.error("Error fetching policy data:", error);
        toast({ title: "Error", description: "Failed to fetch policy details.", variant: "destructive" });
      }
      setIsLoading(false);
    };

    fetchPolicyData();
  }, [policyId, toast, router]);
  
  const handleInputChange = (field: keyof ProjectInsurancePolicy, value: string | number) => {
    setEditedPolicy(prev => ({ ...prev, [field]: value }));
  };

  const handleDateChange = (field: keyof ProjectInsurancePolicy, value: Date | undefined) => {
    setEditedPolicy(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveChanges = async () => {
    if (!editedPolicy || !policyId) return;
    setIsSaving(true);
    try {
        const dataToSave = {
            ...editedPolicy,
            due_date: editedPolicy.due_date ? Timestamp.fromDate(new Date(editedPolicy.due_date)) : null,
        };
        const policyRef = doc(db, 'project_insurance_policies', policyId);
        await updateDoc(policyRef, dataToSave);
        toast({ title: 'Success', description: 'Policy updated successfully.' });
        setIsEditing(false);
        // Refetch data to show updated values
        const updatedDocSnap = await getDoc(policyRef);
        if(updatedDocSnap.exists()) {
          const updatedData = { id: updatedDocSnap.id, ...updatedDocSnap.data() } as ProjectInsurancePolicy;
          setPolicy(updatedData);
          setEditedPolicy({
            ...updatedData,
            due_date: updatedData.due_date ? updatedData.due_date.toDate() : null,
          });
        }
    } catch(e) {
        console.error("Error updating policy: ", e);
        toast({ title: 'Error', description: 'Failed to update policy.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date instanceof Timestamp ? date.toDate() : new Date(date);
    return format(d, 'dd MMM, yyyy');
  };

  if (isLoading) {
    return (
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-64 mb-6" />
            <Skeleton className="h-48 mb-6" />
        </div>
    )
  }

  if (!policy) return null;

  const projectName = projects.find(p => p.id === policy.projectId)?.projectName || 'N/A';

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/insurance/project"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
              <div>
                <h1 className="text-xl font-bold">Project Insurance Details</h1>
                <p className="text-muted-foreground">{policy.policy_no}</p>
              </div>
            </div>
            {canEdit && (
                isEditing ? (
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                        <Button onClick={handleSaveChanges} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save
                        </Button>
                    </div>
                ) : (
                    <Button variant="outline" onClick={() => setIsEditing(true)}>
                        <Edit className="mr-2 h-4 w-4" /> Edit Policy
                    </Button>
                )
            )}
        </div>
        
        <Card className="mb-6">
            <CardHeader>
                <CardTitle>Policy Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>Project Name/Site</Label>
                  {isEditing ? (
                     <Select value={editedPolicy.projectId} onValueChange={(v) => handleInputChange('projectId', v)}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                        </SelectContent>
                     </Select>
                  ) : <p className="font-semibold">{projectName}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Policy No.</Label>
                  {isEditing ? <Input value={editedPolicy.policy_no} onChange={e => handleInputChange('policy_no', e.target.value)} /> : <p className="font-semibold">{policy.policy_no}</p>}
                </div>
                 <div className="space-y-2">
                  <Label>Insurance Company</Label>
                  {isEditing ? (
                     <Select value={editedPolicy.insurance_company} onValueChange={(v) => handleInputChange('insurance_company', v)}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                            {insuranceCompanies.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                        </SelectContent>
                     </Select>
                  ) : <p className="font-semibold">{policy.insurance_company}</p>}
                </div>
                 <div className="space-y-2">
                  <Label>Policy Category</Label>
                   {isEditing ? (
                     <Select value={editedPolicy.policy_category} onValueChange={(v) => handleInputChange('policy_category', v)}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                            {policyCategories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                        </SelectContent>
                     </Select>
                  ) : <p className="font-semibold">{policy.policy_category}</p>}
                </div>
                 <div className="space-y-2">
                  <Label>Premium</Label>
                  {isEditing ? <Input type="number" value={editedPolicy.premium} onChange={e => handleInputChange('premium', e.target.valueAsNumber)} /> : <p className="font-semibold">{formatCurrency(policy.premium)}</p>}
                </div>
                 <div className="space-y-2">
                  <Label>Due Date</Label>
                   {isEditing ? (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !editedPolicy.due_date && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {editedPolicy.due_date ? format(new Date(editedPolicy.due_date), "PPP") : <span>Pick a date</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={editedPolicy.due_date ? new Date(editedPolicy.due_date) : undefined} onSelect={(date) => handleDateChange('due_date', date)} /></PopoverContent>
                        </Popover>
                   ) : <p className="font-semibold">{formatDate(policy.due_date)}</p>}
                </div>
                 <div className="space-y-2">
                  <Label>Sum Insured</Label>
                  {isEditing ? <Input type="number" value={editedPolicy.sum_insured} onChange={e => handleInputChange('sum_insured', e.target.valueAsNumber)} /> : <p className="font-semibold">{formatCurrency(policy.sum_insured)}</p>}
                </div>
            </CardContent>
        </Card>
    </div>
  );
}
