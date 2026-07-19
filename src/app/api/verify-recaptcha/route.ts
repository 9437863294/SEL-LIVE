import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({}));
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
  }

  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    // Secret not configured — skip server verification (dev fallback)
    return NextResponse.json({ success: true });
  }

  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }).toString(),
    });
    const data: { success: boolean; 'error-codes'?: string[] } = await res.json();
    return NextResponse.json({ success: data.success, errorCodes: data['error-codes'] });
  } catch {
    return NextResponse.json({ success: false, error: 'Verification request failed' }, { status: 500 });
  }
}
