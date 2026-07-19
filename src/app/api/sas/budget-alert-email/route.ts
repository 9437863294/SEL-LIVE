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
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Calibri,Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.12);">
    <div style="background:${statusColor};padding:24px 32px;">
      <p style="margin:0;color:#fff;font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">Site Account Statement — Budget Alert</p>
      <h2 style="margin:6px 0 0;color:#fff;font-size:20px;">${isOver ? `🚨 ${label} Exceeded` : `⚠️ ${label} ${thresholdPct}% Alert`}</h2>
    </div>
    <div style="padding:24px 32px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
        <tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;width:38%;">Project</td>
            <td style="padding:8px 12px;border:1px solid #e0e0e0;">${esc(String(projectName))}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">${periodRowLabel(scopeType)}</td>
            <td style="padding:8px 12px;border:1px solid #e0e0e0;">${esc(String(monthLabel))}</td></tr>
        ${categoryName ? `<tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">Category</td>
            <td style="padding:8px 12px;border:1px solid #e0e0e0;">${esc(String(categoryName))}</td></tr>` : ''}
        <tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">${budgetRowLabel(scopeType, categoryName)}</td>
            <td style="padding:8px 12px;border:1px solid #e0e0e0;">₹${(budgetAmount as number).toLocaleString('en-IN')}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">Amount Spent</td>
            <td style="padding:8px 12px;border:1px solid #e0e0e0;color:${statusColor};font-weight:bold;">₹${(spentAmount as number).toLocaleString('en-IN')}</td></tr>
        ${isOver
          ? `<tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">Over Budget By</td>
             <td style="padding:8px 12px;border:1px solid #e0e0e0;color:#C00000;font-weight:bold;">₹${overBy.toLocaleString('en-IN')}</td></tr>`
          : `<tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">Remaining Budget</td>
             <td style="padding:8px 12px;border:1px solid #e0e0e0;color:#375623;font-weight:bold;">₹${remaining.toLocaleString('en-IN')}</td></tr>`
        }
      </table>
      <p style="margin:0 0 6px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Budget Utilisation</p>
      <div style="background:#eee;border-radius:4px;height:22px;overflow:hidden;margin-bottom:6px;">
        <div style="background:${statusColor};width:${barWidth}%;height:22px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;">
          <span style="color:#fff;font-size:11px;font-weight:bold;">${pctUsed}%</span>
        </div>
      </div>
      <div style="text-align:center;margin-top:24px;">
        <a href="${esc(safeLink)}" style="display:inline-block;padding:11px 32px;background:${statusColor};color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;">View Budget Report →</a>
      </div>
    </div>
    <div style="padding:14px 32px;background:#f8f8f8;border-top:1px solid #e0e0e0;text-align:center;font-size:11px;color:#888;">
      Automated alert from Site Account Statement · Siddhartha Engineering Limited
    </div>
  </div>
</body></html>`;

    const toEmails = (recipients as { name: string; email: string }[]).map(r => r.email);
    const result = await sendEmail({ to: toEmails, subject, html });
    return NextResponse.json({ success: result.success });
  } catch (e: any) {
    console.error('[SAS Budget Alert Email]', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
