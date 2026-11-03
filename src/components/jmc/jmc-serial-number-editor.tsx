'use client';

/**
 * The JMC serial-number editor, shared by Billing Recon and Project Management.
 *
 * A JMC number is drawn from one counter per (project, Scope 2, Scope 1) — the document id is
 * `jmcSerialConfigId(projectId, scope1, scope2)` (src/lib/jmc-module.ts). Which collection holds
 * that counter depends on who is numbering and whether the project's Billing Recon data has been
 * separated (src/lib/billing-recon/register.ts):
 *   - Billing Recon always numbers from `billingReconSerialConfigs` (its MVAC entries draw from the
 *     same counter ids).
 *   - Project Management and Subcontractors number from `projectJmcSerialCollection(project)` —
 *     the same shared counter until the project is separated, `projectJmcSerialConfigs` after.
 *
 * The host passes both rules in (`serialCollection`, `boqCollection`), so this component holds no
 * opinion about registers. The scope pairs it lists come from the host's BOQ collection, exactly as
 * the original Billing Recon page did.
 *
 * The three function props are fetch dependencies: pass module-level functions or memoised ones,
 * or every render re-reads Firestore.
 *
 * Styling is the app's shared UI only (cards, badges, theme tokens) — no module's page kit — so it
 * looks right in whichever module hosts it. The host wraps it in its own page container.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Hash, Layers, Loader2, Save, type LucideIcon } from 'lucide-react';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { BoqItem, Project, SerialNumberConfig } from '@/lib/types';
import { jmcSerialConfigId } from '@/lib/jmc-module';
import { PageHeader } from '@/components/shared/page-header';
import { SearchInput } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

export interface JmcSerialNumberEditorProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  backHref: string;
  backLabel?: string;
  /** Top-level collection the project's JMC counters are read from and saved to. */
  serialCollection: (project: Project) => string;
  /** Subcollection under `projects/{id}` whose Scope 1 / Scope 2 pairs are listed. */
  boqCollection: (project: Project) => string;
  /** Limits which projects are listed (and read). Every project when omitted. */
  projectFilter?: (project: Project) => boolean;
  /** `module` on the activity-log row a save writes. */
  activityModule: string;
  /** False renders every field read-only and hides Save. */
  canEdit: boolean;
  /** Shown under the header once the projects are loaded — e.g. which counter is being edited. */
  notice?: (projects: Project[]) => ReactNode;
  /** Outer wrapper classes; defaults to a plain stacked container (the host supplies the padding). */
  className?: string;
  /** Buttons for the header's action area. */
  headerActions?: ReactNode;
  /** A row of the host's own controls between the notice and the list (e.g. a project filter). */
  toolbar?: ReactNode;
  /** What to say when no project is listed. */
  emptyText?: ReactNode;
}

const initialConfigState: SerialNumberConfig = {
  prefix: '',
  format: '',
  suffix: '',
  startingIndex: 1,
};

const DEFAULT_CLASS = 'w-full min-w-0 space-y-4';

const abbreviation = (value: unknown) => String(value ?? '').substring(0, 3).toUpperCase();

/** The number the next JMC / MVAC of this series gets, exactly as the entry screens build it. */
const previewNumber = (config: SerialNumberConfig) =>
  `${config.prefix || ''}${config.format || ''}${String(Number(config.startingIndex) || 1).padStart(4, '0')}${config.suffix || ''}`;

/** Scope 2 → sorted Scope 1 values found on a project's BOQ. */
type ProjectScopes = Record<string, string[]>;

export function JmcSerialNumberEditor({
  title,
  description,
  icon,
  backHref,
  backLabel = 'Back to settings',
  serialCollection,
  boqCollection,
  projectFilter,
  activityModule,
  canEdit,
  notice,
  className,
  headerActions,
  toolbar,
  emptyText,
}: JmcSerialNumberEditorProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [scopes, setScopes] = useState<Record<string, ProjectScopes>>({});
  const [configs, setConfigs] = useState<Record<string, SerialNumberConfig>>({});
  /** Which counters exist yet: an entry screen can't number from a series that was never saved. */
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  /** The "next number" box as typed, so it can be cleared and retyped. */
  const [indexText, setIndexText] = useState<Record<string, string>>({});
  const [savingStates, setSavingStates] = useState<Record<string, boolean>>({});
  const [loadedFor, setLoadedFor] = useState<unknown>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');
  /** The next number each counter had when it was read, to tell an edited one from an untouched one. */
  const loadedIndexRef = useRef<Record<string, number>>({});

  // Reads only; the effect below applies the result, so no state is set synchronously in it.
  const loadData = useCallback(async () => {
    const projectsSnap = await getDocs(collection(db, 'projects'));
    const projectsData = projectsSnap.docs
      .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }) as Project)
      .filter((project) => (projectFilter ? projectFilter(project) : true))
      .sort((a, b) => String(a.projectName ?? '').localeCompare(String(b.projectName ?? ''), 'en', { numeric: true, sensitivity: 'base' }));

    const allConfigs: Record<string, SerialNumberConfig> = {};
    const allSaved: Record<string, boolean> = {};
    const allScopes: Record<string, ProjectScopes> = {};

    await Promise.all(
      projectsData.map(async (project) => {
        const boqSnapshot = await getDocs(collection(db, 'projects', project.id, boqCollection(project)));
        const projectScopes: Record<string, Set<string>> = {};
        boqSnapshot.docs.forEach((boqDoc) => {
          const data = boqDoc.data() as BoqItem;
          // As text: a number in a Scope column (an Excel import) used to crash the slug builder.
          const scope1 = data['Scope 1'] === null || data['Scope 1'] === undefined ? '' : String(data['Scope 1']);
          const scope2 = data['Scope 2'] === null || data['Scope 2'] === undefined ? '' : String(data['Scope 2']);
          if (scope1 && scope2) {
            if (!projectScopes[scope2]) projectScopes[scope2] = new Set();
            projectScopes[scope2].add(scope1);
          }
        });

        const sorted: ProjectScopes = {};
        for (const scope2 of Object.keys(projectScopes).sort()) {
          sorted[scope2] = Array.from(projectScopes[scope2]).sort();
        }
        allScopes[project.id] = sorted;

        const counterCollection = serialCollection(project);
        await Promise.all(
          Object.entries(sorted).flatMap(([scope2, scope1s]) =>
            scope1s.map(async (scope1) => {
              const slug = jmcSerialConfigId(project.id, scope1, scope2);
              const configSnap = await getDoc(doc(db, counterCollection, slug));
              allSaved[slug] = configSnap.exists();
              allConfigs[slug] = configSnap.exists()
                ? (configSnap.data() as SerialNumberConfig)
                : {
                    ...initialConfigState,
                    prefix: `${abbreviation(project.projectName)}/${abbreviation(scope2)}/${abbreviation(scope1)}/`,
                  };
            }),
          ),
        );
      }),
    );

    return { projectsData, allScopes, allConfigs, allSaved };
  }, [projectFilter, boqCollection, serialCollection]);

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then(({ projectsData, allScopes, allConfigs, allSaved }) => {
        if (cancelled) return;
        setProjects(projectsData);
        setScopes(allScopes);
        setConfigs(allConfigs);
        setSaved(allSaved);
        setIndexText({});
        setLoadFailed(false);
        loadedIndexRef.current = Object.fromEntries(Object.entries(allConfigs).map(([slug, config]) => [slug, Number(config.startingIndex)]));
      })
      .catch((error) => {
        console.error('Error fetching JMC serial-number configuration:', error);
        if (cancelled) return;
        setLoadFailed(true);
        toast({ title: 'Error', description: 'Failed to fetch initial data.', variant: 'destructive' });
      })
      .finally(() => {
        // Loading is "not yet loaded for this filter", so a host changing its filter shows the
        // skeleton again instead of the previous list.
        if (!cancelled) setLoadedFor(() => loadData);
      });
    return () => {
      cancelled = true;
    };
  }, [loadData, toast]);

  const isLoading = loadedFor !== loadData;

  const handleConfigChange = (slug: string, field: keyof SerialNumberConfig, value: string | number) => {
    setConfigs((prev) => ({
      ...prev,
      [slug]: {
        ...(prev[slug] || initialConfigState),
        [field]: value,
      },
    }));
  };

  const handleIndexChange = (slug: string, text: string) => {
    setIndexText((prev) => ({ ...prev, [slug]: text }));
    const n = Math.floor(Number(text));
    if (text.trim() !== '' && Number.isFinite(n) && n >= 1) handleConfigChange(slug, 'startingIndex', n);
  };

  const handleSaveConfig = async (project: Project, slug: string, scope1: string, scope2: string) => {
    if (!user || !canEdit) return;
    const projectName = project.projectName;
    const counterCollection = serialCollection(project);
    setSavingStates((prev) => ({ ...prev, [slug]: true }));
    try {
      const ref = doc(db, counterCollection, slug);
      // Read fresh rather than trusting what this page loaded: issuing a JMC or MVAC moves the
      // number on. A next number nobody touched keeps whatever the series has reached since; writing
      // the loaded figure back (to change a prefix, say) used to rewind the counter and hand out
      // numbers already in use.
      const beforeSnap = await getDoc(ref);
      const before = beforeSnap.exists() ? (beforeSnap.data() as SerialNumberConfig) : null;
      const draft = configs[slug] || initialConfigState;
      const untouched = before !== null && Number(draft.startingIndex) === loadedIndexRef.current[slug];
      const liveIndex = before?.startingIndex;
      const index = Number(untouched && liveIndex !== undefined ? liveIndex : draft.startingIndex);
      const after: SerialNumberConfig = {
        ...(before ?? {}),
        ...draft,
        prefix: draft.prefix ?? '',
        format: draft.format ?? '',
        suffix: draft.suffix ?? '',
        // Never NaN or below 1: the entry screens would print it into a JMC number.
        startingIndex: Number.isFinite(index) && index >= 1 ? Math.floor(index) : 1,
      };
      await setDoc(ref, after);
      loadedIndexRef.current[slug] = after.startingIndex;
      setSaved((prev) => ({ ...prev, [slug]: true }));
      setConfigs((prev) => ({ ...prev, [slug]: after }));
      setIndexText((prev) => {
        const next = { ...prev };
        delete next[slug];
        return next;
      });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: activityModule,
        action: 'Update JMC Serial No. Config',
        details: { project: projectName, scope1, scope2, config: after, collection: counterCollection },
      });
      toast({
        title: 'Success',
        description:
          untouched && after.startingIndex !== Number(draft.startingIndex)
            ? `Configuration for ${projectName} - ${scope2} - ${scope1} saved. Numbers were issued meanwhile, so the next number stays at ${after.startingIndex}.`
            : `Configuration for ${projectName} - ${scope2} - ${scope1} saved.`,
      });
    } catch (error) {
      console.error('Failed to save JMC serial-number configuration:', error);
      toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
    } finally {
      setSavingStates((prev) => ({ ...prev, [slug]: false }));
    }
  };

  const noticeContent = useMemo(() => (!isLoading && notice ? notice(projects) : null), [isLoading, notice, projects]);

  /* ── what is shown ────────────────────────────────────────────────────────────────────────── */

  const needle = search.trim().toLowerCase();
  const visibleProjects = useMemo(() => {
    if (!needle) return projects;
    return projects.filter(
      (project) =>
        String(project.projectName ?? '').toLowerCase().includes(needle) ||
        Object.entries(scopes[project.id] ?? {}).some(
          ([scope2, scope1s]) => scope2.toLowerCase().includes(needle) || scope1s.some((s) => s.toLowerCase().includes(needle)),
        ),
    );
  }, [projects, scopes, needle]);

  const countsOf = (projectId: string) => {
    let series = 0;
    let missing = 0;
    for (const [scope2, scope1s] of Object.entries(scopes[projectId] ?? {})) {
      for (const scope1 of scope1s) {
        series += 1;
        if (!saved[jmcSerialConfigId(projectId, scope1, scope2)]) missing += 1;
      }
    }
    return { series, missing };
  };

  const totals = useMemo(() => {
    let series = 0;
    let missing = 0;
    for (const project of projects) {
      for (const [scope2, scope1s] of Object.entries(scopes[project.id] ?? {})) {
        for (const scope1 of scope1s) {
          series += 1;
          if (!saved[jmcSerialConfigId(project.id, scope1, scope2)]) missing += 1;
        }
      }
    }
    return { series, missing };
  }, [projects, scopes, saved]);

  return (
    <div className={className ?? DEFAULT_CLASS}>
      <PageHeader title={title} description={description} icon={icon} backHref={backHref} backLabel={backLabel} actions={headerActions} />

      {noticeContent}

      {toolbar}

      {!isLoading && !canEdit && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">You can view these numbers but not change them.</p>
      )}

      {!isLoading && !loadFailed && projects.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <FolderOpen className="h-3.5 w-3.5" aria-hidden />
              {projects.length} project{projects.length === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <Layers className="h-3.5 w-3.5" aria-hidden />
              {totals.series} series
            </span>
            {totals.missing > 0 ? (
              <StatusBadge tone="warning" title="An entry can't be numbered from a series that was never saved">
                {totals.missing} not set up
              </StatusBadge>
            ) : totals.series > 0 ? (
              <StatusBadge tone="success">All set up</StatusBadge>
            ) : null}
          </div>
          {projects.length > 1 && <SearchInput value={search} onChange={setSearch} placeholder="Project or scope" className="sm:w-64" />}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : loadFailed ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />
            <span className="text-muted-foreground">The number series could not be loaded. Check your connection and reload the page.</span>
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">{emptyText ?? 'No projects found.'}</CardContent>
        </Card>
      ) : visibleProjects.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No project or scope matches “{search.trim()}”.</CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="w-full space-y-3" defaultValue={projects.length === 1 ? [projects[0].id] : []}>
          {visibleProjects.map((project) => {
            const projectScopes = scopes[project.id] ?? {};
            const { series, missing } = countsOf(project.id);
            return (
              <AccordionItem value={project.id} key={project.id} className="border-none">
                <Card className="min-w-0 overflow-hidden">
                  <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline">
                    <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15" aria-hidden>
                        <Hash className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-foreground">{project.projectName}</span>
                        <span className="block text-xs font-normal text-muted-foreground">
                          {series ? `${series} series across ${Object.keys(projectScopes).length} scope 2` : 'No scopes in the BOQ'}
                        </span>
                      </span>
                    </span>
                    {missing > 0 ? (
                      <StatusBadge tone="warning" className="shrink-0">
                        {missing} not set up
                      </StatusBadge>
                    ) : series > 0 ? (
                      <StatusBadge tone="success" className="shrink-0">
                        Set up
                      </StatusBadge>
                    ) : null}
                  </AccordionTrigger>
                  <AccordionContent className="border-t border-border px-3 pb-4 pt-3 sm:px-4">
                    {Object.keys(projectScopes).length > 0 ? (
                      <div className="space-y-4">
                        {Object.entries(projectScopes).map(([scope2, scope1s]) => (
                          <section key={scope2} className="space-y-2.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <h3 className="min-w-0 truncate text-sm font-semibold text-foreground" title={scope2}>
                                <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Scope 2</span>
                                {scope2}
                              </h3>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {scope1s.length} series
                              </span>
                            </div>
                            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                              {scope1s.map((scope1) => {
                                const slug = jmcSerialConfigId(project.id, scope1, scope2);
                                const config = configs[slug] || initialConfigState;
                                const isSaved = Boolean(saved[slug]);
                                const fieldId = (name: string) => `serial-${slug}-${name}`;
                                return (
                                  <div key={slug} className="min-w-0 space-y-3 rounded-xl border border-border bg-muted/30 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-foreground" title={scope1}>
                                          <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Scope 1</span>
                                          {scope1}
                                        </div>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                          <span>
                                            Next number <span className="font-mono font-medium text-foreground">{previewNumber(config)}</span>
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {isSaved ? (
                                          <StatusBadge tone="success" dot>
                                            Saved
                                          </StatusBadge>
                                        ) : (
                                          <StatusBadge tone="warning" title="Entries for this scope can't be numbered until the series is saved">
                                            Not set up
                                          </StatusBadge>
                                        )}
                                        {canEdit && (
                                          <Button size="sm" onClick={() => void handleSaveConfig(project, slug, scope1, scope2)} disabled={savingStates[slug]}>
                                            {savingStates[slug] ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : isSaved ? <Save className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                            {isSaved ? 'Save' : 'Set up'}
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                      <div className="min-w-0 space-y-1">
                                        <Label htmlFor={fieldId('prefix')} className="text-xs">
                                          Prefix
                                        </Label>
                                        <Input
                                          id={fieldId('prefix')}
                                          value={config.prefix}
                                          readOnly={!canEdit}
                                          onChange={(e) => handleConfigChange(slug, 'prefix', e.target.value)}
                                        />
                                      </div>
                                      <div className="min-w-0 space-y-1">
                                        <Label htmlFor={fieldId('format')} className="text-xs">
                                          Format
                                        </Label>
                                        <Input
                                          id={fieldId('format')}
                                          value={config.format}
                                          readOnly={!canEdit}
                                          onChange={(e) => handleConfigChange(slug, 'format', e.target.value)}
                                        />
                                      </div>
                                      <div className="min-w-0 space-y-1">
                                        <Label htmlFor={fieldId('suffix')} className="text-xs">
                                          Suffix
                                        </Label>
                                        <Input
                                          id={fieldId('suffix')}
                                          value={config.suffix}
                                          readOnly={!canEdit}
                                          onChange={(e) => handleConfigChange(slug, 'suffix', e.target.value)}
                                        />
                                      </div>
                                      <div className="min-w-0 space-y-1">
                                        <Label htmlFor={fieldId('index')} className="text-xs">
                                          Next number
                                        </Label>
                                        <Input
                                          id={fieldId('index')}
                                          type="number"
                                          min={1}
                                          inputMode="numeric"
                                          value={indexText[slug] ?? String(config.startingIndex ?? 1)}
                                          readOnly={!canEdit}
                                          onChange={(e) => handleIndexChange(slug, e.target.value)}
                                          onBlur={() =>
                                            setIndexText((prev) => {
                                              const next = { ...prev };
                                              delete next[slug];
                                              return next;
                                            })
                                          }
                                          className="tabular-nums"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        No &apos;Scope 1&apos; or &apos;Scope 2&apos; values found in BOQ for this project.
                      </p>
                    )}
                  </AccordionContent>
                </Card>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

export default JmcSerialNumberEditor;
