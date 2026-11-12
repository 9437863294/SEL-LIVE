import 'server-only';

/**
 * Master Drawing List reads, through the ERP's Admin SDK Firestore. Every list is narrowed to the
 * caller's scope here, so a route cannot return a drawing list the caller may not see.
 */

import type { DocumentData } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';

import { emptyRevisions, type DrawingItem, type DrawingRevision, type OverallStatus, type SubDrawing } from '../drawings.ts';
import { COLLECTIONS, type MdlProject } from '../types.ts';
import { MdlError, type MdlContext } from './context.ts';

export const db = () => getFirebaseAdminFirestore();
export const itemsCol = () => db().collection(COLLECTIONS.items);
export const projectsCol = () => db().collection(COLLECTIONS.projects);

/** A drawing list as the screens show it: its own record plus the linked ERP project's name and client. */
export interface MdlProjectView extends MdlProject {
  projectId: string | null;
  /** The linked ERP project's name, else the drawing list's own. */
  displayName: string;
  /** The linked ERP project's client, else the drawing list's own. */
  displayClient: string | null;
  /** Set when `projectId` names an ERP project that no longer exists. */
  linkMissing?: boolean;
}

/** A Firestore timestamp (or the test double's ISO string) as an ISO string. */
function isoOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate().toISOString();
  return null;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function toRevisions(value: unknown): DrawingRevision[] {
  if (!Array.isArray(value) || !value.length) return emptyRevisions();
  return value.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const revision: DrawingRevision = { round: str(r.round) as DrawingRevision['round'], submissionDate: str(r.submissionDate), comments: str(r.comments), commentsDate: str(r.commentsDate) };
    if (r.status) revision.status = str(r.status) as DrawingRevision['status'];
    if (r.fileName) revision.fileName = str(r.fileName);
    if (r.filePath) revision.filePath = str(r.filePath);
    return revision;
  });
}

function toSub(raw: unknown): SubDrawing {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(d.id),
    title: str(d.title),
    docNo: str(d.docNo),
    drawingNo: str(d.drawingNo),
    plannedStartDate: str(d.plannedStartDate),
    plannedEndDate: str(d.plannedEndDate),
    revisions: toRevisions(d.revisions),
    approveDate: str(d.approveDate),
    status: (str(d.status) || 'Pending') as OverallStatus,
    remark: str(d.remark),
    ...(d.firstSubmittedOn ? { firstSubmittedOn: str(d.firstSubmittedOn) } : {}),
    ...(d.assignedToId ? { assignedToId: str(d.assignedToId), assignedToName: str(d.assignedToName) } : {}),
    ...(d.createdAt ? { createdAt: str(d.createdAt), createdBy: str(d.createdBy), createdByName: str(d.createdByName) } : {}),
    ...(d.updatedAt ? { updatedAt: str(d.updatedAt), updatedBy: str(d.updatedBy), updatedByName: str(d.updatedByName) } : {}),
  };
}

/** Firestore document to the plain object the screens receive, with every field present. */
export function toItem(id: string, data: DocumentData): DrawingItem {
  return {
    id,
    projectCode: str(data.projectCode),
    schedule: data.schedule,
    scope: data.scope,
    group: typeof data.group === 'string' && data.group ? data.group : null,
    order: typeof data.order === 'number' ? data.order : 0,
    slNo: str(data.slNo),
    description: str(data.description),
    docNo: str(data.docNo),
    drawingNo: str(data.drawingNo),
    plannedStartDate: str(data.plannedStartDate),
    plannedEndDate: str(data.plannedEndDate),
    revisions: toRevisions(data.revisions),
    approveDate: str(data.approveDate),
    status: (str(data.status) || 'Pending') as OverallStatus,
    remark: str(data.remark),
    ...(data.firstSubmittedOn ? { firstSubmittedOn: str(data.firstSubmittedOn) } : {}),
    subDrawings: Array.isArray(data.subDrawings) ? data.subDrawings.map(toSub) : [],
    legacy: data.legacy ?? null,
    createdAt: isoOf(data.createdAt),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : null,
    updatedAt: isoOf(data.updatedAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    updatedByName: typeof data.updatedByName === 'string' ? data.updatedByName : null,
  };
}

function toProject(data: DocumentData): MdlProject {
  return {
    code: String(data.code),
    short: String(data.short ?? data.code),
    name: String(data.name ?? data.short ?? data.code),
    client: typeof data.client === 'string' ? data.client : null,
    drgPrefix: typeof data.drgPrefix === 'string' ? data.drgPrefix : null,
    projectId: typeof data.projectId === 'string' && data.projectId ? data.projectId : null,
  };
}

/** Adds the linked ERP projects' names and clients. */
async function withErpNames(projects: MdlProject[]): Promise<MdlProjectView[]> {
  const ids = [...new Set(projects.map((project) => project.projectId).filter((id): id is string => Boolean(id)))];
  const erp = new Map<string, DocumentData>();
  if (ids.length) {
    const snaps = await db().getAll(...ids.map((id) => db().collection('projects').doc(id)));
    for (const snap of snaps) if (snap.exists) erp.set(snap.id, snap.data() as DocumentData);
  }
  return projects.map((project) => {
    const linked = project.projectId ? erp.get(project.projectId) : undefined;
    const name = typeof linked?.projectName === 'string' && linked.projectName.trim() ? linked.projectName.trim() : null;
    const client = typeof linked?.clientName === 'string' && linked.clientName.trim() ? linked.clientName.trim() : null;
    return {
      ...project,
      projectId: project.projectId ?? null,
      displayName: name ?? project.name,
      displayClient: client ?? project.client,
      ...(project.projectId && !linked ? { linkMissing: true } : {}),
    };
  });
}

/** Every drawing list, whatever the caller's scope — for the scope check itself and Settings. */
export async function allProjects(): Promise<MdlProject[]> {
  const snap = await projectsCol().get();
  return snap.docs.map((doc) => toProject({ code: doc.id, ...doc.data() })).sort((a, b) => a.short.localeCompare(b.short));
}

/** The drawing lists the caller may see, by short name. */
export async function listProjects(context: MdlContext): Promise<MdlProjectView[]> {
  return withErpNames((await allProjects()).filter((project) => context.inScope(project)));
}

export async function allProjectViews(): Promise<MdlProjectView[]> {
  return withErpNames(await allProjects());
}

/** One drawing list, refused with 404 when it does not exist and 403 when it is outside the caller's scope. */
export async function projectFor(context: MdlContext, code: string): Promise<MdlProjectView> {
  const snap = await projectsCol().doc(code).get();
  if (!snap.exists) throw new MdlError('This drawing list does not exist.', 404);
  const project = toProject({ code: snap.id, ...snap.data() });
  context.requireProject(project);
  return (await withErpNames([project]))[0];
}

/** A project's items in register order. */
export async function listItems(projectCode: string): Promise<DrawingItem[]> {
  const snap = await itemsCol().where('projectCode', '==', projectCode).get();
  return snap.docs.map((doc) => toItem(doc.id, doc.data())).sort((a, b) => a.order - b.order);
}

/** Items of several projects (Firestore takes up to 30 values per `in`). */
export async function listItemsOf(projectCodes: string[]): Promise<DrawingItem[]> {
  const out: DrawingItem[] = [];
  for (let index = 0; index < projectCodes.length; index += 30) {
    const chunk = projectCodes.slice(index, index + 30);
    const snap = await itemsCol().where('projectCode', 'in', chunk).get();
    out.push(...snap.docs.map((doc) => toItem(doc.id, doc.data())));
  }
  return out.sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.order - b.order);
}

/** One item with its drawing list; 404 when missing, 403 outside the caller's scope. */
export async function itemFor(context: MdlContext, itemId: string): Promise<{ item: DrawingItem; project: MdlProjectView }> {
  const snap = await itemsCol().doc(itemId).get();
  if (!snap.exists) throw new MdlError('This drawing item does not exist.', 404);
  const item = toItem(snap.id, snap.data() as DocumentData);
  const project = await projectFor(context, item.projectCode);
  return { item, project };
}

/** ERP projects for the Settings pickers: id, name, site code and client, active first. */
export async function erpProjects(): Promise<{ id: string; name: string; siteCode: string | null; clientName: string | null; status: string | null }[]> {
  const snap = await db().collection('projects').get();
  return snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: typeof data.projectName === 'string' && data.projectName.trim() ? data.projectName.trim() : doc.id,
        siteCode: typeof data.siteCode === 'string' && data.siteCode.trim() ? data.siteCode.trim() : null,
        clientName: typeof data.clientName === 'string' && data.clientName.trim() ? data.clientName.trim() : null,
        status: typeof data.status === 'string' ? data.status : null,
      };
    })
    .sort((a, b) => Number(a.status === 'Inactive') - Number(b.status === 'Inactive') || a.name.localeCompare(b.name));
}
