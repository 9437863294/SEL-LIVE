import { NextResponse } from 'next/server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { AccessDeniedError, accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { canAccessModule } from '@/lib/access-control';
import { RP_COLLECTIONS, type PaymentStatus } from '@/lib/recurring-payments';
import type { BillCheckResponse } from '@/components/recurring-payments/bill-check-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * The two checks "Submit Bill" makes against the rest of the register, for someone working the
 * step without a Recurring Payments permission.
 *
 * The security rules let such a person read only the obligations that name them, but submitting a
 * bill compares it with every other obligation in the organization — is this vendor's bill number
 * already taken? what did this master's earlier cycles cost? — so the comparison is made here,
 * and only its outcome goes back: whether the number is a duplicate, and the amounts and dates of
 * the same master's earlier cycles that the variance warning is worked out from.
 *
 *   POST /api/recurring-payments/bill-check  { paymentId, billNumber }
 *
 * Open to the obligation's current assignees and to module users; nobody else learns anything.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    const body = (await request.json().catch(() => ({}))) as { paymentId?: unknown; billNumber?: unknown };
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';
    const billNumber = typeof body.billNumber === 'string' ? body.billNumber.trim() : '';
    if (!paymentId || paymentId.includes('/')) {
      return NextResponse.json({ error: 'paymentId is required.' }, { status: 400, headers: NO_STORE });
    }

    const firestore = getFirebaseAdminFirestore();
    const snapshot = await firestore.collection(RP_COLLECTIONS.payments).doc(paymentId).get();
    const payment = snapshot.data();
    const assignees = Array.isArray(payment?.assignees) ? (payment.assignees as unknown[]) : [];
    if (!payment || (!assignees.includes(context.userId) && !canAccessModule(context.access, 'Recurring Payments'))) {
      // The same answer for a payment that does not exist and one that is not yours.
      throw new AccessDeniedError('This task is not assigned to you.');
    }

    const register = await firestore
      .collection(RP_COLLECTIONS.payments)
      .where('organizationId', '==', payment.organizationId)
      .select('vendorName', 'billNumber', 'deleted', 'masterId', 'dueDate', 'billAmount', 'status')
      .get();

    const vendor = String(payment.vendorName || '').toLowerCase();
    const number = billNumber.toLowerCase();
    let duplicate = false;
    const history: BillCheckResponse['history'] = [];
    for (const entry of register.docs) {
      if (entry.id === paymentId) continue;
      const data = entry.data();
      // A deleted obligation neither reserves its bill number nor counts towards the baseline —
      // exactly as on the module user's screen, which reads the register without them.
      if (data.deleted === true) continue;
      if (number && String(data.vendorName || '').toLowerCase() === vendor && String(data.billNumber || '').toLowerCase() === number) {
        duplicate = true;
      }
      if (payment.masterId && data.masterId === payment.masterId) {
        history.push({
          id: entry.id,
          masterId: String(data.masterId),
          dueDate: String(data.dueDate || ''),
          billAmount: Number(data.billAmount || 0),
          status: String(data.status || '') as PaymentStatus,
        });
      }
    }

    const response: BillCheckResponse = { duplicate, history };
    return NextResponse.json(response, { headers: NO_STORE });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}
