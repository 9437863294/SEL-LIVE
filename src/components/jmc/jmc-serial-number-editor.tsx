'use client';

/**
 * The JMC serial-number editor, shared by Billing Recon and Project Management.
 *
 * A JMC number is drawn from one counter per (project, Scope 2, Scope 1) — the document id is
 * `jmcSerialConfigId(projectId, scope1, scope2)` (src/lib/jmc-module.ts). Which collection holds
 * that counter depends on who is numbering and whether the project's Billing Recon data has been
 * separated (src/lib/billing-recon/register.ts):
 *   - Billing Recon always numbers from `billingReconSerialConfigs`.
 *   - Project Management and Subcontractors number from `projectJmcSerialCollection(project)` —
 *     the same shared counter until the project is separated, `projectJmcSerialConfigs` after.
 *
 * The host passes both rules in (`serialCollection`, `boqCollection`), so this component holds no
 * opinion about registers. The scope pairs it lists come from the host's BOQ collection, exactly as
 * the original Billing Recon page did.
 *
 * The three function props are fetch dependencies: pass module-level functions or memoised ones,
 * or every render re-reads Firestore.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Save, type LucideIcon } from 'lucide-react';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { BoqItem, Project, SerialNumberConfig } from '@/lib/types';
import { jmcSerialConfigId } from '@/lib/jmc-module';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  /** Outer wrapper classes; defaults to Billing Recon's settings container. */
  className?: string;
}

const initialConfigState: SerialNumberConfig = {
  prefix: '',
  format: '',
  suffix: '',
  startingIndex: 1,
};

const DEFAULT_CLASS = 'w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8';

const abbreviation = (value: unknown) => String(value ?? '').substring(0, 3).toUpperCase();

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
}: JmcSerialNumberEditorProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [scopes, setScopes] = useState<Record<string, ProjectScopes>>({});
  const [configs, setConfigs] = useState<Record<string, SerialNumberConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingStates, setSavingStates] = useState<Record<string, boolean>>({});

  // Reads only; the effect below applies the result, so no state is set synchronously in it.
  const loadData = useCallback(async () => {
      const projectsSnap = await getDocs(collection(db, 'projects'));
      const projectsData = projectsSnap.docs
        .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }) as Project)
        .filter((project) => (projectFilter ? projectFilter(project) : true));

      const allConfigs: Record<string, SerialNumberConfig> = {};
      const allScopes: Record<string, ProjectScopes> = {};

      await Promise.all(
        projectsData.map(async (project) => {
          const boqSnapshot = await getDocs(collection(db, 'projects', project.id, boqCollection(project)));
          const projectScopes: Record<string, Set<string>> = {};
          boqSnapshot.docs.forEach((boqDoc) => {
            const data = boqDoc.data() as BoqItem;
            const scope1 = data['Scope 1'];
            const scope2 = data['Scope 2'];
            if (scope1 && scope2) {
              if (!projectScopes[scope2]) projectScopes[scope2] = new Set();
              projectScopes[scope2].add(scope1);
            }
          });

          const sorted: ProjectScopes = {};
          for (const scope2 of Object.keys(projectScopes)) {
            sorted[scope2] = Array.from(projectScopes[scope2]).sort();
          }
          allScopes[project.id] = sorted;

          const counterCollection = serialCollection(project);
          await Promise.all(
            Object.entries(sorted).flatMap(([scope2, scope1s]) =>
              scope1s.map(async (scope1) => {
                const slug = jmcSerialConfigId(project.id, scope1, scope2);
                const configSnap = await getDoc(doc(db, counterCollection, slug));
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

      return { projectsData, allScopes, allConfigs };
  }, [projectFilter, boqCollection, serialCollection]);

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then(({ projectsData, allScopes, allConfigs }) => {
        if (cancelled) return;
        setProjects(projectsData);
        setScopes(allScopes);
        setConfigs(allConfigs);
      })
      .catch((error) => {
        console.error('Error fetching JMC serial-number configuration:', error);
        if (!cancelled) toast({ title: 'Error', description: 'Failed to fetch initial data.', variant: 'destructive' });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadData, toast]);

  const handleConfigChange = (slug: string, field: keyof SerialNumberConfig, value: string | number) => {
    setConfigs((prev) => ({
      ...prev,
      [slug]: {
        ...(prev[slug] || initialConfigState),
        [field]: value,
      },
    }));
  };

  const handleSaveConfig = async (project: Project, slug: string, scope1: string, scope2: string) => {
    if (!user || !canEdit) return;
    const projectName = project.projectName;
    const counterCollection = serialCollection(project);
    setSavingStates((prev) => ({ ...prev, [slug]: true }));
    try {
      await setDoc(doc(db, counterCollection, slug), configs[slug]);
      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: activityModule,
        action: 'Update JMC Serial No. Config',
        details: { project: projectName, scope1, scope2, config: configs[slug], collection: counterCollection },
      });
      toast({ title: 'Success', description: `Configuration for ${projectName} - ${scope2} - ${scope1} saved.` });
    } catch (error) {
      console.error('Failed to save JMC serial-number configuration:', error);
      toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
    } finally {
      setSavingStates((prev) => ({ ...prev, [slug]: false }));
    }
  };

  const noticeContent = useMemo(
    () => (!isLoading && notice ? notice(projects) : null),
    [isLoading, notice, projects],
  );

  return (
    <div className={className ?? DEFAULT_CLASS}>
      <PageHeader title={title} description={description} icon={icon} backHref={backHref} backLabel={backLabel} />

      {noticeContent}

      {!isLoading && !canEdit && (
        <p className="mb-4 text-sm text-muted-foreground">
          You can view these numbers but not change them.
        </p>
      )}

      <Accordion type="multiple" className="w-full space-y-4">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : projects.length === 0 ? (
          <p className="p-4 text-center text-muted-foreground">No projects found.</p>
        ) : (
          projects.map((project) => (
            <AccordionItem value={project.id} key={project.id} className="border-none">
              <Card>
                <AccordionTrigger className="p-4 hover:no-underline">
                  <CardTitle>{project.projectName}</CardTitle>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <Accordion type="multiple" className="w-full space-y-3">
                    {scopes[project.id] && Object.keys(scopes[project.id]).length > 0 ? (
                      Object.entries(scopes[project.id]).map(([scope2, scope1s]) => (
                        <AccordionItem value={scope2} key={scope2} className="border-none">
                          <Card className="bg-muted/20">
                            <AccordionTrigger className="px-4 py-3 hover:no-underline">
                              <CardTitle>{scope2}</CardTitle>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pb-4">
                              <div className="space-y-4">
                                {scope1s.map((scope1) => {
                                  const slug = jmcSerialConfigId(project.id, scope1, scope2);
                                  const config = configs[slug] || initialConfigState;
                                  return (
                                    <Card key={slug} className="bg-background">
                                      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 py-3">
                                        <div className="min-w-0">
                                          <CardTitle className="truncate">{scope1}</CardTitle>
                                        </div>
                                        {canEdit && (
                                          <Button
                                            size="sm"
                                            onClick={() => void handleSaveConfig(project, slug, scope1, scope2)}
                                            disabled={savingStates[slug]}
                                          >
                                            {savingStates[slug] ? (
                                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                              <Save className="mr-2 h-4 w-4" />
                                            )}
                                            Save
                                          </Button>
                                        )}
                                      </CardHeader>
                                      <CardContent className="p-4 pt-0">
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                                          <div className="space-y-1">
                                            <Label className="text-xs">Prefix</Label>
                                            <Input
                                              value={config.prefix}
                                              readOnly={!canEdit}
                                              onChange={(e) => handleConfigChange(slug, 'prefix', e.target.value)}
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">Format</Label>
                                            <Input
                                              value={config.format}
                                              readOnly={!canEdit}
                                              onChange={(e) => handleConfigChange(slug, 'format', e.target.value)}
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">Suffix</Label>
                                            <Input
                                              value={config.suffix}
                                              readOnly={!canEdit}
                                              onChange={(e) => handleConfigChange(slug, 'suffix', e.target.value)}
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">Index</Label>
                                            <Input
                                              type="number"
                                              value={config.startingIndex}
                                              readOnly={!canEdit}
                                              onChange={(e) =>
                                                handleConfigChange(slug, 'startingIndex', parseInt(e.target.value, 10) || 1)
                                              }
                                            />
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  );
                                })}
                              </div>
                            </AccordionContent>
                          </Card>
                        </AccordionItem>
                      ))
                    ) : (
                      <p className="p-4 text-center text-muted-foreground">
                        No &apos;Scope 1&apos; or &apos;Scope 2&apos; values found in BOQ for this project.
                      </p>
                    )}
                  </Accordion>
                </AccordionContent>
              </Card>
            </AccordionItem>
          ))
        )}
      </Accordion>
    </div>
  );
}

export default JmcSerialNumberEditor;
