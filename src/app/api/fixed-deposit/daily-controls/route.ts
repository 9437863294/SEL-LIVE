import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { dispatchNotificationOnce, resolveRoleRecipientsServer } from '@/lib/notifications-server';
import { logServerActivity, SYSTEM_LOG_ACTOR } from '@/lib/activity-logger-server';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

const activeStatuses = ['ACTIVE', 'PARTIALLY_UTILIZED', 'FULLY_UTILIZED', 'MATURITY_APPROACHING'];
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

// Who hears about a maturing deposit. Deposits inside a week are escalated to the
// people who can act on them; anything further out goes to the desk that tracks them.
const URGENT_ROLES = ['Director Finance', 'Finance Manager'];
const ROUTINE_ROLES = ['Finance Executive', 'Finance Manager'];

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-cron-secret');
  if (secret && supplied !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const firestore = getFirebaseAdminFirestore(); const now = new Date(); now.setHours(0, 0, 0, 0); const today = Timestamp.fromDate(now);
  let expiredReservations = 0; let statusesUpdated = 0; let notificationsCreated = 0;
  const reservations = await firestore.collection('fdReservations').where('status', '==', 'ACTIVE').where('expiryDate', '<', today).get();
  for (const reservationDoc of reservations.docs) {
    await firestore.runTransaction(async (transaction) => { const reservationRef = reservationDoc.ref; const reservationSnap = await transaction.get(reservationRef); if (!reservationSnap.exists || reservationSnap.data()?.status !== 'ACTIVE') return; const reservation = reservationSnap.data()!; const assignmentRef = firestore.collection('fdAssignments').doc(reservation.assignmentId); const fdRef = firestore.collection('fixedDeposits').doc(reservation.fdId); const [assignmentSnap, fdSnap] = await Promise.all([transaction.get(assignmentRef), transaction.get(fdRef)]); const amount = Number(reservation.amount || 0); transaction.update(reservationRef, { status: 'EXPIRED', releasedAt: FieldValue.serverTimestamp(), releasedBy: 'SYSTEM' }); if (assignmentSnap.exists && ['RESERVED','PENDING_APPROVAL'].includes(assignmentSnap.data()?.status)) transaction.update(assignmentRef, { status: 'EXPIRED', updatedBy: 'SYSTEM', updatedByName: 'Daily Controls', updatedAt: FieldValue.serverTimestamp() }); if (fdSnap.exists) { const fd = fdSnap.data()!; const reserved = Math.max(0, Number(fd.reservedAmount || 0) - amount); const available = Math.max(0, Number(fd.eligibleValue || 0) - Number(fd.bgUtilizedAmount || 0) - Number(fd.lcUtilizedAmount || 0) - reserved); transaction.update(fdRef, { reservedAmount: reserved, totalUtilizedAmount: Number(fd.bgUtilizedAmount || 0) + Number(fd.lcUtilizedAmount || 0) + reserved, availableAmount: available, updatedBy: 'SYSTEM', updatedByName: 'Daily Controls', updatedAt: FieldValue.serverTimestamp() }); } }); expiredReservations++;
  }
  const deposits = await firestore.collection('fixedDeposits').where('status', 'in', activeStatuses).get(); let batch = firestore.batch(); let batchCount = 0; const commit = async () => { if (!batchCount) return; await batch.commit(); batch = firestore.batch(); batchCount = 0; };

  // Resolved once rather than per deposit: dispatch would otherwise re-query the
  // users collection for every maturing FD in the book.
  const [urgentRecipients, routineRecipients] = await Promise.all([
    resolveRoleRecipientsServer(URGENT_ROLES),
    resolveRoleRecipientsServer(ROUTINE_ROLES),
  ]);
  let notificationsSkipped = 0;

  for (const fdDoc of deposits.docs) { const fd = fdDoc.data(); const maturity = fd.maturityDate?.toDate?.() as Date | undefined; if (!maturity) continue; maturity.setHours(0, 0, 0, 0); const days = Math.ceil((maturity.getTime() - now.getTime()) / 86400000); const nextStatus = days < 0 ? 'MATURED' : days <= 90 ? 'MATURITY_APPROACHING' : Number(fd.availableAmount || 0) <= 0 ? 'FULLY_UTILIZED' : Number(fd.availableAmount || 0) < Number(fd.eligibleValue || 0) ? 'PARTIALLY_UTILIZED' : 'ACTIVE'; if (nextStatus !== fd.status) { batch.update(fdDoc.ref, { status: nextStatus, updatedBy: 'SYSTEM', updatedByName: 'Daily Controls', updatedAt: FieldValue.serverTimestamp() }); batchCount++; statusesUpdated++; }
    const alertDays = days < 0 ? true : [90,60,30,15,7,0].includes(days);
    if (alertDays) {
      // These alerts used to be written straight to `userNotifications` carrying
      // `targetRoles` and `status: 'UNREAD'` but no `userId`. The notification bell
      // only ever queried `userId == me`, so every FD maturity alert this job has
      // ever raised was stored and shown to nobody. Dispatching resolves the roles
      // to concrete users so they actually arrive.
      //
      // The date stays in the dedupe key to preserve the existing cadence: milestone
      // days fire once, an overdue deposit nags daily. What it now also buys is
      // safety against the job running twice in one day, which previously overwrote
      // the notification and reset it to unread after the recipient had cleared it.
      const dedupeKey = `fd_${fdDoc.id}_${dateKey(now)}_${days < 0 ? 'OVERDUE' : days}`;
      const delivered = await dispatchNotificationOnce(
        { userIds: days <= 7 ? urgentRecipients : routineRecipients },
        {
          type: days < 0 ? 'fd_maturity_overdue' : 'fd_maturity_alert',
          module: ACTIVITY_MODULES.FIXED_DEPOSIT,
          severity: days <= 7 ? 'CRITICAL' : days <= 30 ? 'WARNING' : 'INFO',
          title: days < 0 ? `FD ${fd.fdNumber} matured and is not closed` : `FD ${fd.fdNumber} matures in ${days} days`,
          body: `${fd.bankName} · Principal ${fd.principalAmount} · Available ${fd.availableAmount}`,
          itemId: fdDoc.id,
          itemRef: fd.fdNumber,
          link: `/fixed-deposit/${fdDoc.id}`,
          organizationId: fd.organizationId,
        },
        dedupeKey,
      );
      notificationsCreated += delivered;
      // No recipients means the roles above match no active user — the alert is
      // raised and lands nowhere, which is worth surfacing in the run summary
      // rather than counting as a success.
      if (!delivered) notificationsSkipped++;
    }
    if (batchCount >= 400) await commit();
  }
  await commit();

  await logServerActivity({
    ...SYSTEM_LOG_ACTOR,
    module: ACTIVITY_MODULES.FIXED_DEPOSIT,
    action: 'Daily Controls Run',
    source: 'cron',
    details: { date: dateKey(now), depositsChecked: deposits.size, statusesUpdated, expiredReservations, notificationsCreated, notificationsSkipped },
  });

  return NextResponse.json({ success: true, date: dateKey(now), depositsChecked: deposits.size, statusesUpdated, expiredReservations, notificationsCreated, notificationsSkipped });
}

export async function GET(request: NextRequest) { return POST(request); }
