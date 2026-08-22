import type { Timestamp } from 'firebase/firestore';
import {
  DEFAULT_ESCALATION_LADDER,
  DEFAULT_SLA_TARGETS,
  type ApplicationStage,
  type CompensationApprovalStatus,
  type DocumentVerificationStatus,
  type EmploymentType,
  type EscalationLevel,
  type HrApprovalRule,
  type HrApprovalStage,
  type HrApprovalStageKey,
  type InterviewMode,
  type InterviewRatings,
  type InterviewRecommendation,
  type InterviewRound,
  type JoiningStatus,
  type OfferStatus,
  type RecruitmentCostHead,
  type RecruitmentSourceKind,
  type RequirementHoldReason,
  type RequirementPriority,
  type RequirementReason,
  type RequirementStatus,
  type RequirementType,
  type ScreeningResult,
  type SlaTargets,
} from './hr-policy';

/**
 * Data model for HR Requirement Management (`docs/hr-requirement-management.md`).
 *
 * The rules — SLA maths, approval-matrix resolution, CTC band checks, duplicate detection, funnel
 * analytics — live in `hr-policy.ts`, which is dependency-free so it runs in the browser, on mobile
 * and in Admin-SDK cron routes, and stays unit-testable. It is re-exported from here so every
 * consumer imports the module from one place, exactly as `tour-travel.ts` re-exports its policy
 * module.
 *
 * The lifecycle this model supports (spec section 1):
 *
 *   Manpower plan → Requirement → Approval → Recruiter → JD → Sourcing → Screening → Interviews
 *     → Selection → Compensation approval → Offer → Pre-joining → Joining → Employee Master
 *
 * Four structural decisions are worth knowing before reading the interfaces:
 *
 *   1. **Candidate and application are separate collections** (spec sections 19 and 21). A candidate
 *      exists once; an application is one candidate against one requirement. Storing applications on
 *      the candidate — or copying candidate details per requirement — is what produces the six
 *      near-identical profiles per person that control rule 63.8 exists to prevent.
 *
 *   2. **Counts on a requirement are denormalised, never authoritative.** `joinedCount`,
 *      `offeredCount` and the rest are maintained by the service for querying and dashboards, but
 *      the truth is the joining records and offers themselves (control rule 63.4). Anything that
 *      must be right — closure, fill status — recomputes from the child collections.
 *
 *   3. **Interview feedback is its own collection and append-only.** A revision is a new document
 *      with `revisionOf` set, so a submitted evaluation can never be quietly rewritten after a
 *      selection goes the other way (control rule 63.6).
 *
 *   4. **Salary fields are separated from the rest of the requirement**, so a screen can render a
 *      requisition in full for a requesting manager without CTC figures (control rule 63.12).
 */

export * from './hr-policy';

export const HR_COLLECTIONS = {
  requirements: 'hrRequirements',
  requirementApprovals: 'hrRequirementApprovals',
  manpowerPlans: 'hrManpowerPlans',
  requirementTemplates: 'hrRequirementTemplates',

  candidates: 'candidates',
  applications: 'candidateApplications',

  interviews: 'interviews',
  interviewFeedback: 'interviewFeedback',

  selectionProposals: 'selectionProposals',
  compensationApprovals: 'compensationApprovals',

  offers: 'offers',
  preJoining: 'preJoining',
  joiningRecords: 'joiningRecords',

  agencies: 'recruitmentAgencies',
  talentPool: 'talentPools',
  jobDescriptions: 'jobDescriptions',
  recruitmentSources: 'recruitmentSources',
  referrals: 'hrReferrals',
  costs: 'hrRecruitmentCosts',

  activities: 'hrActivities',
  escalations: 'hrEscalations',
  settings: 'hrSettings',
  counters: 'hrCounters',
} as const;

/** Every record in the module carries these, so the audit strip renders the same everywhere. */
export interface HrAuditFields {
  createdAt?: Timestamp | null;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
  updatedByName?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Manpower planning (spec section 4)
 * ---------------------------------------------------------------------------------------------- */

export interface HrManpowerPlan extends HrAuditFields {
  id: string;
  organizationId: string;
  planNumber?: string;
  financialYear: string;
  /** A plan is either departmental or project-wise; both may be set for a project department. */
  departmentId?: string;
  departmentName?: string;
  projectId?: string;
  projectName?: string;
  designation: string;
  grade?: string;
  /** Sanctioned strength — the ceiling approvals are checked against (spec section 13). */
  approvedStrength: number;
  /** Employees on roll when the plan was last refreshed. */
  existingStrength: number;
  plannedAdditional: number;
  /** Forecast outflow, so a vacancy can be seen before the resignation lands. */
  expectedExits?: number;
  remarks?: string;
  status: 'Draft' | 'Approved' | 'Revised' | 'Closed';
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp | null;
}

/* ------------------------------------------------------------------------------------------------
 * Requirement (spec sections 5–11)
 * ---------------------------------------------------------------------------------------------- */

/** The outgoing employee on a replacement requirement (spec section 6, control rule 63.11). */
export interface ReplacementDetails {
  employeeId: string;
  employeeCode?: string;
  employeeName: string;
  designation?: string;
  /** Read from the employee master; rendered only to holders of the sensitive-data permission. */
  currentCtc?: number;
  reason: RequirementReason;
  lastWorkingDate?: string;
  exitId?: string;
}

/** Skills and experience captured on the requirement, feeding the JD (spec sections 8, 17). */
export interface RequirementSkills {
  primarySkills: string[];
  secondarySkills?: string[];
  mandatorySkills?: string[];
  preferredSkills?: string[];
  industryExperience?: string;
  projectExperience?: string;
  certifications?: string[];
  softwareKnowledge?: string[];
  equipmentExperience?: string[];
  communicationSkills?: string;
  leadershipSkills?: string;
  domain?: string;
}

/** Budget block (spec section 9). Held in its own object so it can be withheld as a unit. */
export interface RequirementBudget {
  budgetedGrade?: string;
  bandMin?: number;
  bandMax?: number;
  expectedCtc?: number;
  maximumApprovedCtc?: number;
  projectBudget?: number;
  costCentre?: string;
  budgetAvailable?: boolean;
  /** Set at submission from `evaluateCtcAgainstBand`, so approvers see what routed the request. */
  ctcAboveBand?: boolean;
  ctcVariancePercent?: number;
}

/** Justification block (spec section 10). Mandatory for headcount-adding types. */
export interface RequirementJustification {
  businessJustification?: string;
  currentWorkload?: string;
  projectRequirement?: string;
  revenueImpact?: string;
  clientRequirement?: string;
  contractualRequirement?: string;
  whyExistingManpowerInsufficient?: string;
  impactIfVacant?: string;
}

export interface HrAttachment {
  id: string;
  name: string;
  url: string;
  kind?: string;
  sizeBytes?: number;
  uploadedBy?: string;
  uploadedByName?: string;
  uploadedAt?: Timestamp | null;
}

export interface HrRequirement extends HrAuditFields {
  id: string;
  organizationId: string;
  /** `HR-REQ-2026-00128`, allocated in a transaction (control rule 63.1). */
  requirementNumber: string;
  requirementDate: string;

  departmentId: string;
  departmentName: string;
  projectId?: string;
  projectName?: string;
  siteId?: string;
  siteName?: string;
  locationId?: string;
  location?: string;

  requestingManagerId: string;
  requestingManagerName: string;
  requirementOwnerId?: string;
  requirementOwnerName?: string;
  departmentHodId?: string;
  projectHeadId?: string;

  requirementType: RequirementType;
  requirementReason?: RequirementReason;
  replacement?: ReplacementDetails | null;

  designation: string;
  jobTitle: string;
  grade: string;
  requestedQuantity: number;
  employmentType: EmploymentType;
  reportingToId?: string;
  reportingToName?: string;
  requiredJoiningDate: string;
  priority: RequirementPriority;
  shift?: string;
  travelRequirement?: string;
  /** Only where a genuine occupational requirement exists (spec section 7). */
  genderRequirement?: 'Any' | 'Male' | 'Female';
  genderRequirementJustification?: string;
  minAge?: number;
  maxAge?: number;
  minExperienceYears: number;
  maxExperienceYears?: number;
  qualification: string;
  specialization?: string;

  skills: RequirementSkills;
  budget: RequirementBudget;
  justification?: RequirementJustification;
  attachments?: HrAttachment[];

  /** Section 11 — an advisory duplicate the requester chose to proceed past, or link to. */
  linkedRequirementIds?: string[];
  duplicateAcknowledged?: boolean;
  /** Section 44 — the requirement this one replaces, keeping manpower history traceable. */
  originalRequirementId?: string;

  status: RequirementStatus;
  /** Which approval stage is waiting, and who may act on it. */
  currentApprovalStage?: HrApprovalStageKey | null;
  currentApprovalStageLabel?: string;
  pendingApproverIds?: string[];
  approvalRuleId?: string | null;
  approvalRuleName?: string;
  approvalStages?: HrApprovalStage[];
  approvalStageIndex?: number;
  fastTrack?: boolean;

  submittedAt?: Timestamp | null;
  approvedAt?: Timestamp | null;
  rejectedAt?: Timestamp | null;
  rejectionReason?: string;

  primaryRecruiterId?: string;
  primaryRecruiterName?: string;
  secondaryRecruiterId?: string;
  secondaryRecruiterName?: string;
  recruiterAssignedAt?: Timestamp | null;
  targetClosureDate?: string;

  /** Sourcing channels selected for this requirement (spec section 18). */
  sourcingChannels?: RecruitmentSourceKind[];
  agencyIds?: string[];
  jobDescriptionId?: string;
  jdPublished?: boolean;

  /**
   * Denormalised counters (see the header note). Maintained by the service for register filtering
   * and dashboard aggregation; recomputed from child collections before any decision that matters.
   */
  applicationCount?: number;
  screeningCount?: number;
  interviewingCount?: number;
  selectedCount?: number;
  offeredCount?: number;
  offerAcceptedCount?: number;
  joinedCount?: number;
  cancelledPositions?: number;

  /** SLA state, refreshed by the escalation cron (spec sections 40, 41). */
  slaTargetDays?: number;
  slaStartedAt?: Timestamp | null;
  slaHeldDays?: number;
  slaConsumedPercent?: number;
  slaState?: 'Not started' | 'On track' | 'Due soon' | 'Overdue';
  escalationsSent?: number[];

  holdReason?: RequirementHoldReason | null;
  holdRemarks?: string;
  heldAt?: Timestamp | null;
  heldBy?: string;

  closureType?: 'Fully Filled' | 'Partially Filled' | 'Cancelled' | 'Expired';
  closureReason?: string;
  closedAt?: Timestamp | null;
  closedBy?: string;
  closedByName?: string;

  cancellationReason?: string;
  cancelledAt?: Timestamp | null;

  notes?: string;
}

/** One decision on one approval stage (spec sections 14, 57). */
export interface HrRequirementApproval extends HrAuditFields {
  id: string;
  organizationId: string;
  requirementId: string;
  requirementNumber?: string;
  stageKey: HrApprovalStageKey;
  stageLabel: string;
  stageIndex: number;
  action: 'Approve' | 'Reject' | 'Send Back' | 'Request Clarification' | 'Forward' | 'Delegate' | 'Approve With Condition';
  approverId: string;
  approverName: string;
  /** Set when the acting user is not the assigned approver — a delegate or a forward. */
  onBehalfOfId?: string;
  onBehalfOfName?: string;
  forwardedToId?: string;
  forwardedToName?: string;
  remarks?: string;
  condition?: string;
  /** Business-hours deadline for the stage, from the app's working-hours configuration. */
  dueAt?: Timestamp | null;
  actedAt?: Timestamp | null;
}

/** Job description, versioned (spec section 17). */
export interface JobDescription extends HrAuditFields {
  id: string;
  organizationId: string;
  title: string;
  designation?: string;
  grade?: string;
  /** Set when this JD belongs to a requirement rather than the reusable master. */
  requirementId?: string;
  isMaster?: boolean;
  version: number;
  supersedesId?: string;
  purpose?: string;
  responsibilities?: string[];
  qualification?: string;
  experience?: string;
  technicalSkills?: string[];
  behaviouralSkills?: string[];
  location?: string;
  reportingTo?: string;
  travel?: string;
  employmentType?: EmploymentType;
  /** Published JDs never carry the band unless the organisation opts in (control rule 63.12). */
  showCtcRange?: boolean;
  ctcRangeText?: string;
  status: 'Draft' | 'Pending Approval' | 'Approved' | 'Published' | 'Archived';
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp | null;
}

/** A reusable manpower template for a project type (spec sections 50, 51). */
export interface RequirementTemplate extends HrAuditFields {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  projectType?: string;
  active?: boolean;
  lines: Array<{
    designation: string;
    grade?: string;
    quantity: number;
    employmentType?: EmploymentType;
    priority?: RequirementPriority;
    minExperienceYears?: number;
    qualification?: string;
  }>;
}

/* ------------------------------------------------------------------------------------------------
 * Candidate and application (spec sections 19–23)
 * ---------------------------------------------------------------------------------------------- */

export interface Candidate extends HrAuditFields {
  id: string;
  organizationId: string;
  candidateNumber: string;
  name: string;
  mobile: string;
  alternateMobile?: string;
  email: string;
  dateOfBirth?: string;
  gender?: string;
  /** Collected late, at pre-joining; used for duplicate detection when present (§20). */
  pan?: string;

  currentCompany?: string;
  currentDesignation?: string;
  currentLocation?: string;
  locationId?: string;
  preferredLocations?: string[];
  totalExperienceYears?: number;
  relevantExperienceYears?: number;
  currentCtc?: number;
  expectedCtc?: number;
  noticePeriodDays?: number;
  qualification?: string;
  specialization?: string;
  skills?: string[];

  resumeUrl?: string;
  resumeFileName?: string;
  documents?: HrAttachment[];

  source: RecruitmentSourceKind;
  sourceDetail?: string;
  agencyId?: string;
  agencyName?: string;
  referredByEmployeeId?: string;
  referredByEmployeeName?: string;
  /** An internal candidate — an employee applying through IJP (spec section 45). */
  isInternal?: boolean;
  employeeId?: string;

  ownerRecruiterId?: string;
  ownerRecruiterName?: string;

  /** Talent-pool categories this candidate sits in (spec section 48). */
  talentPoolCategories?: string[];
  inTalentPool?: boolean;

  /**
   * Do-not-hire. Deliberately requires a reason and an authoriser: an unexplained blacklist flag on
   * a person's record is both unfair and indefensible if it is ever questioned (spec section 19).
   */
  doNotHire?: boolean;
  doNotHireReason?: string;
  doNotHireBy?: string;
  doNotHireAt?: Timestamp | null;

  applicationCount?: number;
  lastApplicationAt?: Timestamp | null;
  lastRejectionReason?: string;
}

/** Screening record (spec section 23). Embedded on the application; there is one per application. */
export interface ScreeningRecord {
  qualificationMatch?: boolean;
  experienceMatch?: boolean;
  skillMatch?: boolean;
  currentCtc?: number;
  expectedCtc?: number;
  noticePeriodDays?: number;
  locationWilling?: boolean;
  siteWilling?: boolean;
  reasonForChange?: string;
  communicationAssessment?: string;
  interviewAvailability?: string;
  recruiterRecommendation?: string;
  result: ScreeningResult;
  screenedBy: string;
  screenedByName: string;
  screenedAt?: Timestamp | null;
}

export interface CandidateApplication extends HrAuditFields {
  id: string;
  organizationId: string;
  applicationNumber: string;
  requirementId: string;
  requirementNumber: string;
  candidateId: string;
  /** Denormalised for the pipeline board, which reads thousands of cards at once. */
  candidateName: string;
  candidateMobile?: string;
  designation?: string;
  departmentId?: string;
  projectId?: string;

  stage: ApplicationStage;
  /** Every stage the application has reached, so the funnel can be measured (spec section 53). */
  stagesReached?: ApplicationStage[];
  stageChangedAt?: Timestamp | null;
  stageChangedBy?: string;
  previousStage?: ApplicationStage;

  source: RecruitmentSourceKind;
  sourceDetail?: string;
  agencyId?: string;
  recruiterId?: string;
  recruiterName?: string;

  screening?: ScreeningRecord | null;

  interviewCount?: number;
  latestInterviewScore?: number;
  panelRecommendation?: string;

  selectionProposalId?: string;
  offerId?: string;
  joiningRecordId?: string;

  exitReason?: string;
  exitRemarks?: string;
  exitedAt?: Timestamp | null;

  /** Internal-candidate route (spec section 45). */
  isInternal?: boolean;
  currentManagerApproved?: boolean;
  receivingHodApproved?: boolean;

  appliedAt?: Timestamp | null;
}

/* ------------------------------------------------------------------------------------------------
 * Interviews (spec sections 24–26)
 * ---------------------------------------------------------------------------------------------- */

export interface Interview extends HrAuditFields {
  id: string;
  organizationId: string;
  interviewNumber: string;
  requirementId: string;
  requirementNumber?: string;
  applicationId: string;
  candidateId: string;
  candidateName: string;
  designation?: string;

  round: InterviewRound;
  roundNumber: number;
  mode: InterviewMode;
  scheduledAt: string;
  durationMinutes?: number;
  location?: string;
  meetingLink?: string;

  interviewerIds: string[];
  interviewerNames?: string[];
  /** Panel size the feedback summary counts against, so "3 of 4 submitted" is answerable. */
  expectedFeedbackCount?: number;

  status: 'SCHEDULED' | 'RESCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'FEEDBACK_PENDING';
  rescheduledFromAt?: string;
  rescheduleReason?: string;
  cancellationReason?: string;

  averageScore?: number;
  panelRecommendation?: string;
  hasDissent?: boolean;
  completedAt?: Timestamp | null;
}

export interface InterviewFeedback extends HrAuditFields {
  id: string;
  organizationId: string;
  interviewId: string;
  applicationId: string;
  requirementId: string;
  candidateId: string;
  interviewerId: string;
  interviewerName: string;
  interviewerDesignation?: string;

  ratings: InterviewRatings;
  score?: number;
  recommendation: InterviewRecommendation;
  strengths?: string;
  concerns?: string;
  /** Mandatory when the recommendation is Not Recommended (spec section 25). */
  comments?: string;

  submitted: boolean;
  submittedAt?: Timestamp | null;
  /** Append-only revisions (control rule 63.6): a correction points at what it supersedes. */
  revisionOf?: string;
  revisionNumber?: number;
  revisionReason?: string;
  revisionAuthorisedBy?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Selection and compensation (spec sections 27, 28)
 * ---------------------------------------------------------------------------------------------- */

export interface SelectionProposal extends HrAuditFields {
  id: string;
  organizationId: string;
  proposalNumber: string;
  requirementId: string;
  requirementNumber?: string;
  applicationId: string;
  candidateId: string;
  candidateName: string;

  designation: string;
  grade: string;
  departmentId?: string;
  departmentName?: string;
  projectId?: string;
  projectName?: string;
  locationId?: string;
  location?: string;
  reportingToId?: string;
  reportingToName?: string;

  currentCtc?: number;
  expectedCtc?: number;
  proposedCtc: number;
  increasePercent?: number;
  budgetedCtc?: number;
  bandMin?: number;
  bandMax?: number;
  ctcVariancePercent?: number;
  ctcAboveBand?: boolean;

  proposedJoiningDate?: string;
  noticePeriodDays?: number;
  relocationRequired?: boolean;
  relocationSupport?: string;
  specialConditions?: string;

  interviewScore?: number;
  panelRecommendation?: string;
  hasDissent?: boolean;

  status: 'DRAFT' | 'PENDING_COMPENSATION_APPROVAL' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'OFFERED';
  compensationApprovalId?: string;
  compensationApprovalStatus?: CompensationApprovalStatus;
  /** What the approval chain actually cleared; supersedes the band for the offer (rule 63.5). */
  approvedCtc?: number;
  approvedAt?: Timestamp | null;
  rejectionReason?: string;
}

export interface CompensationApproval extends HrAuditFields {
  id: string;
  organizationId: string;
  requirementId: string;
  selectionProposalId: string;
  candidateId: string;
  candidateName: string;

  proposedCtc: number;
  budgetedCtc?: number;
  bandMax?: number;
  variancePercent?: number;
  justification?: string;

  stages: HrApprovalStage[];
  stageIndex: number;
  currentStageKey?: HrApprovalStageKey | null;
  currentStageLabel?: string;
  pendingApproverIds?: string[];
  status: CompensationApprovalStatus;
  approvedCtc?: number;
  decidedAt?: Timestamp | null;
  decisionRemarks?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Offer, pre-joining and joining (spec sections 29–36)
 * ---------------------------------------------------------------------------------------------- */

export interface HrOffer extends HrAuditFields {
  id: string;
  organizationId: string;
  offerNumber: string;
  requirementId: string;
  requirementNumber?: string;
  applicationId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail?: string;
  candidateMobile?: string;
  selectionProposalId?: string;

  designation: string;
  jobTitle?: string;
  grade: string;
  departmentId?: string;
  departmentName?: string;
  projectId?: string;
  projectName?: string;
  locationId?: string;
  location?: string;
  reportingToId?: string;
  reportingToName?: string;
  employmentType: EmploymentType;

  offeredCtc: number;
  ctcBreakup?: Array<{ component: string; annualAmount: number; monthlyAmount?: number }>;
  joiningBonus?: number;
  probationMonths?: number;
  employmentConditions?: string;
  specialConditions?: string;

  joiningDate: string;
  validUntil?: string;

  templateId?: string;
  letterHtml?: string;
  letterUrl?: string;

  status: OfferStatus;
  /** Approval chain for the letter itself, where the organisation requires one (§29). */
  approvalStages?: HrApprovalStage[];
  approvalStageIndex?: number;
  pendingApproverIds?: string[];
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp | null;

  sentAt?: Timestamp | null;
  sentToEmail?: string;
  /** Token behind the candidate's secure link (spec section 30). */
  portalToken?: string;
  portalTokenExpiresAt?: Timestamp | null;
  viewedAt?: Timestamp | null;

  respondedAt?: Timestamp | null;
  acceptanceDeclaration?: string;
  acceptanceIp?: string;
  signedOfferUrl?: string;
  rejectionReason?: string;
  withdrawalReason?: string;
  expiredAt?: Timestamp | null;
}

/** One line of the pre-joining checklist (spec sections 31, 32). */
export interface PreJoiningDocument extends HrAuditFields {
  id: string;
  organizationId: string;
  requirementId: string;
  applicationId: string;
  candidateId: string;
  offerId?: string;
  joiningRecordId?: string;

  documentType: string;
  mandatory: boolean;
  status: DocumentVerificationStatus;
  fileUrl?: string;
  fileName?: string;
  uploadedAt?: Timestamp | null;
  uploadedBy?: string;

  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: Timestamp | null;
  /** HR's note back to the candidate, e.g. "relieving letter unclear" (spec section 32). */
  verificationRemarks?: string;
  waiverReason?: string;
}

export interface JoiningRecord extends HrAuditFields {
  id: string;
  organizationId: string;
  joiningNumber: string;
  requirementId: string;
  requirementNumber?: string;
  applicationId: string;
  candidateId: string;
  candidateName: string;
  offerId?: string;

  designation: string;
  grade: string;
  departmentId?: string;
  departmentName?: string;
  projectId?: string;
  projectName?: string;
  locationId?: string;
  location?: string;
  reportingToId?: string;
  reportingToName?: string;
  employmentType?: EmploymentType;
  ctc?: number;

  plannedJoiningDate: string;
  revisedJoiningDate?: string;
  actualJoiningDate?: string;
  status: JoiningStatus;

  documentsReady?: boolean;
  documentCompletionPercent?: number;
  remindersSent?: number[];

  /** Set when the candidate becomes an employee (spec sections 35, 36). */
  employeeId?: string;
  employeeCode?: string;
  employeeCreatedAt?: Timestamp | null;
  /** The post-joining triggers of section 36, ticked off as each is completed. */
  onboarding?: {
    employeeMasterCreated?: boolean;
    officialEmailRequested?: boolean;
    attendanceEnrolled?: boolean;
    payrollActivated?: boolean;
    reportingHierarchySet?: boolean;
    appLoginCreated?: boolean;
    inductionScheduled?: boolean;
  };

  postponementReason?: string;
  notJoinedReason?: string;
  confirmedBy?: string;
  confirmedByName?: string;
  confirmedAt?: Timestamp | null;
}

/* ------------------------------------------------------------------------------------------------
 * Agencies, referrals, talent pool, costs (spec sections 46–48, 52)
 * ---------------------------------------------------------------------------------------------- */

export interface RecruitmentAgency extends HrAuditFields {
  id: string;
  organizationId: string;
  agencyNumber?: string;
  name: string;
  contactPerson?: string;
  mobile?: string;
  email?: string;
  address?: string;
  gstin?: string;

  agreementRef?: string;
  agreementUrl?: string;
  validFrom?: string;
  validUntil?: string;
  permittedRoles?: string[];
  /** Percentage of annual CTC, or a flat fee — whichever the agreement uses. */
  feeType?: 'Percentage of CTC' | 'Flat Fee';
  feePercent?: number;
  flatFee?: number;
  replacementGuaranteeDays?: number;
  paymentTermsDays?: number;

  status: 'Active' | 'Inactive' | 'Blacklisted';
  /** Denormalised performance, refreshed when an application from this agency moves stage. */
  submittedCount?: number;
  shortlistedCount?: number;
  interviewedCount?: number;
  offeredCount?: number;
  joinedCount?: number;
  invoiceDueAmount?: number;
  notes?: string;
}

export interface EmployeeReferral extends HrAuditFields {
  id: string;
  organizationId: string;
  referralNumber: string;
  requirementId?: string;
  requirementNumber?: string;
  referredByEmployeeId: string;
  referredByEmployeeName: string;
  referredByUserId?: string;

  candidateName: string;
  candidateMobile: string;
  candidateEmail?: string;
  relationship?: string;
  resumeUrl?: string;
  remarks?: string;

  candidateId?: string;
  applicationId?: string;
  status: 'SUBMITTED' | 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'JOINED' | 'REWARD_DUE' | 'REWARD_PAID';
  rewardAmount?: number;
  rewardPaidAt?: Timestamp | null;
}

export interface TalentPoolEntry extends HrAuditFields {
  id: string;
  organizationId: string;
  candidateId: string;
  candidateName: string;
  category: string;
  designation?: string;
  skills?: string[];
  totalExperienceYears?: number;
  locationId?: string;
  location?: string;
  /** Why they are in the pool rather than hired — a rejection reason worth remembering. */
  addedReason?: string;
  sourceRequirementId?: string;
  addedAt?: Timestamp | null;
  active?: boolean;
}

export interface RecruitmentCost extends HrAuditFields {
  id: string;
  organizationId: string;
  requirementId?: string;
  requirementNumber?: string;
  candidateId?: string;
  head: RecruitmentCostHead;
  amount: number;
  incurredOn: string;
  agencyId?: string;
  invoiceRef?: string;
  remarks?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Activity log and escalations (spec sections 41, 57)
 * ---------------------------------------------------------------------------------------------- */

export type HrEntityType =
  | 'requirement'
  | 'manpowerPlan'
  | 'candidate'
  | 'application'
  | 'interview'
  | 'feedback'
  | 'selection'
  | 'compensation'
  | 'offer'
  | 'preJoining'
  | 'joining'
  | 'agency'
  | 'referral'
  | 'jobDescription'
  | 'settings';

export interface HrActivity {
  id: string;
  organizationId: string;
  entityType: HrEntityType;
  entityId: string;
  /** Set on every child record too, so a requirement's activity tab is a single query. */
  requirementId?: string | null;
  action: string;
  summary: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  userId: string;
  userName: string;
  remarks?: string;
  createdAt?: Timestamp | null;
}

export interface HrEscalationLog {
  id: string;
  organizationId: string;
  requirementId: string;
  requirementNumber?: string;
  atPercent: number;
  label?: string;
  notified: string[];
  notifiedUserIds?: string[];
  consumedPercent: number;
  createdAt?: Timestamp | null;
}

/* ------------------------------------------------------------------------------------------------
 * Settings (spec section 58)
 * ---------------------------------------------------------------------------------------------- */

export interface HrSettings {
  organizationId: string;
  general: {
    /** Mandatory justification for headcount-adding requirement types (spec section 10). */
    requireJustificationForNewPositions: boolean;
    /** Block a requirement that pushes past sanctioned strength, rather than routing it up. */
    blockAboveSanctionedStrength: boolean;
    warnOnDuplicateRequirement: boolean;
    allowEmergencyRequirements: boolean;
    /** Requirement auto-expires this many days past its target closure date; 0 disables it. */
    autoExpireAfterDays: number;
    defaultTargetClosureDays: number;
    /**
     * Employee-code format for section 36's code generation — `E10023` by default, matching the
     * codes already in the employee master. HR can still type a code manually at confirmation; this
     * is what gets allocated when they don't.
     */
    employeeCodePrefix: string;
    employeeCodeStart: number;
    employeeCodeWidth: number;
  };
  approvals: {
    /**
     * The approval matrix of sections 12 and 13. Held in the settings document rather than its own
     * collection because it is read on every submission and edited rarely, and one document read
     * beats a query per requirement.
     */
    rules: HrApprovalRule[];
    /** Applied when no rule in the matrix matches — never leave a chain empty (§12). */
    fallbackStages: HrApprovalStage[];
    /** A stage's default turnaround in business hours, for deadline calculation. */
    defaultStageTatHours: number;
    allowDelegation: boolean;
    allowForward: boolean;
    /** Whether the requesting manager's own stage is skipped when they raised it themselves. */
    skipSelfApproval: boolean;
  };
  sla: {
    targets: SlaTargets;
    /** Section 42 — whether time on hold stops the SLA clock. */
    pauseOnHold: boolean;
    escalationLadder: EscalationLevel[];
    escalationEnabled: boolean;
  };
  compensation: {
    /** Percentage above the band a recruiter may offer without routing an approval (§9). */
    tolerancePercent: number;
    /** Stages the compensation approval walks when the tolerance is breached (§28). */
    approvalStages: HrApprovalStage[];
    requireApprovalForBelowBand: boolean;
  };
  offers: {
    defaultValidityDays: number;
    requireOfferApproval: boolean;
    approvalStages: HrApprovalStage[];
    /** Candidate-facing portal for acceptance (spec section 30). */
    enableCandidatePortal: boolean;
    portalTokenValidityDays: number;
    requireSignedCopy: boolean;
  };
  documents: {
    checklist: Array<{ documentType: string; mandatory: boolean; appliesTo?: EmploymentType[] }>;
    reminderDays: number[];
    /** Block confirming a joining while a mandatory document is outstanding. */
    blockJoiningOnPendingDocuments: boolean;
  };
  interviews: {
    rounds: InterviewRound[];
    /** Whether the author may correct their own submitted feedback (control rule 63.6). */
    allowAuthorFeedbackRevision: boolean;
    requireCommentsOnRejection: boolean;
    feedbackReminderHours: number;
  };
  notifications: {
    requirementSubmitted: boolean;
    approvalRequested: boolean;
    requirementApproved: boolean;
    requirementRejected: boolean;
    recruiterAssigned: boolean;
    slaApproaching: boolean;
    requirementOverdue: boolean;
    candidateAssigned: boolean;
    interviewScheduled: boolean;
    interviewFeedbackPending: boolean;
    candidateSelected: boolean;
    compensationApprovalRequired: boolean;
    offerApproved: boolean;
    offerAccepted: boolean;
    offerRejected: boolean;
    documentsPending: boolean;
    joiningApproaching: boolean;
    candidateJoined: boolean;
    candidateNoShow: boolean;
    requirementFulfilled: boolean;
    requirementCancelled: boolean;
  };
  referrals: {
    enabled: boolean;
    rewardAmount: number;
    /** Days the referred candidate must stay before the reward becomes payable. */
    rewardAfterDays: number;
  };
  /**
   * HR-owned masters only.
   *
   * Department, project/site and location are deliberately absent: they come from the app-wide
   * `departments` and `projects` collections that Settings → Manage Department and Manage Project
   * maintain, and every HR screen reads them from there through `useHrConfig`. A second copy kept
   * here would drift from the one Payroll, Attendance and the project modules use, and "which
   * department list is right" is not a question this module should be able to raise. Location follows
   * the selected project for the same reason (spec section 58 — "Project Integration", not "Project
   * Master").
   */
  masters: {
    grades: string[];
    /** Grades treated as senior management by the approval matrix (spec section 13). */
    seniorManagementGrades: string[];
    designations: string[];
    qualifications: string[];
    skills: string[];
    talentPoolCategories: string[];
    ctcBands: Array<{ grade: string; min: number; max: number }>;
  };
}

/** Section 48's pool categories, as shipped. */
export const DEFAULT_TALENT_POOL_CATEGORIES = [
  'Project Manager',
  'Electrical',
  'Civil',
  'Transmission',
  'Substation',
  'Safety',
  'Accounts',
  'HR',
  'Administration',
  'Testing & Commissioning',
];

/** Section 31's checklist, as shipped. Organisations edit it in settings. */
export const DEFAULT_DOCUMENT_CHECKLIST: HrSettings['documents']['checklist'] = [
  { documentType: 'Aadhaar', mandatory: true },
  { documentType: 'PAN', mandatory: true },
  { documentType: 'Photograph', mandatory: true },
  { documentType: 'Bank Details', mandatory: true },
  { documentType: 'Education Documents', mandatory: true },
  { documentType: 'Experience Certificate', mandatory: true },
  { documentType: 'Relieving Letter', mandatory: true },
  { documentType: 'Previous Salary Slips', mandatory: true },
  { documentType: 'UAN', mandatory: false },
  { documentType: 'PF Information', mandatory: false },
  { documentType: 'ESIC Information', mandatory: false },
  { documentType: 'Address Proof', mandatory: true },
  { documentType: 'Medical Fitness', mandatory: false },
  { documentType: 'Background Verification', mandatory: false },
  { documentType: 'Passport / Visa', mandatory: false },
  { documentType: 'Safety Certification', mandatory: false },
];

/**
 * The default approval matrix — section 13's table, expressed as rules.
 *
 * Stages resolve through `Reporting-based` and `Role-based` assignment wherever possible rather than
 * naming users, so a fresh organisation has a working chain before anyone opens the configuration
 * screen. Ordered from most to least specific for readability; `resolveRequirementApprovalChain`
 * scores rather than trusting this order, so inserting a rule cannot silently shadow another.
 */
export const DEFAULT_HR_APPROVAL_RULES: HrApprovalRule[] = [
  {
    id: 'default-senior-management',
    name: 'Senior management hiring',
    order: 10,
    when: { seniorManagement: true },
    stages: [
      { key: 'DEPARTMENT_HOD', assignmentType: 'Reporting-based', reportingSource: 'department-hod', tatHours: 24 },
      { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 },
      { key: 'DIRECTOR_HR', assignmentType: 'Role-based', roles: ['Director HR'], tatHours: 48 },
      { key: 'MD_ED', assignmentType: 'Role-based', roles: ['MD', 'ED', 'Managing Director'], tatHours: 72 },
    ],
  },
  {
    id: 'default-critical-fast-track',
    name: 'Critical hiring fast track',
    order: 20,
    fastTrack: true,
    when: { priorities: ['Critical'] },
    stages: [
      { key: 'DEPARTMENT_HOD', assignmentType: 'Reporting-based', reportingSource: 'department-hod', tatHours: 8 },
      { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 8 },
    ],
  },
  {
    id: 'default-replacement-with-increase',
    name: 'Replacement with salary increase',
    order: 30,
    when: { requirementTypes: ['Replacement', 'Internal Transfer Replacement'], salaryIncrease: true },
    stages: [
      { key: 'DEPARTMENT_HOD', assignmentType: 'Reporting-based', reportingSource: 'department-hod', tatHours: 24 },
      { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 },
      { key: 'FINANCE', assignmentType: 'Role-based', roles: ['Finance Head', 'Finance'], tatHours: 24 },
      { key: 'DIRECTOR', assignmentType: 'Role-based', roles: ['Director'], tatHours: 48 },
    ],
  },
  {
    id: 'default-replacement',
    name: 'Replacement within approved salary',
    order: 40,
    when: { requirementTypes: ['Replacement', 'Internal Transfer Replacement'] },
    stages: [
      { key: 'DEPARTMENT_HOD', assignmentType: 'Reporting-based', reportingSource: 'department-hod', tatHours: 24 },
      { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 },
    ],
  },
  {
    id: 'default-contract-manpower',
    name: 'Contract manpower',
    order: 50,
    when: { employmentTypes: ['Contract', 'Fixed Term', 'Casual', 'Deputation'] },
    stages: [
      { key: 'DEPARTMENT_HOD', assignmentType: 'Reporting-based', reportingSource: 'department-hod', tatHours: 24 },
      { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 },
      { key: 'PROJECT_COMMERCIAL', assignmentType: 'Role-based', roles: ['Commercial Head', 'Project Head'], tatHours: 24 },
    ],
  },
  {
    id: 'default-above-sanctioned',
    name: 'Above sanctioned manpower',
    order: 60,
    when: { aboveSanctionedStrength: true },
    stages: [
      { key: 'DEPARTMENT_HOD', assignmentType: 'Reporting-based', reportingSource: 'department-hod', tatHours: 24 },
      { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 },
      { key: 'FINANCE', assignmentType: 'Role-based', roles: ['Finance Head', 'Finance'], tatHours: 24 },
      { key: 'DIRECTOR', assignmentType: 'Role-based', roles: ['Director'], tatHours: 48 },
    ],
  },
  {
    id: 'default-project-within-plan',
    name: 'Project manpower within sanctioned plan',
    order: 70,
    when: { requirementTypes: ['Project Requirement'], withinManpowerPlan: true },
    stages: [
      { key: 'PROJECT_HEAD', assignmentType: 'Reporting-based', reportingSource: 'project-head', tatHours: 24 },
      { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 },
    ],
  },
  {
    id: 'default-new-position',
    name: 'New position',
    order: 80,
    when: { requirementTypes: ['New Position', 'Additional Manpower', 'Expansion', 'Management Requirement'] },
    stages: [
      { key: 'DEPARTMENT_HOD', assignmentType: 'Reporting-based', reportingSource: 'department-hod', tatHours: 24 },
      { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 },
      { key: 'FINANCE', assignmentType: 'Role-based', roles: ['Finance Head', 'Finance'], tatHours: 24 },
      { key: 'DIRECTOR', assignmentType: 'Role-based', roles: ['Director'], tatHours: 48 },
    ],
  },
];

/** The chain used when nothing in the matrix matches — HOD then HR, never nothing. */
export const DEFAULT_FALLBACK_APPROVAL_STAGES: HrApprovalStage[] = [
  { key: 'DEPARTMENT_HOD', assignmentType: 'Reporting-based', reportingSource: 'department-hod', tatHours: 24 },
  { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 },
];

/** Section 28's compensation route. */
export const DEFAULT_COMPENSATION_APPROVAL_STAGES: HrApprovalStage[] = [
  { key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 },
  { key: 'FINANCE', assignmentType: 'Role-based', roles: ['Finance Head', 'Finance'], tatHours: 24 },
  { key: 'DIRECTOR', assignmentType: 'Role-based', roles: ['Director'], tatHours: 48 },
];

export const DEFAULT_HR_SETTINGS: HrSettings = {
  organizationId: '',
  general: {
    requireJustificationForNewPositions: true,
    blockAboveSanctionedStrength: false,
    warnOnDuplicateRequirement: true,
    allowEmergencyRequirements: true,
    autoExpireAfterDays: 0,
    defaultTargetClosureDays: 30,
    employeeCodePrefix: 'E',
    employeeCodeStart: 10001,
    employeeCodeWidth: 5,
  },
  approvals: {
    rules: DEFAULT_HR_APPROVAL_RULES,
    fallbackStages: DEFAULT_FALLBACK_APPROVAL_STAGES,
    defaultStageTatHours: 24,
    allowDelegation: true,
    allowForward: true,
    skipSelfApproval: true,
  },
  sla: {
    targets: DEFAULT_SLA_TARGETS,
    pauseOnHold: true,
    escalationLadder: DEFAULT_ESCALATION_LADDER,
    escalationEnabled: true,
  },
  compensation: {
    tolerancePercent: 0,
    approvalStages: DEFAULT_COMPENSATION_APPROVAL_STAGES,
    requireApprovalForBelowBand: false,
  },
  offers: {
    defaultValidityDays: 7,
    requireOfferApproval: true,
    approvalStages: [{ key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'], tatHours: 24 }],
    enableCandidatePortal: true,
    portalTokenValidityDays: 15,
    requireSignedCopy: false,
  },
  documents: {
    checklist: DEFAULT_DOCUMENT_CHECKLIST,
    reminderDays: [7, 3, 1, 0],
    blockJoiningOnPendingDocuments: false,
  },
  interviews: {
    rounds: ['HR Round', 'Technical Round', 'Project Head Round', 'Final Round'],
    allowAuthorFeedbackRevision: false,
    requireCommentsOnRejection: true,
    feedbackReminderHours: 24,
  },
  notifications: {
    requirementSubmitted: true,
    approvalRequested: true,
    requirementApproved: true,
    requirementRejected: true,
    recruiterAssigned: true,
    slaApproaching: true,
    requirementOverdue: true,
    candidateAssigned: true,
    interviewScheduled: true,
    interviewFeedbackPending: true,
    candidateSelected: true,
    compensationApprovalRequired: true,
    offerApproved: true,
    offerAccepted: true,
    offerRejected: true,
    documentsPending: true,
    joiningApproaching: true,
    candidateJoined: true,
    candidateNoShow: true,
    requirementFulfilled: true,
    requirementCancelled: true,
  },
  referrals: {
    enabled: true,
    rewardAmount: 0,
    rewardAfterDays: 180,
  },
  masters: {
    grades: [],
    seniorManagementGrades: [],
    designations: [],
    qualifications: [],
    skills: [],
    talentPoolCategories: DEFAULT_TALENT_POOL_CATEGORIES,
    ctcBands: [],
  },
};

/**
 * Section 51's shipped templates. Both are EPC manpower structures rather than examples: creating a
 * project from one of these is how section 50's bulk requirement generation becomes a single click.
 */
export const DEFAULT_REQUIREMENT_TEMPLATES: Array<Omit<RequirementTemplate, 'id' | 'organizationId'>> = [
  {
    name: '132 KV Transmission Project',
    projectType: 'Transmission Line',
    description: 'Standard site team for a 132 KV transmission line package.',
    active: true,
    lines: [
      { designation: 'Project Manager', quantity: 1, priority: 'Critical', minExperienceYears: 10 },
      { designation: 'Site Engineer', quantity: 4, priority: 'High', minExperienceYears: 3 },
      { designation: 'Supervisor', quantity: 6, priority: 'Normal', minExperienceYears: 2 },
      { designation: 'Surveyor', quantity: 1, priority: 'Normal', minExperienceYears: 2 },
      { designation: 'Safety Officer', quantity: 2, priority: 'High', minExperienceYears: 3 },
      { designation: 'Store Keeper', quantity: 1, priority: 'Normal', minExperienceYears: 2 },
      { designation: 'Accountant', quantity: 1, priority: 'Normal', minExperienceYears: 2 },
      { designation: 'Technician', quantity: 4, priority: 'Normal', minExperienceYears: 1 },
      { designation: 'Helper', quantity: 6, priority: 'Low' },
    ],
  },
  {
    name: '220/33 KV GIS Substation',
    projectType: 'Substation',
    description: 'Standard site team for a 220/33 KV GIS substation package.',
    active: true,
    lines: [
      { designation: 'Project Manager', quantity: 1, priority: 'Critical', minExperienceYears: 12 },
      { designation: 'Substation Engineer', quantity: 3, priority: 'High', minExperienceYears: 5 },
      { designation: 'Testing & Commissioning Engineer', quantity: 2, priority: 'Critical', minExperienceYears: 5 },
      { designation: 'Civil Engineer', quantity: 2, priority: 'High', minExperienceYears: 3 },
      { designation: 'Supervisor', quantity: 4, priority: 'Normal', minExperienceYears: 2 },
      { designation: 'Safety Officer', quantity: 1, priority: 'High', minExperienceYears: 3 },
      { designation: 'Store Keeper', quantity: 1, priority: 'Normal' },
      { designation: 'Accountant', quantity: 1, priority: 'Normal' },
      { designation: 'Technician', quantity: 6, priority: 'Normal', minExperienceYears: 1 },
    ],
  },
];
