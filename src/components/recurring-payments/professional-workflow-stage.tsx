'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { AlertTriangle, CheckCircle2, Clock3, Eye, FileText, Loader2, MoreHorizontal, ShieldCheck } from 'lucide-react';
import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { createExpenseRequest } from '@/ai';
import type { AccountHead, Department, SubAccountHead } from '@/lib/types';
import {
  BANK_ACCOUNT_REQUIRED_MODES,
  DEFAULT_RECURRING_PAYMENT_SETTINGS,
  DEFAULT_RECURRING_WORKFLOW,
  PAYMENT_MODES,
  resolveAssignees,
  stepStatus,
  type PaymentMode,
  type PaymentObligation,
  type RecurringPaymentSettings,
  type RecurringWorkflowHistoryEntry,
  type RecurringWorkflowStep,
  RP_COLLECTIONS,
  currency,
} from '@/lib/recurring-payments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const FORWARD_ACTIONS = ['Submit Bill', 'Verify', 'Approve', 'Record Payment', 'Close', 'Create Expense Request'];
const COMMENT_REQUIRED = ['Return for Correction', 'Reject', 'Dispute', 'On Hold', 'Payment Failed'];
const VERIFICATION_CHECKLIST = [
  'Vendor and account details match the master',
  'Billing period and due date are correct',
  'Bill number is unique and legible',
  'Quantity, rate and amount are verified',
  'GST and TDS treatment is correct',
  'Cost centre, project and budget head are correct',
  'Supporting documents are complete',
  'Variance and duplicate-payment risks are reviewed',
];

export default function ProfessionalRecurringWorkflowStage({ stageId }: { stageId: string }) {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [workflow, setWorkflow] = useState<RecurringWorkflowStep[]>(DEFAULT_RECURRING_WORKFLOW);
  const [settings, setSettings] = useState<RecurringPaymentSettings>({ ...DEFAULT_RECURRING_PAYMENT_SETTINGS, organizationId });
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PaymentObligation | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Reference data for the "Create Expense Request" action only.
  const [departments, setDepartments] = useState<Department[]>([]);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);

  useEffect(() => {
    let stopPayments: () => void = () => undefined;
    let stopSettings: () => void = () => undefined;
    (async () => {
      const workflowSnap = await getDoc(doc(db, 'workflows', 'recurring-payments-workflow'));
      if (workflowSnap.exists() && workflowSnap.data().steps?.length) setWorkflow(workflowSnap.data().steps);
      const [deptSnap, headSnap, subHeadSnap] = await Promise.all([
        getDocs(collection(db, 'departments')),
        getDocs(collection(db, 'accountHeads')),
        getDocs(collection(db, 'subAccountHeads')),
      ]);
      setDepartments(deptSnap.docs.map(item => ({ id: item.id, ...item.data() } as Department)));
      setAccountHeads(headSnap.docs.map(item => ({ id: item.id, ...item.data() } as AccountHead)));
      setSubAccountHeads(subHeadSnap.docs.map(item => ({ id: item.id, ...item.data() } as SubAccountHead)));
      stopPayments = onSnapshot(query(collection(db, RP_COLLECTIONS.payments), where('organizationId', '==', organizationId)), snapshot => {
        setPayments(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as PaymentObligation)));
        setLoading(false);
      }, () => setLoading(false));
      stopSettings = onSnapshot(doc(db, RP_COLLECTIONS.settings, organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')), snapshot => {
        if (!snapshot.exists()) return;
        const data = snapshot.data() as Partial<RecurringPaymentSettings>;
        setSettings({
          ...DEFAULT_RECURRING_PAYMENT_SETTINGS,
          ...data,
          organizationId,
          notifications: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.notifications, ...data.notifications },
          automation: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.automation, ...data.automation },
          controls: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.controls, ...data.controls },
        });
      });
    })();
    return () => { stopPayments(); stopSettings(); };
  }, [organizationId]);

  const stage = useMemo(() => {
    const configured = workflow.find(item => item.id === stageId);
    if (!configured) return undefined;
    const actions = configured.actions.filter(item => {
      if (['Approve', 'Reject', 'Return for Correction'].includes(item)) return can(item === 'Return for Correction' ? 'Return' : item, 'Recurring Payments.Approvals') || can('Approve', 'Recurring Payments.Payments');
      if (item === 'Verify') return can('Verify', 'Recurring Payments.Payments') || can('Approve', 'Recurring Payments.Payments');
      if (['Record Payment', 'Payment Failed', 'Close'].includes(item)) return can(item === 'Close' ? 'Close Payment' : 'Record Payment', 'Recurring Payments.Payment Processing') || can('Record Payment', 'Recurring Payments.Payments');
      return can('Edit', 'Recurring Payments.Payments');
    });
    return { ...configured, actions };
  }, [can, stageId, workflow]);

  const pending = useMemo(() => payments
    .filter(payment => payment.currentStepId === stageId && (payment.assignees || []).includes(user?.id || '') && !['Completed', 'Rejected'].includes(payment.workflowStatus || ''))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [payments, stageId, user?.id]);
  const completed = useMemo(() => payments.filter(payment => (payment.workflowHistory || []).some(item => item.stepId === stageId && item.userId === user?.id)), [payments, stageId, user?.id]);

  async function upload(file: FormDataEntryValue | null, payment: PaymentObligation, folder: string) {
    if (!(file instanceof File) || !file.size) return '';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadRef = storageRef(storage, `recurring-payments/${payment.organizationId}/${payment.id}/${folder}/${Date.now()}-${safeName}`);
    await uploadBytes(uploadRef, file);
    return getDownloadURL(uploadRef);
  }

  async function perform(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !stage || !action || !user) return;
    const form = new FormData(event.currentTarget);
    const comment = String(form.get('comment') || '').trim();
    if (COMMENT_REQUIRED.includes(action) && !comment) return toast({ title: 'A reason is required for this action', variant: 'destructive' });

    const billAmount = Number(form.get('billAmount') || selected.billAmount || selected.expectedAmount);
    const billNumber = String(form.get('billNumber') || selected.billNumber || '').trim();
    const billReceivedDate = String(form.get('billReceivedDate') || selected.billReceivedDate || '').trim();
    if (action === 'Submit Bill' && (billAmount <= 0 || !billNumber || !billReceivedDate)) return toast({ title: 'Bill number, received date, and final amount are required', variant: 'destructive' });
    if (action === 'Submit Bill') {
      const all = await getDocs(query(collection(db, RP_COLLECTIONS.payments), where('organizationId', '==', organizationId)));
      const duplicate = all.docs.some(item => item.id !== selected.id && String(item.data().vendorName).toLowerCase() === selected.vendorName.toLowerCase() && String(item.data().billNumber || '').toLowerCase() === billNumber.toLowerCase());
      if (duplicate) return toast({ title: 'Duplicate vendor bill number', description: 'This bill number already exists for the selected vendor.', variant: 'destructive' });
    }

    const paymentAmount = Number(form.get('paymentAmount') || 0);
    const tdsAmount = Number(form.get('tdsAmount') || 0);
    const gstAmount = Number(form.get('gstAmount') || 0);
    const deductionAmount = Number(form.get('deductionAmount') || 0);
    const adjustmentAmount = Number(form.get('adjustmentAmount') || 0);
    const transactionReference = String(form.get('transactionReference') || '').trim();
    const paymentMode = String(form.get('mode') || 'NEFT') as PaymentMode;
    const paymentDate = String(form.get('paymentDate') || '').trim();
    const bankAccount = String(form.get('bankAccount') || '').trim();
    const chequeNumber = String(form.get('chequeNumber') || '').trim();
    const appliedAmount = paymentAmount + tdsAmount + deductionAmount + adjustmentAmount;
    const currentOutstanding = Math.max(0, (selected.billAmount || selected.expectedAmount) - (selected.settledAmount || selected.paidAmount || 0));
    const checklistCount = form.getAll('verificationChecklist').length;
    if (action === 'Verify' && checklistCount !== VERIFICATION_CHECKLIST.length) return toast({ title: 'Complete the bill verification checklist', description: 'Every verification control must be confirmed before the bill can proceed.', variant: 'destructive' });
    if (action === 'Record Payment' && paymentAmount <= 0) return toast({ title: 'Paid amount is required', variant: 'destructive' });
    // A transaction reference is only meaningful for non-cash modes — a cash payment has no UTR
    // or transaction number to record, so it's exempt from this setting regardless.
    if (action === 'Record Payment' && paymentMode !== 'Cash' && settings.controls.requireTransactionReference && !transactionReference) return toast({ title: 'Transaction reference is required', variant: 'destructive' });
    if (action === 'Record Payment' && paymentMode === 'Cheque' && !chequeNumber) return toast({ title: 'Cheque number is required for cheque payments', variant: 'destructive' });
    if (action === 'Record Payment' && BANK_ACCOUNT_REQUIRED_MODES.includes(paymentMode) && !bankAccount) return toast({ title: 'Bank account is required for electronic payments', variant: 'destructive' });
    const approvalDate = [...(selected.workflowHistory || [])].reverse().find(item => item.action === 'Approve')?.timestamp;
    const approvedOn = timestampDateOnly(approvalDate);
    if (action === 'Record Payment' && paymentDate && approvedOn && paymentDate < approvedOn) return toast({ title: 'Payment date cannot be before the approval date', variant: 'destructive' });
    if (action === 'Record Payment' && appliedAmount > currentOutstanding + 0.01) return toast({ title: 'Settlement exceeds the outstanding amount', description: `Maximum settlement is ${currency(currentOutstanding)}.`, variant: 'destructive' });
    if (action === 'Close' && currentOutstanding > 0.01) return toast({ title: 'Payment cannot be closed while an amount is outstanding', variant: 'destructive' });
    if (action === 'Approve' && settings.controls.requireBillBeforeApproval && !selected.billAmount) return toast({ title: 'A submitted bill is required before approval', variant: 'destructive' });
    if (['Verify', 'Approve'].includes(action) && selected.varianceWarning && !comment) return toast({ title: 'Variance review comment is required', variant: 'destructive' });

    const expenseDepartmentId = String(form.get('expenseDepartmentId') || '').trim();
    const expenseAmount = Number(form.get('expenseAmount') || 0);
    const expensePartyName = String(form.get('expensePartyName') || selected.vendorName || '').trim();
    const expenseHeadOfAccount = String(form.get('expenseHeadOfAccount') || '').trim();
    const expenseSubHeadOfAccount = String(form.get('expenseSubHeadOfAccount') || '').trim();
    const expenseDescription = String(form.get('expenseDescription') || selected.description || selected.title || '').trim();
    if (action === 'Create Expense Request' && !expenseDepartmentId) return toast({ title: 'Select a department for the expense request', variant: 'destructive' });
    if (action === 'Create Expense Request' && expenseAmount <= 0) return toast({ title: 'Expense amount is required', variant: 'destructive' });
    if (action === 'Create Expense Request' && (!expenseHeadOfAccount || !expenseSubHeadOfAccount)) return toast({ title: 'Select a head and sub-head of account', variant: 'destructive' });

    setWorking(true);
    try {
      let documentReference = String(form.get('documentReference') || '').trim();
      const documentFile = form.get('documentFile');
      const uploadedDocument = await upload(documentFile, selected, 'documents');
      if (uploadedDocument) documentReference = uploadedDocument;
      if (stage.uploadRequired && !documentReference && !['Reject', 'On Hold', 'Dispute', 'Payment Failed', 'Return for Correction'].includes(action)) throw new Error('Upload the required supporting document or enter its reference.');

      let receiptUrl = '';
      if (action === 'Record Payment') {
        receiptUrl = await upload(form.get('receiptFile'), selected, 'transactions');
        // Cash payments (and any other mode recorded without a reference) leave this blank —
        // don't treat that shared empty string as a duplicate across separate cash instalments
        // on the same bill.
        if (transactionReference) {
          const duplicates = await getDocs(query(collection(db, RP_COLLECTIONS.payments, selected.id, RP_COLLECTIONS.transactions), where('transactionReference', '==', transactionReference)));
          if (!duplicates.empty) throw new Error('This transaction reference has already been recorded.');
        }
      }

      let expenseRequestNo = '';
      if (action === 'Create Expense Request') {
        // Runs outside the payment's own transaction below: createExpenseRequest() has its own
        // transaction against the department's serial-number config and the expenseRequests
        // collection, which can't be nested inside another Firestore transaction.
        const expenseResult = await createExpenseRequest({
          departmentId: expenseDepartmentId,
          projectId: selected.projectId || '',
          amount: expenseAmount,
          description: expenseDescription,
          headOfAccount: expenseHeadOfAccount,
          subHeadOfAccount: expenseSubHeadOfAccount,
          remarks: comment || `Generated from recurring payment ${selected.title} (${selected.cycleKey})`,
          partyName: expensePartyName,
        });
        if (!expenseResult?.success || !expenseResult?.requestNo) throw new Error(expenseResult?.message || 'Failed to create expense request.');
        expenseRequestNo = expenseResult.requestNo;
      }

      const historicalBills = payments
        .filter(payment => payment.masterId === selected.masterId && payment.id !== selected.id && payment.dueDate < selected.dueDate && Number(payment.billAmount) > 0)
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
      const average = (items: PaymentObligation[]) => items.length ? items.reduce((sum, payment) => sum + Number(payment.billAmount || 0), 0) / items.length : undefined;
      const rawComparisons = {
        previous: Number(historicalBills[0]?.billAmount || 0) || undefined,
        average3: average(historicalBills.slice(0, 3)),
        average6: average(historicalBills.slice(0, 6)),
        estimated: Number(selected.expectedAmount || 0) || undefined,
        maximum: Number(selected.maximumAmount || 0) || undefined,
      };
      const varianceComparisons = Object.fromEntries(Object.entries(rawComparisons).filter(([, value]) => Number(value || 0) > 0)) as NonNullable<PaymentObligation['varianceComparisons']>;
      const varianceBaseline = Number(varianceComparisons.previous || varianceComparisons.average3 || selected.expectedAmount || 0);
      const variancePercent = varianceBaseline ? ((billAmount - varianceBaseline) / varianceBaseline) * 100 : 0;
      const amountLimitExceeded = Number(selected.maximumAmount || 0) > 0 && billAmount > Number(selected.maximumAmount);
      const threshold = Number(settings.controls.varianceWarningPercent || 0);
      const comparisonWarning = Object.entries(varianceComparisons).some(([name, value]) => name !== 'maximum' && Number(value || 0) > 0 && Math.abs(((billAmount - Number(value)) / Number(value)) * 100) >= threshold);
      const varianceWarning = comparisonWarning || amountLimitExceeded;

      const paymentRef = doc(db, RP_COLLECTIONS.payments, selected.id);
      const transactionRef = action === 'Record Payment' ? doc(collection(paymentRef, RP_COLLECTIONS.transactions)) : null;
      const auditRef = doc(collection(paymentRef, RP_COLLECTIONS.auditLogs));
      let notify: string[] = [];
      let destination = stage.name;
      let destinationStepId = stage.id;

      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(paymentRef);
        if (!snapshot.exists()) throw new Error('Payment no longer exists.');
        const current = { id: snapshot.id, ...snapshot.data() } as PaymentObligation;
        if (current.currentStepId !== stage.id) throw new Error('This task has already moved to another step.');
        if (!(current.assignees || []).includes(user.id)) throw new Error('This task is not assigned to you.');

        const historyEntry: RecurringWorkflowHistoryEntry = { action, comment, userId: user.id, userName: user.name, stepId: stage.id, stepName: stage.name, timestamp: Timestamp.now() };
        const patch: Record<string, unknown> = {
          workflowHistory: arrayUnion(historyEntry),
          updatedAt: Timestamp.now(),
        };
        if (documentReference) patch.documentReferences = arrayUnion({ stepId: stage.id, action, reference: documentReference, addedBy: user.id, addedAt: Timestamp.now(), category: stage.name, fileType: documentFile instanceof File ? (documentFile.type || documentFile.name.split('.').pop() || 'file') : 'external-reference', version: (current.documentReferences || []).filter(item => item.stepId === stage.id && item.action === action).length + 1 });
        if (action === 'Submit Bill') Object.assign(patch, { billAmount, billNumber, billReceivedDate, varianceBaseline, variancePercent, varianceWarning, varianceComparisons, amountLimitExceeded, outstandingAmount: Math.max(0, billAmount - (current.settledAmount || current.paidAmount || 0)) });
        if (action === 'Create Expense Request') patch.expenseRequestNo = expenseRequestNo;

        let advance = FORWARD_ACTIONS.includes(action);
        if (action === 'Record Payment') {
          const oldSettled = Number(current.settledAmount || current.paidAmount || 0);
          const totalSettled = oldSettled + appliedAmount;
          const totalPaid = Number(current.paidAmount || 0) + paymentAmount;
          const obligationAmount = Number(current.billAmount || current.expectedAmount);
          advance = totalSettled >= obligationAmount - 0.01;
          Object.assign(patch, {
            paidAmount: totalPaid,
            settledAmount: totalSettled,
            outstandingAmount: Math.max(0, obligationAmount - totalSettled),
            paymentDate,
            transactionReference,
            status: advance ? 'Paid' : 'Partially Paid',
          });
          transaction.set(transactionRef!, {
            organizationId: current.organizationId,
            paymentId: current.id,
            paymentDate,
            amount: paymentAmount,
            mode: paymentMode,
            bankAccount,
            transactionReference,
            chequeNumber,
            tdsAmount,
            gstAmount,
            deductionAmount,
            adjustmentAmount,
            remarks: comment,
            receiptUrl,
            paidBy: user.id,
            paidByName: user.name,
            createdAt: Timestamp.now(),
          });
        }

        let target: RecurringWorkflowStep | undefined;
        let workflowStatus: PaymentObligation['workflowStatus'] = 'In Progress';
        let status = (patch.status || current.status) as PaymentObligation['status'];
        let currentStepId: string | null = stage.id;
        let assignees = current.assignees || [];
        let currentApprovalLevel = Number(current.currentApprovalLevel || 1);
        let approvalCompletedBy = current.approvalCompletedBy || [];

        const isApproval = stage.name.toLowerCase().includes('approval') && action === 'Approve' && current.approvalLevels?.length;
        if (isApproval && current.approvalMode === 'Sequential' && currentApprovalLevel < current.approvalLevels!.length) {
          currentApprovalLevel += 1;
          assignees = [current.approvalLevels![currentApprovalLevel - 1]];
          approvalCompletedBy = [...new Set([...approvalCompletedBy, user.id])];
          destination = `${stage.name} · Level ${currentApprovalLevel}`;
          notify = assignees;
          advance = false;
        } else if (isApproval && current.approvalMode === 'Parallel') {
          approvalCompletedBy = [...new Set([...approvalCompletedBy, user.id])];
          assignees = current.approvalLevels!.filter(id => !approvalCompletedBy.includes(id));
          advance = assignees.length === 0;
          if (!advance) {
            destination = `${stage.name} · ${assignees.length} approval(s) remaining`;
            notify = assignees;
          }
        }

        if (advance) {
          target = workflow[workflow.findIndex(item => item.id === stage.id) + 1];
          if (action === 'Record Payment' && target && (target.name.toLowerCase().includes('receipt') || target.name.toLowerCase().includes('closure')) && current.finalAccountsVerification === false) target = undefined;
          if (target) {
            currentStepId = target.id;
            const nextPayment = { ...current, ...patch, billAmount, currentApprovalLevel, approvalCompletedBy } as PaymentObligation;
            assignees = resolveAssignees(target, nextPayment);
            if (!assignees.length) throw new Error(`No assignee is configured for ${target.name}.`);
            status = stepStatus(target);
            destination = target.name;
            destinationStepId = target.id;
            notify = assignees;
          } else {
            workflowStatus = 'Completed';
            status = 'Closed';
            currentStepId = null;
            assignees = [];
            destination = 'Completed';
            destinationStepId = '';
          }
        } else if (action === 'Return for Correction') {
          target = workflow[Math.max(0, workflow.findIndex(item => item.id === stage.id) - 1)];
          currentStepId = target.id;
          const returningToApproval = target.name.toLowerCase().includes('approval');
          if (returningToApproval) {
            currentApprovalLevel = 1;
            approvalCompletedBy = [];
          }
          assignees = resolveAssignees(target, { ...current, currentApprovalLevel, approvalCompletedBy });
          if (!assignees.length) throw new Error(`No assignee is configured for ${target.name}.`);
          status = stepStatus(target);
          destination = target.name;
          destinationStepId = target.id;
          notify = assignees;
        } else if (action === 'Reject') {
          workflowStatus = 'Rejected';
          status = 'Rejected';
          currentStepId = null;
          assignees = [];
          destination = 'Rejected';
          destinationStepId = '';
        } else if (!FORWARD_ACTIONS.includes(action)) {
          status = action === 'Dispute' ? 'Disputed' : action === 'Payment Failed' ? 'Payment Failed' : 'On Hold';
        }

        Object.assign(patch, {
          workflowStatus,
          status,
          stage: destination,
          currentStepId,
          assignees,
          currentApprovalLevel,
          approvalCompletedBy,
          stepEnteredAt: Timestamp.now(),
          workflowDeadline: target ? Timestamp.fromMillis(Date.now() + Math.max(1, target.tat) * 3_600_000) : current.workflowDeadline || null,
        });
        transaction.update(paymentRef, patch);
        transaction.set(auditRef, {
          organizationId: current.organizationId,
          paymentId: current.id,
          action,
          summary: action === 'Record Payment' ? `${currency(paymentAmount)} recorded against ${currency(currentOutstanding)} outstanding.` : action === 'Create Expense Request' ? `Expense request ${expenseRequestNo} created for ${currency(expenseAmount)}.` : `${stage.name}: ${action}`,
          userId: user.id,
          userName: user.name,
          metadata: { fromStep: stage.name, destination, comment, transactionReference: transactionReference || null, expenseRequestNo: expenseRequestNo || null, verificationChecklist: action === 'Verify' ? VERIFICATION_CHECKLIST : null },
          createdAt: Timestamp.now(),
        });
      });

      for (const assignee of [...new Set(notify)]) {
        await setDoc(doc(collection(db, 'userNotifications')), {
          userId: assignee,
          type: 'recurring_payment_workflow',
          title: `Action required: ${destination}`,
          body: `${selected.title} has moved to your workflow queue.`,
          module: 'Recurring Payments',
          itemId: selected.id,
          link: destinationStepId ? `/recurring-payments/stage/${destinationStepId}` : '/recurring-payments/payments',
          read: false,
          createdAt: Timestamp.now(),
        });
      }
      toast({
        title: action === 'Create Expense Request' ? `Expense request ${expenseRequestNo} created` : `${action} completed`,
        description: destination === stage.name ? 'The item remains in your queue for the next action.' : `Moved to ${destination}.`,
      });
      setSelected(null);
      setAction(null);
    } catch (error) {
      toast({ title: 'Workflow action failed', description: error instanceof Error ? error.message : 'Could not update the payment.', variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (!stage) return <Card><CardContent className="py-16 text-center"><AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-500" /><p className="font-semibold">Workflow step not found</p></CardContent></Card>;

  const dueSoon = pending.filter(payment => daysUntil(payment.dueDate) <= 3).length;
  const overdue = pending.filter(payment => daysUntil(payment.dueDate) < 0).length;
  return <div className="space-y-5">
    <Card className="border-0 bg-gradient-to-r from-indigo-700 via-violet-700 to-purple-700 text-white"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs uppercase tracking-wider text-indigo-200">Recurring payment workflow · Step {stage.id}</p><h1 className="text-2xl font-bold">{stage.name}</h1><p className="mt-1 text-sm text-indigo-100">{stage.description}</p></div><div className="grid grid-cols-3 gap-2 text-center"><StageMetric label="My queue" value={pending.length} /><StageMetric label="Due ≤ 3 days" value={dueSoon} /><StageMetric label="Overdue" value={overdue} /></div></CardContent></Card>
    <Tabs defaultValue="pending"><TabsList><TabsTrigger value="pending">My pending tasks ({pending.length})</TabsTrigger><TabsTrigger value="completed">My completed tasks ({completed.length})</TabsTrigger></TabsList><TabsContent value="pending"><TaskTable rows={pending} stage={stage} onView={setSelected} onAction={(payment, nextAction) => { setSelected(payment); setAction(nextAction); }} /></TabsContent><TabsContent value="completed"><TaskTable rows={completed} stage={stage} onView={setSelected} /></TabsContent></Tabs>
    <ActionDialog payment={selected} stage={stage} action={action} canAct={!!selected && pending.some(item => item.id === selected.id)} onAction={setAction} onClose={() => { setSelected(null); setAction(null); }} onSubmit={perform} working={working} departments={departments} accountHeads={accountHeads} subAccountHeads={subAccountHeads} />
  </div>;
}

function TaskTable({ rows, stage, onView, onAction }: { rows: PaymentObligation[]; stage: RecurringWorkflowStep; onView: (payment: PaymentObligation) => void; onAction?: (payment: PaymentObligation, action: string) => void }) {
  return <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Payment</TableHead><TableHead>Category</TableHead><TableHead>Vendor</TableHead><TableHead>Due date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Variance</TableHead><TableHead>SLA deadline</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map(payment => <TableRow key={payment.id} className="cursor-pointer" onClick={() => onView(payment)}><TableCell className="whitespace-nowrap"><div className="flex items-center gap-2">{payment.varianceWarning && <AlertTriangle className="h-4 w-4 text-amber-500" />}<span className="font-medium">{payment.title}</span></div></TableCell><TableCell className="whitespace-nowrap">{payment.category}</TableCell><TableCell className="whitespace-nowrap">{payment.vendorName}</TableCell><TableCell className="whitespace-nowrap">{payment.dueDate}</TableCell><TableCell className={`whitespace-nowrap ${daysUntil(payment.dueDate) < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>{dueLabel(payment.dueDate)}</TableCell><TableCell className="whitespace-nowrap text-right font-semibold">{currency(payment.billAmount || payment.expectedAmount)}</TableCell><TableCell className="whitespace-nowrap"><Badge variant={payment.varianceWarning ? 'destructive' : 'outline'}>{payment.varianceWarning ? `${Number(payment.variancePercent || 0).toFixed(1)}% variance` : 'Normal'}</Badge></TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{formatTimestamp(payment.workflowDeadline)}</TableCell><TableCell className="whitespace-nowrap text-right">{onAction ? <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" onClick={event => event.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{stage.actions.map(item => <DropdownMenuItem key={item} onSelect={() => onAction(payment, item)}>{item}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu> : <Button variant="ghost" size="icon"><Eye className="h-4 w-4" /></Button>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={9} className="h-36 text-center text-muted-foreground"><CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />No tasks in this queue.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>;
}

function ActionDialog({ payment, stage, action, canAct, onAction, onClose, onSubmit, working, departments, accountHeads, subAccountHeads }: { payment: PaymentObligation | null; stage: RecurringWorkflowStep; action: string | null; canAct: boolean; onAction: (action: string | null) => void; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; working: boolean; departments: Department[]; accountHeads: AccountHead[]; subAccountHeads: SubAccountHead[] }) {
  // Drives which of the mode-specific fields below (bank account / UTR / cheque number) are
  // shown for "Record Payment" — a cash payment has none of these, so showing them unconditionally
  // just confused whoever was recording the payment into thinking they were required.
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('NEFT');
  useEffect(() => { setPaymentMode('NEFT'); }, [payment?.id, action]);
  if (!payment) return null;
  const outstanding = Math.max(0, (payment.billAmount || payment.expectedAmount) - (payment.settledAmount || payment.paidAmount || 0));
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{payment.title}</DialogTitle><DialogDescription>{payment.vendorName} · {stage.name}</DialogDescription></DialogHeader>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Summary label="Expected" value={currency(payment.expectedAmount)} /><Summary label="Bill" value={currency(payment.billAmount || 0)} /><Summary label="Outstanding" value={currency(outstanding)} /><Summary label="Status" value={payment.status} /></div>
    {payment.varianceWarning && <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-5 w-5 shrink-0" /><div><p className="font-semibold">Amount variance requires review</p><p>{Number(payment.variancePercent || 0).toFixed(1)}% against baseline {currency(payment.varianceBaseline || payment.expectedAmount)}{payment.amountLimitExceeded&&payment.maximumAmount?` and above the ${currency(payment.maximumAmount)} master limit`:''}. Verification and approval comments are mandatory.</p></div></div>}
    <div><Label>Workflow history</Label><div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{(payment.workflowHistory || []).map((item, index) => <div key={index} className="flex gap-3 rounded-lg border p-3 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 text-indigo-500" /><div><p className="font-medium">{item.action} · {item.stepName}</p><p className="text-xs text-muted-foreground">{item.userName}{item.comment ? ` — ${item.comment}` : ''} · {formatTimestamp(item.timestamp)}</p></div></div>)}{!(payment.workflowHistory || []).length && <p className="text-sm text-muted-foreground">Workflow has just started.</p>}</div></div>
    {canAct && (!action ? <div className="flex flex-wrap gap-2 border-t pt-4">{stage.actions.map(item => <Button key={item} variant={['Reject', 'Payment Failed'].includes(item) ? 'destructive' : 'default'} onClick={() => onAction(item)}>{item}</Button>)}</div> : <form onSubmit={onSubmit} className="space-y-4 border-t pt-4"><p className="font-semibold">Action: {action}</p>
      {action === 'Submit Bill' && <div className="grid gap-3 sm:grid-cols-3"><Field label="Bill number"><Input name="billNumber" defaultValue={payment.billNumber || ''} required /></Field><Field label="Bill received date"><Input name="billReceivedDate" type="date" defaultValue={payment.billReceivedDate || new Date().toISOString().slice(0, 10)} required /></Field><Field label="Final bill amount"><Input name="billAmount" type="number" min="0.01" step="0.01" defaultValue={payment.billAmount || payment.expectedAmount} required /></Field></div>}
      {action === 'Verify' && <div className="space-y-3 rounded-xl border bg-muted/20 p-4"><div><p className="font-semibold">Bill verification checklist</p><p className="text-xs text-muted-foreground">Confirm every control. The completed checklist is captured in the audit record.</p></div><div className="grid gap-3 sm:grid-cols-2">{VERIFICATION_CHECKLIST.map(item => <label key={item} className="flex items-start gap-2 rounded-lg border bg-background p-3 text-sm"><Checkbox name="verificationChecklist" value={item} required className="mt-0.5" /><span>{item}</span></label>)}</div></div>}
      {action === 'Record Payment' && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Payment date"><Input name="paymentDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
        <Field label="Paid amount"><Input name="paymentAmount" type="number" min="0.01" step="0.01" max={outstanding || undefined} required /></Field>
        <Field label="Payment mode"><Select name="mode" value={paymentMode} onValueChange={value => setPaymentMode(value as PaymentMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_MODES.map(mode => <SelectItem value={mode} key={mode}>{mode}</SelectItem>)}</SelectContent></Select></Field>
        {/* Bank account and UTR/transaction reference only apply once money actually moves
            through a bank — a cash payment has neither, so they're hidden rather than shown
            as fields nobody knows how to fill in. */}
        {paymentMode !== 'Cash' && <Field label="Bank account"><Input name="bankAccount" required={BANK_ACCOUNT_REQUIRED_MODES.includes(paymentMode)} /></Field>}
        {paymentMode === 'Cheque' && <Field label="Cheque number"><Input name="chequeNumber" required /></Field>}
        {paymentMode === 'Cash'
          ? <Field label="Cash voucher / receipt no."><Input name="transactionReference" /></Field>
          : <Field label="Transaction / UTR"><Input name="transactionReference" required={BANK_ACCOUNT_REQUIRED_MODES.includes(paymentMode)} /></Field>}
        <Field label="TDS amount"><Input name="tdsAmount" type="number" min="0" defaultValue="0" /></Field>
        <Field label="GST amount"><Input name="gstAmount" type="number" min="0" defaultValue="0" /></Field>
        <Field label="Other deduction"><Input name="deductionAmount" type="number" min="0" defaultValue="0" /></Field>
        <Field label="Adjustment"><Input name="adjustmentAmount" type="number" defaultValue="0" /></Field>
        <Field label="Payment receipt"><Input name="receiptFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" /></Field>
      </div>}
      {action === 'Create Expense Request' && <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
        <Field label="Department *"><Select name="expenseDepartmentId" defaultValue={payment.departmentId || undefined}><SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger><SelectContent>{departments.map(item => <SelectItem value={item.id} key={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Party name"><Input name="expensePartyName" defaultValue={payment.vendorName} required /></Field>
        <Field label="Amount"><Input name="expenseAmount" type="number" min="0.01" step="0.01" defaultValue={payment.billAmount || payment.expectedAmount} required /></Field>
        <Field label="Head of account"><Select name="expenseHeadOfAccount" defaultValue={accountHeads[0]?.name}><SelectTrigger><SelectValue placeholder="Select head" /></SelectTrigger><SelectContent>{accountHeads.map(item => <SelectItem value={item.name} key={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Sub-head of account"><Select name="expenseSubHeadOfAccount"><SelectTrigger><SelectValue placeholder="Select sub-head" /></SelectTrigger><SelectContent>{subAccountHeads.map(item => <SelectItem value={item.name} key={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
        <div className="sm:col-span-2"><Field label="Expense description"><Textarea name="expenseDescription" defaultValue={payment.description || payment.title} /></Field></div>
      </div>}
      {stage.uploadRequired && !['Reject', 'On Hold', 'Dispute', 'Payment Failed', 'Return for Correction'].includes(action) && <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"><Field label="Supporting document"><Input name="documentFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" /></Field><Field label="Or document reference"><Input name="documentReference" placeholder="URL or document number" /></Field></div>}
      <Field label={COMMENT_REQUIRED.includes(action) || (payment.varianceWarning && ['Verify', 'Approve'].includes(action)) ? 'Comment / justification *' : 'Comment'}><Textarea name="comment" placeholder="Add clear remarks for the audit trail" /></Field>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onAction(null)}>Back</Button><Button disabled={working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm {action}</Button></div>
    </form>)}
    <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function StageMetric({ label, value }: { label: string; value: number }) { return <div className="min-w-20 rounded-xl bg-white/15 px-3 py-2"><p className="text-lg font-bold">{value}</p><p className="text-[10px] text-indigo-100">{label}</p></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{value}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function timestampDateOnly(value: unknown) { const data = value as { toDate?: () => Date; seconds?: number } | null | undefined; const date = data?.toDate ? data.toDate() : data?.seconds ? new Date(data.seconds * 1000) : null; return date ? date.toISOString().slice(0, 10) : ''; }
function daysUntil(value: string) { const due = new Date(`${value}T00:00:00`); const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return Math.round((due.getTime() - today.getTime()) / 86_400_000); }
function dueLabel(value: string) { const days = daysUntil(value); return days < 0 ? `${Math.abs(days)} day(s) overdue` : days === 0 ? 'Due today' : `Due in ${days} day(s)`; }
function formatTimestamp(value: unknown) { const data = value as { toDate?: () => Date; seconds?: number } | null; if (data?.toDate) return data.toDate().toLocaleString('en-IN'); if (data?.seconds) return new Date(data.seconds * 1000).toLocaleString('en-IN'); return '—'; }
