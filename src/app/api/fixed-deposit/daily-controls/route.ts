import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';

const activeStatuses = ['ACTIVE', 'PARTIALLY_UTILIZED', 'FULLY_UTILIZED', 'MATURITY_APPROACHING'];
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

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
  for (const fdDoc of deposits.docs) { const fd = fdDoc.data(); const maturity = fd.maturityDate?.toDate?.() as Date | undefined; if (!maturity) continue; maturity.setHours(0, 0, 0, 0); const days = Math.ceil((maturity.getTime() - now.getTime()) / 86400000); const nextStatus = days < 0 ? 'MATURED' : days <= 90 ? 'MATURITY_APPROACHING' : Number(fd.availableAmount || 0) <= 0 ? 'FULLY_UTILIZED' : Number(fd.availableAmount || 0) < Number(fd.eligibleValue || 0) ? 'PARTIALLY_UTILIZED' : 'ACTIVE'; if (nextStatus !== fd.status) { batch.update(fdDoc.ref, { status: nextStatus, updatedBy: 'SYSTEM', updatedByName: 'Daily Controls', updatedAt: FieldValue.serverTimestamp() }); batchCount++; statusesUpdated++; }
    const alertDays = days < 0 ? true : [90,60,30,15,7,0].includes(days); if (alertDays) { const key = `${fdDoc.id}_${dateKey(now)}_${days < 0 ? 'OVERDUE' : days}`.replace(/[^A-Za-z0-9_-]/g, '_'); const notificationRef = firestore.collection('userNotifications').doc(key); batch.set(notificationRef, { organizationId: fd.organizationId, module: 'Fixed Deposit Management', type: days < 0 ? 'FD_MATURITY_OVERDUE' : 'FD_MATURITY_ALERT', severity: days <= 7 ? 'CRITICAL' : days <= 30 ? 'HIGH' : 'MEDIUM', title: days < 0 ? `FD ${fd.fdNumber} matured and is not closed` : `FD ${fd.fdNumber} matures in ${days} days`, message: `${fd.bankName} · Principal ${fd.principalAmount} · Available ${fd.availableAmount}`, fdId: fdDoc.id, link: `/fixed-deposit/${fdDoc.id}`, targetRoles: days <= 7 ? ['Director Finance','Finance Manager'] : ['Finance Executive','Finance Manager'], status: 'UNREAD', generatedForDate: dateKey(now), createdAt: FieldValue.serverTimestamp() }, { merge: false }); batchCount++; notificationsCreated++; }
    if (batchCount >= 400) await commit();
  }
  await commit();
  return NextResponse.json({ success: true, date: dateKey(now), depositsChecked: deposits.size, statusesUpdated, expiredReservations, notificationsCreated });
}

export async function GET(request: NextRequest) { return POST(request); }
