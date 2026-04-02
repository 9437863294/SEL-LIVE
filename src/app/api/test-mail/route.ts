
import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/mail';

/**
 * API route to test SMTP connectivity and email delivery.
 */
export async function POST(request: Request) {
  try {
    const { to } = await request.json();

    if (!to) {
      return NextResponse.json({ success: false, error: 'Recipient address (to) is required' }, { status: 400 });
    }

    const { success, error, messageId } = await sendEmail({
      to,
      subject: 'SMTP Connection Test - SEL Live',
      text: 'This is a test email sent using Nodemailer and Google Workspace SMTP from the SEL Live platform.',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #6366f1;">SMTP Connection Success!</h2>
          <p>The SEL Live platform has successfully connected to your <strong>Google Workspace</strong> mail server.</p>
          <p>System notifications and communication are now ready to be used via this channel.</p>
          <hr />
          <p style="font-size: 12px; color: #777;">Sent automatically by the SEL Live system.</p>
        </div>
      `,
    });

    if (success) {
      return NextResponse.json({ success: true, messageId });
    } else {
      return NextResponse.json({ success: false, error }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error in test-mail API:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
