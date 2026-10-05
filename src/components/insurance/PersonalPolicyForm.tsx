'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { collection, doc, getDocs, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { Loader2, Save } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { actorFromUser, withCreateAudit, withUpdateAudit } from '@/lib/audit-fields';
import type { Attachment, InsuranceCompany, InsurancePolicy, PolicyCategory, PolicyHolder } from '@/lib/types';
import {
  annualisedPremium,
  dayKey,
  firstInstalmentFrom,
  formatDay,
  formatInr,
  graceDays,
  intervalYears,
  MAX_INTERVAL_YEARS,
  multiYearFrequency,
  NOMINEE_RELATIONSHIPS,
  PERSONAL_LIFECYCLE,
  PREMIUM_FREQUENCIES,
  premiumSchedule,
  toDate,
  type PremiumFrequency,
} from '@/lib/insurance';
import { findDuplicatePolicy, PERSONAL_POLICIES, uploadInsuranceFiles } from '@/lib/insurance-service';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { AttachmentList, DateField, PendingFiles } from '@/components/insurance/insurance-ui';

const NONE = '__none__';
/** Select value for "Every N Years"; the N comes from `interval_years` and is folded into the stored frequency. */
const MULTI_YEAR = 'Multi-Year';
const FREQUENCY_CHOICES = [...PREMIUM_FREQUENCIES, MULTI_YEAR] as const;

const policySchema = z
  .object({
    insured_person: z.string().min(1, 'Select the insured person'),
    policy_no: z.string().trim().min(1, 'Policy number is required'),
    insurance_company: z.string().min(1, 'Select the insurance company'),
    policy_category: z.string().min(1, 'Select a category'),
    policy_name: z.string().trim().min(1, 'Plan / policy name is required'),
    status: z.enum(PERSONAL_LIFECYCLE),
    premium: z.coerce.number().min(0, 'Premium cannot be negative'),
    sum_insured: z.coerce.number().min(0, 'Sum assured cannot be negative'),
    payment_type: z.enum(FREQUENCY_CHOICES),
    interval_years: z.union([z.literal(''), z.coerce.number()]).optional(),
    tenure: z.coerce.number().int('Whole years only').min(0, 'Cannot be negative').max(100, 'Check the term'),
    policy_issue_date: z.date().optional(),
    date_of_comm: z.date().optional(),
    date_of_maturity: z.date().optional(),
    due_date: z.date().optional().nullable(),
    auto_debit: z.boolean(),
    grace_period_days: z.union([z.literal(''), z.coerce.number().int().min(0).max(365)]).optional(),
    nominee_name: z.string().optional(),
    nominee_relationship: z.string().optional(),
    agent_name: z.string().optional(),
    agent_contact: z.string().optional(),
    remarks: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.payment_type === MULTI_YEAR) {
      const n = Number(v.interval_years);
      if (v.interval_years === '' || !Number.isInteger(n) || n < 2 || n > MAX_INTERVAL_YEARS) {
        ctx.addIssue({ code: 'custom', path: ['interval_years'], message: `Whole years, 2 to ${MAX_INTERVAL_YEARS}` });
      }
    }
    if (v.payment_type !== 'One-Time' && v.tenure < 1) {
      ctx.addIssue({ code: 'custom', path: ['tenure'], message: 'Enter the premium-paying term in years' });
    }
    if (v.date_of_comm && v.date_of_maturity && v.date_of_maturity <= v.date_of_comm) {
      ctx.addIssue({ code: 'custom', path: ['date_of_maturity'], message: 'Maturity must be after commencement' });
    }
    if (v.policy_issue_date && v.date_of_comm && v.policy_issue_date > v.date_of_comm) {
      ctx.addIssue({ code: 'custom', path: ['policy_issue_date'], message: 'Issue date is after commencement' });
    }
  });

type FormValues = z.infer<typeof policySchema>;

/** The frequency as stored and as the schedule rules read it, e.g. "Every 5 Years". */
function frequencyOf(v: Pick<FormValues, 'payment_type' | 'interval_years'>): PremiumFrequency {
  if (v.payment_type !== MULTI_YEAR) return v.payment_type;
  const n = Number(v.interval_years);
  return Number.isInteger(n) && n >= 2 && n <= MAX_INTERVAL_YEARS ? multiYearFrequency(n) : 'Yearly';
}

const EMPTY: FormValues = {
  insured_person: '',
  policy_no: '',
  insurance_company: '',
  policy_category: '',
  policy_name: '',
  status: 'Active',
  premium: 0,
  sum_insured: 0,
  payment_type: 'Yearly',
  interval_years: '',
  tenure: 0,
  auto_debit: false,
  due_date: null,
  grace_period_days: '',
  nominee_name: '',
  nominee_relationship: '',
  agent_name: '',
  agent_contact: '',
  remarks: '',
};

function valuesFrom(policy: InsurancePolicy): FormValues {
  const everyYears = intervalYears(policy.payment_type);
  return {
    ...EMPTY,
    insured_person: policy.insured_person || '',
    policy_no: policy.policy_no || '',
    insurance_company: policy.insurance_company || '',
    policy_category: policy.policy_category || '',
    policy_name: policy.policy_name || '',
    status: policy.status || 'Active',
    premium: policy.premium || 0,
    sum_insured: policy.sum_insured || 0,
    payment_type: everyYears
      ? MULTI_YEAR
      : (PREMIUM_FREQUENCIES as readonly string[]).includes(policy.payment_type) ? (policy.payment_type as FormValues['payment_type']) : 'Yearly',
    interval_years: everyYears ?? '',
    tenure: policy.tenure || 0,
    policy_issue_date: toDate(policy.policy_issue_date) ?? undefined,
    date_of_comm: toDate(policy.date_of_comm) ?? undefined,
    date_of_maturity: toDate(policy.date_of_maturity) ?? undefined,
    due_date: toDate(policy.due_date),
    auto_debit: !!policy.auto_debit,
    grace_period_days: typeof policy.grace_period_days === 'number' ? policy.grace_period_days : '',
    nominee_name: policy.nominee_name || '',
    nominee_relationship: policy.nominee_relationship || '',
    agent_name: policy.agent_name || '',
    agent_contact: policy.agent_contact || '',
    remarks: policy.remarks || '',
  };
}

/** Keeps a stored value selectable even when its master record was renamed or deactivated. */
function withCurrent(names: string[], current: string): string[] {
  return current && !names.includes(current) ? [current, ...names] : names;
}

interface Props {
  /** The policy being edited; omitted when adding one. */
  policy?: InsurancePolicy;
}

/**
 * Add or edit a personal policy.
 *
 * The next due date is chosen from the premium schedule rather than calculated in an effect. The
 * effect this replaces re-ran whenever the form loaded, so merely opening an overdue policy for an
 * edit moved its due date to the next future instalment and silently wrote the unpaid premium off;
 * for a One-Time policy that had commenced it never terminated and froze the tab.
 */
export function PersonalPolicyForm({ policy }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const isEdit = !!policy;

  const [holders, setHolders] = useState<PolicyHolder[]>([]);
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [categories, setCategories] = useState<PolicyCategory[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>(policy?.attachments ?? []);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(policySchema),
    defaultValues: policy ? valuesFrom(policy) : EMPTY,
  });

  useEffect(() => {
    (async () => {
      try {
        const [h, c, k] = await Promise.all([
          getDocs(collection(db, 'policyHolders')),
          getDocs(query(collection(db, 'insuranceCompanies'), where('status', '==', 'Active'))),
          getDocs(query(collection(db, 'policyCategories'), where('status', '==', 'Active'))),
        ]);
        setHolders(h.docs.map((d) => ({ id: d.id, ...d.data() } as PolicyHolder)).sort((a, b) => a.name.localeCompare(b.name)));
        setCompanies(c.docs.map((d) => ({ id: d.id, ...d.data() } as InsuranceCompany)).sort((a, b) => a.name.localeCompare(b.name)));
        setCategories(k.docs.map((d) => ({ id: d.id, ...d.data() } as PolicyCategory)).sort((a, b) => a.name.localeCompare(b.name)));
      } catch (error) {
        console.error('Error loading insurance masters:', error);
        toast({ title: 'Error', description: 'Could not load holders, companies and categories.', variant: 'destructive' });
      }
    })();
  }, [toast]);

  const commencement = form.watch('date_of_comm');
  const frequencyChoice = form.watch('payment_type');
  const everyYears = form.watch('interval_years');
  const frequency = frequencyOf({ payment_type: frequencyChoice, interval_years: everyYears });
  const tenure = Number(form.watch('tenure')) || 0;
  const maturity = form.watch('date_of_maturity');
  const dueDate = form.watch('due_date');
  const premium = Number(form.watch('premium')) || 0;
  const graceOverride = form.watch('grace_period_days');

  const schedule = useMemo(() => {
    const all = premiumSchedule(commencement ?? null, frequency, tenure);
    return maturity ? all.filter((d) => d < maturity) : all;
  }, [commencement, frequency, tenure, maturity]);
  const lastPremium = schedule.length ? schedule[schedule.length - 1] : null;
  const suggestedDue = useMemo(() => firstInstalmentFrom(schedule), [schedule]);

  /** Called only from the inputs that shape the schedule, so loading a policy never moves its due date. */
  const resuggestDue = () => {
    queueMicrotask(() => {
      const v = form.getValues();
      const s = premiumSchedule(v.date_of_comm ?? null, frequencyOf(v), Number(v.tenure) || 0)
        .filter((d) => !v.date_of_maturity || d < v.date_of_maturity);
      const current = v.due_date ? dayKey(v.due_date) : null;
      if (!current || !s.some((d) => dayKey(d) === current)) form.setValue('due_date', firstInstalmentFrom(s));
    });
  };

  const holderNames = withCurrent(holders.map((h) => h.name), form.getValues('insured_person'));
  const companyNames = withCurrent(companies.map((c) => c.name), form.getValues('insurance_company'));
  const categoryNames = withCurrent(categories.map((c) => c.name), form.getValues('policy_category'));

  const onSubmit = async (data: FormValues) => {
    const actor = actorFromUser(user);
    if (!actor) {
      toast({ title: 'Not signed in', description: 'Sign in again to save.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const duplicate = await findDuplicatePolicy(PERSONAL_POLICIES, data.policy_no, data.insurance_company, policy?.id);
      if (duplicate) {
        form.setError('policy_no', { message: `This policy number is already recorded with ${data.insurance_company}.` });
        return;
      }

      const ref = policy ? doc(db, PERSONAL_POLICIES, policy.id) : doc(collection(db, PERSONAL_POLICIES));
      const uploaded = newFiles.length ? await uploadInsuranceFiles(`insurance-policies/${ref.id}`, newFiles) : [];
      const ts = (d: Date | null | undefined) => (d ? Timestamp.fromDate(d) : null);

      const record = {
        insured_person: data.insured_person,
        policy_no: data.policy_no.trim(),
        insurance_company: data.insurance_company,
        policy_category: data.policy_category,
        policy_name: data.policy_name.trim(),
        status: data.status,
        premium: data.premium,
        sum_insured: data.sum_insured,
        payment_type: frequencyOf(data),
        tenure: data.tenure,
        auto_debit: data.auto_debit,
        policy_issue_date: ts(data.policy_issue_date),
        date_of_comm: ts(data.date_of_comm),
        date_of_maturity: ts(data.date_of_maturity),
        last_premium_date: ts(lastPremium),
        due_date: data.status === 'Active' ? ts(data.due_date) : null,
        grace_period_days: data.grace_period_days === '' || data.grace_period_days === undefined ? null : Number(data.grace_period_days),
        nominee_name: data.nominee_name?.trim() || '',
        nominee_relationship: data.nominee_relationship || '',
        agent_name: data.agent_name?.trim() || '',
        agent_contact: data.agent_contact?.trim() || '',
        remarks: data.remarks?.trim() || '',
        attachments: [...attachments, ...uploaded],
      };

      if (policy) {
        await updateDoc(ref, { ...record, ...withUpdateAudit(actor) });
        toast({ title: 'Policy updated', description: `${record.policy_no} has been saved.` });
        router.push(`/insurance/personal/${policy.id}`);
      } else {
        await setDoc(ref, { ...record, ...withCreateAudit(actor) });
        toast({ title: 'Policy added', description: `${record.policy_no} is now being tracked.` });
        router.push(`/insurance/personal/${ref.id}`);
      }
    } catch (error) {
      console.error('Error saving policy:', error);
      toast({ title: 'Error', description: 'Failed to save the policy.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const status = form.watch('status');
  const submit = form.handleSubmit(onSubmit);

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title={isEdit ? 'Edit Insurance Policy' : 'Add Insurance Policy'}
        description={isEdit ? `${policy.policy_no} · ${policy.insured_person}` : 'Record a personal policy to track its premiums, maturity and documents.'}
        backHref={isEdit ? `/insurance/personal/${policy.id}` : '/insurance/personal'}
        backLabel={isEdit ? 'Back to policy' : 'Back to personal insurance'}
        actions={
          <Button type="button" onClick={submit} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {isEdit ? 'Save Changes' : 'Save Policy'}
          </Button>
        }
      />
      <Form {...form}>
        <form onSubmit={submit} className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Policy Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              <FormField control={form.control} name="insured_person" render={({ field }) => (
                <FormItem>
                  <FormLabel>Insured Person</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select a policy holder" /></SelectTrigger></FormControl>
                    <SelectContent>{holderNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                  {holderNames.length === 0 && <FormDescription>Add holders under Settings → Policy Holders.</FormDescription>}
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="policy_no" render={({ field }) => (
                <FormItem><FormLabel>Policy No.</FormLabel><FormControl><Input {...field} autoComplete="off" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="insurance_company" render={({ field }) => (
                <FormItem>
                  <FormLabel>Insurance Company</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select a company" /></SelectTrigger></FormControl>
                    <SelectContent>{companyNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="policy_category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Life, Health, Term…" /></SelectTrigger></FormControl>
                    <SelectContent>{categoryNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                  {categoryNames.length === 0 && <FormDescription>Add categories under Settings → Policy Category.</FormDescription>}
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="policy_name" render={({ field }) => (
                <FormItem><FormLabel>Plan / Policy Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="sum_insured" render={({ field }) => (
                <FormItem><FormLabel>Sum Assured (₹)</FormLabel><FormControl><Input type="number" inputMode="decimal" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Policy Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PERSONAL_LIFECYCLE.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormDescription>
                    {status === 'Active' ? 'Premiums are tracked and tasks raised.' : 'No further premiums are tracked for this policy.'}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Premium &amp; Term</CardTitle>
              <CardDescription>
                {premium > 0 && frequency !== 'One-Time'
                  ? `Yearly outgo ${formatInr(annualisedPremium(premium, frequency))}${intervalYears(frequency) ? ' (averaged)' : ''} · ${schedule.length} instalments`
                  : 'The schedule is built from commencement, frequency and term.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              <FormField control={form.control} name="premium" render={({ field }) => (
                <FormItem><FormLabel>Premium per Instalment (₹)</FormLabel><FormControl><Input type="number" inputMode="decimal" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="payment_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Premium Frequency</FormLabel>
                  <Select onValueChange={(v) => { field.onChange(v); resuggestDue(); }} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {PREMIUM_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f === 'One-Time' ? 'One-Time (single premium)' : f}</SelectItem>)}
                      <SelectItem value={MULTI_YEAR}>Every N Years (2, 3, 5…)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              {frequencyChoice === MULTI_YEAR && (
                <FormField control={form.control} name="interval_years" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pay Every (years)</FormLabel>
                    <FormControl>
                      <Input
                        type="number" inputMode="numeric" min={2} max={MAX_INTERVAL_YEARS} placeholder="e.g. 2, 3 or 5"
                        {...field} value={field.value ?? ''}
                        onChange={(e) => { field.onChange(e); resuggestDue(); }}
                      />
                    </FormControl>
                    <FormDescription>One premium every {Number(field.value) >= 2 ? `${field.value} years` : 'N years'}.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <FormField control={form.control} name="tenure" render={({ field }) => (
                <FormItem>
                  <FormLabel>Premium-Paying Term (years)</FormLabel>
                  <FormControl><Input type="number" inputMode="numeric" min={0} {...field} onChange={(e) => { field.onChange(e); resuggestDue(); }} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="policy_issue_date" render={({ field }) => (
                <FormItem className="flex flex-col"><FormLabel>Policy Issue Date</FormLabel><DateField value={field.value} onChange={field.onChange} /><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="date_of_comm" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date of Commencement</FormLabel>
                  <DateField value={field.value} onChange={(d) => { field.onChange(d); resuggestDue(); }} />
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="date_of_maturity" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date of Maturity</FormLabel>
                  <DateField value={field.value} onChange={(d) => { field.onChange(d); resuggestDue(); }} />
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="due_date" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Next Premium Due</FormLabel>
                  {schedule.length > 0 ? (
                    <Select
                      value={field.value ? dayKey(field.value) : NONE}
                      onValueChange={(v) => field.onChange(v === NONE ? null : [...schedule, ...(field.value ? [field.value] : [])].find((d) => dayKey(d) === v) ?? null)}
                      disabled={status !== 'Active'}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder="Select the unpaid instalment" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None — every premium is paid</SelectItem>
                        {/* A stored date off the schedule (older records) stays selectable rather than vanishing. */}
                        {field.value && !schedule.some((d) => dayKey(d) === dayKey(field.value!)) && (
                          <SelectItem value={dayKey(field.value)}>{formatDay(field.value)} (as recorded)</SelectItem>
                        )}
                        {schedule.map((d, i) => (
                          <SelectItem key={dayKey(d)} value={dayKey(d)}>
                            #{i + 1} · {formatDay(d)}{suggestedDue && dayKey(d) === dayKey(suggestedDue) ? ' (next)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <DateField value={field.value} onChange={(d) => field.onChange(d ?? null)} disabled={status !== 'Active'} placeholder="Set commencement & term first" />
                  )}
                  <FormDescription>
                    {isEdit ? 'Pick an earlier instalment if a premium is still unpaid.' : 'The first instalment not yet paid.'}
                    {dueDate && ` Grace: ${graceDays(frequency, graceOverride === '' || graceOverride === undefined ? null : Number(graceOverride))} days.`}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormItem className="flex flex-col">
                <FormLabel>Last Premium Date</FormLabel>
                <Input readOnly value={formatDay(lastPremium)} className="bg-muted/40" />
                <FormDescription>Final instalment of the term.</FormDescription>
              </FormItem>
              <FormField control={form.control} name="grace_period_days" render={({ field }) => (
                <FormItem>
                  <FormLabel>Grace Period (days)</FormLabel>
                  <FormControl><Input type="number" inputMode="numeric" min={0} placeholder={`Default ${graceDays(frequency)}`} {...field} value={field.value ?? ''} /></FormControl>
                  <FormDescription>Leave blank for the standard {graceDays(frequency)} days.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="auto_debit" render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-3 rounded-lg border p-3 md:mt-7">
                  <div><FormLabel>Auto Debit (NACH/ECS)</FormLabel><FormDescription>Premium is debited automatically.</FormDescription></div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Nominee &amp; Advisor</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
              <FormField control={form.control} name="nominee_name" render={({ field }) => (
                <FormItem><FormLabel>Nominee Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="nominee_relationship" render={({ field }) => (
                <FormItem>
                  <FormLabel>Relationship</FormLabel>
                  <Select onValueChange={(v) => field.onChange(v === NONE ? '' : v)} value={field.value || NONE}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Not specified</SelectItem>
                      {NOMINEE_RELATIONSHIPS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="agent_name" render={({ field }) => (
                <FormItem><FormLabel>Agent / Advisor</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="agent_contact" render={({ field }) => (
                <FormItem><FormLabel>Advisor Contact</FormLabel><FormControl><Input {...field} inputMode="tel" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="remarks" render={({ field }) => (
                <FormItem className="md:col-span-2 lg:col-span-4"><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Documents</CardTitle><CardDescription>Policy bond, proposal form, premium receipts.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {isEdit && <AttachmentList attachments={attachments} onRemove={(i) => setAttachments((a) => a.filter((_, j) => j !== i))} />}
              <Input
                id="attachments"
                type="file"
                multiple
                aria-label="Upload documents"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  setNewFiles((f) => [...f, ...picked]);
                  e.target.value = '';
                }}
              />
              <PendingFiles files={newFiles} onRemove={(i) => setNewFiles((f) => f.filter((_, j) => j !== i))} />
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}
