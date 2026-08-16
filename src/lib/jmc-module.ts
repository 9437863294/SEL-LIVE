/**
 * Project Management's host contract for the JMC screens.
 *
 * The Joint Measurement Certificate screens now exist in two places and both stay live: their
 * original home in Billing Recon (routed by a `[project]` slug) and here under Project Management
 * (routed by `?project={mappingId}`, this module's convention everywhere else). Both read and
 * write the SAME `projects/{projectId}/jmcEntries` documents through the SAME global
 * `workflows/jmc-workflow` state machine — they are one register with two doors, not two systems.
 *
 * The Billing Recon pages are deliberately left untouched. This module holds only what the Project
 * Management copies need in order to differ correctly:
 *   - the permission resource that gates them here,
 *   - the module name their activity-log rows carry,
 *   - how a route identifies its project, and
 *   - how links between the JMC screens are built.
 *
 * Pure (no Firebase, no React) so the link and slug rules stay unit-testable.
 */

export const PM_JMC_PERMISSION_RESOURCE = "Project Management.JMC";
export const PM_JMC_ACTIVITY_MODULE = "Project Management";
export const PM_JMC_BASE_PATH = "/project-management/jmc";

/** The project shape resolution needs — only these fields are read. */
export interface JmcHostProject {
  id: string;
  projectName?: string;
}

export interface PmJmcContext {
  /** `projectManagementProjects` document id, from `?project=`. */
  mappingId: string;
  /** The mapped global project — the id every `projects/{id}/...` read is scoped by. Empty until
   * the mapping doc has been read. */
  globalProjectId: string;
  permissionResource: string;
  activityModule: string;
  /**
   * Picks this route's project out of the full `projects` collection. The JMC screens already
   * download that collection to populate their project switcher, so this is a pure selection over
   * data they hold — it costs no extra read. Returns null until `globalProjectId` is known, which
   * the screens render as their "select a project" state rather than defaulting to another project.
   */
  resolveProject: (projects: JmcHostProject[]) => JmcHostProject | null;
  /**
   * Link to a JMC screen, carrying the mapping id forward: `jmcHref()` is the hub,
   * `jmcHref("entry")`, `jmcHref("log")`, `jmcHref("settings/workflow-configuration")`,
   * ``jmcHref(`stage/${stepId}`)`` the rest. Returns "#" with no mapping id, which the cards
   * already render as disabled.
   */
  jmcHref: (suffix?: string) => string;
  /** Where the back arrow goes — the Civil execution workspace that owns this lane. */
  parentHref: string;
}

/**
 * Billing Recon's slug rule: lowercase, spaces to hyphens, strip non-word characters.
 *
 * Deliberately does NOT trim, matching the implementation Billing Recon's layout and data-fetching
 * pages actually use — that is what every live URL and every stored serial-config id was built
 * with. A trimming variant would hash " Acme " to "acme" instead of "-acme-" and silently fail to
 * match existing documents.
 */
export const jmcSlugify = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");

/**
 * The `billingReconSerialConfigs` document a JMC number is drawn from. Unchanged from Billing
 * Recon — including scope2 preceding scope1 — so a certificate raised from Project Management
 * continues the same numbering sequence as one raised from Billing Recon.
 */
export const jmcSerialConfigId = (
  projectId: string,
  scope1: string,
  scope2: string,
): string => `${projectId}_${jmcSlugify(scope2)}_${jmcSlugify(scope1)}`;

export function projectManagementJmcContext(
  mappingId: string,
  globalProjectId: string,
): PmJmcContext {
  const query = mappingId ? `?project=${encodeURIComponent(mappingId)}` : "";
  return {
    mappingId,
    globalProjectId,
    permissionResource: PM_JMC_PERMISSION_RESOURCE,
    activityModule: PM_JMC_ACTIVITY_MODULE,
    resolveProject: (projects) =>
      globalProjectId
        ? (projects.find((project) => project.id === globalProjectId) ?? null)
        : null,
    jmcHref: (suffix) =>
      mappingId ? `${suffix ? `${PM_JMC_BASE_PATH}/${suffix}` : PM_JMC_BASE_PATH}${query}` : "#",
    parentHref: mappingId ? `/project-management/civil${query}` : "#",
  };
}
