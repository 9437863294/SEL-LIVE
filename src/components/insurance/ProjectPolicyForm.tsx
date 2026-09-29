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
import type { Attachment, InsuranceCompany, InsuredAsset, PolicyCategory, ProjectInsurancePolicy } from '@/lib/types';
import { coverEndDate, formatDay, PROJECT_LIFECYCLE, toDate } from '@/lib/insurance';
import { findDuplicatePolicy, PROJECT_POLICIES, uploadInsuranceFiles } from '@/lib/insurance-service';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { AttachmentList, DateField, PendingFiles } from '@/components/insurance/insurance-ui';

const schema = z
  .object({
    assetId: z.string().min(1, 'Select the project or property'),
    policy_no: z.string().trim().min(1, 'Policy number is required'),
    insurance_company: z.string().min(1, 'Select the insurance company'),
    policy_category: z.string().min(1, 'Select a policy category'),
    premium: z.coerce.number().min(0, 'Premium cannot be negative'),
    sum_insured: z.coerce.number().min(0, 'Sum insured cannot be negative'),
    insurance_start_date: z.date({ required_error: 'A start date is required.' }),
    tenure_years: z.coerce.number().int().min(0).max(50),
    tenure_months: z.coerce.number().int().min(0).max(11, 'Use 0–11; add whole years above'),
    status: z.enum(PROJECT_LIFECYCLE),
    broker_name: z.string().optional(),
    remarks: z.string().optional(),
  })
  .refine((v) => v.tenure_years > 0 || v.tenure_months > 0, { path: ['tenure_years'], message: 'Enter the policy period' });

type FormValues = z.infer<typeof schema>;

interface Props {
  policy?: ProjectInsurancePolicy;
  /** Pre-selects the asset when adding from an asset's page. */
  defaultAssetId?: string;
}

/** Add or edit a project/property policy. Its cover end date is derived, never typed. */
export function ProjectPolicyForm({ policy, defaultAssetId }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const isEdit = !!policy;

  const [assets, setAssets] = useState<InsuredAsset[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>(policy?.attachments ?? []);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: policy
      ? {
          assetId: policy.assetId,
          policy_no: policy.policy_no,
          insurance_company: policy.insurance_company,
          policy_category: policy.policy_category,
          premium: policy.premium || 0,
          sum_insured: policy.sum_insured || 0,
          insurance_start_date: toDate(policy.insurance_start_date) ?? undefined,
          tenure_years: policy.tenure_years || 0,
          tenure_months: policy.tenure_months || 0,
          status: policy.status || 'Active',
          broker_name: policy.broker_name || '',
          remarks: policy.remarks || '',
        }
      : {
          assetId: defaultAssetId || '',
          policy_no: '',
          insurance_company: '',
          policy_category: '',
          premium: 0,
          sum_insured: 0,
          tenure_years: 1,
          tenure_months: 0,
          status: 'Active',
          broker_name: '',
          remarks: '',
        },
  });

  useEffect(() => {
    (async () => {
      try {
        const [a, c, k] = await Promise.all([
          getDocs(collection(db, 'insuredAssets')),
          getDocs(query(collection(db, 'insuranceCompanies'), where('status', '==', 'Active'))),
          getDocs(query(collection(db, 'policyCategories'), where('status', '==', 'Active'))),
        ]);
        const all = a.docs.map((d) => ({ id: d.id, ...d.data() } as InsuredAsset));
        // Inactive assets stay selectable only for the policy that already points at them.
        setAssets(all.filter((x) => x.status === 'Active' || x.id === policy?.assetId).sort((x, y) => x.name.localeCompare(y.name)));
        setCompanies(c.docs.map((d) => (d.data() as InsuranceCompany).name).sort());
        setCategories(k.docs.map((d) => (d.data() as PolicyCategory).name).sort());
      } catch (error) {
        console.error('Error loading insurance masters:', error);
        toast({ title: 'Error', description: 'Could not load assets, companies and categories.', variant: 'destructive' });
      }
    })();
  }, [policy?.assetId, toast]);

  const start = form.watch('insurance_start_date');
  const years = Number(form.watch('tenure_years')) || 0;
  const months = Number(form.watch('tenure_months')) || 0;
  const insuredUntil = useMemo(() => (start ? coverEndDate(start, years, months) : null), [start, years, months]);

  const keep = (list: string[], current: string) => (current && !list.includes(current) ? [current, ...list] : list);
  const companyOptions = keep(companies, form.getValues('insurance_company'));
  const categoryOptions = keep(categories, form.getValues('policy_category'));

  const onSubmit = async (data: FormValues) => {
    const actor = actorFromUser(user);
    if (!actor) {
      toast({ title: 'Not signed in', description: 'Sign in again to save.', variant: 'destructive' });
      return;
    }
    const asset = assets.find((a) => a.id === data.assetId);
    if (!asset) {
      form.setError('assetId', { message: 'Selected asset not found.' });
      return;
    }
    setIsSaving(true);
    try {
      if (await findDuplicatePolicy(PROJECT_POLICIES, data.policy_no, data.insurance_company, policy?.id)) {
        form.setError('policy_no', { message: `This policy number is already recorded with ${data.insurance_company}.` });
        return;
      }
      const ref = policy ? doc(db, PROJECT_POLICIES, policy.id) : doc(collection(db, PROJECT_POLICIES));
      const uploaded = newFiles.length ? await uploadInsuranceFiles(`project-insurance/${ref.id}`, newFiles) : [];
      const record = {
        assetId: asset.id,
        assetName: asset.name,
        assetType: asset.type,
        policy_no: data.policy_no.trim(),
        insurance_company: data.insurance_company,
        policy_category: data.policy_category,
        premium: data.premium,
        sum_insured: data.sum_insured,
        insurance_start_date: Timestamp.fromDate(data.insurance_start_date),
        insured_until: insuredUntil ? Timestamp.fromDate(insuredUntil) : null,
        tenure_years: data.tenure_years,
        tenure_months: data.tenure_months,
        status: data.status,
        broker_name: data.broker_name?.trim() || '',
        remarks: data.remarks?.trim() || '',
        attachments: [...attachments, ...uploaded],
      };
      if (policy) {
        await updateDoc(ref, { ...record, ...withUpdateAudit(actor) });
        toast({ title: 'Policy updated', description: `${record.policy_no} has been saved.` });
      } else {
        await setDoc(ref, { ...record, ...withCreateAudit(actor) });
        toast({ title: 'Policy added', description: `${record.policy_no} is now being tracked.` });
      }
      router.push(`/insurance/project/${asset.id}`);
    } catch (error) {
      console.error('Error saving project policy:', error);
      toast({ title: 'Error', description: 'Failed to save the policy.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const submit = form.handleSubmit(onSubmit);
  const backHref = policy ? `/insurance/project/${policy.assetId}` : defaultAssetId ? `/insurance/project/${defaultAssetId}` : '/insurance/project';

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title={isEdit ? 'Edit Project Insurance Policy' : 'Add Project Insurance Policy'}
        description={isEdit ? `${policy.policy_no} · ${policy.assetName}` : 'Cover for a project site or property — CAR/EAR, fire, WC, liability and more.'}
        backHref={backHref}
        backLabel="Back"
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
              <FormField control={form.control} name="assetId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Project / Property</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select project or property" /></SelectTrigger></FormControl>
                    <SelectContent>{assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}</SelectContent>
                  </Select>
                  {assets.length === 0 && <FormDescription>Add assets under Settings → Projects &amp; Properties.</FormDescription>}
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
                    <SelectContent>{companyOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="policy_category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Policy Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger></FormControl>
                    <SelectContent>{categoryOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="premium" render={({ field }) => (
                <FormItem><FormLabel>Premium (₹, incl. GST)</FormLabel><FormControl><Input type="number" inputMode="decimal" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="sum_insured" render={({ field }) => (
                <FormItem><FormLabel>Sum Insured (₹)</FormLabel><FormControl><Input type="number" inputMode="decimal" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="broker_name" render={({ field }) => (
                <FormItem><FormLabel>Broker / Agent</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PROJECT_LIFECYCLE.map((s) => <SelectItem key={s} value={s}>{s === 'Close' ? 'Closed' : s}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormDescription>Expiry is worked out from the dates; set Closed or Not Required to stop tracking.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Policy Period</CardTitle><CardDescription>Cover runs to the day before the anniversary.</CardDescription></CardHeader>
            <CardContent className="grid grid-cols-1 items-start gap-5 md:grid-cols-3">
              <FormField control={form.control} name="insurance_start_date" render={({ field }) => (
                <FormItem className="flex flex-col"><FormLabel>Start Date</FormLabel><DateField value={field.value} onChange={field.onChange} /><FormMessage /></FormItem>
              )} />
              <div className="flex items-start gap-2">
                <FormField control={form.control} name="tenure_years" render={({ field }) => (
                  <FormItem className="flex-1"><FormLabel>Years</FormLabel><FormControl><Input type="number" inputMode="numeric" min={0} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="tenure_months" render={({ field }) => (
                  <FormItem className="flex-1"><FormLabel>Months</FormLabel><FormControl><Input type="number" inputMode="numeric" min={0} max={11} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormItem className="flex flex-col">
                <FormLabel>Insured Until</FormLabel>
                <Input readOnly value={formatDay(insuredUntil)} className="bg-muted/40" />
              </FormItem>
              <FormField control={form.control} name="remarks" render={({ field }) => (
                <FormItem className="md:col-span-3"><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={2} placeholder="Deductibles, add-on covers, endorsements…" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Documents</CardTitle><CardDescription>Policy schedule, endorsements, premium receipt.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {isEdit && <AttachmentList attachments={attachments} onRemove={(i) => setAttachments((a) => a.filter((_, j) => j !== i))} />}
              <Input
                type="file"
                multiple
                aria-label="Upload documents"
                onChange={(e) => { const picked = Array.from(e.target.files ?? []); setNewFiles((f) => [...f, ...picked]); e.target.value = ''; }}
              />
              <PendingFiles files={newFiles} onRemove={(i) => setNewFiles((f) => f.filter((_, j) => j !== i))} />
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}
