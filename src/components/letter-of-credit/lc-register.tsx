'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Check, Download, Eye, FilePlus2, Loader2, RefreshCw, RotateCcw, Search, ShieldAlert, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { decideLCRequest, type LCActor } from '@/lib/letter-of-credit-service';
import { LC_COLLECTIONS, LC_PERMISSION_MODULE, formatLcCurrency, lcLabel, lcStatusTone, toLcDate, toLcDateInput, type LCRequest, type LetterOfCredit } from '@/lib/letter-of-credit';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

type Mode = 'register' | 'approvals';
type Decision = { request: LCRequest; action: 'APPROVE' | 'REJECT' | 'RETURN' } | null;

export default function LCRegister({ mode = 'register' }: { mode?: Mode }) {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const [requests, setRequests] = useState<LCRequest[]>([]);
  const [credits, setCredits] = useState<LetterOfCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [decision, setDecision] = useState<Decision>(null);
  const [comments, setComments] = useState('');
  const [working, setWorking] = useState(false);
  const resource = mode === 'approvals' ? 'Pending Approvals' : 'LC Register';
  const canView = can('View', `${LC_PERMISSION_MODULE}.${resource}`);
  const canAdd = can('Add', `${LC_PERMISSION_MODULE}.LC Requests`);
  const canApprove = can('Approve', `${LC_PERMISSION_MODULE}.Pending Approvals`);
  const canReject = can('Reject', `${LC_PERMISSION_MODULE}.Pending Approvals`);
  const canReturn = can('Return', `${LC_PERMISSION_MODULE}.Pending Approvals`);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scoped = (name: string) => user?.role === 'Super Admin' || !user?.organizationId ? collection(db, name) : query(collection(db, name), where('organizationId', '==', user.organizationId));
      const [requestSnapshot, creditSnapshot] = await Promise.all([getDocs(scoped(LC_COLLECTIONS.requests)), getDocs(scoped(LC_COLLECTIONS.credits))]);
      setRequests(requestSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as LCRequest)).filter((item) => !item.isDeleted));
      setCredits(creditSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as LetterOfCredit)).filter((item) => !item.isDeleted));
    } catch (error) {
      console.error('Unable to load LC register', error);
      toast({ title: 'Unable to load LC register', variant: 'destructive' });
    } finally { setLoading(false); }
  }, [toast, user?.organizationId, user?.role]);

  useEffect(() => { if (!authLoading && canView) void load(); else if (!authLoading) setLoading(false); }, [authLoading, canView, load]);

  const visibleRequests = useMemo(() => requests.filter((item) => {
    if (mode === 'approvals' && !item.status.startsWith('PENDING_')) return false;
    if (status !== 'ALL' && item.status !== status) return false;
    const token = search.toLowerCase().trim();
    return !token || `${item.referenceNumber} ${item.vendorName} ${item.projectName} ${item.purchaseOrderNumber} ${item.preferredBankName} ${item.status}`.toLowerCase().includes(token);
  }).sort((a, b) => (toLcDate(b.requestDate)?.getTime() || 0) - (toLcDate(a.requestDate)?.getTime() || 0)), [mode, requests, search, status]);

  const visibleCredits = useMemo(() => credits.filter((item) => {
    if (status !== 'ALL' && item.status !== status) return false;
    const token = search.toLowerCase().trim();
    return !token || `${item.bankLcNumber} ${item.internalReferenceNumber} ${item.vendorName} ${item.projectName} ${item.purchaseOrderNumber} ${item.bankName} ${item.status}`.toLowerCase().includes(token);
  }).sort((a, b) => (toLcDate(b.openingDate)?.getTime() || 0) - (toLcDate(a.openingDate)?.getTime() || 0)), [credits, search, status]);

  const totals = useMemo(() => ({ requestAmount: visibleRequests.reduce((sum, item) => sum + Number(item.requestedAmount || 0), 0), openedAmount: visibleCredits.reduce((sum, item) => sum + Number(item.openedAmount || 0), 0), outstanding: visibleCredits.reduce((sum, item) => sum + Number(item.outstandingAmount || 0), 0) }), [visibleCredits, visibleRequests]);

  const act = async () => {
    if (!decision || !user) return;
    setWorking(true);
    try {
      const actor: LCActor = { userId: user.id, userName: user.name, role: user.role, organizationId: user.organizationId || 'default', organizationName: user.organizationName };
      const next = await decideLCRequest(decision.request.id, decision.action, comments, actor);
      toast({ title: `LC request ${decision.action.toLowerCase()}d`, description: `${decision.request.referenceNumber} · ${lcLabel(next)}` });
      setDecision(null); setComments(''); await load();
    } catch (error) { toast({ title: 'Decision failed', description: error instanceof Error ? error.message : '', variant: 'destructive' }); } finally { setWorking(false); }
  };

  const exportRegister = async () => {
    const workbook = new ExcelJS.Workbook();
    const lcSheet = workbook.addWorksheet('LC Register');
    lcSheet.columns = [{ header: 'Bank LC Number', key: 'number', width: 24 }, { header: 'Internal Reference', key: 'reference', width: 26 }, { header: 'Bank', key: 'bank', width: 22 }, { header: 'Vendor', key: 'vendor', width: 26 }, { header: 'Project', key: 'project', width: 26 }, { header: 'PO Number', key: 'po', width: 20 }, { header: 'Opened Amount', key: 'amount', width: 18 }, { header: 'Accepted', key: 'accepted', width: 18 }, { header: 'Paid', key: 'paid', width: 18 }, { header: 'Outstanding', key: 'outstanding', width: 18 }, { header: 'Opening Date', key: 'opening', width: 15 }, { header: 'Expiry Date', key: 'expiry', width: 15 }, { header: 'Status', key: 'status', width: 22 }];
    visibleCredits.forEach((item) => lcSheet.addRow({ number: item.bankLcNumber, reference: item.internalReferenceNumber, bank: item.bankName, vendor: item.vendorName, project: item.projectName, po: item.purchaseOrderNumber, amount: item.openedAmount, accepted: item.totalAcceptedAmount, paid: item.totalPaidAmount, outstanding: item.outstandingAmount, opening: toLcDateInput(item.openingDate), expiry: toLcDateInput(item.expiryDate), status: lcLabel(item.status) }));
    const requestSheet = workbook.addWorksheet('LC Requests');
    requestSheet.columns = [{ header: 'Reference', key: 'reference', width: 26 }, { header: 'Vendor', key: 'vendor', width: 26 }, { header: 'Project', key: 'project', width: 26 }, { header: 'PO', key: 'po', width: 20 }, { header: 'Bank', key: 'bank', width: 22 }, { header: 'Amount', key: 'amount', width: 18 }, { header: 'Required Margin', key: 'margin', width: 18 }, { header: 'Status', key: 'status', width: 28 }];
    visibleRequests.forEach((item) => requestSheet.addRow({ reference: item.referenceNumber, vendor: item.vendorName, project: item.projectName, po: item.purchaseOrderNumber, bank: item.preferredBankName, amount: item.requestedAmount, margin: item.requiredMarginAmount, status: lcLabel(item.status) }));
    [lcSheet, requestSheet].forEach((sheet) => { sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]; });
    const buffer = await workbook.xlsx.writeBuffer(); const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `letter-of-credit-register-${new Date().toISOString().slice(0, 10)}.xlsx`; anchor.click(); URL.revokeObjectURL(url);
  };

  if (authLoading || loading) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canView) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this workspace.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  return <div className="space-y-4">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold tracking-tight">{mode === 'approvals' ? 'Pending LC Approvals' : 'LC Register'}</h1><p className="text-sm text-muted-foreground">{mode === 'approvals' ? 'Commercial, project, finance, and director-stage request decisions.' : 'Complete organization-scoped LC request and issued-LC register.'}</p></div><div className="flex gap-2">{canAdd && <Button asChild><Link href="/letter-of-credit/new"><FilePlus2 className="mr-2 h-4 w-4" />New Request</Link></Button>}<Button variant="outline" onClick={() => void exportRegister()}><Download className="mr-2 h-4 w-4" />Export</Button><Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button></div></div>
    <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Requests</p><p className="mt-1 text-2xl font-bold">{visibleRequests.length}</p><p className="text-xs text-muted-foreground">{formatLcCurrency(totals.requestAmount)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Opened LCs</p><p className="mt-1 text-2xl font-bold">{visibleCredits.length}</p><p className="text-xs text-muted-foreground">{formatLcCurrency(totals.openedAmount)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Outstanding Liability</p><p className="mt-1 text-xl font-bold text-rose-700">{formatLcCurrency(totals.outstanding)}</p></CardContent></Card></div>
    <Card><CardContent className="flex flex-col gap-2 p-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search LC, vendor, project, PO, bank…" className="pl-9" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="sm:w-60"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All statuses</SelectItem>{Array.from(new Set([...requests.map((item) => item.status), ...credits.map((item) => item.status)])).sort().map((item) => <SelectItem key={item} value={item}>{lcLabel(item)}</SelectItem>)}</SelectContent></Select></CardContent></Card>

    {mode === 'approvals' ? <RequestTable rows={visibleRequests} approvals onDecision={setDecision} permissions={{ canApprove, canReject, canReturn }} /> : <Tabs defaultValue="credits"><TabsList><TabsTrigger value="credits">Issued LCs ({visibleCredits.length})</TabsTrigger><TabsTrigger value="requests">Requests ({visibleRequests.length})</TabsTrigger></TabsList><TabsContent value="credits"><CreditTable rows={visibleCredits} /></TabsContent><TabsContent value="requests"><RequestTable rows={visibleRequests} onDecision={setDecision} permissions={{ canApprove, canReject, canReturn }} /></TabsContent></Tabs>}

    <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open && !working) { setDecision(null); setComments(''); } }}><DialogContent><DialogHeader><DialogTitle>{decision ? `${lcLabel(decision.action)} LC request` : 'LC decision'}</DialogTitle><DialogDescription>{decision?.request.referenceNumber} · {decision?.request.vendorName} · {formatLcCurrency(decision?.request.requestedAmount || 0)}</DialogDescription></DialogHeader><Textarea value={comments} onChange={(event) => setComments(event.target.value)} placeholder={decision?.action === 'APPROVE' ? 'Approval comments or conditions (optional)' : 'Decision reason (required)'} /><DialogFooter><Button variant="outline" disabled={working} onClick={() => setDecision(null)}>Cancel</Button><Button disabled={working || (decision?.action !== 'APPROVE' && !comments.trim())} onClick={() => void act()}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm {decision ? lcLabel(decision.action) : ''}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function RequestTable({ rows, approvals = false, onDecision, permissions }: { rows: LCRequest[]; approvals?: boolean; onDecision: (value: Decision) => void; permissions: { canApprove: boolean; canReject: boolean; canReturn: boolean } }) {
  return <Card className="overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Vendor / Project</TableHead><TableHead>Bank / Terms</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Margin</TableHead><TableHead>Required Dates</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.id}><TableCell><p className="font-medium">{item.referenceNumber}</p><p className="text-xs text-muted-foreground">PO {item.purchaseOrderNumber}</p></TableCell><TableCell><p>{item.vendorName}</p><p className="text-xs text-muted-foreground">{item.projectName}</p></TableCell><TableCell><p>{item.preferredBankName}</p><p className="text-xs text-muted-foreground">{lcLabel(item.lcType)} · {item.sightOrUsance}{item.usancePeriodDays ? ` ${item.usancePeriodDays}d` : ''}</p></TableCell><TableCell className="text-right font-medium">{formatLcCurrency(item.requestedAmount, item.currency)}</TableCell><TableCell className="text-right">{formatLcCurrency(item.requiredMarginAmount, item.currency)}<p className="text-xs text-muted-foreground">{item.marginPercentage}% {lcLabel(item.marginType)}</p></TableCell><TableCell><p>{toLcDateInput(item.requiredOpeningDate) || '-'}</p><p className="text-xs text-muted-foreground">Exp {toLcDateInput(item.proposedExpiryDate) || '-'}</p></TableCell><TableCell><Badge variant="outline" className={lcStatusTone(item.status)}>{lcLabel(item.status)}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button asChild variant="ghost" size="icon"><Link href={`/letter-of-credit/${item.id}`}><Eye className="h-4 w-4" /></Link></Button>{approvals && permissions.canApprove && <Button variant="ghost" size="icon" className="text-emerald-700" onClick={() => onDecision({ request: item, action: 'APPROVE' })}><Check className="h-4 w-4" /></Button>}{approvals && permissions.canReturn && <Button variant="ghost" size="icon" className="text-amber-700" onClick={() => onDecision({ request: item, action: 'RETURN' })}><RotateCcw className="h-4 w-4" /></Button>}{approvals && permissions.canReject && <Button variant="ghost" size="icon" className="text-rose-700" onClick={() => onDecision({ request: item, action: 'REJECT' })}><X className="h-4 w-4" /></Button>}</div></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">No LC requests match this view.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>;
}

function CreditTable({ rows }: { rows: LetterOfCredit[] }) {
  return <Card className="overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>LC</TableHead><TableHead>Bank / Vendor</TableHead><TableHead>Project / PO</TableHead><TableHead className="text-right">Opened</TableHead><TableHead className="text-right">Accepted</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Dates</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.id}><TableCell><p className="font-medium">{item.bankLcNumber}</p><p className="text-xs text-muted-foreground">{item.internalReferenceNumber}</p></TableCell><TableCell><p>{item.bankName}</p><p className="text-xs text-muted-foreground">{item.vendorName}</p></TableCell><TableCell><p>{item.projectName}</p><p className="text-xs text-muted-foreground">PO {item.purchaseOrderNumber}</p></TableCell><TableCell className="text-right font-medium">{formatLcCurrency(item.openedAmount, item.currency)}</TableCell><TableCell className="text-right">{formatLcCurrency(item.totalAcceptedAmount, item.currency)}</TableCell><TableCell className="text-right">{formatLcCurrency(item.totalPaidAmount, item.currency)}</TableCell><TableCell className="text-right font-semibold text-rose-700">{formatLcCurrency(item.outstandingAmount, item.currency)}</TableCell><TableCell><p>{toLcDateInput(item.openingDate)}</p><p className="text-xs text-muted-foreground">Exp {toLcDateInput(item.expiryDate)}</p></TableCell><TableCell><Badge variant="outline" className={lcStatusTone(item.status)}>{lcLabel(item.status)}</Badge></TableCell><TableCell><Button asChild variant="ghost" size="icon"><Link href={`/letter-of-credit/${item.id}`}><Eye className="h-4 w-4" /></Link></Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted-foreground">No issued Letters of Credit match this view.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>;
}
