'use client';

import { useCallback, useEffect, useState } from 'react';
import { HardHat, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { EApprovalProjectMode, EApprovalProjectRouting, EApprovalProjectRoleHolder } from '@/lib/e-approval';
import {
  listEApprovalProjectRouting,
  saveEApprovalProjectRouting,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import { AssigneePicker } from '../assignee-picker';
import { Field } from '../page-header';
import type { EApprovalDirectory } from '../hooks';
import {
  matchesSearch,
  SettingsEmpty,
  SettingsFormDialog,
  SettingsList,
  SettingsRow,
  SettingsToolbar,
  useSettingsDraft,
} from './settings-ui';

type Draft = Partial<EApprovalProjectRouting> & { projectId: string };

const MODE_LABEL: Record<EApprovalProjectMode, string> = {
  Role: 'Stages name a post',
  Head: 'Routes to the project head',
  Anyone: 'Anyone on the team can take it',
  Queue: 'Queued for the head to assign',
};

/** The posts most EPC sites have, offered as one-click additions rather than typed each time. */
const SUGGESTED_POSTS = [
  'Project Manager',
  'Site In-Charge',
  'Planning Engineer',
  'Site Accountant',
  'Store In-Charge',
  'QA/QC Head',
  'Safety Officer',
];

/**
 * Project routing — who holds which post on each project.
 *
 * This is the table that makes one workflow serve every site. A stage configured as "Project Manager"
 * carries no user id; when a request naming Ranchi Metro is submitted, the chain is built against
 * *this* project's row and the stage becomes that project's manager. Two projects, two managers, one
 * workflow.
 *
 * As with department routing, every project is listed whether configured or not — the unconfigured
 * ones are the ones that matter, because a project-addressed stage on a project with no row reaches
 * nobody, and an administrator needs to see that at a glance rather than by opening each in turn.
 */
export function ProjectRoutingPanel({
  serviceActor,
  directory,
  canEdit,
}: {
  serviceActor: EApprovalServiceActor | null;
  directory: EApprovalDirectory;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EApprovalProjectRouting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const form = useSettingsDraft<Draft>();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await listEApprovalProjectRouting(serviceActor?.organizationId));
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor?.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const holders = form.draft?.roleHolders ?? [];

  const patchHolder = (index: number, patch: Partial<EApprovalProjectRoleHolder>) =>
    form.patch({
      roleHolders: holders.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    });

  const addHolder = (role = '') =>
    form.patch({ roleHolders: [...holders, { role, userId: '' }] });

  const save = async () => {
    if (!serviceActor || !form.draft) return;
    form.setBusy(true);
    try {
      await saveEApprovalProjectRouting(
        {
          id: form.draft.projectId,
          projectId: form.draft.projectId,
          projectName: directory.projectById.get(form.draft.projectId)?.projectName,
          mode: (form.draft.mode ?? 'Role') as EApprovalProjectMode,
          headUserId: form.draft.headUserId,
          headUserName: form.draft.headUserId ? directory.userById.get(form.draft.headUserId)?.name : undefined,
          headDesignation: form.draft.headUserId ? directory.userById.get(form.draft.headUserId)?.role : undefined,
          memberUserIds: form.draft.memberUserIds ?? [],
          roleHolders: holders
            .filter((entry) => entry.role.trim() && entry.userId)
            .map((entry) => ({
              role: entry.role.trim(),
              userId: entry.userId,
              userName: directory.userById.get(entry.userId)?.name,
              designation: directory.userById.get(entry.userId)?.role,
            })),
          departmentId: form.draft.departmentId,
          active: form.draft.active !== false,
        },
        serviceActor,
      );
      toast({ title: 'Project routing saved' });
      form.close();
      void load();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Not saved',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      form.setBusy(false);
    }
  };

  const visible = directory.projects.filter((project) => matchesSearch(search, project.projectName));
  const draftProjectName = form.draft ? directory.projectById.get(form.draft.projectId)?.projectName : undefined;

  return (
    <div className="space-y-3">
      <SettingsToolbar count={directory.projects.length} noun="project" search={search} onSearch={setSearch}>
        <Badge
          variant="outline"
          className={
            rows.length === directory.projects.length
              ? 'text-[10px]'
              : 'border-amber-300 bg-amber-50 text-[10px] text-amber-800'
          }
        >
          {rows.length} configured
        </Badge>
      </SettingsToolbar>

      <SettingsList
        isLoading={isLoading}
        isEmpty={!visible.length}
        empty={
          <SettingsEmpty
            icon={HardHat}
            title={directory.projects.length ? 'Nothing matches that search' : 'No projects'}
            description={
              directory.projects.length
                ? undefined
                : 'Projects come from the project master. Once they exist you can say who holds each post on them, and a workflow stage can name the post rather than the person.'
            }
          />
        }
      >
        {visible.map((project) => {
          const saved = rows.find((row) => row.projectId === project.id);
          const mode = (saved?.mode ?? 'Role') as EApprovalProjectMode;
          const posts = saved?.roleHolders ?? [];
          const headName = saved?.headUserId ? directory.userById.get(saved.headUserId)?.name : undefined;

          return (
            <SettingsRow
              key={project.id}
              title={project.projectName}
              badges={
                <>
                  {saved ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {mode}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">
                      Not configured
                    </Badge>
                  )}
                  {posts.length > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {posts.length} post{posts.length === 1 ? '' : 's'}
                    </Badge>
                  )}
                </>
              }
              subtitle={
                saved ? (
                  <>
                    {MODE_LABEL[mode]}
                    {headName ? ` · head ${headName}` : ' · no head set'}
                    {(saved.memberUserIds?.length ?? 0) > 0 &&
                      ` · ${saved.memberUserIds?.length} team member${saved.memberUserIds?.length === 1 ? '' : 's'}`}
                  </>
                ) : (
                  <>A stage addressed to this project&rsquo;s posts would reach nobody. Configure it to name them.</>
                )
              }
              detail={
                posts.length ? (
                  <div className="flex flex-wrap gap-1">
                    {posts.map((post) => (
                      <Badge key={`${post.role}-${post.userId}`} variant="outline" className="text-[10px] font-normal">
                        <span className="font-medium">{post.role}</span>
                        <span className="text-muted-foreground">
                          {' · '}
                          {post.userName || directory.userById.get(post.userId)?.name || 'unknown'}
                        </span>
                      </Badge>
                    ))}
                  </div>
                ) : undefined
              }
              actions={
                canEdit && (
                  <Button
                    size="sm"
                    variant={saved ? 'ghost' : 'outline'}
                    className={saved ? 'h-8 w-8 p-0' : 'h-8 gap-1.5 text-xs'}
                    onClick={() =>
                      form.setDraft(
                        saved
                          ? { ...saved, projectId: project.id }
                          : {
                              projectId: project.id,
                              mode: 'Role',
                              roleHolders: [{ role: 'Project Manager', userId: '' }],
                              memberUserIds: [],
                              active: true,
                            },
                      )
                    }
                    aria-label={`Configure ${project.projectName}`}
                  >
                    {saved ? <Pencil className="h-3.5 w-3.5" /> : <>Configure</>}
                  </Button>
                )
              }
            />
          );
        })}
      </SettingsList>

      <SettingsFormDialog
        open={form.open}
        onOpenChange={(next) => !next && form.close()}
        title={draftProjectName ? `Routing — ${draftProjectName}` : 'Project routing'}
        description="Who holds which post here. A workflow stage naming a post resolves to this person on this project, and to somebody else on the next."
        wide
        busy={form.busy}
        dirty={form.isDirty}
        onSave={() => void save()}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default for stages addressed to the project as a whole">
            <Select
              value={form.draft?.mode ?? 'Role'}
              onValueChange={(next) => form.patch({ mode: next as EApprovalProjectMode })}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Role">Stages name a post — set the holders below</SelectItem>
                <SelectItem value="Head">Route straight to the project head</SelectItem>
                <SelectItem value="Anyone">Anyone on the team can take it</SelectItem>
                <SelectItem value="Queue">Hold in a queue; the head assigns it</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Project head" hint="The fallback for any post with no holder set.">
            <Select
              value={form.draft?.headUserId ?? 'NONE'}
              onValueChange={(next) => form.patch({ headUserId: next === 'NONE' ? undefined : next })}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Not set</SelectItem>
                {directory.users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name} — {user.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Administered by department" hint="Optional — used for reporting and department-wide stages.">
            <Select
              value={form.draft?.departmentId ?? 'NONE'}
              onValueChange={(next) => form.patch({ departmentId: next === 'NONE' ? undefined : next })}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Not set</SelectItem>
                {directory.departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="border-t pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Posts on this project
          </p>
          <p className="mb-2 mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            A workflow stage set to a post — &ldquo;Project Manager&rdquo; — becomes the person named here when a
            request on this project is raised. Names must match the stage exactly, so pick from the suggestions where
            you can.
          </p>

          <div className="space-y-1.5">
            {holders.map((holder, index) => (
              <div key={index} className="flex flex-wrap items-center gap-1.5">
                <Input
                  value={holder.role}
                  onChange={(event) => patchHolder(index, { role: event.target.value })}
                  placeholder="Project Manager"
                  list="e-approval-post-suggestions"
                  className="h-8 max-w-[200px] text-xs"
                />
                <Select
                  value={holder.userId || 'NONE'}
                  onValueChange={(next) => patchHolder(index, { userId: next === 'NONE' ? '' : next })}
                >
                  <SelectTrigger className="h-8 max-w-[280px] text-xs">
                    <SelectValue placeholder="Who holds it" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Not set</SelectItem>
                    {directory.users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name} — {user.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-destructive"
                  onClick={() =>
                    form.patch({ roleHolders: holders.filter((_, position) => position !== index) })
                  }
                  aria-label={`Remove ${holder.role || 'post'}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <datalist id="e-approval-post-suggestions">
            {SUGGESTED_POSTS.map((post) => (
              <option key={post} value={post} />
            ))}
          </datalist>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => addHolder()}>
              <Plus className="h-3.5 w-3.5" /> Add a post
            </Button>
            {SUGGESTED_POSTS.filter(
              (post) => !holders.some((holder) => holder.role.trim().toLowerCase() === post.toLowerCase()),
            ).map((post) => (
              <Button
                key={post}
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 rounded-full border px-2 text-[11px] font-normal"
                onClick={() => addHolder(post)}
              >
                + {post}
              </Button>
            ))}
          </div>
        </div>

        {form.draft?.mode !== 'Head' && (
          <div className="border-t pt-3">
            <AssigneePicker
              directory={directory}
              value={(form.draft?.memberUserIds ?? []).map((userId) => ({
                kind: 'User' as const,
                userId,
                userName: directory.userById.get(userId)?.name,
              }))}
              onChange={(next) =>
                form.patch({ memberUserIds: next.map((entry) => entry.userId).filter(Boolean) as string[] })
              }
              multiple
              allowDepartment={false}
              allowRole={false}
              allowProject={false}
              label="Team members who may act for this project"
            />
            {!(form.draft?.memberUserIds ?? []).length && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Users className="mt-0.5 h-3 w-3 shrink-0" />
                Post holders can always act on their own stages. This list only matters for stages addressed to the
                whole team.
              </p>
            )}
          </div>
        )}
      </SettingsFormDialog>
    </div>
  );
}
