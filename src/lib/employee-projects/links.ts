/**
 * Employee → project: which of the app's projects (Settings › Projects, `projects`) an employee
 * works on, from one of their greytHR categories ("Project Name" unless set otherwise).
 *
 * greytHR records each employee's project as a category value ("Infocity Tower", "HO"), mirrored
 * into `categories` and onto the employee record (`employees/{id}.categories`). Which greytHR
 * category that is, is a setting — "Project Name" by default, "Project Division" or any other on
 * Employee › Category — because tenants use them differently. The app's projects are a separate
 * master with their own ids. A **link** says which app project(s) one value of that category means —
 * set once per value, kept in `employeeProjectLinks` (not on the category document, which the
 * greytHR sync rewrites). Links are kept per category, so switching the source and back loses none.
 *
 * With the links in place, a screen that asks "which project?" can start from the employee's own:
 * Fleet Trip and the own-vehicle trip form list them first and pre-select a single one, and
 * Settings › Fleet can limit the choice to them.
 *
 * Pure: no imports, so the rules are tested under Node's type stripping.
 */

export const EMPLOYEE_PROJECT_LINKS = 'employeeProjectLinks';

/** The default greytHR category whose values are projects (GREYTHR_CATEGORY.projectName). */
export const GREYTHR_PROJECT_CATEGORY = 'Project Name';

/** Where the source category is kept: `employeeProjectSettings/default`. */
export const EMPLOYEE_PROJECT_SETTINGS = 'employeeProjectSettings';

export interface EmployeeProjectLink {
  /** `categoryDocId(category, valueId)` — the category value's own document id. */
  id: string;
  /** The greytHR category the value belongs to. Absent on the first links, which were Project Name. */
  categoryType?: string;
  valueId: string;
  valueName: string;
  projectIds: string[];
  updatedAt: string;
  updatedById: string;
  updatedByName: string;
}

/** The category a link belongs to. */
export const linkCategory = (link: Pick<EmployeeProjectLink, 'categoryType'>) => link.categoryType || GREYTHR_PROJECT_CATEGORY;

/**
 * An employee's value in a greytHR category. The record's resolved `categories` map first; the two
 * project fields the sync also writes stand in for a record synced before that map existed.
 */
export function employeeCategoryValue(employee: Record<string, unknown> | null | undefined, category: string): string {
  if (!employee) return '';
  const categories = (employee.categories ?? {}) as Record<string, unknown>;
  const fromMap = categories[category];
  if (typeof fromMap === 'string' && fromMap.trim()) return fromMap.trim();
  if (category === 'Project Name') return String(employee.projectName ?? '').trim();
  if (category === 'Project Division') return String(employee.projectDivision ?? '').trim();
  return '';
}

/** Names compared the way people type them: case, spacing and punctuation runs ignored. */
export const normaliseProjectName = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The app projects an employee's greytHR project value links to, keeping only projects that still
 * exist (and are active, when `activeIds` is given). Matched by the value's name, because that is
 * what the employee record carries.
 */
export function linkedProjectIds(
  employeeValue: string | null | undefined,
  links: readonly Pick<EmployeeProjectLink, 'valueName' | 'projectIds' | 'categoryType'>[],
  activeIds?: ReadonlySet<string>,
  category: string = GREYTHR_PROJECT_CATEGORY,
): string[] {
  const wanted = normaliseProjectName(employeeValue);
  if (!wanted) return [];
  const ids = new Set<string>();
  for (const link of links) {
    // Only the source category's links: a Project Division value never answers for Project Name.
    if (linkCategory(link) !== category) continue;
    if (normaliseProjectName(link.valueName) !== wanted) continue;
    for (const id of link.projectIds) if (!activeIds || activeIds.has(id)) ids.add(id);
  }
  return [...ids];
}

/**
 * A project picker's options for one employee: their own projects first, marked, the rest after —
 * or only their own when the setting says so and they have any (an employee with no linked project
 * is never left with an empty list). `preselect` is their project when they have exactly one.
 */
export function projectChoices<T extends { id: string }>(projects: readonly T[], mine: readonly string[], onlyMine: boolean): { options: Array<T & { mine: boolean }>; preselect: string | null; restricted: boolean } {
  const own = new Set(mine);
  const ownOptions = projects.filter((project) => own.has(project.id)).map((project) => ({ ...project, mine: true }));
  const restricted = onlyMine && ownOptions.length > 0;
  const rest = restricted ? [] : projects.filter((project) => !own.has(project.id)).map((project) => ({ ...project, mine: false }));
  return { options: [...ownOptions, ...rest], preselect: ownOptions.length === 1 ? ownOptions[0].id : null, restricted };
}

/** A picker's heading for an option from `projectChoices`: the employee's own listed apart, when they have any. */
export const projectGroup = (mine: boolean, anyMine: boolean): string | undefined => (anyMine ? (mine ? 'Your projects' : 'Other projects') : undefined);

/**
 * The app projects a greytHR value plainly names — the same name or site code once case, spacing
 * and punctuation are ignored ("BOUDH-PHULBANI" and "Boudh Phulbani"). Offered on Employee ›
 * Category as a link to accept, never applied by itself: "Head Office" and "HO" are the same place
 * to a person and nothing alike to a comparison, so the admin decides.
 */
export function suggestedProjectIds(valueName: string, projects: readonly { id: string; name: string; code?: string }[]): string[] {
  const wanted = normaliseProjectName(valueName);
  if (!wanted) return [];
  return projects.filter((project) => normaliseProjectName(project.name) === wanted || (project.code && normaliseProjectName(project.code) === wanted)).map((project) => project.id);
}

/** May this employee pick this project? Always, unless their choice is limited and it is not theirs. */
export function projectAllowed(projectId: string | null, mine: readonly string[], onlyMine: boolean): boolean {
  if (!projectId || !onlyMine || !mine.length) return true;
  return mine.includes(projectId);
}
