
import nodemailer from 'nodemailer';

/**
 * Interface for email sending options.
 */
export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  fromName?: string;
  fromEmail?: string;
  attachments?: any[];
}

/**
 * Reusable mailer utility using Nodemailer.
 * Configured for Google Workspace or other SMTP providers.
 */
export async function sendEmail(options: SendEmailOptions) {
  const {
    to,
    subject,
    text,
    html,
    fromName,
    fromEmail,
    attachments
  } = options;

  // SMTP Settings from Environment
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const defaultFromName = process.env.SMTP_FROM_NAME || 'Siddhartha Engineering Limited';
  const defaultFromEmail = process.env.SMTP_FROM_EMAIL || 'data.management@selindia.net';

  if (!user || !pass) {
    console.error('SMTP credentials missing in environment variables.');
    return { success: false, error: 'SMTP credentials missing' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
    });

    const info = await transporter.sendMail({
      from: `"${fromName || defaultFromName}" <${fromEmail || defaultFromEmail}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html,
      attachments,
    });

    console.log('Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
}
