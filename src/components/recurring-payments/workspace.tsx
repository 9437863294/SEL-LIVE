'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Download, FileClock, IndianRupee, Loader2, Plus, RefreshCw, Repeat2, Search, ShieldCheck, WalletCards } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { DEFAULT_PAYMENT_CATEGORIES, DEFAULT_RECURRING_PAYMENT_SETTINGS, PaymentObligation, PaymentStatus, RecurringPaymentMaster, RecurringPaymentSettings, RP_COLLECTIONS, currency, effectiveStatus, maskAccount } from '@/lib/recurring-payments';
import RecurringPaymentSettingsPanel from '@/components/recurring-payments/settings-panel';
import { useAuthorization } from '@/hooks/useAuthorization';

type View = 'dashboard' | 'payments' | 'upcoming' | 'overdue' | 'masters' | 'vendors' | 'categories' | 'reports' | 'settings';
type NamedRecord = { id: string; name: string; status?: string; contact?: string; organizationId: string };

const statusClass: Record<string, string> = {
  Overdue: 'bg-red-100 text-red-700 border-red-200', Paid: 'bg-emerald-100 text-emerald-700 border-emerald-200', Closed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Approved: 'bg-blue-100 text-blue-700 border-blue-200', 'Pending Approval': 'bg-amber-100 text-amber-700 border-amber-200', 'Awaiting Bill': 'bg-violet-100 text-violet-700 border-violet-200',
};
const iso = (date: Date) => date.toISOString().slice(0, 10);

export default function RecurringPaymentsWorkspace({ view }: { view: View }) {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [masters, setMasters] = useState<RecurringPaymentMaster[]>([]);
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [vendors, setVendors] = useState<NamedRecord[]>([]);
  const [categories, setCategories] = useState<NamedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [masterOpen, setMasterOpen] = useState(false);
  const [namedOpen, setNamedOpen] = useState<'vendor' | 'category' | null>(null);
  const [paymentOpen, setPaymentOpen] = useState<PaymentObligation | null>(null);
  const [saving, setSaving] = useState(false);
  const [moduleSettings, setModuleSettings] = useState<RecurringPaymentSettings>({ ...DEFAULT_RECURRING_PAYMENT_SETTINGS, organizationId });
  const canCreateMaster = can('Add', 'Recurring Payments.Recurring Masters');
  const canGenerateCycles = can('Add', 'Recurring Payments.Payments') || can('Edit', 'Recurring Payments.Settings');

  useEffect(() => {
    const collections = [RP_COLLECTIONS.masters, RP_COLLECTIONS.payments, RP_COLLECTIONS.vendors, RP_COLLECTIONS.categories];
    const setters = [setMasters, setPayments, setVendors, setCategories] as Array<(data: never[]) => void>;
    let received = 0;
    const unsubscribers = collections.map((name, i) => onSnapshot(query(collection(db, name), where('organizationId', '==', organizationId)), snap => {
      setters[i](snap.docs.map(d => ({ id: d.id, ...d.data() })) as never[]);
      received += 1;
      if (received >= collections.length) setLoading(false);
    }, () => setLoading(false)));
    return () => unsubscribers.forEach(fn => fn());
  }, [organizationId]);

  useEffect(() => onSnapshot(doc(db, RP_COLLECTIONS.settings, organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')), snap => {
    if (!snap.exists()) return;
    const data = snap.data() as Partial<RecurringPaymentSettings>;
    setModuleSettings({ ...DEFAULT_RECURRING_PAYMENT_SETTINGS, ...data, organizationId,
      notifications: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.notifications, ...data.notifications },
      automation: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.automation, ...data.automation },
      controls: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.controls, ...data.controls },
    });
  }), [organizationId]);

  const normalizedPayments = useMemo(() => payments.map(p => ({ ...p, status: effectiveStatus(p) })), [payments]);
  const today = iso(new Date());
  const inDays = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return iso(d); };
  const visiblePayments = useMemo(() => normalizedPayments.filter(p => {
    if (view === 'upcoming' && (p.dueDate < today || p.dueDate > inDays(30) || ['Paid', 'Closed'].includes(p.status))) return false;
    if (view === 'overdue' && p.status !== 'Overdue') return false;
    return `${p.title} ${p.vendorName} ${p.category} ${p.status}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [normalizedPayments, search, view, today]);

  const stats = useMemo(() => ({
    dueToday: normalizedPayments.filter(p => p.dueDate === today && !['Paid', 'Closed'].includes(p.status)).length,
    week: normalizedPayments.filter(p => p.dueDate >= today && p.dueDate <= inDays(7) && !['Paid', 'Closed'].includes(p.status)).length,
    overdue: normalizedPayments.filter(p => p.status === 'Overdue').length,
    awaiting: normalizedPayments.filter(p => p.status === 'Awaiting Bill').length,
    approval: normalizedPayments.filter(p => p.status === 'Pending Approval').length,
    ready: normalizedPayments.filter(p => p.status === 'Approved').length,
    paidMonth: normalizedPayments.filter(p => ['Paid', 'Closed'].includes(p.status) && p.paymentDate?.slice(0, 7) === today.slice(0, 7)).reduce((s, p) => s + p.paidAmount, 0),
    outflow30: normalizedPayments.filter(p => p.dueDate >= today && p.dueDate <= inDays(30) && !['Paid', 'Closed', 'Cancelled'].includes(p.status)).reduce((s, p) => s + (p.billAmount || p.expectedAmount), 0),
  }), [normalizedPayments, today]);

  const generateCycles = useCallback(async () => {
    setSaving(true);
    try {
      const now = new Date(); const cycle = iso(now).slice(0, 7); let created = 0;
      for (const m of masters.filter(x => x.status === 'Active' && !x.deleted)) {
        const cycleKey = `${organizationId}_${m.id}_${cycle}`;
        const ref = doc(db, RP_COLLECTIONS.payments, cycleKey.replace(/[^a-zA-Z0-9_-]/g, '_'));
        if ((await getDoc(ref)).exists()) continue;
        const start = new Date(now.getFullYear(), now.getMonth(), 1); const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const due = new Date(now.getFullYear(), now.getMonth(), Math.min(28, Math.max(1, m.dueDay)));
        await setDoc(ref, { organizationId, masterId: m.id, cycleKey, title: `${m.title} — ${now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}`, category: m.category, vendorName: m.vendorName, billingPeriodStart: iso(start), billingPeriodEnd: iso(end), dueDate: iso(due), expectedAmount: m.amount, paidAmount: 0, status: 'Scheduled', workflowStatus: 'Scheduled', stage: 'Scheduled', currentStepId: null, assignees: [], workflowHistory: [], assignedTo: m.assignedTo || '', generatedAutomatically: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: false });
        created++;
      }
      toast({ title: 'Billing cycles synchronized', description: `${created} active master cycle(s) generated or refreshed without duplicates.` });
    } catch { toast({ title: 'Generation failed', description: 'Could not synchronize billing cycles.', variant: 'destructive' }); } finally { setSaving(false); }
  }, [masters, organizationId, toast]);

  const exportCsv = () => {
    const rows = [['Title','Category','Vendor','Due Date','Expected','Bill Amount','Paid','Status'], ...visiblePayments.map(p => [p.title,p.category,p.vendorName,p.dueDate,p.expectedAmount,p.billAmount || '',p.paidAmount,p.status])];
    const blob = new Blob([rows.map(r => r.map(x => `"${String(x).replaceAll('"','""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'recurring-payments.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>;

  const header = <Card className="overflow-hidden border-0 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 text-white shadow-lg"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><div className="rounded-2xl bg-white/20 p-3"><Repeat2 className="h-7 w-7" /></div><div><h1 className="text-2xl font-bold">Recurring Payments & Bill Management</h1><p className="text-sm text-indigo-100">Bills, approvals, payments and renewals in one place</p></div></div><div className="flex gap-2">{canGenerateCycles&&<Button variant="secondary" size="sm" onClick={generateCycles} disabled={saving}><RefreshCw className="mr-2 h-4 w-4" />Generate cycles</Button>}{canCreateMaster&&<Button size="sm" className="bg-white text-indigo-700 hover:bg-indigo-50" onClick={() => setMasterOpen(true)}><Plus className="mr-2 h-4 w-4" />New master</Button>}</div></CardContent></Card>;

  return <div className="space-y-5">{header}
    {view === 'dashboard' && <Dashboard stats={stats} payments={normalizedPayments} />}
    {['payments','upcoming','overdue'].includes(view) && <PaymentTable title={view === 'payments' ? 'All Payments' : view === 'upcoming' ? 'Upcoming Payments' : 'Overdue Payments'} rows={visiblePayments} search={search} setSearch={setSearch} onOpen={setPaymentOpen} onExport={exportCsv} />}
    {view === 'masters' && <MastersTable rows={masters.filter(m => !m.deleted)} onAdd={canCreateMaster?() => setMasterOpen(true):undefined} />}
    {view === 'vendors' && <NamedTable title="Vendors" rows={vendors} onAdd={can('Add','Recurring Payments.Vendors')?() => setNamedOpen('vendor'):undefined} />}
    {view === 'categories' && <NamedTable title="Payment Categories" rows={[...DEFAULT_PAYMENT_CATEGORIES.map((name, i) => ({ id: `default-${i}`, name, organizationId })), ...categories]} onAdd={can('Add','Recurring Payments.Categories')?() => setNamedOpen('category'):undefined} />}
    {view === 'reports' && <Reports payments={normalizedPayments} onExport={exportCsv} />}
    {view === 'settings' && <RecurringPaymentSettingsPanel organizationId={organizationId} />}
    <MasterDialog open={masterOpen} onClose={() => setMasterOpen(false)} organizationId={organizationId} categories={categories} vendors={vendors} />
    <NamedDialog kind={namedOpen} onClose={() => setNamedOpen(null)} organizationId={organizationId} />
    <PaymentDialog payment={paymentOpen} onClose={() => setPaymentOpen(null)} settings={moduleSettings} />
  </div>;
}

function Dashboard({ stats, payments }: { stats: Record<string, number>; payments: PaymentObligation[] }) {
  const cards = [
    ['Due Today', stats.dueToday, CalendarClock, 'from-blue-500 to-indigo-600'], ['Due This Week', stats.week, FileClock, 'from-cyan-500 to-blue-600'], ['Overdue', stats.overdue, AlertTriangle, 'from-red-500 to-rose-600'], ['Awaiting Bill', stats.awaiting, WalletCards, 'from-violet-500 to-purple-600'],
    ['Pending Approval', stats.approval, ShieldCheck, 'from-amber-400 to-orange-500'], ['Ready for Payment', stats.ready, IndianRupee, 'from-teal-500 to-emerald-600'], ['Paid This Month', currency(stats.paidMonth), CheckCircle2, 'from-emerald-500 to-green-600'], ['Upcoming 30 Days', currency(stats.outflow30), ArrowRight, 'from-slate-600 to-slate-800'],
  ] as const;
  return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([label,value,Icon,gradient]) => <Card key={label}><CardContent className="flex items-center gap-3 p-4"><div className={`rounded-xl bg-gradient-to-br ${gradient} p-2.5 text-white`}><Icon className="h-5 w-5" /></div><div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{label}</p><p className="truncate text-xl font-bold">{value}</p></div></CardContent></Card>)}</div><PaymentTable title="Priority payments" rows={payments.filter(p => ['Overdue','Pending Approval','Approved'].includes(p.status)).slice(0, 8)} search="" setSearch={() => {}} onOpen={() => {}} /></>;
}

function PaymentTable({ title, rows, search, setSearch, onOpen, onExport }: { title: string; rows: PaymentObligation[]; search: string; setSearch: (v:string)=>void; onOpen:(p:PaymentObligation)=>void; onExport?:()=>void }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>{title}</CardTitle><CardDescription>{rows.length} payment obligation(s)</CardDescription></div><div className="flex gap-2">{setSearch.toString() !== '() => {}' && <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search payments" className="w-48 pl-8" /></div>}{onExport && <Button variant="outline" onClick={onExport}><Download className="mr-2 h-4 w-4" />Export</Button>}</div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Payment</TableHead><TableHead>Vendor</TableHead><TableHead>Due date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map(p => <TableRow key={p.id} className="cursor-pointer" onClick={()=>onOpen(p)}><TableCell><p className="font-medium">{p.title}</p><p className="text-xs text-muted-foreground">{p.category}</p></TableCell><TableCell>{p.vendorName}</TableCell><TableCell>{new Date(`${p.dueDate}T00:00:00`).toLocaleDateString('en-IN')}</TableCell><TableCell className="text-right font-semibold">{currency(p.billAmount || p.expectedAmount)}</TableCell><TableCell><Badge variant="outline" className={statusClass[p.status] || ''}>{p.status}</Badge></TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No payments found.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>;
}

function MastersTable({ rows, onAdd }: { rows: RecurringPaymentMaster[]; onAdd?:()=>void }) { return <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Recurring Payment Masters</CardTitle><CardDescription>Templates used to generate each billing cycle</CardDescription></div>{onAdd&&<Button onClick={onAdd}><Plus className="mr-2 h-4 w-4" />New master</Button>}</CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Vendor / Account</TableHead><TableHead>Frequency</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{rows.map(m=><TableRow key={m.id}><TableCell><p className="font-medium">{m.title}</p><p className="text-xs text-muted-foreground">{m.category}</p></TableCell><TableCell>{m.vendorName}<p className="text-xs text-muted-foreground">{maskAccount(m.accountNumber)}</p></TableCell><TableCell>{m.frequency}</TableCell><TableCell className="text-right">{currency(m.amount)}</TableCell><TableCell><Badge variant="outline">{m.status}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>; }

function NamedTable({ title, rows, onAdd }: { title:string; rows:NamedRecord[]; onAdd?:()=>void }) { return <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>{title}</CardTitle><CardDescription>Organization-specific master data</CardDescription></div>{onAdd&&<Button onClick={onAdd}><Plus className="mr-2 h-4 w-4" />Add</Button>}</CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map(r=><div key={r.id} className="rounded-xl border p-4"><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.contact || r.status || 'Active'}</p></div>)}</div></CardContent></Card>; }

function Reports({ payments, onExport }: { payments:PaymentObligation[]; onExport:()=>void }) { const byCategory = Object.entries(payments.reduce<Record<string,number>>((a,p)=>{a[p.category]=(a[p.category]||0)+(p.billAmount||p.expectedAmount);return a;},{})).sort((a,b)=>b[1]-a[1]); return <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Expense & Cash-flow Reports</CardTitle><CardDescription>Category-wise expected expenditure across all cycles</CardDescription></div><Button onClick={onExport}><Download className="mr-2 h-4 w-4" />Export CSV</Button></CardHeader><CardContent className="space-y-3">{byCategory.map(([name,total])=><div key={name} className="flex items-center justify-between rounded-lg border p-3"><span>{name}</span><strong>{currency(total)}</strong></div>)}{!byCategory.length && <p className="py-10 text-center text-muted-foreground">Generate billing cycles to populate reports.</p>}</CardContent></Card>; }
function MasterDialog({ open,onClose,organizationId,categories,vendors }: { open:boolean;onClose:()=>void;organizationId:string;categories:NamedRecord[];vendors:NamedRecord[] }) {
  const { toast }=useToast(); const { users }=useAuth(); const [saving,setSaving]=useState(false);
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);const f=new FormData(e.currentTarget);try{await addDoc(collection(db,RP_COLLECTIONS.masters),{organizationId,title:f.get('title'),category:f.get('category'),vendorName:f.get('vendor'),accountNumber:f.get('account'),frequency:f.get('frequency'),amountType:f.get('amountType'),amount:Number(f.get('amount')),maximumAmount:Number(f.get('maximumAmount')||0),dueDay:Number(f.get('dueDay')),startDate:f.get('startDate'),assignedTo:f.get('assignedTo'),description:f.get('description'),status:'Active',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),deleted:false});toast({title:'Recurring master created'});onClose();}catch{toast({title:'Could not create master',variant:'destructive'});}finally{setSaving(false)}}
  return <Dialog open={open} onOpenChange={v=>!v&&onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>New recurring payment master</DialogTitle><DialogDescription>Create the template used for automatic billing cycles.</DialogDescription></DialogHeader><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><Field label="Payment title"><Input name="title" required /></Field><Field label="Category"><Select name="category" required><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{[...DEFAULT_PAYMENT_CATEGORIES,...categories.map(c=>c.name)].map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></Field><Field label="Vendor"><Input name="vendor" list="rp-vendors" required/><datalist id="rp-vendors">{vendors.map(v=><option key={v.id}>{v.name}</option>)}</datalist></Field><Field label="Account / consumer no."><Input name="account" /></Field><Field label="Frequency"><Select name="frequency" defaultValue="Monthly"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Weekly','Monthly','Bi-monthly','Quarterly','Half-yearly','Yearly','Custom'].map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></Field><Field label="Amount type"><Select name="amountType" defaultValue="Fixed"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Fixed','Variable','Estimated'].map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></Field><Field label="Expected / fixed amount"><Input name="amount" type="number" min="0" required /></Field><Field label="Maximum permitted amount"><Input name="maximumAmount" type="number" min="0" /></Field><Field label="Payment due day"><Input name="dueDay" type="number" min="1" max="28" defaultValue="5" required /></Field><Field label="Start date"><Input name="startDate" type="date" required /></Field><Field label="Assigned employee"><Select name="assignedTo" required><SelectTrigger><SelectValue placeholder="Select payment owner"/></SelectTrigger><SelectContent>{users.filter(u=>u.status==='Active').map(user=><SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent></Select></Field><div className="sm:col-span-2"><Field label="Description"><Textarea name="description" /></Field></div><DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={saving}>{saving&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Create master</Button></DialogFooter></form></DialogContent></Dialog>;
}
function NamedDialog({kind,onClose,organizationId}:{kind:'vendor'|'category'|null;onClose:()=>void;organizationId:string}){const {toast}=useToast();async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);await addDoc(collection(db,kind==='vendor'?RP_COLLECTIONS.vendors:RP_COLLECTIONS.categories),{organizationId,name:f.get('name'),contact:f.get('contact')||'',status:'Active',createdAt:serverTimestamp()});toast({title:`${kind==='vendor'?'Vendor':'Category'} added`});onClose()}return <Dialog open={!!kind} onOpenChange={v=>!v&&onClose()}><DialogContent><DialogHeader><DialogTitle>Add {kind}</DialogTitle></DialogHeader><form onSubmit={submit} className="space-y-4"><Field label="Name"><Input name="name" required/></Field>{kind==='vendor'&&<Field label="Contact / email"><Input name="contact"/></Field>}<DialogFooter><Button variant="outline" type="button" onClick={onClose}>Cancel</Button><Button>Add</Button></DialogFooter></form></DialogContent></Dialog>}
function PaymentDialog({payment,onClose,settings}:{payment:PaymentObligation|null;onClose:()=>void;settings:RecurringPaymentSettings}){const {toast}=useToast();const lockedByWorkflow=Boolean(payment&&['Scheduled','In Progress'].includes(payment.workflowStatus||''));const locked=Boolean(lockedByWorkflow||(payment&&['Paid','Closed'].includes(payment.status)&&settings.controls.lockClosedPayments&&!settings.controls.allowAuthorizedReopen));async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(!payment||locked)return;const f=new FormData(e.currentTarget);const status=f.get('status') as PaymentStatus;const ref=String(f.get('reference')||'');const billAmount=Number(f.get('billAmount')||0);if(settings.controls.requireBillBeforeApproval&&['Approved','Payment Processing','Paid','Closed'].includes(status)&&billAmount<=0){toast({title:'Bill amount is required before approval',variant:'destructive'});return}if(settings.controls.requireTransactionReference&&['Paid','Closed'].includes(status)&&!ref){toast({title:'Transaction reference is required',variant:'destructive'});return}await updateDoc(doc(db,RP_COLLECTIONS.payments,payment.id),{billAmount:billAmount||payment.expectedAmount,paidAmount:Number(f.get('paidAmount')||0),status,transactionReference:ref,paymentDate:f.get('paymentDate')||'',updatedAt:serverTimestamp()});toast({title:'Payment updated'});onClose()}return <Dialog open={!!payment} onOpenChange={v=>!v&&onClose()}><DialogContent><DialogHeader><DialogTitle>{payment?.title}</DialogTitle><DialogDescription>{lockedByWorkflow?payment?.workflowStatus==='Scheduled'?'This obligation is scheduled and will enter the workflow at the configured due-date threshold.':`Actions are locked here. The assigned person must use the ${payment?.stage} workflow queue.`:locked?'This closed payment is locked by organization policy.':`${payment?.vendorName} · due ${payment?.dueDate}`}</DialogDescription></DialogHeader>{payment&&<form onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><Field label="Bill amount"><Input disabled={locked} name="billAmount" type="number" defaultValue={payment.billAmount||payment.expectedAmount}/></Field><Field label="Paid amount"><Input disabled={locked} name="paidAmount" type="number" defaultValue={payment.paidAmount}/></Field><Field label="Status"><Select disabled={locked} name="status" defaultValue={payment.status}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{['Awaiting Bill','Bill Received','Under Verification','Pending Approval','Approved','Payment Processing','Partially Paid','Paid','Closed','Rejected','Disputed','Payment Failed','On Hold','Waived','Cancelled'].map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></Field><Field label="Payment date"><Input disabled={locked} name="paymentDate" type="date" defaultValue={payment.paymentDate}/></Field><div className="sm:col-span-2"><Field label="Transaction / UTR reference"><Input disabled={locked} name="reference" defaultValue={payment.transactionReference}/></Field></div><DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>{locked?'Close':'Cancel'}</Button>{!locked&&<Button>Save payment update</Button>}</DialogFooter></form>}</DialogContent></Dialog>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>}
