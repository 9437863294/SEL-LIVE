'use client';

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type NotificationType =
  | 'tat_escalation'   // TAT threshold breached on a workflow step
  | 'step_entry'       // A step became active and notifyUserIds should be alerted
  | 'workflow_complete' // Workflow reached its final step
  | 'budget_alert';    // Category budget exceeded for a project

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  /** Module identifier: 'daily-requisition', 'jmc', 'mvac', 'insurance', 'site-fund' */
  module: string;
  /** Firestore document ID of the workflow item */
  itemId: string;
  /** Human-readable reference, e.g. requisitionId or jmcNo */
  itemRef?: string;
  /** Name of the workflow step this notification relates to */
  stepName: string;
  /** Optional deep-link path for the notification CTA */
  link?: string;
}

/**
 * Write a notification to the userNotifications collection.
 * Each user has their own stream of notifications keyed by userId.
 * Notifications are marked unread by default.
 */
export async function createUserNotification(
  userId: string,
  payload: NotificationPayload,
): Promise<void> {
  await addDoc(collection(db, 'userNotifications'), {
    userId,
    ...payload,
    read: false,
    createdAt: serverTimestamp(),
  });
}
