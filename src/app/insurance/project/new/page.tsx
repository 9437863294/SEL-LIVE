
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
import { format, addYears, addMonths } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, Timestamp, getDocs, query, where } from 'firebase/firestore';
import type { InsuredAsset, InsuranceCompany, PolicyCategory, ProjectInsurancePolicy } from '@/lib/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const policySchema = z.object({
  assetId: z.string().min(1, 'Project/Property is required'),
  policy_no: z.string().min(1, 'Policy number is required'),
  insurance_company: z.string().min(1, 'Insurance company is required'),
  policy_category: z.string().min(1, 'Policy category is required'),
  premium: z.coerce.number().min(0, 'Premium must be a positive number'),
  sum_insured: z.coerce.number().min(0, 'Sum insured must be a positive number'),
  insurance_start_date: z.date({ required_error: "A start date is required." }),
  tenure_years: z.coerce.number().min(0).default(0),
  tenure_months: z.coerce.number().min(0).max(11).default(0),
  insured_until: z.date().optional(),
  status: z.enum(['Active', 'Close', 'Not Required', 'Expired']).default('Active'),
});

type PolicyFormValues = z.infer<typeof policySchema>;

export default function NewProjectPolicyPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [assets, setAssets] = useState<InsuredAsset[]>([]);
  const [insuranceCompanies, setInsuranceCompanies] = useState<InsuranceCompany[]>([]);
  const [policyCategories, setPolicyCategories] = useState<PolicyCategory[]>([]);


  useEffect(() => {
    const fetchData = async () => {
        try {
          const [assetsSnapshot, companiesSnapshot, categoriesSnapshot] = await Promise.all([
            getDocs(query(collection(db, 'insuredAssets'), where('status', '==', 'Active'))),
            getDocs(query(collection(db, 'insuranceCompanies'), where('status', '==', 'Active'))),
            getDocs(query(collection(db, 'policyCategories'), where('status', '==', 'Active')))
          ]);

          setAssets(assetsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuredAsset)));
          setInsuranceCompanies(companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceCompany)));
          setPolicyCategories(categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyCategory)));

        } catch (error) {
          console.error("Error fetching data:", error);
        }
    };
    fetchData();
  }, []);

  const form = useForm<PolicyFormValues>({
    resolver: zodResolver(policySchema),
    defaultValues: {
      assetId: '',
      policy_no: '',
      insurance_company: '',
      policy_category: '',
      premium: 0,
      sum_insured: 0,
      tenure_years: 0,
      tenure_months: 0,
      status: 'Active',
    },
  });

  const { watch, setValue } = form;
  const watchStartDate = watch('insurance_start_date');
  const watchTenureYears = watch('tenure_years');
  const watchTenureMonths = watch('tenure_months');

  useEffect(() => {
    if (watchStartDate && (watchTenureYears > 0 || watchTenureMonths > 0)) {
        let endDate = addYears(watchStartDate, watchTenureYears);
        endDate = addMonths(endDate, watchTenureMonths);
        setValue('insured_until', endDate);
    } else {
        setValue('insured_until', undefined);
    }
  }, [watchStartDate, watchTenureYears, watchTenureMonths, setValue]);


  const onSubmit = async (data: PolicyFormValues) => {
    setIsSaving(true);
    const selectedAsset = assets.find(a => a.id === data.assetId);
    if (!selectedAsset) {
        toast({ title: 'Error', description: 'Selected asset not found.', variant: 'destructive' });
        setIsSaving(false);
        return;
    }
    
    try {
      const policyData: Omit<ProjectInsurancePolicy, 'id'> = {
        ...data,
        assetName: selectedAsset.name,
        assetType: selectedAsset.type,
        insurance_start_date: data.insurance_start_date ? Timestamp.fromDate(data.insurance_start_date) : null,
        insured_until: data.insured_until ? Timestamp.fromDate(data.insured_until) : null,
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
  
  const ReadOnlyDatePickerField = ({ name, label }: { name: keyof PolicyFormValues, label: string }) => (
     <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem className="flex flex-col">
          <FormLabel>{label}</FormLabel>
            <FormControl>
              <Button variant="outline" className={cn('pl-3 text-left font-normal text-muted-foreground cursor-not-allowed')} disabled>
                {field.value ? format(field.value, 'dd MMM, yyyy') : <span>-</span>}
                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
              </Button>
            </FormControl>
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
                        <FormField control={form.control} name="assetId" render={({ field }) => (<FormItem><FormLabel>Project Name/Site</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select Project or Property" /></SelectTrigger></FormControl><SelectContent>{assets.map((asset) => (<SelectItem key={asset.id} value={asset.id}>{asset.name}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="policy_no" render={({ field }) => (<FormItem><FormLabel>Policy No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="insurance_company" render={({ field }) => (<FormItem><FormLabel>Insurance Company</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a company" /></SelectTrigger></FormControl><SelectContent>{insuranceCompanies.map((company) => (<SelectItem key={company.id} value={company.name}>{company.name}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="policy_category" render={({ field }) => (<FormItem><FormLabel>Policy Category</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger></FormControl><SelectContent>{policyCategories.map((category) => (<SelectItem key={category.id} value={category.name}>{category.name}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="premium" render={({ field }) => (<FormItem><FormLabel>Premium</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="sum_insured" render={({ field }) => (<FormItem><FormLabel>Sum Insured</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="status" render={({ field }) => (<FormItem><FormLabel>Status</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Close">Close</SelectItem><SelectItem value="Not Required">Not Required</SelectItem><SelectItem value="Expired">Expired</SelectItem></SelectContent></Select><FormMessage /></FormItem>)} />
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader><CardTitle>Policy Period</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                         <DatePickerField name="insurance_start_date" label="Insurance Start Date" />
                         <div className="flex items-end gap-2">
                            <FormField 
                                control={form.control} 
                                name="tenure_years" 
                                render={({ field }) => (
                                    <FormItem className="flex-1 space-y-2">
                                        <FormLabel>Years</FormLabel>
                                        <FormControl><Input type="number" placeholder="Years" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} 
                            />
                            <FormField 
                                control={form.control} 
                                name="tenure_months" 
                                render={({ field }) => (
                                    <FormItem className="flex-1 space-y-2">
                                        <FormLabel>Months</FormLabel>
                                        <FormControl><Input type="number" placeholder="Months" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} 
                            />
                         </div>
                        <ReadOnlyDatePickerField name="insured_until" label="Insured Until" />
                    </CardContent>
                 </Card>
            </form>
        </Form>
    </div>
  );
}
