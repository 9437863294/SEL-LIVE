'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowLeft, Calculator, Loader2, Save, Send, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { createLCRequest, submitLCRequest, type LCActor, type LCRequestInput } from '@/lib/letter-of-credit-service';
import { LC_DUE_DATE_BASES, LC_MARGIN_TYPES, LC_PERMISSION_MODULE, LC_TYPES, calculateRequiredMargin, formatLcCurrency } from '@/lib/letter-of-credit';
import { RP_COLLECTIONS } from '@/lib/recurring-payments';
import type { BankAccount, Project } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type Draft = LCRequestInput & { vendorText: string };
type VendorRecord = { id: string; name: string; code?: string; status?: string };

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const blank = (): Draft => ({
  departmentId: '', departmentName: '', projectId: '', projectName: '', vendorId: '', vendorName: '', vendorText: '', vendorCode: '', purchaseOrderId: '', purchaseOrderNumber: '', purchaseOrderAmount: 0, existingLcAmount: 0, contractReference: '', purpose: '', materialDescription: '', lcType: 'INLAND', currency: 'INR', requestedAmount: 0, requiredOpeningDate: today(), proposedExpiryDate: plusDays(180), latestShipmentDate: plusDays(150), sightOrUsance: 'USANCE', usancePeriodDays: 90, dueDateBasis: 'HUNDI_ACCEPTANCE_DATE', partialShipmentAllowed: true, transshipmentAllowed: false, partialDrawingAllowed: true, tolerancePercentage: 0, presentationPeriodDays: 21, incoterm: '', specialConditions: '', preferredBankId: '', preferredBankName: '', marginType: 'FD', marginPercentage: 15, fdMarginAmount: 0, cashMarginAmount: 0, otherCollateralAmount: 0, estimatedCommission: 0, estimatedCharges: 0, clientRecoverable: false, expectedRecoverableAmount: 0, remarks: '',
});

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card className="border-white/80 bg-white/90 shadow-sm"><CardHeader className="pb-4"><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</CardContent></Card>;
}

function Field({ label, required, helper, children, wide = false }: { label: string; required?: boolean; helper?: string; children: ReactNode; wide?: boolean }) {
  return <div className={`space-y-1.5 ${wide ? 'sm:col-span-2 xl:col-span-3' : ''}`}><Label className="text-xs font-medium text-slate-700">{label}{required && <span className="ml-0.5 text-rose-500">*</span>}</Label>{children}{helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}</div>;
}

export default function NewLCRequestForm() {
  const router = useRouter();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => blank());
  const [projects, setProjects] = useState<Project[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const canAdd = can('Add', `${LC_PERMISSION_MODULE}.LC Requests`);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getDocs(collection(db, 'projects')),
      getDocs(collection(db, 'bankAccounts')),
      getDocs(collection(db, RP_COLLECTIONS.vendors)),
    ]).then(([projectSnapshot, bankSnapshot, vendorSnapshot]) => {
      if (!active) return;
      setProjects(projectSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Project)).filter((item) => item.status === 'Active'));
      setBanks(bankSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as BankAccount)).filter((item) => item.status === 'Active'));
      setVendors(vendorSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as VendorRecord)).filter((item) => !item.status || item.status === 'Active'));
    }).catch((error) => { console.error('Unable to load LC request masters', error); toast({ title: 'Some LC masters could not be loaded', description: 'You may still enter the vendor and purchase-order references manually.', variant: 'destructive' }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [toast]);

  const requiredMargin = calculateRequiredMargin(Number(draft.requestedAmount), Number(draft.marginPercentage));
  const balancePo = Math.max(0, Number(draft.purchaseOrderAmount) - Number(draft.existingLcAmount || 0) - Number(draft.requestedAmount));
  const selectedVendor = useMemo(() => vendors.find((vendor) => vendor.id === draft.vendorId || vendor.name.toLowerCase() === draft.vendorText.trim().toLowerCase()), [draft.vendorId, draft.vendorText, vendors]);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async (mode: 'draft' | 'submit') => {
    if (!user || !canAdd || saving) return;
    setSaving(mode);
    try {
      const project = projects.find((item) => item.id === draft.projectId);
      const bank = banks.find((item) => item.id === draft.preferredBankId);
      const vendorName = selectedVendor?.name || draft.vendorText.trim();
      if (!vendorName) throw new Error('Vendor is required.');
      const actor: LCActor = { userId: user.id, userName: user.name, role: user.role, organizationId: user.organizationId || 'default', organizationName: user.organizationName || 'Default Organization' };
      const result = await createLCRequest({ ...draft, projectName: project?.projectName || draft.projectName, vendorId: selectedVendor?.id || draft.vendorId || vendorName.toLowerCase().replace(/\W+/g, '-'), vendorName, vendorCode: selectedVendor?.code || draft.vendorCode || '', purchaseOrderId: draft.purchaseOrderId || draft.purchaseOrderNumber, preferredBankName: bank?.bankName || draft.preferredBankName } as LCRequestInput, actor);
      if (mode === 'submit') await submitLCRequest(result.id, actor);
      toast({ title: mode === 'submit' ? 'LC request submitted' : 'LC request saved as draft', description: result.referenceNumber });
      router.push(mode === 'submit' ? '/letter-of-credit/approvals' : `/letter-of-credit/${result.id}`);
    } catch (error) {
      toast({ title: 'Unable to save LC request', description: error instanceof Error ? error.message : 'Please check the form.', variant: 'destructive' });
    } finally { setSaving(null); }
  };

  if (authLoading || loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canAdd) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to create LC requests.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><Button asChild variant="outline" size="icon"><Link href="/letter-of-credit"><ArrowLeft className="h-4 w-4" /></Link></Button><div><h1 className="text-2xl font-bold tracking-tight">New LC Request</h1><p className="text-sm text-muted-foreground">Create the commercial request, terms, bank preference, and margin requirement.</p></div></div><div className="flex gap-2"><Button variant="outline" disabled={Boolean(saving)} onClick={() => void save('draft')}>{saving === 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Draft</Button><Button disabled={Boolean(saving)} onClick={() => void save('submit')}>{saving === 'submit' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Submit</Button></div></div>

    <Section title="Basic details" description="Organization is derived from the signed-in user; the system reference is generated on save.">
      <Field label="Organization"><Input value={user?.organizationName || user?.organizationId || 'Default Organization'} disabled /></Field>
      <Field label="Request date"><Input type="date" value={today()} disabled /></Field>
      <Field label="Requested by"><Input value={user?.name || ''} disabled /></Field>
      <Field label="Department"><Input value={draft.departmentName || ''} onChange={(event) => update('departmentName', event.target.value)} placeholder="Purchase / Commercial" /></Field>
      <Field label="Project" required><Select value={draft.projectId} onValueChange={(value) => update('projectId', value)}><SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Vendor" required><Input list="lc-vendors" value={draft.vendorText} onChange={(event) => { update('vendorText', event.target.value); const vendor = vendors.find((item) => item.name === event.target.value); if (vendor) update('vendorId', vendor.id); }} placeholder="Select or enter vendor" /><datalist id="lc-vendors">{vendors.map((vendor) => <option value={vendor.name} key={vendor.id}>{vendor.code || vendor.id}</option>)}</datalist></Field>
      <Field label="LC purpose" required><Input value={draft.purpose} onChange={(event) => update('purpose', event.target.value)} placeholder="Material procurement / project supply" /></Field>
      <Field label="Material or service description" required wide><Textarea value={draft.materialDescription} onChange={(event) => update('materialDescription', event.target.value)} /></Field>
    </Section>

    <Section title="Purchase details" description="The LC amount is blocked from exceeding the remaining eligible purchase-order value.">
      <Field label="Purchase order number" required><Input value={draft.purchaseOrderNumber} onChange={(event) => update('purchaseOrderNumber', event.target.value)} /></Field>
      <Field label="PO amount" required><Input type="number" min="0" value={draft.purchaseOrderAmount || ''} onChange={(event) => update('purchaseOrderAmount', Number(event.target.value))} /></Field>
      <Field label="Existing LC amount against PO"><Input type="number" min="0" value={draft.existingLcAmount || ''} onChange={(event) => update('existingLcAmount', Number(event.target.value))} /></Field>
      <Field label="Balance after this request"><Input value={formatLcCurrency(balancePo, draft.currency)} disabled /></Field>
      <Field label="Contract reference"><Input value={draft.contractReference || ''} onChange={(event) => update('contractReference', event.target.value)} /></Field>
      <Field label="Requested LC amount" required><Input type="number" min="0" value={draft.requestedAmount || ''} onChange={(event) => update('requestedAmount', Number(event.target.value))} /></Field>
    </Section>

    <Section title="LC type and terms" description="Define shipment, presentation, usance, and due-date controls.">
      <Field label="LC type" required><Select value={draft.lcType} onValueChange={(value) => update('lcType', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LC_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Currency" required><Select value={draft.currency} onValueChange={(value) => update('currency', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Sight or Usance"><Select value={draft.sightOrUsance} onValueChange={(value: 'SIGHT' | 'USANCE') => update('sightOrUsance', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SIGHT">Sight</SelectItem><SelectItem value="USANCE">Usance</SelectItem></SelectContent></Select></Field>
      <Field label="Usance period (days)" required={draft.sightOrUsance === 'USANCE'}><Input type="number" min="0" value={draft.usancePeriodDays || ''} disabled={draft.sightOrUsance === 'SIGHT'} onChange={(event) => update('usancePeriodDays', Number(event.target.value))} /></Field>
      <Field label="Due-date basis"><Select value={draft.dueDateBasis} onValueChange={(value) => update('dueDateBasis', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LC_DUE_DATE_BASES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Tolerance %"><Input type="number" min="0" max="100" value={draft.tolerancePercentage || ''} onChange={(event) => update('tolerancePercentage', Number(event.target.value))} /></Field>
      <Field label="Required opening date" required><Input type="date" value={draft.requiredOpeningDate} onChange={(event) => update('requiredOpeningDate', event.target.value)} /></Field>
      <Field label="Latest shipment date"><Input type="date" value={draft.latestShipmentDate || ''} onChange={(event) => update('latestShipmentDate', event.target.value)} /></Field>
      <Field label="Proposed expiry date" required><Input type="date" value={draft.proposedExpiryDate} onChange={(event) => update('proposedExpiryDate', event.target.value)} /></Field>
      <Field label="Presentation period (days)"><Input type="number" min="0" value={draft.presentationPeriodDays || ''} onChange={(event) => update('presentationPeriodDays', Number(event.target.value))} /></Field>
      <Field label="Incoterm"><Input value={draft.incoterm || ''} onChange={(event) => update('incoterm', event.target.value)} placeholder="CIF / FOB / EXW" /></Field>
      <div className="grid grid-cols-3 gap-3 rounded-lg border bg-slate-50/70 p-3 sm:col-span-2 xl:col-span-3">{[['partialShipmentAllowed', 'Partial shipment'], ['transshipmentAllowed', 'Transshipment'], ['partialDrawingAllowed', 'Partial drawing']].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs"><Switch checked={Boolean(draft[key as keyof Draft])} onCheckedChange={(checked) => update(key as keyof Draft, checked as never)} />{label}</label>)}</div>
      <Field label="Special conditions" wide><Textarea value={draft.specialConditions || ''} onChange={(event) => update('specialConditions', event.target.value)} /></Field>
    </Section>

    <Section title="Bank, margin, and recoverability" description="The margin requirement is calculated automatically. FD selection and reservation is completed in Margin & FD Linkage after saving.">
      <Field label="Preferred bank" required><Select value={draft.preferredBankId} onValueChange={(value) => update('preferredBankId', value)}><SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger><SelectContent>{banks.map((bank) => <SelectItem key={bank.id} value={bank.id}>{bank.bankName} · {bank.accountNumber}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Margin type"><Select value={draft.marginType} onValueChange={(value) => update('marginType', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LC_MARGIN_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Margin %"><Input type="number" min="0" max="100" value={draft.marginPercentage || ''} onChange={(event) => update('marginPercentage', Number(event.target.value))} /></Field>
      <Field label="Required margin"><div className="flex h-10 items-center rounded-md border bg-cyan-50 px-3 font-semibold text-cyan-800"><Calculator className="mr-2 h-4 w-4" />{formatLcCurrency(requiredMargin, draft.currency)}</div></Field>
      <Field label="Estimated commission"><Input type="number" min="0" value={draft.estimatedCommission || ''} onChange={(event) => update('estimatedCommission', Number(event.target.value))} /></Field>
      <Field label="Estimated bank charges"><Input type="number" min="0" value={draft.estimatedCharges || ''} onChange={(event) => update('estimatedCharges', Number(event.target.value))} /></Field>
      <div className="flex items-center gap-3 rounded-lg border bg-slate-50/70 p-3"><Switch checked={draft.clientRecoverable} onCheckedChange={(checked) => update('clientRecoverable', checked)} /><div><p className="text-xs font-medium">Client recoverable</p><p className="text-[11px] text-muted-foreground">Track project-wise client recovery</p></div></div>
      <Field label="Expected recoverable amount"><Input type="number" min="0" disabled={!draft.clientRecoverable} value={draft.expectedRecoverableAmount || ''} onChange={(event) => update('expectedRecoverableAmount', Number(event.target.value))} /></Field>
      <Field label="Remarks" wide><Textarea value={draft.remarks || ''} onChange={(event) => update('remarks', event.target.value)} /></Field>
    </Section>
  </div>;
}
