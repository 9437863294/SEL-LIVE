import 'server-only';

/**
 * Employee ↔ project links on the server (see ./links.ts): the Employee › Category screen's list,
 * save and source setting, and `employeeProjectIdsOf` for any screen that wants the signed-in
 * employee's projects.
 *
 * - The **source category** — which greytHR category says an employee's project ("Project Name"
 *   by default, "Project Division" or any other) — is `employeeProjectSettings/default`.
 * - **Links** live in `employeeProjectLinks`, one document per greytHR category value, keyed by
 *   that value's category document id and tagged with its category. Only the source category's
 *   links are used; the others are kept, so switching back restores them.
 *
 * Both collections are server-only in firestore.rules.
 */

import { z } from 'zod';

import { hasPermission, type PermissionSubject } from '@/lib/access-control';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { logServerActivity } from '@/lib/activity-logger-server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  EMPLOYEE_PROJECT_LINKS,
  EMPLOYEE_PROJECT_SETTINGS,
  GREYTHR_PROJECT_CATEGORY,
  employeeCategoryValue,
  linkCategory,
  linkedProjectIds,
  normaliseProjectName,
  suggestedProjectIds,
  type EmployeeProjectLink,
} from './links.ts';

const db = () => getFirebaseAdminFirestore();
const CACHE_TTL_MS = 30_000;
const SETTINGS_DOC = 'default';

/** A rule the caller broke; the message is shown as is. (Plain fields for strip-types.) */
export class ProjectLinkError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ProjectLinkError';
    this.status = status;
  }
}

export interface ProjectLinkActor {
  userId: string;
  userName: string;
  userEmail?: string | null;
  access: PermissionSubject;
}

/** Seeing the links: the category screen's own grant, or the project master's. */
export const canViewLinks = (subject: PermissionSubject) =>
  hasPermission(subject, 'Settings.Employee Management', 'View') || hasPermission(subject, 'Settings.Manage Project', 'View');
/** Changing them, and the source category: Edit on either. */
export const canEditLinks = (subject: PermissionSubject) =>
  hasPermission(subject, 'Settings.Employee Management', 'Edit') || hasPermission(subject, 'Settings.Manage Project', 'Edit');

function cached<T>(load: () => Promise<T>) {
  let entry: { at: number; value: Promise<T> } | null = null;
  return {
    get(): Promise<T> {
      if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
        const value = load();
        entry = { at: Date.now(), value };
        value.catch(() => {
          if (entry?.value === value) entry = null;
        });
      }
      return entry.value;
    },
    forget() {
      entry = null;
    },
  };
}

const linksCache = cached(async (): Promise<EmployeeProjectLink[]> => {
  const snapshot = await db().collection(EMPLOYEE_PROJECT_LINKS).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as EmployeeProjectLink), id: doc.id }));
});

const sourceCache = cached(async (): Promise<string> => {
  const snapshot = await db().collection(EMPLOYEE_PROJECT_SETTINGS).doc(SETTINGS_DOC).get();
  const stored = String(snapshot.data()?.sourceCategory ?? '').trim();
  return stored || GREYTHR_PROJECT_CATEGORY;
});

export const projectLinks = () => linksCache.get();
/** The greytHR category an employee's project comes from. */
export const projectSourceCategory = () => sourceCache.get();

const INACTIVE_PROJECT = /closed|complete|cancel|inactive|archiv/i;

interface ProjectRow {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

async function projectRows(): Promise<ProjectRow[]> {
  const snapshot = await db().collection('projects').get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return { id: doc.id, name: String(data.projectName || data.name || '').trim(), code: String(data.siteCode || '').trim(), active: !INACTIVE_PROJECT.test(String(data.status || '')) };
    })
    .filter((project) => project.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The app projects the signed-in person works on: login → greytHR employee → their value in the
 * source category → its links. Empty when any step is missing; never throws (a picker then offers
 * every project).
 */
export async function employeeProjectIdsOf(userId: string): Promise<string[]> {
  try {
    const user = await db().collection('users').doc(userId).get();
    const employeeId = String(user.data()?.employeeId ?? '').trim();
    if (!employeeId) return [];
    const [employee, links, source] = await Promise.all([db().collection('employees').doc(employeeId).get(), projectLinks(), projectSourceCategory()]);
    const value = employeeCategoryValue(employee.data() as Record<string, unknown> | undefined, source);
    if (!value || !links.length) return [];
    return linkedProjectIds(value, links, undefined, source);
  } catch (error) {
    console.error('[employee-projects] lookup failed', error instanceof Error ? error.message : error);
    return [];
  }
}

export interface ProjectLinkRow {
  id: string;
  valueId: string;
  name: string;
  /** Current employees holding this value. */
  employees: number;
  projectIds: string[];
  /** For an unlinked value: the projects its name plainly matches, offered as a link to accept. */
  suggestedIds: string[];
  updatedAt: string | null;
  updatedByName: string | null;
}

/**
 * One greytHR category's values and their links — the source category unless another is asked
 * for — with the source itself, for the Employee › Category screen.
 */
export async function projectLinksOverview(actor: ProjectLinkActor, requested?: string | null): Promise<{ category: string; sourceCategory: string; rows: ProjectLinkRow[]; projects: ProjectRow[]; canEdit: boolean }> {
  if (!canViewLinks(actor.access)) throw new ProjectLinkError('You need Settings · Employee Management · View.', 403);
  const sourceCategory = await projectSourceCategory();
  const category = String(requested ?? '').trim() || sourceCategory;
  const [values, links, projects, employees] = await Promise.all([
    db().collection('categories').where('type', '==', category).get(),
    projectLinks(),
    projectRows(),
    db().collection('employees').select('categories', 'projectName', 'projectDivision', 'status').get(),
  ]);
  const counts = new Map<string, number>();
  for (const doc of employees.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.status === 'Inactive') continue;
    const key = normaliseProjectName(employeeCategoryValue(data, category));
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const byId = new Map(links.filter((link) => linkCategory(link) === category).map((link) => [link.id, link]));
  const existing = new Set(projects.map((project) => project.id));
  const rows = values.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const link = byId.get(doc.id);
      const name = String(data.name ?? '').trim();
      const projectIds = (link?.projectIds ?? []).filter((id) => existing.has(id));
      return {
        id: doc.id,
        valueId: String(data.id ?? ''),
        name,
        employees: counts.get(normaliseProjectName(name)) ?? 0,
        projectIds,
        suggestedIds: projectIds.length ? [] : suggestedProjectIds(name, projects),
        updatedAt: link?.updatedAt ?? null,
        updatedByName: link?.updatedByName ?? null,
      };
    })
    .filter((row) => row.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { category, sourceCategory, rows, projects, canEdit: canEditLinks(actor.access) };
}

const linkSchema = z.object({ projectIds: z.array(z.string().trim().min(1).max(128)).max(25) });

export async function saveProjectLink(actor: ProjectLinkActor, valueDocId: string, body: unknown): Promise<{ row: Pick<ProjectLinkRow, 'id' | 'projectIds' | 'updatedAt' | 'updatedByName'> }> {
  if (!canEditLinks(actor.access)) throw new ProjectLinkError('You need Settings · Employee Management · Edit (or Manage Project · Edit) to link projects.', 403);
  const input = linkSchema.parse(body);
  const valueSnap = await db().collection('categories').doc(valueDocId).get();
  const value = valueSnap.data() as Record<string, unknown> | undefined;
  const categoryType = String(value?.type ?? '').trim();
  if (!valueSnap.exists || !categoryType) throw new ProjectLinkError('That greytHR category value was not found.', 404);
  const projects = await projectRows();
  const known = new Set(projects.map((project) => project.id));
  const projectIds = [...new Set(input.projectIds)];
  if (projectIds.some((id) => !known.has(id))) throw new ProjectLinkError('Some of those projects no longer exist in Settings › Projects.', 400);

  const ref = db().collection(EMPLOYEE_PROJECT_LINKS).doc(valueDocId);
  const before = (await ref.get()).data() as EmployeeProjectLink | undefined;
  const now = new Date().toISOString();
  const link: EmployeeProjectLink = {
    id: valueDocId,
    categoryType,
    valueId: String(value?.id ?? ''),
    valueName: String(value?.name ?? ''),
    projectIds,
    updatedAt: now,
    updatedById: actor.userId,
    updatedByName: actor.userName,
  };
  await ref.set(link);
  linksCache.forget();
  await logServerActivity({
    userId: actor.userId,
    userName: actor.userName,
    userEmail: actor.userEmail ?? undefined,
    module: ACTIVITY_MODULES.EMPLOYEE,
    action: 'Link greytHR Project',
    details: { category: categoryType, value: link.valueName, before: before?.projectIds ?? [], after: projectIds },
    recordId: valueDocId,
    recordRef: link.valueName,
    source: 'api',
  });
  return { row: { id: valueDocId, projectIds, updatedAt: now, updatedByName: actor.userName } };
}

/* ── the source category ── */

export async function projectSourceOverview(actor: ProjectLinkActor): Promise<{ sourceCategory: string; canEdit: boolean }> {
  if (!canViewLinks(actor.access)) throw new ProjectLinkError('You need Settings · Employee Management · View.', 403);
  return { sourceCategory: await projectSourceCategory(), canEdit: canEditLinks(actor.access) };
}

const sourceSchema = z.object({ sourceCategory: z.string().trim().min(1, 'Choose a greytHR category.').max(120) });

/** Switch which greytHR category employees' projects come from. Links of every category are kept. */
export async function saveProjectSource(actor: ProjectLinkActor, body: unknown): Promise<{ sourceCategory: string }> {
  if (!canEditLinks(actor.access)) throw new ProjectLinkError('You need Settings · Employee Management · Edit (or Manage Project · Edit) to change this.', 403);
  const { sourceCategory } = sourceSchema.parse(body);
  const exists = await db().collection('categories').where('type', '==', sourceCategory).limit(1).get();
  if (exists.empty) throw new ProjectLinkError(`greytHR has no category called "${sourceCategory}" mirrored here.`, 400);
  const ref = db().collection(EMPLOYEE_PROJECT_SETTINGS).doc(SETTINGS_DOC);
  const before = String((await ref.get()).data()?.sourceCategory ?? '') || GREYTHR_PROJECT_CATEGORY;
  await ref.set({ sourceCategory, updatedAt: new Date().toISOString(), updatedById: actor.userId, updatedByName: actor.userName });
  sourceCache.forget();
  await logServerActivity({
    userId: actor.userId,
    userName: actor.userName,
    userEmail: actor.userEmail ?? undefined,
    module: ACTIVITY_MODULES.EMPLOYEE,
    action: 'Set Employee Project Source',
    details: { before, after: sourceCategory },
    recordId: SETTINGS_DOC,
    recordRef: sourceCategory,
    source: 'api',
  });
  return { sourceCategory };
}
