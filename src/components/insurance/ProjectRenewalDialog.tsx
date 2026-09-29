'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, query, runTransaction, Timestamp, where } from 'firebase/firestore';
import { addDays } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { actorFromUser, withUpdateAudit } from '@/lib/audit-fields';
import type { InsuranceCompany, ProjectInsurancePolicy } from '@/lib/types';
import { coverEndDate, dayKey, formatDay, formatInr, toDate } from '@/lib/insurance';
import { completeTasksForDue, PROJECT_POLICIES, uploadInsuranceFiles } from '@/lib/insurance-service';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateField, PendingFiles } from '@/components/insurance/insurance-ui';

interface ProjectRenewalDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  policy: ProjectInsurancePolicy;
  onSuccess: () => void;
}

/**
 * Renew a project policy for a new period.
 *
 * The outgoing period is archived to the policy's history and the policy document takes the new
 * period's terms. A renewal also puts the policy back to Active — a policy stored as Expired used to
 * stay Expired after renewal — and closes the task raised for the expiry it answers. The insurer can
 * change at renewal, as it often does when cover is re-quoted.
 */
export function ProjectRenewalDialog({ isOpen, onOpenChange, policy, onSuccess }: ProjectRenewalDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [companies, setCompanies] = useState<string[]>([]);
  const [renewalCopy, setRenewalCopy] = useState<File[]>([]);

  const oldEnd = toDate(policy.insured_until);
  const [policyNo, setPolicyNo] = useState('');
  const [company, setCompany] = useState('');
  const [premium, setPremium] = useState('');
  const [sumInsured, setSumInsured] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [years, setYears] = useState('1');
  const [months, setMonths] = useState('0');

  useEffect(() => {
    if (!isOpen) return;
    setPolicyNo(policy.policy_no);
    setCompany(policy.insurance_company);
    setPremium(String(policy.premium ?? ''));
    setSumInsured(String(policy.sum_insured ?? ''));
    setStartDate(oldEnd ? addDays(oldEnd, 1) : new Date());
    setYears(String(policy.tenure_years || (policy.tenure_months ? 0 : 1)));
    setMonths(String(policy.tenure_months || 0));
    setRenewalCopy([]);
    getDocs(query(collection(db, 'insuranceCompanies'), where('status', '==', 'Active')))
      .then((snap) => setCompanies(snap.docs.map((d) => (d.data() as InsuranceCompany).name).sort()))
      .catch(() => setCompanies([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, policy.id]);

  const y = Number(years) || 0;
  const m = Number(months) || 0;
  const newEnd = useMemo(() => (startDate ? coverEndDate(startDate, y, m) ?? undefined : undefined), [startDate, y, m]);
  const companyOptions = company && !companies.includes(company) ? [company, ...companies] : companies;

  const handleSave = async () => {
    const actor = actorFromUser(user);
    const prem = Number(premium);
    const sum = Number(sumInsured);
    if (!user || !actor) {
      toast({ title: 'Not signed in', description: 'Sign in again to renew.', variant: 'destructive' });
      return;
    }
    if (!policyNo.trim() || !company || !startDate || !newEnd || !Number.isFinite(prem) || prem < 0 || !Number.isFinite(sum) || sum < 0 || m > 11) {
      toast({ title: 'Missing details', description: 'Enter the policy number, insurer, premium, sum insured and a period (months 0–11).', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const [copy] = renewalCopy.length ? await uploadInsuranceFiles(`project-renewals/${policy.id}`, renewalCopy) : [];
      const policyRef = doc(db, PROJECT_POLICIES, policy.id);

      await runTransaction(db, async (tx) => {
        const fresh = await tx.get(policyRef);
        const freshEnd = toDate(fresh.data()?.insured_until);
        if (!fresh.exists() || (oldEnd && freshEnd && dayKey(freshEnd) !== dayKey(oldEnd))) throw new Error('ALREADY_RENEWED');

        tx.set(doc(collection(db, PROJECT_POLICIES, policy.id, 'history')), {
          renewalDate: Timestamp.now(),
          renewedBy: user.id,
          renewedByName: user.name ?? null,
          policyNo: policy.policy_no,
          insuranceCompany: policy.insurance_company,
          premium: policy.premium,
          sumInsured: policy.sum_insured,
          startDate: policy.insurance_start_date,
          endDate: policy.insured_until,
          renewalCopyUrl: copy?.url ?? null,
        });
        tx.update(policyRef, {
          policy_no: policyNo.trim(),
          insurance_company: company,
          premium: prem,
          sum_insured: sum,
          insurance_start_date: Timestamp.fromDate(startDate),
          insured_until: Timestamp.fromDate(newEnd),
          tenure_years: y,
          tenure_months: m,
          status: 'Active',
          ...(copy ? { attachments: [...(policy.attachments ?? []), { name: `Renewal ${formatDay(startDate)} — ${copy.name}`, url: copy.url }] } : {}),
          ...withUpdateAudit(actor),
        });
      });

      if (oldEnd) {
        await completeTasksForDue(policy.id, oldEnd, user, `Renewed to ${formatDay(newEnd)} at ${formatInr(prem)}.`)
          .catch((e) => console.warn('Renewal saved, but its task could not be closed:', e));
      }

      toast({ title: 'Policy renewed', description: `Cover now runs to ${formatDay(newEnd)}.` });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      const already = error instanceof Error && error.message === 'ALREADY_RENEWED';
      console.error('Error renewing policy:', error);
      toast({
        title: already ? 'Already renewed' : 'Error',
        description: already ? 'Someone has renewed this policy meanwhile. Refresh to see the latest.' : 'Failed to renew the policy.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isSaving && onOpenChange(open)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Renew Project Policy</DialogTitle>
          <DialogDescription>
            {policy.assetName} · {policy.policy_category} · current cover ends {formatDay(oldEnd)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="renew-no">New Policy No.</Label>
            <Input id="renew-no" value={policyNo} onChange={(e) => setPolicyNo(e.target.value)} disabled={isSaving} />
          </div>
          <div className="space-y-2">
            <Label>Insurer</Label>
            <Select value={company} onValueChange={setCompany} disabled={isSaving}>
              <SelectTrigger aria-label="Insurer"><SelectValue placeholder="Select insurer" /></SelectTrigger>
              <SelectContent>{companyOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="renew-premium">Premium (₹)</Label>
            <Input id="renew-premium" type="number" inputMode="decimal" min={0} value={premium} onChange={(e) => setPremium(e.target.value)} disabled={isSaving} />
            {Number(premium) > 0 && policy.premium > 0 && (
              <p className="text-xs text-muted-foreground">
                {Number(premium) >= policy.premium ? '+' : ''}
                {(((Number(premium) - policy.premium) / policy.premium) * 100).toFixed(1)}% vs {formatInr(policy.premium)}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="renew-sum">Sum Insured (₹)</Label>
            <Input id="renew-sum" type="number" inputMode="decimal" min={0} value={sumInsured} onChange={(e) => setSumInsured(e.target.value)} disabled={isSaving} />
          </div>
          <div className="space-y-2">
            <Label>New Start Date</Label>
            <DateField value={startDate} onChange={setStartDate} disabled={isSaving} />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="renew-years">Years</Label>
              <Input id="renew-years" type="number" inputMode="numeric" min={0} value={years} onChange={(e) => setYears(e.target.value)} disabled={isSaving} />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="renew-months">Months</Label>
              <Input id="renew-months" type="number" inputMode="numeric" min={0} max={11} value={months} onChange={(e) => setMonths(e.target.value)} disabled={isSaving} />
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Cover Until</Label>
            <Input value={newEnd ? formatDay(newEnd) : '—'} readOnly className="bg-muted/40" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="renew-copy">Renewed Policy Copy</Label>
            <Input id="renew-copy" type="file" onChange={(e) => { setRenewalCopy(Array.from(e.target.files ?? []).slice(0, 1)); e.target.value = ''; }} disabled={isSaving} />
            <PendingFiles files={renewalCopy} onRemove={() => setRenewalCopy([])} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Renewal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
