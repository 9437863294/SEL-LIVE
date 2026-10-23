'use client';

/**
 * Loads what every trip-claims screen needs once per visit to the module — the rate card, rules,
 * company vehicles, projects, the person's wider grants and what waits for them — and shares it.
 * Mounted by the module shell, which also reads it for the sidebar (Approvals and Payments appear
 * for the people named on those stages, with their counts).
 *
 * A failed load never blocks the driver-app screens in the same shell; only the trip-claims pages
 * show the error, with a retry.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { Bootstrap } from './trip-api';
import { useTripQuery } from './use-trip-query';

interface TripClaimsState {
  data: Bootstrap | null;
  loading: boolean;
  error: string | null;
  /** Re-reads everything (after an action changes what waits for whom). */
  reload: () => void;
}

const TripClaimsContext = createContext<TripClaimsState | null>(null);

export function TripClaimsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Keyed by the user, so a change of user loads again. (Under Switch User the API still answers for
  // the administrator, whose token it is — the same limit every API-backed module has.)
  const query = useTripQuery<Bootstrap>(user?.id ? `bootstrap?for=${encodeURIComponent(user.id)}` : null);
  const value = useMemo(() => ({ data: query.data, loading: query.loading, error: query.error, reload: query.reload }), [query.data, query.loading, query.error, query.reload]);
  return <TripClaimsContext.Provider value={value}>{children}</TripClaimsContext.Provider>;
}

export function useTripClaims(): TripClaimsState {
  const value = useContext(TripClaimsContext);
  if (!value) throw new Error('useTripClaims must be used inside TripClaimsProvider.');
  return value;
}
