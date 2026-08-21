'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  DEFAULT_TRAVEL_SETTINGS,
  TT_COLLECTIONS,
  resolveCityClass,
  resolveEmployeeGrade,
  resolveEntitlement,
  type CityClass,
  type TravelCityClass,
  type TravelEntitlement,
  type TravelGradeMapping,
  type TravelSettings,
} from '@/lib/tour-travel';
import type { TravelActor } from '@/lib/tour-travel-service';

/**
 * The organization every travel document is scoped to.
 *
 * Falls back to 'default' rather than throwing, matching the DEFAULT_TRAVEL_SETTINGS document id —
 * a user whose profile predates organization scoping still gets a working module instead of an
 * empty one.
 */
export function useTravelOrganization() {
  const { user } = useAuth();
  return {
    organizationId: user?.organizationId || 'default',
    organizationName: user?.organizationName || '',
  };
}

/** The audit identity for every write in this module. Null until the user is loaded. */
export function useTravelActor(): TravelActor | null {
  const { user } = useAuth();
  const { organizationId, organizationName } = useTravelOrganization();
  // Read the three fields out before the memo so its dependencies are plain values. Depending on
  // `user?.id` directly makes the React Compiler infer `user.id` and skip optimizing the hook.
  const userId = user?.id;
  const userName = user?.name;
  const userEmail = user?.email;
  return useMemo(() => {
    if (!userId) return null;
    return {
      userId,
      userName: userName || userEmail || 'Unknown user',
      userEmail: userEmail || null,
      organizationId,
      organizationName,
    };
  }, [userId, userName, userEmail, organizationId, organizationName]);
}

export interface TravelConfig {
  settings: TravelSettings;
  entitlements: TravelEntitlement[];
  cityClasses: TravelCityClass[];
  gradeMappings: TravelGradeMapping[];
  loading: boolean;
  /** Resolves a city name to its class using this organization's configured default. */
  cityClassFor: (city: string | undefined) => CityClass;
  /** Resolves the entitlement row governing a grade in a city, or undefined when unconfigured. */
  entitlementFor: (grade: string, city?: string) => TravelEntitlement | undefined;
  /** Resolves an employee's travel grade from the designation map. */
  gradeFor: (employee: { employeeId?: string; designation?: string }) => string;
}

/**
 * Live subscription to the module's configuration — settings, entitlement grid, city classes and
 * the designation→grade map.
 *
 * Subscribed rather than fetched because entitlement drives what every form shows: an administrator
 * raising a hotel cap should see the estimate on an open tour form update, not have to reload. The
 * returned resolvers close over the current config, so a caller never has to remember to pass the
 * organization's default city class or fallback grade.
 */
export function useTravelConfig(): TravelConfig {
  const { organizationId } = useTravelOrganization();
  const [settings, setSettings] = useState<TravelSettings>(DEFAULT_TRAVEL_SETTINGS);
  const [entitlements, setEntitlements] = useState<TravelEntitlement[]>([]);
  const [cityClasses, setCityClasses] = useState<TravelCityClass[]>([]);
  const [gradeMappings, setGradeMappings] = useState<TravelGradeMapping[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const scoped = (name: string) => query(collection(db, name), where('organizationId', '==', organizationId));

    const stopSettings = onSnapshot(scoped(TT_COLLECTIONS.settings), snapshot => {
      const saved = snapshot.docs[0]?.data() as Partial<TravelSettings> | undefined;
      const base = DEFAULT_TRAVEL_SETTINGS;
      // Merged one level deep for the same reason loadTravelSettings does it: a settings document
      // saved before an option existed must resolve that option to its default, not undefined.
      setSettings({
        ...base,
        ...(saved || {}),
        organizationId,
        general: { ...base.general, ...(saved?.general || {}) },
        allowances: { ...base.allowances, ...(saved?.allowances || {}) },
        controls: { ...base.controls, ...(saved?.controls || {}) },
        notifications: { ...base.notifications, ...(saved?.notifications || {}) },
        accounting: { ...base.accounting, ...(saved?.accounting || {}) },
      });
      setLoading(false);
    }, () => setLoading(false));

    const stopEntitlements = onSnapshot(scoped(TT_COLLECTIONS.entitlements), snapshot =>
      setEntitlements(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as TravelEntitlement)));
    const stopCities = onSnapshot(scoped(TT_COLLECTIONS.cityClasses), snapshot =>
      setCityClasses(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as TravelCityClass)));
    const stopGrades = onSnapshot(scoped(TT_COLLECTIONS.gradeMappings), snapshot =>
      setGradeMappings(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as TravelGradeMapping)));

    return () => {
      stopSettings();
      stopEntitlements();
      stopCities();
      stopGrades();
    };
  }, [organizationId]);

  const cityClassFor = (city: string | undefined) =>
    resolveCityClass(cityClasses, city, settings.general.defaultCityClass);

  return {
    settings,
    entitlements,
    cityClasses,
    gradeMappings,
    loading,
    cityClassFor,
    entitlementFor: (grade: string, city?: string) =>
      resolveEntitlement(entitlements, { grade, cityClass: cityClassFor(city) }),
    gradeFor: employee => resolveEmployeeGrade(gradeMappings, employee, settings.general.defaultGrade),
  };
}

/**
 * Live list of a collection scoped to the organization, with an optional extra equality filter.
 *
 * Every register in this module needs the same subscribe-map-sort shape; centralizing it keeps the
 * screens free of Firestore wiring and means the organization scope can never be forgotten on a new
 * view — which would leak another organization's travel documents.
 */
export function useTravelCollection<T extends { id: string }>(
  collectionName: string,
  options: { field?: string; value?: string | null; enabled?: boolean } = {},
) {
  const { organizationId } = useTravelOrganization();
  const [records, setRecords] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const { field, value, enabled = true } = options;

  /**
   * A query that can't run yet — the caller disabled it, or the id it filters on hasn't loaded —
   * is handled by *returning* an empty result rather than by clearing state inside the effect.
   * Setting state in an effect body triggers a cascading render on every inactive pass.
   */
  const inactive = !enabled || (!!field && !value);

  useEffect(() => {
    if (inactive) return;
    const constraints = [where('organizationId', '==', organizationId)];
    if (field && value) constraints.push(where(field, '==', value));
    const stop = onSnapshot(
      query(collection(db, collectionName), ...constraints),
      snapshot => {
        setRecords(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as T));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return stop;
  }, [collectionName, organizationId, field, value, inactive]);

  return inactive ? { records: EMPTY_RECORDS as T[], loading: false } : { records, loading };
}

/** Stable empty array, so an inactive query doesn't hand callers a fresh reference each render. */
const EMPTY_RECORDS: never[] = [];
