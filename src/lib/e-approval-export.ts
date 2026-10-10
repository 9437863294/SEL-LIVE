/**
 * The E-Approval register as an Excel workbook — every field of every request in the list, plus the
 * workflow, activity, comments and attachments behind them.
 *
 * Pure and DOM-free, so the shape of the file is unit-tested under `node --test`; the screen only
 * loads the data and hands the sheets to `exportWorkbook`. One sheet per kind of record rather than
 * one wide sheet: a request has many steps and many comments, and folding them into one row each
 * would either lose them or make a sheet nobody can filter.
 *
 * Two rules shape every value here:
 *
 *   - **Real dates and real numbers.** A date written as text cannot be sorted or filtered by month,
 *     and an amount written as "₹23,350" cannot be summed — which is what a finance user opens the
 *     file to do. See `toExcelDate` for the time-zone correction that requires.
 *   - **Nothing the viewer could not open.** A confidential request is listed with the summary the
 *     register already shows them, but its proposal, workflow, remarks and files are left out unless
 *     `openable` says they may open it — the export is not a way round the detail screen.
 */
import {
  describeEApprovalAssignment,
  E_APPROVAL_REASSIGNMENT_VERBS,
  type EApprovalEvent,
  type EApprovalStepRecord,
} from './e-approval-policy.ts';
import type { ExcelColumn, ExcelSheet } from './report-excel.ts';

/* ── inputs ─────────────────────────────────────────────────────────────────────────────────── */

type DateLike = string | Date | null | undefined;

/**
 * A request as the export reads it. Firestore `Timestamp`s are converted by the caller (to ISO
 * strings), so this file stays free of the Firebase SDK.
 */
export interface EApprovalExportRequest {
  id: string;
  referenceNo?: string;
  subject?: string;
  body?: string;
  approvalTypeName?: string;
  status: string;
  pendingLabel?: string;
  currentStepName?: string;
  currentDueAt?: DateLike;
  priority?: string;
  requesterId?: string;
  requesterName?: string;
  requesterDesignation?: string;
  departmentName?: string;
  projectName?: string;
  amount?: number;
  approvedAmount?: number;
  currency?: string;
  vendorName?: string;
  costCentre?: string;
  budgetHead?: string;
  externalRef?: string;
  requiredBy?: DateLike;
  createdAt?: DateLike;
  updatedAt?: DateLike;
  submittedAt?: DateLike;
  completedAt?: DateLike;
  confidential?: boolean;
  ccUserIds?: string[];
  returnReason?: string;
  holdReason?: string;
  rejectionReason?: string;
  cancelReason?: string;
  commentCount?: number;
  attachmentCount?: number;
  version?: number;
}

export interface EApprovalExportComment {
  id: string;
  approvalId: string;
  stepName?: string;
  parentCommentId?: string | null;
  body: string;
  authorName?: string;
  authorDesignation?: string;
  createdAt?: DateLike;
  retracted?: boolean;
  editHistory?: unknown[];
}

export interface EApprovalExportAttachment {
  id: string;
  approvalId: string;
  name: string;
  stepName?: string;
  version?: number;
  uploadedByName?: string;
  uploadedAt?: DateLike;
  size?: number;
  description?: string;
  supersedesAttachmentId?: string | null;
  signedByName?: string;
}

export interface EApprovalExportSource {
  requests: EApprovalExportRequest[];
  steps: EApprovalStepRecord[];
  events: Array<EApprovalEvent & { approvalId: string }>;
  comments: EApprovalExportComment[];
  attachments: EApprovalExportAttachment[];
}

export interface EApprovalExportOptions {
  /** Requests the viewer may open — the same answer `canViewEApproval` gives the detail screen. */
  openable: Set<string>;
  /** A user id to a display name, for the CC column. Falls back to the id. */
  nameOf?: (userId: string) => string | undefined;
  /** The request's address in the app, for the Link column. */
  linkFor?: (requestId: string) => string;
  /** For the About sheet. */
  listName: string;
  exportedBy?: string;
  exportedAt?: Date;
  /** What narrowed the list on screen — "Search: cement · Status: Approved" — or empty. */
  filterSummary?: string;
}

/* ── values ─────────────────────────────────────────────────────────────────────────────────── */

export const EXPORT_DATE_TIME_FORMAT = 'dd-mmm-yyyy hh:mm';
export const EXPORT_DATE_FORMAT = 'dd-mmm-yyyy';
export const EXPORT_MONEY_FORMAT = '#,##0.00';
/** Excel refuses a cell longer than this; a long proposal is cut with a note rather than failing the file. */
export const EXCEL_CELL_LIMIT = 32_767;

/**
 * A date for an Excel cell, shown at the same wall-clock time the app shows.
 *
 * exceljs writes a `Date` using its UTC fields, so a file submitted at 10:00 in India would open in
 * Excel as 04:30. Shifting by the local offset first makes the UTC fields carry the local time,
 * which is what lands in the cell. A bare `YYYY-MM-DD` (a "required by" day) is read as local
 * midnight, so it stays on its own day instead of becoming the evening before.
 */
export function toExcelDate(value: DateLike): Date | null {
  if (!value) return null;
  let date: Date;
  if (value instanceof Date) date = value;
  else {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
  }
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
}

/** A long text cut to what Excel accepts, saying so rather than silently losing the end. */
export function fitExcelText(text: string | null | undefined): string {
  const value = String(text ?? '');
  if (value.length <= EXCEL_CELL_LIMIT) return value;
  const note = '… (cut here — the full text is on the request)';
  return value.slice(0, EXCEL_CELL_LIMIT - note.length) + note;
}

const yesNo = (value: unknown) => (value ? 'Yes' : 'No');
const money = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const millis = (value: DateLike) => {
  if (!value) return 0;
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const STEP_TYPE_LABELS: Record<string, string> = {
  APPROVAL: 'Approval',
  VERIFICATION: 'Verification',
  CLARIFICATION: 'Clarification',
  REVIEW: 'Review',
};

const NOT_VISIBLE = 'No — not visible to you';

/* ── columns ────────────────────────────────────────────────────────────────────────────────── */

const col = (header: string, key: string, width: number, numFmt?: string): ExcelColumn => ({ header, key, width, ...(numFmt ? { numFmt } : {}) });

const REQUEST_COLUMNS: ExcelColumn[] = [
  col('Reference', 'reference', 22),
  col('Subject', 'subject', 44),
  col('Approval type', 'type', 20),
  col('Status', 'status', 18),
  col('Pending with', 'pendingWith', 34),
  col('Current stage', 'currentStage', 24),
  col('Due by', 'dueBy', 18, EXPORT_DATE_TIME_FORMAT),
  col('Priority', 'priority', 10),
  col('Requested by', 'requester', 24),
  col('Requester designation', 'requesterDesignation', 24),
  col('Department', 'department', 20),
  col('Project / site', 'project', 22),
  col('Amount requested', 'amount', 16, EXPORT_MONEY_FORMAT),
  col('Amount sanctioned', 'approvedAmount', 16, EXPORT_MONEY_FORMAT),
  col('Currency', 'currency', 9),
  col('Vendor / party', 'vendor', 26),
  col('Cost centre', 'costCentre', 18),
  col('Budget head', 'budgetHead', 18),
  col('Your reference', 'externalRef', 18),
  col('Required by', 'requiredBy', 14, EXPORT_DATE_FORMAT),
  col('Created', 'created', 18, EXPORT_DATE_TIME_FORMAT),
  col('Submitted', 'submitted', 18, EXPORT_DATE_TIME_FORMAT),
  col('Closed', 'closed', 18, EXPORT_DATE_TIME_FORMAT),
  col('Last updated', 'updated', 18, EXPORT_DATE_TIME_FORMAT),
  col('Confidential', 'confidential', 12),
  col('CC', 'cc', 34),
  col('Return reason', 'returnReason', 30),
  col('Hold reason', 'holdReason', 30),
  col('Rejection reason', 'rejectionReason', 30),
  col('Cancellation reason', 'cancelReason', 30),
  col('Comments', 'commentCount', 10),
  col('Attachments', 'attachmentCount', 12),
  col('Version', 'version', 9),
  col('Details in this file', 'details', 24),
  col('Proposal', 'proposal', 60),
  col('Link', 'link', 40),
];

const STEP_COLUMNS: ExcelColumn[] = [
  col('Reference', 'reference', 22),
  col('Subject', 'subject', 36),
  col('Order', 'order', 7),
  col('Stage', 'stage', 30),
  col('Type', 'type', 14),
  col('Level', 'level', 7),
  col('Raised by stage', 'parent', 26),
  col('Assigned to', 'assignedTo', 32),
  col('Status', 'status', 18),
  col('Outcome', 'outcome', 22),
  col('Acted by', 'actedBy', 22),
  col('On behalf of', 'onBehalfOf', 20),
  col('Started', 'started', 18, EXPORT_DATE_TIME_FORMAT),
  col('Due by', 'due', 18, EXPORT_DATE_TIME_FORMAT),
  col('Completed', 'completed', 18, EXPORT_DATE_TIME_FORMAT),
  col('Amount sanctioned', 'approvedAmount', 16, EXPORT_MONEY_FORMAT),
  col('Comment', 'comment', 40),
  col('Instruction', 'instruction', 34),
  col('Forwarded / moved', 'moves', 60),
];

const EVENT_COLUMNS: ExcelColumn[] = [
  col('Reference', 'reference', 22),
  col('When', 'when', 18, EXPORT_DATE_TIME_FORMAT),
  col('By', 'by', 22),
  col('On behalf of', 'onBehalfOf', 20),
  col('Action', 'action', 22),
  col('Stage', 'stage', 26),
  col('Outcome', 'outcome', 20),
  col('Amount sanctioned', 'approvedAmount', 16, EXPORT_MONEY_FORMAT),
  col('Comment', 'comment', 40),
  col('Instruction', 'instruction', 34),
  col('Reason', 'reason', 34),
  col('Summary', 'summary', 50),
];

const COMMENT_COLUMNS: ExcelColumn[] = [
  col('Reference', 'reference', 22),
  col('When', 'when', 18, EXPORT_DATE_TIME_FORMAT),
  col('By', 'by', 22),
  col('Designation', 'designation', 22),
  col('Stage', 'stage', 24),
  col('Kind', 'kind', 9),
  col('Comment', 'comment', 70),
  col('Retracted', 'retracted', 10),
  col('Edited', 'edited', 8),
];

const ATTACHMENT_COLUMNS: ExcelColumn[] = [
  col('Reference', 'reference', 22),
  col('File', 'file', 40),
  col('Stage', 'stage', 24),
  col('Uploaded by', 'uploadedBy', 22),
  col('Uploaded', 'uploaded', 18, EXPORT_DATE_TIME_FORMAT),
  col('Version', 'version', 9),
  col('Size (KB)', 'sizeKb', 11),
  col('Description', 'description', 34),
  col('Replaces an earlier file', 'replaces', 12),
  col('Signed by', 'signedBy', 20),
];

/* ── the workbook ───────────────────────────────────────────────────────────────────────────── */

/** Sheets for `exportWorkbook`, in the order a reader wants them: requests first, notes last. */
export function buildEApprovalExportSheets(source: EApprovalExportSource, options: EApprovalExportOptions): ExcelSheet[] {
  const { openable } = options;
  // Every detail sheet follows the request sheet's order, so a reader filtering one reference sees
  // its rows in the same place on every tab.
  const order = new Map(source.requests.map((request, index) => [request.id, index]));
  const byId = new Map(source.requests.map((request) => [request.id, request]));
  const visible = (approvalId: string | undefined) => Boolean(approvalId && order.has(approvalId) && openable.has(approvalId));
  const refOf = (approvalId: string | undefined) => {
    const request = approvalId ? byId.get(approvalId) : undefined;
    return request?.referenceNo || (request ? 'Draft' : '');
  };
  const sortByRequestThen = <T>(rows: T[], idOf: (row: T) => string | undefined, then: (a: T, b: T) => number) =>
    [...rows].sort((a, b) => (order.get(idOf(a) ?? '') ?? 0) - (order.get(idOf(b) ?? '') ?? 0) || then(a, b));

  const requestRows = source.requests.map((request) => {
    const open = openable.has(request.id);
    return {
      reference: request.referenceNo || 'Draft',
      subject: request.subject ?? '',
      type: request.approvalTypeName ?? '',
      status: request.status,
      pendingWith: request.pendingLabel ?? '',
      currentStage: request.currentStepName ?? '',
      dueBy: toExcelDate(request.currentDueAt),
      priority: request.priority ?? '',
      requester: request.requesterName ?? '',
      requesterDesignation: request.requesterDesignation ?? '',
      department: request.departmentName ?? '',
      project: request.projectName ?? '',
      amount: money(request.amount),
      approvedAmount: money(request.approvedAmount),
      currency: request.amount != null ? request.currency || 'INR' : '',
      vendor: request.vendorName ?? '',
      costCentre: request.costCentre ?? '',
      budgetHead: request.budgetHead ?? '',
      externalRef: request.externalRef ?? '',
      requiredBy: toExcelDate(request.requiredBy),
      created: toExcelDate(request.createdAt),
      submitted: toExcelDate(request.submittedAt),
      closed: toExcelDate(request.completedAt),
      updated: toExcelDate(request.updatedAt),
      confidential: yesNo(request.confidential),
      cc: (request.ccUserIds ?? []).map((id) => options.nameOf?.(id) || id).join(', '),
      // The reasons are part of the file's summary — a register user sees why a request came back
      // without opening it — but they are also the kind of thing a confidential file hides.
      returnReason: open ? request.returnReason ?? '' : '',
      holdReason: open ? request.holdReason ?? '' : '',
      rejectionReason: open ? request.rejectionReason ?? '' : '',
      cancelReason: open ? request.cancelReason ?? '' : '',
      commentCount: request.commentCount ?? 0,
      attachmentCount: request.attachmentCount ?? 0,
      version: request.version ?? 1,
      details: open ? 'Yes' : NOT_VISIBLE,
      proposal: open ? fitExcelText(request.body) : '',
      link: options.linkFor?.(request.id) ?? '',
    };
  });

  const stepName = new Map(source.steps.map((step) => [step.id, step.name]));
  const stepRows = sortByRequestThen(
    source.steps.filter((step) => visible(step.approvalId)),
    (step) => step.approvalId,
    (a, b) => a.sequence - b.sequence || a.depth - b.depth || millis(a.startedAt) - millis(b.startedAt),
  ).map((step) => ({
    reference: refOf(step.approvalId),
    subject: byId.get(step.approvalId ?? '')?.subject ?? '',
    order: step.sequence,
    stage: step.name,
    type: STEP_TYPE_LABELS[step.type] ?? step.type,
    level: step.depth,
    parent: step.parentStepId ? stepName.get(step.parentStepId) ?? '' : '',
    assignedTo: describeEApprovalAssignment(step.assignment),
    status: step.status,
    outcome: step.outcome ?? '',
    actedBy: step.actedByName ?? '',
    onBehalfOf: step.onBehalfOfName ?? '',
    started: toExcelDate(step.startedAt),
    due: toExcelDate(step.dueAt),
    completed: toExcelDate(step.completedAt),
    approvedAmount: money(step.approvedAmount),
    comment: fitExcelText(step.comment),
    instruction: fitExcelText(step.instruction),
    // The trail of who passed the file to whom — the step document keeps only the last holder.
    moves: fitExcelText(
      (step.reassignments ?? [])
        .map((move) =>
          [
            `${E_APPROVAL_REASSIGNMENT_VERBS[move.kind] ?? move.kind} from ${describeEApprovalAssignment(move.from)} to ${describeEApprovalAssignment(move.to)}`,
            move.byName ? ` by ${move.byName}` : '',
            move.reason ? ` — ${move.reason}` : '',
          ].join(''),
        )
        .join('; '),
    ),
  }));

  const eventRows = sortByRequestThen(
    source.events.filter((event) => visible(event.approvalId)),
    (event) => event.approvalId,
    (a, b) => millis(a.at) - millis(b.at),
  ).map((event) => ({
    reference: refOf(event.approvalId),
    when: toExcelDate(event.at),
    by: event.actorName ?? '',
    onBehalfOf: event.onBehalfOfName ?? '',
    action: event.kind,
    stage: event.stepName ?? '',
    outcome: event.outcome ?? '',
    approvedAmount: money(event.approvedAmount),
    comment: fitExcelText(event.comment),
    instruction: fitExcelText(event.instruction),
    reason: fitExcelText(event.reason),
    summary: fitExcelText(event.summary),
  }));

  const commentRows = sortByRequestThen(
    source.comments.filter((comment) => visible(comment.approvalId)),
    (comment) => comment.approvalId,
    (a, b) => millis(a.createdAt) - millis(b.createdAt),
  ).map((comment) => ({
    reference: refOf(comment.approvalId),
    when: toExcelDate(comment.createdAt),
    by: comment.authorName ?? '',
    designation: comment.authorDesignation ?? '',
    stage: comment.stepName ?? '',
    kind: comment.parentCommentId ? 'Reply' : 'Comment',
    comment: fitExcelText(comment.body),
    retracted: yesNo(comment.retracted),
    edited: comment.editHistory?.length ?? 0,
  }));

  const attachmentRows = sortByRequestThen(
    source.attachments.filter((attachment) => visible(attachment.approvalId)),
    (attachment) => attachment.approvalId,
    (a, b) => millis(a.uploadedAt) - millis(b.uploadedAt),
  ).map((attachment) => ({
    reference: refOf(attachment.approvalId),
    // The file's name only, never its download address: a storage URL carries its own access token,
    // so writing it into a spreadsheet would hand the file to anybody the spreadsheet is sent to.
    file: attachment.name,
    stage: attachment.stepName ?? '',
    uploadedBy: attachment.uploadedByName ?? '',
    uploaded: toExcelDate(attachment.uploadedAt),
    version: attachment.version ?? 1,
    sizeKb: typeof attachment.size === 'number' ? Math.round((attachment.size / 1024) * 10) / 10 : null,
    description: attachment.description ?? '',
    replaces: yesNo(attachment.supersedesAttachmentId),
    signedBy: attachment.signedByName ?? '',
  }));

  const hidden = source.requests.filter((request) => !openable.has(request.id)).length;
  const about = [
    ['List', options.listName],
    ['Exported by', options.exportedBy ?? ''],
    // Text, not a date cell: this column also holds counts, and a date format on it would turn
    // "Requests: 12" into 12-Jan-1900.
    ['Exported on', formatExportStamp(options.exportedAt ?? new Date())],
    ['Filters on screen', options.filterSummary || 'None — every request in the list'],
    ['Requests', source.requests.length],
    ['Workflow steps', stepRows.length],
    ['Activity entries', eventRows.length],
    ['Comments', commentRows.length],
    ['Attachments', attachmentRows.length],
    [
      'Not visible to you',
      hidden
        ? `${hidden} confidential ${hidden === 1 ? 'request is' : 'requests are'} listed with their summary only — no proposal, workflow, remarks or files.`
        : 'None',
    ],
    ['Attachments', 'Listed by name. The files themselves are not in this workbook — open the request to download them.'],
  ].map(([field, value]) => ({ field, value }));

  return [
    { name: 'Requests', columns: REQUEST_COLUMNS, rows: requestRows },
    { name: 'Workflow', columns: STEP_COLUMNS, rows: stepRows },
    { name: 'Activity', columns: EVENT_COLUMNS, rows: eventRows },
    { name: 'Comments', columns: COMMENT_COLUMNS, rows: commentRows },
    { name: 'Attachments', columns: ATTACHMENT_COLUMNS, rows: attachmentRows },
    {
      name: 'About this export',
      columns: [col('Field', 'field', 22), col('Value', 'value', 90)],
      rows: about,
    },
  ];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "10-Oct-2026 14:05", local time — the About sheet's export stamp, written as text. */
export function formatExportStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}-${MONTHS[date.getMonth()]}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "E-Approval - All Approvals - 2026-10-10.xlsx" — local date, safe for every file system. */
export function eApprovalExportFilename(listName: string, now: Date = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `E-Approval - ${listName.replace(/[\\/:*?"<>|]/g, ' ').trim()} - ${day}.xlsx`;
}
