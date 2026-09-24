import { storeUpload } from '@/lib/mail-hub/compose-service';
import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError, adminSettings, requireCap } from '@/lib/mail-hub/server';

/**
 * Upload an attachment for a message being composed (multipart, field `file`).
 *
 * Validated (type, size, hidden direction characters), scanned when a scanner is configured, and
 * stored under `mail-hub/uploads/{userId}/…` in Storage — a path `storage.rules` denies to every
 * client, so the only way to read it back is to send it. Abandoned uploads are deleted after
 * `uploadRetentionDays`; sent ones right after the send.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = mailRoute('uploads', async ({ request, context }) => {
  requireCap(context, context.caps.canSend, 'Attaching files');
  const settings = await adminSettings();
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > settings.maxAttachmentBytes + 64 * 1024) throw new MailHubError('The file is larger than the attachment limit.', 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new MailHubError('Choose a file to attach.', 400);
  const upload = await storeUpload(context, file);
  return { upload: { id: upload.id, filename: upload.filename, contentType: upload.contentType, size: upload.size, scanStatus: upload.scanStatus } };
});
