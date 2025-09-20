
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
import { Calendar as CalendarIcon, Loader2, Save, ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, Timestamp, getDocs } from 'firebase/firestore';
import type { PolicyHolder } from '@/lib/types';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from './ui/command';

const policySchema = z.object({
  insured_person: z.string().min(1, 'Insured person is required'),
  policy_no: z.string().min(1, 'Policy number is required'),
  insurance_company: z.string().min(1, 'Insurance company is required'),
  policy_category: z.string().min(1, 'Policy category is required'),
  policy_name: z.string().min(1, 'Policy name is required'),
  premium: z.coerce.number().min(0, 'Premium must be a positive number'),
  due_date: z.date().optional(),
  sum_insured: z.coerce.number().min(0, 'Sum insured must be a positive number'),
  date_of_comm: z.date().optional(),
  date_of_maturity: z.date().optional(),
  last_premium_date: z.date().optional(),
  payment_type: z.enum(['Monthly', 'Quarterly', 'Yearly', 'One-Time']),
  auto_debit: z.boolean().default(false),
});

type PolicyFormValues = z.infer<typeof policySchema>;

interface AddPolicyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onPolicyAdded: () => void;
}

export function AddPolicyDialog({ isOpen, onOpenChange, onPolicyAdded }: AddPolicyDialogProps) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [policyHolders, setPolicyHolders] = useState<PolicyHolder[]>([]);
  const [isHolderPopoverOpen, setIsHolderPopoverOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const fetchPolicyHolders = async () => {
        try {
          const querySnapshot = await getDocs(collection(db, 'policyHolders'));
          const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyHolder));
          setPolicyHolders(data);
        } catch (error) {
          console.error("Error fetching policy holders:", error);
        }
      };
      fetchPolicyHolders();
    }
  }, [isOpen]);

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
    },
  });

  const onSubmit = async (data: PolicyFormValues) => {
    setIsSaving(true);
    try {
      const policyData: any = {
        ...data,
        due_date: data.due_date ? Timestamp.fromDate(data.due_date) : null,
        date_of_comm: data.date_of_comm ? Timestamp.fromDate(data.date_of_comm) : null,
        date_of_maturity: data.date_of_maturity ? Timestamp.fromDate(data.date_of_maturity) : null,
        last_premium_date: data.last_premium_date ? Timestamp.fromDate(data.last_premium_date) : null,
      };
      await addDoc(collection(db, 'insurance_policies'), policyData);
      toast({ title: 'Success', description: 'New insurance policy has been added.' });
      onPolicyAdded();
      onOpenChange(false);
      form.reset();
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
              <Calendar mode="single" selected={field.value} onSelect={field.onChange} captionLayout="dropdown-buttons" fromYear={1900} toYear={new Date().getFullYear() + 5} />
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add New Insurance Policy</DialogTitle>
          <DialogDescription>Enter the details of the new policy.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <ScrollArea className="h-96 p-1">
              <div className="space-y-4 px-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="insured_person"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel>Insured Person</FormLabel>
                            <Popover open={isHolderPopoverOpen} onOpenChange={setIsHolderPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <FormControl>
                                        <Button
                                            variant="outline"
                                            role="combobox"
                                            className={cn(
                                            "justify-between w-full",
                                            !field.value && "text-muted-foreground"
                                            )}
                                        >
                                            {field.value
                                            ? policyHolders.find(
                                                (holder) => holder.name === field.value
                                                )?.name
                                            : "Select policy holder"}
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                    <Command>
                                        <CommandInput placeholder="Search policy holder..." />
                                        <CommandEmpty>No holder found.</CommandEmpty>
                                        <CommandGroup>
                                            <ScrollArea className="h-48">
                                                {policyHolders.map((holder) => (
                                                    <CommandItem
                                                        value={holder.name}
                                                        key={holder.id}
                                                        onSelect={(currentValue) => {
                                                            form.setValue("insured_person", currentValue === field.value ? "" : currentValue)
                                                            setIsHolderPopoverOpen(false)
                                                        }}
                                                    >
                                                        <Check
                                                        className={cn(
                                                            "mr-2 h-4 w-4",
                                                            holder.name === field.value
                                                            ? "opacity-100"
                                                            : "opacity-0"
                                                        )}
                                                        />
                                                        {holder.name}
                                                    </CommandItem>
                                                ))}
                                            </ScrollArea>
                                        </CommandGroup>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    <FormField control={form.control} name="policy_no" render={({ field }) => (<FormItem><FormLabel>Policy No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="insurance_company" render={({ field }) => (<FormItem><FormLabel>Insurance Company</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="policy_category" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="policy_name" render={({ field }) => (<FormItem><FormLabel>Policy Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="premium" render={({ field }) => (<FormItem><FormLabel>Premium</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <DatePickerField name="due_date" label="Next Due Date"/>
                    <FormField control={form.control} name="sum_insured" render={({ field }) => (<FormItem><FormLabel>Sum Insured</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <DatePickerField name="date_of_comm" label="Date of Commencement"/>
                    <DatePickerField name="date_of_maturity" label="Date of Maturity"/>
                    <DatePickerField name="last_premium_date" label="Last Premium Date"/>
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
                    <FormField control={form.control} name="auto_debit" render={({ field }) => (<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 mt-8"><FormLabel>Auto Debit</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>)}/>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Save className="mr-2 h-4 w-4" /> Save Policy
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
