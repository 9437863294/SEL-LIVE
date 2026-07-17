import { app } from '@/lib/firebase';

const FRIENDLY: Record<string, string> = {
  EMAIL_EXISTS: 'An account with this email already exists.',
  INVALID_EMAIL: 'Invalid email address.',
  OPERATION_NOT_ALLOWED: 'Email/password accounts are not enabled.',
};

export async function POST(req: Request) {
  try {
    const { name, email, password, mobile, role, status } = await req.json();

    if (!name || !email || !password || !role) {
      return Response.json(
        { ok: false, error: 'name, email, password and role are required' },
        { status: 400 }
      );
    }

    const apiKey = app.options.apiKey;

    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
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
        (code.startsWith('WEAK_PASSWORD') ? 'Password must be at least 6 characters.' : (code || 'Failed to create user'));
      return Response.json({ ok: false, error: friendly }, { status: 400 });
    }

    return Response.json({ ok: true, uid: fbData.localId });
  } catch (err: any) {
    console.error('[create-user]', err);
    return Response.json(
      { ok: false, error: err.message ?? 'Server error' },
      { status: 500 }
    );
  }
}
