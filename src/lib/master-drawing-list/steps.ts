/**
 * The rules a drawing record must meet when it is saved from the Drawing Details dialog — checked
 * in the dialog as you press Save and again by the API inside its transaction, with this one code.
 *
 * From Project Management's register:
 *   - a sub-drawing needs a title; the planned end date cannot be before the start;
 *   - a round newly submitted needs its drawing file (Field Control can make the file optional);
 *   - the next round (R1, R2 …) opens only after the one before it is marked Rejected or
 *     Resubmission Required.
 * From the module's Settings:
 *   - Field Control: the fields made required must be filled (hidden fields never are);
 *   - Date Control: submission, comments and approve dates within the allowed window — never later
 *     than today unless the rule allows days ahead.
 * Always: no date earlier than the event before it — comments after their round's submission, a
 * round after the one before it, approval after the first submission.
 *
 * Only dates entered or changed in this save are held to the window and the order, so an imported
 * record with an old or mistyped date can still be updated in its other fields.
 */

import { isIsoDate } from './derive.ts';
import { earliestSubmissionDate, hasRevisionData, isApproved, isRevisionRejected, storedRevisions, type DrawingRecord, type DrawingRevision, type OverallStatus } from './drawings.ts';
import { dateWindow, describeDateRule, fieldSetting, type FieldControl, type MdlDateKind, type MdlDateRule } from './settings.ts';

/** What the dialog edits. `title` and `assignedToId` only matter for a sub-drawing; `description` and `group` only for an item. */
export interface DrawingForm {
  title: string;
  assignedToId: string;
  description: string;
  group: string;
  docNo: string;
  drawingNo: string;
  plannedStartDate: string;
  plannedEndDate: string;
  revisions: DrawingRevision[];
  approveDate: string;
  status: OverallStatus;
  remark: string;
}

const FMT = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const VERDICTS = ['Resubmission Required', 'Rejected', 'Approved with Comments'];

export interface DrawingFormOptions {
  isSub: boolean;
  /** A sub-drawing being added: only its name, assignee, numbers and planned window are on the form. */
  isNew?: boolean;
  previous?: Pick<DrawingRecord, 'revisions'> & Partial<Pick<DrawingRecord, 'approveDate'>> | null;
  today: string;
  /** Rounds with a file attached in this save. */
  uploads: ReadonlySet<string>;
  fields?: FieldControl;
  dateRule?: MdlDateRule;
}

/** Why the form cannot be saved, or null. */
export function drawingFormError(form: DrawingForm, options: DrawingFormOptions): string | null {
  const field = (form: 'item' | 'drawing' | 'sub' | 'round', key: string) => fieldSetting(options.fields, form, key);
  const missing = (setting: { label: string; required: boolean }, value: string) => (setting.required && !value.trim() ? `${setting.label} is required.` : null);

  if (options.isSub && !form.title.trim()) return `${field('sub', 'title').label} is required — a name such as “GA Drawing” or “Foundation Drawing”.`;
  if (!options.isSub && form.description.trim().length < 3) return `Enter the ${field('item', 'description').label.toLowerCase()}.`;

  // Field Control: the fields made required.
  const required: (string | null)[] = options.isSub ? [missing(field('sub', 'assignedTo'), form.assignedToId)] : [missing(field('item', 'group'), form.group)];
  required.push(
    missing(field('drawing', 'docNo'), form.docNo),
    missing(field('drawing', 'drawingNo'), form.drawingNo),
    missing(field('drawing', 'plannedStartDate'), form.plannedStartDate),
    missing(field('drawing', 'plannedEndDate'), form.plannedEndDate),
  );
  if (!options.isNew) {
    required.push(missing(field('drawing', 'remark'), form.remark));
    if (isApproved(form.status)) required.push(missing(field('drawing', 'approveDate'), form.approveDate));
    for (const revision of form.revisions) {
      if (!revision.submissionDate) continue;
      const prefix = (message: string | null) => (message ? `${revision.round}: ${message}` : null);
      required.push(prefix(missing(field('round', 'transmittalNo'), revision.transmittalNo ?? '')), prefix(missing(field('round', 'status'), revision.status ?? '')));
      if (VERDICTS.includes(revision.status ?? '')) {
        required.push(prefix(missing(field('round', 'commentsDate'), revision.commentsDate)), prefix(missing(field('round', 'comments'), revision.comments)));
      }
    }
  }
  const firstMissing = required.find(Boolean);
  if (firstMissing) return firstMissing;

  const dates: [string, string][] = [
    ['Planned start date', form.plannedStartDate],
    ['Planned end date', form.plannedEndDate],
    ['Approve date', form.approveDate],
  ];
  for (const revision of form.revisions) {
    dates.push([`${revision.round} submission date`, revision.submissionDate], [`${revision.round} comments date`, revision.commentsDate]);
  }
  for (const [label, value] of dates) if (value && !isIsoDate(value)) return `${label}: enter a valid date.`;

  if (form.plannedStartDate && form.plannedEndDate && form.plannedEndDate < form.plannedStartDate) return 'Planned end date cannot be before the planned start date.';

  // Which dates were entered or changed now.
  const before = new Map((options.previous?.revisions ?? []).map((revision) => [revision.round, revision]));
  const changed = (round: string, key: 'submissionDate' | 'commentsDate', value: string) => Boolean(value) && value !== (before.get(round as DrawingRevision['round'])?.[key] ?? '');
  const approveChanged = Boolean(form.approveDate) && form.approveDate !== (options.previous?.approveDate ?? '');

  // Date Control: the window (or, with no rule, not later than today).
  const rule = options.dateRule ?? { enabled: false, backdateDays: 0, futureDays: 0, applySubmission: true, applyComments: true, applyApproval: true };
  const outside = (value: string, kind: MdlDateKind, label: string) => {
    const window = dateWindow(rule, kind, options.today);
    if (value > window.max) return window.max === options.today ? `${label} cannot be in the future.` : `${label} cannot be later than ${FMT(window.max)}. ${describeDateRule(rule)}`;
    if (window.min && value < window.min) return `${label} cannot be earlier than ${FMT(window.min)}. ${describeDateRule(rule)}`;
    return null;
  };
  if (approveChanged) {
    const error = outside(form.approveDate, 'approval', 'The approve date');
    if (error) return error;
  }

  let previousDate = '';
  for (let i = 0; i < form.revisions.length; i += 1) {
    const revision = form.revisions[i];
    if (!hasRevisionData(revision)) continue;
    if (i > 0 && !isRevisionRejected(form.revisions[i - 1])) {
      return `Mark ${form.revisions[i - 1].round} as Rejected or Resubmission Required before recording ${revision.round}.`;
    }
    const subChanged = changed(revision.round, 'submissionDate', revision.submissionDate);
    const comChanged = changed(revision.round, 'commentsDate', revision.commentsDate);
    const error =
      (subChanged ? outside(revision.submissionDate, 'submission', `${revision.round} submission date`) : null) ??
      (comChanged ? outside(revision.commentsDate, 'comments', `${revision.round} comments date`) : null);
    if (error) return error;
    if (revision.commentsDate && !revision.submissionDate) return `Record ${revision.round}'s submission date before its comments date.`;
    if (subChanged && revision.submissionDate && previousDate && revision.submissionDate < previousDate) {
      return `${revision.round} cannot be submitted before ${FMT(previousDate)}, the last date recorded on the round before it.`;
    }
    if ((subChanged || comChanged) && revision.commentsDate && revision.submissionDate && revision.commentsDate < revision.submissionDate) {
      return `${revision.round} comments date cannot be before its submission date (${FMT(revision.submissionDate)}).`;
    }
    previousDate = revision.commentsDate || revision.submissionDate || previousDate;
  }
  const first = earliestSubmissionDate(form.revisions);
  if (approveChanged && first && form.approveDate < first) return `The approve date cannot be before the first submission (${FMT(first)}).`;

  // Every round newly submitted in this save needs its drawing, unless Field Control makes the file
  // optional. Rounds already on record — imported, or saved before — are not asked for one again.
  if (field('round', 'file').required && !options.isNew) {
    for (const revision of form.revisions) {
      const submitted = Boolean(revision.submissionDate || revision.status);
      if (!submitted || revision.filePath || options.uploads.has(revision.round)) continue;
      const earlier = before.get(revision.round);
      if (earlier && (earlier.submissionDate || earlier.status)) continue;
      return `Upload the drawing for ${revision.round}: every submission requires its ${field('round', 'file').label.toLowerCase()}.`;
    }
  }
  return null;
}

/** The record to store from a valid form: trimmed text, trailing empty rounds dropped, first submission kept. */
export function recordFromForm(form: DrawingForm, previous?: Pick<DrawingRecord, 'firstSubmittedOn'> | null): DrawingRecord {
  const revisions = storedRevisions(
    form.revisions.map((revision) => {
      const out: DrawingRevision = {
        round: revision.round,
        submissionDate: revision.submissionDate,
        comments: revision.comments.trim(),
        commentsDate: revision.commentsDate,
      };
      if (revision.status) out.status = revision.status;
      if (revision.transmittalNo?.trim()) out.transmittalNo = revision.transmittalNo.trim();
      if (revision.fileName) out.fileName = revision.fileName;
      if (revision.filePath) out.filePath = revision.filePath;
      return out;
    }),
  );
  const firstSubmittedOn = previous?.firstSubmittedOn ?? earliestSubmissionDate(revisions);
  return {
    docNo: form.docNo.trim(),
    drawingNo: form.drawingNo.trim(),
    plannedStartDate: form.plannedStartDate,
    plannedEndDate: form.plannedEndDate,
    revisions,
    approveDate: form.approveDate,
    status: form.status,
    remark: form.remark.trim(),
    ...(firstSubmittedOn ? { firstSubmittedOn } : {}),
  };
}
