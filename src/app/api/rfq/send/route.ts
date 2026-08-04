import { sendEmail } from '@/lib/mail';

interface RfqEmailItem {
  description: string;
  unit: string;
  qty: number;
}

interface RfqEmailVendor {
  vendorId: string;
  name: string;
  email?: string;
}

export async function POST(req: Request) {
  try {
    const { rfqNumber, rfqDate, dueDate, projectName, remarks, items, vendors } =
      (await req.json()) as {
        rfqNumber: string;
        rfqDate?: string;
        dueDate?: string;
        projectName?: string;
        remarks?: string;
        items: RfqEmailItem[];
        vendors: RfqEmailVendor[];
      };

    if (!rfqNumber || !Array.isArray(items) || !items.length || !Array.isArray(vendors) || !vendors.length) {
      return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }

    const html = buildRfqEmail({ rfqNumber, rfqDate, dueDate, projectName, remarks, items });

    const results = await Promise.all(
      vendors.map(async (vendor) => {
        if (!vendor.email) {
          return { vendorId: vendor.vendorId, vendorEmail: '', success: false, error: 'No email on file' };
        }
        const result = await sendEmail({
          to: vendor.email,
          subject: `Request for Quotation ${rfqNumber}${projectName ? ` — ${projectName}` : ''}`,
          html,
        });
        return {
          vendorId: vendor.vendorId,
          vendorEmail: vendor.email,
          success: result.success,
          error: result.success ? undefined : result.error,
        };
      }),
    );

    return Response.json({ ok: true, results });
  } catch (err: any) {
    console.error('rfq send error:', err);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

function buildRfqEmail({
  rfqNumber,
  rfqDate,
  dueDate,
  projectName,
  remarks,
  items,
}: {
  rfqNumber: string;
  rfqDate?: string;
  dueDate?: string;
  projectName?: string;
  remarks?: string;
  items: RfqEmailItem[];
}): string {
  const itemRows = items
    .map(
      (item, index) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${index + 1}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escHtml(item.description)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escHtml(item.unit || '')}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;text-align:right;">${item.qty}</td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Request for Quotation</title></head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="background:linear-gradient(160deg,#0f172a 0%,#1a2744 60%,#0f172a 100%);border-radius:20px 20px 0 0;padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Siddhartha Engineering Limited</p>
              <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;">Request for Quotation</p>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:32px 40px;">
              <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;">${escHtml(rfqNumber)}</p>
              <p style="margin:0 0 24px;font-size:13px;color:#64748b;">
                ${rfqDate ? `RFQ Date: ${escHtml(rfqDate)}` : ''}${dueDate ? ` &nbsp;·&nbsp; Quote Due By: <strong style="color:#b45309;">${escHtml(dueDate)}</strong>` : ''}${projectName ? ` &nbsp;·&nbsp; Project: ${escHtml(projectName)}` : ''}
              </p>
              <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.7;">
                Please share your best quotation for the items listed below, including your <strong>unit rate</strong>,
                <strong>payment terms</strong>, and <strong>delivery time</strong>, by replying to this email.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                <tr style="background:#f1f5f9;">
                  <td style="padding:10px 12px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">#</td>
                  <td style="padding:10px 12px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Description</td>
                  <td style="padding:10px 12px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Unit</td>
                  <td style="padding:10px 12px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right;">Qty</td>
                </tr>
                ${itemRows}
              </table>
              ${remarks ? `<p style="margin:20px 0 0;font-size:13px;color:#475569;"><strong>Remarks:</strong> ${escHtml(remarks)}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="background:#0f172a;border-radius:0 0 20px 20px;padding:24px 40px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#64748b;">This is an automated request sent from the SEL Platform Vendor Management module.</p>
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
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
