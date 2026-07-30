import { NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  DEFAULT_INSURANCE_WORKFLOW_CONFIG,
  INSURANCE_WORKFLOW_CONFIG_DOC_ID,
  INSURANCE_WORKFLOW_OPEN_STATUSES,
  insuranceDaysUntil,
  insuranceWorkflowDeadline,
  insuranceWorkflowPriority,
  normalizeInsuranceWorkflowConfig,
  resolveInsuranceWorkflowAssignment,
} from '@/lib/vehicle-insurance-workflow';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import type { User } from '@/lib/types';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirebaseAdminFirestore();
  const now = new Date();
  const nowTimestamp = Timestamp.fromDate(now);
  const [configSnapshot, userSnapshot, insuranceSnapshot, caseSnapshot] = await Promise.all([
    db.collection(VEHICLE_COLLECTIONS.settings).doc(INSURANCE_WORKFLOW_CONFIG_DOC_ID).get(),
    db.collection('users').get(),
    db.collection(VEHICLE_COLLECTIONS.insurance).get(),
    db.collection(VEHICLE_COLLECTIONS.insuranceWorkflowCases).get(),
  ]);
  const config = normalizeInsuranceWorkflowConfig(configSnapshot.exists ? configSnapshot.data() : DEFAULT_INSURANCE_WORKFLOW_CONFIG);
  const users = userSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as User));
  const maxTriggerDays = Math.max(...config.triggerDays);
  let created = 0;
  let escalated = 0;
  let reminders = 0;
  let skipped = 0;

  if (config.enabled) {
    for (const insuranceDoc of insuranceSnapshot.docs) {
      const policy = insuranceDoc.data();
      if (policy.isArchived === true || policy.renewalStatus === 'Renewed') { skipped++; continue; }
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
        workflowDeadline: Timestamp.fromDate(insuranceWorkflowDeadline(firstStep.tatHours, now)),
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
      for (const assigneeId of assignment.assigneeIds) {
        await db.collection('userNotifications').doc(`insurance_start_${caseRef.id}_${assigneeId}`).set({
          userId: assigneeId,
          type: 'step_entry',
          title: 'Insurance renewal assigned',
          body: `${policy.vehicleNumber || policy.policyNumber || 'Insurance policy'} requires renewal`,
          module: 'insurance',
          itemId: caseRef.id,
          itemRef: String(policy.vehicleNumber || policy.policyNumber || ''),
          stepName: firstStep.name,
          link: `/vehicle-management/insurance/workflow?case=${caseRef.id}`,
          read: false,
          createdAt: nowTimestamp,
        }, { merge: false });
      }
      created++;
    }
  }

  for (const caseDoc of caseSnapshot.docs) {
    const caseRow = caseDoc.data();
    if (!INSURANCE_WORKFLOW_OPEN_STATUSES.includes(caseRow.status) || !caseRow.workflowDeadline?.toDate) continue;
    const deadline = caseRow.workflowDeadline.toDate();
    if (deadline >= now) {
      const hoursRemaining = (deadline.getTime() - now.getTime()) / 3_600_000;
      if (config.reminderBeforeHours > 0 && hoursRemaining <= config.reminderBeforeHours) {
        for (const assigneeId of Array.isArray(caseRow.assigneeIds) ? caseRow.assigneeIds : []) {
          const reminderId = `insurance_tat_${caseDoc.id}_${caseRow.currentStepId}_${deadline.getTime()}_${assigneeId}`;
          const reminderRef = db.collection('userNotifications').doc(reminderId);
          if ((await reminderRef.get()).exists) continue;
          await reminderRef.set({
            userId: assigneeId,
            type: 'step_entry',
            title: 'Insurance workflow TAT reminder',
            body: `${caseRow.vehicleNumber || caseRow.policyNumber || 'Insurance renewal'} is due in ${Math.max(1, Math.ceil(hoursRemaining))} hour(s)`,
            module: 'insurance',
            itemId: caseDoc.id,
            itemRef: String(caseRow.vehicleNumber || caseRow.policyNumber || ''),
            stepName: String(caseRow.currentStepName || ''),
            link: `/vehicle-management/insurance/workflow?case=${caseDoc.id}`,
            read: false,
            createdAt: nowTimestamp,
          });
          reminders++;
        }
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
      workflowDeadline: Timestamp.fromDate(insuranceWorkflowDeadline(workflowStep.tatHours, now)),
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
      const notificationId = `insurance_escalation_${caseDoc.id}_${Number(caseRow.escalationLevel || 0) + 1}_${nextUser.id}`;
      await db.collection('userNotifications').doc(notificationId).set({
        userId: nextUser.id,
        type: 'tat_escalation',
        title: 'Insurance TAT escalated',
        body: `${caseRow.vehicleNumber || caseRow.policyNumber || 'Insurance renewal'} requires action`,
        module: 'insurance',
        itemId: caseDoc.id,
        itemRef: String(caseRow.vehicleNumber || caseRow.policyNumber || ''),
        stepName: workflowStep.name,
        link: `/vehicle-management/insurance/workflow?case=${caseDoc.id}`,
        read: false,
        createdAt: nowTimestamp,
      }, { merge: false });
    }
    escalated++;
  }

  return NextResponse.json({ ok: true, checked: insuranceSnapshot.size, created, reminders, escalated, skipped, workflowEnabled: config.enabled });
}
