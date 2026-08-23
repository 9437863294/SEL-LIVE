import { NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  DEFAULT_INSURANCE_WORKFLOW_CONFIG,
  INSURANCE_WORKFLOW_CONFIG_DOC_ID,
  INSURANCE_WORKFLOW_OPEN_STATUSES,
  insuranceDaysUntil,
  insuranceWorkflowPriority,
  normalizeInsuranceWorkflowConfig,
  resolveInsuranceWorkflowAssignment,
} from '@/lib/vehicle-insurance-workflow';
import { getVehicleComplianceRequirements, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { addBusinessHours, normalizeWorkingHoursDoc } from '@/lib/working-hours';
import { dispatchNotificationOnce } from '@/lib/notifications-server';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import type { Holiday, User } from '@/lib/types';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirebaseAdminFirestore();
  const now = new Date();
  const nowTimestamp = Timestamp.fromDate(now);
  const [configSnapshot, userSnapshot, insuranceSnapshot, caseSnapshot, vehicleSnapshot, workingHoursSnap, holidaysSnap] = await Promise.all([
    db.collection(VEHICLE_COLLECTIONS.settings).doc(INSURANCE_WORKFLOW_CONFIG_DOC_ID).get(),
    db.collection('users').get(),
    db.collection(VEHICLE_COLLECTIONS.insurance).get(),
    db.collection(VEHICLE_COLLECTIONS.insuranceWorkflowCases).get(),
    db.collection(VEHICLE_COLLECTIONS.vehicleMaster).get(),
    db.collection('settings').doc('workingHours').get(),
    db.collection('holidays').get(),
  ]);
  const config = normalizeInsuranceWorkflowConfig(configSnapshot.exists ? configSnapshot.data() : DEFAULT_INSURANCE_WORKFLOW_CONFIG);
  // Fetched once for the whole run — accounts for the org's configured working hours/holidays
  // instead of raw calendar time when computing each case's TAT deadline.
  const workingHours = normalizeWorkingHoursDoc(workingHoursSnap.data());
  const holidays = holidaysSnap.docs.map((item) => item.data() as Holiday);
  const users = userSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as User));
  // Needed so Sold/Scrapped vehicles (or ones with insurance manually turned off) never get a
  // renewal case created/escalated just because their old policy has a past expiry date.
  const vehicleMap = new Map(vehicleSnapshot.docs.map((item) => [item.id, item.data()]));
  const maxTriggerDays = Math.max(...config.triggerDays);
  let created = 0;
  let escalated = 0;
  let reminders = 0;
  let skipped = 0;

  if (config.enabled) {
    for (const insuranceDoc of insuranceSnapshot.docs) {
      const policy = insuranceDoc.data();
      if (policy.isArchived === true || policy.renewalStatus === 'Renewed') { skipped++; continue; }
      const vehicle = vehicleMap.get(String(policy.vehicleId || ''));
      if (vehicle && !getVehicleComplianceRequirements(vehicle).insurance) { skipped++; continue; }
      const daysToExpiry = insuranceDaysUntil(String(policy.expiryDate || ''), now);
      if (!Number.isFinite(daysToExpiry) || daysToExpiry > maxTriggerDays) { skipped++; continue; }
      const caseRef = db.collection(VEHICLE_COLLECTIONS.insuranceWorkflowCases).doc(insuranceDoc.id);
      if ((await caseRef.get()).exists) { skipped++; continue; }
      const firstStep = config.steps[0];
      if (!firstStep) { skipped++; continue; }
      const assignment = resolveInsuranceWorkflowAssignment(firstStep, Number(policy.premiumAmount || 0), users, config);
      const history = {
        action: 'Workflow Started',
        comment: daysToExpiry < 0 ? `Policy expired ${Math.abs(daysToExpiry)} day(s) ago.` : `Policy expires in ${daysToExpiry} day(s).`,
        userId: 'system',
        userName: 'Daily Expiry Monitor',
        stepId: firstStep.id,
        stepName: firstStep.name,
        timestamp: nowTimestamp,
      };
      await caseRef.create({
        insuranceId: insuranceDoc.id,
        vehicleId: String(policy.vehicleId || ''),
        vehicleNumber: String(policy.vehicleNumber || ''),
        policyNumber: String(policy.policyNumber || ''),
        insuranceCompany: String(policy.insuranceCompany || ''),
        policyType: String(policy.policyType || ''),
        expiryDate: String(policy.expiryDate || ''),
        currentPremium: Number(policy.premiumAmount || 0),
        daysToExpiry,
        priority: insuranceWorkflowPriority(daysToExpiry),
        status: 'Open',
        currentStepId: firstStep.id,
        currentStepName: firstStep.name,
        currentStepIndex: 0,
        totalSteps: config.steps.length,
        ...assignment,
        escalationLevel: 0,
        workflowDeadline: Timestamp.fromDate(addBusinessHours(now, firstStep.tatHours, workingHours, holidays)),
        stepStartedAt: nowTimestamp,
        acknowledgedAt: null,
        history: [{ ...history, timestamp: nowTimestamp }],
        createdAt: nowTimestamp,
        updatedAt: nowTimestamp,
      });
      await insuranceDoc.ref.update({ workflowCaseId: caseRef.id, renewalStatus: 'Workflow Started', updatedAt: FieldValue.serverTimestamp() });
      await db.collection(VEHICLE_COLLECTIONS.insuranceWorkflowActivities).add({
        caseId: caseRef.id,
        insuranceId: insuranceDoc.id,
        vehicleId: String(policy.vehicleId || ''),
        vehicleNumber: String(policy.vehicleNumber || ''),
        action: history.action,
        comment: history.comment,
        userId: history.userId,
        userName: history.userName,
        stepId: history.stepId,
        stepName: history.stepName,
        createdAt: nowTimestamp,
      });
      // One dispatch for all assignees rather than a write per assignee, so the
      // renewal also reaches their phones and browsers. `module` was the lowercase
      // 'insurance', which filed these under a module of their own in the audit
      // viewer; the dispatcher canonicalises it.
      await dispatchNotificationOnce(
        { userIds: assignment.assigneeIds },
        {
          type: 'step_entry',
          title: 'Insurance renewal assigned',
          body: `${policy.vehicleNumber || policy.policyNumber || 'Insurance policy'} requires renewal`,
          module: ACTIVITY_MODULES.INSURANCE,
          severity: 'WARNING',
          itemId: caseRef.id,
          itemRef: String(policy.vehicleNumber || policy.policyNumber || ''),
          stepName: firstStep.name,
          link: `/vehicle-management/insurance/workflow?case=${caseRef.id}`,
        },
        `insurance_start_${caseRef.id}`,
      );
      created++;
    }
  }

  for (const caseDoc of caseSnapshot.docs) {
    const caseRow = caseDoc.data();
    if (!INSURANCE_WORKFLOW_OPEN_STATUSES.includes(caseRow.status) || !caseRow.workflowDeadline?.toDate) continue;
    // The vehicle may have been marked Sold/Scrapped (or insurance manually turned off)
    // after this case was opened — stop escalating/reminding and close it out instead.
    const caseVehicle = vehicleMap.get(String(caseRow.vehicleId || ''));
    if (caseVehicle && !getVehicleComplianceRequirements(caseVehicle).insurance) {
      await caseDoc.ref.update({
        status: 'Closed',
        history: FieldValue.arrayUnion({
          action: 'Auto-Closed',
          comment: 'Insurance is no longer required for this vehicle.',
          userId: 'system',
          userName: 'Daily Expiry Monitor',
          stepId: String(caseRow.currentStepId || ''),
          stepName: String(caseRow.currentStepName || ''),
          timestamp: nowTimestamp,
        }),
        updatedAt: nowTimestamp,
      });
      skipped++;
      continue;
    }
    const deadline = caseRow.workflowDeadline.toDate();
    if (deadline >= now) {
      const hoursRemaining = (deadline.getTime() - now.getTime()) / 3_600_000;
      if (config.reminderBeforeHours > 0 && hoursRemaining <= config.reminderBeforeHours) {
        // The dedupe key carries the deadline, so a rescheduled step reminds again
        // while repeat passes over the same deadline stay quiet. Replaces a
        // read-then-write per assignee, which both cost an extra round trip and left
        // a window for two overlapping runs to remind twice.
        reminders += await dispatchNotificationOnce(
          { userIds: Array.isArray(caseRow.assigneeIds) ? caseRow.assigneeIds : [] },
          {
            type: 'step_entry',
            title: 'Insurance workflow TAT reminder',
            body: `${caseRow.vehicleNumber || caseRow.policyNumber || 'Insurance renewal'} is due in ${Math.max(1, Math.ceil(hoursRemaining))} hour(s)`,
            module: ACTIVITY_MODULES.INSURANCE,
            severity: 'WARNING',
            itemId: caseDoc.id,
            itemRef: String(caseRow.vehicleNumber || caseRow.policyNumber || ''),
            stepName: String(caseRow.currentStepName || ''),
            link: `/vehicle-management/insurance/workflow?case=${caseDoc.id}`,
          },
          `insurance_tat_${caseDoc.id}_${caseRow.currentStepId}_${deadline.getTime()}`,
        );
      }
      continue;
    }
    const workflowStep = config.steps.find((item) => item.id === caseRow.currentStepId) || config.steps[Number(caseRow.currentStepIndex || 0)];
    if (!workflowStep) continue;
    const nextUserId = config.autoEscalate && caseRow.backupAssigneeId ? String(caseRow.backupAssigneeId) : String(caseRow.assigneeIds?.[0] || '');
    const nextUser = users.find((item) => item.id === nextUserId);
    const history = {
      action: 'TAT Escalated',
      comment: nextUser ? `Escalated to ${nextUser.name || nextUser.email}.` : 'TAT breached; manager action required.',
      userId: 'system',
      userName: 'Daily Expiry Monitor',
      stepId: workflowStep.id,
      stepName: workflowStep.name,
      timestamp: nowTimestamp,
    };
    await caseDoc.ref.update({
      status: 'Escalated',
      assigneeIds: nextUser ? [nextUser.id] : caseRow.assigneeIds || [],
      assigneeNames: nextUser ? [nextUser.name || nextUser.email] : caseRow.assigneeNames || [],
      escalationLevel: Number(caseRow.escalationLevel || 0) + 1,
      workflowDeadline: Timestamp.fromDate(addBusinessHours(now, workflowStep.tatHours, workingHours, holidays)),
      history: FieldValue.arrayUnion(history),
      updatedAt: nowTimestamp,
    });
    await db.collection(VEHICLE_COLLECTIONS.insuranceWorkflowActivities).add({
      caseId: caseDoc.id,
      insuranceId: String(caseRow.insuranceId || ''),
      vehicleId: String(caseRow.vehicleId || ''),
      vehicleNumber: String(caseRow.vehicleNumber || ''),
      action: history.action,
      comment: history.comment,
      userId: history.userId,
      userName: history.userName,
      stepId: history.stepId,
      stepName: history.stepName,
      createdAt: nowTimestamp,
    });
    if (nextUser) {
      await dispatchNotificationOnce(
        { userIds: [nextUser.id] },
        {
          type: 'tat_escalation',
          title: 'Insurance TAT escalated',
          body: `${caseRow.vehicleNumber || caseRow.policyNumber || 'Insurance renewal'} requires action`,
          module: ACTIVITY_MODULES.INSURANCE,
          severity: 'CRITICAL',
          itemId: caseDoc.id,
          itemRef: String(caseRow.vehicleNumber || caseRow.policyNumber || ''),
          stepName: workflowStep.name,
          link: `/vehicle-management/insurance/workflow?case=${caseDoc.id}`,
        },
        // Escalation level is part of the key, so each successive escalation alerts
        // again rather than being suppressed as a duplicate of the previous one.
        `insurance_escalation_${caseDoc.id}_${Number(caseRow.escalationLevel || 0) + 1}`,
      );
    }
    escalated++;
  }

  return NextResponse.json({ ok: true, checked: insuranceSnapshot.size, created, reminders, escalated, skipped, workflowEnabled: config.enabled });
}
