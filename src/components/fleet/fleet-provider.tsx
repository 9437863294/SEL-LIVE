'use client';

/**
 * Loads the fleet bootstrap once per visit to Driver Management — the vehicles with today's km and
 * limits, purposes, projects, geofences, the caller's running trip and what waits for them — and
 * shares it. The module shell reads it for the sidebar (Fleet Trip for those who may drive, and
 * Approvals — with the fleet requests and reviews in its count — for approvers).
 *
 * Outside the provider (Vehicle Management's pages have none) `useFleet` answers "nothing loaded"
 * rather than throwing, so shared fleet components work on either side. A failed load never
 * blocks the shell; only the fleet pages show the error, with a retry.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { FleetBootstrap } from '@/lib/fleet/server/overview';
import { useFleetQuery } from './use-fleet-query';

export interface FleetState {
  data: FleetBootstrap | null;
  loading: boolean;
  error: string | null;
  /** Re-reads everything (after a start, an end, a decision). */
  reload: () => Promise<void>;
}

const FleetContext = createContext<FleetState | null>(null);

const IDLE: FleetState = { data: null, loading: false, error: null, reload: async () => undefined };

export function FleetProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Keyed by the user, so a change of user loads again.
  const query = useFleetQuery<FleetBootstrap>(user?.id ? `bootstrap?for=${encodeURIComponent(user.id)}` : null);
  const value = useMemo<FleetState>(() => ({ data: query.data, loading: query.loading, error: query.error, reload: query.reload }), [query.data, query.loading, query.error, query.reload]);
  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleet(): FleetState {
  return useContext(FleetContext) ?? IDLE;
}
