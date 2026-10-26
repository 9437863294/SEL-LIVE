'use client';

/**
 * Settings › Projects — the register: headline figures, the filter bar, and the project list with
 * each project's sub-division sites folding open beneath it.
 *
 * Presentational only. `DataList` mounts every cell and the open panel twice (phone card and
 * desktop row), so nothing here holds a dialog or a ref: every action is a callback, and the page
 * opens its one copy of each dialog.
 */

import { useMemo, useState } from 'react';
import { ChevronRight, CircleSlash, FolderKanban, Layers, MapPin, MapPinned, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Project, ProjectSubdivision } from '@/lib/types';
import { inChargeLabel, matchProject, subdivisionsOf, summariseProjects } from '@/lib/project-subdivisions';

export interface ProjectRegisterAbilities {
  add: boolean;
  edit: boolean;
  delete: boolean;
}

export interface ProjectRegisterProps {
  projects: Project[];
  can: ProjectRegisterAbilities;
  /** Projects opened by hand; the page adds a project it has just created. */
  expanded: ReadonlySet<string>;
  onToggle: (projectId: string) => void;
  onSetExpanded: (ids: Set<string>) => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onAddSite: (project: Project) => void;
  onEditSite: (project: Project, site: ProjectSubdivision) => void;
  onDeleteSite: (project: Project, site: ProjectSubdivision) => void;
}

type StatusFilter = 'all' | 'Active' | 'Inactive';
type SitesFilter = 'all' | 'with' | 'without';

const ALL_DIVISIONS = '__all__';

const sitesLabel = (count: number) => (count === 0 ? 'No sites' : `${count} site${count === 1 ? '' : 's'}`);

/** A value or a muted dash — never an empty cell. */
function Muted({ children }: { children?: React.ReactNode }) {
  return children ? <>{children}</> : <span className="text-muted-foreground">—</span>;
}

export function ProjectRegister({
  projects,
  can,
  expanded,
  onToggle,
  onSetExpanded,
  onEditProject,
  onDeleteProject,
  onAddSite,
  onEditSite,
  onDeleteSite,
}: ProjectRegisterProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [division, setDivision] = useState(ALL_DIVISIONS);
  const [sitesFilter, setSitesFilter] = useState<SitesFilter>('all');

  const summary = useMemo(() => summariseProjects(projects), [projects]);

  const divisions = useMemo(
    () => [...new Set(projects.map((project) => project.projectDivision?.trim()).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b)),
    [projects],
  );

  const { rows, siteHits } = useMemo(() => {
    const hits = new Map<string, Set<string>>();
    const filtered = projects.filter((project) => {
      if (status !== 'all' && (project.status ?? 'Active') !== status) return false;
      if (division !== ALL_DIVISIONS && project.projectDivision?.trim() !== division) return false;
      const count = subdivisionsOf(project).length;
      if (sitesFilter === 'with' && count === 0) return false;
      if (sitesFilter === 'without' && count > 0) return false;
      const match = matchProject(project, search);
      if (match.siteIds.length > 0) hits.set(project.id, new Set(match.siteIds));
      return match.matched;
    });
    return { rows: filtered, siteHits: hits };
  }, [projects, status, division, sitesFilter, search]);

  // A search that finds a site opens its project, so the hit is on screen without a click.
  const openIds = useMemo(() => {
    const ids = new Set(expanded);
    for (const id of siteHits.keys()) ids.add(id);
    return ids;
  }, [expanded, siteHits]);

  const activeFilters = Number(status !== 'all') + Number(division !== ALL_DIVISIONS) + Number(sitesFilter !== 'all');
  const allOpen = rows.length > 0 && rows.every((project) => openIds.has(project.id));

  // The register fits the content area beside the settings menu without a sideways scroll: code
  // and division ride under the project's name, actions are icons, and below `xl` (where the menu
  // leaves ~630px) status and in-charge fold into the project and site cells instead of having
  // columns of their own. Nothing in a cell may refuse to wrap, or it sets the table's width.
  const columns: Array<ListColumn<Project>> = [
    {
      header: 'Project',
      mobile: 'title',
      className: 'min-w-[13rem]',
      cell: (project) => (
        <div className="min-w-0">
          <div className="font-medium text-slate-800">{project.projectName}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-muted-foreground">
            {project.siteCode && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{project.siteCode}</span>}
            {project.projectDivision && <span>{project.projectDivision}</span>}
            <div className="hidden sm:block xl:hidden"><StatusBadge status={project.status ?? 'Active'} /></div>
          </div>
          {project.projectDescription && (
            <div className="mt-0.5 line-clamp-2 max-w-[26rem] text-xs font-normal text-muted-foreground" title={project.projectDescription}>
              {project.projectDescription}
            </div>
          )}
        </div>
      ),
    },
    {
      header: 'Site & location',
      cell: (project) => {
        const inCharge = inChargeLabel(project.siteInCharge);
        return (
          <div className="min-w-0">
            <Muted>{project.projectSite}</Muted>
            {project.location && <div className="text-xs text-muted-foreground">{project.location}</div>}
            {inCharge && (
              <div className="mt-0.5 hidden items-center gap-1 text-xs text-muted-foreground sm:flex xl:hidden">
                <UserRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                {inCharge}
              </div>
            )}
          </div>
        );
      },
    },
    { header: 'In-charge', className: 'hidden xl:table-cell', cell: (project) => <Muted>{inChargeLabel(project.siteInCharge)}</Muted> },
    {
      header: 'Sub-divisions',
      mobile: 'footer',
      cell: (project) => {
        const count = subdivisionsOf(project).length;
        const isOpen = openIds.has(project.id);
        return (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={isOpen}
            onClick={() => onToggle(project.id)}
            className={cn('gap-1.5 whitespace-nowrap', isOpen && 'border-amber-300 bg-amber-50 text-amber-900', count === 0 && !isOpen && 'text-muted-foreground')}
          >
            <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} aria-hidden="true" />
            {sitesLabel(count)}
          </Button>
        );
      },
    },
    { header: 'Status', mobile: 'aside', className: 'hidden xl:table-cell', cell: (project) => <StatusBadge status={project.status ?? 'Active'} /> },
    {
      header: 'Actions',
      align: 'right',
      mobile: 'footer',
      cell: (project) =>
        can.edit || can.delete ? (
          <div className="flex justify-end gap-1">
            {can.edit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onEditProject(project)}
                aria-label={`Edit ${project.projectName}`}
                title="Edit project"
                className="gap-1.5 sm:h-8 sm:w-8 sm:px-0"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sm:hidden">Edit</span>
              </Button>
            )}
            {can.delete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDeleteProject(project)}
                aria-label={`Delete ${project.projectName}`}
                title="Delete project"
                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 sm:w-8 sm:px-0"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    // From `lg` the page gives this a fixed height: the figures keep their size and the register
    // takes the rest, scrolling inside itself.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Projects" value={summary.total} hint={`${summary.inactive} inactive`} icon={FolderKanban} tone="amber" accent />
        <KpiCard label="Active" value={summary.active} hint={summary.total ? `${Math.round((summary.active / summary.total) * 100)}% of projects` : undefined} icon={MapPinned} tone="emerald" accent />
        <KpiCard label="Sites" value={summary.sites} hint={`${summary.activeSites} active`} icon={Layers} tone="blue" accent />
        <KpiCard label="Without sites" value={summary.withoutSites} hint="Not yet split" icon={CircleSlash} tone="slate" accent />
      </div>

      <TableCard
        title="Projects"
        icon={FolderKanban}
        count={rows.length}
        total={projects.length}
        noun="project"
        scroll="fill"
        className="lg:flex-1"
        actions={
          rows.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => onSetExpanded(allOpen ? new Set() : new Set(rows.map((project) => project.id)))}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search projects, codes, sites…' }}
            activeCount={activeFilters}
            onClear={() => {
              setSearch('');
              setStatus('all');
              setDivision(ALL_DIVISIONS);
              setSitesFilter('all');
            }}
          >
            <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
              <SelectTrigger aria-label="Status" className="sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            {divisions.length > 0 && (
              <Select value={division} onValueChange={setDivision}>
                <SelectTrigger aria-label="Division" className="text-left sm:w-44"><span className="truncate"><SelectValue /></span></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_DIVISIONS}>All divisions</SelectItem>
                  {divisions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={sitesFilter} onValueChange={(value) => setSitesFilter(value as SitesFilter)}>
              <SelectTrigger aria-label="Sub-division sites" className="sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any sites</SelectItem>
                <SelectItem value="with">With sites</SelectItem>
                <SelectItem value="without">Without sites</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        <div className="p-3 sm:p-0">
          <DataList
            frameless
            dense
            rows={rows}
            columns={columns}
            expandedIds={openIds}
            rowClassName={(project) => (project.status === 'Inactive' ? 'opacity-75' : undefined)}
            renderExpanded={(project) => (
              <SitesPanel
                project={project}
                highlight={siteHits.get(project.id)}
                can={can}
                onAdd={() => onAddSite(project)}
                onEdit={(site) => onEditSite(project, site)}
                onDelete={(site) => onDeleteSite(project, site)}
              />
            )}
            empty={
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <FolderKanban className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-700">{projects.length === 0 ? 'No projects yet' : 'No project matches these filters'}</p>
                <p className="text-xs text-muted-foreground">
                  {projects.length === 0 ? 'Add the first project with the button above.' : 'Try a different search, or clear the filters.'}
                </p>
              </div>
            }
          />
        </div>
      </TableCard>
    </div>
  );
}

/** One project's sites, under its row: a compact table on a desktop, stacked rows on a phone. */
function SitesPanel({
  project,
  highlight,
  can,
  onAdd,
  onEdit,
  onDelete,
}: {
  project: Project;
  highlight?: ReadonlySet<string>;
  can: ProjectRegisterAbilities;
  onAdd: () => void;
  onEdit: (site: ProjectSubdivision) => void;
  onDelete: (site: ProjectSubdivision) => void;
}) {
  const sites = subdivisionsOf(project);
  const grid = 'sm:grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_6rem_5.5rem] sm:items-center sm:gap-4';

  return (
    <div className="sm:px-5 sm:py-4">
      <div className="border-l-2 border-amber-300 pl-3 sm:pl-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Layers className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Sub-division sites
            <span className="text-xs font-normal text-muted-foreground">({sites.length})</span>
          </p>
          {can.add && (
            <Button type="button" size="sm" variant="outline" onClick={onAdd} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add site
            </Button>
          )}
        </div>

        {sites.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 px-4 py-6 text-center">
            <MapPinned className="mx-auto h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
            <p className="mt-1.5 text-sm font-medium text-slate-700">No sub-division sites yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Split the project into the sections, substations or work fronts it is executed at.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className={cn('hidden border-b bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground [&>span]:truncate', grid)}>
              <span>Site</span>
              <span>Code</span>
              <span>Location</span>
              <span>In-charge</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {sites.map((site) => {
                const inCharge = inChargeLabel(site.siteInCharge);
                return (
                  <li key={site.id} className={cn('px-3 py-2.5 text-sm', grid, highlight?.has(site.id) && 'bg-amber-50', site.status === 'Inactive' && 'text-muted-foreground')}>
                    {/* Phone: name and status on one line, the rest beneath. */}
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0 font-medium text-slate-800 [overflow-wrap:anywhere]">{site.name}</span>
                      <span className="shrink-0 sm:hidden"><StatusBadge status={site.status} /></span>
                    </div>
                    {/* An empty field is a dash in its desktop column and no line at all on a phone. */}
                    <div className={cn('mt-0.5 sm:mt-0', !site.code && 'hidden sm:block')}>
                      {site.code ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{site.code}</span> : <span className="text-muted-foreground">—</span>}
                    </div>
                    <div className={cn('mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:mt-0 sm:text-sm sm:text-inherit', !site.location && 'hidden sm:flex')}>
                      <MapPin className="h-3.5 w-3.5 shrink-0 sm:hidden" aria-hidden="true" />
                      <span className="truncate">{site.location || '—'}</span>
                    </div>
                    <div className={cn('mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:mt-0 sm:text-sm sm:text-inherit', !inCharge && 'hidden sm:flex')}>
                      <UserRound className="h-3.5 w-3.5 shrink-0 sm:hidden" aria-hidden="true" />
                      <span className="truncate">{inCharge || '—'}</span>
                    </div>
                    <div className="hidden sm:block"><StatusBadge status={site.status} /></div>
                    {(can.edit || can.delete) && (
                      <div className="mt-2 flex justify-end gap-1 sm:mt-0">
                        {can.edit && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(site)} aria-label={`Edit ${site.name}`} title="Edit site" className="h-8 px-2">
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="ml-1.5 sm:hidden">Edit</span>
                          </Button>
                        )}
                        {can.delete && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(site)} aria-label={`Remove ${site.name}`} title="Remove site" className="h-8 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="ml-1.5 sm:hidden">Remove</span>
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
