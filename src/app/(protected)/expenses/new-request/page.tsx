

'use client';
export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Save, Loader2, Receipt, Sparkles, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, runTransaction, getDoc } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Department, Project, SerialNumberConfig, AccountHead, SubAccountHead, ExpenseRequest, DailyRequisitionEntry } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { format } from 'date-fns';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
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
import { useExpensesActor } from '@/components/expenses/use-expenses-actor';
import { findDuplicateRequest, resolveFormField, toIsoStamp } from '@/lib/expenses-settings';
import { allocateRequestNos } from '@/lib/expenses-import';
import { PageHeader } from '@/components/shared/page-header';
import { StatutorySection, FORM_LABEL as LABEL, type StatutoryValue } from '@/components/expenses/statutory-section';
import {
  ExpenseRequestFields,
  ExpenseRequestTotals,
  buildExpenseFormSchema,
  findRecordedParty,
  type ExpenseFormValues,
} from '@/components/expenses/expense-request-fields';
import { useBillRegistration } from '@/components/expenses/bill-registration';
import {
  EMPTY_STATUTORY,
  buildExpenseStatutory,
  computeStatutory,
  hasStatutory,
  statutoryErrors,
} from '@/lib/statutory';

function NewExpenseRequestForm() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { isLoading: isAuthLoading } = useAuthorization();
  // The module's own assignment is part of the answer, so the refusal below has to wait for it:
  // `assigned-only` can name someone the permission map does not, and showing Access Denied for the
  // moment before the assignment arrives would turn their own page into a locked door.
  const { may, isLoading: isActorLoading } = useExpensesActor();
  const { settings } = useExpensesSettings();
  const searchParams = useSearchParams();

  /** Labels, help text and required-ness come from Settings › Field Control. */
  const fieldFor = (key: Parameters<typeof resolveFormField>[1]) => resolveFormField(settings, key);

  const departmentIdFromUrl = searchParams?.get('departmentId') ?? null;
  /**
   * `?amount=` is typed by whoever built the link. `parseFloat('')` and `parseFloat('abc')` are
   * both `NaN`, which React warns about on the amount box and which Zod then rejects with "expected
   * number, received nan" rather than with anything a user can act on — so an unreadable figure is
   * treated as no figure at all.
   */
  const amountFromUrl = (() => {
    const raw = searchParams?.get('amount');
    if (!raw) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  })();
  const projectIdFromUrl = searchParams?.get('projectId') ?? null;
  const partyNameFromUrl = searchParams?.get('partyName') ?? null;
  const descriptionFromUrl = searchParams?.get('description') ?? null;

  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);
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

  /** GST & TDS (Statutory section). Optional; stored on the request only when something is entered. */
  const [statutory, setStatutory] = useState<StatutoryValue>(EMPTY_STATUTORY);
  const [showStatutoryErrors, setShowStatutoryErrors] = useState(false);
  const [statutoryKey, setStatutoryKey] = useState(0);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(buildExpenseFormSchema(settings, recordedPartyNames)),
    defaultValues: {
      departmentId: departmentIdFromUrl || '',
      projectId: projectIdFromUrl || '',
      amount: amountFromUrl ?? 0,
      headOfAccount: '',
      subHeadOfAccount: '',
      remarks: '',
      description: descriptionFromUrl || '',
      partyName: partyNameFromUrl || '',
    },
  });

  /**
   * This page had no permission check of its own — it trusted the links that lead to it, and a
   * typed URL reached the form regardless. Only departments the user may raise a request in are
   * offered, and a `?departmentId=` naming one they may not is refused.
   *
   * Who may raise one is the `Create` grant on the department plus, where an administrator has set
   * one up, the module's own assignment for `raise-request` (Settings › User Roles) — which can
   * differ per department and above an amount, so the figure on the form is part of the question.
   * With nothing configured this is the `can(...)` check it replaces, verbatim.
   */
  const watchedDepartmentId = form.watch('departmentId');
  const watchedAmount = Number(form.watch('amount')) || 0;

  const creatableDepartments = useMemo(
    () => departments.filter(dept => may('raise-request', { departmentId: dept.id, amount: watchedAmount }).allowed),
    [departments, may, watchedAmount],
  );

  /**
   * Reaching the page is deliberately not an amount question — denying the form before a figure
   * has been typed would leave nowhere to type one. The amount narrows the dropdown above.
   */
  const raisableDepartments = useMemo(
    () => departments.filter(dept => may('raise-request', { departmentId: dept.id }).allowed),
    [departments, may],
  );

  const canUseUrlDepartment = departmentIdFromUrl
    ? may('raise-request', { departmentId: departmentIdFromUrl }).allowed
    : true;

  const isDenied =
    !isAuthLoading && !isActorLoading && !isLoadingData && (!canUseUrlDepartment || raisableDepartments.length === 0);

  /** The verdict for what is on the form now — the Save button's state and the words for a refusal. */
  const raiseDecision = watchedDepartmentId
    ? may('raise-request', { departmentId: watchedDepartmentId, amount: watchedAmount })
    : null;

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
    form.setValue('amount', amountFromUrl ?? 0);
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
    // Checked again here, against the department and the amount being saved: the button is not the
    // gate, and an amount-banded assignment is only knowable once the figure is known.
    const decision = may('raise-request', {
      departmentId: data.departmentId,
      amount: Number(data.amount) || 0,
    });
    if (!decision.allowed) {
      toast({
        title: 'Not permitted',
        description:
          decision.mode === 'roles-only'
            ? 'You do not have permission to raise a request for that department.'
            : decision.reason,
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

      // A field hidden under Field Control is saved empty — that is what hiding it means, and the
      // form no longer shows it, so a value could otherwise only have come from the query string.
      const shown = (key: Parameters<typeof resolveFormField>[1], value: string) =>
        fieldFor(key).visible ? value : '';
      const savedPartyName = shown('partyName', partyName);

      // A field the configuration has made optional arrives as undefined, which Firestore rejects
      // — and a request whose remarks are missing should read as empty, not as absent.
      const requestFields = {
        ...data,
        partyName: savedPartyName,
        description: shown('description', data.description ?? ''),
        remarks: shown('remarks', data.remarks ?? ''),
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
        { requestNo: newRequestNo, partyName: savedPartyName, amount: data.amount, createdAt: requestFields.createdAt },
      ]);
      if (savedPartyName && !recordedPartyNames.includes(savedPartyName)) {
        setRecordedPartyNames(prev => [...prev, savedPartyName].sort());
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


  // `watchedAmount` is read further up as well — the assignment for raising a request can be
  // banded by amount, so the gate watches the same figure the totals below do.
  const withStatutoryNow = captureStatutory && hasStatutory(statutory);
  const netPayableNow = withStatutoryNow ? computeStatutory(watchedAmount, statutory).net : watchedAmount;
  const inrText = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n || 0);

  return (
    <div className="w-full space-y-4">
      <PageHeader
        icon={Receipt}
        title="New Expense Request"
        description="Raise a payment request. Add GST, TDS or deductions only when the bill has them."
        backHref="/expenses"
        badge={<ExpenseBadge accent="emerald"><Sparkles className="h-2.5 w-2.5" /> New</ExpenseBadge>}
      />

      {isLoadingData || isAuthLoading || isActorLoading ? (
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
            {/* The same fields the register's Edit dialog shows (components/expenses/expense-request-fields). */}
            <ExpenseRequestFields
              form={form}
              settings={settings}
              projects={projects}
              accountHeads={accountHeads}
              subAccountHeads={subAccountHeads}
              recordedParties={recordedPartyNames}
              requestNo={previewRequestNo}
              timestamp={timestamp}
              netPayable={netPayableNow}
              withStatutory={withStatutoryNow}
              department={
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
              }
              statutory={
                // Only as much tax detail as the bill has — and none when Data Control turns GST & TDS capture off
                captureStatutory && (
                  <StatutorySection
                    key={statutoryKey}
                    amount={watchedAmount}
                    value={statutory}
                    onChange={setStatutory}
                    showErrors={showStatutoryErrors}
                    projectId={form.watch('projectId')}
                    departmentId={form.watch('departmentId')}
                  />
                )
              }
            />

            {/* Totals and Save, always in reach */}
            <div className="sticky bottom-0 z-10 rounded-t-xl border border-b-0 bg-background/95 px-4 py-3 shadow-[0_-8px_24px_-20px_rgba(15,23,42,0.5)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ExpenseRequestTotals amount={watchedAmount} netPayable={netPayableNow} withStatutory={withStatutoryNow} />
                {/* A refusal that comes from the assignment rather than the role says so on the
                    button itself — the department and amount are the two things that can change it,
                    and neither is obvious from a greyed-out Save. */}
                <Button
                  type="submit"
                  disabled={isSaving || (!!raiseDecision && !raiseDecision.allowed)}
                  title={raiseDecision && !raiseDecision.allowed ? raiseDecision.reason : undefined}
                  className="min-w-[150px] gap-2"
                >
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
