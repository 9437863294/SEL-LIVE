import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/mail';

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

export async function POST(req: NextRequest) {
  try {
    const {
      projectName, monthLabel, budgetAmount, spentAmount, pctUsed,
      thresholdPct, recipients, link, categoryName,
      scopeType: rawScopeType,
    } = await req.json();

    const scopeType: ScopeType = ['monthly', 'category', 'fy', 'total'].includes(rawScopeType)
      ? rawScopeType as ScopeType
      : (categoryName ? 'category' : 'monthly');

    // Validate link is an internal relative URL or matches the app origin
    const safeLink = typeof link === 'string' && (link.startsWith('/') || link.startsWith(process.env.NEXTAUTH_URL ?? ''))
      ? link
      : '/site-account-statement/reports/budget';

    const isOver    = (thresholdPct as number) >= 100;
    const overBy    = (spentAmount as number) - (budgetAmount as number);
    const remaining = (budgetAmount as number) - (spentAmount as number);
    const barWidth  = Math.min(pctUsed as number, 100);
    const statusColor = isOver ? '#C00000' : (pctUsed as number) >= 80 ? '#FF8C00' : '#2E74B5';

    const label   = scopeLabel(scopeType, categoryName);
    const subject = isOver
      ? `${label} Exceeded — ${esc(String(projectName))} (${esc(String(monthLabel))})`
      : `${label} ${thresholdPct}% Alert — ${esc(String(projectName))} (${esc(String(monthLabel))})`;

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
              <p style="margin:8px 0 0;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">${isOver ? `🚨 ${label} Exceeded` : `⚠️ ${label} ${thresholdPct}% Alert`}</p>
            </td>
          </tr>

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
                          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#1e293b;">&#8377;${(budgetAmount as number).toLocaleString('en-IN')}</p>
                        </td>
                        <td style="padding:8px 0 8px 16px;border-bottom:1px solid #e2e8f0;">
                          <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Amount Spent</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:${statusColor};">&#8377;${(spentAmount as number).toLocaleString('en-IN')}</p>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:8px;">
                          <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${isOver ? 'Over Budget By' : 'Remaining Budget'}</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:${isOver ? '#C00000' : '#059669'};">&#8377;${isOver ? overBy.toLocaleString('en-IN') : remaining.toLocaleString('en-IN')}</p>
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
                        <span style="color:#fff;font-size:11px;font-weight:700;">${pctUsed}%</span>
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
                Automated alert from Site Account Statement &bull; SEL Platform<br>
                &copy; ${new Date().getFullYear()} Siddhartha Engineering Limited. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body></html>`;

    const toEmails = (recipients as { name: string; email: string }[]).map(r => r.email);
    const result = await sendEmail({ to: toEmails, subject, html });
    return NextResponse.json({ success: result.success });
  } catch (e: any) {
    console.error('[SAS Budget Alert Email]', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
