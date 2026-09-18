'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { AlertTriangle, ArrowLeft, BellRing, CheckCircle2, Edit3, ExternalLink, FileText, History, Loader2, MessageSquare, Pencil, Printer, ReceiptText, Send, ShieldCheck, Trash2, UploadCloud, WalletCards } from 'lucide-react';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  BANK_ACCOUNT_REQUIRED_MODES,
  DEFAULT_RECURRING_PAYMENT_SETTINGS,
  PAYMENT_MODES,
  RP_COLLECTIONS,
  currency,
  isObligationEditable,
  maskAccount,
  type PaymentMode,
  type PaymentObligation,
  type PaymentTransaction,
  type RecurringPaymentAuditLog,
  type RecurringPaymentSettings,
} from '@/lib/recurring-payments';
import PaymentPrintNote from './payment-print-note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  const [settings, setSettings] = useState<RecurringPaymentSettings>({ ...DEFAULT_RECURRING_PAYMENT_SETTINGS, organizationId });
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [editingTransaction, setEditingTransaction] = useState<PaymentTransaction | null>(null);

  useEffect(() => {
    const paymentRef = doc(db, RP_COLLECTIONS.payments, paymentId);
    const stops = [
      onSnapshot(paymentRef, snapshot => {
        const data = snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as PaymentObligation) : null;
        // `deleted` is checked here as well as in the registers: this page is reachable by direct
        // URL, and without it a soft-deleted obligation stayed fully openable — editable, and with
        // "Record payment" still offered — while being invisible in every list and excluded from
        // every report total. Treated as not found, which is what it is.
        const visible = data?.organizationId === organizationId && data.deleted !== true;
        setPayment(visible ? data : null);
        setLoading(false);
      }, () => setLoading(false)),
      onSnapshot(query(collection(paymentRef, RP_COLLECTIONS.transactions), orderBy('createdAt', 'desc')), snapshot => setTransactions(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as PaymentTransaction)))),
      onSnapshot(query(collection(paymentRef, RP_COLLECTIONS.auditLogs), orderBy('createdAt', 'desc')), snapshot => setAudit(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as RecurringPaymentAuditLog)))),
      onSnapshot(query(collection(paymentRef, RP_COLLECTIONS.comments), orderBy('createdAt', 'desc')), snapshot => setComments(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as CommentRecord)))),
      onSnapshot(query(collection(db, RP_COLLECTIONS.notificationQueue), where('paymentId', '==', paymentId)), snapshot => setNotifications(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as NotificationRecord)))),
      onSnapshot(doc(db, RP_COLLECTIONS.settings, organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')), snapshot => {
        if (!snapshot.exists()) return;
        const data = snapshot.data() as Partial<RecurringPaymentSettings>;
        setSettings({
          ...DEFAULT_RECURRING_PAYMENT_SETTINGS, ...data, organizationId,
          controls: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.controls, ...data.controls },
        });
      }),
    ];
    return () => stops.forEach(stop => stop());
  }, [organizationId, paymentId]);

  // Editing a recorded transaction mutates financial history, so it's locked exactly where the
  // org has already said closed payments should be locked — reusing the existing control rather
  // than inventing a separate one for this specific action.
  const transactionsLocked = Boolean(payment && settings.controls.lockClosedPayments && ['Closed', 'Cancelled', 'Waived'].includes(payment.status));
  // These are the module's own dedicated permission actions for this — "Record Payment" only
  // covers creating the first transaction on a step, it was never meant to gate correcting one
  // afterwards. Also accept "Record Payment" as a fallback for orgs that haven't granted the more
  // granular actions yet, so this doesn't silently disappear for anyone who could already record
  // payments before these dedicated actions existed in the UI.
  const canEditTransaction = can('Edit Transaction', 'Recurring Payments.Payment Processing') || can('Record Payment', 'Recurring Payments.Payments');
  const canUploadReceipt = canEditTransaction || can('Upload Receipt', 'Recurring Payments.Payment Processing');
  const [uploadingReceiptFor, setUploadingReceiptFor] = useState<PaymentTransaction | null>(null);

  async function uploadReceipt(file: FormDataEntryValue | null): Promise<string> {
    if (!(file instanceof File) || !file.size || !payment) return '';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadRef = storageRef(storage, `recurring-payments/${payment.organizationId}/${payment.id}/transactions/${Date.now()}-${safeName}`);
    await uploadBytes(uploadRef, file);
    return getDownloadURL(uploadRef);
  }

  async function saveReceiptOnly(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const original = uploadingReceiptFor;
    if (!original || !payment || !user) return;
    if (transactionsLocked) return toast({ title: 'This payment is closed and its transactions are locked', variant: 'destructive' });
    const form = new FormData(event.currentTarget);
    const receiptUrl = await uploadReceipt(form.get('receiptFile'));
    if (!receiptUrl) return toast({ title: 'Select a file to upload', variant: 'destructive' });
    const batch = writeBatch(db);
    batch.update(doc(db, RP_COLLECTIONS.payments, payment.id, RP_COLLECTIONS.transactions, original.id), { receiptUrl, updatedAt: serverTimestamp(), updatedBy: user.id });
    batch.set(doc(collection(db, RP_COLLECTIONS.payments, payment.id, RP_COLLECTIONS.auditLogs)), {
      organizationId, paymentId: payment.id, action: 'Receipt uploaded',
      summary: `Receipt attached to transaction of ${currency(original.amount)} dated ${original.paymentDate}`,
      userId: user.id, userName: user.name, createdAt: serverTimestamp(),
    });
    await batch.commit();
    setUploadingReceiptFor(null);
    toast({ title: 'Receipt uploaded' });
  }

  async function saveTransactionEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const original = editingTransaction;
    if (!original || !payment || !user) return;
    if (!canEditTransaction) return toast({ title: 'You do not have permission to edit transactions', variant: 'destructive' });
    if (transactionsLocked) return toast({ title: 'This payment is closed and its transactions are locked', variant: 'destructive' });
    const form = new FormData(event.currentTarget);
    const mode = String(form.get('mode') || original.mode) as PaymentMode;
    const amount = Number(form.get('amount') || 0);
    const bankAccount = String(form.get('bankAccount') || '').trim();
    const chequeNumber = String(form.get('chequeNumber') || '').trim();
    const transactionReference = String(form.get('transactionReference') || '').trim();
    if (amount <= 0) return toast({ title: 'Amount must be greater than zero', variant: 'destructive' });
    if (mode === 'Cheque' && !chequeNumber) return toast({ title: 'Cheque number is required for cheque payments', variant: 'destructive' });
    if (BANK_ACCOUNT_REQUIRED_MODES.includes(mode) && !bankAccount) return toast({ title: 'Bank account is required for electronic payments', variant: 'destructive' });
    if (transactionReference && transactions.some(item => item.id !== original.id && item.transactionReference === transactionReference)) {
      return toast({ title: 'This transaction reference has already been recorded on this payment', variant: 'destructive' });
    }
    const paidBy = String(form.get('paidBy') || original.paidBy);
    const updated: PaymentTransaction = {
      ...original,
      paymentDate: String(form.get('paymentDate') || original.paymentDate),
      amount,
      mode,
      bankAccount: mode === 'Cash' ? '' : bankAccount,
      transactionReference,
      chequeNumber: mode === 'Cheque' ? chequeNumber : '',
      tdsAmount: Number(form.get('tdsAmount') || 0),
      gstAmount: Number(form.get('gstAmount') || 0),
      deductionAmount: Number(form.get('deductionAmount') || 0),
      adjustmentAmount: Number(form.get('adjustmentAmount') || 0),
      remarks: String(form.get('remarks') || ''),
      paidBy,
      paidByName: users.find(entry => entry.id === paidBy)?.name || original.paidByName,
    };
    const receiptFile = form.get('receiptFile');
    if (receiptFile instanceof File && receiptFile.size) updated.receiptUrl = await uploadReceipt(receiptFile);

    const nextTransactions = transactions.map(item => (item.id === original.id ? updated : item));
    const paidAmount = nextTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const settledAmount = nextTransactions.reduce((sum, item) => sum + Number(item.amount || 0) + Number(item.tdsAmount || 0) + Number(item.deductionAmount || 0) + Number(item.adjustmentAmount || 0), 0);
    const obligationAmount = Number(payment.billAmount || payment.expectedAmount || 0);
    const outstandingAmount = Math.max(0, obligationAmount - settledAmount);

    const batch = writeBatch(db);
    const { id: _txId, ...updatedFields } = updated;
    batch.update(doc(db, RP_COLLECTIONS.payments, payment.id, RP_COLLECTIONS.transactions, original.id), { ...updatedFields, updatedAt: serverTimestamp(), updatedBy: user.id });
    const paymentPatch: Record<string, unknown> = { paidAmount, settledAmount, outstandingAmount, updatedAt: serverTimestamp() };
    if (['Paid', 'Partially Paid'].includes(payment.status)) paymentPatch.status = settledAmount >= obligationAmount - 0.01 ? 'Paid' : 'Partially Paid';
    batch.update(doc(db, RP_COLLECTIONS.payments, payment.id), paymentPatch);
    batch.set(doc(collection(db, RP_COLLECTIONS.payments, payment.id, RP_COLLECTIONS.auditLogs)), {
      organizationId, paymentId: payment.id, action: 'Transaction edited',
      summary: `${currency(original.amount)} → ${currency(updated.amount)} (${original.mode} → ${updated.mode})`,
      metadata: { transactionId: original.id, before: pickTransactionSnapshot(original), after: pickTransactionSnapshot(updated) },
      userId: user.id, userName: user.name, createdAt: serverTimestamp(),
    });
    await batch.commit();
    setEditingTransaction(null);
    toast({ title: 'Transaction updated' });
  }

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
    if (!payment || !user || !can('Cancel', 'Recurring Payments.Payments') || !window.confirm('Cancel this payment obligation? The record and audit history will be retained.')) return;
    const previousStatus = payment.status;
    const batch = writeBatch(db);
    batch.update(doc(db, RP_COLLECTIONS.payments, payment.id), { status: 'Cancelled', workflowStatus: 'Completed', currentStepId: null, assignees: [], updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, RP_COLLECTIONS.payments, payment.id, RP_COLLECTIONS.auditLogs)), { organizationId, paymentId: payment.id, action: 'Payment cancelled', summary: `${previousStatus} → Cancelled`, page: `/recurring-payments/payments/${payment.id}`, recordId: payment.id, previousValue: { status: previousStatus }, newValue: { status: 'Cancelled' }, userId: user.id, userName: user.name, createdAt: serverTimestamp() });
    await batch.commit();
    toast({ title: 'Payment cancelled and retained for audit' });
  }

  /**
   * Soft-deletes the obligation — see `visibleObligations`. Deliberately distinct from Cancel:
   * cancelling keeps the payment on the register as a closed, visible decision, whereas deleting
   * withdraws a record that should never have existed (a duplicate, a master misconfiguration)
   * while preserving its audit trail. Refused once money is recorded against it, because hiding a
   * settled obligation would pull it out of the paid totals reports reconcile against.
   */
  async function deletePayment() {
    if (!payment || !user || !can('Delete', 'Recurring Payments.Payments')) return;
    if (Number(payment.settledAmount || payment.paidAmount || 0) > 0)
      return toast({
        title: 'This payment has recorded transactions',
        description: 'Cancel it instead — deleting a settled obligation would remove it from paid totals.',
        variant: 'destructive',
      });
    if (!window.confirm('Delete this payment obligation? It is hidden from all registers and reports, and the audit history is retained.')) return;
    const batch = writeBatch(db);
    batch.update(doc(db, RP_COLLECTIONS.payments, payment.id), { deleted: true, deletedAt: serverTimestamp(), deletedBy: user.id, updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, RP_COLLECTIONS.payments, payment.id, RP_COLLECTIONS.auditLogs)), { organizationId, paymentId: payment.id, action: 'Payment deleted', summary: `${payment.title} (${payment.status}) hidden from registers and reports`, page: `/recurring-payments/payments/${payment.id}`, recordId: payment.id, previousValue: { deleted: false, status: payment.status }, newValue: { deleted: true }, userId: user.id, userName: user.name, createdAt: serverTimestamp() });
    await batch.commit();
    toast({ title: 'Payment deleted and retained for audit' });
    router.push('/recurring-payments/payments');
  }

  if (loading) return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>;
  if (!payment) return <Card><CardContent className="py-16 text-center"><AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" /><p className="font-semibold">Payment not found or access denied</p><Button className="mt-4" variant="outline" onClick={() => router.push('/recurring-payments/payments')}>Back to payments</Button></CardContent></Card>;

  return <>
    {/* The printable document. Rendered alongside the live UI rather than in a separate route so
        it always reflects the record currently on screen; `@media print` swaps which is visible. */}
    <div className="rp-print-document">
      <PaymentPrintNote
        payment={payment}
        organizationName={user?.organizationName || organizationId}
        ownerName={userName(payment.assignedTo, users)}
        approverNames={(payment.approvalLevels || []).map(id => userName(id, users))}
        transactions={transactions}
      />
    </div>
    <div className="space-y-5 rp-print-hide"><Card className="border-0 bg-gradient-to-r from-slate-950 via-indigo-950 to-violet-900 text-white"><CardContent className="space-y-4 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="flex gap-3"><Button variant="secondary" size="icon" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></Button><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{payment.title}</h1><Badge className="bg-white/15 text-white hover:bg-white/20">{payment.status}</Badge><Badge variant="outline" className="border-white/30 text-white">{payment.priority || 'Normal'}</Badge></div><p className="mt-1 text-sm text-indigo-100">Payment ID {payment.id} · {payment.vendorName} · {payment.sourceType || 'Recurring'}</p><p className={`mt-1 text-sm ${days < 0 ? 'text-red-300' : 'text-indigo-200'}`}>{days < 0 ? `${Math.abs(days)} day(s) overdue` : days === 0 ? 'Due today' : `Due in ${days} day(s)`}</p></div></div><div className="flex flex-wrap gap-2 print:hidden"><Button variant="secondary" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print note</Button>{can('Edit', 'Recurring Payments.Payments') && isObligationEditable(payment) && <Link href={`/recurring-payments/payments/${payment.id}/edit`}><Button variant="secondary"><Pencil className="mr-2 h-4 w-4" />Edit</Button></Link>}{can('Delete', 'Recurring Payments.Payments') && <Button variant="destructive" onClick={deletePayment}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>}{canAct && <Link href={`/recurring-payments/stage/${payment.currentStepId}`}><Button className="bg-white text-indigo-800 hover:bg-indigo-50"><ExternalLink className="mr-2 h-4 w-4" />Open assigned action</Button></Link>}{can('Record Payment', 'Recurring Payments.Payments') && ['Approved', 'Payment Processing', 'Partially Paid'].includes(payment.status) && <Link href={`/recurring-payments/payments/${payment.id}/record-payment`}><Button className="bg-emerald-500 hover:bg-emerald-400"><WalletCards className="mr-2 h-4 w-4" />Record payment</Button></Link>}{can('Cancel', 'Recurring Payments.Payments') && !['Closed', 'Cancelled'].includes(payment.status) && <Button variant="destructive" onClick={cancelPayment}>Cancel</Button>}</div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><HeaderInfo label="Organization" value={user?.organizationName || organizationId} /><HeaderInfo label="Branch / project" value={payment.projectName || payment.branchName || 'Organization-wide'} /><HeaderInfo label="Due date" value={payment.dueDate} /><HeaderInfo label="Owner" value={userName(payment.assignedTo, users)} /><HeaderInfo label="Current stage" value={payment.stage || '—'} /></div></CardContent></Card>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric label="Expected" value={currency(payment.expectedAmount)} /><Metric label="Bill" value={currency(payment.billAmount || 0)} /><Metric label="Approved" value={currency(payment.approvedAmount || payment.netPayableAmount || payment.billAmount || 0)} /><Metric label="Paid" value={currency(payment.paidAmount || 0)} /><Metric label="Balance" value={currency(outstanding)} /><Metric label="Variance" value={`${Number(payment.variancePercent || 0).toFixed(1)}%`} alert={payment.varianceWarning} /></div>
    <Tabs defaultValue="overview"><TabsList className="flex h-auto flex-wrap"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="bill">Bill Details</TabsTrigger><TabsTrigger value="approval">Approval Workflow</TabsTrigger><TabsTrigger value="transactions">Transactions</TabsTrigger><TabsTrigger value="documents">Documents</TabsTrigger><TabsTrigger value="comments">Comments</TabsTrigger><TabsTrigger value="notifications">Notifications</TabsTrigger><TabsTrigger value="audit">Audit Log</TabsTrigger></TabsList>
      <TabsContent value="overview"><Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3"><Info label="Billing period" value={`${payment.billingPeriodStart} to ${payment.billingPeriodEnd}`} /><Info label="Bill number" value={payment.billNumber || 'Not received'} /><Info label="Bill date" value={payment.billDate || payment.billReceivedDate || '—'} /><Info label="Category" value={payment.category} /><Info label="Vendor" value={payment.vendorName} /><Info label="Account reference" value={maskAccount(payment.accountNumber) || '—'} /><Info label="Cost centre" value={payment.costCentre || '—'} /><Info label="General ledger" value={payment.ledger || '—'} /><Info label="Description" value={payment.description || '—'} />{payment.expenseRequestNo && <Info label="Expense request no." value={payment.expenseRequestNo} />}</CardContent></Card></TabsContent>
      <TabsContent value="bill"><Card><CardHeader><CardTitle>Bill calculation and controls</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Info label="Base bill" value={currency(payment.billAmount || 0)} /><Info label="Tax" value={currency(payment.taxAmount || 0)} /><Info label="TDS" value={currency(payment.tdsAmount || 0)} /><Info label="Other deductions" value={currency(payment.deductionAmount || 0)} /><Info label="Adjustment" value={currency(payment.adjustmentAmount || 0)} /><Info label="Net payable" value={currency(payment.netPayableAmount || payment.billAmount || payment.expectedAmount)} /><Info label="Previous bill" value={currency(payment.varianceComparisons?.previous || 0)} /><Info label="Average of 3" value={currency(payment.varianceComparisons?.average3 || 0)} /><Info label="Average of 6" value={currency(payment.varianceComparisons?.average6 || 0)} /><Info label="Maximum limit" value={currency(payment.maximumAmount || 0)} /></CardContent></Card></TabsContent>
      <TabsContent value="approval"><Card><CardHeader><CardTitle>Approval path</CardTitle><CardDescription>{payment.approvalMode || 'Workflow assignment'} · current level {payment.currentApprovalLevel || 0}</CardDescription></CardHeader><CardContent className="space-y-3">{(payment.approvalLevels || []).map((approverId, index) => { const complete = (payment.approvalCompletedBy || []).includes(approverId); const pending = currentApprover === approverId || (payment.approvalMode === 'Parallel' && !complete); return <div className="flex items-center gap-3 rounded-xl border p-3" key={`${approverId}-${index}`}><div className={`rounded-full p-2 ${complete ? 'bg-emerald-100 text-emerald-600' : pending ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>{complete ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</div><div><p className="font-medium">Level {index + 1} · {userName(approverId, users)}</p><p className="text-xs text-muted-foreground">{complete ? 'Approved' : pending ? 'Pending action' : 'Waiting for previous level'}</p></div></div>; })}{!(payment.approvalLevels || []).length && <p className="py-8 text-center text-sm text-muted-foreground">The configured workflow controls approval assignment.</p>}</CardContent></Card></TabsContent>
      <TabsContent value="transactions">
        <Card>
          {transactionsLocked && <CardDescription className="px-5 pt-4 text-amber-600">This payment is closed — transactions are locked from editing.</CardDescription>}
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Bank account</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Paid by</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Receipt</TableHead>
                  {(canEditTransaction || canUploadReceipt) && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map(transaction => (
                  <TableRow key={transaction.id}>
                    <TableCell className="whitespace-nowrap">{transaction.paymentDate}</TableCell>
                    <TableCell className="whitespace-nowrap">{transaction.mode}</TableCell>
                    <TableCell className="whitespace-nowrap">{maskAccount(transaction.bankAccount)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{transaction.transactionReference}</TableCell>
                    <TableCell className="whitespace-nowrap">{transaction.paidByName}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{currency(transaction.amount)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {transaction.receiptUrl
                        ? <a href={transaction.receiptUrl} target="_blank" rel="noreferrer"><Button variant="outline" size="sm"><ReceiptText className="mr-1 h-3 w-3" />View</Button></a>
                        : <Badge variant="outline">No receipt uploaded</Badge>}
                    </TableCell>
                    {(canEditTransaction || canUploadReceipt) && (
                      <TableCell className="whitespace-nowrap text-right space-x-1">
                        {canEditTransaction && (
                          <Button variant="ghost" size="sm" disabled={transactionsLocked} onClick={() => setEditingTransaction(transaction)}>
                            <Edit3 className="mr-1 h-3 w-3" />Edit
                          </Button>
                        )}
                        {!canEditTransaction && canUploadReceipt && (
                          <Button variant="ghost" size="sm" disabled={transactionsLocked} onClick={() => setUploadingReceiptFor(transaction)}>
                            <UploadCloud className="mr-1 h-3 w-3" />{transaction.receiptUrl ? 'Replace receipt' : 'Upload receipt'}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!transactions.length && (
                  <TableRow>
                    <TableCell colSpan={canEditTransaction || canUploadReceipt ? 8 : 7} className="h-28 text-center text-muted-foreground">No transactions recorded.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="documents"><Card><CardHeader><CardTitle>Document register</CardTitle><CardDescription>{hasReceipt ? 'Payment proof is available.' : 'Payment proof is currently missing.'}</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{documents.map((document, index) => <a href={document.reference} target="_blank" rel="noreferrer" className="flex gap-3 rounded-xl border p-4 hover:bg-muted" key={`${document.reference}-${index}`}><FileText className="h-5 w-5 text-indigo-600" /><div><p className="font-medium">{document.category || document.action}</p><p className="text-xs text-muted-foreground">Version {document.version || 1} · {document.fileType || 'document'}</p><p className="text-xs text-muted-foreground">{formatTimestamp(document.addedAt)}</p></div></a>)}{!documents.length && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No documents uploaded.</p>}</CardContent></Card></TabsContent>
      <TabsContent value="comments"><Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />Comments and mentions</CardTitle></CardHeader><CardContent className="space-y-4">{can('Add Comment', 'Recurring Payments.Payments') && <div className="space-y-2"><Label>Add comment</Label><Textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Add remarks; mention a user with @Name" /><Button onClick={addComment} disabled={!comment.trim()}><Send className="mr-2 h-4 w-4" />Add comment</Button></div>}<div className="space-y-3">{comments.map(item => <div className="rounded-xl border p-3" key={item.id}><p className="text-sm">{item.message}</p><p className="mt-2 text-xs text-muted-foreground">{item.userName} · {formatTimestamp(item.createdAt)}</p></div>)}{!comments.length && <p className="py-8 text-center text-sm text-muted-foreground">No comments yet.</p>}</div></CardContent></Card></TabsContent>
      <TabsContent value="notifications"><Card><CardHeader><CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5" />Reminder and escalation history</CardTitle></CardHeader><CardContent className="space-y-3">{notifications.map(item => <div className="flex items-center justify-between rounded-xl border p-3" key={item.id}><div><p className="font-medium">{item.title || 'Payment reminder'}</p><p className="text-xs text-muted-foreground">{(item.channels || []).join(', ') || 'Configured channels'} · {formatTimestamp(item.createdAt)}</p></div><Badge variant="outline">{item.status || 'Pending'}</Badge></div>)}{!notifications.length && <p className="py-8 text-center text-sm text-muted-foreground">No reminder history for this payment.</p>}</CardContent></Card></TabsContent>
      <TabsContent value="audit"><Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Immutable audit trail</CardTitle></CardHeader><CardContent className="space-y-3">{audit.map(item => <div className="flex items-start justify-between gap-4 rounded-xl border p-3" key={item.id}><div><p className="font-medium">{item.action}</p><p className="text-sm text-muted-foreground">{item.summary}</p><p className="text-xs text-muted-foreground">{item.userName}</p></div><span className="whitespace-nowrap text-xs text-muted-foreground">{formatTimestamp(item.createdAt)}</span></div>)}{!audit.length && <p className="py-8 text-center text-sm text-muted-foreground">No audit entries recorded.</p>}</CardContent></Card></TabsContent>
    </Tabs></div>
    {editingTransaction && (
      <EditTransactionDialog
        transaction={editingTransaction}
        users={users}
        onClose={() => setEditingTransaction(null)}
        onSubmit={saveTransactionEdit}
      />
    )}
    {uploadingReceiptFor && (
      <UploadReceiptDialog
        transaction={uploadingReceiptFor}
        onClose={() => setUploadingReceiptFor(null)}
        onSubmit={saveReceiptOnly}
      />
    )}
  </>;
}

function pickTransactionSnapshot(transaction: PaymentTransaction) {
  const { amount, mode, bankAccount, transactionReference, chequeNumber, tdsAmount, gstAmount, deductionAmount, adjustmentAmount, paidByName } = transaction;
  return { amount, mode, bankAccount, transactionReference, chequeNumber, tdsAmount, gstAmount, deductionAmount, adjustmentAmount, paidByName };
}

function EditTransactionDialog({
  transaction, users, onClose, onSubmit,
}: {
  transaction: PaymentTransaction;
  users: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [mode, setMode] = useState<PaymentMode>(transaction.mode);
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit transaction</DialogTitle>
          <DialogDescription>
            Corrects a recorded payment transaction. The obligation&apos;s paid/outstanding
            totals and status are recalculated automatically; an audit entry records what changed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FieldRow label="Payment date">
              <Input name="paymentDate" type="date" defaultValue={transaction.paymentDate} required />
            </FieldRow>
            <FieldRow label="Amount">
              <Input name="amount" type="number" min="0.01" step="0.01" defaultValue={transaction.amount} required />
            </FieldRow>
            <FieldRow label="Mode">
              <Select name="mode" value={mode} onValueChange={value => setMode(value as PaymentMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map(item => <SelectItem value={item} key={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </FieldRow>
            {mode !== 'Cash' && (
              <FieldRow label="Bank account">
                <Input name="bankAccount" defaultValue={transaction.bankAccount} required={BANK_ACCOUNT_REQUIRED_MODES.includes(mode)} />
              </FieldRow>
            )}
            {mode === 'Cheque' && (
              <FieldRow label="Cheque number">
                <Input name="chequeNumber" defaultValue={transaction.chequeNumber} required />
              </FieldRow>
            )}
            <FieldRow label={mode === 'Cash' ? 'Cash voucher / receipt no.' : 'Transaction / UTR'}>
              <Input name="transactionReference" defaultValue={transaction.transactionReference} />
            </FieldRow>
            <FieldRow label="TDS amount">
              <Input name="tdsAmount" type="number" min="0" defaultValue={transaction.tdsAmount || 0} />
            </FieldRow>
            <FieldRow label="GST amount">
              <Input name="gstAmount" type="number" min="0" defaultValue={transaction.gstAmount || 0} />
            </FieldRow>
            <FieldRow label="Other deduction">
              <Input name="deductionAmount" type="number" min="0" defaultValue={transaction.deductionAmount || 0} />
            </FieldRow>
            <FieldRow label="Adjustment">
              <Input name="adjustmentAmount" type="number" defaultValue={transaction.adjustmentAmount || 0} />
            </FieldRow>
            <FieldRow label="Paid by">
              <Select name="paidBy" defaultValue={transaction.paidBy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {users.map(entry => <SelectItem value={entry.id} key={entry.id}>{entry.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label={transaction.receiptUrl ? 'Replace receipt' : 'Upload receipt'}>
              <Input name="receiptFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" />
            </FieldRow>
          </div>
          <FieldRow label="Remarks">
            <Textarea name="remarks" defaultValue={transaction.remarks} placeholder="Reason for this correction (kept in the audit trail)" />
          </FieldRow>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

/** For users granted only "Upload Receipt" (not "Edit Transaction") — lets them attach proof to
 * a past payment without exposing any of the financial fields they're not permitted to change. */
function UploadReceiptDialog({
  transaction, onClose, onSubmit,
}: {
  transaction: PaymentTransaction;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{transaction.receiptUrl ? 'Replace receipt' : 'Upload receipt'}</DialogTitle>
          <DialogDescription>
            {currency(transaction.amount)} paid on {transaction.paymentDate} via {transaction.mode}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <FieldRow label="Receipt file">
            <Input name="receiptFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" required />
          </FieldRow>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Upload</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function HeaderInfo({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-white/10 p-3"><p className="text-[11px] text-indigo-200">{label}</p><p className="truncate text-sm font-medium">{value}</p></div>; }
function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) { return <Card className={alert ? 'border-amber-300 bg-amber-50' : ''}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-bold ${alert ? 'text-amber-700' : ''}`}>{value}</p></CardContent></Card>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>; }
function userName(id: string | undefined, users: Array<{ id: string; name: string }>) { return users.find(item => item.id === id)?.name || id || 'Unassigned'; }
function daysUntil(value: string) { const due = new Date(`${value}T00:00:00`); const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return Math.round((due.getTime() - today.getTime()) / 86_400_000); }
function formatTimestamp(value: unknown) { const timestamp = value as { toDate?: () => Date; seconds?: number } | null; if (timestamp?.toDate) return timestamp.toDate().toLocaleString('en-IN'); if (timestamp?.seconds) return new Date(timestamp.seconds * 1000).toLocaleString('en-IN'); return '—'; }
