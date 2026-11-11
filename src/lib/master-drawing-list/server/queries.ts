import 'server-only';

/**
 * What each Master Drawing List screen loads, shaped on the server: the lookups the module frame
 * needs, a project's register, one item with the steps the caller may take, the pending lists and
 * the dashboard figures.
 */

import { MDL_ACTIONS, type MdlResource } from '../access.ts';
import { existingGroups, nextNumbers, pendingLists, summarise, type PendingLists, type ProjectSummary } from '../register.ts';
import { availableSteps, STEP_LABEL, type MdlStep } from '../steps.ts';
import { SCHEDULES, SCOPES, type MdlItem, type MdlSchedule, type MdlScope } from '../types.ts';
import type { MdlContext } from './context.ts';
import { MdlError } from './context.ts';
import { allProjectViews, erpProjects, itemFor, listItems, listItemsOf, listProjects, projectFor, type MdlProjectView } from './store.ts';

export interface MdlLookups {
  projects: MdlProjectView[];
  /** The actions the caller holds — unscoped, or on at least one drawing list they can see. */
  permissions: Record<MdlResource, string[]>;
  allProjects: boolean;
  today: string;
  user: { id: string; name: string };
}

export async function lookups(context: MdlContext): Promise<MdlLookups> {
  const projects = await listProjects(context);
  const permissions = Object.fromEntries(
    (Object.keys(MDL_ACTIONS) as MdlResource[]).map((resource) => [
      resource,
      MDL_ACTIONS[resource].filter((action) => context.can(resource, action) || projects.some((project) => context.can(resource, action, project))),
    ]),
  ) as Record<MdlResource, string[]>;
  return { projects, permissions, allProjects: context.allProjects, today: context.today, user: { id: context.userId, name: context.userName } };
}

export async function register(context: MdlContext, projectCode: string): Promise<{ project: MdlProjectView; items: MdlItem[]; today: string }> {
  const project = await projectFor(context, projectCode);
  context.require('Drawings', 'View', project);
  return { project, items: await listItems(project.code), today: context.today };
}

export interface ItemView {
  item: MdlItem;
  project: MdlProjectView;
  /** The steps the item allows *and* the caller may take, likeliest first. */
  steps: { step: MdlStep; label: string }[];
  canEdit: boolean;
  today: string;
}

export async function itemView(context: MdlContext, itemId: string): Promise<ItemView> {
  const { item, project } = await itemFor(context, itemId);
  context.require('Drawings', 'View', project);
  const steps = availableSteps(item)
    .filter((step) => context.can(step === 'approval' ? 'Approval' : 'Submissions', 'Record', project))
    .map((step) => ({ step, label: STEP_LABEL[step] }));
  return { item, project, steps, canEdit: context.can('Drawings', 'Edit', project), today: context.today };
}

/** The drawing lists a cross-project screen covers: one (`?project=`) or every one in scope the caller may view. */
async function viewableProjects(context: MdlContext, projectCode: string | null): Promise<MdlProjectView[]> {
  if (projectCode) {
    const project = await projectFor(context, projectCode);
    context.require('Drawings', 'View', project);
    return [project];
  }
  return (await listProjects(context)).filter((project) => context.can('Drawings', 'View', project));
}

export async function pending(context: MdlContext, projectCode: string | null): Promise<{ projects: MdlProjectView[]; lists: PendingLists; today: string }> {
  const projects = await viewableProjects(context, projectCode);
  const items = projects.length ? await listItemsOf(projects.map((project) => project.code)) : [];
  return { projects, lists: pendingLists(items, context.today), today: context.today };
}

export interface DashboardData {
  today: string;
  projects: { project: MdlProjectView; summary: ProjectSummary }[];
  total: ProjectSummary;
}

export async function dashboard(context: MdlContext): Promise<DashboardData> {
  const projects = await viewableProjects(context, null);
  const items = projects.length ? await listItemsOf(projects.map((project) => project.code)) : [];
  return {
    today: context.today,
    projects: projects.map((project) => ({ project, summary: summarise(project.code, items.filter((item) => item.projectCode === project.code), context.today) })),
    total: summarise('all', items, context.today),
  };
}

/** For Add drawing item: the project's groups to suggest, and the Sl. No. each schedule and scope gets next. */
export async function groupsFor(context: MdlContext, projectCode: string): Promise<{ groups: ReturnType<typeof existingGroups>; nextSlNo: Record<string, string> }> {
  const project = await projectFor(context, projectCode);
  context.require('Drawings', 'Add', project);
  const items = await listItems(project.code);
  const nextSlNo: Record<string, string> = {};
  for (const schedule of SCHEDULES as readonly MdlSchedule[]) {
    for (const scope of SCOPES as readonly MdlScope[]) nextSlNo[`${schedule}|${scope}`] = nextNumbers(items, schedule, scope).slNo;
  }
  return { groups: existingGroups(items), nextSlNo };
}

/** Settings › Projects: every drawing list with its link, and the ERP projects to link to. */
export async function settingsProjects(context: MdlContext) {
  context.require('Settings', 'View');
  const [projects, erp] = await Promise.all([allProjectViews(), erpProjects()]);
  return { projects, erpProjects: erp, canManage: context.can('Settings', 'Manage') };
}

export function stepOf(value: string): MdlStep {
  if (value === 'submission' || value === 'comments' || value === 'approval') return value;
  throw new MdlError('Unknown step.', 404);
}
