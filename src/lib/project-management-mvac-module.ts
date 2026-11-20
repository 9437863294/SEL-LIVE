/**
 * MVAC as a module: where its screens live, what they answer to, and which workflow governs them.
 *
 * MVAC used to be two pages hanging off the Supply hub — a register and a create form — sharing
 * the implementation of MDCC, DI and GRN. It is now a module of its own, because unlike those
 * three it is a *certificate*: it is raised, it travels a configured run of desks, and someone
 * signs it. That is the JMC shape, and this is the handful of constants the JMC module keeps in
 * `jmc-module.ts`.
 *
 * The one decision worth recording: **MVAC has its own workflow document**, not Billing Recon's
 * `mvac-workflow`. Billing Recon's MVAC is a civil measurement certificate over BOQ lines; this
 * one is a joint acceptance of delivered material over purchase-order lines. Two different
 * registers sharing one workflow definition has already caused a live incident here — see the
 * note at the top of `billing-recon/register.ts` — so they stay apart.
 *
 * Pure — no Firebase, no React.
 */

import type { WorkflowStep } from "./types";

export const PM_MVAC_BASE_PATH = "/project-management/mvac";

/** Where the module sits in Project Management, for the back arrow and the first crumb. */
export const PM_MVAC_PARENT_PATH = "/project-management/supply";

export const PM_MVAC_PERMISSION_RESOURCE = "Project Management.MVAC";

/** The configured run. Deliberately not Billing Recon's `mvac-workflow`. */
export const PM_MVAC_WORKFLOW_ID = "pm-mvac-workflow";

/**
 * The actions a step may offer.
 *
 * `Record Acceptance` is MVAC's own: it opens the decision dialog that writes accepted and
 * rejected quantity per line. The rest are the generic ones JMC's workflow also offers, and the
 * three that complete a step — Approve, Complete, Verified — are what
 * `workflow-run-position.ts` reads to decide where a certificate sits.
 */
export const PM_MVAC_WORKFLOW_ACTIONS: readonly string[] = [
  "Approve",
  "Reject",
  "Needs Correction",
  "Record Acceptance",
  "Complete",
  "Verified",
];

/** The action that opens the accepted-quantity dialog rather than advancing the certificate. */
export const PM_MVAC_RECORD_ACTION = "Record Acceptance";

/**
 * The steps a site gets before anybody configures the run.
 *
 * Offered by the settings screen as a starting point, never written on its behalf: an installation
 * that has configured nothing should see "no workflow configured" and keep today's behaviour,
 * where a certificate is raised and signed off on the register.
 */
export const PM_MVAC_DEFAULT_STEPS: WorkflowStep[] = [
  {
    id: "1",
    name: "Site Verification",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject", "Needs Correction", "Record Acceptance"],
    upload: "Optional",
  },
  {
    id: "2",
    name: "Client Joint Acceptance",
    tat: 48,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Complete", "Reject"],
    upload: "Required",
  },
];

/** A link to an MVAC screen, carrying the project on. Mirrors `jmcTabHref`. */
export const mvacTabHref = (path: string, mappingId: string): string => {
  if (!mappingId) return "#";
  const base = path ? `${PM_MVAC_BASE_PATH}/${path}` : PM_MVAC_BASE_PATH;
  return `${base}?project=${encodeURIComponent(mappingId)}`;
};

/** A stage page's path, from its configured step id. */
export const mvacStagePath = (stepId: string): string => `stage/${stepId}`;

/** The module's parent, carrying the project on. */
export const mvacParentHref = (mappingId: string): string =>
  mappingId
    ? `${PM_MVAC_PARENT_PATH}?project=${encodeURIComponent(mappingId)}`
    : PM_MVAC_PARENT_PATH;
