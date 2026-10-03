import { NextResponse } from 'next/server';
import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { accessErrorResponse, authenticateAccess, requireAnyAccess } from '@/lib/access-control-server';
import { buildPaymentObligationFields, CONCLUDED_PAYMENT_STATUSES, DEFAULT_RECURRING_WORKFLOW, isWorkflowActivationDue, matchApprovalRule, pendingRecurringCycles, recurringObligationId, resolveEntryAssignees, stepStatus, type ApprovalRule, type PaymentObligation, type RecurringPaymentMaster, type RecurringWorkflowStep } from '@/lib/recurring-payments';
import { addBusinessHours, makeIsWorkingDay, normalizeWorkingHoursDoc } from '@/lib/working-hours';
import { dispatchNotificationOnce } from '@/lib/notifications-server';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import type { Holiday } from '@/lib/types';

const pad = (n: number) => String(n).padStart(2, '0');
const dateOnly = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * "Today" as the organization sees it, returned as a local-midnight Date so the rest of the run can
 * keep doing plain day arithmetic against `YYYY-MM-DD` strings.
 *
 * Every organization has a configured `automation.timezone` (default Asia/Kolkata) which was
 * displayed in Settings and then read by nothing at all — the run used the *server's* calendar
 * date. Hosted in UTC, that is a different date from IST for five and a half hours every day, so a
 * nightly run scheduled after 18:30 UTC generated obligations, activated workflow steps and sent
 * "due today" reminders stamped with yesterday's date. Anything keyed on the date was then wrong by
 * one day: the reminder de-duplication id, the `daysUntilDue` in the notification, and whether a
 * cycle had reached its generation date at all.
 */
function organizationToday(now: Date, timeZone: string): Date {
  try {
    // en-CA gives ISO-ordered parts, so this is a locale-stable way to ask "what is the date there".
    const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now).split('-').map(Number);
    return new Date(year, month - 1, day);
  } catch {
    // An unknown/misconfigured zone must not take the whole run down; fall back to server-local.
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await runRecurringAutomation(String(request.headers.get('x-recurring-organization') || '').trim()));
}

async function runRecurringAutomation(targetOrganizationId: string) {
  const runStartedAt = Date.now();
  const db = getFirebaseAdminFirestore();
  const now = new Date();
  /**
   * One read of each organization's settings per run, not per record.
   *
   * The three loops below each needed the same document — once per master, then once per obligation
   * for workflow activation, then once per obligation again for reminders. An organization with
   * 800 open obligations therefore paid for ~1,600 reads of a single unchanging document every
   * night, and the same document was re-read on every manual "run automation now". Settings cannot
   * change mid-run, so caching them is also the only way the three loops are guaranteed to agree on
   * the timezone and activation window they are working from.
   */
  const settingsCache = new Map<string, DocumentData | undefined>();
  const loadSettings = async (organizationId: string) => {
    if (!settingsCache.has(organizationId)) {
      const snapshot = await db.collection('recurringPaymentSettings')
        .doc(organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')).get();
      settingsCache.set(organizationId, snapshot.data());
    }
    return settingsCache.get(organizationId);
  };
  // No run-wide `today`: the calendar date is a per-organization question (see
  // `organizationToday`), so each loop derives it from the settings it has already loaded. A
  // server-local one sitting here is what caused the off-by-one-day behaviour in the first place.
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
  /**
   * Records that threw. Each one is isolated rather than allowed to abort the run: a single master
   * saved without a start date used to throw inside the cycle math and take the whole nightly sweep
   * down with it — every organization's generation, activation and reminders skipped, and no
   * automation log written to say so.
   */
  const failures: string[] = [];
  const recordFailure = (kind: string, id: string, error: unknown) => {
    console.error(`[recurring-payments] ${kind} ${id} failed`, error);
    failures.push(`${kind} ${id}: ${error instanceof Error ? error.message : String(error)}`);
  };

  for (const masterDoc of masterDocs) {
    try {
      const master = { id: masterDoc.id, ...masterDoc.data() } as RecurringPaymentMaster;
      if (master.deleted || master.autoGenerationEnabled === false) continue;
      if (!master.startDate) throw new Error('Master has no start date, so no cycle can be resolved.');
      const organizationId = String(master.organizationId || 'default');
      const settings = await loadSettings(organizationId);
      if (settings?.automation?.enabled === false) { disabled++; continue; }
      const orgToday = organizationToday(now, String(settings?.automation?.timezone || 'Asia/Kolkata'));
      // Each cycle carries its own generation date — the expected bill date minus the master's lead
      // time — so this only has to ask which cycles are already due for creation. A long lead time
      // can put the next cycle inside its window while today still sits in the current period, hence
      // more than one candidate. If the cron missed earlier runs (automation was paused, etc.), the
      // obligation still generates immediately rather than waiting for a window that already passed.
      const cycles = pendingRecurringCycles(master, orgToday, { isWorkingDay });
      if (!cycles.length) { skipped++; continue; }
      let approvalRules: ApprovalRule[] | null = null;
      for (const cycle of cycles) {
        const paymentRef = db.collection('paymentObligations').doc(recurringObligationId(organizationId, masterDoc.id, cycle.key));
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
        // `create()` rather than `set()` is deliberate — it is the atomic "only if absent" write, so
        // two overlapping runs can never both produce the same cycle. But it *throws* when the doc
        // already exists, and the existence check above is a separate round-trip: a manual "Generate
        // all" overlapping the nightly cron would land in that window, and the unhandled rejection
        // aborted the entire run, silently skipping every master after this one. Losing the race is
        // the expected outcome, not an error — the other writer created exactly the same obligation.
        try {
        await paymentRef.create({
          ...buildPaymentObligationFields({
            organizationId, masterId: masterDoc.id, cycle, generatedAutomatically: true,
            title: master.title, category: master.category, vendorName: master.vendorName,
            branchId: master.branchId, branchName: master.branchName,
            projectId: master.projectId, projectName: master.projectName,
            departmentId: master.departmentId, department: master.department,
            costCentre: master.costCentre, ledger: master.ledger, amountType: master.amountType,
            description: master.description, accountNumber: master.accountNumber,
            amount, maximumAmount: master.maximumAmount,
            assignedTo: master.assignedTo, backupAssignedTo: master.backupAssignedTo,
            verifierId: master.verifierId, approverId: master.approverId,
            accountsProcessorId: master.accountsProcessorId, approvalRule: matchedRule,
          }),
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
        generated++;
        } catch (error) {
          // ALREADY_EXISTS (gRPC 6) means a concurrent writer got there first — the obligation
          // exists, which is the desired end state, so count it as skipped and carry on. Anything
          // else is a real failure and must not be swallowed.
          if ((error as { code?: number })?.code === 6) { skipped++; continue; }
          throw error;
        }
      }
    } catch (error) {
      recordFailure('Master', masterDoc.id, error);
    }
  }

  // Move scheduled obligations into the configured workflow at the activation threshold.
  // Scoped in the query when a single organization was requested (the manual "run automation now"
  // path) rather than reading every obligation in the database and discarding most of them —
  // that full-collection read was charged on every manual run, for every organization.
  const openPayments = await (targetOrganizationId
    ? db.collection('paymentObligations').where('organizationId', '==', targetOrganizationId).get()
    : db.collection('paymentObligations').get());
  const openPaymentDocs = openPayments.docs;
  const workflowSnap = await db.collection('workflows').doc('recurring-payments-workflow').get();
  const savedSteps = workflowSnap.data()?.steps as RecurringWorkflowStep[] | undefined;
  // An empty saved list is not a workflow — `[]` is truthy, so `steps || DEFAULT` left no first
  // step and silently stopped every obligation from ever entering a queue.
  const workflow = savedSteps?.length ? savedSteps : DEFAULT_RECURRING_WORKFLOW;
  const firstStep = workflow[0];
  if (firstStep) {
    for (const paymentDoc of openPaymentDocs) {
      try {
        const payment = paymentDoc.data() as PaymentObligation;
        // `deleted` first: a soft-deleted obligation is hidden from every register and report, so
        // activating it would put a record nobody can open into somebody's workflow queue.
        if (payment.deleted || payment.currentStepId || CONCLUDED_PAYMENT_STATUSES.includes(payment.status) || !payment.dueDate) continue;
        const organizationId = String(payment.organizationId || 'default');
        const settings = await loadSettings(organizationId);
        const activationDays = Math.min(90, Math.max(0, Number(settings?.automation?.workflowActivationDays ?? 7)));
        const orgToday = organizationToday(now, String(settings?.automation?.timezone || 'Asia/Kolkata'));
        // Shared with the client-side generate actions rather than re-derived here, so an obligation
        // enters its first step on the same day whichever path created it.
        if (!isWorkflowActivationDue(payment, { activationDays, today: orgToday })) continue;
        // Entry-step resolution, so an unconfigured first step falls back to the payment owner
        // rather than parking the obligation in nobody's queue.
        const assignees = resolveEntryAssignees(firstStep, payment);
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
      } catch (error) {
        recordFailure('Workflow activation for payment', paymentDoc.id, error);
      }
    }
  }

  // Build an idempotent daily reminder queue from each organization's saved rule.
  for (const paymentDoc of openPaymentDocs) {
    try {
      const payment = paymentDoc.data();
      // A deleted obligation must not keep chasing people. Without this it stayed in the reminder
      // sweep forever — daily "Payment due" notifications, and daily overdue escalation once it
      // passed its date — for a record the recipient cannot even open. The same holds for a
      // rejected one: rejection ends the workflow with no path back, so a daily "Overdue" alert
      // about it asks the owner for something nobody can act on.
      if (payment.deleted || CONCLUDED_PAYMENT_STATUSES.includes(payment.status) || !payment.dueDate) continue;
      const organizationId = String(payment.organizationId || 'default');
      const settings = await loadSettings(organizationId);
      const notification = settings?.notifications;
      if (!notification) continue;
      const orgToday = organizationToday(now, String(settings?.automation?.timezone || 'Asia/Kolkata'));
      const due = new Date(`${payment.dueDate}T00:00:00`);
      const daysUntilDue = Math.round((due.getTime() - orgToday.getTime()) / 86_400_000);
      // The *schedule* stays measured from the due date, matching what Settings › Notifications
      // actually says ("days before / days after due date"). Only the framing below is grace-aware.
      //
      // Keeping the schedule on the due date matters: measuring it from the end of grace instead
      // would send nothing at all between the due date and the end of the grace period — precisely
      // the window in which the owner most needs chasing.
      const overdue = new Date(`${payment.overdueDate || payment.dueDate}T00:00:00`);
      const daysPastGrace = Math.round((orgToday.getTime() - overdue.getTime()) / 86_400_000);
      // Whether this master actually grants any grace, so the wording below only mentions a grace
      // period when there is one to mention.
      const withinGrace = Boolean(payment.overdueDate && payment.overdueDate !== payment.dueDate);
      const before = Array.isArray(notification.daysBefore) ? notification.daysBefore : [];
      const after = Array.isArray(notification.daysAfter) ? notification.daysAfter : [];
      const scheduled = daysUntilDue >= 0
        ? before.includes(daysUntilDue)
        : after.includes(Math.abs(daysUntilDue)) || notification.dailyOverdueEscalation === true;
      if (!scheduled) continue;
      const queueId = `${paymentDoc.id}_${dateOnly(orgToday)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const queueRef = db.collection('recurringPaymentNotificationQueue').doc(queueId);
      if ((await queueRef.get()).exists) continue;
      const channels = ['inApp','email','push','sms'].filter(channel => notification[channel] === true);
      await queueRef.create({
        organizationId, paymentId: paymentDoc.id, title: payment.title,
        dueDate: payment.dueDate, daysUntilDue, daysPastGrace, channels,
        recipients: notification.recipients || [], assignedTo: payment.assignedTo || '',
        status: 'Pending', attempts: 0, createdAt: FieldValue.serverTimestamp(),
      });
      // `dispatchNotificationOnce` delivers the in-app record *and* the push, so gating it on
      // `inApp` alone meant an organization that turned in-app off and push on received nothing at
      // all — the push channel was silently dependent on a different channel's setting.
      if ((notification.inApp || notification.push) && payment.assignedTo) {
        await dispatchNotificationOnce(
          { userIds: [String(payment.assignedTo)] },
          {
            type: 'recurring_payment_reminder',
            // Three distinct states, because the middle one used to be described as the last one:
            // past its due date but still inside the master's grace period. That produced "Payment
            // is due in -1 day(s)", and — before grace existed — a CRITICAL "Overdue" alert about a
            // payment the app itself still showed as in good standing.
            title: daysPastGrace > 0 ? `Overdue: ${payment.title}` : `Payment due: ${payment.title}`,
            body: daysPastGrace > 0
              ? `Payment was due ${Math.abs(daysUntilDue)} day(s) ago${withinGrace ? ' and its grace period has ended' : ''}.`
              : daysUntilDue < 0
                ? `Payment was due ${Math.abs(daysUntilDue)} day(s) ago and is inside its grace period until ${payment.overdueDate}.`
                : daysUntilDue === 0 ? 'Payment is due today.' : `Payment is due in ${daysUntilDue} day(s).`,
            module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
            // Escalate only once grace has actually run out; still due today, or late but covered by
            // grace, is a warning rather than a crisis.
            severity: daysPastGrace > 0 ? 'CRITICAL' : daysUntilDue <= 0 ? 'WARNING' : 'INFO',
            itemId: paymentDoc.id,
            itemRef: String(payment.title || ''),
            link: '/recurring-payments/payments',
          },
          `recurring_${queueId}`,
        );
      }
      remindersQueued++;
    } catch (error) {
      recordFailure('Reminder for payment', paymentDoc.id, error);
    }
  }
  const failed = failures.length;
  const result = { ok: true, runDate: dateOnly(now), checked: masterDocs.length, generated, skipped, automationDisabled: disabled, workflowTriggered, assigneeMissing, remindersQueued, failed };
  await db.collection('recurringPaymentAutomationLogs').add({
    organizationId: targetOrganizationId || 'all',
    jobName: targetOrganizationId ? 'Manual organization automation run' : 'Daily recurring payment generation',
    startedAt: Timestamp.fromMillis(runStartedAt), completedAt: FieldValue.serverTimestamp(),
    recordsProcessed: masterDocs.length, successCount: generated + workflowTriggered + remindersQueued,
    failureCount: assigneeMissing + failed,
    status: failed ? 'Partially Completed' : 'Completed',
    // Capped so one systemic fault across hundreds of records can't push the log past the 1 MiB document limit.
    ...(failed ? { errorDetails: failures.slice(0, 20).join('\n') + (failed > 20 ? `\n…and ${failed - 20} more` : '') } : {}),
    result, createdAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);
  return result;
}

/**
 * The manual "Run automation now" action, scoped to the caller's organization.
 *
 * Authorized through the shared access resolver — the same base + additional + temporary role
 * resolution the client's `can()` uses — rather than a lookup of the user's single legacy role.
 * That lookup refused anyone holding Manage Automation through an additional role, after the
 * Settings screen had already shown them the button.
 *
 * Runs the sweep directly instead of re-entering `GET` with a forged cron header.
 */
export async function POST(request: Request) {
  let organizationId: string;
  try {
    const context = await authenticateAccess(request);
    requireAnyAccess(context, [
      { resource: 'Recurring Payments.Settings', action: 'Manage Automation' },
      { resource: 'Recurring Payments.Settings', action: 'Edit' },
    ]);
    organizationId = context.organizationId;
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json(await runRecurringAutomation(organizationId));
}
