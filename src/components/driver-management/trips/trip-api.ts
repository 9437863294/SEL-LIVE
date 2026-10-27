'use client';

/**
 * Browser side of the trip-claims API (`/api/driver-management/*`). Every call carries the signed-in
 * user's ID token; the browser never reads these collections directly. Errors come back as
 * `TripApiError` with the server's own message, and — for a refused trip — the message per field.
 */

import { auth } from '@/lib/firebase';
import { viewAsHeaders } from '@/lib/view-as';
import type { TripAccess } from '@/lib/employee-trips/access';
import type { ClaimAbilities } from '@/lib/employee-trips/workflow';
import type { ClaimStatus, RateRevision, ReportingSource, StageKind, StageRouting, TripClaim, TripClaimSettings, TripRecord, TripRules } from '@/lib/employee-trips/types';

export class TripApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'TripApiError';
  }

  /** The per-field messages of a refused trip, if that is what this is. */
  get fields(): Record<string, string> {
    const details = this.details as { fields?: Record<string, string> } | undefined;
    return details?.fields ?? {};
  }
}

export async function tripFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new TripApiError('You are signed out. Sign in again.', 401);
  // Switch User: the server answers as the user being viewed (reads only).
  const headers: Record<string, string> = { Authorization: `Bearer ${await user.getIdToken()}`, ...viewAsHeaders() };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const response = await fetch(`/api/driver-management/${path.replace(/^\//, '')}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, cache: 'no-store' });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string; details?: unknown };
    throw new TripApiError(payload.error || `Request failed (${response.status}).`, response.status, payload.details);
  }
  return data as T;
}

export const errorMessage = (error: unknown, fallback = 'Something went wrong.') => (error instanceof Error && error.message ? error.message : fallback);

/* ── payloads ──────────────────────────────────────────────────────────── */

export interface NamedOption {
  id: string;
  name: string;
}

export interface CompanyVehicleOption {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  fuelType: string;
  assignedDriverName: string;
  currentOdometerKm: number | null;
}

export interface InboxCounts {
  approvals: number;
  approvalsAmount: number;
  payments: number;
  paymentsAmount: number;
  overdue: number;
}

export interface StageSummary {
  id: string;
  name: string;
  kind: StageKind;
  routing: StageRouting;
  minAmount: number | null;
  tatHours: number | null;
}

export interface Bootstrap {
  user: { id: string; name: string };
  today: string;
  financialYear: string;
  access: TripAccess;
  named: { approval: boolean; payment: boolean };
  inbox: InboxCounts;
  /** Who the signed-in employee's claims go to first. */
  firstApproval: { stageName: string; names: string[]; reportingSource: ReportingSource | null; dependsOnTrips: boolean };
  settings: { rateRevisions: RateRevision[]; rules: TripRules; stages: StageSummary[] };
  vehicleTypes: string[];
  vehicles: CompanyVehicleOption[];
  projects: NamedOption[];
  /** The employee's own projects, and whether the picker is limited to them (Settings › Fleet). */
  projectScope?: { mine: string[]; onlyMine: boolean };
  /** Settings › Fleet's trip purposes, for starting an own-vehicle trip (absent from an older server). */
  purposes?: Array<{ id: string; name: string; requiresReason: boolean; requiresProject: boolean }>;
  departments: NamedOption[];
  odometer: Record<string, { km: number; date: string }>;
}

export interface ClaimRow {
  id: string;
  claimNumber: string;
  employeeName: string;
  status: ClaimStatus;
  totals: TripClaim['totals'];
  submittedAt: string;
  stageName: string;
  waitingFor: string[];
  overdue: boolean;
  paidOn: string | null;
}

export interface TrendPoint {
  month: string;
  trips: number;
  km: number;
  amount: number;
}

export interface Tally {
  label: string;
  amount: number;
  km: number;
  trips: number;
}

export interface DashboardData {
  today: string;
  financialYear: string;
  personal: {
    thisMonth: { trips: number; km: number; amount: number };
    unclaimed: { trips: number; km: number; amount: number; expiringSoon: number; sentBack: number };
    inApproval: { claims: number; amount: number };
    awaitingPayment: { claims: number; amount: number };
    paidThisYear: { claims: number; amount: number };
    ownership: { own: number; company: number };
    trend: TrendPoint[];
    recentClaims: ClaimRow[];
  };
  workflow: (InboxCounts & { oldest: ClaimRow[] }) | null;
  organisation: {
    financialYear: string;
    inApproval: { claims: number; amount: number };
    awaitingPayment: { claims: number; amount: number };
    paid: { claims: number; amount: number };
    rejected: { claims: number; amount: number };
    overdue: number;
    unclaimed: { trips: number; amount: number };
    trend: TrendPoint[];
    ownership: { own: number; company: number };
    byProject: Tally[];
    byEmployee: Tally[];
  } | null;
}

export interface ClaimDetail {
  claim: TripClaim;
  trips: TripRecord[];
  returnedTrips: TripRecord[];
  abilities: ClaimAbilities;
}

export interface SettingsPayload {
  settings: TripClaimSettings;
  users: { id: string; name: string; email: string }[];
  projects: NamedOption[];
  departments: NamedOption[];
  canEdit: boolean;
}

/**
 * A place name for a coordinate, via the reverse-geocode proxy.
 *
 * Returns Google's full formatted address, not the locality.
 *
 * It filled in "Bhubaneswar" at first, on the reasoning that it is what somebody would type. That
 * was the wrong trade for this form: a claim is checked by an approver who was not there, and "the
 * trip started in Bhubaneswar" tells them almost nothing about a city of a million people, while
 * the street and plot do. The driver can always shorten it; they cannot recover detail the field
 * never captured.
 *
 * The component pieces are assembled only when Google returns no formatted address — rare, but it
 * answers with bare coordinates near an unmapped site, which is precisely where a site visit ends.
 *
 * Never throws. A missing address is a field somebody can type; it must not cost them the trip
 * they are trying to start.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const response = await fetch('/api/maps/reverse-geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
    });
    if (!response.ok) return '';
    const data = (await response.json()) as {
      formattedAddress?: string;
      roadNumber?: string;
      road?: string;
      area?: string;
      locality?: string;
      city?: string;
      district?: string;
      state?: string;
      postalCode?: string;
    };

    const formatted = String(data.formattedAddress || '').trim();
    if (formatted) return formatted;

    // Narrowest first, so the fallback reads the way an address is written.
    return [
      [data.roadNumber, data.road].filter(Boolean).join(' '),
      data.area,
      data.locality || data.city,
      data.district && data.district !== (data.locality || data.city) ? data.district : '',
      data.state,
      data.postalCode,
    ]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(', ');
  } catch {
    return '';
  }
}
