import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { sendEmail } from '@/lib/mail';

function getAdminAuth() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getAuth();
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ ok: false, error: 'Email required' }, { status: 400 });
    }

    const normalized = email.trim().toLowerCase();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://seltech.store';

    let resetLink: string;
    try {
      const adminAuth = getAdminAuth();
      // Firebase Admin generates the oobCode — we extract it and build our own branded URL
      const firebaseLink = await adminAuth.generatePasswordResetLink(normalized, {
        url: appUrl,
        handleCodeInApp: false,
      });
      const parsed = new URL(firebaseLink);
      const oobCode = parsed.searchParams.get('oobCode');
      resetLink = `${appUrl}/auth/action?mode=resetPassword&oobCode=${encodeURIComponent(oobCode!)}`;
    } catch (err: any) {
      // Silently succeed for unknown emails — prevents account enumeration
      const code: string = err?.code || err?.errorInfo?.code || err?.message || '';
      if (
        code.includes('user-not-found') ||
        code.includes('USER_NOT_FOUND') ||
        code.includes('INVALID_EMAIL')
      ) {
        return NextResponse.json({ ok: true });
      }
      throw err;
    }

    const html = buildPasswordResetEmail({ email: normalized, resetLink });

    await sendEmail({
      to: normalized,
      subject: 'Reset Your SEL Platform Password',
      html,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[send-password-reset-email]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

function buildPasswordResetEmail({
  email,
  resetLink,
}: {
  email: string;
  resetLink: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Reset Your SEL Platform Password</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- ── HEADER ── -->
          <tr>
            <td style="background:linear-gradient(160deg,#0f172a 0%,#1a1030 60%,#0f172a 100%);border-radius:20px 20px 0 0;padding:36px 44px 32px;text-align:center;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:18px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);border-radius:14px;width:56px;height:56px;text-align:center;vertical-align:middle;">
                          <span style="font-size:21px;font-weight:800;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;letter-spacing:-0.5px;">SE</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Siddhartha Engineering Limited</p>
                    <p style="margin:6px 0 0;font-size:12px;color:#64748b;letter-spacing:2px;text-transform:uppercase;">SEL PLATFORM</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── ACCENT BAR ── -->
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 50%,#7c3aed 100%);padding:22px 44px;text-align:center;">
              <p style="margin:0;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Password Reset Request</p>
              <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.80);">We received a request to reset your password</p>
            </td>
          </tr>

          <!-- ── BODY ── -->
          <tr>
            <td style="background-color:#ffffff;padding:40px 44px;">

              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:16px;color:#475569;line-height:1.75;">
                Hello, <strong style="color:#0f172a;">${escHtml(email)}</strong>
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.75;">
                A password reset was requested for this account on the SEL Platform.
                Click the button below to choose a new password. This link is valid for <strong style="color:#0f172a;">1 hour</strong>.
              </p>

              <!-- Reset button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);border-radius:12px;">
                          <a href="${escHtml(resetLink)}"
                            style="display:inline-block;padding:15px 52px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
                            Reset My Password &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Link fallback -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;">
                    <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Or copy this link into your browser</p>
                    <p style="margin:0;font-size:12px;color:#7c3aed;word-break:break-all;font-family:'Courier New',Courier,monospace;">${escHtml(resetLink)}</p>
                  </td>
                </tr>
              </table>

              <!-- Security notice -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:18px 22px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#92400e;">&#9888;&#65039; Didn't request this?</p>
                    <p style="margin:0;font-size:13px;color:#78350f;line-height:1.65;">
                      If you did not request a password reset, you can safely ignore this email.
                      Your password will remain unchanged. Never share this link with anyone.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Expiry reminder -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 20px;">
                    <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">
                      &#128274;&nbsp;<strong>Link expires in 1 hour.</strong>
                      If it expires, return to the login page and request a new reset link.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ── DIVIDER ── -->
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed,#a855f7);height:3px;"></td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td style="background:#0f172a;border-radius:0 0 20px 20px;padding:30px 44px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:18px;border-bottom:1px solid #1e293b;">
                    <p style="margin:0;font-size:15px;font-weight:700;color:#f8fafc;">Siddhartha Engineering Limited</p>
                    <p style="margin:5px 0 0;font-size:12px;color:#475569;letter-spacing:0.3px;">Engineering Excellence &bull; Digital Innovation</p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:18px;">
                    <p style="margin:0 0 5px;font-size:12px;color:#64748b;">
                      &#128231;&nbsp;<a href="mailto:data.management@selindia.net" style="color:#64748b;text-decoration:none;">data.management@selindia.net</a>
                      &nbsp;&nbsp;&#127760;&nbsp;<a href="https://seltech.store" style="color:#64748b;text-decoration:none;">seltech.store</a>
                    </p>
                    <p style="margin:14px 0 0;font-size:11px;color:#334155;line-height:1.6;">
                      This is an automated security email. Please do not reply directly to this message.<br>
                      &copy; ${new Date().getFullYear()} Siddhartha Engineering Limited. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
