import { sendEmail } from '@/lib/mail';

export async function POST(req: Request) {
  try {
    const { name, email, password, role } = await req.json();

    if (!name || !email || !password) {
      return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }

    const html = buildWelcomeEmail({ name, email, password, role });

    const result = await sendEmail({
      to: email,
      subject: `Welcome to SEL – Your Account is Ready`,
      html,
    });

    if (!result.success) {
      return Response.json({ ok: false, error: result.error }, { status: 500 });
    }

    return Response.json({ ok: true, messageId: result.messageId });
  } catch (err: any) {
    console.error('send-welcome-email error:', err);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

function buildWelcomeEmail({
  name,
  email,
  password,
  role,
}: {
  name: string;
  email: string;
  password: string;
  role?: string;
}): string {
  const roleRow = role
    ? `<tr>
        <td style="border-top:1px solid #e2e8f0;padding-top:14px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Assigned Role</p>
          <p style="margin:0;font-size:14px;font-weight:700;color:#1e293b;">${escHtml(role)}</p>
        </td>
      </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Welcome to SEL</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- ── HEADER ── -->
          <tr>
            <td style="background:linear-gradient(160deg,#0f172a 0%,#1a2744 60%,#0f172a 100%);border-radius:20px 20px 0 0;padding:36px 44px 32px;text-align:center;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:18px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <!-- Green logo square -->
                        <td style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);border-radius:14px;width:56px;height:56px;text-align:center;vertical-align:middle;">
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

          <!-- ── WELCOME BANNER ── -->
          <tr>
            <td style="background:linear-gradient(135deg,#10b981 0%,#0d9488 100%);padding:28px 44px;text-align:center;">
              <p style="margin:0;font-size:30px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Welcome Aboard!</p>
              <p style="margin:8px 0 0;font-size:15px;color:rgba(255,255,255,0.82);">Your account has been created successfully</p>
            </td>
          </tr>

          <!-- ── BODY ── -->
          <tr>
            <td style="background-color:#ffffff;padding:40px 44px;">

              <!-- Greeting -->
              <p style="margin:0 0 10px;font-size:18px;font-weight:700;color:#0f172a;">
                Hello, ${escHtml(name)}!
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.75;">
                We&rsquo;re excited to have you as part of the <strong style="color:#0f172a;">SEL Platform</strong> family.
                Your account has been set up by the administrator. Use the credentials below to sign in for the first time.
              </p>

              <!-- Credentials card -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid #e2e8f0;border-radius:14px;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 18px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;">
                      Your Login Credentials
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <!-- Email row -->
                      <tr>
                        <td style="padding-bottom:14px;">
                          <p style="margin:0 0 5px;font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;">Email Address</p>
                          <p style="margin:0;font-size:15px;font-weight:600;color:#1e293b;font-family:'Courier New',Courier,monospace;">${escHtml(email)}</p>
                        </td>
                      </tr>
                      <!-- Password row -->
                      <tr>
                        <td style="border-top:1px solid #e2e8f0;padding-top:14px;padding-bottom:14px;">
                          <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;">Temporary Password</p>
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="background:#ffffff;border:2px dashed #cbd5e1;border-radius:8px;padding:10px 18px;">
                                <span style="font-size:22px;font-weight:700;color:#0f172a;font-family:'Courier New',Courier,monospace;letter-spacing:3px;">${escHtml(password)}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      ${roleRow}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:linear-gradient(135deg,#10b981 0%,#0d9488 100%);border-radius:12px;">
                          <a href="https://seltech.store/login"
                            style="display:inline-block;padding:15px 48px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
                            Login to SEL Platform &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:10px 0 0;font-size:12px;color:#94a3b8;">
                      <a href="https://seltech.store/login" style="color:#94a3b8;">https://seltech.store/login</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Security notice -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:18px 22px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#92400e;">&#9888;&#65039; Important Security Notice</p>
                    <p style="margin:0;font-size:13px;color:#78350f;line-height:1.65;">
                      This is a <strong>temporary password</strong> generated by your administrator.
                      For your security, please <strong>change it immediately</strong> after your first login via your profile settings.
                      Never share your credentials with anyone.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Getting started steps -->
              <p style="margin:0 0 14px;font-size:14px;font-weight:700;color:#0f172a;">Getting started in 3 steps:</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:top;padding-right:12px;">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="background:#10b981;border-radius:50%;width:24px;height:24px;text-align:center;vertical-align:middle;">
                                <span style="font-size:11px;font-weight:700;color:#fff;">1</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="vertical-align:top;padding-top:3px;">
                          <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">
                            Visit <a href="https://seltech.store/login" style="color:#10b981;font-weight:600;text-decoration:none;">seltech.store</a> and sign in with your email and temporary password
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:top;padding-right:12px;">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="background:#10b981;border-radius:50%;width:24px;height:24px;text-align:center;vertical-align:middle;">
                                <span style="font-size:11px;font-weight:700;color:#fff;">2</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="vertical-align:top;padding-top:3px;">
                          <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">
                            Go to <strong>Profile &rarr; Change Password</strong> and set a strong personal password
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:top;padding-right:12px;">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="background:#10b981;border-radius:50%;width:24px;height:24px;text-align:center;vertical-align:middle;">
                                <span style="font-size:11px;font-weight:700;color:#fff;">3</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="vertical-align:top;padding-top:3px;">
                          <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">
                            Explore your assigned modules and start working on the platform
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.7;">
                If you face any issues signing in, contact your system administrator or write to us at
                <a href="mailto:data.management@selindia.net" style="color:#10b981;font-weight:600;text-decoration:none;">data.management@selindia.net</a>.
              </p>

            </td>
          </tr>

          <!-- ── DIVIDER ── -->
          <tr>
            <td style="background:linear-gradient(135deg,#10b981,#0d9488);height:3px;"></td>
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
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
