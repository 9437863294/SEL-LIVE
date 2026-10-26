/**
 * Projects and their sub-division sites — the rules behind Settings › Projects.
 *
 * A project is often executed at several places at once: line sections, substations, work fronts.
 * Each is a sub-division site with its own code, location and in-charge. They live as an array on
 * the project document (`projects/{id}.subdivisions`) rather than in a subcollection, so every
 * module that already loads `projects` sees them without another read, and a project's sites are
 * read and written together.
 *
 * Writes go through a transaction that re-reads the array and applies one change to it
 * (`upsertSubdivision` / `removeSubdivision`), and editing the project itself never sends the
 * array (`projectPayload`) — so two people editing the same project cannot overwrite each other's
 * sites.
 *
 * Pure: no Firebase, no React. Tested by tests/project-subdivisions.test.mjs.
 */

import type { Project, ProjectSubdivision } from './types';

export type ProjectStatus = 'Active' | 'Inactive';

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['Active', 'Inactive'];

/** What older records store when nobody is in charge. Shown as empty, written for compatibility. */
export const NO_IN_CHARGE = 'N/A';

/** A rule the user broke — the message is meant for them, unlike a network or permission error. */
export class ProjectRuleError extends Error {
  name = 'ProjectRuleError';
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const same = (a: string | undefined, b: string | undefined) => clean(a).toLowerCase() === clean(b).toLowerCase();
const asStatus = (value: unknown): ProjectStatus => (value === 'Inactive' ? 'Inactive' : 'Active');

/** The in-charge to display: empty for none, whether stored as blank or as the legacy "N/A". */
export function inChargeLabel(value: string | undefined): string {
  const name = clean(value);
  return name.toUpperCase() === NO_IN_CHARGE ? '' : name;
}

/* ── Sub-division sites ──────────────────────────────────────────────────────────────────────── */

/** A project's sites, skipping anything malformed so one bad entry cannot break the page. */
export function subdivisionsOf(project: Pick<Project, 'subdivisions'> | undefined | null): ProjectSubdivision[] {
  const list = project?.subdivisions;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (site): site is ProjectSubdivision =>
      !!site && typeof site === 'object' && typeof site.id === 'string' && site.id !== '' && typeof site.name === 'string',
  );
}

export interface SubdivisionFormValues {
  name: string;
  code: string;
  location: string;
  siteInCharge: string;
  status: ProjectStatus;
}

export const EMPTY_SUBDIVISION_FORM: SubdivisionFormValues = {
  name: '',
  code: '',
  location: '',
  siteInCharge: '',
  status: 'Active',
};

export function subdivisionFormFrom(site: ProjectSubdivision): SubdivisionFormValues {
  return {
    name: site.name ?? '',
    code: site.code ?? '',
    location: site.location ?? '',
    siteInCharge: inChargeLabel(site.siteInCharge),
    status: asStatus(site.status),
  };
}

/** An id that is unique among `existing`; short because it only has to be unique in one project. */
export function newSubdivisionId(existing: readonly ProjectSubdivision[], random: () => number = Math.random): string {
  const taken = new Set(existing.map((site) => site.id));
  for (;;) {
    const id = `sd_${Date.now().toString(36)}${Math.floor(random() * 1e8).toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * The stored site from a form: trimmed, and with empty optional fields left out — Firestore
 * rejects `undefined`, and an absent field reads the same as an empty one everywhere.
 */
export function buildSubdivision(form: SubdivisionFormValues, id: string): ProjectSubdivision {
  const site: ProjectSubdivision = { id, name: clean(form.name), status: asStatus(form.status) };
  const code = clean(form.code);
  const location = clean(form.location);
  const siteInCharge = inChargeLabel(form.siteInCharge);
  if (code) site.code = code;
  if (location) site.location = location;
  if (siteInCharge) site.siteInCharge = siteInCharge;
  return site;
}

/** Why `site` cannot be saved alongside `siblings` (its own earlier copy is ignored), or null. */
export function validateSubdivision(site: ProjectSubdivision, siblings: readonly ProjectSubdivision[]): string | null {
  if (!clean(site.name)) return 'Enter the site name.';
  const others = siblings.filter((other) => other.id !== site.id);
  if (others.some((other) => same(other.name, site.name))) {
    return `This project already has a site called "${clean(site.name)}".`;
  }
  if (clean(site.code) && others.some((other) => same(other.code, site.code))) {
    return `Site code "${clean(site.code)}" is already used by another site of this project.`;
  }
  return null;
}

/** Adds the site, or replaces the one with its id in place. Throws when the rules forbid it. */
export function upsertSubdivision(list: readonly ProjectSubdivision[], site: ProjectSubdivision): ProjectSubdivision[] {
  const error = validateSubdivision(site, list);
  if (error) throw new ProjectRuleError(error);
  const index = list.findIndex((other) => other.id === site.id);
  if (index === -1) return [...list, site];
  const next = [...list];
  next[index] = site;
  return next;
}

export function removeSubdivision(list: readonly ProjectSubdivision[], id: string): ProjectSubdivision[] {
  return list.filter((site) => site.id !== id);
}

/**
 * A code for the next site: the project's code with a two-digit suffix ("SEL-001-03"), skipping
 * suffixes already taken. Empty when the project has no code to build on.
 */
export function suggestSubdivisionCode(project: Pick<Project, 'siteCode' | 'subdivisions'>): string {
  const base = clean(project.siteCode);
  if (!base) return '';
  const taken = new Set(subdivisionsOf(project).map((site) => clean(site.code).toLowerCase()));
  for (let n = 1; ; n += 1) {
    const code = `${base}-${String(n).padStart(2, '0')}`;
    if (!taken.has(code.toLowerCase())) return code;
  }
}

/* ── Projects ────────────────────────────────────────────────────────────────────────────────── */

export interface ProjectFormValues {
  projectName: string;
  siteCode: string;
  projectSite: string;
  projectDivision: string;
  location: string;
  siteInCharge: string;
  status: ProjectStatus;
  projectDescription: string;
}

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
  projectName: '',
  siteCode: '',
  projectSite: '',
  projectDivision: '',
  location: '',
  siteInCharge: '',
  status: 'Active',
  projectDescription: '',
};

export function projectFormFrom(project: Project): ProjectFormValues {
  return {
    projectName: project.projectName ?? '',
    siteCode: project.siteCode ?? '',
    projectSite: project.projectSite ?? '',
    projectDivision: project.projectDivision ?? '',
    location: project.location ?? '',
    siteInCharge: inChargeLabel(project.siteInCharge),
    status: asStatus(project.status),
    projectDescription: project.projectDescription ?? '',
  };
}

/**
 * The fields this page owns, ready to write. Never includes `subdivisions` (they have their own
 * transaction) or the fields other modules keep on the project — signatures, billing flags,
 * client linkage — so saving here cannot undo their changes.
 */
export function projectPayload(form: ProjectFormValues): ProjectFormValues {
  return {
    projectName: clean(form.projectName),
    siteCode: clean(form.siteCode),
    projectSite: clean(form.projectSite),
    projectDivision: clean(form.projectDivision),
    location: clean(form.location),
    // Other modules print `siteInCharge || 'N/A'`; storing the legacy value keeps old readers right.
    siteInCharge: inChargeLabel(form.siteInCharge) || NO_IN_CHARGE,
    status: asStatus(form.status),
    projectDescription: clean(form.projectDescription),
  };
}

/**
 * Why the project cannot be saved, or null. Name and site code must be unique — but only checked
 * when they change, so an older pair of duplicates does not block editing either record.
 */
export function validateProject(
  form: ProjectFormValues,
  projects: readonly Project[],
  original?: Project | null,
): string | null {
  const name = clean(form.projectName);
  const code = clean(form.siteCode);
  if (!name) return 'Enter the project name.';
  const others = projects.filter((project) => project.id !== original?.id);
  if (!(original && same(original.projectName, name)) && others.some((project) => same(project.projectName, name))) {
    return `A project called "${name}" already exists.`;
  }
  if (code && !(original && same(original.siteCode, code)) && others.some((project) => same(project.siteCode, code))) {
    return `Site code "${code}" is already used by another project.`;
  }
  return null;
}

/* ── The register ────────────────────────────────────────────────────────────────────────────── */

export interface ProjectSummary {
  total: number;
  active: number;
  inactive: number;
  sites: number;
  activeSites: number;
  withoutSites: number;
}

export function summariseProjects(projects: readonly Project[]): ProjectSummary {
  const summary: ProjectSummary = { total: 0, active: 0, inactive: 0, sites: 0, activeSites: 0, withoutSites: 0 };
  for (const project of projects) {
    const sites = subdivisionsOf(project);
    summary.total += 1;
    if (asStatus(project.status) === 'Active') summary.active += 1;
    else summary.inactive += 1;
    summary.sites += sites.length;
    summary.activeSites += sites.filter((site) => asStatus(site.status) === 'Active').length;
    if (sites.length === 0) summary.withoutSites += 1;
  }
  return summary;
}

const projectText = (project: Project) =>
  [project.projectName, project.siteCode, project.projectSite, project.projectDivision, project.location, inChargeLabel(project.siteInCharge)]
    .join(' ')
    .toLowerCase();

const siteText = (site: ProjectSubdivision) =>
  [site.name, site.code, site.location, inChargeLabel(site.siteInCharge)].join(' ').toLowerCase();

export interface ProjectMatch {
  matched: boolean;
  /** Sites the search found on their own — the page opens the project to show them. */
  siteIds: string[];
}

/**
 * Whether a search finds this project. Every word must appear, in the project's fields or in one
 * of its sites — so "kurnool" finds the project that has a Kurnool site, and "nh44 kurnool" finds
 * the NH-44 project's Kurnool site.
 */
export function matchProject(project: Project, query: string): ProjectMatch {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { matched: true, siteIds: [] };
  const hasAll = (text: string) => words.every((word) => text.includes(word));
  const own = projectText(project);
  const sites = subdivisionsOf(project);
  const siteIds = sites.filter((site) => hasAll(siteText(site))).map((site) => site.id);
  const matched = hasAll(own) || siteIds.length > 0 || sites.some((site) => hasAll(`${own} ${siteText(site)}`));
  return { matched, siteIds };
}
