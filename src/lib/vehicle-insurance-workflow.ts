import type { Timestamp } from 'firebase/firestore';
import type { User } from '@/lib/types';

export const INSURANCE_WORKFLOW_CONFIG_DOC_ID = 'insuranceWorkflowConfig';

export type InsuranceWorkflowAssignmentType = 'User' | 'Role' | 'Premium-based';
export type InsuranceWorkflowCaseStatus =
  | 'Open'
  | 'In Progress'
  | 'Escalated'
  | 'Returned'
  | 'Ready for Renewal'
  | 'Completed'
  | 'Rejected'
  | 'Cancelled';

export type InsuranceWorkflowAction = 'Acknowledge' | 'Complete' | 'Approve' | 'Return' | 'Reject';

export interface InsuranceWorkflowStep {
  id: string;
  name: string;
  description: string;
  tatHours: number;
  assignmentType: InsuranceWorkflowAssignmentType;
  primaryUserId: string;
  backupUserId: string;
  role: string;
  highValueUserId: string;
  highValueRole: string;
  actions: InsuranceWorkflowAction[];
  documentRequired: boolean;
}

export interface InsuranceWorkflowConfig {
  enabled: boolean;
  triggerDays: number[];
  highValuePremiumThreshold: number;
  autoEscalate: boolean;
  reminderBeforeHours: number;
  fallbackUserId: string;
  steps: InsuranceWorkflowStep[];
  updatedAt?: Timestamp;
}

export interface InsuranceWorkflowHistoryEntry {
  action: string;
  comment: string;
  userId: string;
  userName: string;
  stepId: string;
  stepName: string;
  timestamp: Timestamp;
}

export interface InsuranceRenewalCase {
  id: string;
  insuranceId: string;
  vehicleId: string;
  vehicleNumber: string;
  policyNumber: string;
  insuranceCompany: string;
  policyType: string;
  expiryDate: string;
  currentPremium: number;
  proposedPremium?: number;
  daysToExpiry: number;
  priority: 'Normal' | 'High' | 'Critical';
  status: InsuranceWorkflowCaseStatus;
  currentStepId: string;
  currentStepName: string;
  currentStepIndex: number;
  totalSteps: number;
  assigneeIds: string[];
  assigneeNames: string[];
  backupAssigneeId: string;
  escalationLevel: number;
  workflowDeadline?: Timestamp | null;
  stepStartedAt?: Timestamp;
  acknowledgedAt?: Timestamp | null;
  renewedInsuranceId?: string;
  renewalHref?: string;
  documentReferences?: Array<{
    stepId: string;
    stepName: string;
    reference: string;
    fileName?: string;
    contentType?: string;
    addedBy: string;
    addedAt: Timestamp;
  }>;
  history: InsuranceWorkflowHistoryEntry[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  completedAt?: Timestamp;
}

const step = (
  id: string,
  name: string,
  description: string,
  tatHours: number,
  assignmentType: InsuranceWorkflowAssignmentType,
  role: string,
  actions: InsuranceWorkflowAction[],
  documentRequired = false
): InsuranceWorkflowStep => ({
  id,
  name,
  description,
  tatHours,
  assignmentType,
  primaryUserId: '',
  backupUserId: '',
  role,
  highValueUserId: '',
  highValueRole: assignmentType === 'Premium-based' ? 'Finance Manager' : '',
  actions,
  documentRequired,
});

export const DEFAULT_INSURANCE_WORKFLOW_CONFIG: InsuranceWorkflowConfig = {
  enabled: true,
  triggerDays: [90, 60, 30, 15, 7, 0],
  highValuePremiumThreshold: 100000,
  autoEscalate: true,
  reminderBeforeHours: 4,
  fallbackUserId: '',
  steps: [
    step('documents', 'Document Collection', 'Collect RC, existing policy, claims information and renewal requirements.', 48, 'Role', 'Insurance Officer', ['Acknowledge', 'Complete'], true),
    step('quotes', 'Quote Comparison', 'Collect and compare insurer quotes, IDV, coverage and exclusions.', 48, 'Role', 'Insurance Officer', ['Acknowledge', 'Complete'], true),
    step('approval', 'Renewal Approval', 'Route standard premiums to the insurance owner and high-value premiums to finance.', 24, 'Premium-based', 'Insurance Officer', ['Acknowledge', 'Approve', 'Return', 'Reject']),
    step('payment', 'Premium Payment', 'Record approval reference and complete the premium payment process.', 24, 'Role', 'Accounts', ['Acknowledge', 'Complete', 'Return'], true),
    step('activation', 'Policy Activation', 'Upload and validate the renewed policy before activating compliance.', 8, 'Role', 'Insurance Officer', ['Acknowledge', 'Complete', 'Return']),
  ],
};

export function normalizeInsuranceWorkflowConfig(value?: Partial<InsuranceWorkflowConfig> | null): InsuranceWorkflowConfig {
  const source = value || {};
  const steps: InsuranceWorkflowStep[] = Array.isArray(source.steps) && source.steps.length
    ? source.steps.map((item, index) => ({
        ...DEFAULT_INSURANCE_WORKFLOW_CONFIG.steps[Math.min(index, DEFAULT_INSURANCE_WORKFLOW_CONFIG.steps.length - 1)],
        ...item,
        id: String(item.id || `step-${index + 1}`),
        name: String(item.name || `Step ${index + 1}`),
        tatHours: Math.max(1, Number(item.tatHours || 1)),
        actions: Array.isArray(item.actions) && item.actions.length ? item.actions : (['Acknowledge', 'Complete'] as InsuranceWorkflowAction[]),
      }))
    : DEFAULT_INSURANCE_WORKFLOW_CONFIG.steps.map((item) => ({ ...item }));

  return {
    ...DEFAULT_INSURANCE_WORKFLOW_CONFIG,
    ...source,
    triggerDays: Array.isArray(source.triggerDays) && source.triggerDays.length
      ? Array.from(new Set(source.triggerDays.map(Number).filter(Number.isFinite))).sort((a, b) => b - a)
      : [...DEFAULT_INSURANCE_WORKFLOW_CONFIG.triggerDays],
    highValuePremiumThreshold: Math.max(0, Number(source.highValuePremiumThreshold ?? DEFAULT_INSURANCE_WORKFLOW_CONFIG.highValuePremiumThreshold)),
    reminderBeforeHours: Math.max(0, Number(source.reminderBeforeHours ?? DEFAULT_INSURANCE_WORKFLOW_CONFIG.reminderBeforeHours)),
    steps,
  };
}

export function insuranceDaysUntil(dateValue: string, now = new Date()) {
  const target = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

export function insuranceWorkflowPriority(daysToExpiry: number): InsuranceRenewalCase['priority'] {
  if (daysToExpiry <= 7) return 'Critical';
  if (daysToExpiry <= 30) return 'High';
  return 'Normal';
}

export function resolveInsuranceWorkflowAssignment(
  workflowStep: InsuranceWorkflowStep,
  premium: number,
  users: User[],
  config: Pick<InsuranceWorkflowConfig, 'highValuePremiumThreshold' | 'fallbackUserId'>
) {
  const activeUsers = users.filter((user) => user.status !== 'Inactive');
  const userById = new Map(activeUsers.map((user) => [String(user.id), user]));
  let primaryId = '';

  if (workflowStep.assignmentType === 'User') {
    primaryId = workflowStep.primaryUserId;
  } else if (workflowStep.assignmentType === 'Premium-based' && premium > config.highValuePremiumThreshold) {
    primaryId = workflowStep.highValueUserId || activeUsers.find((user) => user.role === workflowStep.highValueRole)?.id || '';
  } else {
    primaryId = workflowStep.primaryUserId || activeUsers.find((user) => user.role === workflowStep.role)?.id || '';
  }

  if (!primaryId || !userById.has(primaryId)) primaryId = config.fallbackUserId;
  const primary = userById.get(primaryId);
  const backup = userById.get(workflowStep.backupUserId);
  return {
    assigneeIds: primary ? [primary.id] : [],
    assigneeNames: primary ? [primary.name || primary.email || 'Assigned User'] : [],
    backupAssigneeId: backup?.id || '',
  };
}

export function insuranceWorkflowProgress(caseRow: Pick<InsuranceRenewalCase, 'currentStepIndex' | 'totalSteps' | 'status'>) {
  if (caseRow.status === 'Completed') return 100;
  return Math.max(0, Math.min(100, Math.round((caseRow.currentStepIndex / Math.max(1, caseRow.totalSteps)) * 100)));
}

export function insuranceWorkflowDeadlineMeta(deadline?: Timestamp | null) {
  if (!deadline?.toDate) return { overdue: false, hoursRemaining: null as number | null, label: 'No TAT' };
  const diffMs = deadline.toDate().getTime() - Date.now();
  const hours = Math.ceil(Math.abs(diffMs) / 3_600_000);
  return {
    overdue: diffMs < 0,
    hoursRemaining: diffMs < 0 ? -hours : hours,
    label: diffMs < 0 ? `${hours}h overdue` : `${hours}h remaining`,
  };
}

export const INSURANCE_WORKFLOW_OPEN_STATUSES: InsuranceWorkflowCaseStatus[] = [
  'Open',
  'In Progress',
  'Escalated',
  'Returned',
  'Ready for Renewal',
];
