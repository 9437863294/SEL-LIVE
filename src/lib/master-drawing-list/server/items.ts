import 'server-only';

/**
 * Master Drawing List writes. Each runs in one Firestore transaction: read the item (and its drawing
 * list, for the access check), apply the change through `derive.ts`'s rules, and write it back with
 * status, current revision, last dates and "held by" recalculated. Inputs are zod-parsed by the
 * routes before they get here.
 */

import { FieldValue, type DocumentData } from 'firebase-admin/firestore';

import { addApproval, addComments, addSubmission, derive, type Change } from '../derive.ts';
import { nextNumbers } from '../register.ts';
import type { DatedInput, DetailsInput, NewItemInput, NewProjectInput, ProjectLinkInput, SubmissionInput } from '../schemas.ts';
import type { MdlStep } from '../steps.ts';
import type { MdlItem, MdlItemCore, MdlProject } from '../types.ts';
import { MdlError, type MdlContext } from './context.ts';
import { db, itemsCol, projectsCol, toItem } from './store.ts';

const audit = (context: MdlContext) => ({
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: context.userId,
  updatedByName: context.userName || null,
});

/** The step's permission: submissions and comments are one permission, the approval its own. */
const STEP_PERMISSION: Record<MdlStep, ['Submissions' | 'Approval', string]> = {
  submission: ['Submissions', 'Record'],
  comments: ['Submissions', 'Record'],
  approval: ['Approval', 'Record'],
};

/** Read the item, check access, apply one change and write it back with the status recalculated. */
async function mutate(
  context: MdlContext,
  itemId: string,
  permission: ['Drawings' | 'Submissions' | 'Approval', string],
  change: (item: MdlItemCore) => Change<Partial<MdlItemCore>>,
): Promise<MdlItem> {
  const ref = itemsCol().doc(itemId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new MdlError('This drawing item no longer exists.', 404);
    const item = snap.data() as MdlItemCore;
    const projectSnap = await tx.get(projectsCol().doc(item.projectCode));
    const project = { projectId: projectSnap.exists ? ((projectSnap.data() as MdlProject).projectId ?? null) : null };
    context.require(permission[0], permission[1], project);

    const outcome = change(item);
    if (!outcome.ok) throw new MdlError(outcome.error, 409);
    const next = { ...item, ...outcome.value };
    const written = { ...outcome.value, ...derive(next), ...audit(context) };
    tx.update(ref, written as DocumentData);
    return toItem(itemId, { ...snap.data(), ...written, updatedAt: new Date().toISOString() });
  });
}

export function recordStep(context: MdlContext, itemId: string, step: MdlStep, input: SubmissionInput | DatedInput): Promise<MdlItem> {
  const today = context.today;
  return mutate(context, itemId, STEP_PERMISSION[step], (item) => {
    if (step === 'submission') {
      const result = addSubmission(item, input.date, 'transmittalNo' in input ? input.transmittalNo : null, today);
      return result.ok ? { ok: true, value: { revisions: result.value } } : result;
    }
    if (step === 'comments') {
      const result = addComments(item, input.date, today);
      return result.ok ? { ok: true, value: { revisions: result.value } } : result;
    }
    const result = addApproval(item, input.date, today);
    return result.ok ? { ok: true, value: { approved: true, approvedOn: result.value } } : result;
  });
}

export function updateDetails(context: MdlContext, itemId: string, input: DetailsInput): Promise<MdlItem> {
  return mutate(context, itemId, ['Drawings', 'Edit'], () => ({ ok: true, value: input }));
}

/** Adds an item at the end of its project, with the next Sl. No. in its schedule and scope. */
export async function createItem(context: MdlContext, input: NewItemInput): Promise<{ id: string; slNo: string }> {
  const projectSnap = await projectsCol().doc(input.projectCode).get();
  if (!projectSnap.exists) throw new MdlError('This project is not set up for the drawing list.', 404);
  const project = projectSnap.data() as MdlProject;
  context.require('Drawings', 'Add', { projectId: project.projectId ?? null });

  const ref = itemsCol().doc();
  const slNo = await db().runTransaction(async (tx) => {
    const existing = await tx.get(itemsCol().where('projectCode', '==', input.projectCode));
    const numbers = nextNumbers(existing.docs.map((doc) => doc.data() as MdlItemCore), input.schedule, input.scope);
    const core: MdlItemCore = {
      ...input,
      order: numbers.order,
      slNo: numbers.slNo,
      onHold: false,
      revisions: [],
      approved: false,
      approvedOn: null,
      remarks: null,
      legacy: null,
    };
    // A fresh auto-id, so `set` cannot overwrite anything.
    tx.set(ref, { ...core, ...derive(core), ...audit(context) });
    return numbers.slNo;
  });
  return { id: ref.id, slNo };
}

/**
 * Starts a drawing list for an ERP project, so items can be added by hand without an import.
 * Settings · Manage. Refused when the code is already taken (an imported list keeps its code).
 */
export async function createProject(context: MdlContext, input: NewProjectInput): Promise<{ code: string }> {
  context.require('Settings', 'Manage');
  const erp = await db().collection('projects').doc(input.projectId).get();
  if (!erp.exists) throw new MdlError('That ERP project does not exist.', 404);
  const ref = projectsCol().doc(input.code);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) throw new MdlError(`A drawing list with the code "${input.code}" already exists.`, 409);
    const project: MdlProject = {
      code: input.code,
      short: input.short,
      name: input.name,
      client: input.client,
      drgPrefix: input.drgPrefix,
      projectId: input.projectId,
    };
    tx.set(ref, { ...project, ...audit(context) });
  });
  return { code: input.code };
}

/** Links a drawing list to an ERP project (or unlinks it). Settings · Manage, every list. */
export async function linkProject(context: MdlContext, code: string, input: ProjectLinkInput): Promise<void> {
  context.require('Settings', 'Manage');
  if (input.projectId) {
    const erp = await db().collection('projects').doc(input.projectId).get();
    if (!erp.exists) throw new MdlError('That ERP project does not exist.', 404);
  }
  const ref = projectsCol().doc(code);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new MdlError('This drawing list does not exist.', 404);
    tx.update(ref, { projectId: input.projectId, ...audit(context) });
  });
}
