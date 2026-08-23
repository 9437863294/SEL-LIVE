'use client';

import { useState, type ReactNode } from 'react';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import type { EApprovalAnalyticsFilter } from '@/lib/e-approval-analytics';
import { PageHeader } from '../page-header';
import { useEApprovalPermissions } from '../hooks';
import { EApprovalFilterBar } from './filter-bar';
import { useEApprovalAnalytics, type AnalyticsScope } from './use-analytics';

/**
 * The shell every report page sits in: permission gate, the one filter row, refresh, export, and the
 * partial-data warning.
 *
 * The children are a render function taking the resolved scope, so a page writes only its own charts
 * and cannot accidentally read unfiltered data — the filtered set is the only thing it is handed.
 */
export function ReportShell({
  title,
  description,
  children,
  onExport,
  initialFilter,
}: {
  title: string;
  description: string;
  children: (scope: AnalyticsScope) => ReactNode;
  /** Given the filtered scope, return rows for the Excel export. */
  onExport?: (scope: AnalyticsScope) => Promise<void> | void;
  initialFilter?: EApprovalAnalyticsFilter;
}) {
  const permissions = useEApprovalPermissions();
  const [filter, setFilter] = useState<EApprovalAnalyticsFilter>(initialFilter ?? {});
  const scope = useEApprovalAnalytics(filter);
  const [exporting, setExporting] = useState(false);

  if (!permissions.isLoading && !permissions.canViewReports) {
    return (
      <div className="space-y-3">
        <PageHeader title={title} backHref={`${E_APPROVAL_BASE_PATH}/reports`} backLabel="Reports" />
        <Card>
          <CardHeader>
            <CardTitle>Not permitted</CardTitle>
            <CardDescription>You do not have permission to view E-Approval reports.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const showSkeleton = scope.isLoading && !scope.hasLoaded;
  const refetching = scope.isLoading && scope.hasLoaded;

  return (
    <div className="space-y-3">
      <PageHeader
        title={title}
        description={description}
        backHref={`${E_APPROVAL_BASE_PATH}/reports`}
        backLabel="Reports"
        meta={[
          { label: 'In scope', value: `${scope.requests.length} of ${scope.allRequests.length}` },
          ...(scope.loadedAt
            ? [{ label: 'As at', value: new Date(scope.loadedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }]
            : []),
        ]}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => void scope.reload()}
              disabled={scope.isLoading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', scope.isLoading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {onExport && permissions.canExport && (
              <Button
                size="sm"
                className="h-8 gap-1.5"
                disabled={exporting || !scope.requests.length}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await onExport(scope);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            )}
          </>
        }
      />

      <EApprovalFilterBar value={filter} onChange={setFilter} />

      {scope.truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            These figures cover the most recent slice of the record, not all of it — the query hit its cap. Narrow the
            date range for numbers you can rely on.
          </p>
        </div>
      )}

      {showSkeleton ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !scope.requests.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nothing in scope</CardTitle>
            <CardDescription className="text-xs">
              {scope.allRequests.length
                ? 'No approvals match the current filter. Widen the date range or clear the filters.'
                : 'No approvals have been raised yet, so there is nothing to report on.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className={cn('space-y-3 transition-opacity', refetching && 'opacity-60')}>{children(scope)}</div>
      )}
    </div>
  );
}
