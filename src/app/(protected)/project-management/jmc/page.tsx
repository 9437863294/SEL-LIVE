'use client';

/**
 * Project Management's JMC dashboard — the module's landing screen.
 *
 * This file turns the shared register into the dashboard's props and answers the permission
 * questions; the screen itself is `JmcDashboardView`, built from the user's `sel-jmc-hub` mock-up.
 * Navigation between the JMC screens is the module sidebar's job (`layout.tsx`), so nothing here
 * lists pages.
 */

import {
  Award,
  ClipboardCheck,
  FileCheck2,
  FilePlus,
  GitMerge,
  Ruler,
  Send,
  type LucideIcon,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useProjectManagementJmcContext } from '@/components/jmc/use-jmc-host-context';
import { JmcProjectNotFound } from '@/components/jmc/jmc-page-shell';
import {
  JmcDashboardView,
  type JmcDashboardStage,
  type JmcRecentEntry,
} from '@/components/jmc/jmc-hub-view';
import { jmcStagePath, jmcTabHref, useJmcRegister } from '@/components/jmc/jmc-shell';
import {
  jmcRaisedOn,
  jmcStageIndex,
  jmcTotals,
} from '@/lib/project-management-jmc-dashboard';

/**
 * A stage's icon, chosen from its configured name.
 *
 * The workflow is configurable, so the stage names are whatever this installation calls them —
 * there is no fixed list to map. Matching on the verb in the name gives a meaningful icon for the
 * stages every site has (measure, verify, submit, certify) and a neutral one for anything else.
 */
const STAGE_ICONS: ReadonlyArray<{ match: RegExp; icon: LucideIcon }> = [
  { match: /creat|raise|draft|initiat|new/i, icon: FilePlus },
  { match: /measur|joint|survey/i, icon: Ruler },
  { match: /verif|check|review|scrutin/i, icon: ClipboardCheck },
  { match: /submi|send|forward|dispatch/i, icon: Send },
  { match: /certif|award/i, icon: Award },
  { match: /approv|accept|sign/i, icon: FileCheck2 },
];

const stageIcon = (name: string): LucideIcon =>
  STAGE_ICONS.find((entry) => entry.match.test(name))?.icon ?? GitMerge;

const formatDate = (value: Date | null): string =>
  value
    ? `${String(value.getDate()).padStart(2, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${value.getFullYear()}`
    : '—';

export default function JmcDashboardPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get('project') ?? '';
  const { context, isResolving, notFound } = useProjectManagementJmcContext(mappingId);
  const back = useBackNavigation(context.parentHref, { fallbackLabel: 'Back' });
  const { can, isLoading: authIsLoading } = useAuthorization();
  const { projectName, steps, entries, reading, isLoading, loadError } = useJmcRegister();

  const canCreate = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('Create JMC Entry', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context.permissionResource]);

  const stages: JmcDashboardStage[] = useMemo(
    () =>
      reading.stages.map((stage) => ({
        ...stage,
        href: jmcTabHref(jmcStagePath(stage.id), mappingId),
        icon: stageIcon(stage.name),
      })),
    [reading.stages, mappingId],
  );

  /** The five most recently raised, with where each one currently sits. */
  const recent: JmcRecentEntry[] = useMemo(
    () =>
      entries.slice(0, 5).map((entry) => {
        const index = jmcStageIndex(entry, steps);
        return {
          id: entry.id,
          jmcNo: String(entry.jmcNo ?? ''),
          date: formatDate(jmcRaisedOn(entry)),
          value: jmcTotals(entry.items ?? []).total,
          stage:
            steps.length === 0
              ? 'No workflow configured'
              : index >= steps.length
                ? 'Through every stage'
                : `Waiting at ${steps[index]!.name}`,
        };
      }),
    [entries, steps],
  );

  if (!isResolving && notFound) {
    return (
      <JmcProjectNotFound description="This JMC workspace could not be matched to a Project Management project. Pick a project from the Civil workspace and open JMC from there." />
    );
  }

  return (
    <JmcDashboardView
      back={back}
      crumbs={[{ label: 'Project Management', href: context.parentHref }]}
      projectName={projectName}
      description={
        projectName
          ? `Joint Measurement Certificates for ${projectName} — where each one stands, and what has been certified.`
          : 'Joint Measurement Certificates — where each one stands, and what has been certified.'
      }
      reading={reading}
      stages={stages}
      recent={recent}
      logHref={jmcTabHref('log', mappingId)}
      create={canCreate && mappingId ? { href: jmcTabHref('entry', mappingId) } : undefined}
      isLoading={isLoading || isResolving || authIsLoading}
      loadError={loadError}
    />
  );
}
