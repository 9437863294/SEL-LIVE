'use client';

/**
 * JMC / MVAC › Reports: the register's reports as cards, back to the register's desk.
 * Used by `billing-recon/[project]/jmc/reports/page.tsx` and `.../mvac/reports/page.tsx`.
 */

import { useParams } from 'next/navigation';
import { BarChart3, BarChart4, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { ActionCard, BrAccessDenied, BrPage, BrPageSkeleton, BrSection, BR_TONE } from '@/components/billing-recon/page-kit';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { RegisterKind } from './register-desk';

interface ReportItem {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Under /billing-recon/{project}/{jmc|mvac}/reports/. */
  path: string;
  /** Action on `Billing Recon.{JMC|MVAC}`. */
  permission: string;
}

const REPORTS: Record<RegisterKind, ReportItem[]> = {
  JMC: [
    {
      icon: BarChart4,
      title: 'JMC Summary',
      description: 'Entries, executed and certified value, and each step’s work by person — completed, rejected and on time — by year, month and applicant.',
      path: 'jmc-summary',
      permission: 'View Reports',
    },
  ],
  MVAC: [
    {
      icon: BarChart4,
      title: 'MVAC Summary',
      description: 'Entries, executed and certified value, and each step’s work by person — completed, rejected and on time — by year, month and applicant.',
      path: 'mvac-summary',
      permission: 'View Reports',
    },
  ],
};

export function RegisterReports({ kind }: { kind: RegisterKind }) {
  const { can, isLoading } = useAuthorization();
  const params = useParams<{ project: string }>();
  const projectSlug = params?.project ?? '';
  const segment = kind === 'JMC' ? 'jmc' : 'mvac';
  const resource = `Billing Recon.${kind}`;
  const tone = kind === 'JMC' ? BR_TONE.jmc : BR_TONE.mvac;
  const deskHref = `/billing-recon/${projectSlug}/${segment}`;
  const canViewPage = can('View Reports', resource);

  if (isLoading) return <BrPageSkeleton kpis={0} />;
  if (!canViewPage) return <BrAccessDenied message={`You do not have permission to view ${kind} reports.`} />;

  return (
    <BrPage tone={tone}>
      <PageHeader
        title={`${kind} Reports`}
        description={`Reports on this project's ${kind} register.`}
        icon={BarChart3}
        backHref={deskHref}
        backLabel={`Back to ${kind}`}
      />

      <BrSection title="Reports" description="Open a report to filter and read it." icon={BarChart3} tone={tone}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {REPORTS[kind].map((item) => (
            <ActionCard
              key={item.path}
              href={`${deskHref}/reports/${item.path}`}
              title={item.title}
              description={item.description}
              icon={item.icon}
              tone={tone}
              disabled={!can(item.permission, resource)}
              disabledReason="No permission to view this report"
            />
          ))}
        </div>
      </BrSection>
    </BrPage>
  );
}
