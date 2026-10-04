/**
 * Daily Bill Tracking reminders, decided as pure facts about bills on a given day. The cron route
 * delivers them through the app's notification engine (`dispatchNotificationOnce`), keyed so a
 * re-run on the same day never notifies anyone twice.
 *
 * Each reminder fires on one specific day — the day the follow-up is due, the day before a
 * commitment, the day after it was missed, the day a high-value bill becomes overdue, a week before
 * and on the day retention is expected back — rather than every day while the condition holds, so
 * the module never trains people to ignore it.
 */

import { addDays } from './calculations.ts';
import { toPaise } from './money.ts';
import type { Bill } from './types';

export type ReminderKind = 'follow_up_due' | 'commitment_tomorrow' | 'commitment_missed' | 'payment_overdue' | 'retention_due';

export interface Reminder {
  kind: ReminderKind;
  billId: string;
  organizationId?: string;
  recipients: string[];
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  /** Stable per bill, kind and day. */
  dedupeKey: string;
}

const isOpen = (bill: Bill) => !bill.isDeleted && toPaise(bill.outstandingAmount) > 0 && bill.paymentStatus !== 'received' && bill.paymentStatus !== 'adjusted';
const reference = (bill: Bill) => bill.gstInvoiceNumber || bill.billSerialNumber || bill.id;
const rupees = (value: number | undefined) => `₹${Math.round(value ?? 0).toLocaleString('en-IN')}`;

export function dueReminders(bills: readonly (Bill & { organizationId?: string })[], today: string, highValueThreshold: number): Reminder[] {
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  const inAWeek = addDays(today, 7);
  const reminders: Reminder[] = [];
  for (const bill of bills) {
    const owners = [...new Set([bill.collectionOwnerId ?? bill.createdBy].filter((id): id is string => Boolean(id)))];
    if (!owners.length) continue;
    const push = (kind: ReminderKind, title: string, body: string, severity: Reminder['severity'], recipients = owners) =>
      reminders.push({ kind, billId: bill.id, organizationId: bill.organizationId, recipients, title, body, severity, dedupeKey: `bt_${kind}_${bill.id}_${today}` });
    const label = `${reference(bill)} · ${bill.projectNameSnapshot}`;

    if (isOpen(bill)) {
      if (bill.nextFollowUpDate === today) push('follow_up_due', 'Payment follow-up due today', `${label} · ${rupees(bill.outstandingAmount)} outstanding`, 'INFO');
      if (bill.nextCommitmentDate === tomorrow) push('commitment_tomorrow', 'Client payment commitment tomorrow', `${label} · ${rupees(bill.nextCommitmentAmount)} committed`, 'INFO');
      if (bill.nextCommitmentDate === yesterday) {
        push('commitment_missed', 'Client commitment missed', `${label} · ${rupees(bill.nextCommitmentAmount)} was committed for ${yesterday}`, 'WARNING', [...new Set([...owners, bill.createdBy].filter(Boolean))]);
      }
      if (bill.dueDate === yesterday && bill.netReceivable >= highValueThreshold) {
        push('payment_overdue', 'High-value bill now overdue', `${label} · ${rupees(bill.outstandingAmount)} outstanding, due ${yesterday}`, 'CRITICAL', [...new Set([...owners, bill.createdBy].filter(Boolean))]);
      }
    }
    if (toPaise(bill.retentionDeducted) > 0 && (bill.retentionExpectedReleaseDate === inAWeek || bill.retentionExpectedReleaseDate === today)) {
      push('retention_due', bill.retentionExpectedReleaseDate === today ? 'Retention release due today' : 'Retention release due in a week', `${label} · ${rupees(bill.retentionDeducted)} retention held`, 'INFO');
    }
  }
  return reminders;
}
