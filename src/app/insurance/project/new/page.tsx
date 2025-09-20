

'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Loader2, Save, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, Timestamp, getDocs, query, where } from 'firebase/firestore';
import type { Project, InsuranceCompany } from '@/lib/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const policySchema = z.object({
  projectId: z.string().min(1, 'Project is required'),
  policy_no: z.string().min(1, 'Policy number is required'),
  insurance_company: z.string().min(1, 'Insurance company is required'),
  policy_category: z.string().min(1, 'Policy category is required'),
  premium: z.coerce.number().min(0, 'Premium must be a positive number'),
  sum_insured: z.coerce.number().min(0, 'Sum insured must be a positive number'),
  due_date: z.date({ required_error: "A due date is required." }),
});

type PolicyFormValues = z.infer<typeof policySchema>;

export default function NewProjectPolicyPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [insuranceCompanies, setInsuranceCompanies] = useState<InsuranceCompany[]>([]);

  useEffect(() => {
    const fetchData = async () => {
        try {
          const projectsSnapshot = await getDocs(collection(db, 'projects'));
          const projectsData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
          setProjects(projectsData);

          const companiesQuery = query(collection(db, 'insuranceCompanies'), where('status', '==', 'Active'));
          const companiesSnapshot = await getDocs(companiesQuery);
          const companiesData = companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceCompany));
          setInsuranceCompanies(companiesData);

        } catch (error) {
          console.error("Error fetching data:", error);
        }
    };
    fetchData();
  }, []);

  const form = useForm<PolicyFormValues>({
    resolver: zodResolver(policySchema),
    defaultValues: {
      projectId: '',
      policy_no: '',
      insurance_company: '',
      policy_category: '',
      premium: 0,
      sum_insured: 0,
    },
  });

  const onSubmit = async (data: PolicyFormValues) => {
    setIsSaving(true);
    try {
      const policyData: any = {
        ...data,
        due_date: data.due_date ? Timestamp.fromDate(data.due_date) : null,
      };

      await addDoc(collection(db, 'project_insurance_policies'), policyData);
      toast({ title: 'Success', description: 'New project insurance policy has been added.' });
      router.push('/insurance/project');
    } catch (error) {
      console.error('Error adding policy: ', error);
      toast({ title: 'Error', description: 'Failed to add policy.', variant: 'destructive' });
    }
    setIsSaving(false);
  };

  const DatePickerField = ({ name, label }: { name: keyof PolicyFormValues, label: string }) => (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem className="flex flex-col">
          <FormLabel>{label}</FormLabel>
          <Popover>
            <PopoverTrigger asChild>
              <FormControl>
                <Button variant="outline" className={cn('pl-3 text-left font-normal', !field.value && 'text-muted-foreground')}>
                  {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={field.value} onSelect={field.onChange} captionLayout="dropdown-buttons" fromYear={1900} toYear={new Date().getFullYear() + 50} />
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div className="w-full">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/insurance/project">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Add New Project Insurance Policy</h1>
            </div>
          </div>
          <Button onClick={form.handleSubmit(onSubmit)} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Policy
          </Button>
        </div>
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <Card>
                    <CardHeader><CardTitle>Policy Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <FormField
                            control={form.control}
                            name="projectId"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Project Name/Site</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a project" />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                    {projects.map((project) => (
                                        <SelectItem key={project.id} value={project.id}>
                                        {project.projectName}
                                        </SelectItem>
                                    ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField control={form.control} name="policy_no" render={({ field }) => (<FormItem><FormLabel>Policy No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField
                            control={form.control}
                            name="insurance_company"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Insurance Company</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a company" />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                    {insuranceCompanies.map((company) => (
                                        <SelectItem key={company.id} value={company.name}>
                                        {company.name}
                                        </SelectItem>
                                    ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField control={form.control} name="policy_category" render={({ field }) => (<FormItem><FormLabel>Policy Category</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="premium" render={({ field }) => (<FormItem><FormLabel>Premium</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <DatePickerField name="due_date" label="Due Date"/>
                        <FormField control={form.control} name="sum_insured" render={({ field }) => (<FormItem><FormLabel>Sum Insured</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    </CardContent>
                </Card>
            </form>
        </Form>
    </div>
  );
}
