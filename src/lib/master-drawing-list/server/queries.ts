import 'server-only';

/**
 * What the Master Drawing List screens load, shaped on the server: the lookups the module frame
 * needs, a project's register (every view — Reports, Pending Tasks, Register, Calendar, Gantt — is
 * worked out from it in the browser, as Project Management's are), the groups to suggest for a new
 * item, and the Settings page's projects.
 */

import { MDL_ACTIONS, type MdlResource } from '../access.ts';
import type { DrawingItem } from '../drawings.ts';
import { existingGroups, nextNumbers } from '../register.ts';
import { SCHEDULES, SCOPES, type MdlSchedule, type MdlScope } from '../types.ts';
import type { MdlContext } from './context.ts';
import { allProjectViews, erpProjects, listItems, listProjects, projectFor, type MdlProjectView } from './store.ts';

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

export interface RegisterData {
  project: MdlProjectView;
  items: DrawingItem[];
  today: string;
  /** What the caller may do on this drawing list. Assignees may also update their own sub-drawings. */
  can: { add: boolean; edit: boolean; delete: boolean; export: boolean };
}

export async function register(context: MdlContext, projectCode: string): Promise<RegisterData> {
  const project = await projectFor(context, projectCode);
  context.require('Drawings', 'View', project);
  return {
    project,
    items: await listItems(project.code),
    today: context.today,
    can: {
      add: context.can('Drawings', 'Add', project),
      edit: context.can('Drawings', 'Edit', project),
      delete: context.can('Drawings', 'Delete', project),
      export: context.can('Drawings', 'Export', project),
    },
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
