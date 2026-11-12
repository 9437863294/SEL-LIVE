/**
 * The rules a drawing record must meet when it is saved from the Drawing Details dialog — checked
 * in the dialog as you press Save and again by the API inside its transaction, with this one code.
 *
 * From Project Management's register:
 *   - a sub-drawing needs a title; the planned end date cannot be before the start;
 *   - every round newly submitted needs its drawing file;
 *   - the next round (R1, R2 …) opens only after the one before it is marked Rejected or
 *     Resubmission Required.
 * From the Master Drawing List brief:
 *   - no submission, comments or approve date in the future (India time);
 *   - no date earlier than the event before it: comments after their round's submission, a round
 *     after the one before it, approval after the first submission.
 */

import { isIsoDate } from './derive.ts';
import { earliestSubmissionDate, hasRevisionData, isRevisionRejected, storedRevisions, type DrawingRecord, type DrawingRevision, type OverallStatus } from './drawings.ts';

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

/** Why the form cannot be saved, or null. `uploads` are the rounds with a file attached in this save. */
export function drawingFormError(
  form: DrawingForm,
  options: { isSub: boolean; previous?: Pick<DrawingRecord, 'revisions'> | null; today: string; uploads: ReadonlySet<string> },
): string | null {
  if (options.isSub && !form.title.trim()) return 'Give the sub-drawing a title such as “GA Drawing” or “Foundation Drawing”.';
  if (!options.isSub && form.description.trim().length < 3) return 'Enter the item description.';

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

  const recorded = (date: string, label: string) => (date && date > options.today ? `${label} cannot be in the future.` : null);
  const future = recorded(form.approveDate, 'The approve date');
  if (future) return future;

  let previousDate = '';
  for (let i = 0; i < form.revisions.length; i += 1) {
    const revision = form.revisions[i];
    if (!hasRevisionData(revision)) continue;
    if (i > 0 && !isRevisionRejected(form.revisions[i - 1])) {
      return `Mark ${form.revisions[i - 1].round} as Rejected or Resubmission Required before recording ${revision.round}.`;
    }
    const error = recorded(revision.submissionDate, `${revision.round} submission date`) ?? recorded(revision.commentsDate, `${revision.round} comments date`);
    if (error) return error;
    if (revision.commentsDate && !revision.submissionDate) return `Record ${revision.round}'s submission date before its comments date.`;
    if (revision.submissionDate && previousDate && revision.submissionDate < previousDate) {
      return `${revision.round} cannot be submitted before ${FMT(previousDate)}, the last date recorded on the round before it.`;
    }
    if (revision.commentsDate && revision.submissionDate && revision.commentsDate < revision.submissionDate) {
      return `${revision.round} comments date cannot be before its submission date (${FMT(revision.submissionDate)}).`;
    }
    previousDate = revision.commentsDate || revision.submissionDate || previousDate;
  }
  const first = earliestSubmissionDate(form.revisions);
  if (form.approveDate && first && form.approveDate < first) return `The approve date cannot be before the first submission (${FMT(first)}).`;

  // Every round newly submitted in this save needs its drawing. Rounds already on record — imported
  // from the workbook, or saved before files were attached — are not asked for one again.
  const before = new Map((options.previous?.revisions ?? []).map((revision) => [revision.round, revision]));
  for (const revision of form.revisions) {
    const submitted = Boolean(revision.submissionDate || revision.status);
    if (!submitted || revision.filePath || options.uploads.has(revision.round)) continue;
    const earlier = before.get(revision.round);
    if (earlier && (earlier.submissionDate || earlier.status)) continue;
    return `Upload the drawing for ${revision.round}: every submission requires its drawing file.`;
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
