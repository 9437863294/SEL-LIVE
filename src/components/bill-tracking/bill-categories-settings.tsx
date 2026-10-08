'use client';

/**
 * Settings → Bill categories: main categories and their sub categories.
 *
 * Main categories (Supply, Erection, Civil…) are one list for every project; each says which column
 * of the month-wise summary its billing is reported under. Sub categories (SUPPLY-60%, CIVIL-PV…)
 * sit under a main category and are enabled per project — "All projects" or a chosen list — which is
 * what the bill form offers once the project and main category are chosen.
 *
 * Edits are held on the page and written by "Save settings", so a delete can still be undone by
 * reloading before saving. Bills already saved keep the category names they were saved with.
 */

import { useMemo, useState } from 'react';
import { ChevronRight, FolderTree, Plus, Search, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { SectionHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { isEnabledForProject, sortedCategories, validateCategoryConfig } from '@/lib/bill-tracking/categories';
import { SUMMARY_COLUMNS, SUMMARY_COLUMN_LABELS, type BillCategoryMaster, type BillTypeMaster, type SummaryColumn } from '@/lib/bill-tracking/types';
import { cn } from '@/lib/utils';

import { useLookups, type ProjectOption } from './bt-client';
import { Notice } from './bt-ui';

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const ORPHANS = '__orphans__';

export function BillCategoriesEditor({
  categories,
  types,
  onChange,
  disabled,
}: {
  categories: BillCategoryMaster[];
  types: BillTypeMaster[];
  onChange: (categories: BillCategoryMaster[], types: BillTypeMaster[]) => void;
  disabled?: boolean;
}) {
  const lookups = useLookups();
  const ordered = sortedCategories(categories);
  const [selectedId, setSelectedId] = useState<string>(ordered[0]?.id ?? '');
  const [projectFilter, setProjectFilter] = useState('');
  const [search, setSearch] = useState('');

  const orphans = types.filter((type) => !categories.some((category) => category.id === type.categoryId));
  const selected = categories.find((category) => category.id === selectedId);
  const showingOrphans = selectedId === ORPHANS;
  const countOf = (categoryId: string) => types.filter((type) => type.categoryId === categoryId).length;
  const problem = validateCategoryConfig(categories, types);

  const visibleTypes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return types
      .filter((type) => (showingOrphans ? !categories.some((category) => category.id === type.categoryId) : type.categoryId === selectedId))
      .filter((type) => !projectFilter || isEnabledForProject(type, projectFilter))
      .filter((type) => !query || type.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'en-IN', { numeric: true }));
  }, [types, categories, selectedId, showingOrphans, projectFilter, search]);

  const updateCategory = (id: string, patch: Partial<BillCategoryMaster>) => onChange(categories.map((category) => (category.id === id ? { ...category, ...patch } : category)), types);
  const updateType = (id: string, patch: Partial<BillTypeMaster>) => onChange(categories, types.map((type) => (type.id === id ? { ...type, ...patch } : type)));

  const addCategory = () => {
    const id = newId('bc');
    onChange([...categories, { id, name: 'New main category', code: '', summaryColumn: 'other', sequence: Math.max(0, ...categories.map((category) => category.sequence)) + 1, active: true }], types);
    setSelectedId(id);
  };
  const deleteCategory = (category: BillCategoryMaster) => {
    const count = countOf(category.id);
    const message = `Delete main category “${category.name}”${count ? ` and its ${count} sub categor${count === 1 ? 'y' : 'ies'}` : ''}?\n\nBills already saved keep their category names. Nothing is removed until you click Save settings.`;
    if (!window.confirm(message)) return;
    const remaining = categories.filter((entry) => entry.id !== category.id);
    onChange(remaining, types.filter((type) => type.categoryId !== category.id));
    setSelectedId(sortedCategories(remaining)[0]?.id ?? '');
  };
  const addType = () => {
    if (!selected) return;
    onChange(categories, [
      ...types,
      { id: newId('bt'), name: '', code: '', categoryId: selected.id, projectIds: projectFilter ? [projectFilter] : [], isRetentionBill: false, isPriceVariation: false, active: true },
    ]);
    setSearch('');
  };
  const deleteType = (type: BillTypeMaster) => {
    if (!window.confirm(`Delete sub category “${type.name || 'unnamed'}”?\n\nBills already saved keep this name. Nothing is removed until you click Save settings.`)) return;
    onChange(categories, types.filter((entry) => entry.id !== type.id));
  };

  return (
    <div className="space-y-3">
      <Notice tone="blue">
        <b>Main categories</b> are the same for every project. <b>Sub categories</b> sit under a main category and are enabled per project — a new bill asks for the main category first, then offers only its sub categories enabled for that bill’s project. Changes take effect when you click <b>Save settings</b>.
      </Notice>
      {problem ? <Notice tone="rose">{problem}</Notice> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <Card className="border-white/60 bg-white/85 shadow-sm">
          <CardContent className="space-y-2 p-3">
            <SectionHeader title="Main categories" icon={FolderTree} as="h3" description="Shared by all projects." />
            <ul className="space-y-1" role="listbox" aria-label="Main categories">
              {ordered.map((category) => {
                const active = category.id === selectedId;
                return (
                  <li key={category.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => setSelectedId(category.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition',
                        active ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{category.name || 'Unnamed'}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {countOf(category.id)} sub categor{countOf(category.id) === 1 ? 'y' : 'ies'} · reports as {SUMMARY_COLUMN_LABELS[category.summaryColumn]}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {!category.active ? <StatusBadge tone="neutral">Inactive</StatusBadge> : null}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </span>
                    </button>
                  </li>
                );
              })}
              {orphans.length ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={showingOrphans}
                    onClick={() => setSelectedId(ORPHANS)}
                    className={cn('flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm', showingOrphans ? 'border-rose-500 bg-rose-50' : 'border-rose-200 bg-white')}
                  >
                    <span className="font-medium text-rose-800">Without a main category</span>
                    <StatusBadge tone="danger">{orphans.length}</StatusBadge>
                  </button>
                </li>
              ) : null}
            </ul>
            {!disabled ? (
              <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={addCategory}>
                <Plus className="h-4 w-4" /> Add main category
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-white/60 bg-white/85 shadow-sm">
          <CardContent className="space-y-4 p-4">
            {selected ? (
              <fieldset disabled={disabled} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-[minmax(0,1fr)_200px_auto_auto] sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor="bt-category-name" className="text-xs">
                    Main category
                  </Label>
                  <Input id="bt-category-name" value={selected.name} onChange={(event) => updateCategory(selected.id, { name: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reports under (month-wise summary)</Label>
                  <Select value={selected.summaryColumn} onValueChange={(value) => updateCategory(selected.id, { summaryColumn: value as SummaryColumn })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUMMARY_COLUMNS.map((column) => (
                        <SelectItem key={column} value={column}>
                          {SUMMARY_COLUMN_LABELS[column]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex h-10 items-center gap-2 text-sm">
                  <Switch checked={selected.active} onCheckedChange={(value) => updateCategory(selected.id, { active: value })} aria-label="Main category active" />
                  Active
                </label>
                {!disabled ? (
                  <Button type="button" variant="outline" className="gap-1.5 text-rose-700" onClick={() => deleteCategory(selected)}>
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                ) : null}
              </fieldset>
            ) : showingOrphans ? (
              <Notice tone="rose" title="Sub categories without a main category">Move each to a main category, or delete it, before saving.</Notice>
            ) : (
              <p className="text-sm text-muted-foreground">Add a main category to begin.</p>
            )}

            {selected || showingOrphans ? (
              <>
                <SectionHeader
                  title={showingOrphans ? 'Sub categories' : `Sub categories of ${selected?.name || 'this category'}`}
                  as="h3"
                  description="Enable each for all projects, or only the projects that bill it."
                  actions={
                    !disabled && selected ? (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={addType}>
                        <Plus className="h-4 w-4" /> Add sub category{projectFilter ? ' for this project' : ''}
                      </Button>
                    ) : null
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <div className="relative min-w-[180px] flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-8" placeholder="Find a sub category" value={search} onChange={(event) => setSearch(event.target.value)} />
                  </div>
                  <Select value={projectFilter || 'all'} onValueChange={(value) => setProjectFilter(value === 'all' ? '' : value)}>
                    <SelectTrigger className="w-full sm:w-64" aria-label="Show sub categories for a project">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="all">Every sub category</SelectItem>
                      {lookups.projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          Enabled for: {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {visibleTypes.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-muted-foreground">{projectFilter ? 'No sub categories of this main category are enabled for that project.' : 'No sub categories yet.'}</p>
                ) : (
                  <div className="space-y-2">
                    <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_repeat(3,72px)_40px] gap-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
                      <span>Sub category</span>
                      <span>Projects</span>
                      <span>Retention</span>
                      <span>Price var.</span>
                      <span>Active</span>
                      <span />
                    </div>
                    {visibleTypes.map((type) => (
                      <fieldset key={type.id} disabled={disabled} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_repeat(3,72px)_40px]">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground lg:sr-only">Sub category</Label>
                          <Input value={type.name} placeholder="e.g. SUPPLY-60%" onChange={(event) => updateType(type.id, { name: event.target.value.toUpperCase(), code: event.target.value.toUpperCase() })} aria-label="Sub category name" />
                          {showingOrphans ? (
                            <Select value="" onValueChange={(value) => updateType(type.id, { categoryId: value })}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Move to main category…" />
                              </SelectTrigger>
                              <SelectContent>
                                {ordered.map((category) => (
                                  <SelectItem key={category.id} value={category.id}>
                                    {category.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground lg:sr-only">Projects</Label>
                          <ProjectScopePicker value={type.projectIds} projects={lookups.projects} onChange={(projectIds) => updateType(type.id, { projectIds })} disabled={disabled} />
                        </div>
                        <ToggleCell label="Retention bill" checked={type.isRetentionBill} onChange={(value) => updateType(type.id, { isRetentionBill: value })} />
                        <ToggleCell label="Price variation" checked={type.isPriceVariation} onChange={(value) => updateType(type.id, { isPriceVariation: value })} />
                        <ToggleCell label="Active" checked={type.active} onChange={(value) => updateType(type.id, { active: value })} />
                        {!disabled ? (
                          <Button type="button" variant="ghost" size="icon" aria-label={`Delete sub category ${type.name}`} onClick={() => deleteType(type)} className="justify-self-end">
                            <Trash2 className="h-4 w-4 text-rose-600" />
                          </Button>
                        ) : (
                          <span />
                        )}
                      </fieldset>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ToggleCell({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs lg:justify-center">
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
      <span className="lg:sr-only">{label}</span>
    </label>
  );
}

/**
 * Which projects a sub category is enabled for. Empty = all projects. Projects outside the editor's
 * own access are kept as they are (and counted), so a site-scoped administrator cannot drop them.
 */
function ProjectScopePicker({ value, projects, onChange, disabled }: { value: string[]; projects: ProjectOption[]; onChange: (projectIds: string[]) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const all = value.length === 0;
  const hidden = value.filter((id) => !projects.some((project) => project.id === id));
  const shown = projects.filter((project) => !query.trim() || project.name.toLowerCase().includes(query.trim().toLowerCase()));
  const label = all ? 'All projects' : value.length === 1 ? (projects.find((project) => project.id === value[0])?.name ?? '1 project') : `${value.length} projects`;

  const toggle = (projectId: string) => {
    if (value.includes(projectId)) {
      // Unticking the last project would silently mean "all projects" — choose that explicitly instead.
      if (value.length === 1) return;
      onChange(value.filter((id) => id !== projectId));
    } else onChange([...value, projectId]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className={cn('h-10 w-full justify-between font-normal', all && 'text-emerald-700')}>
          <span className="truncate">{label}</span>
          <ChevronRight className="h-4 w-4 rotate-90 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-slate-50">
          <Checkbox checked={all} onCheckedChange={(checked) => onChange(checked ? [] : projects.slice(0, 1).map((project) => project.id))} />
          All projects
        </label>
        <div className="my-2 h-px bg-slate-200" />
        <Input className="h-8" placeholder="Find project" value={query} onChange={(event) => setQuery(event.target.value)} />
        <ul className="mt-2 max-h-64 overflow-y-auto">
          {shown.map((project) => {
            const checked = !all && value.includes(project.id);
            return (
              <li key={project.id}>
                <label className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50', all && 'text-muted-foreground')}>
                  <Checkbox checked={checked} disabled={checked && value.length === 1} onCheckedChange={() => (all ? onChange([project.id]) : toggle(project.id))} />
                  <span className="truncate">{project.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {hidden.length ? <p className="mt-2 px-2 text-[11px] text-muted-foreground">Also enabled for {hidden.length} project(s) outside your access — kept unchanged.</p> : null}
        {!all && value.length === 1 ? <p className="mt-1 px-2 text-[11px] text-muted-foreground">Keep at least one project, or tick “All projects”.</p> : null}
      </PopoverContent>
    </Popover>
  );
}
