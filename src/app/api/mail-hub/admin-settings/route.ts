import { AccessDeniedError } from '@/lib/access-control-server';
import { providerAvailability } from '@/lib/mail-hub/config';
import type { MailHubAdminSettings } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { adminSettings } from '@/lib/mail-hub/server';
import { saveAdminSettings } from '@/lib/mail-hub/workflow-service';

/**
 * Connection settings (Mail Hub › Settings › Administer): the IMAP/SMTP servers users may connect
 * to, which providers are enabled, sync window, body-cache and upload retention, attachment limit.
 * Also reports which provider environment variables are missing — by name, never by value.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('admin-settings.get', async ({ context }) => {
  if (!context.caps.canAdministerConnections) throw new AccessDeniedError('Mail Hub › Settings › Administer is required.');
  return { settings: await adminSettings(), environment: providerAvailability() };
});

export const PUT = mailRoute('admin-settings.save', async ({ request, context }) => ({
  settings: await saveAdminSettings(context, await readJson<Partial<MailHubAdminSettings>>(request, 50_000)),
}));
