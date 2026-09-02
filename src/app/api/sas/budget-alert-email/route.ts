import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/mail';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Coerces an untrusted value to a finite number.
 *
 * Every numeric field on this payload is interpolated straight into the HTML and the subject line.
 * `esc()` alone is not enough for them — a string like `"80"` would render, but a string like
 * `"80</p><script>"` escaped still leaves a nonsense subject, and a NaN renders as "NaN%" in an
 * email to a director. Anything that is not a real number becomes 0 and the caller sees a 400.
 */
function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * The origins a CTA link is allowed to point at.
 *
 * The previous implementation tested `link.startsWith(process.env.NEXTAUTH_URL ?? '')`. That
 * variable is not set in this deployment, so the fallback was the empty string — and every string
 * starts with the empty string, which meant every URL passed, including `javascript:` and any
 * attacker-controlled host. A branded email from the company's own SMTP account carrying an
 * arbitrary link is a phishing kit, so this now works from an explicit allow-list and falls back to
 * a relative path rather than to "allow anything".
 */
function allowedOrigins(req: NextRequest): string[] {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  ].filter((item): item is string => Boolean(item && item.trim()));

  // The request's own origin is trusted: the route is authenticated, so this is the host the
  // signed-in user is already on, not something an anonymous caller can choose.
  const selfOrigin = req.nextUrl?.origin;
  if (selfOrigin) configured.push(selfOrigin);

  return configured.map(item => item.replace(/\/+$/, ''));
}

function safeLinkFor(req: NextRequest, link: unknown, fallback: string): string {
  if (typeof link !== 'string' || !link.trim()) return fallback;
  const candidate = link.trim();

  // A same-origin relative path is always fine — but reject protocol-relative `//evil.example`,
  // which starts with '/' yet resolves to a foreign host.
  if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    const origin = parsed.origin.replace(/\/+$/, '');
    return allowedOrigins(req).includes(origin) ? candidate : fallback;
  } catch {
    return fallback;
  }
}

const SAS_MODULE = 'Site Account Statement';

/**
 * Confirms the caller is a signed-in, active user who can actually see this module.
 *
 * The route sends mail on the company's behalf. Without this it was an open relay: an anonymous
 * POST could put a company-branded message in front of any address on the internet.
 */
async function authorize(req: NextRequest): Promise<{ ok: true; uid: string } | { ok: false; status: number; error: string }> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, error: 'Authentication required.' };

  /*
   * Getting the Admin SDK and verifying the token are separated deliberately.
   *
   * `getAdminApp()` throws when the service-account variables are missing, which is the normal
   * state of a local checkout — `FIREBASE_PRIVATE_KEY` is not in `.env`. Folding that into the
   * token-verification catch reported a configuration gap as "Your session has expired. Please
   * sign in again.", sending a developer hunting through auth code for a missing env var.
   *
   * There is deliberately no development bypass here. This route sends mail from the company's SMTP
   * account; before it was authenticated, anyone on the internet could use it to put a branded
   * message in front of any address. A dev-only skip is exactly the kind of thing that reaches
   * production by accident, so a misconfigured environment refuses to send instead.
   */
  let adminAuth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    adminAuth = getFirebaseAdminAuth();
  } catch (e) {
    console.error('[SAS Budget Alert Email] Firebase Admin is not configured:', e);
    return {
      ok: false,
      status: 503,
      error: 'Budget alert e-mail is unavailable: Firebase Admin credentials are not configured on '
        + 'the server. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY '
        + '(see `npm run firebase:admin-check`). In-app budget notifications are unaffected.',
    };
  }

  let uid: string;
  let email: string | undefined;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email;
  } catch {
    return { ok: false, status: 401, error: 'Your session has expired. Please sign in again.' };
  }

  const firestore = getFirebaseAdminFirestore();
  let userSnapshot = await firestore.collection('users').doc(uid).get();
  if (!userSnapshot.exists && email) {
    const byEmail = await firestore.collection('users').where('email', '==', email.toLowerCase()).limit(1).get();
    if (!byEmail.empty) userSnapshot = byEmail.docs[0];
  }
  if (!userSnapshot.exists) return { ok: false, status: 403, error: 'The signed-in user is not registered.' };

  const user = userSnapshot.data() || {};
  if (user.status === 'Inactive') return { ok: false, status: 403, error: 'This user account is inactive.' };

  // Any Site Account Statement permission is enough. The alert itself is fired by the module's own
  // client code on behalf of a user who is already recording an expense — this check exists to stop
  // outsiders using the mailer, not to re-litigate which budget level the user may read.
  const roleSnapshot = await firestore.collection('roles').where('name', '==', String(user.role || '')).limit(1).get();
  const permissions = (roleSnapshot.docs[0]?.data()?.permissions || {}) as Record<string, unknown>;
  const hasModuleAccess = Object.keys(permissions).some(key => key === SAS_MODULE || key.startsWith(`${SAS_MODULE}.`));
  if (!hasModuleAccess) return { ok: false, status: 403, error: 'You do not have access to Site Account Statement.' };

  return { ok: true, uid };
}

type ScopeType = 'monthly' | 'category' | 'fy' | 'total';

function scopeLabel(scopeType: ScopeType, categoryName?: string): string {
  if (scopeType === 'category' && categoryName) return `${esc(categoryName)} Category Budget`;
  if (scopeType === 'fy')    return 'FY Budget';
  if (scopeType === 'total') return 'Project Total Budget';
  return 'Monthly Budget';
}

function budgetRowLabel(scopeType: ScopeType, categoryName?: string): string {
  if (scopeType === 'category' && categoryName) return 'Category Budget';
  if (scopeType === 'fy')    return 'FY Budget';
  if (scopeType === 'total') return 'Project Total Budget';
  return 'Monthly Budget';
}

function periodRowLabel(scopeType: ScopeType): string {
  if (scopeType === 'fy')    return 'Financial Year';
  if (scopeType === 'total') return 'Scope';
  return 'Month';
}

/** A plausible e-mail address. Deliberately permissive, but it rejects header-injection attempts. */
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export async function POST(req: NextRequest) {
  try {
    const auth = await authorize(req);
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const {
      projectName, monthLabel, budgetAmount, spentAmount, pctUsed,
      thresholdPct, recipients, link, categoryName,
      scopeType: rawScopeType, isTest,
    } = await req.json();

    const scopeType: ScopeType = ['monthly', 'category', 'fy', 'total'].includes(rawScopeType)
      ? rawScopeType as ScopeType
      : (categoryName ? 'category' : 'monthly');

    const fallbackLink = '/site-account-statement/reports/budget';
    const safeLink = safeLinkFor(req, link, fallbackLink);

    const budget    = num(budgetAmount);
    const spent     = num(spentAmount);
    const pct       = num(pctUsed);
    const threshold = num(thresholdPct);
    if ([budget, spent, pct, threshold].some(Number.isNaN)) {
      return NextResponse.json({ success: false, error: 'budgetAmount, spentAmount, pctUsed and thresholdPct must be numbers.' }, { status: 400 });
    }

    // Addresses are the one field that leaves the building, so they are validated rather than
    // escaped — an unparseable address is a mistake worth reporting, not worth silently mailing.
    const toEmails = Array.isArray(recipients)
      ? [...new Set(
          recipients
            .map((item: unknown) => String((item as { email?: unknown })?.email ?? '').trim().toLowerCase())
            .filter((address: string) => EMAIL_RE.test(address)),
        )]
      : [];
    if (toEmails.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid recipient addresses.' }, { status: 400 });
    }

    const testMode  = isTest === true;
    const isOver    = threshold >= 100;
    const overBy    = spent - budget;
    const remaining = budget - spent;
    const barWidth  = Math.max(0, Math.min(pct, 100));
    const statusColor = testMode ? '#475569' : isOver ? '#C00000' : pct >= 80 ? '#FF8C00' : '#2E74B5';

    const label     = scopeLabel(scopeType, categoryName);
    const testTag   = testMode ? '[TEST] ' : '';
    const subject = isOver
      ? `${testTag}${label} Exceeded — ${esc(projectName)} (${esc(monthLabel)})`
      : `${testTag}${label} ${threshold}% Alert — ${esc(projectName)} (${esc(monthLabel)})`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- HEADER -->
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

          <!-- ALERT BANNER -->
          <tr>
            <td style="background:${statusColor};padding:26px 44px;text-align:center;">
              <p style="margin:0;font-size:12px;font-weight:600;color:rgba(255,255,255,0.75);letter-spacing:1.5px;text-transform:uppercase;">Site Account Statement — Budget Alert</p>
              <p style="margin:8px 0 0;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">${testMode ? `🧪 Test — ${label} Alert` : isOver ? `🚨 ${label} Exceeded` : `⚠️ ${label} ${threshold}% Alert`}</p>
            </td>
          </tr>
${testMode ? `
          <!-- TEST BANNER -->
          <tr>
            <td style="background:#fef3c7;border-left:4px solid #d97706;padding:14px 40px;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#92400e;">This is a test message.</p>
              <p style="margin:4px 0 0;font-size:12px;color:#a16207;line-height:1.5;">
                It was sent from Settings &rsaquo; Budget Alerts to check that delivery works. The figures
                below are sample values &mdash; no budget has actually been exceeded. No action is needed.
              </p>
            </td>
          </tr>` : ''}

          <!-- BODY -->
          <tr>
            <td style="background-color:#ffffff;padding:36px 44px;">

              <!-- Details card -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid #e2e8f0;border-radius:14px;margin-bottom:28px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 16px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;">Budget Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;width:42%;">
                          <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Project</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#1e293b;">${esc(String(projectName))}</p>
                        </td>
                        <td style="padding:8px 0 8px 16px;border-bottom:1px solid #e2e8f0;">
                          <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${periodRowLabel(scopeType)}</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#1e293b;">${esc(String(monthLabel))}</p>
                        </td>
                      </tr>
                      ${categoryName ? `<tr>
                        <td colspan="2" style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                          <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Category</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#1e293b;">${esc(String(categoryName))}</p>
                        </td>
                      </tr>` : ''}
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                          <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${budgetRowLabel(scopeType, categoryName)}</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#1e293b;">&#8377;${budget.toLocaleString('en-IN')}</p>
                        </td>
                        <td style="padding:8px 0 8px 16px;border-bottom:1px solid #e2e8f0;">
                          <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Amount Spent</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:${statusColor};">&#8377;${spent.toLocaleString('en-IN')}</p>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:8px;">
                          <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${isOver ? 'Over Budget By' : 'Remaining Budget'}</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:${isOver ? '#C00000' : '#059669'};">&#8377;${(isOver ? overBy : remaining).toLocaleString('en-IN')}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Utilisation bar -->
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;">Budget Utilisation</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td>
                    <div style="background:#e2e8f0;border-radius:6px;height:20px;overflow:hidden;">
                      <div style="background:${statusColor};width:${barWidth}%;height:20px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;">
                        <span style="color:#fff;font-size:11px;font-weight:700;">${Math.round(pct)}%</span>
                      </div>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:${statusColor};border-radius:12px;">
                          <a href="${safeLink}" target="_blank" style="display:inline-block;padding:14px 40px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">View Budget Report &rarr;</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="background:linear-gradient(135deg,${statusColor},${statusColor}cc);height:3px;"></td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#0f172a;border-radius:0 0 20px 20px;padding:24px 44px;text-align:center;">
              <p style="margin:0;font-size:15px;font-weight:700;color:#f8fafc;">Siddhartha Engineering Limited</p>
              <p style="margin:6px 0 14px;font-size:12px;color:#475569;letter-spacing:0.3px;">Engineering Excellence &bull; Digital Innovation</p>
              <p style="margin:0;font-size:11px;color:#334155;line-height:1.6;">
                ${testMode ? 'Test message from Site Account Statement' : 'Automated alert from Site Account Statement'} &bull; SEL Platform<br>
                &copy; ${new Date().getFullYear()} Siddhartha Engineering Limited. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body></html>`;

    const result = await sendEmail({ to: toEmails, subject, html });
    return NextResponse.json({ success: result.success, sentTo: toEmails.length });
  } catch (e: any) {
    console.error('[SAS Budget Alert Email]', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
