
'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import type { Department, Project, SerialNumberConfig, AccountHead, SubAccountHead } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { format } from 'date-fns';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const expenseFormSchema = z.object({
  departmentId: z.string().min(1, "Department is required."),
  projectId: z.string().min(1, "Project is required."),
  amount: z.coerce.number().min(1, "Amount must be greater than 0."),
  headOfAccount: z.string().min(1, "Head of Account is required."),
  subHeadOfAccount: z.string().min(1, "Sub-Head of Account is required."),
  remarks: z.string().optional(),
  description: z.string().min(1, "Description is required."),
  partyName: z.string().min(1, "Party name is required."),
});

type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

function NewExpenseRequestForm() {
  const { toast } = useToast();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const departmentIdFromUrl = searchParams.get('departmentId');

  const [isSaving, setIsSaving] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);
  const [previewRequestNo, setPreviewRequestNo] = useState('Generating...');
  const [timestamp, setTimestamp] = useState('');

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      departmentId: departmentIdFromUrl || '',
      projectId: '',
      amount: 0,
      headOfAccount: '',
      subHeadOfAccount: '',
      remarks: '',
      description: '',
      partyName: '',
    },
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [deptsSnap, projectsSnap, headsSnap, subHeadsSnap] = await Promise.all([
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'accountHeads')),
          getDocs(collection(db, 'subAccountHeads')),
        ]);
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setAccountHeads(headsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AccountHead)));
        setSubAccountHeads(subHeadsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubAccountHead)).sort((a,b) => a.name.localeCompare(b.name)));
      } catch (error) {
        toast({ title: 'Error', description: 'Failed to load required data.', variant: 'destructive' });
      }
    };
    fetchData();
  }, [toast]);
  
  useEffect(() => {
    form.setValue('departmentId', departmentIdFromUrl || '');
  }, [departmentIdFromUrl, form]);

  useEffect(() => {
    const generatePreviewId = async () => {
        const deptId = form.getValues('departmentId');
        if (!deptId) {
            setPreviewRequestNo('Select a department first');
            return;
        }
        try {
            const configRef = doc(db, 'departmentSerialConfigs', deptId);
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
  }, [form.watch('departmentId')]);


  const handleSubHeadChange = (subHeadName: string) => {
    const selectedSubHead = subAccountHeads.find(sh => sh.name === subHeadName);
    form.setValue('subHeadOfAccount', subHeadName);
    if (selectedSubHead) {
        const parentHead = accountHeads.find(h => h.id === selectedSubHead.headId);
        form.setValue('headOfAccount', parentHead ? parentHead.name : '');
    }
  };

  const handleSave = async (data: ExpenseFormValues) => {
    setIsSaving(true);
    
    try {
        const selectedDept = departments.find(d => d.id === data.departmentId);
        if (!selectedDept) throw new Error("Selected department not found.");

        const configRef = doc(db, 'departmentSerialConfigs', data.departmentId);

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
            ...data,
            requestNo: newRequestNo,
            generatedByDepartment: selectedDept.name,
            generatedByUser: user?.name || 'Unknown',
            generatedByUserId: user?.id || 'Unknown',
            receptionNo: '', 
            receptionDate: '',
            createdAt: new Date().toISOString(),
        };

        await addDoc(collection(db, 'expenseRequests'), newExpenseRequest);
        toast({
            title: 'Request Created',
            description: `Expense request ${newRequestNo} has been successfully created.`,
        });
        form.reset();
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

  const selectedDepartmentName = departments.find(d => d.id === form.getValues('departmentId'))?.name || '';

  return (
    <div className="w-full mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/expenses">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">New Expense Request</h1>
        </div>
        <Button onClick={form.handleSubmit(handleSave)} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Request
        </Button>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSave)}>
          <Card>
            <CardHeader>
                <CardTitle>Expense Details</CardTitle>
                <CardDescription>Fill in the details for the new expense request. All fields except remarks are required.</CardDescription>
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
                    <FormField
                      control={form.control}
                      name="projectId"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel>Project Name</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select Project" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel>Amount</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} onChange={e => field.onChange(e.target.valueAsNumber)} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="partyName"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel>Name of the party</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="headOfAccount"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel>Head of A/c</FormLabel>
                           <Select value={field.value} disabled>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Will be auto-filled"/></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {accountHeads.map(h => <SelectItem key={h.id} value={h.name}>{h.name}</SelectItem>)}
                            </SelectContent>
                           </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="subHeadOfAccount"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel>Sub-Head of A/c</FormLabel>
                          <Select onValueChange={handleSubHeadChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select Sub-Head"/></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {subAccountHeads.map(sh => <SelectItem key={sh.id} value={sh.name}>{sh.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="space-y-2 hidden md:block"></div>
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem className="space-y-2 col-span-1 md:col-span-2 lg:col-span-3">
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="remarks"
                      render={({ field }) => (
                        <FormItem className="space-y-2 col-span-1 md:col-span-2 lg:col-span-3">
                          <FormLabel>Remarks</FormLabel>
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                </div>
            </CardContent>
          </Card>
        </form>
      </Form>
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

    