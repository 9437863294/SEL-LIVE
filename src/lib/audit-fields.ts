import { serverTimestamp } from 'firebase/firestore';

/**
 * Shared "who touched this record" stamps.
 *
 * Every module already agreed on the same six field names —
 * createdBy / createdByName / createdAt and updatedBy / updatedByName / updatedAt —
 * but each call site spelled them out by hand, so coverage drifted: some modules
 * stamped only createdBy, most stamped nothing at all. These helpers make the
 * correct shape the shortest thing to write.
 *
 *   await addDoc(collection(db, 'vehicles'), {
 *     ...formValues,
 *     ...withCreateAudit(actor),
 *   });
 *
 *   await updateDoc(doc(db, 'vehicles', id), {
 *     ...changes,
 *     ...withUpdateAudit(actor),
 *   });
 *
 * Server-side callers (API routes, admin-SDK service code) must use the
 * identically-shaped helpers in @/lib/audit-fields-server instead — the admin SDK
 * needs FieldValue.serverTimestamp(), not the client sentinel this module emits.
 */

/** The person responsible for a write. Built from the authenticated user. */
export interface AuditActor {
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
}

/**
 * Minimal shape of the authenticated user this accepts — structural, so it
 * matches both `User` from @/lib/types and the AuthProvider's user object
 * without coupling this module to either.
 */
interface UserLike {
  id: string;
  name?: string | null;
  email?: string | null;
}

/** Narrow the authenticated user down to just the audit identity. */
export function actorFromUser(user: UserLike | null | undefined): AuditActor | null {
  if (!user?.id) return null;
  return { userId: user.id, userName: user.name ?? null, userEmail: user.email ?? null };
}

/**
 * Stamps for a newly created record.
 *
 * The updated* stamps are mirrored from the created* ones rather than left unset,
 * so that read models never have to special-case a null updatedBy. Use
 * `hasBeenEdited` to tell a fresh record from an edited one instead of checking
 * whether updatedBy exists — an absent stamp and an unedited record are not the
 * same thing, and conflating them reports phantom edits.
 */
export function withCreateAudit(actor: AuditActor | null | undefined) {
  const stamp = serverTimestamp();
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
export function withUpdateAudit(actor: AuditActor | null | undefined) {
  return {
    updatedBy: actor?.userId ?? null,
    updatedByName: actor?.userName ?? null,
    updatedAt: serverTimestamp(),
  };
}

/**
 * Stamps for a soft delete. Also advances the updated* stamps, so a record that
 * is only ever soft-deleted still reports who last touched it.
 */
export function withSoftDeleteAudit(actor: AuditActor | null | undefined) {
  const stamp = serverTimestamp();
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

/* ── read side ─────────────────────────────────────────────────────────────── */

/** A Firestore Timestamp, an admin Timestamp, or a plain millis/date value. */
type TimestampLike =
  | { toMillis: () => number }
  | { seconds: number }
  | Date
  | number
  | null
  | undefined;

/** Audit stamps as they come back off a read. */
export interface AuditStamps {
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt?: TimestampLike;
  updatedBy?: string | null;
  updatedByName?: string | null;
  updatedAt?: TimestampLike;
}

function toMillis(value: TimestampLike): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if ('toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if ('seconds' in value && typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
}

/**
 * Whether a record has been modified since it was created.
 *
 * `withCreateAudit` mirrors created* into updated*, so a freshly created record
 * reports false here even though its updated* stamps are populated. Callers use
 * this to decide whether to render an "edited by" line at all.
 */
export function hasBeenEdited(record: AuditStamps | null | undefined): boolean {
  if (!record) return false;
  const created = toMillis(record.createdAt);
  const updated = toMillis(record.updatedAt);
  if (created == null || updated == null) {
    // No usable timestamps — fall back to comparing the actor, which at least
    // catches a different person having touched the record.
    return Boolean(record.updatedBy && record.updatedBy !== record.createdBy);
  }
  // Both stamps come from the same serverTimestamp() sentinel on create, but
  // allow a second of slack for records written field-by-field or backfilled.
  return updated - created > 1000;
}

const formatWhen = (value: TimestampLike): string => {
  const millis = toMillis(value);
  if (millis == null) return '';
  return new Date(millis).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

/** "Ashish · 18 Aug 2026, 5:03 pm" — for view dialogs and exports. */
export function formatAuditStamp(
  name: string | null | undefined,
  at: TimestampLike,
): string {
  const when = formatWhen(at);
  const who = name?.trim();
  if (who && when) return `${who} · ${when}`;
  return who || when || '—';
}

/** The created line for a record: "Created by Ashish · 18 Aug 2026, 5:03 pm". */
export function formatCreatedBy(record: AuditStamps | null | undefined): string {
  if (!record) return '—';
  return formatAuditStamp(record.createdByName, record.createdAt);
}

/**
 * The updated line for a record, or null when the record has never been edited —
 * so callers can omit the row entirely rather than showing a duplicate of the
 * created line.
 */
export function formatUpdatedBy(record: AuditStamps | null | undefined): string | null {
  if (!record || !hasBeenEdited(record)) return null;
  return formatAuditStamp(record.updatedByName, record.updatedAt);
}
