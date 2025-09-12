
'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, runTransaction, getDoc } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Department, Project, SerialNumberConfig } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { format } from 'date-fns';

const initialExpenseState = {
    departmentId: '',
    projectId: '',
    headOfAccount: '',
    subHeadOfAccount: '',
    remarks: '',
    description: '',
    partyName: '',
};

function NewExpenseRequestForm() {
  const { toast } = useToast();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const departmentIdFromUrl = searchParams.get('departmentId');

  const [expense, setExpense] = useState(() => ({
    ...initialExpenseState,
    departmentId: departmentIdFromUrl || '',
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [previewRequestNo, setPreviewRequestNo] = useState('Generating...');
  const [timestamp, setTimestamp] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [deptsSnap, projectsSnap] = await Promise.all([
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'projects')),
        ]);
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      } catch (error) {
        toast({ title: 'Error', description: 'Failed to load departments or projects.', variant: 'destructive' });
      }
    };
    fetchData();
  }, [toast]);
  
  useEffect(() => {
    // If departmentIdFromUrl changes, update the state
    setExpense(prev => ({ ...prev, departmentId: departmentIdFromUrl || prev.departmentId || '' }));
  }, [departmentIdFromUrl]);

  useEffect(() => {
    const generatePreviewId = async () => {
        if (!expense.departmentId) {
            setPreviewRequestNo('Select a department first');
            return;
        }
        try {
            const configRef = doc(db, 'departmentSerialConfigs', expense.departmentId);
            const configDoc = await getDoc(configRef);
            if (configDoc.exists()) {
                const configData = configDoc.data() as SerialNumberConfig;
                const newIndex = configData.startingIndex;
                const requestNo = `${configData.prefix || ''}${configData.format || ''}${newIndex}${configData.suffix || ''}`;
                setPreviewRequestNo(requestNo);
            } else {
                setPreviewRequestNo('Config not found');
            }
        } catch (error) {
            setPreviewRequestNo('Error generating ID');
        }
    };

    generatePreviewId();
    setTimestamp(format(new Date(), 'PPpp'));
  }, [expense.departmentId]);


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setExpense(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setExpense(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (!expense.departmentId || !expense.projectId) {
        toast({
            title: 'Missing Required Fields',
            description: 'Please select a department and project.',
            variant: 'destructive',
        });
        return;
    }
    setIsSaving(true);
    
    try {
        const selectedDept = departments.find(d => d.id === expense.departmentId);
        if (!selectedDept) throw new Error("Selected department not found.");

        const configRef = doc(db, 'departmentSerialConfigs', expense.departmentId);

        const newRequestNo = await runTransaction(db, async (transaction) => {
            const configDoc = await transaction.get(configRef);
            if (!configDoc.exists()) throw new Error(`Serial number configuration for ${selectedDept.name} not found!`);

            const configData = configDoc.data() as SerialNumberConfig;
            const newIndex = configData.startingIndex;
            const requestNo = `${configData.prefix || ''}${configData.format || ''}${newIndex}${configData.suffix || ''}`;
            
            transaction.update(configRef, { startingIndex: newIndex + 1 });
            return requestNo;
        });

        const newExpenseRequest = {
            ...expense,
            requestNo: newRequestNo,
            generatedByDepartment: selectedDept.name,
            generatedByUser: user?.name || 'Unknown',
            generatedByUserId: user?.id || 'Unknown',
            receptionNo: '', // Initialize as empty
            receptionDate: '', // Initialize as empty
            createdAt: new Date().toISOString(),
        };

        await addDoc(collection(db, 'expenseRequests'), newExpenseRequest);
        toast({
            title: 'Request Created',
            description: `Expense request ${newRequestNo} has been successfully created.`,
        });
        setExpense(initialExpenseState); // Reset form
    } catch (error: any) {
        console.error("Error creating expense request: ", error);
        toast({
            title: 'Save Failed',
            description: error.message || 'An error occurred while saving the request.',
            variant: 'destructive',
        });
    } finally {
        setIsSaving(false);
    }
  };

  const selectedDepartmentName = departments.find(d => d.id === expense.departmentId)?.name || '';

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/expenses">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">New Expense Request</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Request
        </Button>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Expense Details</CardTitle>
            <CardDescription>Fill in the details for the new expense request.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="requestNo">Request No</Label>
                    <Input id="requestNo" value={previewRequestNo} readOnly />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="timestamp">Timestamp</Label>
                    <Input id="timestamp" value={timestamp} readOnly />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="departmentName">Generated by Department</Label>
                    <Input id="departmentName" value={selectedDepartmentName} readOnly />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="projectId">Project Name</Label>
                     <Select name="projectId" onValueChange={(value) => handleSelectChange('projectId', value)} value={expense.projectId}>
                        <SelectTrigger><SelectValue placeholder="Select Project" /></SelectTrigger>
                        <SelectContent>
                            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="partyName">Name of the party</Label>
                    <Input id="partyName" name="partyName" value={expense.partyName} onChange={handleInputChange} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="headOfAccount">Head of A/c</Label>
                    <Input id="headOfAccount" name="headOfAccount" value={expense.headOfAccount} onChange={handleInputChange} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="subHeadOfAccount">Sub-Head of A/c</Label>
                    <Input id="subHeadOfAccount" name="subHeadOfAccount" value={expense.subHeadOfAccount} onChange={handleInputChange} />
                </div>
                 <div className="space-y-2 col-span-1 md:col-span-2 lg:col-span-3">
                    <Label htmlFor="description">Description</Label>
                    <Textarea id="description" name="description" value={expense.description} onChange={handleInputChange} />
                </div>
                 <div className="space-y-2 col-span-1 md:col-span-2 lg:col-span-3">
                    <Label htmlFor="remarks">Remarks</Label>
                    <Textarea id="remarks" name="remarks" value={expense.remarks} onChange={handleInputChange} />
                </div>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewExpenseRequestPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <NewExpenseRequestForm />
        </Suspense>
    )
}
