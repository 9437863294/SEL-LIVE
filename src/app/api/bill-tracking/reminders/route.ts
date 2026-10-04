import { NextResponse } from 'next/server';

import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { dispatchNotificationOnce } from '@/lib/notifications-server';
import { withConfigDefaults } from '@/lib/bill-tracking/defaults';
import { dueReminders } from '@/lib/bill-tracking/reminders';
import { indiaToday } from '@/lib/bill-tracking/server/context';
import { BT_COLLECTIONS } from '@/lib/bill-tracking/server/store';
import type { Bill, BillTrackingConfig } from '@/lib/bill-tracking/types';

/**
 * Daily Bill Tracking reminders (Vercel cron, `CRON_SECRET`): follow-ups due, client commitments
 * tomorrow or missed yesterday, high-value bills that became overdue, retention coming due. Sent
 * through the shared notification engine with one key per bill, kind and day, so a re-run is a
 * no-op and users' notification settings apply as for every other module.
 */
export async function GET(request: Request) {
  // Fail closed: without a configured secret this route would let anyone trigger notifications.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = getFirebaseAdminFirestore();
  const today = indiaToday();
  const snapshot = await db.collection(BT_COLLECTIONS.bills).where('isDeleted', '==', false).get();
  const bills = snapshot.docs.map((doc) => ({ ...(doc.data() as Bill & { organizationId?: string }), id: doc.id }));

  const thresholds = new Map<string, number>();
  for (const organizationId of new Set(bills.map((bill) => bill.organizationId ?? 'default'))) {
    const config = await db.collection(BT_COLLECTIONS.config).doc(organizationId).get();
    thresholds.set(organizationId, withConfigDefaults(config.data() as Partial<BillTrackingConfig> | undefined).settings.highValueThreshold);
  }

  let sent = 0;
  const byKind: Record<string, number> = {};
  for (const [organizationId, threshold] of thresholds) {
    const reminders = dueReminders(bills.filter((bill) => (bill.organizationId ?? 'default') === organizationId), today, threshold);
    for (const reminder of reminders) {
      const delivered = await dispatchNotificationOnce(
        { userIds: reminder.recipients },
        {
          type: 'record_assigned',
          module: ACTIVITY_MODULES.BILL_TRACKING,
          title: reminder.title,
          body: reminder.body,
          severity: reminder.severity,
          itemId: reminder.billId,
          link: `/bill-tracking/bills/${reminder.billId}${reminder.kind === 'follow_up_due' || reminder.kind.startsWith('commitment') ? '?tab=followup' : ''}`,
          organizationId,
        },
        reminder.dedupeKey,
      );
      sent += delivered;
      byKind[reminder.kind] = (byKind[reminder.kind] ?? 0) + delivered;
    }
  }
  return NextResponse.json({ today, bills: bills.length, sent, byKind });
}
