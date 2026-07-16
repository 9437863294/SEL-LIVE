import { NextRequest, NextResponse } from 'next/server';

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

const FRIENDLY: Record<string, string> = {
  EMAIL_EXISTS: 'An account with this email already exists.',
  INVALID_EMAIL: 'Invalid email address.',
  OPERATION_NOT_ALLOWED: 'Email/password accounts are not enabled.',
};

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, mobile, role, status } = await req.json();

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { ok: false, error: 'name, email, password and role are required' },
        { status: 400 }
      );
    }

    // Create user via Firebase Auth REST API — runs server-side, so the browser
    // session (admin user) is completely unaffected.
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          displayName: name.trim(),
          returnSecureToken: false,
        }),
      }
    );

    const fbData = await res.json();

    if (!res.ok) {
      const code: string = fbData?.error?.message ?? '';
      const friendly =
        FRIENDLY[code] ??
        (code.startsWith('WEAK_PASSWORD') ? 'Password must be at least 6 characters.' : code || 'Failed to create user');
      return NextResponse.json({ ok: false, error: friendly }, { status: 400 });
    }

    // Return the UID so the client can write the Firestore profile
    // (the admin is still signed in client-side, so client SDK can write directly)
    return NextResponse.json({ ok: true, uid: fbData.localId });
  } catch (err: any) {
    console.error('[create-user]', err);
    return NextResponse.json(
      { ok: false, error: err.message ?? 'Server error' },
      { status: 500 }
    );
  }
}
