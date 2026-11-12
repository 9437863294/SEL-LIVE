import 'server-only';

/**
 * Master Drawing List writes, through the Admin SDK. Saving the Drawing Details dialog checks the
 * caller's access and the record rules (`steps.ts`), stores the round files it was sent, then
 * re-reads and writes the item in one transaction.
 *
 * Who may do what (per drawing list, see `access.ts`):
 *   Drawings · Add     add an item
 *   Drawings · Edit    update any drawing, add or remove sub-drawings
 *   (assignee)         update their own sub-drawing without Edit (not reassign it)
 *   Drawings · Delete  delete an item
 *   Settings · Manage  create and link drawing lists
 */

import { FieldValue, type DocumentData } from 'firebase-admin/firestore';

import { getFirebaseAdminBucket } from '@/lib/firebase-admin';

import { emptyRevisions, type DrawingItem, type DrawingRecord, type DrawingRevision, type SubDrawing } from '../drawings.ts';
import { nextNumbers } from '../register.ts';
import type { DrawingSaveInput, NewItemInput, NewProjectInput, ProjectLinkInput } from '../schemas.ts';
import { drawingFormError, recordFromForm } from '../steps.ts';
import type { MdlProject } from '../types.ts';
import { MdlError, type MdlContext } from './context.ts';
import { db, itemsCol, projectsCol, toItem } from './store.ts';

const audit = (context: MdlContext) => ({
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: context.userId,
  updatedByName: context.userName || null,
});

/** Files a round may carry, and their size limit. */
export const FILE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'dwg', 'dxf'] as const;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  dwg: 'application/acad',
  dxf: 'application/dxf',
};

export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
}

const filePrefix = (projectCode: string, itemId: string) => `master-drawing-list/${projectCode}/${itemId}/`;

async function projectOf(code: string): Promise<{ projectId: string | null }> {
  const snap = await projectsCol().doc(code).get();
  return { projectId: snap.exists ? ((snap.data() as MdlProject).projectId ?? null) : null };
}

/* ── add ─────────────────────────────────────────────────────────────────── */

/** Adds an item at the end of its project, with the next Sl. No. in its schedule and scope. */
export async function createItem(context: MdlContext, input: NewItemInput): Promise<{ id: string; slNo: string }> {
  const projectSnap = await projectsCol().doc(input.projectCode).get();
  if (!projectSnap.exists) throw new MdlError('This project is not set up for the drawing list.', 404);
  context.require('Drawings', 'Add', { projectId: (projectSnap.data() as MdlProject).projectId ?? null });

  const ref = itemsCol().doc();
  const slNo = await db().runTransaction(async (tx) => {
    const existing = await tx.get(itemsCol().where('projectCode', '==', input.projectCode));
    const numbers = nextNumbers(existing.docs.map((doc) => doc.data() as DrawingItem), input.schedule, input.scope);
    if (input.plannedStartDate && input.plannedEndDate && input.plannedEndDate < input.plannedStartDate) {
      throw new MdlError('Planned end date cannot be before the planned start date.');
    }
    const item: Omit<DrawingItem, 'id' | 'updatedAt' | 'updatedBy'> = {
      projectCode: input.projectCode,
      schedule: input.schedule,
      scope: input.scope,
      group: input.group,
      order: numbers.order,
      slNo: numbers.slNo,
      description: input.description,
      docNo: input.docNo,
      drawingNo: input.drawingNo,
      plannedStartDate: input.plannedStartDate,
      plannedEndDate: input.plannedEndDate,
      revisions: emptyRevisions(),
      approveDate: '',
      status: 'Pending',
      remark: '',
      subDrawings: [],
      legacy: null,
    };
    // A fresh auto-id, so `set` cannot overwrite anything.
    tx.set(ref, { ...item, createdAt: FieldValue.serverTimestamp(), createdBy: context.userId, ...audit(context) });
    return numbers.slNo;
  });
  return { id: ref.id, slNo };
}

/* ── the Drawing Details dialog ──────────────────────────────────────────── */

/** Puts back the file of every round not uploaded now, from the stored record — never from the browser. */
function keepStoredFiles(revisions: DrawingRevision[], stored: DrawingRevision[] | undefined, uploaded: Map<string, { fileName: string; filePath: string }>): DrawingRevision[] {
  const before = new Map((stored ?? []).map((revision) => [revision.round, revision]));
  return revisions.map((revision) => {
    const next: DrawingRevision = { ...revision };
    delete next.fileName;
    delete next.filePath;
    const file = uploaded.get(revision.round) ?? (before.get(revision.round)?.filePath ? { fileName: before.get(revision.round)!.fileName ?? '', filePath: before.get(revision.round)!.filePath! } : null);
    if (file) {
      next.fileName = file.fileName;
      next.filePath = file.filePath;
    }
    return next;
  });
}

/**
 * Saves the item's own drawing, a new sub-drawing, or an existing one, with any round files sent
 * (`files`: round → file). Returns the item as stored.
 */
export async function saveDrawing(context: MdlContext, itemId: string, input: DrawingSaveInput, files: Map<string, UploadedFile>): Promise<DrawingItem> {
  const snap = await itemsCol().doc(itemId).get();
  if (!snap.exists) throw new MdlError('This drawing item no longer exists.', 404);
  const item = toItem(snap.id, snap.data() as DocumentData);
  const project = await projectOf(item.projectCode);
  context.requireProject(project);
  const canEdit = context.can('Drawings', 'Edit', project);
  const { target, form } = input;

  let previous: (DrawingRecord & { assignedToId?: string }) | null = null;
  if (target.kind === 'item') {
    if (!canEdit) throw new MdlError('Edit permission on Master Drawing List · Drawings is required.', 403);
    previous = item;
  } else {
    const existing = item.subDrawings.find((sub) => sub.id === target.subId) ?? null;
    if (target.isNew) {
      if (!canEdit) throw new MdlError('Edit permission on Master Drawing List · Drawings is required to add a sub-drawing.', 403);
      if (existing) throw new MdlError('This sub-drawing already exists.', 409);
    } else {
      if (!existing) throw new MdlError('This sub-drawing no longer exists.', 404);
      if (!canEdit && existing.assignedToId !== context.userId) {
        throw new MdlError('Only someone with Edit permission, or the person this sub-drawing is assigned to, can update it.', 403);
      }
      if (!canEdit && form.assignedToId !== (existing.assignedToId ?? '')) throw new MdlError('Only someone with Edit permission can reassign a sub-drawing.', 403);
      previous = existing;
    }
  }

  // The assignee is a registered user; their name is written beside the id.
  let assignedToName = '';
  if (target.kind === 'sub' && form.assignedToId) {
    const user = await db().collection('users').doc(form.assignedToId).get();
    if (!user.exists) throw new MdlError('The person chosen under Assigned To is not a registered user.');
    const data = user.data() as { name?: string; email?: string };
    assignedToName = data.name || data.email || form.assignedToId;
  }

  for (const [round, file] of files) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!FILE_EXTENSIONS.includes(extension as (typeof FILE_EXTENSIONS)[number])) throw new MdlError(`${round}: attach a PDF, PNG, JPG, DWG or DXF file.`);
    if (file.bytes.byteLength > MAX_FILE_BYTES) throw new MdlError(`${round}: the file is larger than 25 MB.`);
    if (!form.revisions.some((revision) => revision.round === round)) throw new MdlError(`${round}: there is no such round to attach the file to.`);
  }
  const error = drawingFormError(form, { isSub: target.kind === 'sub', previous, today: context.today, uploads: new Set(files.keys()) });
  if (error) throw new MdlError(error, 422);

  // Store the files first (Storage is outside the transaction), filed under the item and record.
  const uploaded = new Map<string, { fileName: string; filePath: string }>();
  const folder = `${filePrefix(item.projectCode, itemId)}${target.kind === 'sub' ? target.subId : 'item'}`;
  for (const [round, file] of files) {
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
    const filePath = `${folder}/${round}-${Date.now()}-${safeName}`;
    const extension = safeName.split('.').pop()?.toLowerCase() ?? '';
    await getFirebaseAdminBucket().file(filePath).save(Buffer.from(file.bytes), { contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream' });
    uploaded.set(round, { fileName: file.name, filePath });
  }

  const ref = itemsCol().doc(itemId);
  return db().runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists) throw new MdlError('This drawing item no longer exists.', 404);
    const fresh = toItem(current.id, current.data() as DocumentData);
    const nowIso = new Date().toISOString();
    let changes: Record<string, unknown>;
    if (target.kind === 'item') {
      const record = recordFromForm({ ...form, revisions: keepStoredFiles(form.revisions, fresh.revisions, uploaded) }, fresh);
      changes = { ...record, description: form.description.trim(), group: form.group.trim() || null };
    } else {
      const prior = fresh.subDrawings.find((sub) => sub.id === target.subId);
      if (target.isNew && prior) throw new MdlError('This sub-drawing already exists.', 409);
      if (!target.isNew && !prior) throw new MdlError('This sub-drawing no longer exists.', 404);
      const record = recordFromForm({ ...form, revisions: keepStoredFiles(form.revisions, prior?.revisions, uploaded) }, prior);
      const sub: SubDrawing = {
        id: target.subId,
        title: form.title.trim(),
        ...record,
        ...(form.assignedToId ? { assignedToId: form.assignedToId, assignedToName } : {}),
        createdAt: prior?.createdAt ?? nowIso,
        createdBy: prior?.createdBy ?? context.userId,
        createdByName: prior?.createdByName ?? context.userName ?? '',
        // ISO strings: Firestore rejects a server timestamp inside an array element.
        updatedAt: nowIso,
        updatedBy: context.userId,
        updatedByName: context.userName ?? '',
      };
      changes = { subDrawings: prior ? fresh.subDrawings.map((entry) => (entry.id === sub.id ? sub : entry)) : [...fresh.subDrawings, sub] };
    }
    const written = { ...changes, ...audit(context) };
    tx.update(ref, written as DocumentData);
    return toItem(itemId, { ...current.data(), ...changes, updatedAt: nowIso, updatedBy: context.userId, updatedByName: context.userName || null });
  });
}

export async function deleteSubDrawing(context: MdlContext, itemId: string, subId: string): Promise<void> {
  const ref = itemsCol().doc(itemId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new MdlError('This drawing item no longer exists.', 404);
    const item = toItem(snap.id, snap.data() as DocumentData);
    context.require('Drawings', 'Edit', await projectOf(item.projectCode));
    if (!item.subDrawings.some((sub) => sub.id === subId)) throw new MdlError('This sub-drawing no longer exists.', 404);
    tx.update(ref, { subDrawings: item.subDrawings.filter((sub) => sub.id !== subId), ...audit(context) } as DocumentData);
  });
}

/** Deletes the item from the register. Its round files stay in Storage. */
export async function deleteItem(context: MdlContext, itemId: string): Promise<void> {
  const ref = itemsCol().doc(itemId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new MdlError('This drawing item no longer exists.', 404);
    const item = snap.data() as DrawingItem;
    context.require('Drawings', 'Delete', await projectOf(item.projectCode));
    tx.delete(ref);
  });
}

/** A round file of an item, for whoever may view the drawing list. Only paths the item itself records. */
export async function readDrawingFile(context: MdlContext, itemId: string, path: string): Promise<{ bytes: Buffer; fileName: string; contentType: string }> {
  const snap = await itemsCol().doc(itemId).get();
  if (!snap.exists) throw new MdlError('This drawing item does not exist.', 404);
  const item = toItem(snap.id, snap.data() as DocumentData);
  context.require('Drawings', 'View', await projectOf(item.projectCode));
  const revision = [...item.revisions, ...item.subDrawings.flatMap((sub) => sub.revisions)].find((entry) => entry.filePath === path);
  if (!revision || !path.startsWith(filePrefix(item.projectCode, itemId))) throw new MdlError('This file is not on the drawing item.', 404);
  const [bytes] = await getFirebaseAdminBucket().file(path).download();
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return { bytes, fileName: revision.fileName || path.split('/').pop() || 'drawing', contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream' };
}

/* ── drawing lists ───────────────────────────────────────────────────────── */

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
    const project: MdlProject = { code: input.code, short: input.short, name: input.name, client: input.client, drgPrefix: input.drgPrefix, projectId: input.projectId };
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

