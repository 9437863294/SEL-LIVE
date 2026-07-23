import { randomInt } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { sendEmail } from '@/lib/mail';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  authenticateLocationAdmin,
  hashLocationOtp,
  LOCATION_OTP_CHALLENGES_COLLECTION,
  LOCATION_OTP_RATE_LIMITS_COLLECTION,
  LOCATION_OTP_RESEND_MS,
  LOCATION_OTP_TTL_MS,
  locationErrorResponse,
  LocationAccessError,
  newOpaqueToken,
} from '@/lib/location-tracking-admin';

export const runtime = 'nodejs';

const maskEmail = (email: string) => {
  const [local, domain = ''] = email.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export async function POST(request: Request) {
  try {
    const actor = await authenticateLocationAdmin(request, 'View');
    const firestore = getFirebaseAdminFirestore();
    const now = Date.now();
    const challengeId = newOpaqueToken(24);
    const otp = String(randomInt(100000, 1000000));
    const rateRef = firestore.collection(LOCATION_OTP_RATE_LIMITS_COLLECTION).doc(actor.id);
    const challengeRef = firestore.collection(LOCATION_OTP_CHALLENGES_COLLECTION).doc(challengeId);

    await firestore.runTransaction(async (transaction) => {
      const rateSnapshot = await transaction.get(rateRef);
      const lastSentAtMs = Number(rateSnapshot.data()?.lastSentAtMs || 0);
      if (now - lastSentAtMs < LOCATION_OTP_RESEND_MS) {
        const waitSeconds = Math.ceil((LOCATION_OTP_RESEND_MS - (now - lastSentAtMs)) / 1000);
        throw new LocationAccessError(`Please wait ${waitSeconds} seconds before requesting another code.`, 429);
      }

      transaction.set(rateRef, { userId: actor.id, lastSentAtMs: now, challengeId }, { merge: true });
      transaction.set(challengeRef, {
        userId: actor.id,
        email: actor.email,
        codeHash: hashLocationOtp(challengeId, otp),
        attempts: 0,
        consumed: false,
        createdAt: FieldValue.serverTimestamp(),
        expiresAtMs: now + LOCATION_OTP_TTL_MS,
      });
    });

    const result = await sendEmail({
      to: actor.email,
      subject: 'SEL location tracking access code',
      html: `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center"><table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:#0f172a;padding:24px 30px;color:#fff"><strong>Siddhartha Engineering Limited</strong><div style="font-size:12px;color:#94a3b8;margin-top:4px">Sensitive settings verification</div></td></tr><tr><td style="padding:30px"><p style="margin:0 0 12px;font-size:18px;font-weight:700">Hello ${escapeHtml(actor.name)},</p><p style="margin:0 0 22px;color:#475569;line-height:1.6">Use this one-time code to open Location Tracking settings:</p><div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:18px;text-align:center;font-size:30px;font-weight:800;letter-spacing:8px;color:#1d4ed8">${otp}</div><p style="margin:20px 0 0;color:#64748b;font-size:13px;line-height:1.6">This code expires in 10 minutes and can be attempted up to five times. If you did not request it, do not share it.</p></td></tr></table></td></tr></table></body></html>`,
    });

    if (!result.success) {
      await Promise.allSettled([challengeRef.delete(), rateRef.delete()]);
      throw new LocationAccessError('The verification email could not be sent. Try again later.', 503);
    }

    return Response.json({
      challengeId,
      maskedEmail: maskEmail(actor.email),
      expiresAtMs: now + LOCATION_OTP_TTL_MS,
    });
  } catch (error) {
    return locationErrorResponse(error);
  }
}
