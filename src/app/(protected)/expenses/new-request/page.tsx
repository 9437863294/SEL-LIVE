

'use client';
export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ArrowLeft, Save, Loader2, Check, ChevronsUpDown, Receipt, Sparkles, Info, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, runTransaction, getDoc } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Department, Project, SerialNumberConfig, AccountHead, SubAccountHead, ExpenseRequest, DailyRequisitionEntry } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { format } from 'date-fns';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { logUserActivity } from '@/lib/activity-logger';
import { useState, useEffect, useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ExpenseBadge } from '@/components/expenses/page-header';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import {
  defaultExpensesSettings,
  resolveFormField,
  type ExpensesModuleSettings,
} from '@/lib/expenses-settings';
import { allocateRequestNos } from '@/lib/expenses-import';
import { PageHeader } from '@/components/shared/page-header';


/** How two spellings of a party name are compared: case and spacing do not make a new party. */
const partyKey = (name: unknown) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The on-record spelling of a party name, or undefined when it is not on record. */
const findRecordedParty = (name: string, recorded: readonly string[]): string | undefined => {
  const key = partyKey(name);
  return key ? recorded.find(candidate => partyKey(candidate) === key) : undefined;
};

/**
 * Built from the module's field configuration rather than fixed, so making Remarks mandatory (or
 * Party optional) under Settings actually changes what the form will accept. Project, amount and
 * sub-head stay required whatever the configuration says — the record is meaningless without them,
 * which is why the settings screen will not let them be relaxed either.
 *
 * With "Restrict parties to existing names" on, a party must be one already on an expense request
 * or a requisition (`recordedParties`). Blank is still governed by the field's own required setting.
 */
const buildExpenseFormSchema = (settings: ExpensesModuleSettings, recordedParties: readonly string[] = []) => {
  const text = (key: Parameters<typeof resolveFormField>[1]) => {
    const field = resolveFormField(settings, key);
    return field.visible && field.required
      ? z.string().min(1, `${field.label} is required.`)
      : z.string().optional();
  };

  return z
    .object({
      departmentId: z.string().min(1, 'Department is required.'),
      projectId: z.string().min(1, 'Project is required.'),
      amount: z.coerce.number().gte(0, 'Amount must be a non-negative number.'),
      headOfAccount: z.string().min(1, 'Head of Account is required.'),
      subHeadOfAccount: z.string().min(1, 'Sub-Head of Account is required.'),
      remarks: text('remarks'),
      description: text('description'),
      partyName: text('partyName'),
    })
    .superRefine((values, ctx) => {
      if (!settings.data.restrictPartyToExisting) return;
      const name = values.partyName?.trim();
      if (name && !findRecordedParty(name, recordedParties)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['partyName'],
          message: `"${name}" is not a party on record. Choose one from the list — adding new parties is turned off in Expenses › Settings.`,
        });
      }
    });
};

const expenseFormSchema = buildExpenseFormSchema(defaultExpensesSettings());

type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

function ReadOnlyField({ label, value, id }: { label: string; value: string; id?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-slate-700 flex items-center gap-1">
        {label}
        <Info className="h-3 w-3 text-muted-foreground/50" />
      </Label>
      <Input
        id={id}
        value={value}
        readOnly
        className="h-9 text-sm bg-muted/30 border-border/40 text-muted-foreground cursor-default focus:ring-0 focus:ring-offset-0"
      />
    </div>
  );
}

function NewExpenseRequestForm() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { settings } = useExpensesSettings();
  const searchParams = useSearchParams();

  /** Labels, help text and required-ness come from Settings › Table & Field Configuration. */
  const fieldFor = (key: Parameters<typeof resolveFormField>[1]) => resolveFormField(settings, key);

  const departmentIdFromUrl = searchParams?.get('departmentId') ?? null;
  const amountFromUrl = searchParams?.get('amount') ?? null;
  const projectIdFromUrl = searchParams?.get('projectId') ?? null;
  const partyNameFromUrl = searchParams?.get('partyName') ?? null;
  const descriptionFromUrl = searchParams?.get('description') ?? null;

  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);
  /** The picker's suggestions: the names on record plus any typed in this session. */
  const [partyNames, setPartyNames] = useState<string[]>([]);
  /** Party names already on an expense request or a requisition — what "existing" means for the party rule. */
  const [recordedPartyNames, setRecordedPartyNames] = useState<string[]>([]);
  /** Every request number in use in any department, so a new one never repeats one imported from a file. */
  const [recordedRequestNos, setRecordedRequestNos] = useState<string[]>([]);
  const [previewRequestNo, setPreviewRequestNo] = useState('Generating...');
  const [timestamp, setTimestamp] = useState('');

  const [partySearch, setPartySearch] = useState('');
  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(buildExpenseFormSchema(settings, recordedPartyNames)),
    defaultValues: {
      departmentId: departmentIdFromUrl || '',
      projectId: projectIdFromUrl || '',
      amount: amountFromUrl ? parseFloat(amountFromUrl) : 0,
      headOfAccount: '',
      subHeadOfAccount: '',
      remarks: '',
      description: descriptionFromUrl || '',
      partyName: partyNameFromUrl || '',
    },
  });

  useEffect(() => {
    if (partyNameFromUrl) setPartySearch(partyNameFromUrl);
  }, [partyNameFromUrl]);

  /**
   * This page had no permission check of its own — it trusted the links that lead to it, and a
   * typed URL reached the form regardless. Only departments the user may raise a request in are
   * offered, and a `?departmentId=` naming one they may not is refused.
   */
  const creatableDepartments = useMemo(
    () => departments.filter(dept => can('Create', 'Expenses.Departments', dept.id)),
    [departments, can],
  );

  const canUseUrlDepartment = departmentIdFromUrl
    ? can('Create', 'Expenses.Departments', departmentIdFromUrl)
    : true;

  const isDenied =
    !isAuthLoading && !isLoadingData && (!canUseUrlDepartment || creatableDepartments.length === 0);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoadingData(true);
      try {
        const [deptsSnap, projectsSnap, headsSnap, subHeadsSnap, expensesSnap, requisitionsSnap] = await Promise.all([
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'accountHeads')),
          getDocs(collection(db, 'subAccountHeads')),
          getDocs(collection(db, 'expenseRequests')),
          getDocs(collection(db, 'dailyRequisitions')),
        ]);
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setAccountHeads(headsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AccountHead)));
        setSubAccountHeads(
          subHeadsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubAccountHead)).sort((a, b) => a.name.localeCompare(b.name))
        );
        const existingExpenses = expensesSnap.docs.map(doc => doc.data() as ExpenseRequest);
        const existingExpenseParties = existingExpenses.map(expense => expense.partyName);
        const existingRequisitionParties = requisitionsSnap.docs.map(doc => (doc.data() as DailyRequisitionEntry).partyName);
        const uniquePartyNames = [...new Set([...existingExpenseParties, ...existingRequisitionParties].filter(Boolean))].sort();
        setPartyNames(uniquePartyNames);
        setRecordedPartyNames(uniquePartyNames);
        setRecordedRequestNos(existingExpenses.map(expense => expense.requestNo).filter(Boolean));
      } catch (error) {
        toast({ title: 'Error', description: 'Failed to load required data.', variant: 'destructive' });
      }
      setIsLoadingData(false);
    };
    fetchData();
  }, [toast]);

  useEffect(() => {
    form.setValue('departmentId', departmentIdFromUrl || '');
    form.setValue('projectId', projectIdFromUrl || '');
    form.setValue('amount', amountFromUrl ? parseFloat(amountFromUrl) : 0);
    form.setValue('partyName', partyNameFromUrl || '');
    form.setValue('description', descriptionFromUrl || '');
  }, [departmentIdFromUrl, projectIdFromUrl, amountFromUrl, partyNameFromUrl, descriptionFromUrl, form]);

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
          // Formatted exactly as the save will format it, stepping over numbers already in use.
          const { requestNos } = allocateRequestNos(configDoc.data() as SerialNumberConfig, 1, recordedRequestNos);
          setPreviewRequestNo(requestNos[0]);
        } else {
          setPreviewRequestNo('Config not found');
        }
      } catch (error) {
        setPreviewRequestNo('Error generating ID');
      }
    };
    generatePreviewId();
    setTimestamp(format(new Date(), 'PPpp'));
  }, [form, form.watch('departmentId'), recordedRequestNos]);

  const handleSubHeadChange = (subHeadName: string) => {
    const selectedSubHead = subAccountHeads.find(sh => sh.name === subHeadName);
    form.setValue('subHeadOfAccount', subHeadName);
    if (selectedSubHead) {
      const parentHead = accountHeads.find(h => h.id === selectedSubHead.headId);
      form.setValue('headOfAccount', parentHead ? parentHead.name : '');
    }
  };

  const handleSave = async (data: ExpenseFormValues) => {
    if (!user) {
      toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive' });
      return;
    }
    if (!can('Create', 'Expenses.Departments', data.departmentId)) {
      toast({
        title: 'Not permitted',
        description: 'You do not have permission to raise a request for that department.',
        variant: 'destructive',
      });
      return;
    }
    setIsSaving(true);
    try {
      const selectedDept = departments.find(d => d.id === data.departmentId);
      if (!selectedDept) throw new Error('Selected department not found.');

      // With parties restricted, a name typed in another case or spacing is saved in the spelling
      // already on record, so the party ledger does not split one party in two.
      const partyName =
        (settings.data.restrictPartyToExisting && data.partyName
          ? findRecordedParty(data.partyName, recordedPartyNames)
          : undefined) ?? data.partyName ?? '';

      // A field the configuration has made optional arrives as undefined, which Firestore rejects
      // — and a request whose remarks are missing should read as empty, not as absent.
      const requestFields = {
        ...data,
        partyName,
        description: data.description ?? '',
        remarks: data.remarks ?? '',
        generatedByDepartment: selectedDept.name,
        generatedByUser: user?.name || 'Unknown',
        generatedByUserId: user?.id || 'Unknown',
        receptionNo: '',
        receptionDate: '',
        createdAt: new Date().toISOString(),
      };

      const configRef = doc(db, 'departmentSerialConfigs', data.departmentId);
      // The id is fixed outside the transaction, so a retried attempt writes the same document.
      const requestRef = doc(collection(db, 'expenseRequests'));
      // The number and the request that carries it commit together: a failed write no longer burns
      // a number, and a write that did land cannot be followed by a retry that creates a second copy.
      const newRequestNo = await runTransaction(db, async (transaction) => {
        const configDoc = await transaction.get(configRef);
        if (!configDoc.exists()) throw new Error(`Serial number configuration for ${selectedDept.name} not found!`);
        const { requestNos, nextIndex } = allocateRequestNos(
          configDoc.data() as SerialNumberConfig,
          1,
          recordedRequestNos,
        );
        const requestNo = requestNos[0];
        transaction.update(configRef, { startingIndex: nextIndex });
        transaction.set(requestRef, { ...requestFields, requestNo });
        return requestNo;
      });

      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: 'Expenses',
        action: 'Create Expense Request',
        details: { requestNo: newRequestNo, department: selectedDept.name, amount: data.amount },
        recordId: requestRef.id,
        recordRef: newRequestNo,
      });

      setRecordedRequestNos(prev => [...prev, newRequestNo]);
      if (partyName) {
        if (!partyNames.includes(partyName)) setPartyNames(prev => [...prev, partyName].sort());
        if (!recordedPartyNames.includes(partyName)) setRecordedPartyNames(prev => [...prev, partyName].sort());
      }

      toast({ title: 'Request Created', description: `Expense request ${newRequestNo} has been successfully created.` });
      form.reset({
        departmentId: departmentIdFromUrl || '',
        projectId: '',
        amount: 0,
        headOfAccount: '',
        subHeadOfAccount: '',
        remarks: '',
        description: '',
        partyName: '',
      });
      setPartySearch('');
    } catch (error: any) {
      console.error('Error creating expense request:', error);
      toast({ title: 'Save Failed', description: error.message || 'An error occurred while saving the request.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedDepartmentName = departments.find(d => d.id === form.getValues('departmentId'))?.name || '';

  /** Settings › Table & Field Configuration › "Restrict parties to existing names". */
  const restrictParty = settings.data.restrictPartyToExisting;
  const partyOptions = restrictParty ? recordedPartyNames : partyNames;

  return (
    <div className="w-full space-y-4">
      <PageHeader
        icon={Receipt}
        title="New Expense Request"
        description="Fill in the details below to create a new expense request."
        backHref="/expenses"
        badge={<ExpenseBadge accent="emerald"><Sparkles className="h-2.5 w-2.5" /> New</ExpenseBadge>}
      />

      {isLoadingData || isAuthLoading ? (
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          </CardContent>
        </Card>
      ) : isDenied ? (
        <Card className="border-destructive/30">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to raise an expense request
              {departmentIdFromUrl ? ' for this department.' : ' for any department.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSave)}>
            <Card className="border-white/60 bg-white/70 backdrop-blur-sm overflow-hidden shadow-sm">
              <div className="h-[3px] bg-gradient-to-r from-emerald-500 via-teal-500 to-transparent" />
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-50">
                    <Receipt className="h-3.5 w-3.5 text-emerald-600" />
                  </span>
                  Expense Details
                </CardTitle>
                <CardDescription className="text-xs">All fields except Remarks are required.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {/* Section: Auto-generated / Read-only */}
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-200" />
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">Auto-generated</span>
                    <div className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-200" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <ReadOnlyField label="Request No" value={previewRequestNo} id="requestNo" />
                    <ReadOnlyField label="Timestamp" value={timestamp} id="timestamp" />
                    <ReadOnlyField label="Generated by Department" value={selectedDepartmentName} id="departmentName" />
                  </div>
                </div>

                {/* Section: Main Fields */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent to-emerald-200" />
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">Request Details</span>
                    <div className="h-px flex-1 bg-gradient-to-l from-transparent to-emerald-200" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Department */}
                    <FormField
                      control={form.control}
                      name="departmentId"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-sm font-medium text-slate-700">Department</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value} disabled={!!departmentIdFromUrl}>
                            <FormControl>
                              <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="Select Department" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {creatableDepartments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Project */}
                    <FormField
                      control={form.control}
                      name="projectId"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-sm font-medium text-slate-700">{fieldFor('projectId').label}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select Project" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Amount */}
                    <FormField
                      control={form.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-sm font-medium text-slate-700">{fieldFor('amount').label}</FormLabel>
                          <FormControl>
                            <Input type="number" placeholder="0.00" className="h-9 text-sm" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Party Name */}
                    <FormField
                      control={form.control}
                      name="partyName"
                      render={({ field }) => (
                        <FormItem className="flex flex-col space-y-1.5">
                          <FormLabel className="text-sm font-medium text-slate-700">{fieldFor('partyName').label}{!fieldFor('partyName').required && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}</FormLabel>
                          <Popover open={partyPopoverOpen} onOpenChange={setPartyPopoverOpen}>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn('h-9 w-full justify-between font-normal text-sm', !field.value && 'text-muted-foreground')}
                                >
                                  {field.value || (restrictParty ? 'Select a party on record' : 'Select or type a party name')}
                                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" side="bottom" align="start">
                              <Command>
                                <CommandInput placeholder="Search party name..." value={partySearch} onValueChange={setPartySearch} />
                                <CommandList>
                                  <CommandEmpty>{restrictParty ? 'No party on record matches.' : 'No party found.'}</CommandEmpty>
                                  <CommandGroup>
                                    {partyOptions.filter(p => p.toLowerCase().includes(partySearch.toLowerCase())).map(name => (
                                      <CommandItem
                                        value={name}
                                        key={name}
                                        onSelect={currentValue => {
                                          field.onChange(currentValue);
                                          form.setValue('partyName', currentValue);
                                          setPartySearch(currentValue);
                                          setPartyPopoverOpen(false);
                                        }}
                                      >
                                        <Check className={cn('mr-2 h-4 w-4', name === field.value ? 'opacity-100' : 'opacity-0')} />
                                        {name}
                                      </CommandItem>
                                    ))}
                                    {!restrictParty && partySearch && !partyNames.some(n => n.toLowerCase() === partySearch.toLowerCase()) && (
                                      <CommandItem
                                        value={partySearch}
                                        onSelect={currentValue => {
                                          field.onChange(currentValue);
                                          form.setValue('partyName', currentValue);
                                          setPartySearch(currentValue);
                                          setPartyNames(prev => [...prev, currentValue].sort());
                                          setPartyPopoverOpen(false);
                                        }}
                                      >
                                        <Check className="mr-2 h-4 w-4 opacity-0" />
                                        Create &quot;{partySearch}&quot;
                                      </CommandItem>
                                    )}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          {restrictParty && (
                            <FormDescription className="text-[11px]">
                              Only parties already on record can be chosen.
                            </FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Sub-Head first — it auto-fills Head */}
                    <FormField
                      control={form.control}
                      name="subHeadOfAccount"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-sm font-medium text-slate-700">{fieldFor('subHeadOfAccount').label}</FormLabel>
                          <Select onValueChange={handleSubHeadChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select Sub-Head" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>{subAccountHeads.map(sh => <SelectItem key={sh.id} value={sh.name}>{sh.name}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Head auto-filled */}
                    <FormField
                      control={form.control}
                      name="headOfAccount"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-sm font-medium text-slate-700 flex items-center gap-1">
                            Head of A/c
                            <Info className="h-3 w-3 text-muted-foreground/50" />
                          </FormLabel>
                          <Select value={field.value} disabled>
                            <FormControl>
                              <SelectTrigger className="h-9 text-sm bg-muted/30 text-muted-foreground border-border/40">
                                <SelectValue placeholder="Auto-filled from Sub-Head" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>{accountHeads.map(h => <SelectItem key={h.id} value={h.name}>{h.name}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Description - full width */}
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5 col-span-1 md:col-span-2 lg:col-span-3">
                          <FormLabel className="text-sm font-medium text-slate-700">{fieldFor('description').label}{!fieldFor('description').required && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}</FormLabel>
                          <FormControl>
                            <Textarea {...field} rows={3} placeholder="Describe the purpose of this expense..." className="text-sm resize-none" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Remarks - full width */}
                    <FormField
                      control={form.control}
                      name="remarks"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5 col-span-1 md:col-span-2 lg:col-span-3">
                          <FormLabel className="text-sm font-medium text-slate-700">{fieldFor('remarks').label}{!fieldFor('remarks').required && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}</FormLabel>
                          <FormControl>
                            <Textarea {...field} rows={2} placeholder="Any additional notes or remarks..." className="text-sm resize-none" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sticky bottom bar */}
            <div className="sticky bottom-0 py-3 -mx-1 px-1 bg-background/80 backdrop-blur-sm border-t border-border/30 mt-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs text-muted-foreground">
                  All fields except <span className="font-medium">Remarks</span> are required.
                </p>
                <Button
                  type="submit"
                  disabled={isSaving}
                  size="sm"
                  className="gap-2 min-w-[130px]"
                >
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {isSaving ? 'Saving...' : 'Save Request'}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}

export default function NewExpenseRequestPage() {
  return (
    <Suspense fallback={
      <div className="w-full space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    }>
      <NewExpenseRequestForm />
    </Suspense>
  );
}
