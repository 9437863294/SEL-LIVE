/**
 * Where Billing Recon's records live, and the per-project switch that moves them out of the
 * register Billing Recon used to share with Project Management.
 *
 * ## Why this exists
 *
 * Billing Recon (2025-11) was the original home of a project's BOQ, JMC and MVAC registers. When
 * Project Management, Subcontractors and Store & Stock were built they reused the same
 * `projects/{id}/boqItems` and `projects/{id}/jmcEntries` collections and the same
 * `workflows/jmc-workflow`, so a JMC raised in one module showed up — and could be approved,
 * certified or deleted — in the other. Project Management also read Billing Recon's
 * `mvacEntries`, and Billing Recon counted Subcontractors' `bills` as its own billed quantity.
 *
 * ## The split
 *
 * The shared collections stay exactly where they are and become the *project* register (Project
 * Management, Subcontractors and Store & Stock keep using them unchanged). Billing Recon moves to
 * collections of its own, named `billingRecon*`, beside them under the same project document.
 *
 * The move is per project and explicit: until someone runs **Settings › Data Separation** for a
 * project, Billing Recon keeps reading that project's shared register exactly as before, so nothing
 * changes for anyone the moment this code ships. Separating a project copies its BOQ, the JMC
 * entries chosen, its MVAC entries, and the JMC workflow into Billing Recon's own collections, then
 * stamps `projects/{id}.billingReconSeparation`. From then on Billing Recon reads and writes only
 * its own copy, and the two registers never touch again.
 *
 * Pure (no Firebase, no React) so the rules stay unit-testable — see
 * tests/billing-recon-register.test.mjs.
 */

/** The collections the project register uses. Billing Recon reads these until a project is separated. */
export const SHARED_PROJECT_REGISTER = {
  boqItems: 'boqItems',
  jmcEntries: 'jmcEntries',
  mvacEntries: 'mvacEntries',
  jmcWorkflowId: 'jmc-workflow',
} as const;

/** Billing Recon's own collections, used once a project is separated. */
export const BILLING_RECON_COLLECTIONS = {
  boqItems: 'billingReconBoqItems',
  jmcEntries: 'billingReconJmcEntries',
  mvacEntries: 'billingReconMvacEntries',
  jmcWorkflowId: 'billing-recon-jmc-workflow',
} as const;

/**
 * Collections only Billing Recon has ever written, so they need no switch:
 *  - `mvac-workflow` — no other module reads it.
 *  - `billingReconSerialConfigs` — JMC and MVAC number series. Billing Recon keeps them; separated
 *    projects' Project Management/Subcontractors JMC screens move to `PROJECT_JMC_SERIAL_CONFIGS`.
 *  - `billingReconBills` — RA bill abstracts (client billing quantities). New with the split; never
 *    Subcontractors' `bills`, which are what the company pays, not what it bills the client.
 */
export const BILLING_RECON_FIXED = {
  mvacWorkflowId: 'mvac-workflow',
  serialConfigs: 'billingReconSerialConfigs',
  raBills: 'billingReconBills',
} as const;

/** The JMC number series Project Management and Subcontractors draw from once a project is separated. */
export const PROJECT_JMC_SERIAL_CONFIGS = 'projectJmcSerialConfigs';

/** The workflows collection every workflow document above lives in. */
export const WORKFLOWS_COLLECTION = 'workflows';

/** Stamped on `projects/{id}` when its Billing Recon data is separated. */
export interface BillingReconSeparation {
  /** ISO timestamp. Its presence is what switches the project over. */
  separatedAt: string;
  separatedById: string;
  separatedByName: string;
  /** What was copied, for the record shown on the Data Separation page. */
  copied: {
    boqItems: number;
    jmcEntries: number;
    mvacEntries: number;
    serialConfigs: number;
    jmcWorkflow: boolean;
  };
  /** JMC entries removed from the project register after copying (the "Billing Recon only" choice). */
  removedFromProjectRegister: number;
}

/** The only project fields the register rules read. */
export interface RegisterProject {
  id?: string;
  billingReconSeparation?: Partial<BillingReconSeparation> | null;
}

/** Every collection and workflow document a Billing Recon screen touches for one project. */
export interface BillingReconRegister {
  /** True once the project has its own Billing Recon collections. */
  separated: boolean;
  /** Subcollection names under `projects/{projectId}`. */
  boqItems: string;
  jmcEntries: string;
  mvacEntries: string;
  raBills: string;
  /** Document ids under `workflows/`. */
  jmcWorkflowId: string;
  mvacWorkflowId: string;
  /** Top-level collection of JMC/MVAC serial-number configs. */
  serialConfigs: string;
}

export function isBillingReconSeparated(project: RegisterProject | null | undefined): boolean {
  const stamp = project?.billingReconSeparation?.separatedAt;
  return typeof stamp === 'string' && stamp.trim().length > 0;
}

/** Billing Recon's collections for this project: its own once separated, the shared ones until then. */
export function billingReconRegister(project: RegisterProject | null | undefined): BillingReconRegister {
  const separated = isBillingReconSeparated(project);
  const source = separated ? BILLING_RECON_COLLECTIONS : SHARED_PROJECT_REGISTER;
  return {
    separated,
    boqItems: source.boqItems,
    jmcEntries: source.jmcEntries,
    mvacEntries: source.mvacEntries,
    raBills: BILLING_RECON_FIXED.raBills,
    jmcWorkflowId: source.jmcWorkflowId,
    mvacWorkflowId: BILLING_RECON_FIXED.mvacWorkflowId,
    serialConfigs: BILLING_RECON_FIXED.serialConfigs,
  };
}

/**
 * The JMC serial-number collection Project Management's and Subcontractors' JMC screens use.
 *
 * Until a project is separated there is one JMC register and so one counter, shared with Billing
 * Recon. Separating copies the project's counters into `projectJmcSerialConfigs`, so both sides
 * continue from where the shared counter stood and never take numbers from each other again.
 */
export function projectJmcSerialCollection(project: RegisterProject | null | undefined): string {
  return isBillingReconSeparated(project) ? PROJECT_JMC_SERIAL_CONFIGS : BILLING_RECON_FIXED.serialConfigs;
}

/** Serial-config ids are `${projectId}_${scope2}_${scope1}`; this is the prefix one project's ids share. */
export function serialConfigPrefix(projectId: string): string {
  return `${projectId}_`;
}

/** True when a serial-config document id belongs to this project. */
export function serialConfigBelongsTo(configId: string, projectId: string): boolean {
  return Boolean(projectId) && configId.startsWith(serialConfigPrefix(projectId));
}

/** A short label for the register a project is on, for banners and the Data Separation page. */
export function registerLabel(project: RegisterProject | null | undefined): string {
  return isBillingReconSeparated(project) ? 'Billing Recon register' : 'Shared with Project Management';
}
