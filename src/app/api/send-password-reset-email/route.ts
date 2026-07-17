import { app } from '@/lib/firebase';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return Response.json({ ok: false, error: 'Email required' }, { status: 400 });
    }

    const normalized = email.trim().toLowerCase();
    const apiKey = app.options.apiKey;

    await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: normalized }),
      }
    );

    // Always return ok:true — prevents email enumeration
    return Response.json({ ok: true });
  } catch (err: any) {
    console.error('[send-password-reset-email]', err);
    return Response.json({ ok: true }); // don't leak errors
  }
}
