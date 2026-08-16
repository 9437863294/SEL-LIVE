
'use client';
export const dynamic = 'force-dynamic';

import { BarChart3, BarChart4 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useProjectManagementJmcContext } from '@/components/jmc/use-jmc-host-context';
import { JmcNav } from '@/components/jmc/jmc-nav';
import {
  JmcAccessDenied,
  JmcCardGridLoadingState,
  JmcNavCard,
  JmcNavCardGrid,
  JmcPageHeader,
  JmcPageShell,
  JmcProjectNotFound,
} from '@/components/jmc/jmc-page-shell';

export default function JmcReportsPage() {
    const { can, isLoading } = useAuthorization();
    const searchParams = useSearchParams();
    const mappingId = searchParams?.get('project') ?? '';
    const { context, isResolving, notFound, projectName } = useProjectManagementJmcContext(mappingId);
    const canViewPage = can('View Reports', context.permissionResource);

    const reportItemsBase = [
      {
        icon: BarChart4,
        text: 'JMC Summary',
        description: 'A summary of JMC status and progress.',
        href: context.jmcHref('reports/jmc-summary'),
        permission: 'View Reports',
        disabled: false,
      },
    ];

    const reportItems = reportItemsBase.map(item => ({
        ...item,
        disabled: !can(item.permission, context.permissionResource) || item.disabled,
    }));

    if (isLoading || isResolving) {
        return <JmcCardGridLoadingState tiles={1} />;
    }

    if (!canViewPage) {
        return <JmcAccessDenied description="You do not have permission to view JMC reports." />;
    }

    if (notFound) {
        return (
            <JmcProjectNotFound
                description="This link does not identify a mapped Project Management project, so JMC reports cannot be opened. Choose a project from Civil and open JMC from there."
                href="/project-management/civil"
                label="Go to Civil"
            />
        );
    }

  return (
    <JmcPageShell>
      <JmcPageHeader
        title="JMC Reports"
        subtitle={`JMC status and progress summaries${projectName ? ` for ${projectName}` : ''}`}
        icon={BarChart3}
        backHref={context.jmcHref()}
        backLabel="Back to JMC"
      />

      <JmcNav context={context} active="reports" />

      <JmcNavCardGrid>
        {reportItems.map((item) => (
          <JmcNavCard
            key={item.text}
            title={item.text}
            description={item.description}
            href={item.href}
            icon={item.icon}
            disabled={item.disabled || item.href === '#'}
          />
        ))}
      </JmcNavCardGrid>
    </JmcPageShell>
  );
}
