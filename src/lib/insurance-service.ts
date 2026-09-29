import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { addDays, startOfDay, subDays } from 'date-fns';
import { db } from './firebase';
import { storage } from './firebase-storage';
import { calculateDeadline, getAssigneeForStep } from './workflow-utils';
import type { ActionLog, InsurancePolicy, InsuranceTask, InsuredAsset, ProjectInsurancePolicy, WorkflowStep } from './types';
import {
  DUE_SOON_DAYS,
  isPersonalInForce,
  normalisePolicyNo,
  personalPolicyState,
  projectPolicyState,
  taskCheckId,
  toDate,
} from './insurance';

/**
 * Firestore side of the insurance module: the task sync, closing tasks when a premium is paid, and
 * the integrity checks the forms need.
 *
 * The sync used to be a server action. It called the browser Firebase SDK from the server, where no
 * user is signed in, so it ran unauthenticated against rules that expect a user — and when it
 * failed, the My Tasks page never loaded its tasks at all. It runs in the browser now, as the
 * signed-in user, like every other write in the module.
 */

export const PERSONAL_POLICIES = 'insurance_policies';
export const PROJECT_POLICIES = 'project_insurance_policies';
export const INSURANCE_TASKS = 'insuranceTasks';
const WORKFLOW_DOC = doc(db, 'workflows', 'insurance-workflow');

export const OPEN_TASK_STATUSES: InsuranceTask['status'][] = ['Pending', 'In Progress', 'Needs Review'];

/** Maturity tasks are raised this many days ahead, and not for maturities older than this. */
const MATURITY_TASK_WINDOW = 30;

export interface SyncResult {
  created: number;
  existing: number;
  unassigned: string[];
}

interface Candidate {
  checkId: string;
  policyId: string;
  policyNo: string;
  insuredPerson: string;
  dueDate: Date;
  taskType: InsuranceTask['taskType'];
  policyKind: 'personal' | 'project';
  amount: number;
  projectId: string;
}

/**
 * Raise a workflow task for every premium or renewal due within 30 days (or already overdue) and
 * every maturity within 30 days either side of today, unless one was raised for that date before.
 */
export async function syncInsuranceTasks(): Promise<SyncResult> {
  const workflowSnap = await getDoc(WORKFLOW_DOC);
  const steps = (workflowSnap.exists() ? workflowSnap.data()?.steps : null) as WorkflowStep[] | null;
  const firstStep = steps?.[0];
  if (!firstStep) throw new Error('The insurance workflow is not configured. Set it up under Insurance → Settings → Workflow.');

  const [personalSnap, projectSnap, assetsSnap, tasksSnap] = await Promise.all([
    getDocs(collection(db, PERSONAL_POLICIES)),
    getDocs(collection(db, PROJECT_POLICIES)),
    getDocs(collection(db, 'insuredAssets')),
    getDocs(collection(db, INSURANCE_TASKS)),
  ]);
  const existing = new Set(tasksSnap.docs.map((d) => (d.data() as InsuranceTask).uniqueCheckId));
  const assets = new Map(assetsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as InsuredAsset]));

  const now = new Date();
  const soonLimit = addDays(startOfDay(now), DUE_SOON_DAYS);
  const candidates: Candidate[] = [];

  for (const d of personalSnap.docs) {
    const p = { id: d.id, ...d.data() } as InsurancePolicy;
    if (!isPersonalInForce(p)) continue;
    const state = personalPolicyState(p, now);
    const due = toDate(p.due_date);
    if (due && state !== 'matured' && startOfDay(due) <= soonLimit) {
      candidates.push({
        checkId: taskCheckId(p.id, due), policyId: p.id, policyNo: p.policy_no, insuredPerson: p.insured_person,
        dueDate: due, taskType: 'Premium Due', policyKind: 'personal', amount: p.premium || 0, projectId: '',
      });
    }
    const maturity = toDate(p.date_of_maturity);
    if (maturity && Math.abs((startOfDay(maturity).getTime() - startOfDay(now).getTime()) / 86_400_000) <= MATURITY_TASK_WINDOW) {
      candidates.push({
        checkId: taskCheckId(p.id, maturity, 'maturity'), policyId: p.id, policyNo: p.policy_no, insuredPerson: p.insured_person,
        dueDate: maturity, taskType: 'Maturity Due', policyKind: 'personal', amount: p.sum_insured || 0, projectId: '',
      });
    }
  }

  for (const d of projectSnap.docs) {
    const p = { id: d.id, ...d.data() } as ProjectInsurancePolicy;
    if (p.status !== 'Active') continue;
    const state = projectPolicyState(p, now);
    const end = toDate(p.insured_until);
    if (!end || (state !== 'expiring' && state !== 'expired')) continue;
    const asset = assets.get(p.assetId);
    candidates.push({
      checkId: taskCheckId(p.id, end), policyId: p.id, policyNo: p.policy_no, insuredPerson: p.assetName,
      dueDate: end, taskType: 'Premium Due', policyKind: 'project', amount: p.premium || 0,
      projectId: asset?.type === 'Project' ? asset.projectId || '' : '',
    });
  }

  let created = 0;
  let already = 0;
  const unassigned: string[] = [];
  const deadline = Timestamp.fromDate(await calculateDeadline(now, firstStep.tat));

  for (const c of candidates) {
    if (existing.has(c.checkId)) { already++; continue; }
    const assignees = await getAssigneeForStep(firstStep, { projectId: c.projectId, departmentId: '', amount: c.amount });
    if (assignees.length === 0) { unassigned.push(c.policyNo); continue; }

    // Back-date creation to 09:30 thirty days before the due date, so the task's age reads from
    // when it became actionable rather than from whenever someone first opened My Tasks.
    const becameDue = subDays(c.dueDate, DUE_SOON_DAYS);
    becameDue.setHours(9, 30, 0, 0);
    const createdAt = becameDue > now ? now : becameDue;

    await addDoc(collection(db, INSURANCE_TASKS), {
      uniqueCheckId: c.checkId,
      policyId: c.policyId,
      policyNo: c.policyNo,
      insuredPerson: c.insuredPerson,
      dueDate: Timestamp.fromDate(c.dueDate),
      status: 'Pending',
      assignees,
      createdAt: Timestamp.fromDate(createdAt),
      taskType: c.taskType,
      currentStepId: firstStep.id,
      currentStage: firstStep.name,
      deadline,
      projectId: c.projectId,
      policyKind: c.policyKind,
      amount: c.amount,
      history: [],
    });
    existing.add(c.checkId);
    created++;
  }

  return { created, existing: already, unassigned };
}

/**
 * Close the open task raised for a policy's due date once the premium is actually paid (or the
 * policy renewed), so nobody keeps chasing a premium that has been settled.
 */
export async function completeTasksForDue(
  policyId: string,
  dueDate: Date,
  actor: { id: string; name?: string | null },
  note: string,
  kind: 'premium' | 'maturity' = 'premium',
): Promise<number> {
  const snap = await getDocs(query(collection(db, INSURANCE_TASKS), where('uniqueCheckId', '==', taskCheckId(policyId, dueDate, kind))));
  const open = snap.docs.filter((d) => OPEN_TASK_STATUSES.includes((d.data() as InsuranceTask).status));
  const log: ActionLog = {
    action: 'Complete',
    comment: note,
    userId: actor.id,
    userName: actor.name || '',
    timestamp: Timestamp.now(),
    stepName: (open[0]?.data() as InsuranceTask | undefined)?.currentStage || 'Completed',
  };
  await Promise.all(
    open.map((d) =>
      updateDoc(d.ref, {
        status: 'Completed',
        currentStage: 'Completed',
        currentStepId: null,
        assignees: [],
        deadline: null,
        history: arrayUnion(log),
      }),
    ),
  );
  return open.length;
}

/**
 * Whether another policy in the collection already carries this number with the same insurer.
 * Rules cannot enforce uniqueness, so the form checks before it writes.
 */
export async function findDuplicatePolicy(
  collectionName: typeof PERSONAL_POLICIES | typeof PROJECT_POLICIES,
  policyNo: string,
  company: string,
  excludeId?: string,
): Promise<string | null> {
  const wanted = normalisePolicyNo(policyNo);
  if (!wanted) return null;
  const snap = await getDocs(collection(db, collectionName));
  const hit = snap.docs.find((d) => {
    if (d.id === excludeId) return false;
    const data = d.data() as { policy_no?: string; insurance_company?: string };
    return normalisePolicyNo(data.policy_no || '') === wanted && (data.insurance_company || '') === company;
  });
  return hit ? hit.id : null;
}

/**
 * Upload files under a folder and return them as attachments. Names are prefixed with the upload
 * time: two documents called "policy.pdf" used to overwrite each other in Storage while both
 * attachment rows kept pointing at whichever was written last.
 */
export async function uploadInsuranceFiles(folder: string, files: File[]): Promise<{ name: string; url: string }[]> {
  const out: { name: string; url: string }[] = [];
  for (const file of files) {
    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const storageRef = ref(storage, `${folder}/${Date.now()}-${safe}`);
    await uploadBytes(storageRef, file);
    out.push({ name: file.name, url: await getDownloadURL(storageRef) });
  }
  return out;
}

/**
 * How many policies, personal and project, refer to a master record by the given field. Masters are
 * referenced by name, so deleting one that is in use would leave policies pointing at nothing.
 */
export async function countPolicyReferences(
  field: 'insured_person' | 'insurance_company' | 'policy_category' | 'assetId',
  value: string,
): Promise<number> {
  if (!value) return 0;
  const targets = field === 'insured_person' ? [PERSONAL_POLICIES] : field === 'assetId' ? [PROJECT_POLICIES] : [PERSONAL_POLICIES, PROJECT_POLICIES];
  const snaps = await Promise.all(targets.map((c) => getDocs(query(collection(db, c), where(field, '==', value)))));
  return snaps.reduce((n, s) => n + s.size, 0);
}
