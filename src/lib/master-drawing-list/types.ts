// Master Drawing List: shared types. Safe to import from client and server code.

export const SCHEDULES = ['Supply', 'Civil', 'Electrical'] as const;
export type MdlSchedule = (typeof SCHEDULES)[number];

export const SCOPES = ['Substation', 'Transmission Line'] as const;
export type MdlScope = (typeof SCOPES)[number];

export const STATUSES = [
  'approved',
  'under_review',
  'comments_received',
  'not_submitted',
  'vendor_not_finalised',
  'on_hold',
] as const;
export type MdlStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<MdlStatus, string> = {
  approved: 'Approved',
  under_review: 'Under review',
  comments_received: 'Comments received',
  not_submitted: 'Not submitted',
  vendor_not_finalised: 'Vendor not finalised',
  on_hold: 'On hold',
};

/** Who has to act next. */
export type MdlHeldBy = 'SEL' | 'Client' | 'Procurement' | null;

/** A calendar date stored as 'YYYY-MM-DD'. No time, no timezone, sorts as text. */
export type IsoDate = string;

export interface MdlRevision {
  rev: number;
  submittedOn: IsoDate | null;
  /** Date the client returned comments on this revision. */
  commentedOn: IsoDate | null;
  /** Covering letter / transmittal reference of the submission. */
  transmittalNo: string | null;
}

/** Kept only on items that came from the Excel workbooks. */
export interface MdlLegacy {
  /** Status exactly as typed in the workbook, or null if it was blank. */
  status: string | null;
  /** Workbook › sheet › row. */
  source: string;
  /** Entries found during import that still need correcting. */
  issues: string[];
}

/** The fields people edit. Everything in MdlDerived is calculated from these. */
export interface MdlItemCore {
  projectCode: string;
  schedule: MdlSchedule;
  scope: MdlScope;
  group: string | null;
  /** Position in the register. */
  order: number;
  slNo: string;
  description: string;
  drgNo: string | null;
  plannedSubmission: IsoDate | null;
  targetApproval: IsoDate | null;
  /** False until a vendor / purchase order exists for the item. */
  vendorFinalised: boolean;
  onHold: boolean;
  revisions: MdlRevision[];
  approved: boolean;
  approvedOn: IsoDate | null;
  remarks: string | null;
  legacy: MdlLegacy | null;
}

export interface MdlDerived {
  status: MdlStatus;
  currentRev: number | null;
  lastSubmittedOn: IsoDate | null;
  lastCommentedOn: IsoDate | null;
  heldBy: MdlHeldBy;
}

export interface MdlItem extends MdlItemCore, MdlDerived {
  id: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** The name of whoever made the last change, written beside the id so screens need no user lookup. */
  updatedByName?: string | null;
}

export interface MdlProject {
  code: string;
  short: string;
  name: string;
  client: string | null;
  drgPrefix: string | null;
  /**
   * The ERP project (`projects/{id}`) this drawing list belongs to. Access follows it: a user sees
   * the list when that project is granted to them, or when they hold All Projects. Null until linked
   * on the module's Settings page (or with the import's `--link`); until then only All Projects
   * holders see it.
   */
  projectId?: string | null;
}

export const COLLECTIONS = { projects: 'mdl_projects', items: 'mdl_items' } as const;
