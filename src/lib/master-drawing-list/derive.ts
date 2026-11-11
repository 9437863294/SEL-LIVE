// Master Drawing List: status and date rules. Pure functions, no Firebase,
// so the server actions, the pages and the import script all use the same logic.

import type { IsoDate, MdlDerived, MdlItemCore, MdlRevision } from './types.ts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's date in India, whatever timezone the server runs in. */
export function todayIst(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

/** 'YYYY-MM-DD' to 'DD.MM.YYYY', the format used in the workbooks. */
export function formatDate(value: IsoDate | null | undefined): string {
  return value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '';
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export interface MdlEvent {
  kind: 'submitted' | 'commented' | 'approved';
  rev: number | null;
  date: IsoDate;
}

type EventSource = Pick<MdlItemCore, 'revisions' | 'approved' | 'approvedOn'>;

/** Dated events in the order they sit in the record: R0 submission, R0 comments, R1 ... approval. */
export function events(item: EventSource): MdlEvent[] {
  const out: MdlEvent[] = [];
  for (const r of item.revisions) {
    if (r.submittedOn) out.push({ kind: 'submitted', rev: r.rev, date: r.submittedOn });
    if (r.commentedOn) out.push({ kind: 'commented', rev: r.rev, date: r.commentedOn });
  }
  if (item.approvedOn) out.push({ kind: 'approved', rev: null, date: item.approvedOn });
  return out;
}

export function derive(
  item: Pick<MdlItemCore, 'revisions' | 'approved' | 'approvedOn' | 'vendorFinalised' | 'onHold'>,
): MdlDerived {
  let lastSubmittedOn: IsoDate | null = null;
  let lastCommentedOn: IsoDate | null = null;
  let currentRev: number | null = null;
  let lastKind: 'submitted' | 'commented' | null = null;
  for (const r of item.revisions) {
    if (r.submittedOn) {
      lastSubmittedOn = r.submittedOn;
      currentRev = r.rev;
      lastKind = 'submitted';
    }
    if (r.commentedOn) {
      lastCommentedOn = r.commentedOn;
      lastKind = 'commented';
    }
  }
  const base = { currentRev, lastSubmittedOn, lastCommentedOn };
  if (item.approved) return { ...base, status: 'approved', heldBy: null };
  if (item.onHold) return { ...base, status: 'on_hold', heldBy: null };
  if (lastKind === 'commented') return { ...base, status: 'comments_received', heldBy: 'SEL' };
  if (lastKind === 'submitted') return { ...base, status: 'under_review', heldBy: 'Client' };
  if (!item.vendorFinalised) return { ...base, status: 'vendor_not_finalised', heldBy: 'Procurement' };
  return { ...base, status: 'not_submitted', heldBy: 'SEL' };
}

/** Days the item has been waiting, and on whom. Null when nothing is pending. */
export function ageing(
  item: Pick<MdlDerived, 'status' | 'lastSubmittedOn' | 'lastCommentedOn'>,
  today: IsoDate,
): { days: number; since: IsoDate; with: 'Client' | 'SEL' } | null {
  if (item.status === 'under_review' && item.lastSubmittedOn) {
    return { days: daysBetween(item.lastSubmittedOn, today), since: item.lastSubmittedOn, with: 'Client' };
  }
  if (item.status === 'comments_received' && item.lastCommentedOn) {
    return { days: daysBetween(item.lastCommentedOn, today), since: item.lastCommentedOn, with: 'SEL' };
  }
  return null;
}

/** Days from first submission to approval, when both dates exist and are in order. */
export function cycleDays(item: EventSource): number | null {
  const first = item.revisions.find((r) => r.submittedOn)?.submittedOn;
  if (!first || !item.approvedOn) return null;
  const d = daysBetween(first, item.approvedOn);
  return d >= 0 ? d : null;
}

function checkDate(date: IsoDate, item: EventSource, today: IsoDate): string | null {
  if (!isIsoDate(date)) return 'Enter a valid date.';
  if (date > today) return 'The date cannot be in the future.';
  const all = events(item);
  const last = all[all.length - 1];
  if (last && date < last.date) {
    return `The date cannot be earlier than the last recorded date (${formatDate(last.date)}).`;
  }
  return null;
}

export type Change<T> = { ok: true; value: T } | { ok: false; error: string };

/** Add the next revision. R0 for a new item, otherwise the last revision number plus one. */
export function addSubmission(
  item: EventSource,
  date: IsoDate,
  transmittalNo: string | null,
  today: IsoDate,
): Change<MdlRevision[]> {
  if (item.approved) return { ok: false, error: 'This drawing is already approved.' };
  const bad = checkDate(date, item, today);
  if (bad) return { ok: false, error: bad };
  const last = item.revisions[item.revisions.length - 1];
  const rev = last ? last.rev + 1 : 0;
  return { ok: true, value: [...item.revisions, { rev, submittedOn: date, commentedOn: null, transmittalNo }] };
}

/** Record the client's comments against the revision that is under review. */
export function addComments(item: EventSource, date: IsoDate, today: IsoDate): Change<MdlRevision[]> {
  if (item.approved) return { ok: false, error: 'This drawing is already approved.' };
  const last = item.revisions[item.revisions.length - 1];
  if (!last || !last.submittedOn) return { ok: false, error: 'Record a submission before recording comments.' };
  if (last.commentedOn) {
    return { ok: false, error: `Comments on R${last.rev} are already recorded. Record the next submission first.` };
  }
  const bad = checkDate(date, item, today);
  if (bad) return { ok: false, error: bad };
  return { ok: true, value: [...item.revisions.slice(0, -1), { ...last, commentedOn: date }] };
}

export function addApproval(item: EventSource, date: IsoDate, today: IsoDate): Change<IsoDate> {
  if (item.approved) return { ok: false, error: 'This drawing is already approved.' };
  if (!item.revisions.some((r) => r.submittedOn)) {
    return { ok: false, error: 'Record a submission before recording the approval.' };
  }
  const bad = checkDate(date, item, today);
  if (bad) return { ok: false, error: bad };
  return { ok: true, value: date };
}
