'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Loader2, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { openLetterOfCredit, type LCActor, type LCOpeningInput } from '@/lib/letter-of-credit-service';
import { LC_COLLECTIONS, LC_DUE_DATE_BASES, LC_PERMISSION_MODULE, calculateRequiredMargin, formatLcCurrency, toLcDateInput, type LCRequest } from '@/lib/letter-of-credit';
import { FD_COLLECTIONS, assignmentOutstanding, type FDAssignment } from '@/lib/fixed-deposit';
import type { BankAccount } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type Limit = { id: string; bankId: string; bankName?: string; sanctionedAmount: number; temporaryLimit?: number; utilizedAmount?: number; reservedAmount?: number; status?: string };
const date = () => new Date().toISOString().slice(0, 10);
const blank = (): Omit<LCOpeningInput, 'requestId'> => ({ bankLcNumber: '', bankId: '', bankName: '', branchId: '', branchName: '', bankLimitId: '', openingDate: date(), effectiveDate: date(), openedAmount: 0, currency: 'INR', exchangeRate: 1, expiryDate: '', latestShipmentDate: '', presentationPeriodDays: 21, usancePeriodDays: 0, dueDateBasis: 'HUNDI_ACCEPTANCE_DATE', expectedDueDate: '', marginPercentage: 0, fdMarginAmount: 0, cashMarginAmount: 0, otherCollateralAmount: 0, openingCommission: 0, swiftCharges: 0, handlingCharges: 0, gstAmount: 0, otherCharges: 0, debitAccountId: '', originalLcReceived: false, vendorInformed: false, vendorCopySentDate: '', remarks: '' });
function Field({ label, required, helper, children, wide = false }: { label: string; required?: boolean; helper?: string; children: ReactNode; wide?: boolean }) { return <div className={`space-y-1.5 ${wide ? 'sm:col-span-2 xl:col-span-3' : ''}`}><Label className="text-xs">{label}{required && <span className="text-rose-500"> *</span>}</Label>{children}{helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}</div>; }

export default function LCOpeningWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const [requests, setRequests] = useState<LCRequest[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [limits, setLimits] = useState<Limit[]>([]);
  const [assignments, setAssignments] = useState<FDAssignment[]>([]);
  const [requestId, setRequestId] = useState(params?.get('requestId') || '');
  const [draft, setDraft] = useState(() => blank());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const canView = can('View', `${LC_PERMISSION_MODULE}.LC Opening`);
  const canOpen = can('Open', `${LC_PERMISSION_MODULE}.LC Opening`) || can('Add', `${LC_PERMISSION_MODULE}.LC Opening`);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const organizationId = user.organizationId || 'default';
    void Promise.all([getDocs(query(collection(db, LC_COLLECTIONS.requests), where('organizationId', '==', organizationId))), getDocs(collection(db, 'bankAccounts')), getDocs(query(collection(db, LC_COLLECTIONS.bankLimits), where('organizationId', '==', organizationId))), getDocs(query(collection(db, FD_COLLECTIONS.assignments), where('organizationId', '==', organizationId)))]).then(([requestSnapshot, bankSnapshot, limitSnapshot, assignmentSnapshot]) => {
      if (!active) return;
      setRequests(requestSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as LCRequest)).filter((item) => item.status === 'APPROVED'));
      setBanks(bankSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as BankAccount)).filter((item) => item.status === 'Active'));
      setLimits(limitSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Limit)));
      setAssignments(assignmentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as FDAssignment)).filter((item) => item.instrumentType === 'LC'));
    }).catch(() => toast({ title: 'Unable to load LC opening data', variant: 'destructive' })).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [toast, user]);

  const request = requests.find((item) => item.id === requestId);
  useEffect(() => {
    if (!request) return;
    const limit = limits.find((item) => item.bankId === request.preferredBankId);
    setDraft((current) => ({ ...current, bankId: request.preferredBankId, bankName: request.preferredBankName, bankLimitId: limit?.id || '', openedAmount: request.requestedAmount, currency: request.currency, expiryDate: toLcDateInput(request.proposedExpiryDate), latestShipmentDate: toLcDateInput(request.latestShipmentDate), presentationPeriodDays: request.presentationPeriodDays, usancePeriodDays: request.usancePeriodDays, dueDateBasis: request.dueDateBasis, marginPercentage: request.marginPercentage, fdMarginAmount: request.marginType === 'FD' || request.marginType === 'COMBINED' ? request.requiredMarginAmount : 0, cashMarginAmount: request.marginType === 'CASH' ? request.requiredMarginAmount : 0 }));
  }, [limits, request]);
  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const selectedBank = banks.find((item) => item.id === draft.bankId);
  const limit = limits.find((item) => item.id === draft.bankLimitId || item.bankId === draft.bankId);
  const availableLimit = Number(limit?.sanctionedAmount || 0) + Number(limit?.temporaryLimit || 0) - Number(limit?.utilizedAmount || 0) - Number(limit?.reservedAmount || 0);
  const reservedFd = useMemo(() => assignments.filter((item) => item.instrumentId === requestId && ['RESERVED', 'PENDING_APPROVAL'].includes(item.status)).reduce((sum, item) => sum + assignmentOutstanding(item), 0), [assignments, requestId]);
  const requiredMargin = calculateRequiredMargin(draft.openedAmount, draft.marginPercentage);
  const totalMargin = draft.fdMarginAmount + draft.cashMarginAmount + draft.otherCollateralAmount;
  const totalCharges = draft.openingCommission + draft.swiftCharges + draft.handlingCharges + draft.gstAmount + draft.otherCharges;

  const open = async () => {
    if (!user || !request || !canOpen) return;
    setSaving(true);
    try {
      const actor: LCActor = { userId: user.id, userName: user.name, role: user.role, organizationId: user.organizationId || 'default', organizationName: user.organizationName };
      const lcId = await openLetterOfCredit({ ...draft, requestId, bankName: selectedBank?.bankName || draft.bankName, branchName: selectedBank?.branch || draft.branchName }, actor);
      toast({ title: 'Letter of Credit opened', description: `${draft.bankLcNumber} is now active and reserved FD margin has been activated.` });
      router.push(`/letter-of-credit/${lcId}`);
    } catch (error) { toast({ title: 'LC opening failed', description: error instanceof Error ? error.message : '', variant: 'destructive' }); } finally { setSaving(false); }
  };

  if (authLoading || loading) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canView) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to open Letters of Credit.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  return <div className="space-y-4"><div><h1 className="text-2xl font-bold tracking-tight">LC Opening</h1><p className="text-sm text-muted-foreground">Convert an approved request into a bank-issued Letter of Credit with limit and margin controls.</p></div>
    <Card><CardHeader><CardTitle className="text-base">Approved request</CardTitle><CardDescription>Select a fully approved request. Requests already opened are removed from this list.</CardDescription></CardHeader><CardContent><Select value={requestId} onValueChange={setRequestId}><SelectTrigger><SelectValue placeholder="Select approved LC request" /></SelectTrigger><SelectContent>{requests.map((item) => <SelectItem key={item.id} value={item.id}>{item.referenceNumber} · {item.vendorName} · {formatLcCurrency(item.requestedAmount, item.currency)}</SelectItem>)}</SelectContent></Select>{!requests.length && <p className="mt-3 text-sm text-muted-foreground">No approved LC request is currently awaiting opening.</p>}</CardContent></Card>
    {request && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Approved Amount</p><p className="mt-1 text-xl font-bold">{formatLcCurrency(request.requestedAmount, request.currency)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Available Bank Limit</p><p className={`mt-1 text-xl font-bold ${availableLimit < draft.openedAmount ? 'text-rose-700' : 'text-emerald-700'}`}>{formatLcCurrency(availableLimit)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Required Margin</p><p className="mt-1 text-xl font-bold">{formatLcCurrency(requiredMargin, draft.currency)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">FD Reserved</p><p className={`mt-1 text-xl font-bold ${reservedFd < draft.fdMarginAmount ? 'text-rose-700' : 'text-violet-700'}`}>{formatLcCurrency(reservedFd, draft.currency)}</p></CardContent></Card></div>
      <Card><CardHeader><CardTitle className="text-base">Bank-issued LC details</CardTitle><CardDescription>Bank LC number is unique. Opening, shipment, and expiry dates are validated.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Field label="Internal reference"><Input value={request.referenceNumber} disabled /></Field><Field label="Bank LC number" required><Input value={draft.bankLcNumber} onChange={(event) => update('bankLcNumber', event.target.value)} /></Field><Field label="Bank" required><Select value={draft.bankId} onValueChange={(value) => { update('bankId', value); const item = banks.find((bank) => bank.id === value); if (item) update('bankName', item.bankName); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{banks.map((bank) => <SelectItem key={bank.id} value={bank.id}>{bank.bankName} · {bank.branch}</SelectItem>)}</SelectContent></Select></Field><Field label="Opening date" required><Input type="date" value={draft.openingDate} onChange={(event) => update('openingDate', event.target.value)} /></Field><Field label="Effective date"><Input type="date" value={draft.effectiveDate || ''} onChange={(event) => update('effectiveDate', event.target.value)} /></Field><Field label="Opened amount" required><Input type="number" min="0" value={draft.openedAmount || ''} onChange={(event) => update('openedAmount', Number(event.target.value))} /></Field><Field label="Currency"><Select value={draft.currency} onValueChange={(value) => update('currency', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field><Field label="Exchange rate"><Input type="number" min="0" step="0.0001" value={draft.exchangeRate || ''} onChange={(event) => update('exchangeRate', Number(event.target.value))} /></Field><Field label="Base-currency value"><Input value={formatLcCurrency(draft.openedAmount * draft.exchangeRate)} disabled /></Field><Field label="Expiry date" required><Input type="date" value={draft.expiryDate} onChange={(event) => update('expiryDate', event.target.value)} /></Field><Field label="Latest shipment date"><Input type="date" value={draft.latestShipmentDate || ''} onChange={(event) => update('latestShipmentDate', event.target.value)} /></Field><Field label="Expected payment date"><Input type="date" value={draft.expectedDueDate || ''} onChange={(event) => update('expectedDueDate', event.target.value)} /></Field><Field label="Usance period (days)"><Input type="number" min="0" value={draft.usancePeriodDays || ''} onChange={(event) => update('usancePeriodDays', Number(event.target.value))} /></Field><Field label="Due-date basis"><Select value={draft.dueDateBasis} onValueChange={(value) => update('dueDateBasis', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LC_DUE_DATE_BASES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field><Field label="Presentation period"><Input type="number" min="0" value={draft.presentationPeriodDays || ''} onChange={(event) => update('presentationPeriodDays', Number(event.target.value))} /></Field></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Margin and bank charges</CardTitle><CardDescription>Total eligible margin must cover the requirement before opening.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Field label="Margin %"><Input type="number" min="0" max="100" value={draft.marginPercentage || ''} onChange={(event) => update('marginPercentage', Number(event.target.value))} /></Field><Field label="FD margin"><Input type="number" min="0" value={draft.fdMarginAmount || ''} onChange={(event) => update('fdMarginAmount', Number(event.target.value))} /></Field><Field label="Cash margin"><Input type="number" min="0" value={draft.cashMarginAmount || ''} onChange={(event) => update('cashMarginAmount', Number(event.target.value))} /></Field><Field label="Other collateral"><Input type="number" min="0" value={draft.otherCollateralAmount || ''} onChange={(event) => update('otherCollateralAmount', Number(event.target.value))} /></Field><Field label="Margin shortfall"><Input value={formatLcCurrency(Math.max(0, requiredMargin - totalMargin), draft.currency)} disabled /></Field><Field label="Opening commission"><Input type="number" min="0" value={draft.openingCommission || ''} onChange={(event) => update('openingCommission', Number(event.target.value))} /></Field><Field label="SWIFT charges"><Input type="number" min="0" value={draft.swiftCharges || ''} onChange={(event) => update('swiftCharges', Number(event.target.value))} /></Field><Field label="Handling charges"><Input type="number" min="0" value={draft.handlingCharges || ''} onChange={(event) => update('handlingCharges', Number(event.target.value))} /></Field><Field label="GST"><Input type="number" min="0" value={draft.gstAmount || ''} onChange={(event) => update('gstAmount', Number(event.target.value))} /></Field><Field label="Other charges"><Input type="number" min="0" value={draft.otherCharges || ''} onChange={(event) => update('otherCharges', Number(event.target.value))} /></Field><Field label="Total charges"><Input value={formatLcCurrency(totalCharges, draft.currency)} disabled /></Field><div className="flex items-center gap-6 rounded-lg border p-3"><label className="flex items-center gap-2 text-xs"><Switch checked={draft.originalLcReceived} onCheckedChange={(value) => update('originalLcReceived', value)} />Original received</label><label className="flex items-center gap-2 text-xs"><Switch checked={draft.vendorInformed} onCheckedChange={(value) => update('vendorInformed', value)} />Vendor informed</label></div><Field label="Remarks" wide><Textarea value={draft.remarks || ''} onChange={(event) => update('remarks', event.target.value)} /></Field></CardContent></Card>
      <div className="flex justify-end"><Button size="lg" disabled={!canOpen || saving} onClick={() => void open()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Open Letter of Credit</Button></div></>}
  </div>;
}
