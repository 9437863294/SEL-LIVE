import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/mail';

// TEMPORARY — test route to verify budget alert email pipeline.
// Delete this file after confirming emails work.

export async function GET() {
  try {
    const to      = 'bapidev.bd@gmail.com';
    const project = 'Test Project — SEL Live';
    const month   = 'July 2026';
    const budget  = 500000;
    const spent   = 425000;
    const pct     = Math.round((spent / budget) * 100);
    const threshold = 80;
    const isOver  = threshold >= 100;
    const statusColor = '#FF8C00';

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Calibri,Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.12);">
    <div style="background:${statusColor};padding:24px 32px;">
      <p style="margin:0;color:#fff;font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">Site Account Statement — Budget Alert</p>
      <h2 style="margin:6px 0 0;color:#fff;font-size:20px;">⚠️ Monthly Budget ${threshold}% Alert</h2>
    </div>
    <div style="padding:24px 32px;">
      <p style="margin:0 0 16px;font-size:13px;color:#555;">This is a <strong>test email</strong> to verify the budget alert email pipeline is working correctly.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
        <tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;width:38%;">Project</td><td style="padding:8px 12px;border:1px solid #e0e0e0;">${project}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">Month</td><td style="padding:8px 12px;border:1px solid #e0e0e0;">${month}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">Monthly Budget</td><td style="padding:8px 12px;border:1px solid #e0e0e0;">₹${budget.toLocaleString('en-IN')}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">Amount Spent</td><td style="padding:8px 12px;border:1px solid #e0e0e0;color:${statusColor};font-weight:bold;">₹${spent.toLocaleString('en-IN')}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8f8f8;border:1px solid #e0e0e0;font-weight:bold;">Remaining Budget</td><td style="padding:8px 12px;border:1px solid #e0e0e0;color:#375623;font-weight:bold;">₹${(budget - spent).toLocaleString('en-IN')}</td></tr>
      </table>
      <p style="margin:0 0 6px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Budget Utilisation</p>
      <div style="background:#eee;border-radius:4px;height:22px;overflow:hidden;margin-bottom:6px;">
        <div style="background:${statusColor};width:${pct}%;height:22px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;">
          <span style="color:#fff;font-size:11px;font-weight:bold;">${pct}%</span>
        </div>
      </div>
    </div>
    <div style="padding:14px 32px;background:#f8f8f8;border-top:1px solid #e0e0e0;text-align:center;font-size:11px;color:#888;">
      Automated alert from Site Account Statement · Siddhartha Engineering Limited
    </div>
  </div>
</body></html>`;

    const result = await sendEmail({
      to,
      subject: `[TEST] Monthly Budget ${threshold}% Alert — ${project} (${month})`,
      html,
    });

    if (result.success) {
      return NextResponse.json({ success: true, message: `Test email sent to ${to}` });
    } else {
      return NextResponse.json({ success: false, error: 'sendEmail returned failure', detail: result }, { status: 500 });
    }
  } catch (e: any) {
    console.error('[Test Email]', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
