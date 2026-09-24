import type { MailUserSettings } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { userSettings } from '@/lib/mail-hub/server';
import { saveUserSettings } from '@/lib/mail-hub/workflow-service';

/** The caller's own Mail Hub preferences: notifications, reminders, trusted image senders, AI opt-in. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('settings.get', async ({ context }) => ({ settings: await userSettings(context.userId) }));

export const PUT = mailRoute('settings.save', async ({ request, context }) => ({
  settings: await saveUserSettings(context, await readJson<Partial<MailUserSettings>>(request, 20_000)),
}));
