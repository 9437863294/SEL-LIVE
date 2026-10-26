import 'server-only';

/**
 * The fleet's messaging adapter (spec: `messaging.send()`), and its audit trail.
 *
 * Channels today: push and in-app (the notification engine, FCM) and email (`sendEmail`).
 * WhatsApp and SMS are named channels with no provider yet (decision D5): a message asking for them
 * is delivered by push and email, and the request is recorded so nothing is silently dropped. Add a
 * provider in `sendViaProvider` once keys are supplied.
 *
 * Everything here runs after the response (`after`): the change is already committed, and a slow
 * mail server must neither delay nor undo it. None of these calls throw.
 */

import { after } from 'next/server';

import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { logServerActivity } from '@/lib/activity-logger-server';
import { sendEmail } from '@/lib/mail';
import { dispatchNotificationOnce, dispatchNotificationServer } from '@/lib/notifications-server';
import { userDirectory } from '@/lib/employee-trips/server/lookups';

export type FleetChannel = 'push' | 'email' | 'whatsapp' | 'sms';

export interface FleetMessage {
  userIds: string[];
  title: string;
  body: string;
  link: string;
  channels?: FleetChannel[];
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  type?: string;
  itemId?: string;
  itemRef?: string;
  /** Sent at most once per key (scheduled reminders). */
  dedupeKey?: string;
  organizationId?: string;
}

const MODULE = ACTIVITY_MODULES.VEHICLE_MANAGEMENT;
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://seltech.store').replace(/\/$/, '');

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

/** Deliver one message now. Never throws; returns how many people it reached by push. */
export async function sendFleetMessage(message: FleetMessage, excludeUserId?: string): Promise<number> {
  const userIds = [...new Set(message.userIds.filter((id) => id && id !== excludeUserId))];
  if (!userIds.length) return 0;
  const channels = new Set(message.channels ?? ['push']);
  let reached = 0;
  try {
    const payload = {
      type: message.type ?? 'approval_required',
      title: message.title,
      body: message.body,
      module: MODULE,
      severity: message.severity ?? 'INFO',
      itemId: message.itemId,
      itemRef: message.itemRef,
      link: message.link,
      organizationId: message.organizationId,
    } as Parameters<typeof dispatchNotificationServer>[1];
    reached = message.dedupeKey
      ? await dispatchNotificationOnce({ userIds }, payload, message.dedupeKey)
      : await dispatchNotificationServer({ userIds }, payload);
  } catch (error) {
    console.error('[fleet notify] push failed', error instanceof Error ? error.message : error);
  }
  // No provider for these yet: email stands in, so the message still arrives.
  if (channels.has('whatsapp') || channels.has('sms')) channels.add('email');
  if (channels.has('email')) {
    try {
      const directory = await userDirectory();
      const to = userIds.map((id) => directory.get(id)?.email).filter((email): email is string => Boolean(email));
      if (to.length) {
        await sendEmail({
          to,
          subject: message.title,
          text: `${message.body}\n\n${appUrl()}${message.link}`,
          html: `<p>${escapeHtml(message.body)}</p><p><a href="${appUrl()}${message.link}">Open in SEL</a></p>`,
        });
      }
    } catch (error) {
      console.error('[fleet notify] email failed', error instanceof Error ? error.message : error);
    }
  }
  return reached;
}

/** Queue messages to send once the response has gone. */
export function afterMessages(messages: FleetMessage[], excludeUserId?: string): void {
  if (!messages.length) return;
  after(async () => {
    await Promise.all(messages.map((message) => sendFleetMessage(message, excludeUserId)));
  });
}

export interface AuditActor {
  userId: string;
  userName: string;
  userEmail?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

/** One audit row (`userLogs`), with before/after where a record changed (ASSUMPTIONS.md 11). */
export function afterAudit(actor: AuditActor, action: string, details: Record<string, unknown>, recordId?: string, recordRef?: string): void {
  after(() =>
    logServerActivity({
      userId: actor.userId,
      userName: actor.userName,
      userEmail: actor.userEmail ?? undefined,
      module: MODULE,
      action,
      details,
      recordId,
      recordRef,
      source: 'api',
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    }),
  );
}

/** Email with attachments to addresses (the payment report). Never throws. */
export async function emailReport(to: string[], subject: string, text: string, attachments: { filename: string; content: Buffer; contentType: string }[]): Promise<boolean> {
  if (!to.length) return false;
  try {
    await sendEmail({ to, subject, text, html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`, attachments });
    return true;
  } catch (error) {
    console.error('[fleet notify] report email failed', error instanceof Error ? error.message : error);
    return false;
  }
}
