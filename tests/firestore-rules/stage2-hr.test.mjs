// Stage 2, HR & Recruitment: everything is readable by the module's users (`View Module` on
// 'HR & Recruitment'), as every screen reads its collections whole; writes follow the action each
// screen checks, or the assignment the service treats as the authority (pendingApproverIds,
// interviewerIds), read from userPermissions/{authUid}.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, setDoc,
  updateDoc, deleteDoc, where, writeBatch,
} from 'firebase/firestore';
import { as, rulesEnv, seed } from './helpers.mjs';

const HR = 'HR & Recruitment';
const ORG = 'org1';
const perms = (userDocId, p = {}) => ({ v: 1, p, active: true, userDocId, roleNames: [], projectIds: [], departmentIds: [] });
const mod = (pages = {}) => {
  const p = { [HR]: ['View Module'] };
  for (const [page, actions] of Object.entries(pages)) p[`${HR}.${page}`] = actions;
  return p;
};

const ALL_PAGES = {
  Dashboard: ['View'], 'Manpower Planning': ['Add', 'Edit', 'View'],
  Requirements: ['Add', 'Assign Recruiter', 'Cancel', 'Close', 'Edit', 'Hold', 'Resume', 'Submit', 'View'],
  Approvals: ['Approve', 'View'], Candidates: ['Add', 'Edit', 'Set Do Not Hire', 'View'],
  Pipeline: ['Add Candidate', 'Move Stage', 'Screen', 'View'], Interviews: ['Cancel', 'Reschedule', 'Schedule', 'View'],
  'My Interviews': ['Revise Feedback', 'View'], Selection: ['Add', 'View'],
  Offers: ['Add', 'Approve', 'Record Response', 'Send', 'View', 'Withdraw'],
  'Pre-Joining': ['Upload', 'Verify', 'View', 'Waive'],
  Joining: ['Confirm Joining', 'Manage Onboarding', 'Postpone', 'View'], 'Talent Pool': ['Add', 'View'],
  Agencies: ['Add', 'Edit', 'View', 'View Performance'], 'Recruitment Cost': ['Add', 'View'], Settings: ['Edit', 'View'],
};

// Every collection a screen subscribes to with useHrCollection (organizationId == org).
const MODULE_COLLECTIONS = [
  'hrRequirements', 'hrRequirementApprovals', 'hrManpowerPlans', 'candidates', 'candidateApplications',
  'interviews', 'interviewFeedback', 'selectionProposals', 'compensationApprovals', 'offers', 'preJoining',
  'joiningRecords', 'talentPools', 'recruitmentAgencies', 'hrReferrals', 'hrRecruitmentCosts', 'hrActivities',
];

let env;
before(async () => {
  env = await rulesEnv();
  const docs = {
    'userPermissions/admin': perms('uAdm', mod(ALL_PAGES)),
    // An interviewer or referrer: the module and nothing else (My Interviews, Referrals).
    'userPermissions/member': perms('uMem', mod()),
    // An email-matched legacy account: signs in under another uid, same users document.
    'userPermissions/legacyAuth': perms('uMem', mod()),
    'userPermissions/approver': perms('uApp', mod({ Approvals: ['Approve', 'View'] })),
    'userPermissions/recruiter': perms('uRec', mod({ Pipeline: ['Add Candidate', 'Move Stage', 'Screen', 'View'], Requirements: ['View'] })),
    'userPermissions/editor': perms('uEd', mod({ Requirements: ['Add', 'Cancel', 'Edit', 'Submit', 'View'] })),
    'userPermissions/offerMgr': perms('uOff', mod({ Offers: ['Add', 'Approve', 'Record Response', 'Send', 'View'] })),
    'userPermissions/joiner': perms('uJoin', mod({ Joining: ['Postpone', 'View'], 'Pre-Joining': ['Upload', 'View'] })),
    'userPermissions/prejoin': perms('uPre', mod({ 'Pre-Joining': ['Upload', 'Verify', 'View'] })),
    'userPermissions/perf': perms('uPerf', mod({ Agencies: ['View', 'View Performance'] })),
    // Page grants without the module itself: the shell shows "Access denied".
    'userPermissions/outsider': perms('uOut', { [`${HR}.Requirements`]: ['Add', 'Edit', 'View'] }),
    // Named as an approver and interviewer, but holding nothing in the module.
    'userPermissions/named': perms('uNamed', { 'E-Approval': ['View Module'] }),
    'userPermissions/stranger': perms('uX', { 'Windows Agent.Reports': ['View'] }),
    'userPermissions/gone': { ...perms('uGone'), active: false },
    // `nodoc` has no permissions document at all.

    [`hrSettings/${ORG}`]: { organizationId: ORG, general: {} },
    [`hrCounters/${ORG}__candidate__2026-27`]: { organizationId: ORG, nextSequence: 5 },
    'hrRequirements/R1': { organizationId: ORG, requirementNumber: 'HR-REQ-1', status: 'PENDING_HOD_APPROVAL', pendingApproverIds: ['uApp', 'uNamed'], designation: 'Engineer', approvalStageIndex: 0 },
    'hrRequirements/R2': { organizationId: ORG, requirementNumber: 'HR-REQ-2', status: 'SOURCING', pendingApproverIds: [], applicationCount: 1, designation: 'Engineer' },
    'hrRequirements/R3': { organizationId: ORG, requirementNumber: 'HR-REQ-3', status: 'DRAFT', pendingApproverIds: [], designation: 'Fitter' },
    'hrRequirements/R4': { organizationId: ORG, requirementNumber: 'HR-REQ-4', status: 'PENDING_HR_APPROVAL', pendingApproverIds: ['uApp'] },
    'hrRequirementApprovals/RA1': { organizationId: ORG, requirementId: 'R1', approverId: 'uOld', action: 'Approve' },
    'hrManpowerPlans/MP1': { organizationId: ORG, designation: 'Engineer', departmentId: 'D1', approvedStrength: 4, status: 'Approved' },
    'candidates/C1': { organizationId: ORG, candidateNumber: 'HR-CAN-1', name: 'Asha', applicationCount: 1, pan: 'ABCDE1234F' },
    'candidateApplications/A1': { organizationId: ORG, applicationNumber: 'HR-APP-1', requirementId: 'R2', candidateId: 'C1', stage: 'NEW', agencyId: 'AG1' },
    'candidateApplications/A2': { organizationId: ORG, applicationNumber: 'HR-APP-2', requirementId: 'R2', candidateId: 'C1', stage: 'SCREENING' },
    'interviews/I1': { organizationId: ORG, interviewNumber: 'HR-INT-1', applicationId: 'A1', requirementId: 'R2', candidateId: 'C1', interviewerIds: ['uMem', 'uNamed'], status: 'SCHEDULED' },
    'interviews/I2': { organizationId: ORG, interviewNumber: 'HR-INT-2', applicationId: 'A1', requirementId: 'R2', candidateId: 'C1', interviewerIds: ['uOther'], status: 'SCHEDULED' },
    'interviewFeedback/F1': { organizationId: ORG, interviewId: 'I1', interviewerId: 'uNamed', submitted: true },
    'selectionProposals/SP1': { organizationId: ORG, proposalNumber: 'HR-SEL-1', applicationId: 'A1', candidateId: 'C1', requirementId: 'R2', compensationApprovalId: 'CA1', status: 'PENDING_COMPENSATION_APPROVAL', compensationApprovalStatus: 'PENDING', proposedCtc: 1000 },
    'selectionProposals/SP2': { organizationId: ORG, proposalNumber: 'HR-SEL-2', applicationId: 'A2', candidateId: 'C1', requirementId: 'R2', compensationApprovalId: 'CA2', status: 'PENDING_COMPENSATION_APPROVAL', compensationApprovalStatus: 'PENDING' },
    'compensationApprovals/CA1': { organizationId: ORG, selectionProposalId: 'SP1', requirementId: 'R2', candidateId: 'C1', proposedCtc: 1000, status: 'PENDING', pendingApproverIds: ['uApp'], stageIndex: 0 },
    'compensationApprovals/CA2': { organizationId: ORG, selectionProposalId: 'SP2', requirementId: 'R2', candidateId: 'C1', proposedCtc: 1000, status: 'PENDING', pendingApproverIds: ['uApp', 'uNamed'], stageIndex: 0 },
    'offers/O1': { organizationId: ORG, offerNumber: 'HR-OFF-1', applicationId: 'A1', candidateId: 'C1', requirementId: 'R2', selectionProposalId: 'SP1', status: 'PENDING_APPROVAL', pendingApproverIds: ['uApp', 'uNamed'], offeredCtc: 900 },
    'offers/O2': { organizationId: ORG, offerNumber: 'HR-OFF-2', applicationId: 'A1', candidateId: 'C1', requirementId: 'R2', selectionProposalId: 'SP1', status: 'PENDING_APPROVAL', pendingApproverIds: [], offeredCtc: 900 },
    'offers/O3': { organizationId: ORG, offerNumber: 'HR-OFF-3', applicationId: 'A1', candidateId: 'C1', requirementId: 'R2', selectionProposalId: 'SP1', status: 'SENT', pendingApproverIds: [], portalToken: 'tok' },
    'joiningRecords/J1': { organizationId: ORG, joiningNumber: 'HR-JOI-1', offerId: 'O3', candidateId: 'C1', applicationId: 'A1', requirementId: 'R2', status: 'DOCUMENTS_PENDING', ctc: 900 },
    'preJoining/D1': { organizationId: ORG, joiningRecordId: 'J1', offerId: 'O3', candidateId: 'C1', documentType: 'PAN', status: 'PENDING', mandatory: true },
    'talentPools/T1': { organizationId: ORG, candidateId: 'C1', category: 'Engineer' },
    'recruitmentAgencies/AG1': { organizationId: ORG, name: 'Agency', submittedCount: 0 },
    'hrReferrals/RF1': { organizationId: ORG, referredByUserId: 'uMem', candidateName: 'Ravi', candidateMobile: '9' },
    'hrRecruitmentCosts/RC1': { organizationId: ORG, head: 'Advertisement', amount: 100 },
    'hrActivities/AC1': { organizationId: ORG, requirementId: 'R2', userId: 'uAdm', action: 'x', createdAt: new Date() },
    'hrEscalations/E1': { organizationId: ORG, requirementId: 'R2' },
  };
  await seed(env, docs);
});
after(async () => env?.cleanup());

// One client per user, so a transaction or batch and the references in it share an instance.
const clients = new Map();
const db = (uid) => {
  if (!clients.has(uid)) clients.set(uid, as(env, uid));
  return clients.get(uid);
};
const col = (uid, name) => collection(db(uid), name);
const ref = (uid, path) => doc(db(uid), path);
const byOrg = (uid, name) => query(col(uid, name), where('organizationId', '==', ORG));
const created = (userId) => ({ createdBy: userId, createdByName: 'X', createdAt: serverTimestamp(), updatedBy: userId, updatedByName: 'X', updatedAt: serverTimestamp() });
const updated = (userId) => ({ updatedBy: userId, updatedByName: 'X', updatedAt: serverTimestamp() });

test('every screen subscribes to its collections whole for the organisation: module users only', async () => {
  for (const name of MODULE_COLLECTIONS) {
    for (const uid of ['admin', 'member', 'legacyAuth']) await assertSucceeds(getDocs(byOrg(uid, name)));
    for (const uid of ['outsider', 'named', 'stranger', 'gone', 'nodoc', null]) await assertFails(getDocs(byOrg(uid, name)));
  }
  await assertSucceeds(getDoc(ref('member', `hrSettings/${ORG}`)));
  await assertSucceeds(getDoc(ref('member', 'hrSettings/neverSaved')));
  await assertFails(getDoc(ref('outsider', `hrSettings/${ORG}`)));
  await assertSucceeds(getDoc(ref('member', 'candidates/C1')));
  await assertFails(getDoc(ref('stranger', 'candidates/C1')));
  await assertFails(getDoc(ref('named', 'joiningRecords/J1')));
});

test('the service reads without an organisation filter', async () => {
  const m = 'member';
  await assertSucceeds(getDocs(query(col(m, 'candidateApplications'), where('requirementId', '==', 'R2'))));
  await assertSucceeds(getDocs(query(col(m, 'candidateApplications'), where('candidateId', '==', 'C1'))));
  await assertSucceeds(getDocs(query(col(m, 'candidateApplications'), where('requirementId', '==', 'R2'), where('candidateId', '==', 'C1'))));
  await assertSucceeds(getDocs(query(col('perf', 'candidateApplications'), where('agencyId', '==', 'AG1'))));
  await assertSucceeds(getDocs(query(col(m, 'offers'), where('requirementId', '==', 'R2'))));
  await assertSucceeds(getDocs(query(col(m, 'offers'), where('applicationId', '==', 'A1'))));
  await assertSucceeds(getDocs(query(col(m, 'joiningRecords'), where('requirementId', '==', 'R2'))));
  await assertSucceeds(getDocs(query(col(m, 'preJoining'), where('joiningRecordId', '==', 'J1'))));
  await assertSucceeds(getDocs(query(col(m, 'interviewFeedback'), where('interviewId', '==', 'I1'), where('interviewerId', '==', 'uMem'))));
  await assertSucceeds(getDocs(query(col(m, 'interviewFeedback'), where('interviewId', '==', 'I1'))));
  await assertSucceeds(getDocs(query(col(m, 'hrActivities'), where('requirementId', '==', 'R2'), orderBy('createdAt', 'desc'))));
  await assertSucceeds(getDocs(query(col(m, 'hrManpowerPlans'), where('organizationId', '==', ORG), where('designation', '==', 'Engineer'), where('departmentId', '==', 'D1'))));
  await assertFails(getDocs(query(col('stranger', 'offers'), where('requirementId', '==', 'R2'))));
  // Configuration nobody in the browser writes: readable in the module.
  for (const name of ['hrEscalations', 'hrRequirementTemplates', 'jobDescriptions', 'recruitmentSources']) {
    await assertSucceeds(getDocs(col(m, name)));
    await assertFails(getDocs(col('stranger', name)));
    await assertFails(addDoc(col('admin', name), { organizationId: ORG }));
  }
});

test('the work dashboard: whoever a queue names may list it, without the module and without an org filter', async () => {
  const mine = (uid, name, field, me) => getDocs(query(col(uid, name), where(field, 'array-contains', me), limit(100)));
  for (const name of ['hrRequirements', 'compensationApprovals', 'offers']) {
    await assertSucceeds(mine('named', name, 'pendingApproverIds', 'uNamed'));
    await assertSucceeds(mine('approver', name, 'pendingApproverIds', 'uApp'));
    await assertSucceeds(mine('member', name, 'pendingApproverIds', 'uMem'));
    await assertFails(mine('named', name, 'pendingApproverIds', 'uApp'));
    await assertFails(mine('stranger', name, 'pendingApproverIds', 'uApp'));
    await assertFails(mine('nodoc', name, 'pendingApproverIds', 'uApp'));
    await assertFails(mine(null, name, 'pendingApproverIds', 'uApp'));
  }
  await assertSucceeds(mine('named', 'interviews', 'interviewerIds', 'uNamed'));
  await assertSucceeds(mine('member', 'interviews', 'interviewerIds', 'uMem'));
  await assertFails(mine('named', 'interviews', 'interviewerIds', 'uOther'));
  await assertFails(mine('stranger', 'interviews', 'interviewerIds', 'uMem'));
  await assertSucceeds(getDoc(ref('named', 'hrRequirements/R1')));
  await assertFails(getDoc(ref('named', 'hrRequirements/R2')));
});

test('numbers: a forward-only counter, in a transaction, for anyone in the module', async () => {
  const key = `hrCounters/${ORG}__candidate__2026-27`;
  const bump = (uid, path, next) => runTransaction(db(uid), async (tx) => {
    const snap = await tx.get(doc(db(uid), path));
    tx.set(doc(db(uid), path), { organizationId: ORG, nextSequence: next ?? Number(snap.data()?.nextSequence || 1) + 1, updatedAt: serverTimestamp() }, { merge: true });
  });
  await assertSucceeds(bump('member', key));
  await assertSucceeds(bump('member', `hrCounters/${ORG}__referral__2026-27`));
  await assertSucceeds(bump('admin', `hrCounters/${ORG}__employeeCode`, 10002));
  await assertFails(bump('member', key, 2));
  await assertFails(bump('member', `hrCounters/${ORG}__offer__2026-27`, 1));
  await assertFails(bump('outsider', key));
  await assertFails(bump('stranger', `hrCounters/${ORG}__x__2026-27`));
});

test('requirements: created as a draft by Add; edited by the register; decided by the approvers it names', async () => {
  const draft = (by) => ({ organizationId: ORG, requirementNumber: 'HR-REQ-9', status: 'DRAFT', designation: 'Clerk', ...created(by) });
  await assertSucceeds(runTransaction(db('editor'), async (tx) => {
    const counter = doc(db('editor'), `hrCounters/${ORG}__requirement__2026-27`);
    await tx.get(counter);
    tx.set(counter, { organizationId: ORG, nextSequence: 2 }, { merge: true });
    tx.set(doc(col('editor', 'hrRequirements')), draft('uEd'));
  }));
  await assertFails(setDoc(ref('editor', 'hrRequirements/N1'), { ...draft('uEd'), status: 'APPROVED' }));
  await assertFails(setDoc(ref('editor', 'hrRequirements/N2'), draft('uAdm')));
  await assertFails(setDoc(ref('member', 'hrRequirements/N3'), draft('uMem')));
  await assertFails(setDoc(ref('outsider', 'hrRequirements/N4'), draft('uOut')));

  // The register: notes, submit, assign — but not a stage the approvers own.
  await assertSucceeds(updateDoc(ref('editor', 'hrRequirements/R2'), { notes: 'x', ...updated('uEd') }));
  await assertSucceeds(updateDoc(ref('editor', 'hrRequirements/R3'), { status: 'PENDING_HOD_APPROVAL', pendingApproverIds: ['uApp'], approvalStages: [{ key: 'HOD' }], approvalStageIndex: 0, submittedAt: serverTimestamp(), ...updated('uEd') }));
  await assertSucceeds(updateDoc(ref('editor', 'hrRequirements/R1'), { notes: 'while pending', ...updated('uEd') }));
  await assertFails(updateDoc(ref('editor', 'hrRequirements/R1'), { status: 'RECRUITER_ASSIGNMENT_PENDING', pendingApproverIds: [], ...updated('uEd') }));
  await assertFails(updateDoc(ref('editor', 'hrRequirements/R1'), { pendingApproverIds: ['uEd'], ...updated('uEd') }));
  await assertFails(updateDoc(ref('editor', 'hrRequirements/R2'), { notes: 'y', ...updated('uAdm') }));
  await assertFails(updateDoc(ref('editor', 'hrRequirements/R2'), { requirementNumber: 'HR-REQ-X', ...updated('uEd') }));
  await assertFails(updateDoc(ref('outsider', 'hrRequirements/R2'), { notes: 'z', ...updated('uOut') }));

  // The approver: a decision, nothing else.
  await assertFails(updateDoc(ref('approver', 'hrRequirements/R1'), { designation: 'Manager', ...updated('uApp') }));
  await assertFails(updateDoc(ref('member', 'hrRequirements/R1'), { status: 'REJECTED', pendingApproverIds: [], ...updated('uMem') }));
  await assertFails(updateDoc(ref('approver', 'hrRequirements/R1'), { status: 'OPEN', pendingApproverIds: [], ...updated('uApp') }));
  await assertSucceeds(addDoc(col('approver', 'hrRequirementApprovals'), { organizationId: ORG, requirementId: 'R1', approverId: 'uApp', action: 'Approve', ...created('uApp') }));
  await assertFails(addDoc(col('approver', 'hrRequirementApprovals'), { organizationId: ORG, requirementId: 'R2', approverId: 'uApp', action: 'Approve' }));
  await assertFails(addDoc(col('approver', 'hrRequirementApprovals'), { organizationId: ORG, requirementId: 'nope', approverId: 'uApp', action: 'Approve' }));
  await assertFails(addDoc(col('member', 'hrRequirementApprovals'), { organizationId: ORG, requirementId: 'R1', approverId: 'uApp', action: 'Approve' }));
  await assertFails(updateDoc(ref('admin', 'hrRequirementApprovals/RA1'), { action: 'Reject' }));
  await assertSucceeds(updateDoc(ref('approver', 'hrRequirements/R1'), {
    status: 'PENDING_HR_APPROVAL', approvalStageIndex: 1, currentApprovalStage: 'HR', currentApprovalStageLabel: 'HR',
    pendingApproverIds: ['uOther'], ...updated('uApp'),
  }));
  await assertSucceeds(updateDoc(ref('approver', 'hrRequirements/R4'), {
    status: 'RECRUITER_ASSIGNMENT_PENDING', approvalStageIndex: 1, currentApprovalStage: null, currentApprovalStageLabel: '',
    pendingApproverIds: [], approvedAt: serverTimestamp(), slaStartedAt: serverTimestamp(), slaTargetDays: 30,
    slaState: 'On track', slaConsumedPercent: 0, targetClosureDate: '2026-12-01', ...updated('uApp'),
  }));
  // No longer named, no longer decides.
  await assertFails(updateDoc(ref('approver', 'hrRequirements/R1'), { status: 'REJECTED', pendingApproverIds: [], ...updated('uApp') }));
  await assertFails(deleteDoc(ref('admin', 'hrRequirements/R2')));
});

test('requirement counters: any step in the module refreshes them, and the status only while recruiting', async () => {
  await assertSucceeds(updateDoc(ref('member', 'hrRequirements/R2'), { applicationCount: 2, screeningCount: 1, status: 'SCREENING' }));
  await assertSucceeds(updateDoc(ref('member', 'hrRequirements/R2'), { joinedCount: 3, status: 'FILLED' }));
  await assertFails(updateDoc(ref('member', 'hrRequirements/R3'), { applicationCount: 0, status: 'OPEN' }));
  await assertSucceeds(updateDoc(ref('member', 'hrRequirements/R3'), { applicationCount: 0 }));
  await assertFails(updateDoc(ref('member', 'hrRequirements/R3'), { applicationCount: 0, designation: 'Boss' }));
  await assertFails(updateDoc(ref('stranger', 'hrRequirements/R3'), { applicationCount: 0 }));
});

test('candidates: Add creates, Edit or Set Do Not Hire edits, the pipeline keeps the counters', async () => {
  await assertSucceeds(addDoc(col('admin', 'candidates'), { organizationId: ORG, candidateNumber: 'HR-CAN-2', name: 'B', ...created('uAdm') }));
  await assertFails(addDoc(col('recruiter', 'candidates'), { organizationId: ORG, name: 'B', ...created('uRec') }));
  await assertFails(addDoc(col('admin', 'candidates'), { organizationId: ORG, name: 'B', ...created('uMem') }));
  await assertSucceeds(updateDoc(ref('recruiter', 'candidates/C1'), { applicationCount: 2, lastApplicationAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('recruiter', 'candidates/C1'), { inTalentPool: true, talentPoolCategories: ['Engineer'], ...updated('uRec') }));
  await assertFails(updateDoc(ref('recruiter', 'candidates/C1'), { doNotHire: true, doNotHireReason: 'x', ...updated('uRec') }));
  await assertFails(updateDoc(ref('member', 'candidates/C1'), { applicationCount: 9 }));
  await assertSucceeds(updateDoc(ref('admin', 'candidates/C1'), { doNotHire: false, doNotHireReason: 'cleared', doNotHireBy: '', doNotHireAt: null, ...updated('uAdm') }));
  await assertFails(updateDoc(ref('admin', 'candidates/C1'), { candidateNumber: 'X', ...updated('uAdm') }));
});

test('applications: the pipeline adds and moves; an interviewer carries the panel score; cancelling releases them', async () => {
  const app = (by) => ({ organizationId: ORG, applicationNumber: 'HR-APP-9', requirementId: 'R2', candidateId: 'C1', stage: 'NEW', ...created(by) });
  await assertSucceeds(addDoc(col('recruiter', 'candidateApplications'), app('uRec')));
  await assertFails(addDoc(col('recruiter', 'candidateApplications'), { ...app('uRec'), stage: 'SELECTED' }));
  await assertFails(addDoc(col('member', 'candidateApplications'), app('uMem')));
  await assertSucceeds(updateDoc(ref('recruiter', 'candidateApplications/A1'), { stage: 'SCREENING', previousStage: 'NEW', stageChangedBy: 'uRec', ...updated('uRec') }));
  await assertSucceeds(updateDoc(ref('member', 'candidateApplications/A1'), { latestInterviewScore: 4, panelRecommendation: 'Recommended' }));
  await assertFails(updateDoc(ref('member', 'candidateApplications/A1'), { stage: 'SELECTED' }));
  await assertFails(updateDoc(ref('recruiter', 'candidateApplications/A1'), { requirementId: 'R1', ...updated('uRec') }));
  const batch = writeBatch(db('editor'));
  for (const id of ['A1', 'A2']) batch.update(ref('editor', `candidateApplications/${id}`), { stage: 'TALENT_POOL', exitReason: 'Requirement cancelled', ...updated('uEd') });
  await assertSucceeds(batch.commit());
  await assertSucceeds(addDoc(col('recruiter', 'talentPools'), { organizationId: ORG, candidateId: 'C1', category: 'Engineer', ...created('uRec') }));
  await assertFails(addDoc(col('member', 'talentPools'), { organizationId: ORG, candidateId: 'C1', category: 'Engineer', ...created('uMem') }));
});

test('interviews: scheduled by Schedule; the panel submits feedback and recomputes its summary', async () => {
  const interview = { organizationId: ORG, interviewNumber: 'HR-INT-9', applicationId: 'A1', requirementId: 'R2', candidateId: 'C1', interviewerIds: ['uMem'], status: 'SCHEDULED', ...created('uAdm') };
  await assertSucceeds(addDoc(col('admin', 'interviews'), interview));
  await assertFails(addDoc(col('recruiter', 'interviews'), { ...interview, ...created('uRec') }));
  await assertSucceeds(updateDoc(ref('admin', 'interviews/I2'), { scheduledAt: '2026-11-01T10:00', status: 'RESCHEDULED', ...updated('uAdm') }));
  await assertFails(updateDoc(ref('member', 'interviews/I1'), { scheduledAt: '2026-11-01T10:00', ...updated('uMem') }));

  const feedback = (interviewId, by) => ({ organizationId: ORG, interviewId, interviewerId: by, submitted: true, score: 4, revisionOf: null, ...created(by) });
  await assertSucceeds(addDoc(col('member', 'interviewFeedback'), feedback('I1', 'uMem')));
  await assertSucceeds(addDoc(col('legacyAuth', 'interviewFeedback'), feedback('I1', 'uMem')));
  await assertFails(addDoc(col('member', 'interviewFeedback'), feedback('I2', 'uMem')));
  await assertFails(addDoc(col('member', 'interviewFeedback'), feedback('missing', 'uMem')));
  await assertFails(addDoc(col('member', 'interviewFeedback'), feedback('I1', 'uNamed')));
  await assertFails(addDoc(col('named', 'interviewFeedback'), feedback('I1', 'uNamed')));
  // Revise Feedback authorises a revision by someone off the panel.
  await assertSucceeds(addDoc(col('admin', 'interviewFeedback'), { ...feedback('I2', 'uAdm'), revisionOf: 'F1' }));
  await assertFails(updateDoc(ref('admin', 'interviewFeedback/F1'), { score: 1 }));

  await assertSucceeds(updateDoc(ref('member', 'interviews/I1'), { averageScore: 4, panelRecommendation: 'Recommended', hasDissent: false, status: 'FEEDBACK_PENDING', completedAt: null }));
  await assertFails(updateDoc(ref('member', 'interviews/I1'), { status: 'CANCELLED' }));
  await assertFails(updateDoc(ref('member', 'interviews/I2'), { averageScore: 1, status: 'COMPLETED' }));
});

test('compensation: only the named approver decides, never above the proposal, and the proposal follows', async () => {
  await assertFails(updateDoc(ref('admin', 'compensationApprovals/CA1'), { status: 'APPROVED', approvedCtc: 900, pendingApproverIds: [], ...updated('uAdm') }));
  await assertFails(updateDoc(ref('approver', 'compensationApprovals/CA1'), { status: 'APPROVED', approvedCtc: 1200, pendingApproverIds: [], ...updated('uApp') }));
  await assertFails(updateDoc(ref('approver', 'compensationApprovals/CA1'), { status: 'APPROVED', proposedCtc: 2000, approvedCtc: 1500, ...updated('uApp') }));
  // Before the decision, the proposal cannot claim one.
  await assertFails(updateDoc(ref('approver', 'selectionProposals/SP1'), { compensationApprovalStatus: 'APPROVED', status: 'APPROVED', approvedCtc: 900, ...updated('uApp') }));
  await assertSucceeds(updateDoc(ref('approver', 'compensationApprovals/CA1'), { status: 'APPROVED', approvedCtc: 900, pendingApproverIds: [], decidedAt: serverTimestamp(), ...updated('uApp') }));
  await assertFails(updateDoc(ref('approver', 'selectionProposals/SP1'), { compensationApprovalStatus: 'APPROVED', status: 'APPROVED', approvedCtc: 1000, ...updated('uApp') }));
  await assertFails(updateDoc(ref('member', 'selectionProposals/SP1'), { compensationApprovalStatus: 'APPROVED', status: 'APPROVED', approvedCtc: 900, ...updated('uMem') }));
  await assertSucceeds(updateDoc(ref('approver', 'selectionProposals/SP1'), { compensationApprovalStatus: 'APPROVED', status: 'APPROVED', approvedCtc: 900, approvedAt: serverTimestamp(), ...updated('uApp') }));
  // Decided: closed to further decisions.
  await assertFails(updateDoc(ref('approver', 'compensationApprovals/CA1'), { status: 'REJECTED', ...updated('uApp') }));
  // A rejection, by the second-stage approver who holds nothing in the module, is refused (no module).
  await assertFails(updateDoc(ref('named', 'compensationApprovals/CA2'), { status: 'REJECTED', pendingApproverIds: [], ...updated('uNamed') }));
  await assertSucceeds(updateDoc(ref('approver', 'compensationApprovals/CA2'), { status: 'REJECTED', pendingApproverIds: [], decisionRemarks: 'no', ...updated('uApp') }));
  await assertSucceeds(updateDoc(ref('approver', 'selectionProposals/SP2'), { compensationApprovalStatus: 'REJECTED', status: 'REJECTED', rejectionReason: 'no', ...updated('uApp') }));

  // Raised with a proposal by Selection Add.
  await assertSucceeds(addDoc(col('admin', 'selectionProposals'), { organizationId: ORG, applicationId: 'A1', status: 'APPROVED', ...created('uAdm') }));
  await assertSucceeds(addDoc(col('admin', 'compensationApprovals'), { organizationId: ORG, selectionProposalId: 'SP1', status: 'PENDING', pendingApproverIds: ['uApp'], proposedCtc: 1, ...created('uAdm') }));
  await assertFails(addDoc(col('admin', 'compensationApprovals'), { organizationId: ORG, status: 'APPROVED', ...created('uAdm') }));
  await assertFails(addDoc(col('recruiter', 'selectionProposals'), { organizationId: ORG, status: 'APPROVED', ...created('uRec') }));
});

test('offers: Add creates without a live link; approval belongs to the approvers named, or Approve when none are', async () => {
  const offer = (by, extra = {}) => ({ organizationId: ORG, offerNumber: 'HR-OFF-9', applicationId: 'A1', status: 'PENDING_APPROVAL', pendingApproverIds: ['uApp'], ...created(by), ...extra });
  await assertSucceeds(runTransaction(db('offerMgr'), async (tx) => {
    const counter = doc(db('offerMgr'), `hrCounters/${ORG}__offer__2026-27`);
    await tx.get(counter);
    tx.set(counter, { organizationId: ORG, nextSequence: 2 }, { merge: true });
    tx.set(doc(col('offerMgr', 'offers')), offer('uOff'));
  }));
  await assertFails(addDoc(col('offerMgr', 'offers'), offer('uOff', { portalToken: 'abc' })));
  await assertFails(addDoc(col('offerMgr', 'offers'), offer('uOff', { status: 'SENT' })));
  await assertFails(addDoc(col('member', 'offers'), offer('uMem')));
  await assertSucceeds(updateDoc(ref('offerMgr', 'selectionProposals/SP1'), { status: 'OFFERED', ...updated('uOff') }));
  await assertFails(updateDoc(ref('offerMgr', 'selectionProposals/SP1'), { status: 'OFFERED', approvedCtc: 5000, ...updated('uOff') }));
  await assertSucceeds(updateDoc(ref('offerMgr', 'candidateApplications/A1'), { offerId: 'O1', ...updated('uOff') }));

  const approve = (by) => ({ status: 'APPROVED', approvedBy: by, approvedByName: 'X', approvedAt: serverTimestamp(), pendingApproverIds: [], ...updated(by) });
  await assertFails(updateDoc(ref('offerMgr', 'offers/O1'), approve('uOff')));
  await assertFails(updateDoc(ref('offerMgr', 'offers/O1'), { status: 'SENT', portalToken: 't', ...updated('uOff') }));
  await assertFails(updateDoc(ref('member', 'offers/O2'), approve('uMem')));
  await assertSucceeds(updateDoc(ref('offerMgr', 'offers/O2'), approve('uOff')));
  await assertFails(updateDoc(ref('approver', 'offers/O1'), { ...approve('uApp'), offeredCtc: 99999 }));
  await assertSucceeds(updateDoc(ref('approver', 'offers/O1'), approve('uApp')));
  await assertSucceeds(updateDoc(ref('offerMgr', 'offers/O2'), { status: 'SENT', sentAt: serverTimestamp(), portalToken: 'tok2', ...updated('uOff') }));
  await assertFails(updateDoc(ref('offerMgr', 'offers/O2'), { candidateId: 'C9', ...updated('uOff') }));
});

test('acceptance raises the joining record and checklist; each document status has its own action', async () => {
  await assertSucceeds(runTransaction(db('offerMgr'), async (tx) => {
    const counter = doc(db('offerMgr'), `hrCounters/${ORG}__joining__2026-27`);
    await tx.get(counter);
    tx.set(counter, { organizationId: ORG, nextSequence: 2 }, { merge: true });
    tx.set(doc(db('offerMgr'), 'joiningRecords/J9'), { organizationId: ORG, joiningNumber: 'HR-JOI-9', offerId: 'O3', status: 'DOCUMENTS_PENDING', ...created('uOff') });
  }));
  await assertFails(setDoc(ref('offerMgr', 'joiningRecords/J8'), { organizationId: ORG, status: 'JOINED', ...created('uOff') }));
  await assertFails(setDoc(ref('joiner', 'joiningRecords/J7'), { organizationId: ORG, status: 'DOCUMENTS_PENDING', ...created('uJoin') }));
  const batch = writeBatch(db('offerMgr'));
  for (const type of ['PAN', 'Aadhaar']) batch.set(doc(col('offerMgr', 'preJoining')), { organizationId: ORG, joiningRecordId: 'J9', documentType: type, mandatory: true, status: 'PENDING', ...created('uOff') });
  await assertSucceeds(batch.commit());
  await assertFails(addDoc(col('joiner', 'preJoining'), { organizationId: ORG, joiningRecordId: 'J9', status: 'PENDING', ...created('uJoin') }));
  await assertSucceeds(updateDoc(ref('offerMgr', 'offers/O3'), { status: 'ACCEPTED', respondedAt: serverTimestamp(), portalToken: '', ...updated('uOff') }));

  await assertSucceeds(updateDoc(ref('joiner', 'preJoining/D1'), { status: 'UPLOADED', fileUrl: 'https://x', uploadedBy: 'uJoin', ...updated('uJoin') }));
  await assertFails(updateDoc(ref('joiner', 'preJoining/D1'), { status: 'VERIFIED', ...updated('uJoin') }));
  await assertSucceeds(updateDoc(ref('admin', 'preJoining/D1'), { status: 'VERIFIED', verifiedBy: 'uAdm', ...updated('uAdm') }));
  await assertSucceeds(updateDoc(ref('admin', 'preJoining/D1'), { status: 'WAIVED', waiverReason: 'x', ...updated('uAdm') }));
  await assertFails(updateDoc(ref('member', 'preJoining/D1'), { status: 'UPLOADED', ...updated('uMem') }));
  // The joining record's document state follows.
  await assertSucceeds(updateDoc(ref('prejoin', 'joiningRecords/J1'), { documentsReady: true, documentCompletionPercent: 100, status: 'CONFIRMATION_PENDING' }));
  await assertFails(updateDoc(ref('prejoin', 'joiningRecords/J1'), { documentsReady: true, ctc: 1 }));
  await assertFails(updateDoc(ref('prejoin', 'joiningRecords/J1'), { status: 'JOINED' }));
  await assertFails(updateDoc(ref('member', 'joiningRecords/J1'), { documentsReady: false }));
  await assertSucceeds(updateDoc(ref('joiner', 'joiningRecords/J1'), { status: 'POSTPONED', revisedJoiningDate: '2026-12-01', postponementReason: 'x', remindersSent: [], ...updated('uJoin') }));
  await assertFails(updateDoc(ref('joiner', 'joiningRecords/J1'), { status: 'JOINED', ...updated('uJoin') }));
  // markNotJoined, from the Postpone menu: the offer is withdrawn and the application leaves.
  await assertSucceeds(updateDoc(ref('joiner', 'offers/O3'), { status: 'WITHDRAWN', withdrawalReason: 'no show', ...updated('uJoin') }));
  await assertFails(updateDoc(ref('joiner', 'offers/O3'), { status: 'SENT', ...updated('uJoin') }));
  await assertSucceeds(updateDoc(ref('joiner', 'candidateApplications/A2'), { stage: 'NO_SHOW', exitReason: 'Did not join', ...updated('uJoin') }));
});

test('confirming a joining: one transaction over the requirement, the employee code, the employee and the record', async () => {
  await seed(env, { 'joiningRecords/J5': { organizationId: ORG, joiningNumber: 'HR-JOI-5', requirementId: 'R5', candidateId: 'C1', applicationId: 'A1', status: 'CONFIRMED' }, 'hrRequirements/R5': { organizationId: ORG, status: 'OFFER_IN_PROGRESS', joinedCount: 0 } });
  const confirm = (uid, by) => runTransaction(db(uid), async (tx) => {
    const requirement = await tx.get(doc(db(uid), 'hrRequirements/R5'));
    const counter = doc(db(uid), `hrCounters/${ORG}__employeeCode`);
    const code = Number((await tx.get(counter)).data()?.nextSequence || 1);
    tx.set(counter, { organizationId: ORG, kind: 'employeeCode', nextSequence: code + 1 }, { merge: true });
    tx.set(doc(collection(db(uid), 'employees')), { employeeId: `E${code}`, organizationId: ORG, ...created(by) });
    tx.update(doc(db(uid), 'joiningRecords/J5'), { status: 'JOINED', employeeCode: `E${code}`, confirmedBy: by, ...updated(by) });
    tx.update(doc(db(uid), 'hrRequirements/R5'), { joinedCount: Number(requirement.data().joinedCount || 0) + 1 });
  });
  await assertFails(confirm('joiner', 'uJoin'));
  await assertSucceeds(confirm('admin', 'uAdm'));
});

test('referrals, agencies, costs, plans, settings and the activity trail', async () => {
  await assertSucceeds(addDoc(col('member', 'hrReferrals'), { organizationId: ORG, referredByUserId: 'uMem', status: 'SUBMITTED', candidateName: 'R', ...created('uMem') }));
  await assertFails(addDoc(col('member', 'hrReferrals'), { organizationId: ORG, referredByUserId: 'uAdm', status: 'SUBMITTED', ...created('uMem') }));
  await assertFails(addDoc(col('member', 'hrReferrals'), { organizationId: ORG, referredByUserId: 'uMem', status: 'APPROVED', ...created('uMem') }));
  await assertFails(addDoc(col('stranger', 'hrReferrals'), { organizationId: ORG, referredByUserId: 'uX', status: 'SUBMITTED', ...created('uX') }));
  await assertFails(updateDoc(ref('admin', 'hrReferrals/RF1'), { status: 'REWARDED' }));

  await assertSucceeds(addDoc(col('admin', 'recruitmentAgencies'), { organizationId: ORG, name: 'New', submittedCount: 0, ...created('uAdm') }));
  await assertFails(addDoc(col('perf', 'recruitmentAgencies'), { organizationId: ORG, name: 'New', ...created('uPerf') }));
  await assertSucceeds(updateDoc(ref('perf', 'recruitmentAgencies/AG1'), { submittedCount: 1, shortlistedCount: 0, interviewedCount: 0, offeredCount: 0, joinedCount: 0 }));
  await assertFails(updateDoc(ref('perf', 'recruitmentAgencies/AG1'), { name: 'Renamed' }));
  await assertSucceeds(updateDoc(ref('admin', 'recruitmentAgencies/AG1'), { name: 'Renamed', status: 'Inactive', ...updated('uAdm') }));

  await assertSucceeds(addDoc(col('admin', 'hrRecruitmentCosts'), { organizationId: ORG, head: 'Agency Fee', amount: 5, ...created('uAdm') }));
  await assertFails(addDoc(col('member', 'hrRecruitmentCosts'), { organizationId: ORG, head: 'Agency Fee', amount: 5, ...created('uMem') }));
  await assertSucceeds(addDoc(col('admin', 'hrManpowerPlans'), { organizationId: ORG, designation: 'X', approvedStrength: 1, ...created('uAdm') }));
  await assertSucceeds(updateDoc(ref('admin', 'hrManpowerPlans/MP1'), { approvedStrength: 5, ...updated('uAdm') }));
  await assertFails(updateDoc(ref('member', 'hrManpowerPlans/MP1'), { approvedStrength: 50 }));

  await assertSucceeds(setDoc(ref('admin', `hrSettings/${ORG}`), { sla: { pauseOnHold: true }, organizationId: ORG, ...updated('uAdm') }, { merge: true }));
  await assertSucceeds(setDoc(ref('admin', 'hrSettings/org2'), { general: {}, organizationId: 'org2', ...updated('uAdm') }, { merge: true }));
  await assertFails(setDoc(ref('admin', 'hrSettings/org3'), { general: {}, organizationId: 'org1', ...updated('uAdm') }, { merge: true }));
  await assertFails(setDoc(ref('member', `hrSettings/${ORG}`), { sla: {}, organizationId: ORG, ...updated('uMem') }, { merge: true }));

  const activity = (userId) => ({ organizationId: ORG, entityType: 'requirement', entityId: 'R2', requirementId: 'R2', action: 'Comment', summary: 'hi', userId, userName: 'X', createdAt: serverTimestamp() });
  await assertSucceeds(addDoc(col('member', 'hrActivities'), activity('uMem')));
  await assertSucceeds(addDoc(col('legacyAuth', 'hrActivities'), activity('uMem')));
  await assertFails(addDoc(col('member', 'hrActivities'), activity('uAdm')));
  await assertFails(addDoc(col('stranger', 'hrActivities'), activity('uX')));
  await assertFails(updateDoc(ref('admin', 'hrActivities/AC1'), { summary: 'edited' }));
  await assertFails(deleteDoc(ref('admin', 'hrActivities/AC1')));
});

test('switch user is browser-only: an admin stamping the impersonated user is refused', async () => {
  // The browser shows uMem; the auth (and permissions) are the admin's, whose userDocId is uAdm.
  await assertFails(addDoc(col('admin', 'hrActivities'), { organizationId: ORG, userId: 'uMem', action: 'x' }));
  await assertFails(addDoc(col('admin', 'interviewFeedback'), { organizationId: ORG, interviewId: 'I1', interviewerId: 'uMem', submitted: true }));
  // Reads are the admin's own, module-wide.
  await assertSucceeds(getDocs(byOrg('admin', 'interviews')));
});
