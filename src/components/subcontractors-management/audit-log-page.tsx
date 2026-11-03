'use client';

/**
 * Subcontractors Management › Audit Log — for one project, or for every project (`/all/audit-log`).
 *
 * The same `userLogs` rows Settings › Audit Logs lists under "Subcontractors Management", kept
 * separate per project: a project's page shows the entries written for that project, plus the
 * module-wide ones (the shared subcontractor register and billing workflow), and never another
 * project's. The rule is `belongsToProjectTrail` in src/lib/subcontractors-audit-scope.ts. The
 * all-projects page, reached from the module's landing page, shows the module's whole trail.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { History, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { ModuleAuditLog, type AuditLogEntry, type AuditLogScope } from '@/components/shared/module-audit-log';
import { PmContent } from '@/components/project-management/pm-shell';
import { useSubcontractorsPaths } from '@/components/subcontractors-management/paths';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { projectSlugCanonical, resolveProjectBySlug } from '@/lib/project-slug';
import {
  belongsToProjectTrail,
  canExportSubcontractorAudit,
  canViewSubcontractorAudit,
} from '@/lib/subcontractors-audit-scope';
import type { Project } from '@/lib/types';

const ALL_PROJECTS = 'all';

const PROJECT_DESCRIPTION =
  'Every action in this project — subcontractors, work orders, JMC entries, bills and their approvals — who did it, when, and what changed.';
const ALL_DESCRIPTION =
  'Every action in Subcontractors Management, across all projects — who did it, when, and what changed. Open a project for its own trail.';

/**
 * Where a row's record opens. Actions name what they touched ("Create Work Order", "Update Bill",
 * "Workflow: Approve"); a deleted record has nowhere to open, and the billing workflow has no record.
 *
 * On a project's page every link stays in that project. On the all-projects page a row opens in the
 * project it names; a module-wide row (a subcontractor) names none, so it opens nowhere there.
 */
function recordHrefFor(projectSlug: string, baseFor: (slug: string) => string) {
  return (log: AuditLogEntry): string | null => {
    const slug =
      projectSlug === ALL_PROJECTS
        ? projectSlugCanonical(typeof log.details?.projectName === 'string' ? log.details.projectName : '')
        : projectSlug;
    const id = log.recordId ? encodeURIComponent(log.recordId) : '';
    const action = log.action || '';
    if (!slug || !id || /^Delete /.test(action)) return null;
    // Screens open in whichever module is showing this log (Subcontractors or Billing Recon).
    const base = baseFor(encodeURIComponent(slug));
    if (/Subcontractor$/.test(action)) return `${base}/manage/edit/${id}`;
    if (/Work Order$/.test(action)) return `${base}/work-order/${id}`;
    if (/Bill$/.test(action) || /^Workflow: /.test(action)) {
      // Bill prints exist only under Subcontractors Management (they render bare, in a new tab).
      const print = `/subcontractors-management/${encodeURIComponent(slug)}`;
      const proforma = /Proforma/.test(action) || log.details?.billType === 'Proforma';
      return proforma ? `${print}/proforma-bill/${id}/print` : `${print}/bill/${id}/print`;
    }
    return null;
  };
}

export default function SubcontractorsAuditLogPage() {
  const { project: projectSlug } = useParams() as { project: string };
  const isAllProjects = projectSlug === ALL_PROJECTS;
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [project, setProject] = useState<Project | null>(null);
  /** The slug `project` was resolved for; loading until it is this page's. */
  const [resolvedSlug, setResolvedSlug] = useState<string | null>(null);
  const isProjectLoading = !isAllProjects && resolvedSlug !== projectSlug;

  useEffect(() => {
    if (isAllProjects) return;
    let cancelled = false;
    getDocs(collection(db, 'projects'))
      .then((snap) => {
        if (cancelled) return;
        const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Project);
        setProject(resolveProjectBySlug(projects, projectSlug));
        setResolvedSlug(projectSlug);
      })
      .catch((error) => {
        console.error('Could not load the project for the audit log:', error);
        if (cancelled) return;
        setProject(null);
        setResolvedSlug(projectSlug);
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug, isAllProjects]);

  const projectId = isAllProjects ? undefined : project?.id;
  const canView = canViewSubcontractorAudit(can, projectId);
  const canExport = canExportSubcontractorAudit(can, projectId);

  const scope = useMemo<AuditLogScope | undefined>(
    () =>
      !isAllProjects && project
        ? {
            key: projectSlug,
            label: `Showing ${project.projectName}'s entries and changes shared by every project (subcontractor details, the billing workflow)`,
            match: (log) => belongsToProjectTrail(log, project),
          }
        : undefined,
    [isAllProjects, project, projectSlug],
  );
  const scPaths = useSubcontractorsPaths(projectSlug);
  const recordHref = useMemo(() => recordHrefFor(projectSlug, scPaths.baseFor), [projectSlug, scPaths.baseFor]);

  // The all-projects route renders outside the module shell, which pads its own content.
  // A function, not a component: a component declared here would remount the log on every render.
  const wrap = (children: ReactNode) =>
    isAllProjects ? <div className="space-y-4">{children}</div> : <PmContent>{children}</PmContent>;

  const header = (
    <PageHeader
      sticky={!isAllProjects}
      icon={History}
      title="Audit Log"
      eyebrow={isAllProjects ? 'Subcontractors · All projects' : undefined}
      description={isAllProjects ? ALL_DESCRIPTION : PROJECT_DESCRIPTION}
      breadcrumbs={isAllProjects ? undefined : [{ label: 'Subcontractors', href: scPaths.base }]}
      backHref={isAllProjects ? '/subcontractors-management' : scPaths.base}
      backLabel={isAllProjects ? 'Back to Subcontractors' : 'Back to project'}
    />
  );

  if (isAuthLoading || isProjectLoading) {
    return wrap(
      <>
        <Skeleton className="mb-6 h-10 w-full max-w-80" />
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </>,
    );
  }

  if (!isAllProjects && !project) {
    return (
      <>
        {header}
        {wrap(<>
          <Card>
            <CardHeader>
              <CardTitle>Project not found</CardTitle>
              <CardDescription>No project matches this address. Choose the project again from Subcontractors.</CardDescription>
            </CardHeader>
          </Card>
        </>)}
      </>
    );
  }

  if (!canView) {
    return (
      <>
        {header}
        {wrap(<>
          <Card>
            <CardHeader>
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>
                You need <strong>Audit Log → View</strong> under Subcontractors Management
                {isAllProjects ? '' : ' for this project'}, <strong>Billing → View Settings</strong> under
                Subcontractors Management, or View on Settings › Audit Logs. Ask an administrator to grant it in
                Role Management.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center p-8">
              <ShieldAlert className="h-16 w-16 text-destructive" />
            </CardContent>
          </Card>
        </>)}
      </>
    );
  }

  return (
    <>
      {header}
      {wrap(<>
        <ModuleAuditLog module={ACTIVITY_MODULES.SUBCONTRACTORS} recordHref={recordHref} canExport={canExport} scope={scope} />
      </>)}
    </>
  );
}
