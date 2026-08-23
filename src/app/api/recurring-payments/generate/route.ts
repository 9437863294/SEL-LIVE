import { NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { buildPaymentObligationFields, DEFAULT_RECURRING_WORKFLOW, isWorkflowActivationDue, matchApprovalRule, pendingRecurringCycles, resolveAssignees, stepStatus, type ApprovalRule, type PaymentObligation, type RecurringPaymentMaster, type RecurringWorkflowStep } from '@/lib/recurring-payments';
import { addBusinessHours, makeIsWorkingDay, normalizeWorkingHoursDoc } from '@/lib/working-hours';
import { dispatchNotificationOnce } from '@/lib/notifications-server';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import type { Holiday } from '@/lib/types';

const pad = (n: number) => String(n).padStart(2, '0');
const dateOnly = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export async function GET(request: Request) {
  const runStartedAt = Date.now();
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirebaseAdminFirestore();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetOrganizationId = String(request.headers.get('x-recurring-organization') || '').trim();
  // Fetched once for the whole run — every obligation activated below shares the same working
  // hours/holidays, same as the client-side "Generate now" actions and workflow-stage advances.
  const [workingHoursSnap, holidaysSnap] = await Promise.all([
    db.collection('settings').doc('workingHours').get(),
    db.collection('holidays').get(),
  ]);
  const workingHours = normalizeWorkingHoursDoc(workingHoursSnap.data());
  const holidays = holidaysSnap.docs.map(item => item.data() as Holiday);
  // Shared with the schedule math so a "last working day of month" due date lands on the same date
  // the org's own calendar would pick, not just a naive Mon–Fri guess.
  const isWorkingDay = makeIsWorkingDay(workingHours, holidays);
  const masters = await db.collection('recurringPaymentMasters').where('status', '==', 'Active').get();
  const masterDocs = targetOrganizationId
    ? masters.docs.filter(item => String(item.data().organizationId || 'default') === targetOrganizationId)
    : masters.docs;
  let generated = 0;
  let skipped = 0;
  let disabled = 0;
  let remindersQueued = 0;
  let workflowTriggered = 0;
  let assigneeMissing = 0;

  for (const masterDoc of masterDocs) {
    const master = { id: masterDoc.id, ...masterDoc.data() } as RecurringPaymentMaster;
    if (master.deleted || master.autoGenerationEnabled === false) continue;
    const organizationId = String(master.organizationId || 'default');
    const settingsRef = db.collection('recurringPaymentSettings').doc(organizationId.replace(/[^a-zA-Z0-9_-]/g, '_'));
    const settings = (await settingsRef.get()).data();
    if (settings?.automation?.enabled === false) { disabled++; continue; }
    // Each cycle carries its own generation date — the expected bill date minus the master's lead
    // time — so this only has to ask which cycles are already due for creation. A long lead time
    // can put the next cycle inside its window while today still sits in the current period, hence
    // more than one candidate. If the cron missed earlier runs (automation was paused, etc.), the
    // obligation still generates immediately rather than waiting for a window that already passed.
    const cycles = pendingRecurringCycles(master, now, { isWorkingDay });
    if (!cycles.length) { skipped++; continue; }
    let approvalRules: ApprovalRule[] | null = null;
    for (const cycle of cycles) {
      const cycleKey = `${organizationId}_${masterDoc.id}_${cycle.key}`;
      const paymentRef = db.collection('paymentObligations').doc(cycleKey.replace(/[^a-zA-Z0-9_-]/g, '_'));
      if ((await paymentRef.get()).exists) { skipped++; continue; }
      // Loaded lazily and reused across this master's cycles — most runs generate nothing and
      // shouldn't pay for the query at all.
      if (!approvalRules) {
        const ruleSnap = await db.collection('recurringPaymentApprovalRules')
          .where('organizationId', '==', organizationId).where('active', '==', true).get();
        approvalRules = ruleSnap.docs.map(rule => ({ id: rule.id, ...rule.data() }) as ApprovalRule);
      }
      const amount = Number(master.amount || 0);
      const matchedRule = matchApprovalRule(approvalRules, {
        amount, category: master.category, projectId: master.projectId, projectName: master.projectName,
      });
      await paymentRef.create({
        ...buildPaymentObligationFields({
          organizationId, masterId: masterDoc.id, cycle, generatedAutomatically: true,
          title: master.title, category: master.category, vendorName: master.vendorName,
          branchId: master.branchId, branchName: master.branchName,
          projectId: master.projectId, projectName: master.projectName,
          departmentId: master.departmentId, department: master.department,
          costCentre: master.costCentre, ledger: master.ledger, amountType: master.amountType,
          accountNumber: master.accountNumber,
          amount, maximumAmount: master.maximumAmount,
          assignedTo: master.assignedTo, backupAssignedTo: master.backupAssignedTo,
          verifierId: master.verifierId, approverId: master.approverId,
          accountsProcessorId: master.accountsProcessorId, approvalRule: matchedRule,
        }),
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      generated++;
    }
  }

  // Move scheduled obligations into the configured workflow at the activation threshold.
  const openPayments = await db.collection('paymentObligations').get();
  const openPaymentDocs = targetOrganizationId
    ? openPayments.docs.filter(item => String(item.data().organizationId || 'default') === targetOrganizationId)
    : openPayments.docs;
  const workflowSnap = await db.collection('workflows').doc('recurring-payments-workflow').get();
  const workflow = (workflowSnap.data()?.steps || DEFAULT_RECURRING_WORKFLOW) as RecurringWorkflowStep[];
  const firstStep = workflow[0];
  if (firstStep) {
    for (const paymentDoc of openPaymentDocs) {
      const payment = paymentDoc.data() as PaymentObligation;
      if (payment.currentStepId || ['Paid','Closed','Cancelled','Waived','Rejected'].includes(payment.status) || !payment.dueDate) continue;
      const organizationId = String(payment.organizationId || 'default');
      const settings = (await db.collection('recurringPaymentSettings').doc(organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')).get()).data();
      const activationDays = Math.min(90, Math.max(0, Number(settings?.automation?.workflowActivationDays ?? 7)));
      // Shared with the client-side generate actions rather than re-derived here, so an obligation
      // enters its first step on the same day whichever path created it.
      if (!isWorkflowActivationDue(payment, { activationDays, today })) continue;
      const assignees = resolveAssignees(firstStep, payment);
      if (!assignees.length) {
        // Don't fail silently: without this, a payment with no resolvable owner (missing
        // assignedTo/backupAssignedTo, or a "User-based" step with no user configured) sits in
        // "Scheduled" forever with zero signal to anyone that it never reached a workflow queue.
        assigneeMissing++;
        await paymentDoc.ref.collection('auditLogs').add({
          organizationId, paymentId: paymentDoc.id,
          action: 'Workflow activation skipped',
          summary: `No assignee could be resolved for step "${firstStep.name}" — check the master's assigned owner/backup assignee or the step's configured users.`,
          userId: 'system', userName: 'Automation', createdAt: FieldValue.serverTimestamp(),
        }).catch(() => undefined);
        continue;
      }
      await paymentDoc.ref.update({
        status: stepStatus(firstStep),
        workflowStatus: 'In Progress', stage: firstStep.name, currentStepId: firstStep.id,
        assignees, workflowStartedAt: FieldValue.serverTimestamp(), stepEnteredAt: FieldValue.serverTimestamp(),
        workflowDeadline: Timestamp.fromMillis(addBusinessHours(new Date(), Math.max(1, firstStep.tat), workingHours, holidays).getTime()),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await dispatchNotificationOnce(
        { userIds: assignees },
        {
          type: 'recurring_payment_workflow',
          title: `Action required: ${firstStep.name}`,
          body: `${payment.title} is due on ${payment.dueDate} and has entered your workflow queue.`,
          module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
          severity: 'WARNING',
          itemId: paymentDoc.id,
          itemRef: String(payment.title || ''),
          stepName: firstStep.name,
          link: `/recurring-payments/stage/${firstStep.id}`,
        },
        `recurring_start_${paymentDoc.id}`,
      );
      workflowTriggered++;
    }
  }

  // Build an idempotent daily reminder queue from each organization's saved rule.
  for (const paymentDoc of openPaymentDocs) {
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
      await dispatchNotificationOnce(
        { userIds: [String(payment.assignedTo)] },
        {
          type: 'recurring_payment_reminder',
          title: daysUntilDue < 0 ? `Overdue: ${payment.title}` : `Payment due: ${payment.title}`,
          body: daysUntilDue < 0 ? `Payment was due ${Math.abs(daysUntilDue)} day(s) ago.` : daysUntilDue === 0 ? 'Payment is due today.' : `Payment is due in ${daysUntilDue} day(s).`,
          module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
          // An overdue payment is not the same urgency as a heads-up a week out.
          severity: daysUntilDue < 0 ? 'CRITICAL' : daysUntilDue === 0 ? 'WARNING' : 'INFO',
          itemId: paymentDoc.id,
          itemRef: String(payment.title || ''),
          link: '/recurring-payments/payments',
        },
        `recurring_${queueId}`,
      );
    }
    remindersQueued++;
  }
  const result = { ok: true, runDate: dateOnly(now), checked: masterDocs.length, generated, skipped, automationDisabled: disabled, workflowTriggered, assigneeMissing, remindersQueued };
  await db.collection('recurringPaymentAutomationLogs').add({ organizationId: targetOrganizationId || 'all', jobName: targetOrganizationId ? 'Manual organization automation run' : 'Daily recurring payment generation', startedAt: Timestamp.fromMillis(runStartedAt), completedAt: FieldValue.serverTimestamp(), recordsProcessed: masterDocs.length, successCount: generated + workflowTriggered + remindersQueued, failureCount: assigneeMissing, status: 'Completed', result, createdAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
    const db = getFirebaseAdminFirestore();
    let userSnapshot = await db.collection('users').doc(decoded.uid).get();
    if (!userSnapshot.exists && decoded.email) {
      const byEmail = await db.collection('users').where('email', '==', decoded.email.toLowerCase()).limit(1).get();
      if (!byEmail.empty) userSnapshot = byEmail.docs[0];
    }
    const roleName = String(userSnapshot.data()?.role || '');
    const roleSnapshot = await db.collection('roles').where('name', '==', roleName).limit(1).get();
    const permissions = roleSnapshot.docs[0]?.data()?.permissions || {};
    const settingsPermissions = permissions?.['Recurring Payments']?.Settings || permissions?.['Recurring Payments.Settings'] || [];
    const allowed = Array.isArray(settingsPermissions) && (settingsPermissions.includes('Manage Automation') || settingsPermissions.includes('Edit'));
    if (!allowed) return NextResponse.json({ error: 'Manage Automation permission required' }, { status: 403 });
    const organizationId = String(userSnapshot.data()?.organizationId || 'default');
    const headers = new Headers(request.headers);
    if (process.env.CRON_SECRET) headers.set('authorization', `Bearer ${process.env.CRON_SECRET}`);
    headers.set('x-recurring-organization', organizationId);
    return GET(new Request(request.url, { method: 'GET', headers }));
  } catch {
    return NextResponse.json({ error: 'Manual generation could not be authorized' }, { status: 401 });
  }
}
