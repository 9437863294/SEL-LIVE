import { NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { DEFAULT_RECURRING_WORKFLOW, type RecurringWorkflowStep } from '@/lib/recurring-payments';

const pad = (n: number) => String(n).padStart(2, '0');
const dateOnly = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function resolveAssignees(step: RecurringWorkflowStep, payment: Record<string, unknown>): string[] {
  if (step.assignmentType === 'Payment-owner') return payment.assignedTo ? [String(payment.assignedTo)] : [];
  if (step.assignmentType === 'User-based') return (step.assignedTo as string[]).filter(Boolean);
  const amount = Number(payment.billAmount || payment.expectedAmount || 0);
  const match = (step.assignedTo as Array<{minAmount:number;maxAmount:number|null;userId:string;alternativeUserId?:string}>).find(rule => amount >= Number(rule.minAmount || 0) && amount <= (rule.maxAmount == null ? Number.POSITIVE_INFINITY : Number(rule.maxAmount)));
  return match ? [match.userId, match.alternativeUserId].filter(Boolean) as string[] : [];
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirebaseAdminFirestore();
  const now = new Date();
  const cycle = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const masters = await db.collection('recurringPaymentMasters').where('status', '==', 'Active').get();
  let generated = 0;
  let skipped = 0;
  let disabled = 0;
  let remindersQueued = 0;
  let workflowTriggered = 0;

  for (const masterDoc of masters.docs) {
    const master = masterDoc.data();
    if (master.deleted) continue;
    const organizationId = String(master.organizationId || 'default');
    const settingsRef = db.collection('recurringPaymentSettings').doc(organizationId.replace(/[^a-zA-Z0-9_-]/g, '_'));
    const settings = (await settingsRef.get()).data();
    if (settings?.automation?.enabled === false) { disabled++; continue; }
    const generationDay = Math.min(28, Math.max(1, Number(settings?.automation?.generationDay || 1)));
    if (now.getDate() < generationDay) { skipped++; continue; }
    const cycleKey = `${organizationId}_${masterDoc.id}_${cycle}`;
    const paymentRef = db.collection('paymentObligations').doc(cycleKey.replace(/[^a-zA-Z0-9_-]/g, '_'));
    if ((await paymentRef.get()).exists) { skipped++; continue; }
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const due = new Date(now.getFullYear(), now.getMonth(), Math.min(28, Math.max(1, Number(master.dueDay || 1))));
    const approvalRules = await db.collection('recurringPaymentApprovalRules')
      .where('organizationId', '==', organizationId).where('active', '==', true).get();
    const amount = Number(master.amount || 0);
    const matchedRule = approvalRules.docs.map(rule => ({ id: rule.id, ...rule.data() })).find(rule => {
      const data = rule as Record<string, unknown>;
      const min = Number(data.minAmount || 0);
      const max = data.maxAmount == null ? Number.POSITIVE_INFINITY : Number(data.maxAmount);
      return amount >= min && amount <= max && (!data.category || data.category === master.category) && (!data.project || data.project === master.projectId);
    });
    await paymentRef.create({
      organizationId, masterId: masterDoc.id, cycleKey,
      title: `${master.title} — ${now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}`,
      category: master.category, vendorName: master.vendorName,
      billingPeriodStart: dateOnly(start), billingPeriodEnd: dateOnly(end), dueDate: dateOnly(due),
      expectedAmount: amount, paidAmount: 0,
      status: 'Scheduled', workflowStatus: 'Scheduled', stage: 'Scheduled',
      currentStepId: null, assignees: [], workflowHistory: [],
      approvalRuleId: matchedRule?.id || null,
      approvalMode: matchedRule ? (matchedRule as Record<string, unknown>).mode : null,
      approvalLevels: matchedRule ? (matchedRule as Record<string, unknown>).approvers : [],
      currentApprovalLevel: matchedRule ? 1 : 0,
      assignedTo: master.assignedTo || '', generatedAutomatically: true,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    generated++;
  }

  // Move scheduled obligations into the configured workflow at the activation threshold.
  const openPayments = await db.collection('paymentObligations').get();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const workflowSnap = await db.collection('workflows').doc('recurring-payments-workflow').get();
  const workflow = (workflowSnap.data()?.steps || DEFAULT_RECURRING_WORKFLOW) as RecurringWorkflowStep[];
  const firstStep = workflow[0];
  if (firstStep) {
    for (const paymentDoc of openPayments.docs) {
      const payment = paymentDoc.data();
      if (payment.currentStepId || ['Paid','Closed','Cancelled','Waived','Rejected'].includes(payment.status) || !payment.dueDate) continue;
      const organizationId = String(payment.organizationId || 'default');
      const settings = (await db.collection('recurringPaymentSettings').doc(organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')).get()).data();
      const activationDays = Math.min(90, Math.max(0, Number(settings?.automation?.workflowActivationDays ?? 7)));
      const due = new Date(`${payment.dueDate}T00:00:00`);
      const daysUntilDue = Math.round((due.getTime() - today.getTime()) / 86_400_000);
      if (daysUntilDue > activationDays) continue;
      const assignees = resolveAssignees(firstStep, payment);
      if (!assignees.length) continue;
      await paymentDoc.ref.update({
        status: firstStep.name.toLowerCase().includes('bill') ? 'Awaiting Bill' : 'In Progress',
        workflowStatus: 'In Progress', stage: firstStep.name, currentStepId: firstStep.id,
        assignees, workflowStartedAt: FieldValue.serverTimestamp(), stepEnteredAt: FieldValue.serverTimestamp(),
        workflowDeadline: Timestamp.fromMillis(Date.now() + Math.max(1, firstStep.tat) * 3_600_000),
        updatedAt: FieldValue.serverTimestamp(),
      });
      for (const assignee of assignees) {
        await db.collection('userNotifications').doc(`recurring_start_${paymentDoc.id}_${assignee}`).set({
          userId: assignee, type: 'recurring_payment_workflow', title: `Action required: ${firstStep.name}`,
          body: `${payment.title} is due on ${payment.dueDate} and has entered your workflow queue.`,
          module: 'Recurring Payments', itemId: paymentDoc.id,
          link: `/recurring-payments/stage/${firstStep.id}`, read: false, createdAt: FieldValue.serverTimestamp(),
        }, { merge: false });
      }
      workflowTriggered++;
    }
  }

  // Build an idempotent daily reminder queue from each organization's saved rule.
  for (const paymentDoc of openPayments.docs) {
    const payment = paymentDoc.data();
    if (['Paid','Closed','Cancelled','Waived'].includes(payment.status) || !payment.dueDate) continue;
    const organizationId = String(payment.organizationId || 'default');
    const settings = (await db.collection('recurringPaymentSettings').doc(organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')).get()).data();
    const notification = settings?.notifications;
    if (!notification) continue;
    const due = new Date(`${payment.dueDate}T00:00:00`);
    const daysUntilDue = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    const before = Array.isArray(notification.daysBefore) ? notification.daysBefore : [];
    const after = Array.isArray(notification.daysAfter) ? notification.daysAfter : [];
    const scheduled = daysUntilDue >= 0
      ? before.includes(daysUntilDue)
      : after.includes(Math.abs(daysUntilDue)) || notification.dailyOverdueEscalation === true;
    if (!scheduled) continue;
    const queueId = `${paymentDoc.id}_${dateOnly(today)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const queueRef = db.collection('recurringPaymentNotificationQueue').doc(queueId);
    if ((await queueRef.get()).exists) continue;
    const channels = ['inApp','email','push','sms'].filter(channel => notification[channel] === true);
    await queueRef.create({
      organizationId, paymentId: paymentDoc.id, title: payment.title,
      dueDate: payment.dueDate, daysUntilDue, channels,
      recipients: notification.recipients || [], assignedTo: payment.assignedTo || '',
      status: 'Pending', attempts: 0, createdAt: FieldValue.serverTimestamp(),
    });
    if (notification.inApp && payment.assignedTo) {
      await db.collection('userNotifications').doc(`recurring_${queueId}`).set({
        userId: payment.assignedTo, type: 'recurring_payment_reminder',
        title: daysUntilDue < 0 ? `Overdue: ${payment.title}` : `Payment due: ${payment.title}`,
        body: daysUntilDue < 0 ? `Payment was due ${Math.abs(daysUntilDue)} day(s) ago.` : daysUntilDue === 0 ? 'Payment is due today.' : `Payment is due in ${daysUntilDue} day(s).`,
        module: 'Recurring Payments', itemId: paymentDoc.id,
        link: '/recurring-payments/payments', read: false, createdAt: FieldValue.serverTimestamp(),
      }, { merge: false });
    }
    remindersQueued++;
  }
  return NextResponse.json({ ok: true, cycle, checked: masters.size, generated, skipped, automationDisabled: disabled, workflowTriggered, remindersQueued });
}
