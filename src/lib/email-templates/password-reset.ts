import 'server-only';

interface PasswordResetTemplateOptions {
  resetUrl: string;
  email: string;
  displayName?: string | null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function createPasswordResetEmail({
  resetUrl,
  email,
  displayName,
}: PasswordResetTemplateOptions) {
  // Use raw URL in href — DO NOT escapeHtml the '&' separators.
  // &amp; in href breaks enterprise email security gateways (Safe Links, Barracuda, etc.)
  // that URL-encode the literal href text; the browser then receives &amp; as part of
  // the query string, making oobCode invisible to URLSearchParams.get('oobCode').
  const hrefUrl  = resetUrl;
  const safeUrl  = escapeHtml(resetUrl);   // for visible text only (renders & correctly)
  const safeEmail = escapeHtml(email);
  const safeName = displayName?.trim() ? escapeHtml(displayName.trim()) : '';
  const greeting = safeName ? `Hello ${safeName},` : 'Hello,';

  const subject = 'Reset your SEL Platform password';
  const text = [
    displayName?.trim() ? `Hello ${displayName.trim()},` : 'Hello,',
    '',
    'We received a request to reset the password for your SEL Platform account.',
    `Account: ${email}`,
    '',
    `Reset your password: ${resetUrl}`,
    '',
    'This secure link expires automatically and can only be used once.',
    'If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.',
    '',
    'Siddhartha Engineering Limited',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    Use this secure link to choose a new password for your SEL Platform account.
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- Header: identical to the welcome email -->
          <tr>
            <td style="background:linear-gradient(160deg,#0f172a 0%,#1a2744 60%,#0f172a 100%);border-radius:20px 20px 0 0;padding:36px 44px 32px;text-align:center;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:18px;">
                    <img src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2FSEL%20%20logo2%20.png?alt=media&amp;token=39b0f804-0610-4f3a-b26e-8ce334f94788" alt="Siddhartha Engineering Limited" width="160" height="auto" style="display:block;max-width:160px;height:auto;border:0;" />
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

          <!-- Reset banner -->
          <tr>
            <td style="background:linear-gradient(135deg,#10b981 0%,#0d9488 100%);padding:28px 44px;text-align:center;">
              <p style="margin:0;font-size:30px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Reset Your Password</p>
              <p style="margin:8px 0 0;font-size:15px;color:rgba(255,255,255,0.82);">A secure password reset was requested</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:40px 44px;">
              <p style="margin:0 0 10px;font-size:18px;font-weight:700;color:#0f172a;">${greeting}</p>
              <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.75;">
                We received a request to reset the password for your <strong style="color:#0f172a;">SEL Platform</strong> account.
                Use the secure link below to choose a new password.
              </p>

              <!-- Request details card -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid #e2e8f0;border-radius:14px;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 18px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;">Password Reset Request</p>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-bottom:14px;">
                          <p style="margin:0 0 5px;font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;">Account Email</p>
                          <p style="margin:0;font-size:15px;font-weight:600;color:#1e293b;font-family:'Courier New',Courier,monospace;word-break:break-all;">${safeEmail}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="border-top:1px solid #e2e8f0;padding-top:14px;">
                          <p style="margin:0 0 5px;font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;">Link Status</p>
                          <p style="margin:0;font-size:14px;font-weight:600;color:#10b981;">Secure &bull; One-time use</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA: identical styling to the welcome email -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:linear-gradient(135deg,#10b981 0%,#0d9488 100%);border-radius:12px;">
                          <a href="${hrefUrl}" target="_blank" style="display:inline-block;padding:15px 48px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">Reset My Password &rarr;</a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:10px 0 0;font-size:12px;color:#94a3b8;">Secure password reset link</p>
                  </td>
                </tr>
              </table>

              <!-- Security notice -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:18px 22px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#92400e;">&#9888;&#65039; Important Security Notice</p>
                    <p style="margin:0;font-size:13px;color:#78350f;line-height:1.65;">
                      This link expires automatically and can only be used once. If you did not request this reset, safely ignore this email&mdash;your password will remain unchanged. Never share this link with anyone.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Steps -->
              <p style="margin:0 0 14px;font-size:14px;font-weight:700;color:#0f172a;">Reset your password in 3 steps:</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <table cellpadding="0" cellspacing="0" border="0"><tr>
                      <td style="vertical-align:top;padding-right:12px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#10b981;border-radius:50%;width:24px;height:24px;text-align:center;vertical-align:middle;"><span style="font-size:11px;font-weight:700;color:#fff;">1</span></td></tr></table></td>
                      <td style="vertical-align:top;padding-top:3px;"><p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">Click the <strong>Reset My Password</strong> button above</p></td>
                    </tr></table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <table cellpadding="0" cellspacing="0" border="0"><tr>
                      <td style="vertical-align:top;padding-right:12px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#10b981;border-radius:50%;width:24px;height:24px;text-align:center;vertical-align:middle;"><span style="font-size:11px;font-weight:700;color:#fff;">2</span></td></tr></table></td>
                      <td style="vertical-align:top;padding-top:3px;"><p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">Choose and confirm a strong new password</p></td>
                    </tr></table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <table cellpadding="0" cellspacing="0" border="0"><tr>
                      <td style="vertical-align:top;padding-right:12px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#10b981;border-radius:50%;width:24px;height:24px;text-align:center;vertical-align:middle;"><span style="font-size:11px;font-weight:700;color:#fff;">3</span></td></tr></table></td>
                      <td style="vertical-align:top;padding-top:3px;"><p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">Return to SEL Platform and sign in with your new password</p></td>
                    </tr></table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.7;">
                If the button does not work, copy and paste this secure address into your browser:<br>
                <a href="${hrefUrl}" style="color:#10b981;font-weight:600;text-decoration:none;word-break:break-all;">${safeUrl}</a>
              </p>
              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.7;">
                If you need assistance, contact your system administrator or write to us at
                <a href="mailto:data.management@selindia.net" style="color:#10b981;font-weight:600;text-decoration:none;">data.management@selindia.net</a>.
              </p>
            </td>
          </tr>

          <tr><td style="background:linear-gradient(135deg,#10b981,#0d9488);height:3px;"></td></tr>

          <!-- Footer: identical to the welcome email -->
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
                      This is an automated email sent by SEL Platform. Please do not reply directly to this message.<br>
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

  return { subject, text, html };
}
