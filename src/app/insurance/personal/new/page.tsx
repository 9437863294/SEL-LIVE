
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Loader2, Save, X, File as FileIcon, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, addMonths, addYears, addQuarters } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, Timestamp, getDocs, query, where } from 'firebase/firestore';
import type { PolicyHolder, Attachment, InsuranceCompany } from '@/lib/types';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const policySchema = z.object({
  insured_person: z.string().min(1, 'Insured person is required'),
  policy_no: z.string().min(1, 'Policy number is required'),
  insurance_company: z.string().min(1, 'Insurance company is required'),
  policy_category: z.string().min(1, 'Policy name is required'),
  policy_name: z.string().min(1, 'Policy name is required'),
  premium: z.coerce.number().min(0, 'Premium must be a positive number'),
  sum_insured: z.coerce.number().min(0, 'Sum insured must be a positive number'),
  date_of_comm: z.date().optional(),
  policy_issue_date: z.date().optional(),
  date_of_maturity: z.date().optional(),
  last_premium_date: z.date().optional(),
  payment_type: z.enum(['Monthly', 'Quarterly', 'Yearly', 'One-Time']),
  auto_debit: z.boolean().default(false),
  attachments: z.custom<File[]>().optional(),
  tenure: z.coerce.number().min(0, "Tenure must be a non-negative number."),
  due_date: z.date().optional(),
});

type PolicyFormValues = z.infer<typeof policySchema>;

export default function NewPolicyPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [policyHolders, setPolicyHolders] = useState<PolicyHolder[]>([]);
  const [insuranceCompanies, setInsuranceCompanies] = useState<InsuranceCompany[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);


  useEffect(() => {
    const fetchData = async () => {
        try {
          const holdersSnapshot = await getDocs(collection(db, 'policyHolders'));
          const holdersData = holdersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyHolder));
          setPolicyHolders(holdersData);

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
      insured_person: '',
      policy_no: '',
      insurance_company: '',
      policy_category: '',
      policy_name: '',
      premium: 0,
      sum_insured: 0,
      payment_type: 'Yearly',
      auto_debit: false,
      tenure: 0,
    },
  });
  
  const { watch, setValue } = form;
  const watchDateOfComm = watch('date_of_comm');
  const watchPaymentType = watch('payment_type');
  const watchTenure = watch('tenure');

  useEffect(() => {
    if (watchDateOfComm && watchPaymentType && watchTenure > 0) {
      const commencementDate = new Date(watchDateOfComm);
      
      // Calculate Last Premium Date
      if (watchTenure > 1) {
        const lastPremiumYearDate = addYears(commencementDate, watchTenure - 1);
        setValue('last_premium_date', lastPremiumYearDate);
      } else {
        // If tenure is 1 year or less, last premium date is the start date
        setValue('last_premium_date', commencementDate);
      }

      let nextDueDate: Date;
      const now = new Date();
      let currentDate = new Date(watchDateOfComm);
      
      while (currentDate < now) {
          switch (watchPaymentType) {
              case 'Monthly':
                  currentDate = addMonths(currentDate, 1);
                  break;
              case 'Quarterly':
                  currentDate = addQuarters(currentDate, 1);
                  break;
              case 'Yearly':
                  currentDate = addYears(currentDate, 1);
                  break;
              case 'One-Time':
                  currentDate = new Date(watchDateOfComm);
                  break;
          }
      }
      nextDueDate = currentDate;

      const maturityDate = watch('date_of_maturity');
      if (maturityDate && nextDueDate >= maturityDate) {
        setValue('due_date', undefined); // Policy has matured
        return;
      }

      setValue('due_date', nextDueDate);
    }
  }, [watchDateOfComm, watchPaymentType, watchTenure, setValue, watch]);


  const onSubmit = async (data: PolicyFormValues) => {
    setIsSaving(true);
    try {
       const attachmentUrls: Attachment[] = [];
       if (selectedFiles.length > 0) {
         for (const file of selectedFiles) {
             const storageRef = ref(storage, `insurance-policies/${data.policy_no}/${file.name}`);
             await uploadBytes(storageRef, file);
             const downloadURL = await getDownloadURL(storageRef);
             attachmentUrls.push({ name: file.name, url: downloadURL });
         }
       }

      const policyData: any = {
        ...data,
        due_date: data.due_date ? Timestamp.fromDate(data.due_date) : null,
        date_of_comm: data.date_of_comm ? Timestamp.fromDate(data.date_of_comm) : null,
        policy_issue_date: data.policy_issue_date ? Timestamp.fromDate(data.policy_issue_date) : null,
        date_of_maturity: data.date_of_maturity ? Timestamp.fromDate(data.date_of_maturity) : null,
        last_premium_date: data.last_premium_date ? Timestamp.fromDate(data.last_premium_date) : null,
        attachments: attachmentUrls,
      };
      
      delete policyData.files; // Remove files from data to be saved in firestore

      await addDoc(collection(db, 'insurance_policies'), policyData);
      toast({ title: 'Success', description: 'New insurance policy has been added.' });
      router.push('/insurance/personal');
    } catch (error) {
      console.error('Error adding policy: ', error);
      toast({ title: 'Error', description: 'Failed to add policy.', variant: 'destructive' });
    }
    setIsSaving(false);
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        setSelectedFiles(Array.from(e.target.files));
      }
  };

  const DatePickerField = ({ name, label, readOnly = false }: { name: keyof PolicyFormValues, label: string, readOnly?: boolean }) => (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem className="flex flex-col">
          <FormLabel>{label}</FormLabel>
          <Popover>
            <PopoverTrigger asChild>
              <FormControl>
                <Button variant="outline" className={cn('pl-3 text-left font-normal', !field.value && 'text-muted-foreground')} disabled={readOnly}>
                  {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start" onPointerDownOutside={(e) => e.preventDefault()}>
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
            <Link href="/insurance/personal">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Add New Insurance Policy</h1>
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
                            name="insured_person"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Insured Person</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a policy holder" />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                    {policyHolders.map((holder) => (
                                        <SelectItem key={holder.id} value={holder.name}>
                                        {holder.name}
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
                        <FormField control={form.control} name="policy_category" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="policy_name" render={({ field }) => (<FormItem><FormLabel>Policy Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="sum_insured" render={({ field }) => (<FormItem><FormLabel>Sum Insured</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader><CardTitle>Premium & Dates</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <FormField control={form.control} name="premium" render={({ field }) => (<FormItem><FormLabel>Premium</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField
                            control={form.control}
                            name="payment_type"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Payment Type</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                        <SelectItem value="Monthly">Monthly</SelectItem>
                                        <SelectItem value="Quarterly">Quarterly</SelectItem>
                                        <SelectItem value="Yearly">Yearly</SelectItem>
                                        <SelectItem value="One-Time">One-Time</SelectItem>
                                    </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                         <FormField control={form.control} name="tenure" render={({ field }) => (<FormItem><FormLabel>Tenure (in years)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />

                        <DatePickerField name="policy_issue_date" label="Policy Issue Date"/>
                        <DatePickerField name="date_of_comm" label="Date of Commencement"/>
                        <DatePickerField name="due_date" label="Next Due Date" readOnly={true}/>
                        <DatePickerField name="date_of_maturity" label="Date of Maturity" />
                        <DatePickerField name="last_premium_date" label="Last Premium Date" readOnly={true}/>
                        <FormField control={form.control} name="auto_debit" render={({ field }) => (<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 mt-8"><FormLabel>Auto Debit</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>)}/>
                    </CardContent>
                 </Card>
                <Card>
                    <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
                    <CardContent>
                        <Label htmlFor="attachments">Upload Documents</Label>
                        <FormControl>
                            <Input id="attachments" type="file" multiple onChange={handleFileChange} />
                        </FormControl>
                        {selectedFiles.length > 0 && (
                            <div className="mt-4 space-y-2">
                                {selectedFiles.map((file, i) => (
                                    <div key={i} className="flex items-center justify-between p-2 bg-muted rounded-md">
                                        <div className="flex items-center gap-2">
                                            <FileIcon className="w-4 h-4" />
                                            <span className="text-sm">{file.name}</span>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedFiles(selectedFiles.filter((_, index) => index !== i))}>
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </form>
        </Form>
    </div>
  );
}
