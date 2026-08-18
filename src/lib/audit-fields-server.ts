import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';

import type { AuditActor } from './audit-fields';

/**
 * Server-side twin of @/lib/audit-fields.
 *
 * Same six field names, same semantics — the only difference is the timestamp
 * sentinel, which has to come from the admin SDK when the write is issued by an
 * API route or admin-SDK service instead of the browser. Keeping the two in
 * lockstep means a record is indistinguishable whether it was created from a form
 * or by a cron job.
 *
 *   await db.collection('recurringPayments').add({
 *     ...payload,
 *     ...withCreateAuditServer(actor),
 *   });
 */

export type { AuditActor } from './audit-fields';

/** Stamps for a newly created record. Mirrors updated* from created*. */
export function withCreateAuditServer(actor: AuditActor | null | undefined) {
  const stamp = FieldValue.serverTimestamp();
  return {
    createdBy: actor?.userId ?? null,
    createdByName: actor?.userName ?? null,
    createdAt: stamp,
    updatedBy: actor?.userId ?? null,
    updatedByName: actor?.userName ?? null,
    updatedAt: stamp,
  };
}

/** Stamps for a mutation of an existing record. Leaves the created* stamps alone. */
export function withUpdateAuditServer(actor: AuditActor | null | undefined) {
  return {
    updatedBy: actor?.userId ?? null,
    updatedByName: actor?.userName ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/** Stamps for a soft delete. Also advances the updated* stamps. */
export function withSoftDeleteAuditServer(actor: AuditActor | null | undefined) {
  const stamp = FieldValue.serverTimestamp();
  return {
    isDeleted: true,
    deletedBy: actor?.userId ?? null,
    deletedByName: actor?.userName ?? null,
    deletedAt: stamp,
    updatedBy: actor?.userId ?? null,
    updatedByName: actor?.userName ?? null,
    updatedAt: stamp,
  };
}

/**
 * The actor to stamp when a write has no human behind it — a cron run, a webhook,
 * a scheduled generator. Named rather than left null so the audit trail
 * distinguishes "the system did this" from "we failed to record who did this".
 */
export const SYSTEM_ACTOR: AuditActor = {
  userId: 'system',
  userName: 'System',
  userEmail: null,
};
