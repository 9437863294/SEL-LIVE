/**
 * The next steps an item allows — record a submission, the client's comments, or the approval —
 * worked out from the same rules `derive.ts` applies when the step is saved, so the item page offers
 * exactly the steps the API would accept. `tests/master-drawing-list.test.mjs` checks the two agree.
 */

import { addApproval, addComments, addSubmission, events } from './derive.ts';
import type { IsoDate, MdlItemCore } from './types.ts';

export type MdlStep = 'submission' | 'comments' | 'approval';

export const STEP_LABEL: Record<MdlStep, string> = {
  submission: 'Record submission',
  comments: 'Record comments',
  approval: 'Record approval',
};

type StepSource = Pick<MdlItemCore, 'revisions' | 'approved' | 'approvedOn'>;

/** The revision number the next submission gets: R0 for a new item, else the last plus one. */
export function nextRevision(item: StepSource): number {
  const last = item.revisions[item.revisions.length - 1];
  return last ? last.rev + 1 : 0;
}

/** The last recorded date on the item — no new date may be earlier. */
export function lastEventDate(item: StepSource): IsoDate | null {
  const all = events(item);
  return all.length ? all[all.length - 1].date : null;
}

/**
 * The steps the item allows now, the likeliest first: comments or approval while a revision is with
 * the client, a resubmission once comments are back, the first submission before anything is sent.
 */
export function availableSteps(item: StepSource): MdlStep[] {
  if (item.approved) return [];
  const last = item.revisions[item.revisions.length - 1];
  const submitted = item.revisions.some((revision) => revision.submittedOn);
  const underReview = Boolean(last?.submittedOn && !last.commentedOn);
  const steps: MdlStep[] = [];
  if (underReview) steps.push('comments');
  if (!underReview) steps.push('submission');
  if (submitted) steps.push('approval');
  if (underReview) steps.push('submission');
  return steps;
}

/** Why `date` cannot be saved for `step` on this item, or null when it can — derive's own check. */
export function stepError(item: StepSource, step: MdlStep, date: IsoDate, today: IsoDate): string | null {
  const result =
    step === 'submission'
      ? addSubmission(item, date, null, today)
      : step === 'comments'
        ? addComments(item, date, today)
        : addApproval(item, date, today);
  return result.ok ? null : result.error;
}
