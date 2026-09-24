/**
 * Mail Hub's authorization rules (docs/mail-hub.md §Access rules).
 *
 * Built on `access-control.ts` like every other module — a role grant here comes from the same role
 * documents, additive grants and temporary roles — but with one property no other module has:
 *
 *   **No ERP permission reads a personal mailbox.** A connected personal account belongs to the user
 *   who connected it. There is no "View All" for mail, and there is no administrator override: an
 *   administrator who could read everybody's email because they can edit roles would turn the
 *   ERP into the most attractive account in the company. `decideMailboxAccess` returns "no" for a
 *   non-owner of a personal account without looking at the permission map at all, and the unit
 *   tests pin that a subject holding every Mail Hub permission is still refused.
 *
 * Shared mailboxes need **two** independent yeses:
 *
 *   1. an ERP grant — the `Mail Hub.Shared Mail` permission plus a membership row for that mailbox;
 *   2. a provider grant — evidence from Google, Microsoft or the IMAP server that this person's own
 *      login has been given access to the mailbox (see `providers/*.verifyMailboxGrant`).
 *
 * Either alone is refused. An ERP membership without the provider grant would let the ERP hand
 * out mailbox access its owner never approved; a provider grant without the ERP permission would
 * make the ERP's role model irrelevant for the one module where it matters most.
 *
 * Pure, so it runs under `node --test`.
 */

import { hasPermission, canAccessModule, type PermissionSubject } from '../access-control.ts';
import type {
  MailAccount,
  MailContentScope,
  MailMailboxMember,
  MailProviderGrantStatus,
  MailSharedMailbox,
} from './model.ts';

export const MAIL_HUB_MODULE = 'Mail Hub';

/** Dotted permission resources. The permission node itself is in `src/lib/permissions.ts`. */
export const MAIL_HUB_RESOURCES = {
  module: 'Mail Hub',
  accounts: 'Mail Hub.Accounts',
  compose: 'Mail Hub.Compose',
  sharedMail: 'Mail Hub.Shared Mail',
  templates: 'Mail Hub.Templates',
  reports: 'Mail Hub.Reports',
  settings: 'Mail Hub.Settings',
  ai: 'Mail Hub.AI',
  audit: 'Mail Hub.Audit',
} as const;

export interface MailHubCapabilities {
  canOpenModule: boolean;
  /** Connect a personal mailbox of your own. */
  canConnectAccount: boolean;
  /** Send mail at all — from your own mailbox, or (with the shared grants) from a shared one. */
  canSend: boolean;
  canReadShared: boolean;
  canAssignShared: boolean;
  canSendShared: boolean;
  canViewTemplates: boolean;
  /** Department and organisation-wide templates and signatures. Personal ones need only `canSend`. */
  canManageTemplates: boolean;
  canViewReports: boolean;
  /** Shared mailboxes, memberships, IMAP servers, retention. Never reading anybody's mail. */
  canAdministerConnections: boolean;
  canUseAi: boolean;
  canViewAudit: boolean;
}

export function mailHubCapabilities(subject: PermissionSubject): MailHubCapabilities {
  const can = (resource: string, action: string) => hasPermission(subject, resource, action);
  const administer = can(MAIL_HUB_RESOURCES.settings, 'Administer');
  return {
    canOpenModule: canAccessModule(subject, MAIL_HUB_MODULE),
    canConnectAccount: can(MAIL_HUB_RESOURCES.accounts, 'Connect'),
    canSend: can(MAIL_HUB_RESOURCES.compose, 'Send'),
    canReadShared: can(MAIL_HUB_RESOURCES.sharedMail, 'Read'),
    canAssignShared: can(MAIL_HUB_RESOURCES.sharedMail, 'Assign'),
    canSendShared: can(MAIL_HUB_RESOURCES.sharedMail, 'Send'),
    canViewTemplates: can(MAIL_HUB_RESOURCES.templates, 'View') || can(MAIL_HUB_RESOURCES.templates, 'Manage'),
    canManageTemplates: can(MAIL_HUB_RESOURCES.templates, 'Manage'),
    canViewReports: can(MAIL_HUB_RESOURCES.reports, 'View'),
    canAdministerConnections: administer,
    canUseAi: can(MAIL_HUB_RESOURCES.ai, 'Use'),
    // The audit trail of shared-mailbox activity belongs to whoever administers those mailboxes.
    canViewAudit: can(MAIL_HUB_RESOURCES.audit, 'View') || administer,
  };
}

export const NO_MAIL_HUB_CAPABILITIES: MailHubCapabilities = mailHubCapabilities(null);

/* ── mailbox access ───────────────────────────────────────────────────────────────────────── */

/**
 * How long a verified provider grant is trusted before it must be checked again.
 *
 * Long enough that one failed verification run (a provider outage) does not lock a team out of its
 * inbox mid-morning; short enough that a grant removed at the provider stops working in the ERP
 * within a working day or two rather than never. The worker re-verifies every twelve hours.
 */
export const PROVIDER_GRANT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export interface MailboxAccessDecision {
  canRead: boolean;
  /** Mark read, archive, move, label — changes that are visible in the provider mailbox. */
  canModify: boolean;
  canSend: boolean;
  canAssign: boolean;
  /** Take an unassigned thread, or change status on a thread assigned to you. */
  canWorkOwnAssignment: boolean;
  canAddNotes: boolean;
  /** Resync / disconnect the connection itself. Does not imply reading. */
  canManageConnection: boolean;
  /** Personal: owner. Shared: member. Used for audit ("who viewed"). */
  via: 'owner' | 'member' | 'none';
  reason: string | null;
}

const DENIED = (reason: string, extra: Partial<MailboxAccessDecision> = {}): MailboxAccessDecision => ({
  canRead: false,
  canModify: false,
  canSend: false,
  canAssign: false,
  canWorkOwnAssignment: false,
  canAddNotes: false,
  canManageConnection: false,
  via: 'none',
  reason,
  ...extra,
});

export function grantIsFresh(
  status: MailProviderGrantStatus,
  checkedAt: string | null,
  now: Date,
): boolean {
  if (status !== 'verified' || !checkedAt) return false;
  const at = Date.parse(checkedAt);
  return Number.isFinite(at) && now.getTime() - at <= PROVIDER_GRANT_MAX_AGE_MS;
}

export function decideMailboxAccess(input: {
  viewerId: string;
  capabilities: MailHubCapabilities;
  account: Pick<MailAccount, 'id' | 'ownerUserId' | 'kind' | 'status'>;
  /** Required for a shared account. */
  sharedMailbox?: Pick<MailSharedMailbox, 'id' | 'active' | 'accountId'> | null;
  membership?: Pick<MailMailboxMember, 'userId' | 'role' | 'canSend' | 'providerGrant' | 'memberAccountId'> | null;
  now?: Date;
}): MailboxAccessDecision {
  const { viewerId, capabilities: caps, account } = input;
  const now = input.now ?? new Date();
  const isOwner = Boolean(viewerId) && account.ownerUserId === viewerId;

  if (account.kind === 'personal') {
    // Deliberately the first and only question. No capability is consulted for reading.
    if (!isOwner) return DENIED('This mailbox belongs to another user.');
    return {
      canRead: true,
      canModify: account.status !== 'disconnected',
      canSend: caps.canSend && account.status === 'active',
      canAssign: false,
      canWorkOwnAssignment: false,
      canAddNotes: true,
      canManageConnection: true,
      via: 'owner',
      reason: null,
    };
  }

  // Shared. The person who connected the syncing account may manage the connection (they hold
  // its credentials) but reads it like everybody else: through a membership.
  const manageConnection = isOwner || caps.canAdministerConnections;
  const mailbox = input.sharedMailbox;
  if (!mailbox || mailbox.accountId !== account.id) {
    return DENIED('This connection is not registered as a shared mailbox.', { canManageConnection: manageConnection });
  }
  if (!mailbox.active) return DENIED('This shared mailbox is disabled.', { canManageConnection: manageConnection });
  if (!caps.canReadShared) {
    return DENIED('Reading shared mail requires the Mail Hub › Shared Mail › Read permission.', {
      canManageConnection: manageConnection,
    });
  }
  const member = input.membership;
  if (!member || member.userId !== viewerId) {
    return DENIED('You are not a member of this shared mailbox.', { canManageConnection: manageConnection });
  }
  if (!grantIsFresh(member.providerGrant.read, member.providerGrant.checkedAt, now)) {
    return DENIED(
      member.providerGrant.read === 'verified'
        ? 'Your mailbox access needs to be re-verified with the email provider.'
        : 'The email provider has not confirmed that your account has access to this mailbox.',
      { canManageConnection: manageConnection },
    );
  }

  const responder = member.role === 'responder' || member.role === 'manager';
  const sendGrant = grantIsFresh(member.providerGrant.send, member.providerGrant.checkedAt, now);

  return {
    canRead: true,
    canModify: responder && account.status !== 'disconnected',
    canSend:
      responder &&
      member.canSend &&
      caps.canSend &&
      caps.canSendShared &&
      sendGrant &&
      // Shared mail is always sent through the member's own provider login, so the provider
      // enforces send-as itself. Without one, there is nothing to send through.
      Boolean(member.memberAccountId) &&
      account.status === 'active',
    canAssign: responder && caps.canAssignShared,
    canWorkOwnAssignment: responder,
    canAddNotes: responder,
    canManageConnection: manageConnection,
    via: 'member',
    reason: null,
  };
}

/**
 * Whether `fromAddress` is an address this account may send as.
 *
 * The provider has the last word — Gmail rejects an unverified send-as, Exchange rejects SendAs
 * without the permission, a well-configured SMTP server rejects a mismatched envelope — but the
 * ERP refuses first, so a forged From never reaches the provider and never appears in an audit
 * trail as something the ERP attempted.
 */
export function mayUseFromAddress(
  account: Pick<MailAccount, 'emailAddress' | 'identities'>,
  fromAddress: string,
): boolean {
  const wanted = fromAddress.trim().toLowerCase();
  if (!wanted) return false;
  if (account.emailAddress.toLowerCase() === wanted) return true;
  return account.identities.some((identity) => identity.verified && identity.address.toLowerCase() === wanted);
}

/* ── templates and signatures ─────────────────────────────────────────────────────────────── */

export function canEditContent(input: {
  viewerId: string;
  viewerDepartmentIds: string[];
  capabilities: MailHubCapabilities;
  scope: MailContentScope | 'personal' | 'department';
  ownerId: string | null;
  departmentId: string | null;
}): boolean {
  const { capabilities: caps } = input;
  if (input.scope === 'personal') return Boolean(input.ownerId) && input.ownerId === input.viewerId;
  if (!caps.canManageTemplates) return false;
  if (input.scope === 'global') return true;
  // A department template is managed by holders of the permission; administrators of connection
  // settings do not get it for free — content and connections are different jobs.
  return Boolean(input.departmentId);
}

export function canSeeContent(input: {
  viewerId: string;
  viewerDepartmentIds: string[];
  scope: MailContentScope;
  ownerId: string | null;
  departmentId: string | null;
}): boolean {
  if (input.scope === 'global') return true;
  if (input.scope === 'personal') return input.ownerId === input.viewerId;
  return Boolean(input.departmentId) && input.viewerDepartmentIds.includes(input.departmentId as string);
}
