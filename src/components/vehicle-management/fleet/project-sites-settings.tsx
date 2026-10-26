'use client';

/**
 * Settings › Fleet › Project sites: which geofences are a project's sites.
 *
 * A project-site geofence names its project when it is drawn (Geofences page), and is linked to it
 * automatically. A project with more than one site, or a yard shared by two projects, is linked
 * here. The links are what tell a site visit from a drive past: arriving inside a project's site is
 * a visit to that project.
 */

import { useMemo, useState } from 'react';
import { Building2, Link2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FormDialog } from '@/components/shared/form-dialog';
import { EmptyBlock } from '@/components/driver-management/trips/trip-ui';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { useToast } from '@/hooks/use-toast';
import type { Geofence, ProjectOption } from '@/lib/fleet/types';
import { cn } from '@/lib/utils';
import { KindChip } from './geofences';

type ProjectRow = ProjectOption & { linked: string[] };

export default function ProjectSitesSettings({ projects, geofences, canEdit, onChanged }: { projects: ProjectOption[]; geofences: Geofence[]; canEdit: boolean; onChanged: () => void }) {
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const fenceById = useMemo(() => new Map(geofences.map((fence) => [fence.id, fence])), [geofences]);

  const rows = useMemo<ProjectRow[]>(() => {
    const needle = search.trim().toLowerCase();
    return projects
      .filter((project) => showInactive || project.active)
      .filter((project) => !needle || `${project.name} ${project.code} ${project.clientName}`.toLowerCase().includes(needle))
      .map((project) => ({
        ...project,
        // The stored links, and any project-site fence drawn for this project.
        linked: [...new Set([...project.siteGeofenceIds, ...geofences.filter((fence) => fence.projectId === project.id).map((fence) => fence.id)])].filter((id) => fenceById.has(id)),
      }))
      .sort((a, b) => Number(b.linked.length > 0) - Number(a.linked.length > 0) || a.name.localeCompare(b.name));
  }, [fenceById, geofences, projects, search, showInactive]);

  const unlinked = rows.filter((row) => row.active && !row.linked.length).length;

  const columns: Array<ListColumn<ProjectRow>> = [
    {
      header: 'Project',
      mobile: 'title',
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-slate-800">{row.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{[row.code, row.clientName].filter(Boolean).join(' · ') || 'No site code'}</span>
        </span>
      ),
    },
    {
      header: 'Site geofences',
      mobile: 'detail',
      cell: (row) =>
        row.linked.length ? (
          <div className="flex flex-wrap gap-1">
            {row.linked.map((id) => (
              <span key={id} className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
                {fenceById.get(id)?.name ?? id}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    ...(canEdit
      ? [
          {
            header: '',
            align: 'right' as const,
            mobile: 'footer' as const,
            cell: (row: ProjectRow) => (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(row)} aria-label={`Link geofences to ${row.name}`}>
                <Link2 className="h-4 w-4" aria-hidden />
                <span className="ml-1.5">Link sites</span>
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">
        Arriving inside one of a project&apos;s site geofences is recorded as a visit to that project.
        {unlinked > 0 && ` ${unlinked} active project${unlinked === 1 ? ' has' : 's have'} no site yet — draw it on the Geofences page as a project site, or link an existing fence here.`}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects" className="bg-white pl-8" aria-label="Search projects" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Show closed projects" />
          Show closed projects
        </label>
      </div>
      <DataList rows={rows} columns={columns} empty={<EmptyBlock icon={Building2} title={projects.length ? 'No project matches' : 'No projects'} />} />
      <LinkSitesDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        project={editing}
        geofences={geofences}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    </div>
  );
}

function LinkSitesDialog({ open, onOpenChange, project, geofences, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; project: ProjectRow | null; geofences: Geofence[]; onSaved: () => void }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const session = open && project ? `open:${project.id}` : 'closed';
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (open && project) {
      setSelected(new Set(project.linked));
      setSearch('');
    }
  }

  const options = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return geofences
      .filter((fence) => fence.active || selected.has(fence.id))
      .filter((fence) => !needle || `${fence.name} ${fence.address}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.kind === 'project_site') - Number(a.kind === 'project_site') || a.name.localeCompare(b.name));
  }, [geofences, search, selected]);

  if (!project) return null;
  // A project-site fence drawn for another project belongs there; it can still be shared, but say so.
  const elsewhere = (fence: Geofence) => fence.kind === 'project_site' && fence.projectId && fence.projectId !== project.id;
  // Drawn as this project's site: linked by the fence itself, and changed on the Geofences page.
  const own = (fence: Geofence) => fence.kind === 'project_site' && fence.projectId === project.id;

  async function submit() {
    if (!project) return;
    setSaving(true);
    try {
      const geofenceIds = [...new Set([...selected, ...geofences.filter(own).map((fence) => fence.id)])];
      await fleetFetch('projects/geofences', { method: 'PUT', body: { projectId: project.id, geofenceIds } });
      toast({ title: 'Sites linked', description: `${project.name}: ${geofenceIds.length} geofence${geofenceIds.length === 1 ? '' : 's'}.` });
      onSaved();
    } catch (failure) {
      toast({ variant: 'destructive', title: 'Not saved', description: fleetErrorMessage(failure, 'The links could not be saved.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} size="md" title={`Sites of ${project.name}`} description="Tick every geofence that is one of this project's sites." onSubmit={submit} submitting={saving} submitLabel="Save links">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search geofences" className="bg-white pl-8" aria-label="Search geofences" />
      </div>
      {options.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white sm:max-h-80 sm:overflow-y-auto">
          {options.map((fence) => {
            const fixed = own(fence);
            const ticked = fixed || selected.has(fence.id);
            return (
              <li key={fence.id}>
                <label className={cn('flex cursor-pointer items-start gap-2.5 px-3 py-2.5 text-sm hover:bg-slate-50', ticked && 'bg-primary/5')}>
                  <Checkbox
                    checked={ticked}
                    disabled={fixed}
                    onCheckedChange={(value) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (value === true) next.add(fence.id);
                        else next.delete(fence.id);
                        return next;
                      })
                    }
                    className="mt-0.5"
                    aria-label={fence.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{fence.name}</span>
                    {fence.address && <span className="block truncate text-xs text-muted-foreground">{fence.address}</span>}
                    {elsewhere(fence) && <span className="block text-[11px] text-amber-700">Drawn as another project&apos;s site — linking shares it.</span>}
                    {fixed && <span className="block text-[11px] text-muted-foreground">Drawn as this project&apos;s site — change it on the Geofences page.</span>}
                  </span>
                  <KindChip kind={fence.kind} />
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-muted-foreground">No geofence matches. Draw the site on the Geofences page first.</p>
      )}
    </FormDialog>
  );
}
