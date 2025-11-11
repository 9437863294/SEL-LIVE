import { NextResponse } from 'next/server';

const PASSCODE = process.env.PRINT_AUTH_PASSCODE || 'Sel@123';

export async function POST(req: Request) {
  const { code } = await req.json().catch(() => ({ code: '' }));

  if (code !== PASSCODE) {
    return NextResponse.json(
      { message: 'Invalid passcode.' },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ success: true });

  res.cookies.set('print_auth', 'ok', {
    maxAge: 60 * 60 * 24, // Set cookie to expire in 24 hours
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return res;
}
