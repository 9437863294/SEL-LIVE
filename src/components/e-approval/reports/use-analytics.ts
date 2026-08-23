'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  filterEApprovalRows,
  type AnalyticsEventRow,
  type AnalyticsRequestRow,
  type AnalyticsStepRow,
  type EApprovalAnalyticsFilter,
} from '@/lib/e-approval-analytics';
import type { EApprovalSettingsRecord } from '@/lib/e-approval';
import { loadEApprovalAnalyticsData } from '@/lib/e-approval-service';
import { useEApprovalActor, useEApprovalSettings } from '../hooks';

export interface AnalyticsScope {
  /** Every request in range, before the filter. */
  allRequests: AnalyticsRequestRow[];
  /** Requests surviving the filter — what every chart on the page should read. */
  requests: AnalyticsRequestRow[];
  /** Steps belonging to the filtered requests. */
  steps: AnalyticsStepRow[];
  events: AnalyticsEventRow[];
  settings: EApprovalSettingsRecord | null;
  isLoading: boolean;
  /** True once there is data on screen, so a refetch dims rather than tears down. */
  hasLoaded: boolean;
  truncated: boolean;
  loadedAt: string | null;
  reload: () => Promise<void>;
}

/**
 * One fetch behind every report page.
 *
 * The filter is applied to the requests and then **steps and events are narrowed to what survived**.
 * Filtering the requests alone would leave a bottleneck chart counting steps whose parent request is
 * no longer in any denominator on the page — a page that quietly contradicts itself, which is the
 * specific failure that makes people stop trusting a dashboard.
 */
export function useEApprovalAnalytics(filter: EApprovalAnalyticsFilter = {}): AnalyticsScope {
  const { serviceActor } = useEApprovalActor();
  const { settings } = useEApprovalSettings();
  const [data, setData] = useState<{
    requests: AnalyticsRequestRow[];
    steps: AnalyticsStepRow[];
    events: AnalyticsEventRow[];
    truncated: boolean;
    loadedAt: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!serviceActor) return;
    setIsLoading(true);
    try {
      const loaded = await loadEApprovalAnalyticsData(serviceActor.organizationId);
      setData({
        requests: loaded.requests as unknown as AnalyticsRequestRow[],
        steps: loaded.steps as unknown as AnalyticsStepRow[],
        events: loaded.events as unknown as AnalyticsEventRow[],
        truncated: loaded.truncated,
        loadedAt: loaded.loadedAt,
      });
    } catch (error) {
      console.error('[e-approval] analytics load failed', error);
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Serialised, so a caller passing a fresh object literal each render does not refilter every frame.
  const filterKey = JSON.stringify(filter);

  return useMemo(() => {
    const allRequests = data?.requests ?? [];
    const requests = filterEApprovalRows(allRequests, JSON.parse(filterKey) as EApprovalAnalyticsFilter);
    const keptIds = new Set(requests.map((row) => row.id));
    return {
      allRequests,
      requests,
      steps: (data?.steps ?? []).filter((step) => keptIds.has(step.approvalId)),
      events: (data?.events ?? []).filter((event) => keptIds.has(event.approvalId)),
      settings,
      isLoading,
      hasLoaded: data != null,
      truncated: data?.truncated ?? false,
      loadedAt: data?.loadedAt ?? null,
      reload,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filterKey, settings, isLoading, reload]);
}
