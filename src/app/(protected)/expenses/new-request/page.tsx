

'use client';
export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, Loader2, Check, ChevronsUpDown, Receipt, Sparkles, ShieldAlert, Hash, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, runTransaction, getDoc } from 'firebase/firestore';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ExpenseBadge } from '@/components/expenses/page-header';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import {
  defaultExpensesSettings,
  findDuplicateRequest,
  requestAmountError,
  resolveFormField,
  toIsoStamp,
  type ExpensesModuleSettings,
} from '@/lib/expenses-settings';
import { allocateRequestNos } from '@/lib/expenses-import';
import { PageHeader } from '@/components/shared/page-header';
import {
  StatutorySection,
  FORM_GRID as GRID,
  FORM_LABEL as LABEL,
  FORM_READ_ONLY as READ_ONLY,
  type StatutoryValue,
} from '@/components/expenses/statutory-section';
import { useBillRegistration } from '@/components/expenses/bill-registration';
import {
  EMPTY_STATUTORY,
  buildExpenseStatutory,
  computeStatutory,
  hasStatutory,
  statutoryErrors,
} from '@/lib/statutory';


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
 * With a largest request amount set (Settings › Data Control), anything above it is refused.
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
      const tooMuch = requestAmountError(Number(values.amount) || 0, settings.data);
      if (tooMuch) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: tooMuch });
      if (!settings.data.restrictPartyToExisting) return;
      const name = values.partyName?.trim();
      if (name && !findRecordedParty(name, recordedParties)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['partyName'],
          message: `"${name}" is not a party on record. Choose one from the list — adding new parties is turned off in Expenses › Settings › Data Control.`,
        });
      }
    });
};

const expenseFormSchema = buildExpenseFormSchema(defaultExpensesSettings());

type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

function NewExpenseRequestForm() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { settings } = useExpensesSettings();
  const searchParams = useSearchParams();

  /** Labels, help text and required-ness come from Settings › Field Control. */
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
  /** What the duplicate-request check compares against (Settings › Data Control). */
  const [recentRequests, setRecentRequests] = useState<Pick<ExpenseRequest, 'requestNo' | 'partyName' | 'amount' | 'createdAt'>[]>([]);
  /** A save waiting on the user to confirm it is not a repeat of `match`. */
  const [pendingDuplicate, setPendingDuplicate] = useState<{ data: ExpenseFormValues; match: { requestNo: string; createdAt: string } } | null>(null);
  const [previewRequestNo, setPreviewRequestNo] = useState('Generating...');
  const [timestamp, setTimestamp] = useState('');

  const [partySearch, setPartySearch] = useState('');
  /** GST & TDS (Statutory section). Optional; stored on the request only when something is entered. */
  const [statutory, setStatutory] = useState<StatutoryValue>(EMPTY_STATUTORY);
  const [showStatutoryErrors, setShowStatutoryErrors] = useState(false);
  const [statutoryKey, setStatutoryKey] = useState(0);
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
        setRecentRequests(
          existingExpenses.map(({ requestNo, partyName, amount, createdAt }) => ({ requestNo, partyName, amount, createdAt })),
        );
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
    setTimestamp(format(new Date(), 'dd MMM yyyy, HH:mm'));
  }, [form, form.watch('departmentId'), recordedRequestNos]);

  const handleSubHeadChange = (subHeadName: string) => {
    const selectedSubHead = subAccountHeads.find(sh => sh.name === subHeadName);
    form.setValue('subHeadOfAccount', subHeadName);
    if (selectedSubHead) {
      const parentHead = accountHeads.find(h => h.id === selectedSubHead.headId);
      form.setValue('headOfAccount', parentHead ? parentHead.name : '');
    }
  };

  /** Settings › Data Control › "Capture GST & TDS on new requests". Off hides the section and ignores anything in it. */
  const captureStatutory = settings.data.gstTdsCapture;

  /**
   * Which of the company's GST registrations this request belongs to — chosen in the section, else
   * worked out from the project or department it is raised for (src/lib/gst-registrations.ts). Its
   * state is what the CGST + SGST vs IGST check is judged against, here as in the section.
   */
  const bill = useBillRegistration({
    gstRegistrationId: statutory.gstRegistrationId,
    projectId: form.watch('projectId'),
    departmentId: form.watch('departmentId'),
  });

  const handleSave = async (data: ExpenseFormValues, duplicateConfirmed = false) => {
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
    // The request amount is the taxable value; GST and deductions are worked out on it.
    const taxable = Number(data.amount) || 0;
    // The registration chosen on the bill is kept on the request itself, not inside its statutory
    // block; '' leaves the attribution chain to decide it afresh wherever the bill is read.
    const { gstRegistrationId: chosenRegistrationId = '', ...statutoryInput } = statutory;
    const withStatutory = captureStatutory && hasStatutory(statutoryInput);
    if (withStatutory) {
      const problems = Object.values(statutoryErrors(taxable, statutoryInput, bill.companyStateCode));
      if (problems.length) {
        setShowStatutoryErrors(true);
        toast({ title: 'Check the GST & TDS details', description: problems[0], variant: 'destructive' });
        return;
      }
    }
    // Settings › Data Control › "Warn on a repeat request within N days": the same party for the
    // same amount recently is usually the same bill raised twice, so ask before saving it.
    if (!duplicateConfirmed) {
      const match = findDuplicateRequest(
        recentRequests,
        { partyName: data.partyName, amount: taxable },
        settings.data.duplicateRequestWarningDays,
      );
      if (match) {
        setPendingDuplicate({ data, match: { requestNo: match.requestNo || 'an earlier request', createdAt: toIsoStamp(match.createdAt) ?? '' } });
        return;
      }
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
        gstRegistrationId: chosenRegistrationId,
        ...(withStatutory ? { statutory: buildExpenseStatutory(taxable, statutoryInput) } : {}),
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
        details: {
          requestNo: newRequestNo,
          department: selectedDept.name,
          amount: data.amount,
          ...(withStatutory ? { netPayable: computeStatutory(taxable, statutory).net, gstNo: statutory.gstNo, tdsSection: statutory.tdsSection } : {}),
        },
        recordId: requestRef.id,
        recordRef: newRequestNo,
      });

      setRecordedRequestNos(prev => [...prev, newRequestNo]);
      setRecentRequests(prev => [
        ...prev,
        { requestNo: newRequestNo, partyName, amount: data.amount, createdAt: requestFields.createdAt },
      ]);
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
      setStatutory(EMPTY_STATUTORY);
      setShowStatutoryErrors(false);
      setStatutoryKey(key => key + 1);
    } catch (error: any) {
      console.error('Error creating expense request:', error);
      toast({ title: 'Save Failed', description: error.message || 'An error occurred while saving the request.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };


  /** Settings › Data Control › "Restrict parties to existing names". */
  const restrictParty = settings.data.restrictPartyToExisting;
  const partyOptions = restrictParty ? recordedPartyNames : partyNames;

  const watchedAmount = Number(form.watch('amount')) || 0;
  const withStatutoryNow = captureStatutory && hasStatutory(statutory);
  const netPayableNow = withStatutoryNow ? computeStatutory(watchedAmount, statutory).net : watchedAmount;
  const headOfAccount = form.watch('headOfAccount');
  const headError = form.formState.errors.headOfAccount?.message;
  const inrText = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n || 0);
  const optional = (key: Parameters<typeof resolveFormField>[1]) =>
    !fieldFor(key).required && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>;
  /** The help text set under Settings › Field Control, if any. */
  const help = (key: Parameters<typeof resolveFormField>[1]) => {
    const text = fieldFor(key).helpText;
    return text ? <FormDescription className="text-[11px]">{text}</FormDescription> : null;
  };

  return (
    <div className="w-full space-y-4">
      <PageHeader
        icon={Receipt}
        title="New Expense Request"
        description="Raise a payment request. Add GST, TDS or deductions only when the bill has them."
        backHref="/expenses"
        badge={<ExpenseBadge accent="emerald"><Sparkles className="h-2.5 w-2.5" /> New</ExpenseBadge>}
      />

      {isLoadingData || isAuthLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
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
          <form onSubmit={form.handleSubmit(data => handleSave(data))} className="space-y-4">
            {/* One card, one 6-column grid shared with the GST & TDS part below, so every column lines up:
                row 1 — who and where it is booked · row 2 — how much and what for. */}
            <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b bg-slate-50/70 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">Request details</h2>
                  <p className="text-xs text-muted-foreground">Who is being paid, for what, and how much.</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Hash className="h-3.5 w-3.5 text-slate-400" />
                    <span className={cn('font-medium text-slate-800', /\d/.test(previewRequestNo) && 'font-mono')}>{previewRequestNo}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                    {timestamp}
                  </span>
                </div>
              </div>

              <CardContent className={cn(GRID, 'p-4 sm:p-5')}>
                <FormField
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className={LABEL}>Department</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={!!departmentIdFromUrl}>
                        <FormControl>
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder="Select department" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {creatableDepartments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="projectId"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className={LABEL}>{fieldFor('projectId').label}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select project" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent>
                      </Select>
                      {help('projectId')}
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="partyName"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5 sm:col-span-2">
                      <FormLabel className={LABEL}>{fieldFor('partyName').label}{optional('partyName')}</FormLabel>
                      <Popover open={partyPopoverOpen} onOpenChange={setPartyPopoverOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              role="combobox"
                              className={cn('flex h-9 w-full justify-between px-3 font-normal text-sm', !field.value && 'text-muted-foreground')}
                            >
                              <span className="truncate">{field.value || (restrictParty ? 'Select a party on record' : 'Select or type a party')}</span>
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
                                    Add &quot;{partySearch}&quot;
                                  </CommandItem>
                                )}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {restrictParty && <FormDescription className="text-[11px]">Only parties already on record can be chosen.</FormDescription>}
                      {help('partyName')}
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="subHeadOfAccount"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className={LABEL}>{fieldFor('subHeadOfAccount').label}</FormLabel>
                      <Select onValueChange={handleSubHeadChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select sub-head" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>{subAccountHeads.map(sh => <SelectItem key={sh.id} value={sh.name}>{sh.name}</SelectItem>)}</SelectContent>
                      </Select>
                      {help('subHeadOfAccount')}
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />

                {/* The head is derived from the sub-head, so it is shown, not asked for. */}
                <div className="min-w-0 space-y-1.5">
                  <p className={LABEL}>{fieldFor('headOfAccount').label}</p>
                  <div className={cn(READ_ONLY, headOfAccount ? 'font-medium text-slate-800' : 'text-muted-foreground')}>
                    <span className="truncate">{headOfAccount || 'Set by the sub-head'}</span>
                  </div>
                  {fieldFor('headOfAccount').helpText && <p className="text-[11px] text-muted-foreground">{fieldFor('headOfAccount').helpText}</p>}
                  {headError && form.watch('subHeadOfAccount') && <p className="text-[11px] font-medium text-destructive">{headError}</p>}
                </div>

                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className={LABEL}>
                        {fieldFor('amount').label}
                        {withStatutoryNow && <span className="ml-1 font-normal text-muted-foreground">(before GST)</span>}
                      </FormLabel>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0.00"
                            className="h-9 pl-7 text-right text-sm font-semibold tabular-nums"
                            {...field}
                            value={field.value === 0 ? '' : field.value}
                          />
                        </FormControl>
                      </div>
                      {help('amount')}
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />

                <div className="min-w-0 space-y-1.5">
                  <p className={LABEL}>Net payable</p>
                  <div className={cn(READ_ONLY, 'justify-end border-emerald-200 bg-emerald-50/70 font-semibold tabular-nums text-emerald-800')}>
                    {inrText(netPayableNow)}
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5 sm:col-span-2">
                      <FormLabel className={LABEL}>{fieldFor('description').label}{optional('description')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="What the payment is for, e.g. Cement supply for Block A" className="h-9 text-sm" />
                      </FormControl>
                      {help('description')}
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="remarks"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5 sm:col-span-2">
                      <FormLabel className={LABEL}>{fieldFor('remarks').label}{optional('remarks')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Anything else worth noting" className="h-9 text-sm" />
                      </FormControl>
                      {help('remarks')}
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />
              </CardContent>

              {/* Only as much tax detail as the bill has — and none when Data Control turns GST & TDS capture off */}
              {captureStatutory && (
                <div className="border-t bg-slate-50/50 p-4 sm:p-5">
                  <StatutorySection
                    key={statutoryKey}
                    amount={watchedAmount}
                    value={statutory}
                    onChange={setStatutory}
                    showErrors={showStatutoryErrors}
                    projectId={form.watch('projectId')}
                    departmentId={form.watch('departmentId')}
                  />
                </div>
              )}
            </Card>

            {/* Totals and Save, always in reach */}
            <div className="sticky bottom-0 z-10 rounded-t-xl border border-b-0 bg-background/95 px-4 py-3 shadow-[0_-8px_24px_-20px_rgba(15,23,42,0.5)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
                  <span>
                    <span className="text-muted-foreground">Amount </span>
                    <span className="font-semibold tabular-nums">{inrText(watchedAmount)}</span>
                  </span>
                  {withStatutoryNow && (
                    <span>
                      <span className="text-muted-foreground">Net payable </span>
                      <span className="text-base font-bold tabular-nums text-emerald-700">{inrText(netPayableNow)}</span>
                    </span>
                  )}
                </div>
                <Button type="submit" disabled={isSaving} className="min-w-[150px] gap-2">
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {isSaving ? 'Saving…' : 'Save Request'}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      )}

      <AlertDialog open={!!pendingDuplicate} onOpenChange={open => { if (!open) setPendingDuplicate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This looks like a repeat request</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDuplicate
                ? `${pendingDuplicate.match.requestNo} was raised for ${pendingDuplicate.data.partyName} for ${inrText(Number(pendingDuplicate.data.amount) || 0)}${pendingDuplicate.match.createdAt ? ` on ${format(new Date(pendingDuplicate.match.createdAt), 'dd MMM yyyy')}` : ''}. Save this one as well?`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = pendingDuplicate;
                setPendingDuplicate(null);
                if (pending) void handleSave(pending.data, true);
              }}
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
