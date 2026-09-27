/**
 * One status vocabulary for the whole app: every status word — "Pending Approval", "PAYMENT_PENDING",
 * "due-soon", "Overdue" — resolves to one of six tones, and every module's badge draws that tone
 * the same way (`Badge` variants, `StatusBadge`). A module that means something special by a word
 * passes `tone` explicitly instead of inventing colours.
 *
 * Pure and dependency-free, so it is unit-tested with plain node (`tests/status-tone.test.mjs`) —
 * which is also why there are no enums here.
 */

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

export const STATUS_TONES: readonly StatusTone[] = ['neutral', 'info', 'progress', 'success', 'warning', 'danger'];

/** "PAYMENT_PENDING" / "due-soon" / "In  Progress" → "payment pending" / "due soon" / "in progress". */
export function normalizeStatus(status: unknown): string {
  if (typeof status !== 'string') return '';
  return status
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** "PAYMENT_PENDING" → "Payment Pending"; a status already in words keeps its own casing. */
export function statusLabel(status: unknown): string {
  if (typeof status !== 'string' || !status.trim()) return '';
  const raw = status.trim();
  // A code — SCREAMING_SNAKE, snake_case or kebab-case — becomes words; anything else is kept.
  const isCode = raw.includes('_') || (raw === raw.toUpperCase() && /[A-Z]/.test(raw)) || (raw === raw.toLowerCase() && raw.includes('-'));
  if (!isCode) return raw;
  return normalizeStatus(raw).replace(/\b\w/g, (c) => c.toUpperCase());
}

/*
 * Checked in order; the first rule with a matching phrase wins. Phrases match whole words, so
 * "unpaid" is not "paid" and "inactive" is not "active". More specific phrases come first
 * ("partially approved" before "approved", "not started" before "started", "due soon" before "due").
 */
const RULES: ReadonlyArray<readonly [StatusTone, readonly string[]]> = [
  ['neutral', ['not started', 'not applicable', 'n a', 'no budget', 'not linked', 'not set', 'inactive', 'unpaid']],
  ['warning', ['partially approved', 'partially paid', 'partially', 'partial', 'part paid', 'pending', 'awaiting', 'awaited', 'waiting', 'due soon', 'expiring', 'expiring soon', 'mature soon', 'maturity approaching', 'approaching', 'near', 'warning', 'low stock', 'needs review', 'needs', 'review', 'in review', 'under review', 'verification', 'clarification', 'correction', 'returned', 'on hold', 'hold', 'extension due', 'due', 'requested', 'idle', 'late']],
  ['danger', ['rejected', 'declined', 'failed', 'failure', 'overdue', 'expired', 'lapsed', 'invalid', 'blocked', 'disputed', 'over budget', 'missing', 'discrepancy', 'invoked', 'breach', 'breached', 'no show', 'absent', 'error', 'critical', 'terminated', 'suspended', 'out of stock']],
  ['neutral', ['cancelled', 'canceled', 'withdrawn', 'void', 'voided', 'superseded', 'archived', 'closed', 'draft', 'new', 'offline', 'locked', 'none', 'unknown', 'matured', 'waived', 'sold', 'scrapped', 'weekly off', 'holiday']],
  ['success', ['approved', 'accepted', 'active', 'paid', 'settled', 'completed', 'complete', 'done', 'valid', 'verified', 'joined', 'filled', 'received', 'delivered', 'in stock', 'on track', 'ok', 'present', 'online', 'success', 'successful', 'resolved', 'cleared', 'released', 'renewed', 'confirmed', 'passed', 'available', 'enabled', 'live', 'yes']],
  ['progress', ['in progress', 'processing', 'ongoing', 'running', 'started', 'screening', 'interview', 'interviewing', 'offer', 'offered', 'shortlisted', 'selected', 'sourcing', 'in transit', 'dispatched', 'executing']],
  ['info', ['submitted', 'resubmitted', 'open', 'scheduled', 'sent', 'issued', 'raised', 'created', 'assigned', 'upcoming', 'planned', 'booked', 'talent pool', 'utilized', 'opened']],
];

const RULE_PATTERNS = RULES.map(
  ([tone, phrases]) => [tone, phrases.map((phrase) => new RegExp(`(^| )${phrase.replace(/ /g, ' ')}( |$)`))] as const,
);

/** The tone a status word reads as. Anything unrecognised is neutral. */
export function statusTone(status: unknown): StatusTone {
  const text = normalizeStatus(status);
  if (!text) return 'neutral';
  for (const [tone, patterns] of RULE_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) return tone;
  }
  return 'neutral';
}

export function isStatusTone(value: unknown): value is StatusTone {
  return typeof value === 'string' && (STATUS_TONES as readonly string[]).includes(value);
}
