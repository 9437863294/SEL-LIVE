'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, BellRing, CheckCircle2, ExternalLink, FileText, History, Loader2, MessageSquare, Printer, ReceiptText, Send, ShieldCheck, WalletCards } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { type PaymentObligation, type PaymentTransaction, type RecurringPaymentAuditLog, RP_COLLECTIONS, currency, maskAccount } from '@/lib/recurring-payments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type CommentRecord = { id: string; message: string; userId: string; userName: string; mentions?: string[]; createdAt: unknown };
type NotificationRecord = { id: string; title?: string; status?: string; channels?: string[]; daysUntilDue?: number; createdAt?: unknown };

export default function RecurringPaymentDetailPage({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [payment, setPayment] = useState<PaymentObligation | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [audit, setAudit] = useState<RecurringPaymentAuditLog[]>([]);
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');

  useEffect(() => {
    const paymentRef = doc(db, RP_COLLECTIONS.payments, paymentId);
    const stops = [
      onSnapshot(paymentRef, snapshot => {
        const data = snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as PaymentObligation) : null;
        setPayment(data?.organizationId === organizationId ? data : null);
        setLoading(false);
      }, () => setLoading(false)),
      onSnapshot(query(collection(paymentRef, RP_COLLECTIONS.transactions), orderBy('createdAt', 'desc')), snapshot => setTransactions(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as PaymentTransaction)))),
      onSnapshot(query(collection(paymentRef, RP_COLLECTIONS.auditLogs), orderBy('createdAt', 'desc')), snapshot => setAudit(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as RecurringPaymentAuditLog)))),
      onSnapshot(query(collection(paymentRef, RP_COLLECTIONS.comments), orderBy('createdAt', 'desc')), snapshot => setComments(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as CommentRecord)))),
      onSnapshot(query(collection(db, RP_COLLECTIONS.notificationQueue), where('paymentId', '==', paymentId)), snapshot => setNotifications(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as NotificationRecord)))),
    ];
    return () => stops.forEach(stop => stop());
  }, [organizationId, paymentId]);

  const amount = Number(payment?.netPayableAmount || payment?.billAmount || payment?.expectedAmount || 0);
  const outstanding = Math.max(0, amount - Number(payment?.settledAmount || payment?.paidAmount || 0));
  const currentApprover = payment?.approvalMode === 'Sequential' ? payment.approvalLevels?.[Math.max(0, Number(payment.currentApprovalLevel || 1) - 1)] : undefined;
  const days = payment ? daysUntil(payment.dueDate) : 0;
  const canAct = Boolean(payment?.currentStepId && (payment.assignees || []).includes(user?.id || ''));
  const documents = payment?.documentReferences || [];
  const hasReceipt = documents.some(item => ['Record Payment', 'Close'].includes(item.action));

  async function addComment() {
    if (!payment || !user || !comment.trim()) return;
    const mentions = users.filter(item => comment.toLowerCase().includes(`@${item.name.toLowerCase()}`)).map(item => item.id);
    const commentRef = doc(collection(db, RP_COLLECTIONS.payments, payment.id, RP_COLLECTIONS.comments));
    const auditRef = doc(collection(db, RP_COLLECTIONS.payments, payment.id, RP_COLLECTIONS.auditLogs));
    const batch = writeBatch(db);
    batch.set(commentRef, { organizationId, paymentId: payment.id, message: comment.trim(), userId: user.id, userName: user.name, mentions, createdAt: serverTimestamp() });
    batch.set(auditRef, { organizationId, paymentId: payment.id, action: 'Comment added', summary: comment.trim(), page: `/recurring-payments/payments/${payment.id}`, recordId: payment.id, userId: user.id, userName: user.name, createdAt: serverTimestamp() });
    await batch.commit();
    setComment('');
    toast({ title: 'Comment added' });
  }

  async function cancelPayment() {
    if (!payment || !user || !can('Edit', 'Recurring Payments.Payments') || !window.confirm('Cancel this payment obligation? The record and audit history will be retained.')) return;
    const previousStatus = payment.status;
    const batch = writeBatch(db);
    batch.update(doc(db, RP_COLLECTIONS.payments, payment.id), { status: 'Cancelled', workflowStatus: 'Completed', currentStepId: null, assignees: [], updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, RP_COLLECTIONS.payments, payment.id, RP_COLLECTIONS.auditLogs)), { organizationId, paymentId: payment.id, action: 'Payment cancelled', summary: `${previousStatus} → Cancelled`, page: `/recurring-payments/payments/${payment.id}`, recordId: payment.id, previousValue: { status: previousStatus }, newValue: { status: 'Cancelled' }, userId: user.id, userName: user.name, createdAt: serverTimestamp() });
    await batch.commit();
    toast({ title: 'Payment cancelled and retained for audit' });
  }

  if (loading) return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>;
  if (!payment) return <Card><CardContent className="py-16 text-center"><AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" /><p className="font-semibold">Payment not found or access denied</p><Button className="mt-4" variant="outline" onClick={() => router.push('/recurring-payments/payments')}>Back to payments</Button></CardContent></Card>;

  return <div className="space-y-5"><Card className="border-0 bg-gradient-to-r from-slate-950 via-indigo-950 to-violet-900 text-white"><CardContent className="space-y-4 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="flex gap-3"><Button variant="secondary" size="icon" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></Button><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{payment.title}</h1><Badge className="bg-white/15 text-white hover:bg-white/20">{payment.status}</Badge><Badge variant="outline" className="border-white/30 text-white">{payment.priority || 'Normal'}</Badge></div><p className="mt-1 text-sm text-indigo-100">Payment ID {payment.id} · {payment.vendorName} · {payment.sourceType || 'Recurring'}</p><p className={`mt-1 text-sm ${days < 0 ? 'text-red-300' : 'text-indigo-200'}`}>{days < 0 ? `${Math.abs(days)} day(s) overdue` : days === 0 ? 'Due today' : `Due in ${days} day(s)`}</p></div></div><div className="flex flex-wrap gap-2 print:hidden"><Button variant="secondary" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print note</Button>{can('Edit', 'Recurring Payments.Payments') && ['Draft', 'Generated', 'Awaiting Bill', 'Returned for Correction'].includes(payment.status) && <Link href={`/recurring-payments/payments/${payment.id}/edit`}><Button variant="secondary">Edit</Button></Link>}{canAct && <Link href={`/recurring-payments/stage/${payment.currentStepId}`}><Button className="bg-white text-indigo-800 hover:bg-indigo-50"><ExternalLink className="mr-2 h-4 w-4" />Open assigned action</Button></Link>}{can('Record Payment', 'Recurring Payments.Payments') && ['Approved', 'Payment Processing', 'Partially Paid'].includes(payment.status) && <Link href={`/recurring-payments/payments/${payment.id}/record-payment`}><Button className="bg-emerald-500 hover:bg-emerald-400"><WalletCards className="mr-2 h-4 w-4" />Record payment</Button></Link>}{can('Edit', 'Recurring Payments.Payments') && !['Closed', 'Cancelled'].includes(payment.status) && <Button variant="destructive" onClick={cancelPayment}>Cancel</Button>}</div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><HeaderInfo label="Organization" value={user?.organizationName || organizationId} /><HeaderInfo label="Branch / project" value={payment.projectName || payment.branchName || 'Organization-wide'} /><HeaderInfo label="Due date" value={payment.dueDate} /><HeaderInfo label="Owner" value={userName(payment.assignedTo, users)} /><HeaderInfo label="Current stage" value={payment.stage || '—'} /></div></CardContent></Card>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric label="Expected" value={currency(payment.expectedAmount)} /><Metric label="Bill" value={currency(payment.billAmount || 0)} /><Metric label="Approved" value={currency(payment.approvedAmount || payment.netPayableAmount || payment.billAmount || 0)} /><Metric label="Paid" value={currency(payment.paidAmount || 0)} /><Metric label="Balance" value={currency(outstanding)} /><Metric label="Variance" value={`${Number(payment.variancePercent || 0).toFixed(1)}%`} alert={payment.varianceWarning} /></div>
    <Tabs defaultValue="overview"><TabsList className="flex h-auto flex-wrap"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="bill">Bill Details</TabsTrigger><TabsTrigger value="approval">Approval Workflow</TabsTrigger><TabsTrigger value="transactions">Transactions</TabsTrigger><TabsTrigger value="documents">Documents</TabsTrigger><TabsTrigger value="comments">Comments</TabsTrigger><TabsTrigger value="notifications">Notifications</TabsTrigger><TabsTrigger value="audit">Audit Log</TabsTrigger></TabsList>
      <TabsContent value="overview"><Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3"><Info label="Billing period" value={`${payment.billingPeriodStart} to ${payment.billingPeriodEnd}`} /><Info label="Bill number" value={payment.billNumber || 'Not received'} /><Info label="Bill date" value={payment.billDate || payment.billReceivedDate || '—'} /><Info label="Category" value={payment.category} /><Info label="Vendor" value={payment.vendorName} /><Info label="Account reference" value={maskAccount(payment.accountNumber) || '—'} /><Info label="Cost centre" value={payment.costCentre || '—'} /><Info label="General ledger" value={payment.ledger || '—'} /><Info label="Description" value={payment.description || '—'} /></CardContent></Card></TabsContent>
      <TabsContent value="bill"><Card><CardHeader><CardTitle>Bill calculation and controls</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Info label="Base bill" value={currency(payment.billAmount || 0)} /><Info label="Tax" value={currency(payment.taxAmount || 0)} /><Info label="TDS" value={currency(payment.tdsAmount || 0)} /><Info label="Other deductions" value={currency(payment.deductionAmount || 0)} /><Info label="Adjustment" value={currency(payment.adjustmentAmount || 0)} /><Info label="Net payable" value={currency(payment.netPayableAmount || payment.billAmount || payment.expectedAmount)} /><Info label="Previous bill" value={currency(payment.varianceComparisons?.previous || 0)} /><Info label="Average of 3" value={currency(payment.varianceComparisons?.average3 || 0)} /><Info label="Average of 6" value={currency(payment.varianceComparisons?.average6 || 0)} /><Info label="Maximum limit" value={currency(payment.maximumAmount || 0)} /></CardContent></Card></TabsContent>
      <TabsContent value="approval"><Card><CardHeader><CardTitle>Approval path</CardTitle><CardDescription>{payment.approvalMode || 'Workflow assignment'} · current level {payment.currentApprovalLevel || 0}</CardDescription></CardHeader><CardContent className="space-y-3">{(payment.approvalLevels || []).map((approverId, index) => { const complete = (payment.approvalCompletedBy || []).includes(approverId); const pending = currentApprover === approverId || (payment.approvalMode === 'Parallel' && !complete); return <div className="flex items-center gap-3 rounded-xl border p-3" key={`${approverId}-${index}`}><div className={`rounded-full p-2 ${complete ? 'bg-emerald-100 text-emerald-600' : pending ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>{complete ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</div><div><p className="font-medium">Level {index + 1} · {userName(approverId, users)}</p><p className="text-xs text-muted-foreground">{complete ? 'Approved' : pending ? 'Pending action' : 'Waiting for previous level'}</p></div></div>; })}{!(payment.approvalLevels || []).length && <p className="py-8 text-center text-sm text-muted-foreground">The configured workflow controls approval assignment.</p>}</CardContent></Card></TabsContent>
      <TabsContent value="transactions"><Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Mode / bank</TableHead><TableHead>Reference</TableHead><TableHead>Paid by</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Receipt</TableHead></TableRow></TableHeader><TableBody>{transactions.map(transaction => <TableRow key={transaction.id}><TableCell>{transaction.paymentDate}</TableCell><TableCell>{transaction.mode}<p className="text-xs text-muted-foreground">{maskAccount(transaction.bankAccount)}</p></TableCell><TableCell className="font-mono text-xs">{transaction.transactionReference}</TableCell><TableCell>{transaction.paidByName}</TableCell><TableCell className="text-right font-semibold">{currency(transaction.amount)}</TableCell><TableCell>{transaction.receiptUrl ? <a href={transaction.receiptUrl} target="_blank" rel="noreferrer"><Button variant="outline" size="sm"><ReceiptText className="mr-1 h-3 w-3" />View</Button></a> : <Badge variant="outline">Pending</Badge>}</TableCell></TableRow>)}{!transactions.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No transactions recorded.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>
      <TabsContent value="documents"><Card><CardHeader><CardTitle>Document register</CardTitle><CardDescription>{hasReceipt ? 'Payment proof is available.' : 'Payment proof is currently missing.'}</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{documents.map((document, index) => <a href={document.reference} target="_blank" rel="noreferrer" className="flex gap-3 rounded-xl border p-4 hover:bg-muted" key={`${document.reference}-${index}`}><FileText className="h-5 w-5 text-indigo-600" /><div><p className="font-medium">{document.category || document.action}</p><p className="text-xs text-muted-foreground">Version {document.version || 1} · {document.fileType || 'document'}</p><p className="text-xs text-muted-foreground">{formatTimestamp(document.addedAt)}</p></div></a>)}{!documents.length && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No documents uploaded.</p>}</CardContent></Card></TabsContent>
      <TabsContent value="comments"><Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />Comments and mentions</CardTitle></CardHeader><CardContent className="space-y-4">{can('Edit', 'Recurring Payments.Payments') && <div className="space-y-2"><Label>Add comment</Label><Textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Add remarks; mention a user with @Name" /><Button onClick={addComment} disabled={!comment.trim()}><Send className="mr-2 h-4 w-4" />Add comment</Button></div>}<div className="space-y-3">{comments.map(item => <div className="rounded-xl border p-3" key={item.id}><p className="text-sm">{item.message}</p><p className="mt-2 text-xs text-muted-foreground">{item.userName} · {formatTimestamp(item.createdAt)}</p></div>)}{!comments.length && <p className="py-8 text-center text-sm text-muted-foreground">No comments yet.</p>}</div></CardContent></Card></TabsContent>
      <TabsContent value="notifications"><Card><CardHeader><CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5" />Reminder and escalation history</CardTitle></CardHeader><CardContent className="space-y-3">{notifications.map(item => <div className="flex items-center justify-between rounded-xl border p-3" key={item.id}><div><p className="font-medium">{item.title || 'Payment reminder'}</p><p className="text-xs text-muted-foreground">{(item.channels || []).join(', ') || 'Configured channels'} · {formatTimestamp(item.createdAt)}</p></div><Badge variant="outline">{item.status || 'Pending'}</Badge></div>)}{!notifications.length && <p className="py-8 text-center text-sm text-muted-foreground">No reminder history for this payment.</p>}</CardContent></Card></TabsContent>
      <TabsContent value="audit"><Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Immutable audit trail</CardTitle></CardHeader><CardContent className="space-y-3">{audit.map(item => <div className="flex items-start justify-between gap-4 rounded-xl border p-3" key={item.id}><div><p className="font-medium">{item.action}</p><p className="text-sm text-muted-foreground">{item.summary}</p><p className="text-xs text-muted-foreground">{item.userName}</p></div><span className="whitespace-nowrap text-xs text-muted-foreground">{formatTimestamp(item.createdAt)}</span></div>)}{!audit.length && <p className="py-8 text-center text-sm text-muted-foreground">No audit entries recorded.</p>}</CardContent></Card></TabsContent>
    </Tabs></div>;
}

function HeaderInfo({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-white/10 p-3"><p className="text-[11px] text-indigo-200">{label}</p><p className="truncate text-sm font-medium">{value}</p></div>; }
function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) { return <Card className={alert ? 'border-amber-300 bg-amber-50' : ''}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-bold ${alert ? 'text-amber-700' : ''}`}>{value}</p></CardContent></Card>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>; }
function userName(id: string | undefined, users: Array<{ id: string; name: string }>) { return users.find(item => item.id === id)?.name || id || 'Unassigned'; }
function daysUntil(value: string) { const due = new Date(`${value}T00:00:00`); const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return Math.round((due.getTime() - today.getTime()) / 86_400_000); }
function formatTimestamp(value: unknown) { const timestamp = value as { toDate?: () => Date; seconds?: number } | null; if (timestamp?.toDate) return timestamp.toDate().toLocaleString('en-IN'); if (timestamp?.seconds) return new Date(timestamp.seconds * 1000).toLocaleString('en-IN'); return '—'; }
