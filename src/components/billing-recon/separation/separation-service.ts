'use client';

/**
 * The Firestore side of Billing Recon's data separation: reading a project's preview and running
 * the copy. What gets copied is decided by `planSeparation` (src/lib/billing-recon/separation.ts);
 * where things live by src/lib/billing-recon/register.ts.
 *
 * Order matters and is chosen so that a failure part-way leaves the app working:
 *   1. copy BOQ → JMC → MVAC → serial counters → JMC workflow (only additions to Billing Recon's own
 *      collections, which nothing reads until the project is stamped);
 *   2. optionally remove the chosen JMCs from the project register;
 *   3. stamp `projects/{id}.billingReconSeparation` — the switch.
 * A run that stops before 3 changes nothing anyone sees; running again skips what was copied.
 */

import {
  collection,
  collectionGroup,
  deleteField,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import {
  BILLING_RECON_COLLECTIONS,
  BILLING_RECON_FIXED,
  PROJECT_JMC_SERIAL_CONFIGS,
  SHARED_PROJECT_REGISTER,
  WORKFLOWS_COLLECTION,
  serialConfigPrefix,
  type BillingReconSeparation,
} from '@/lib/billing-recon/register';
import { chunk, planSeparation, referencedJmcIds, type SeparationPlan } from '@/lib/billing-recon/separation';
import { entryValues } from '@/lib/billing-recon/dashboard';
import { logUserActivity } from '@/lib/activity-logger';

export interface JmcPreviewRow {
  id: string;
  jmcNo: string;
  jmcDate: string;
  woNo: string;
  status: string;
  stage: string;
  currentStepId: string | null;
  lines: number;
  executedValue: number;
  raisedBy: string;
  alreadyCopied: boolean;
  /** A subcontractor bill or proforma bill points at it: it can be copied but never removed. */
  referencedBySubcontractorBill: boolean;
}

export interface SeparationPreview {
  sharedBoqCount: number;
  copiedBoqCount: number;
  jmc: JmcPreviewRow[];
  sharedMvacCount: number;
  copiedMvacCount: number;
  serialConfigIds: string[];
  copiedSerialConfigIds: string[];
  referencedJmcIds: string[];
  /** Billing Recon's own JMC workflow already exists (another project was separated first). */
  billingReconWorkflowExists: boolean;
  /** Step ids of the workflow the copied JMCs will run on. */
  targetWorkflowStepIds: string[];
}

export interface SeparationOptions {
  selectedJmcIds: string[];
  removeCopiedJmcFromProjectRegister: boolean;
}

export interface SeparationUser {
  id: string;
  name?: string;
  email?: string;
}

export interface SeparationProgress {
  phase: string;
  done: number;
  total: number;
}

const projectCollection = (projectId: string, name: string) => collection(db, 'projects', projectId, name);

const text = (value: unknown) => (value == null ? '' : String(value).trim());

async function ids(projectId: string, name: string): Promise<string[]> {
  const snap = await getDocs(projectCollection(projectId, name));
  return snap.docs.map((d) => d.id);
}

async function count(projectId: string, name: string): Promise<number> {
  const snap = await getCountFromServer(projectCollection(projectId, name));
  return snap.data().count;
}

/** A project's serial-config documents in a top-level series collection (ids start `${projectId}_`). */
async function serialDocs(collectionName: string, projectId: string) {
  const prefix = serialConfigPrefix(projectId);
  const snap = await getDocs(
    query(collection(db, collectionName), where(documentId(), '>=', prefix), where(documentId(), '<', `${prefix}`)),
  );
  return snap.docs;
}

/** Subcontractor bills and proforma bills — only read for which JMCs they point at. */
async function subcontractorJmcReferences(projectId: string): Promise<string[]> {
  const read = async (name: string) => {
    try {
      const snap = await getDocs(projectCollection(projectId, name));
      return snap.docs.map((d) => d.data() as { items?: unknown });
    } catch {
      return [];
    }
  };
  const [bills, proforma] = await Promise.all([read('bills'), read('proformaBills')]);
  return referencedJmcIds([...bills, ...proforma]);
}

function stepIds(data: DocumentData | undefined): string[] {
  const steps = Array.isArray(data?.steps) ? (data!.steps as Array<{ id?: unknown }>) : [];
  return steps.map((s) => text(s?.id)).filter(Boolean);
}

export type TaskFeedState = 'ready' | 'index-missing' | 'not-permitted' | 'error';

/**
 * Whether approvers will see Billing Recon's own JMC / MVAC entries on their work board and task
 * bell — the same collection-group query those run, which needs a production index and rule
 * (firestore.indexes.json fieldOverrides, firestore.rules). Checked before separating, because a
 * separated project's approvals would otherwise wait silently.
 */
export async function checkTaskFeed(userId: string): Promise<Record<'jmc' | 'mvac', TaskFeedState>> {
  const probe = async (group: string): Promise<TaskFeedState> => {
    try {
      await getDocs(query(collectionGroup(db, group), where('assignees', 'array-contains', userId), limit(1)));
      return 'ready';
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'failed-precondition') return 'index-missing';
      if (code === 'permission-denied') return 'not-permitted';
      return 'error';
    }
  };
  const [jmc, mvac] = await Promise.all([probe(BILLING_RECON_COLLECTIONS.jmcEntries), probe(BILLING_RECON_COLLECTIONS.mvacEntries)]);
  return { jmc, mvac };
}

export async function loadSeparationPreview(project: Project): Promise<SeparationPreview> {
  const pid = project.id;
  const [sharedBoqCount, copiedBoqCount, jmcSnap, copiedJmcIds, sharedMvacCount, copiedMvacCount, serials, copiedSerials, referenced, brWorkflow, sharedWorkflow] =
    await Promise.all([
      count(pid, SHARED_PROJECT_REGISTER.boqItems),
      count(pid, BILLING_RECON_COLLECTIONS.boqItems),
      getDocs(projectCollection(pid, SHARED_PROJECT_REGISTER.jmcEntries)),
      ids(pid, BILLING_RECON_COLLECTIONS.jmcEntries),
      count(pid, SHARED_PROJECT_REGISTER.mvacEntries),
      count(pid, BILLING_RECON_COLLECTIONS.mvacEntries),
      serialDocs(BILLING_RECON_FIXED.serialConfigs, pid),
      serialDocs(PROJECT_JMC_SERIAL_CONFIGS, pid),
      subcontractorJmcReferences(pid),
      getDoc(doc(db, WORKFLOWS_COLLECTION, BILLING_RECON_COLLECTIONS.jmcWorkflowId)),
      getDoc(doc(db, WORKFLOWS_COLLECTION, SHARED_PROJECT_REGISTER.jmcWorkflowId)),
    ]);

  const copied = new Set(copiedJmcIds);
  const refs = new Set(referenced);
  const jmc: JmcPreviewRow[] = jmcSnap.docs
    .map((d) => {
      const data = d.data();
      const history = Array.isArray(data.history) ? (data.history as Array<{ userName?: unknown }>) : [];
      return {
        id: d.id,
        jmcNo: text(data.jmcNo) || '—',
        jmcDate: text(data.jmcDate),
        woNo: text(data.woNo),
        status: text(data.status) || 'Pending',
        stage: text(data.stage),
        currentStepId: text(data.currentStepId) || null,
        lines: Array.isArray(data.items) ? data.items.length : 0,
        executedValue: entryValues(data).executed,
        raisedBy: text(history[0]?.userName),
        alreadyCopied: copied.has(d.id),
        referencedBySubcontractorBill: refs.has(d.id),
      };
    })
    .sort((a, b) => b.jmcDate.localeCompare(a.jmcDate) || a.jmcNo.localeCompare(b.jmcNo));

  return {
    sharedBoqCount,
    copiedBoqCount,
    jmc,
    sharedMvacCount,
    copiedMvacCount,
    serialConfigIds: serials.map((d) => d.id),
    copiedSerialConfigIds: copiedSerials.map((d) => d.id),
    referencedJmcIds: referenced,
    billingReconWorkflowExists: brWorkflow.exists(),
    targetWorkflowStepIds: brWorkflow.exists() ? stepIds(brWorkflow.data()) : stepIds(sharedWorkflow.data()),
  };
}

/** Copies documents into `target` with their own ids, in batches. */
async function copyDocs(
  docs: Array<{ id: string; data: DocumentData }>,
  target: (id: string) => ReturnType<typeof doc>,
  onBatch: (n: number) => void,
) {
  for (const part of chunk(docs, 400)) {
    const batch = writeBatch(db);
    part.forEach((d) => batch.set(target(d.id), d.data));
    await batch.commit();
    onBatch(part.length);
  }
}

export interface SeparationResult {
  plan: SeparationPlan;
  stamp: BillingReconSeparation;
}

export async function runSeparation(
  project: Project,
  options: SeparationOptions,
  user: SeparationUser,
  onProgress: (progress: SeparationProgress) => void,
): Promise<SeparationResult> {
  const pid = project.id;

  // Fresh reads: the preview may be minutes old.
  onProgress({ phase: 'Reading the project register…', done: 0, total: 1 });
  const [boqSnap, copiedBoq, jmcSnap, copiedJmc, mvacSnap, copiedMvac, serials, copiedSerials, referenced] = await Promise.all([
    getDocs(projectCollection(pid, SHARED_PROJECT_REGISTER.boqItems)),
    ids(pid, BILLING_RECON_COLLECTIONS.boqItems),
    getDocs(projectCollection(pid, SHARED_PROJECT_REGISTER.jmcEntries)),
    ids(pid, BILLING_RECON_COLLECTIONS.jmcEntries),
    getDocs(projectCollection(pid, SHARED_PROJECT_REGISTER.mvacEntries)),
    ids(pid, BILLING_RECON_COLLECTIONS.mvacEntries),
    serialDocs(BILLING_RECON_FIXED.serialConfigs, pid),
    serialDocs(PROJECT_JMC_SERIAL_CONFIGS, pid),
    subcontractorJmcReferences(pid),
  ]);

  const plan = planSeparation({
    boqIds: boqSnap.docs.map((d) => d.id),
    existingBillingReconBoqIds: copiedBoq,
    jmcIds: jmcSnap.docs.map((d) => d.id),
    selectedJmcIds: options.selectedJmcIds,
    existingBillingReconJmcIds: copiedJmc,
    mvacIds: mvacSnap.docs.map((d) => d.id),
    existingBillingReconMvacIds: copiedMvac,
    serialConfigIds: serials.map((d) => d.id),
    existingProjectSerialConfigIds: copiedSerials.map((d) => d.id),
    removeCopiedJmcFromProjectRegister: options.removeCopiedJmcFromProjectRegister,
    referencedJmcIds: referenced,
  });

  const total = plan.totalWrites + 2; // + workflow + stamp
  let done = 0;
  const step = (phase: string) => (n: number) => {
    done += n;
    onProgress({ phase, done, total });
  };

  const pick = (snap: typeof boqSnap, wanted: string[]) => {
    const set = new Set(wanted);
    return snap.docs.filter((d) => set.has(d.id)).map((d) => ({ id: d.id, data: d.data() }));
  };

  onProgress({ phase: 'Copying BOQ items…', done, total });
  await copyDocs(pick(boqSnap, plan.boqToCopy), (id) => doc(db, 'projects', pid, BILLING_RECON_COLLECTIONS.boqItems, id), step('Copying BOQ items…'));

  onProgress({ phase: 'Copying JMC entries…', done, total });
  await copyDocs(pick(jmcSnap, plan.jmcToCopy), (id) => doc(db, 'projects', pid, BILLING_RECON_COLLECTIONS.jmcEntries, id), step('Copying JMC entries…'));

  onProgress({ phase: 'Copying MVAC entries…', done, total });
  await copyDocs(pick(mvacSnap, plan.mvacToCopy), (id) => doc(db, 'projects', pid, BILLING_RECON_COLLECTIONS.mvacEntries, id), step('Copying MVAC entries…'));

  // Project Management's JMC counters continue from the shared ones; Billing Recon keeps the originals.
  onProgress({ phase: 'Copying JMC number series…', done, total });
  const wantedSerials = new Set(plan.serialConfigsToCopy);
  await copyDocs(
    serials.filter((d) => wantedSerials.has(d.id)).map((d) => ({ id: d.id, data: d.data() })),
    (id) => doc(db, PROJECT_JMC_SERIAL_CONFIGS, id),
    step('Copying JMC number series…'),
  );

  // Billing Recon's JMC workflow starts as a copy of the shared one (step ids kept, so copied JMCs
  // that are mid-approval stay at the step they were at). Created once, by the first separation.
  onProgress({ phase: 'Setting up the JMC workflow…', done, total });
  const brWorkflowRef = doc(db, WORKFLOWS_COLLECTION, BILLING_RECON_COLLECTIONS.jmcWorkflowId);
  const brWorkflow = await getDoc(brWorkflowRef);
  let jmcWorkflowCopied = false;
  if (!brWorkflow.exists()) {
    const shared = await getDoc(doc(db, WORKFLOWS_COLLECTION, SHARED_PROJECT_REGISTER.jmcWorkflowId));
    await setDoc(brWorkflowRef, {
      ...(shared.exists() ? shared.data() : { steps: [] }),
      copiedFrom: SHARED_PROJECT_REGISTER.jmcWorkflowId,
      copiedAt: new Date().toISOString(),
      copiedByName: user.name ?? '',
    });
    jmcWorkflowCopied = true;
  }
  step('Setting up the JMC workflow…')(1);

  if (plan.jmcToRemoveFromProjectRegister.length) {
    onProgress({ phase: 'Removing the chosen JMCs from the project register…', done, total });
    for (const part of chunk(plan.jmcToRemoveFromProjectRegister, 400)) {
      const batch = writeBatch(db);
      part.forEach((id) => batch.delete(doc(db, 'projects', pid, SHARED_PROJECT_REGISTER.jmcEntries, id)));
      await batch.commit();
      step('Removing the chosen JMCs from the project register…')(part.length);
    }
  }

  const stamp: BillingReconSeparation = {
    separatedAt: new Date().toISOString(),
    separatedById: user.id,
    separatedByName: user.name ?? user.email ?? '',
    copied: {
      boqItems: plan.boqToCopy.length + plan.boqAlreadyCopied,
      jmcEntries: plan.jmcToCopy.length + plan.jmcAlreadyCopied,
      mvacEntries: plan.mvacToCopy.length + plan.mvacAlreadyCopied,
      serialConfigs: plan.serialConfigsToCopy.length,
      jmcWorkflow: jmcWorkflowCopied,
    },
    removedFromProjectRegister: plan.jmcToRemoveFromProjectRegister.length,
  };
  onProgress({ phase: 'Switching the project over…', done, total });
  await updateDoc(doc(db, 'projects', pid), { billingReconSeparation: stamp });
  step('Done')(1);

  await logUserActivity({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    module: 'Billing Recon',
    action: 'Separate Project Data',
    details: {
      projectId: pid,
      projectName: project.projectName,
      copiedBoqItems: plan.boqToCopy.length,
      copiedJmcEntries: plan.jmcToCopy.length,
      copiedMvacEntries: plan.mvacToCopy.length,
      copiedSerialConfigs: plan.serialConfigsToCopy.length,
      jmcWorkflowCopied,
      removedFromProjectRegister: plan.jmcToRemoveFromProjectRegister.length,
      keptBecauseReferenced: plan.jmcKeptBecauseReferenced.length,
    },
  });

  return { plan, stamp };
}

/**
 * Points Billing Recon back at the shared register for this project. Nothing is deleted: Billing
 * Recon's copies stay where they are (and are used again if the project is separated again), but
 * anything Billing Recon recorded after separating is hidden while the project is back on the
 * shared register.
 */
export async function rejoinSharedRegister(project: Project, user: SeparationUser): Promise<void> {
  await updateDoc(doc(db, 'projects', project.id), { billingReconSeparation: deleteField() });
  await logUserActivity({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    module: 'Billing Recon',
    action: 'Rejoin Shared Register',
    details: { projectId: project.id, projectName: project.projectName, separatedAt: project.billingReconSeparation?.separatedAt ?? '' },
  });
}
