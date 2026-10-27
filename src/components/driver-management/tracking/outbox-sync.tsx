'use client';

import { useQueueStatus } from '@/components/fleet/offline-queue';
import { useOwnTripOutbox } from '@/components/driver-management/trips/own-trip-outbox';

/**
 * Keeps both of the phone's outboxes sending on whichever Driver Management page is open — the
 * fleet outbox (company-vehicle points, arrivals and ends) and the own-vehicle trip outbox — so
 * nothing saved offline waits for the driver to reopen Fleet Trip. Subscribing starts each one
 * (its reconnect listeners and retry). Renders nothing.
 */
export function OutboxSync() {
  useQueueStatus();
  useOwnTripOutbox();
  return null;
}
