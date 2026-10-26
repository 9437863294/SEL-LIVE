'use client';

import { useParams } from 'next/navigation';
import ReportDetailView from '@/components/vehicle-management/fleet/report-detail';

export default function FleetReportPage() {
  const params = useParams<{ reportId: string }>();
  return <ReportDetailView reportId={params?.reportId ? decodeURIComponent(params.reportId) : ''} />;
}
