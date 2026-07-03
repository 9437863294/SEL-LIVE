import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Structured audit log entry written to the `userLogs` Firestore collection.
 *
 * Every action across every module should call logUserActivity so that
 * administrators can see WHO did WHAT, WHEN, and WHERE across the entire app.
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
      module:      logData.module ?? 'Unknown',
      action:      logData.action,
      details:     logData.details     ?? {},
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
