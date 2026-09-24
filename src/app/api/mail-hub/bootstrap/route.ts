import { listAccountViews } from '@/lib/mail-hub/accounts-service';
import { providerAvailability } from '@/lib/mail-hub/config';
import { foldersFor } from '@/lib/mail-hub/mailbox-service';
import { MAIL_PROVIDER_LABELS } from '@/lib/mail-hub/model';
import { mailRoute } from '@/lib/mail-hub/route';
import { adminSettings, readableAccounts, userSettings } from '@/lib/mail-hub/server';
import { listSignatures } from '@/lib/mail-hub/workflow-service';

/**
 * Everything the Mail Hub shell needs on first paint (`GET /api/mail-hub/bootstrap`): the caller's
 * capabilities, the mailboxes they can see (with sync state and recovery advice), their folders,
 * the providers they may connect, and their settings and signatures.
 *
 * Configuration problems name environment variables and are shown only to administrators; a user
 * who cannot fix them is told the option is unavailable.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute(
  'bootstrap',
  async ({ context }) => {
    const [readable, settings, admin, signatures] = await Promise.all([
      readableAccounts(context),
      userSettings(context.userId),
      adminSettings(),
      listSignatures(context),
    ]);
    const [accounts, folders] = await Promise.all([listAccountViews(context, readable), foldersFor(readable)]);
    const availability = providerAvailability().map((entry) => {
      const enabled = admin.enabledProviders.includes(entry.provider);
      const needsPreset = entry.provider === 'imap' && admin.imapServers.length === 0;
      return {
        provider: entry.provider,
        label: MAIL_PROVIDER_LABELS[entry.provider],
        // Switched off in Mail Hub settings: the Accounts page does not offer it at all.
        enabled,
        available: enabled && entry.available && !needsPreset,
        problems: context.caps.canAdministerConnections
          ? [...entry.problems, ...(needsPreset ? ['No IMAP/SMTP server has been configured yet.'] : [])]
          : [],
      };
    });
    return {
      user: { id: context.userId, name: context.userName, email: context.userEmail, departmentIds: context.departmentIds },
      capabilities: context.caps,
      accounts,
      folders,
      providers: availability,
      imapServers: admin.imapServers.map((preset) => ({ id: preset.id, label: preset.label, allowedDomains: preset.allowedDomains, usernameStyle: preset.usernameStyle })),
      settings,
      signatures,
    };
  },
  // Anyone signed in may ask what they can do; the shell shows "no access" from the answer.
  { requireModule: false },
);
