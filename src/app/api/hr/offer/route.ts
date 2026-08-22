import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  DEFAULT_DOCUMENT_CHECKLIST,
  HR_COLLECTIONS,
  LIVE_OFFER_STATUSES,
  evaluateOfferValidity,
  financialYearForHrDate,
  hrDocumentNumber,
  type HrOffer,
  type HrSettings,
} from '@/lib/hr-requirement';

/**
 * The candidate offer portal's server side (spec section 30).
 *
 * Runs on the Admin SDK rather than letting the public page read Firestore directly, for one
 * decisive reason: a security rule that let an unauthenticated client read `offers` by token would
 * expose every offer to anyone able to guess a token, and a rule that let it *write* would expose the
 * acceptance path. Here the token is the only thing the caller may supply, the response carries only
 * the fields the candidate is entitled to see, and the write path is fixed.
 *
 * `GET  /api/hr/offer?token=…`  → the offer as the candidate sees it (and marks it viewed)
 * `POST /api/hr/offer`          → `{ token, decision: 'accept' | 'reject', … }`
 */

/** Never send the candidate the internal record — only what the letter itself contains. */
function candidateView(offer: HrOffer & { id: string }) {
  return {
    offerNumber: offer.offerNumber,
    candidateName: offer.candidateName,
    designation: offer.designation,
    jobTitle: offer.jobTitle || offer.designation,
    grade: offer.grade,
    departmentName: offer.departmentName || '',
    projectName: offer.projectName || '',
    location: offer.location || '',
    reportingToName: offer.reportingToName || '',
    employmentType: offer.employmentType,
    offeredCtc: offer.offeredCtc,
    ctcBreakup: offer.ctcBreakup || [],
    joiningBonus: offer.joiningBonus || 0,
    probationMonths: offer.probationMonths ?? null,
    employmentConditions: offer.employmentConditions || '',
    specialConditions: offer.specialConditions || '',
    joiningDate: offer.joiningDate,
    validUntil: offer.validUntil || '',
    letterUrl: offer.letterUrl || '',
    status: offer.status,
  };
}

async function findByToken(token: string) {
  const db = getFirebaseAdminFirestore();
  const snapshot = await db
    .collection(HR_COLLECTIONS.offers)
    .where('portalToken', '==', token)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { db, ref: doc.ref, offer: { id: doc.id, ...doc.data() } as HrOffer & { id: string } };
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')?.trim();
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const found = await findByToken(token);
  // Deliberately the same response for "no such token" and "token no longer valid": distinguishing
  // them would let someone enumerate which tokens ever existed.
  if (!found) return NextResponse.json({ error: 'This offer link is not valid.' }, { status: 404 });

  const { ref, offer } = found;
  const expiry = offer.portalTokenExpiresAt?.toDate?.();
  if (expiry && expiry.getTime() < Date.now()) {
    return NextResponse.json({ error: 'This offer link has expired. Please contact HR.' }, { status: 410 });
  }

  const validity = evaluateOfferValidity({ status: offer.status, validUntil: offer.validUntil });

  // First open marks it viewed, which is what puts VIEWED on the recruiter's screen (section 29).
  if (offer.status === 'SENT') {
    await ref.update({ status: 'VIEWED', viewedAt: FieldValue.serverTimestamp() });
  }

  return NextResponse.json({
    offer: candidateView(offer),
    canRespond: LIVE_OFFER_STATUSES.includes(offer.status) && offer.status !== 'ACCEPTED' && !validity.expired,
    validity,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { token?: string; decision?: 'accept' | 'reject'; declaration?: string; reason?: string; signedOfferUrl?: string }
    | null;

  const token = body?.token?.trim();
  if (!token || !body?.decision) return NextResponse.json({ error: 'Missing token or decision' }, { status: 400 });

  const found = await findByToken(token);
  if (!found) return NextResponse.json({ error: 'This offer link is not valid.' }, { status: 404 });

  const { db, ref, offer } = found;
  const expiry = offer.portalTokenExpiresAt?.toDate?.();
  if (expiry && expiry.getTime() < Date.now()) {
    return NextResponse.json({ error: 'This offer link has expired. Please contact HR.' }, { status: 410 });
  }
  if (!LIVE_OFFER_STATUSES.includes(offer.status) || offer.status === 'ACCEPTED') {
    return NextResponse.json({ error: 'This offer has already been responded to.' }, { status: 409 });
  }
  const validity = evaluateOfferValidity({ status: offer.status, validUntil: offer.validUntil });
  if (validity.expired) {
    return NextResponse.json({ error: 'This offer has expired. Please contact HR.' }, { status: 410 });
  }

  const actor = { userId: offer.candidateId, userName: `${offer.candidateName} (candidate portal)` };
  const logActivity = (action: string, summary: string) =>
    db.collection(HR_COLLECTIONS.activities).add({
      organizationId: offer.organizationId,
      entityType: 'offer',
      entityId: offer.id,
      requirementId: offer.requirementId,
      action,
      summary,
      oldValue: null,
      newValue: null,
      userId: actor.userId,
      userName: actor.userName,
      remarks: '',
      createdAt: FieldValue.serverTimestamp(),
    });

  /* ---------- Decline ---------- */
  if (body.decision === 'reject') {
    const reason = body.reason?.trim() || 'Declined by the candidate through the offer portal.';
    await ref.update({
      status: 'REJECTED',
      respondedAt: FieldValue.serverTimestamp(),
      rejectionReason: reason,
      portalToken: '',
    });
    if (offer.applicationId) {
      await db.collection(HR_COLLECTIONS.applications).doc(offer.applicationId).update({
        stage: 'OFFER_REJECTED',
        stageChangedAt: FieldValue.serverTimestamp(),
        exitReason: 'Offer declined',
        exitRemarks: reason,
        exitedAt: FieldValue.serverTimestamp(),
      });
    }
    await logActivity('Offer declined via portal', `${offer.candidateName} declined ${offer.offerNumber}. ${reason}`);
    return NextResponse.json({ ok: true, status: 'REJECTED' });
  }

  /* ---------- Accept ---------- */
  const settingsDoc = await db.collection(HR_COLLECTIONS.settings).doc(offer.organizationId).get();
  const settings = settingsDoc.data() as Partial<HrSettings> | undefined;
  if (settings?.offers?.requireSignedCopy && !body.signedOfferUrl) {
    return NextResponse.json({ error: 'A signed copy of the offer is required.' }, { status: 400 });
  }

  /*
   * Mirrors `acceptOffer` in hr-requirement-service.ts: acceptance is what creates the joining record
   * and the pre-joining checklist (spec section 31), so a candidate accepting online and HR recording
   * a verbal acceptance leave the module in the same state.
   */
  const financialYear = financialYearForHrDate();
  const counterRef = db
    .collection(HR_COLLECTIONS.counters)
    .doc(`${offer.organizationId}__joining__${financialYear}`.replace(/\//g, '_'));

  const joiningRef = db.collection(HR_COLLECTIONS.joiningRecords).doc();
  await db.runTransaction(async transaction => {
    const counter = await transaction.get(counterRef);
    const sequence = Number(counter.data()?.nextSequence || 1);
    const joiningNumber = hrDocumentNumber({ kind: 'joining', financialYear, sequence });

    transaction.set(counterRef, {
      organizationId: offer.organizationId,
      kind: 'joining',
      financialYear,
      nextSequence: sequence + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(joiningRef, {
      organizationId: offer.organizationId,
      joiningNumber,
      requirementId: offer.requirementId,
      requirementNumber: offer.requirementNumber || '',
      applicationId: offer.applicationId,
      candidateId: offer.candidateId,
      candidateName: offer.candidateName,
      offerId: offer.id,
      designation: offer.designation,
      grade: offer.grade,
      departmentId: offer.departmentId || '',
      departmentName: offer.departmentName || '',
      projectId: offer.projectId || '',
      projectName: offer.projectName || '',
      locationId: offer.locationId || '',
      location: offer.location || '',
      reportingToId: offer.reportingToId || '',
      reportingToName: offer.reportingToName || '',
      employmentType: offer.employmentType,
      ctc: offer.offeredCtc,
      plannedJoiningDate: offer.joiningDate,
      status: 'DOCUMENTS_PENDING',
      documentsReady: false,
      documentCompletionPercent: 0,
      remindersSent: [],
      onboarding: {},
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor.userId,
      createdByName: actor.userName,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(ref, {
      status: 'ACCEPTED',
      respondedAt: FieldValue.serverTimestamp(),
      acceptanceDeclaration: body.declaration || 'Accepted through the candidate offer portal.',
      acceptanceIp: request.headers.get('x-forwarded-for') || '',
      signedOfferUrl: body.signedOfferUrl || '',
      portalToken: '',
    });
  });

  const checklist = settings?.documents?.checklist?.length ? settings.documents.checklist : DEFAULT_DOCUMENT_CHECKLIST;
  const applicable = checklist.filter(
    item => !item.appliesTo?.length || item.appliesTo.includes(offer.employmentType),
  );
  if (applicable.length > 0) {
    const batch = db.batch();
    for (const item of applicable) {
      batch.set(db.collection(HR_COLLECTIONS.preJoining).doc(), {
        organizationId: offer.organizationId,
        requirementId: offer.requirementId,
        applicationId: offer.applicationId,
        candidateId: offer.candidateId,
        offerId: offer.id,
        joiningRecordId: joiningRef.id,
        documentType: item.documentType,
        mandatory: item.mandatory !== false,
        status: 'PENDING',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.userId,
        createdByName: actor.userName,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  if (offer.applicationId) {
    await db.collection(HR_COLLECTIONS.applications).doc(offer.applicationId).update({
      stage: 'OFFER_ACCEPTED',
      stageChangedAt: FieldValue.serverTimestamp(),
      joiningRecordId: joiningRef.id,
    });
  }

  await logActivity(
    'Offer accepted via portal',
    `${offer.candidateName} accepted ${offer.offerNumber}; joining ${offer.joiningDate}.`,
  );

  return NextResponse.json({ ok: true, status: 'ACCEPTED', documentsCreated: applicable.length });
}
