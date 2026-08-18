import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { canonicalModuleName } from './activity-modules';

/**
 * Structured audit log entry written to the `userLogs` Firestore collection.
 *
 * Every action across every module should call logUserActivity so that
 * administrators can see WHO did WHAT, WHEN, and WHERE across the entire app.
 *
 * Server-side callers cannot use this module — it imports the browser Firebase
 * SDK. Use logServerActivity from @/lib/activity-logger-server instead; it writes
 * the same fields to the same collection.
 */
export interface ActivityLogData {
  /** Firebase Auth / Firestore user document ID */
  userId: string;
  /** Display name of the user */
  userName?: string;
  /** Email of the user */
  userEmail?: string;
  /**
   * Top-level module identifier — use a consistent string per module.
   * Examples: 'Vehicle Management', 'Daily Requisition', 'Billing Recon',
   *           'Expenses', 'Settings', 'Loan', 'Insurance', 'Bank Balance'
   */
  module: string;
  /**
   * Short verb + noun describing the action.
   * Examples: 'Add Vehicle', 'Update EMI', 'Delete Role', 'Login'
   */
  action: string;
  /**
   * Structured payload with any relevant context —
   * IDs, names, changed fields, record references, etc.
   */
  details: Record<string, any>;
  /**
   * Firestore document ID of the record the action touched, when there is one.
   * Promoted out of `details` so a reviewer can pull up every action against one
   * record without string-matching a free-form payload.
   */
  recordId?: string;
  /** Human-readable reference for the record, e.g. a vehicle number or PO number. */
  recordRef?: string;
  /** Session ID from localStorage (links to userSessions collection) */
  sessionId?: string;
  /** IP address of the user at time of action (from active session geo) */
  ipAddress?: string;
  /** Browser / device info */
  userAgent?: string;
}

export async function logUserActivity(logData: ActivityLogData): Promise<void> {
  try {
    await addDoc(collection(db, 'userLogs'), {
      userId:      logData.userId,
      userName:    logData.userName    ?? null,
      userEmail:   logData.userEmail   ?? null,
      module:      canonicalModuleName(logData.module),
      action:      logData.action,
      details:     logData.details     ?? {},
      recordId:    logData.recordId    ?? null,
      recordRef:   logData.recordRef   ?? null,
      sessionId:   logData.sessionId   ?? null,
      ipAddress:   logData.ipAddress   ?? null,
      userAgent:   logData.userAgent   ?? null,
      timestamp:   serverTimestamp(),
    });
  } catch (err) {
    // Logging must never crash the calling feature.
    console.error('[activity-logger] Failed to write log:', err);
  }
}

/* ── what changed ──────────────────────────────────────────────────────────── */

/** One field's before/after, as recorded in an update log's details.changes. */
export interface FieldChange {
  from: unknown;
  to: unknown;
}

/** Fields that describe the audit trail itself, not the record's data. */
const AUDIT_FIELDS = new Set([
  'createdBy', 'createdByName', 'createdAt',
  'updatedBy', 'updatedByName', 'updatedAt',
  'deletedBy', 'deletedByName', 'deletedAt',
]);

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  // Treat the several ways this codebase spells "no value" as equivalent, so a
  // field going from undefined to '' is not reported as an edit.
  const blank = (v: unknown) => v === null || v === undefined || v === '';
  if (blank(a) && blank(b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
};

/**
 * Field-level before/after for an edit, so an update log says what changed rather
 * than just that something did.
 *
 * Audit stamps are skipped — they change on every write by definition, and
 * reporting them would bury the real edit. Pass only the fields the form owns;
 * comparing a whole Firestore document against form values flags every field the
 * form does not manage.
 *
 *   const changes = diffFields(existingVehicle, formValues);
 *   if (Object.keys(changes).length) {
 *     await log('Update Vehicle', { vehicleNumber, changes });
 *   }
 */
export function diffFields(
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  if (!after) return changes;

  for (const key of Object.keys(after)) {
    if (AUDIT_FIELDS.has(key)) continue;
    const from = before?.[key];
    const to = after[key];
    if (!isEqual(from, to)) {
      changes[key] = { from: from ?? null, to: to ?? null };
    }
  }
  return changes;
}
