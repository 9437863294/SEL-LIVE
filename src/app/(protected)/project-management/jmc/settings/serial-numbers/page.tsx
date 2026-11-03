'use client';

/**
 * Project Management's JMC serial numbers, for the one project named by `?project={mappingId}`.
 *
 * Project Management and Subcontractors draw JMC numbers from `projectJmcSerialCollection(project)`
 * (src/lib/billing-recon/register.ts): the counter shared with Billing Recon until the project is
 * separated, the project's own `projectJmcSerialConfigs` after. Before this page existed a
 * separated project's counters could not be edited from anywhere.
 *
 * Scope pairs come from the project register's `boqItems` — the BOQ Project Management's JMC
 * entry screen picks lines from.
 */

import { useCallback, useMemo } from 'react';
import { AlertTriangle, Hash, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useProjectManagementJmcContext } from '@/components/jmc/use-jmc-host-context';
import {
  JMC_MAIN_CLASS,
  JmcAccessDenied,
  JmcLoadingState,
  JmcProjectNotFound,
} from '@/components/jmc/jmc-page-shell';
import { JmcSerialNumberEditor } from '@/components/jmc/jmc-serial-number-editor';
import {
  BILLING_RECON_FIXED,
  PROJECT_JMC_SERIAL_CONFIGS,
  SHARED_PROJECT_REGISTER,
  isBillingReconSeparated,
  projectJmcSerialCollection,
} from '@/lib/billing-recon/register';
import type { Project } from '@/lib/types';

const projectRegisterBoqCollection = () => SHARED_PROJECT_REGISTER.boqItems;

function safeCan(canFn: (action: string, resource: string) => boolean, action: string, resource: string) {
  try {
    return canFn(action, resource);
  } catch {
    return false;
  }
}

function formatSeparatedOn(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function SerialCounterNotice({ project }: { project: Project | undefined }) {
  if (!project) return null;
  if (isBillingReconSeparated(project)) {
    const on = formatSeparatedOn(project.billingReconSeparation?.separatedAt);
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">This project has its own JMC numbers</div>
          <div className="mt-0.5">
            Billing Recon was separated from this project{on ? ` on ${on}` : ''}. These counters
            (<code className="break-all">{PROJECT_JMC_SERIAL_CONFIGS}</code>) number Project Management
            and Subcontractors JMCs only; Billing Recon keeps its own series.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">JMC numbers are still shared with Billing Recon</div>
        <div className="mt-0.5">
          This project has not been separated from Billing Recon yet, so its JMC numbers come from the
          shared counter (<code className="break-all">{BILLING_RECON_FIXED.serialConfigs}</code>). Editing
          a series here also changes the next number Billing Recon issues for the same scope. Once the
          project is separated in Billing Recon › Settings › Data Separation, these become Project
          Management&apos;s own counters.
        </div>
      </div>
    </div>
  );
}

export default function JmcSerialNumbersPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get('project') ?? '';
  const { context, isResolving, notFound, projectName } = useProjectManagementJmcContext(mappingId);
  const { can, isLoading: authLoading } = useAuthorization();

  const canEdit = useMemo(
    () => !authLoading && safeCan(can, 'Edit Serial Nos', context.permissionResource),
    [authLoading, can, context.permissionResource],
  );
  const canView = useMemo(
    () => !authLoading && (canEdit || safeCan(can, 'View Settings', context.permissionResource)),
    [authLoading, can, canEdit, context.permissionResource],
  );

  const { globalProjectId } = context;
  const projectFilter = useCallback(
    (project: Project) => Boolean(globalProjectId) && project.id === globalProjectId,
    [globalProjectId],
  );
  const notice = useCallback(
    (projects: Project[]) => <SerialCounterNotice project={projects[0]} />,
    [],
  );

  if (authLoading || isResolving) {
    return <JmcLoadingState />;
  }

  if (!canView) {
    return <JmcAccessDenied description="You do not have permission to view JMC serial numbers." />;
  }

  if (notFound || !globalProjectId) {
    return (
      <JmcProjectNotFound description="This project could not be resolved. Return to Civil and choose a project before opening its JMC serial numbers." />
    );
  }

  return (
    <JmcSerialNumberEditor
      className={JMC_MAIN_CLASS}
      title="JMC Serial Numbers"
      description={
        projectName
          ? `Prefix, format and next number for each scope's JMC series on ${projectName}.`
          : "Prefix, format and next number for each scope's JMC series on this project."
      }
      icon={Hash}
      backHref={context.jmcHref('settings')}
      backLabel="Back to JMC settings"
      serialCollection={projectJmcSerialCollection}
      boqCollection={projectRegisterBoqCollection}
      projectFilter={projectFilter}
      activityModule={context.activityModule}
      canEdit={canEdit}
      notice={notice}
    />
  );
}
