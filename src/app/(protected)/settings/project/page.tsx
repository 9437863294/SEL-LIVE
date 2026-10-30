'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Construction, Plus } from 'lucide-react';
import { addDoc, collection, deleteDoc, doc, getDocs, runTransaction, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SettingsAccessDenied, SettingsPageSkeleton } from '@/components/settings/settings-ui';
import { ProjectRegister } from '@/components/settings/projects/project-register';
import { ProjectFormDialog, SubdivisionFormDialog, type InChargePerson } from '@/components/settings/projects/project-dialogs';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import type { Project, ProjectSubdivision } from '@/lib/types';
import {
  ProjectRuleError,
  buildSubdivision,
  newSubdivisionId,
  projectFormFrom,
  projectPayload,
  removeSubdivision,
  subdivisionFormFrom,
  subdivisionsOf,
  suggestSubdivisionCode,
  upsertSubdivision,
  validateProject,
  EMPTY_SUBDIVISION_FORM,
  type ProjectFormValues,
  type SubdivisionFormValues,
} from '@/lib/project-subdivisions';

type ProjectDialog = { mode: 'add' | 'edit'; project: Project | null; initial: ProjectFormValues | null };
type SiteDialog = { mode: 'add' | 'edit'; project: Project; site: ProjectSubdivision | null; initial: SubdivisionFormValues };
type DeleteTarget = { kind: 'project'; project: Project } | { kind: 'site'; project: Project; site: ProjectSubdivision };

const byName = (a: Project, b: Project) => (a.projectName ?? '').localeCompare(b.projectName ?? '');

async function loadProjects(): Promise<Project[]> {
  const snapshot = await getDocs(collection(db, 'projects'));
  return snapshot.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }) as Project).sort(byName);
}

async function loadPeople(): Promise<InChargePerson[]> {
  const snapshot = await getDocs(collection(db, 'users'));
  return snapshot.docs
    .map((userDoc) => {
      const data = userDoc.data() as { name?: string; email?: string; status?: string };
      return { id: userDoc.id, name: (data.name ?? '').trim(), detail: data.email, active: data.status !== 'Inactive' };
    })
    .filter((person) => person.name && person.active)
    .map(({ id, name, detail }) => ({ id, name, detail }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A message for the person: the rule they broke, or a plain "try again" for anything technical. */
function explain(error: unknown, fallback: string): string {
  if (error instanceof ProjectRuleError) return error.message;
  console.error(fallback, error);
  return `${fallback} Check your connection and try again.`;
}

export default function ManageProjectPage() {
  const back = useBackNavigation('/settings');
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [projects, setProjects] = useState<Project[]>([]);
  const [people, setPeople] = useState<InChargePerson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Each dialog's contents outlive its `open` flag, so the title does not change while it fades out.
  // The form dialogs remount on every opening (`key`), so each starts from its `initial` values.
  const [projectDialog, setProjectDialog] = useState<ProjectDialog>({ mode: 'add', project: null, initial: null });
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectKey, setProjectKey] = useState(0);
  const [siteDialog, setSiteDialog] = useState<SiteDialog | null>(null);
  const [siteOpen, setSiteOpen] = useState(false);
  const [siteKey, setSiteKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const openProject = (dialog: ProjectDialog) => {
    setProjectDialog(dialog);
    setProjectKey((key) => key + 1);
    setProjectOpen(true);
  };
  const openSite = (dialog: SiteDialog) => {
    setSiteDialog(dialog);
    setSiteKey((key) => key + 1);
    setSiteOpen(true);
  };
  const openDelete = (target: DeleteTarget) => {
    setDeleteTarget(target);
    setDeleteOpen(true);
  };

  const canView = can('View', 'Settings.Manage Project');
  const canAdd = can('Add', 'Settings.Manage Project');
  const canEdit = can('Edit', 'Settings.Manage Project');
  const canDelete = can('Delete', 'Settings.Manage Project');
  const abilities = useMemo(() => ({ add: canAdd, edit: canEdit, delete: canDelete }), [canAdd, canEdit, canDelete]);

  useEffect(() => {
    if (isAuthLoading || !canView) return;
    let live = true;
    loadProjects()
      .then((list) => live && setProjects(list))
      .catch((error) => {
        console.error('Error fetching projects: ', error);
        toast({ title: 'Error', description: 'Failed to fetch projects.', variant: 'destructive' });
      })
      .finally(() => live && setIsLoading(false));
    // The in-charge pickers' list. Optional: without it a name can still be typed in.
    loadPeople()
      .then((list) => live && setPeople(list))
      .catch((error) => console.error('Error fetching users for the in-charge picker: ', error));
    return () => {
      live = false;
    };
  }, [isAuthLoading, canView, toast]);

  const toggle = useCallback((projectId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  /** Puts a project's new site list on screen without reloading every project. */
  const showSites = (projectId: string, subdivisions: ProjectSubdivision[]) =>
    setProjects((current) => current.map((project) => (project.id === projectId ? { ...project, subdivisions } : project)));

  /**
   * Changes one project's sites inside a transaction: the list is re-read and the change applied to
   * what is stored now, so a site someone else added a moment ago is kept.
   */
  const changeSites = async (projectId: string, change: (current: ProjectSubdivision[]) => ProjectSubdivision[]) => {
    const ref = doc(db, 'projects', projectId);
    const next = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new ProjectRuleError('This project has been deleted. Reload the page.');
      const updated = change(subdivisionsOf(snapshot.data() as Project));
      transaction.update(ref, { subdivisions: updated });
      return updated;
    });
    showSites(projectId, next);
  };

  const saveProject = async (values: ProjectFormValues) => {
    const payload = projectPayload(values);
    try {
      if (projectDialog.mode === 'edit' && projectDialog.project) {
        const { id } = projectDialog.project;
        await updateDoc(doc(db, 'projects', id), { ...payload });
        setProjects((current) => current.map((project) => (project.id === id ? { ...project, ...payload } : project)).sort(byName));
        toast({ title: 'Project updated', description: payload.projectName });
      } else {
        const ref = await addDoc(collection(db, 'projects'), payload);
        setProjects((current) => [...current, { id: ref.id, ...payload }].sort(byName));
        // Opened straight away: adding its sites is usually the next thing to do.
        setExpanded((current) => new Set(current).add(ref.id));
        toast({ title: 'Project added', description: `Add the sub-division sites of "${payload.projectName}" below it.` });
      }
    } catch (error) {
      throw new Error(explain(error, 'Could not save the project.'));
    }
  };

  const saveSite = async (values: SubdivisionFormValues) => {
    if (!siteDialog) return;
    const { project, site: original } = siteDialog;
    try {
      await changeSites(project.id, (current) =>
        upsertSubdivision(current, buildSubdivision(values, original?.id ?? newSubdivisionId(current))),
      );
      setExpanded((current) => new Set(current).add(project.id));
      toast({ title: original ? 'Site updated' : 'Site added', description: `${values.name.trim()} · ${project.projectName}` });
    } catch (error) {
      throw new Error(explain(error, 'Could not save the site.'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === 'site') {
        const { project, site } = deleteTarget;
        await changeSites(project.id, (current) => removeSubdivision(current, site.id));
        toast({ title: 'Site removed', description: `${site.name} · ${project.projectName}` });
      } else {
        const { project } = deleteTarget;
        await deleteDoc(doc(db, 'projects', project.id));
        setProjects((current) => current.filter((other) => other.id !== project.id));
        toast({ title: 'Project deleted', description: project.projectName });
      }
    } catch (error) {
      toast({ title: 'Error', description: explain(error, 'Could not delete it.'), variant: 'destructive' });
      throw error;
    }
  };

  if (!canView) return <SettingsAccessDenied title="Projects" icon={Construction} />;
  if (isAuthLoading || isLoading) return <SettingsPageSkeleton layout="register" />;

  const deleteSites = deleteTarget?.kind === 'project' ? subdivisionsOf(deleteTarget.project).length : 0;

  return (
    <>
      {/*
        From `lg` the page is exactly the screen below the app header (less the settings frame's
        2.5rem of padding), so the page never scrolls: the register fills what is left and scrolls
        inside. Below `lg` it flows as usual — a scroller inside a phone screen is too cramped.
      */}
      <div className="flex w-full min-w-0 flex-col lg:h-[calc(100dvh-var(--app-header-offset,4rem)-2.5rem)]">
        <PageHeader
          title="Projects"
          description="Every project, and the sub-division sites it is executed at."
          icon={Construction}
          backHref={back.href}
          backLabel={back.label}
          onBackClick={back.onClick}
          actions={
            <Button
              disabled={!canAdd}
              onClick={() => openProject({ mode: 'add', project: null, initial: null })}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add project
            </Button>
          }
        />

        <ProjectRegister
          projects={projects}
          can={abilities}
          expanded={expanded}
          onToggle={toggle}
          onSetExpanded={setExpanded}
          onEditProject={(project) => openProject({ mode: 'edit', project, initial: projectFormFrom(project) })}
          onDeleteProject={(project) => openDelete({ kind: 'project', project })}
          onAddSite={(project) =>
            openSite({ mode: 'add', project, site: null, initial: { ...EMPTY_SUBDIVISION_FORM, code: suggestSubdivisionCode(project) } })
          }
          onEditSite={(project, site) => openSite({ mode: 'edit', project, site, initial: subdivisionFormFrom(site) })}
          onDeleteSite={(project, site) => openDelete({ kind: 'site', project, site })}
        />
      </div>

      <ProjectFormDialog
        key={`project-${projectKey}`}
        open={projectOpen}
        onOpenChange={setProjectOpen}
        mode={projectDialog.mode}
        initial={projectDialog.initial}
        people={people}
        validate={(values) => validateProject(values, projects, projectDialog.project)}
        onSave={saveProject}
      />

      <SubdivisionFormDialog
        key={`site-${siteKey}`}
        open={siteOpen}
        onOpenChange={setSiteOpen}
        mode={siteDialog?.mode ?? 'add'}
        projectName={siteDialog?.project.projectName ?? ''}
        initial={siteDialog?.initial ?? null}
        people={people}
        onSave={saveSite}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title={deleteTarget?.kind === 'site' ? 'Remove this site?' : 'Delete this project?'}
        description={
          deleteTarget?.kind === 'site'
            ? `"${deleteTarget.site.name}" will be removed from ${deleteTarget.project.projectName}.`
            : deleteTarget
              ? `"${deleteTarget.project.projectName}"${deleteSites ? ` and its ${deleteSites} sub-division site${deleteSites === 1 ? '' : 's'}` : ''} will be deleted. Records in other modules that point to it will show it as missing — marking it Inactive is usually safer.`
              : undefined
        }
        confirmLabel={deleteTarget?.kind === 'site' ? 'Remove site' : 'Delete project'}
        onConfirm={confirmDelete}
      />
    </>
  );
}
