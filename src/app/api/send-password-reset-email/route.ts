import { NextRequest, NextResponse } from 'next/server';

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ ok: false, error: 'Email required' }, { status: 400 });
    }

    const normalized = email.trim().toLowerCase();

    // Trigger Firebase's password reset email via REST API — no service account needed.
    // Firebase sends the email; the reset link points to our /auth/action page
    // (set the action URL in Firebase Console → Authentication → Email Templates).
    await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: normalized }),
      }
    );

    // Always return ok:true — prevents email enumeration
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[send-password-reset-email]', err);
    return NextResponse.json({ ok: true }); // don't leak errors
  }
}
