import { createPasswordResetEmail } from '@/lib/email-templates/password-reset';
import { getFirebaseAdminAuth } from '@/lib/firebase-admin';
import { sendEmail } from '@/lib/mail';

export const runtime = 'nodejs';

const DEFAULT_APP_URL = 'https://seltech.store';

function createCustomActionUrl(firebaseActionLink: string) {
  const generatedUrl = new URL(firebaseActionLink);
  const actionUrl = new URL('/auth/action', process.env.APP_BASE_URL || DEFAULT_APP_URL);

  actionUrl.search = generatedUrl.search;
  return actionUrl.toString();
}

function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = body?.email;

  if (!email || typeof email !== 'string') {
    return Response.json({ ok: false, error: 'Email required' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) {
    return Response.json({ ok: false, error: 'Enter a valid email address' }, { status: 400 });
  }

  try {
    const adminAuth = getFirebaseAdminAuth();
    const user = await adminAuth.getUserByEmail(normalized);
    const firebaseActionLink = await adminAuth.generatePasswordResetLink(normalized);
    const resetUrl = createCustomActionUrl(firebaseActionLink);
    const message = createPasswordResetEmail({
      resetUrl,
      email: normalized,
      displayName: user.displayName,
    });

    const delivery = await sendEmail({
      to: normalized,
      ...message,
    });

    if (!delivery.success) {
      throw new Error(delivery.error || 'SMTP delivery failed');
    }

    // Always return ok:true — prevents email enumeration
    return Response.json({ ok: true });
  } catch (err: unknown) {
    const code = typeof err === 'object' && err && 'code' in err
      ? String(err.code)
      : 'unknown';
    console.error('[send-password-reset-email] Reset email was not sent:', code);
    return Response.json({ ok: true }); // don't leak errors
  }
}
