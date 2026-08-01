'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { addMonths } from 'date-fns';
import { addDoc, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { ArrowLeft, Calculator, Loader2, RotateCcw, Save, Send, ShieldAlert } from 'lucide-react';
import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import type { BankAccount, Project } from '@/lib/types';
import {
  DEFAULT_FD_SETTINGS,
  FD_COLLECTIONS,
  FD_PURPOSES,
  FD_TYPES,
  FD_SETTINGS_PATH,
  INTEREST_FREQUENCIES,
  INTEREST_METHODS,
  SOURCE_OF_FUNDS,
  blankFixedDeposit,
  calculateEligibleValue,
  calculateMaturity,
  financialYearForDate,
  formatFdCurrency,
  type FixedDeposit,
  type FixedDepositDraft,
  type FixedDepositSettings,
} from '@/lib/fixed-deposit';
import { submitFixedDepositForApproval } from '@/lib/fixed-deposit-service';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

const toTimestamp = (value: string) => Timestamp.fromDate(new Date(`${value}T12:00:00`));
const orgCode = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word[0]).join('').toUpperCase();
  return (initials.length >= 2 ? initials : name).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'ORG';
};

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card className="border-white/80 bg-white/90 shadow-sm"><CardHeader className="pb-4"><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</CardContent></Card>;
}

function Field({ label, required, helper, children, className = '' }: { label: string; required?: boolean; helper?: string; children: ReactNode; className?: string }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs font-medium text-slate-700">{label}{required && <span className="ml-0.5 text-rose-500">*</span>}</Label>{children}{helper && <p className="text-[11px] leading-snug text-muted-foreground">{helper}</p>}</div>;
}

export default function NewFixedDepositForm() {
  const router = useRouter();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const [settings, setSettings] = useState<FixedDepositSettings>(DEFAULT_FD_SETTINGS);
  const [draft, setDraft] = useState<FixedDepositDraft>(() => blankFixedDeposit());
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [existingDeposits, setExistingDeposits] = useState<FixedDeposit[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [adviceFile, setAdviceFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);

  const canAdd = can('Add', 'Fixed Deposit Management.FD Register');
  const organizationId = user?.organizationId || 'default';
  const organizationName = user?.organizationName || 'Default Organization';

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const [accountsSnap, projectsSnap, settingsSnap, depositsSnap] = await Promise.all([
          getDocs(collection(db, 'bankAccounts')),
          getDocs(collection(db, 'projects')),
          getDoc(doc(db, ...FD_SETTINGS_PATH)),
          getDocs(query(collection(db, FD_COLLECTIONS.deposits), where('organizationId', '==', organizationId))),
        ]);
        if (!active) return;
        const nextSettings = settingsSnap.exists() ? { ...DEFAULT_FD_SETTINGS, ...settingsSnap.data(), organizationId } as FixedDepositSettings : { ...DEFAULT_FD_SETTINGS, organizationId };
        setSettings(nextSettings);
        setDraft((current) => ({ ...blankFixedDeposit(nextSettings), holderName: current.holderName || organizationName }));
        setBankAccounts(accountsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as BankAccount)).filter((item) => item.status === 'Active'));
        setProjects(projectsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Project)).filter((item) => item.status === 'Active'));
        setExistingDeposits(depositsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FixedDeposit)).filter((item) => !item.isDeleted));
      } catch (error) {
        console.error('Unable to initialise new FD form', error);
        toast({ title: 'Unable to load form masters', description: 'Bank and project options could not be loaded.', variant: 'destructive' });
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [organizationId, organizationName, toast, user]);

  const selectedBank = useMemo(() => bankAccounts.find((item) => item.id === draft.bankId), [bankAccounts, draft.bankId]);
  const selectedProject = useMemo(() => projects.find((item) => item.id === draft.projectId), [draft.projectId, projects]);
  const holderSuggestions = useMemo(() => Array.from(new Set(existingDeposits.filter((fd) => fd.organizationId === organizationId).map((fd) => fd.holderName).filter(Boolean))).sort(), [existingDeposits, organizationId]);
  const calculation = useMemo(() => calculateMaturity({ principal: Number(draft.principalAmount), annualRate: Number(draft.interestRate), tenureDays: Number(draft.tenureDays) || undefined, tenureMonths: Number(draft.tenureMonths) || undefined, method: draft.interestCalculationMethod, frequency: draft.interestPaymentFrequency, manualMaturityAmount: Number(draft.maturityAmount), tdsPercentage: settings.tdsPercentage }), [draft.interestCalculationMethod, draft.interestPaymentFrequency, draft.interestRate, draft.maturityAmount, draft.principalAmount, draft.tenureDays, draft.tenureMonths, settings.tdsPercentage]);
  const eligibleValue = calculateEligibleValue(Number(draft.principalAmount), Number(draft.eligibleMarginPercentage));
  const referencePreview = `${settings.referencePrefix}/${orgCode(organizationName)}/${financialYearForDate(draft.valueDate)}/####`;

  const update = <K extends keyof FixedDepositDraft>(key: K, value: FixedDepositDraft[K]) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if ((key === 'valueDate' || key === 'tenureMonths') && next.valueDate && Number(next.tenureMonths) > 0 && Number(next.tenureDays) === 0) {
        next.maturityDate = addMonths(new Date(`${next.valueDate}T12:00:00`), Number(next.tenureMonths)).toISOString().slice(0, 10);
      }
      if (key === 'fdType') next.lienMarked = value === 'SECURITY';
      return next;
    });
  };

  const reset = () => { setDraft({ ...blankFixedDeposit(settings), holderName: organizationName }); setReceiptFile(null); setAdviceFile(null); };

  const validate = (mode: 'draft' | 'submit') => {
    if (!draft.bankId || !draft.fdNumber.trim() || !draft.holderName.trim() || !draft.valueDate || !draft.maturityDate || Number(draft.principalAmount) <= 0) return 'Bank, FD number, holder, value date, maturity date, and principal amount are required.';
    if (new Date(draft.maturityDate).getTime() <= new Date(draft.valueDate).getTime()) return 'Maturity date must be after the value date.';
    if (Number(draft.eligibleMarginPercentage) < 0 || Number(draft.eligibleMarginPercentage) > 100) return 'Eligibility percentage must be between 0 and 100.';
    const duplicate = existingDeposits.some((fd) => fd.organizationId === organizationId && (fd.bankId === draft.bankId || fd.bankName.toLowerCase() === (selectedBank?.bankName || '').toLowerCase()) && fd.fdNumber.trim().toLowerCase() === draft.fdNumber.trim().toLowerCase());
    if (duplicate) return 'This FD number already exists for the selected organization and bank.';
    if (mode === 'submit' && settings.requireFdReceipt && !receiptFile) return 'Upload the FD receipt before submitting for approval.';
    return '';
  };

  const upload = async (file: File, fdId: string, kind: string) => {
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const target = storageRef(storage, `fixed-deposits/${organizationId}/${fdId}/${kind}-${Date.now()}-${safeName}`);
    await uploadBytes(target, file);
    return getDownloadURL(target);
  };

  const save = async (mode: 'draft' | 'submit') => {
    const message = validate(mode);
    if (message) return toast({ title: 'Check FD details', description: message, variant: 'destructive' });
    if (!user || !selectedBank) return;
    setSaving(mode);
    try {
      const financialYear = financialYearForDate(draft.valueDate);
      const counterKey = `${organizationId}_${financialYear}`.replace(/[^A-Za-z0-9_-]/g, '_');
      const counterRef = doc(db, 'fdCounters', counterKey);
      const uniqueKey = `${organizationId}_${selectedBank.id}_${draft.fdNumber.trim().toLowerCase()}`.replace(/[^A-Za-z0-9_-]/g, '_');
      const uniqueRef = doc(db, 'fdUniqueKeys', uniqueKey);
      const newFdRef = doc(collection(db, FD_COLLECTIONS.deposits));
      let referenceNumber = '';
      await runTransaction(db, async (transaction) => {
        const [counter, unique] = await Promise.all([transaction.get(counterRef), transaction.get(uniqueRef)]);
        if (unique.exists()) throw new Error('This FD number already exists for the selected organization and bank.');
        const nextSequence = Number(counter.data()?.nextSequence || 1);
        referenceNumber = `${settings.referencePrefix}/${orgCode(organizationName)}/${financialYear}/${String(nextSequence).padStart(4, '0')}`;
        transaction.set(counterRef, { organizationId, financialYear, nextSequence: nextSequence + 1, updatedAt: Timestamp.now() }, { merge: true });
        transaction.set(uniqueRef, { organizationId, bankId: selectedBank.id, fdNumber: draft.fdNumber.trim(), fdId: newFdRef.id, createdAt: Timestamp.now() });
        const now = Timestamp.now();
        const payload: Omit<FixedDeposit, 'id'> = {
          organizationId, organizationName, referenceNumber, fdNumber: draft.fdNumber.trim(), bankId: selectedBank.id, bankName: selectedBank.bankName,
          branchId: selectedBank.id, branchName: selectedBank.branch || '', ifsc: selectedBank.ifsc || '', sourceAccountId: draft.sourceAccountId || selectedBank.id, sourceAccountNumber: selectedBank.accountNumber || '',
          projectId: selectedProject?.id || '', projectName: selectedProject?.projectName || '', holderName: draft.holderName.trim(), holderType: draft.holderType, jointHolderName: draft.jointHolderName.trim(), nomineeName: draft.nomineeName.trim(), pan: draft.pan.trim().toUpperCase(), beneficialOwner: draft.beneficialOwner.trim(),
          fdType: draft.fdType, depositCategory: draft.depositCategory.trim(), purpose: draft.purpose, sourceOfFunds: draft.sourceOfFunds, currency: draft.currency,
          principalAmount: Number(draft.principalAmount), interestRate: Number(draft.interestRate), interestCalculationMethod: draft.interestCalculationMethod, interestPaymentFrequency: draft.interestPaymentFrequency,
          tenureDays: Number(draft.tenureDays), tenureMonths: Number(draft.tenureMonths), creationDate: toTimestamp(draft.creationDate), valueDate: toTimestamp(draft.valueDate), maturityDate: toTimestamp(draft.maturityDate),
          expectedInterest: calculation.expectedInterest, maturityAmount: calculation.maturityAmount, expectedTds: calculation.expectedTds, expectedNetProceeds: calculation.expectedNetProceeds, interestReceived: 0, prematureClosurePenalty: Number(draft.prematureClosurePenalty),
          eligibleMarginPercentage: Number(draft.eligibleMarginPercentage), eligibleValue, bgUtilizedAmount: 0, lcUtilizedAmount: 0, reservedAmount: 0, totalUtilizedAmount: 0, availableAmount: eligibleValue,
          lienMarked: Boolean(draft.lienMarked), lienHolder: draft.lienHolder.trim(), lienDate: draft.lienDate ? toTimestamp(draft.lienDate) : null, lienAmount: Number(draft.lienAmount), lienPurpose: draft.lienPurpose.trim(), bankConfirmationReference: draft.bankConfirmationReference.trim(),
          autoRenewal: Boolean(draft.autoRenewal), status: 'DRAFT', renewalStatus: '', closureStatus: '', documentComplete: false,
          approvalStatus: 'DRAFT', approvalComments: '', workflowStage: 'DRAFT', remarks: draft.remarks.trim(), createdBy: user.id, createdByName: user.name, createdAt: now, updatedBy: user.id, updatedByName: user.name, updatedAt: now, isDeleted: false,
        };
        transaction.set(newFdRef, payload);
      });
      await addDoc(collection(db, FD_COLLECTIONS.audit), { organizationId, module: 'Fixed Deposit Management', recordType: 'FD', recordId: newFdRef.id, fdId: newFdRef.id, action: 'FD_CREATED', summary: `${referenceNumber} created as draft`, newValue: { fdNumber: draft.fdNumber.trim(), principalAmount: Number(draft.principalAmount) }, userId: user.id, userName: user.name, userRole: user.role || '', page: `/fixed-deposit/${newFdRef.id}`, createdAt: serverTimestamp() });
      const documents: Partial<FixedDeposit> = {};
      if (receiptFile) documents.fdReceiptUrl = await upload(receiptFile, newFdRef.id, 'fd-receipt');
      if (adviceFile) documents.bankAdviceUrl = await upload(adviceFile, newFdRef.id, 'bank-advice');
      if (documents.fdReceiptUrl || documents.bankAdviceUrl) await updateDoc(newFdRef, { ...documents, documentComplete: Boolean(documents.fdReceiptUrl) && (!settings.requireBankAdvice || Boolean(documents.bankAdviceUrl)), updatedAt: Timestamp.now() });
      if (documents.fdReceiptUrl && receiptFile) await addDoc(collection(db, FD_COLLECTIONS.documents), { organizationId, module: 'Fixed Deposit Management', fdId: newFdRef.id, documentType: 'FD_RECEIPT', fileName: receiptFile.name, fileUrl: documents.fdReceiptUrl, storagePath: '', version: 1, status: 'ACTIVE', uploadedBy: user.id, uploadedByName: user.name, uploadedAt: serverTimestamp() });
      if (documents.bankAdviceUrl && adviceFile) await addDoc(collection(db, FD_COLLECTIONS.documents), { organizationId, module: 'Fixed Deposit Management', fdId: newFdRef.id, documentType: 'BANK_DEBIT_ADVICE', fileName: adviceFile.name, fileUrl: documents.bankAdviceUrl, storagePath: '', version: 1, status: 'ACTIVE', uploadedBy: user.id, uploadedByName: user.name, uploadedAt: serverTimestamp() });
      if (mode === 'submit') await submitFixedDepositForApproval(newFdRef.id, { userId: user.id, userName: user.name, role: user.role, organizationId, organizationName });
      toast({ title: mode === 'submit' ? 'FD submitted for approval' : 'FD draft saved', description: `${referenceNumber} has been created successfully.` });
      router.push(mode === 'submit' ? '/fixed-deposit/approvals' : '/fixed-deposit/register');
    } catch (error) {
      console.error('Unable to save FD', error);
      toast({ title: 'Unable to save FD', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally { setSaving(null); }
  };

  if (authLoading || loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canAdd) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to create fixed deposits.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><Button asChild variant="ghost" size="icon"><Link href="/fixed-deposit"><ArrowLeft className="h-5 w-5" /></Link></Button><div><h1 className="text-2xl font-bold tracking-tight">Create New FD</h1><p className="text-sm text-muted-foreground">Create any supported fixed deposit type with financial, lien and document controls.</p></div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={reset} disabled={Boolean(saving)}><RotateCcw className="mr-2 h-4 w-4" />Reset</Button><Button variant="outline" onClick={() => void save('draft')} disabled={Boolean(saving)}>{saving === 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Draft</Button><Button onClick={() => void save('submit')} disabled={Boolean(saving)} className="bg-gradient-to-r from-cyan-600 to-blue-700">{saving === 'submit' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Submit for Approval</Button></div></div>

    <Section title="7.1 Basic Information" description="Organization, ownership, bank, and bank-issued FD identification.">
      <Field label="Organization" required><Input value={organizationName} readOnly className="bg-slate-50" /></Field>
      <Field label="FD Reference Number" required helper="System-generated when the record is saved."><Input value={referencePreview} readOnly className="bg-slate-50 font-mono text-xs" /></Field>
      <Field label="FD Type" required><Select value={draft.fdType} onValueChange={(value) => update('fdType', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{FD_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Bank" required><Select value={draft.bankId} onValueChange={(value) => { update('bankId', value); update('sourceAccountId', value); }}><SelectTrigger><SelectValue placeholder="Select issuing bank" /></SelectTrigger><SelectContent>{bankAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.bankName} · {account.branch || account.shortName}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Branch" required><Input value={selectedBank?.branch || ''} readOnly placeholder="Populated from bank" className="bg-slate-50" /></Field>
      <Field label="FD Number" required><Input value={draft.fdNumber} onChange={(event) => update('fdNumber', event.target.value)} placeholder="Bank-issued FD / receipt number" /></Field>
      <Field label="FD Holder" required><Input list="fd-holder-options" value={draft.holderName} onChange={(event) => update('holderName', event.target.value)} placeholder="Legal holder name" /><datalist id="fd-holder-options">{holderSuggestions.map((holder) => <option key={holder} value={holder} />)}</datalist></Field>
      <Field label="Holder Type"><Select value={draft.holderType} onValueChange={(value) => update('holderType', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Organization', 'Individual', 'Joint', 'Project'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Project"><Select value={draft.projectId || 'none'} onValueChange={(value) => update('projectId', value === 'none' ? '' : value)}><SelectTrigger><SelectValue placeholder="No project / unassigned" /></SelectTrigger><SelectContent><SelectItem value="none">No project / unassigned</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="FD Purpose" required><Select value={draft.purpose} onValueChange={(value) => update('purpose', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{FD_PURPOSES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Source of Funds"><Select value={draft.sourceOfFunds} onValueChange={(value) => update('sourceOfFunds', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SOURCE_OF_FUNDS.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Remarks" className="sm:col-span-2 xl:col-span-3"><Textarea value={draft.remarks} onChange={(event) => update('remarks', event.target.value)} placeholder="Optional notes, purpose details, or bank instructions" rows={3} /></Field>
    </Section>

    <Section title="Deposit and Maturity" description="Principal, tenure, deposit dates, and maturity terms.">
      <Field label="Principal Amount" required><Input type="number" min="0" step="0.01" value={draft.principalAmount || ''} onChange={(event) => update('principalAmount', Number(event.target.value))} /></Field>
      <Field label="Currency" required><Select value={draft.currency} onValueChange={(value) => update('currency', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['INR', 'USD', 'EUR', 'GBP', 'AED'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Creation Date" required><Input type="date" value={draft.creationDate} onChange={(event) => update('creationDate', event.target.value)} /></Field>
      <Field label="Value / Deposit Date" required><Input type="date" value={draft.valueDate} onChange={(event) => update('valueDate', event.target.value)} /></Field>
      <Field label="Tenure (Months)"><Input type="number" min="0" value={draft.tenureMonths || ''} onChange={(event) => update('tenureMonths', Number(event.target.value))} /></Field>
      <Field label="Tenure (Days)" helper="Use days for exact short-term tenure; it takes precedence over months."><Input type="number" min="0" value={draft.tenureDays || ''} onChange={(event) => update('tenureDays', Number(event.target.value))} /></Field>
      <Field label="Maturity Date" required><Input type="date" value={draft.maturityDate} onChange={(event) => update('maturityDate', event.target.value)} /></Field>
      <Field label="Auto Renewal"><div className="flex h-10 items-center gap-3 rounded-md border bg-white px-3"><Switch checked={draft.autoRenewal} onCheckedChange={(checked) => update('autoRenewal', checked)} /><span className="text-sm">{draft.autoRenewal ? 'Enabled' : 'Disabled'}</span></div></Field>
      <Field label="Premature Closure Penalty %"><Input type="number" min="0" step="0.01" value={draft.prematureClosurePenalty || ''} onChange={(event) => update('prematureClosurePenalty', Number(event.target.value))} /></Field>
    </Section>

    <Section title="Interest and Eligibility" description="Interest projection and value eligible for BG/LC assignment.">
      <Field label="Interest Rate (% p.a.)" required><Input type="number" min="0" step="0.01" value={draft.interestRate || ''} onChange={(event) => update('interestRate', Number(event.target.value))} /></Field>
      <Field label="Calculation Method"><Select value={draft.interestCalculationMethod} onValueChange={(value) => update('interestCalculationMethod', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{INTEREST_METHODS.map((value) => <SelectItem key={value} value={value}>{value.replaceAll('_', ' ')}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Interest Frequency"><Select value={draft.interestPaymentFrequency} onValueChange={(value) => update('interestPaymentFrequency', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{INTEREST_FREQUENCIES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
      {(draft.interestCalculationMethod === 'MANUAL' || draft.interestCalculationMethod === 'BANK_PROVIDED') && <Field label="Bank-provided Maturity Amount"><Input type="number" min="0" step="0.01" value={draft.maturityAmount || ''} onChange={(event) => update('maturityAmount', Number(event.target.value))} /></Field>}
      <Field label="Eligibility Percentage" required helper="Haircut is automatically reflected in eligible value."><Input type="number" min="0" max="100" step="0.01" value={draft.eligibleMarginPercentage} onChange={(event) => update('eligibleMarginPercentage', Number(event.target.value))} /></Field>
      <div className="sm:col-span-2 xl:col-span-3 rounded-xl border border-cyan-100 bg-gradient-to-r from-cyan-50 to-blue-50 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyan-900"><Calculator className="h-4 w-4" />Calculated values</div><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[['Expected Interest', calculation.expectedInterest], ['Maturity Amount', calculation.maturityAmount], ['Expected TDS', calculation.expectedTds], ['Eligible FD Value', eligibleValue]].map(([label, value]) => <div key={String(label)}><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 font-semibold">{formatFdCurrency(Number(value), draft.currency)}</p></div>)}</div></div>
    </Section>

    {draft.fdType === 'SECURITY' && <Section title="Security and Lien Details" description="Capture the lien placed on a Security FD.">
      <Field label="Lien Marked"><div className="flex h-10 items-center gap-3 rounded-md border bg-white px-3"><Switch checked={draft.lienMarked} onCheckedChange={(checked) => update('lienMarked', checked)} /><span className="text-sm">{draft.lienMarked ? 'Yes' : 'No'}</span></div></Field>
      <Field label="Lien Holder"><Input value={draft.lienHolder} onChange={(event) => update('lienHolder', event.target.value)} /></Field>
      <Field label="Lien Date"><Input type="date" value={draft.lienDate} onChange={(event) => update('lienDate', event.target.value)} /></Field>
      <Field label="Lien Amount"><Input type="number" min="0" step="0.01" value={draft.lienAmount || ''} onChange={(event) => update('lienAmount', Number(event.target.value))} /></Field>
      <Field label="Lien Purpose"><Input value={draft.lienPurpose} onChange={(event) => update('lienPurpose', event.target.value)} /></Field>
      <Field label="Bank Confirmation Reference"><Input value={draft.bankConfirmationReference} onChange={(event) => update('bankConfirmationReference', event.target.value)} /></Field>
    </Section>}

    <Section title="Supporting Documents" description="Attach the bank-issued receipt and advice for verification.">
      <Field label="FD Receipt" required={settings.requireFdReceipt}><Input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} /><p className="text-[11px] text-muted-foreground">{receiptFile?.name || 'PDF or image'}</p></Field>
      <Field label="Bank Advice" required={settings.requireBankAdvice}><Input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => setAdviceFile(event.target.files?.[0] || null)} /><p className="text-[11px] text-muted-foreground">{adviceFile?.name || 'PDF or image'}</p></Field>
      <div className="hidden xl:block" />
    </Section>

    <Separator />
    <div className="flex flex-col-reverse justify-between gap-3 sm:flex-row sm:items-center"><p className="text-xs text-muted-foreground"><span className="text-rose-500">*</span> Required fields must be completed before submission.</p><div className="flex gap-2"><Button variant="outline" asChild><Link href="/fixed-deposit">Cancel</Link></Button><Button variant="outline" onClick={() => void save('draft')} disabled={Boolean(saving)}><Save className="mr-2 h-4 w-4" />Save Draft</Button><Button onClick={() => void save('submit')} disabled={Boolean(saving)} className="bg-gradient-to-r from-cyan-600 to-blue-700"><Send className="mr-2 h-4 w-4" />Submit for Approval</Button></div></div>
  </div>;
}
