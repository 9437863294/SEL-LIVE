'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Pencil, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  eApprovalDepartmentCode,
  type EApprovalDepartmentMode,
  type EApprovalDepartmentRouting,
} from '@/lib/e-approval';
import {
  listEApprovalDepartmentRouting,
  saveEApprovalDepartmentRouting,
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

type Draft = Partial<EApprovalDepartmentRouting> & { departmentId: string };

const MODE_LABEL: Record<EApprovalDepartmentMode, string> = {
  Anyone: 'Anyone listed can take it',
  Head: 'Routes to the head',
  Queue: 'Queued for the head to assign',
};

/**
 * Department routing (spec sections 11 and 33).
 *
 * The list is every department, configured or not, because the unconfigured ones are the ones that
 * matter: a department with no routing reaches only its head, and an administrator needs to see that
 * at a glance rather than by opening each in turn. Previously each row expanded into an inline form,
 * which turned a twenty-department organisation into a twenty-accordion page.
 */
export function DepartmentRoutingPanel({
  serviceActor,
  directory,
  canEdit,
}: {
  serviceActor: EApprovalServiceActor | null;
  directory: EApprovalDirectory;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EApprovalDepartmentRouting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const form = useSettingsDraft<Draft>();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await listEApprovalDepartmentRouting(serviceActor?.organizationId));
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor?.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!serviceActor || !form.draft) return;
    form.setBusy(true);
    try {
      await saveEApprovalDepartmentRouting(
        {
          id: form.draft.departmentId,
          departmentId: form.draft.departmentId,
          departmentName: directory.departmentById.get(form.draft.departmentId)?.name,
          approvalCode: form.draft.approvalCode,
          mode: (form.draft.mode ?? 'Head') as EApprovalDepartmentMode,
          headUserId: form.draft.headUserId,
          headUserName: form.draft.headUserId ? directory.userById.get(form.draft.headUserId)?.name : undefined,
          memberUserIds: form.draft.memberUserIds ?? [],
          active: form.draft.active !== false,
        },
        serviceActor,
      );
      toast({ title: 'Routing saved' });
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

  const visible = directory.departments.filter((department) => matchesSearch(search, department.name));
  const configuredCount = rows.length;
  const draftDepartmentName = form.draft ? directory.departmentById.get(form.draft.departmentId)?.name : undefined;

  return (
    <div className="space-y-3">
      <SettingsToolbar count={directory.departments.length} noun="department" search={search} onSearch={setSearch}>
        <Badge
          variant="outline"
          className={
            configuredCount === directory.departments.length
              ? 'text-[10px]'
              : 'border-amber-300 bg-amber-50 text-[10px] text-amber-800'
          }
        >
          {configuredCount} configured
        </Badge>
      </SettingsToolbar>

      <SettingsList
        isLoading={isLoading}
        isEmpty={!visible.length}
        empty={
          <SettingsEmpty
            icon={Building2}
            title={directory.departments.length ? 'Nothing matches that search' : 'No departments'}
            description={
              directory.departments.length
                ? undefined
                : 'Departments come from Settings → Manage Department. Once they exist you can say who a department-addressed approval reaches.'
            }
          />
        }
      >
        {visible.map((department) => {
          const saved = rows.find((row) => row.departmentId === department.id);
          const mode = (saved?.mode ?? 'Head') as EApprovalDepartmentMode;
          const members = saved?.memberUserIds ?? [];
          const headName = saved?.headUserId
            ? directory.userById.get(saved.headUserId)?.name
            : department.head
              ? directory.userById.get(department.head)?.name
              : undefined;

          return (
            <SettingsRow
              key={department.id}
              title={department.name}
              badges={
                <>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {saved?.approvalCode || eApprovalDepartmentCode(department.name) || '—'}
                  </Badge>
                  {saved ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {mode}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">
                      Not configured
                    </Badge>
                  )}
                </>
              }
              subtitle={
                saved ? (
                  <>
                    {MODE_LABEL[mode]}
                    {headName ? ` · head ${headName}` : ' · no head set'}
                    {mode !== 'Head' && ` · ${members.length} member${members.length === 1 ? '' : 's'}`}
                  </>
                ) : (
                  <>
                    Reaches only the department head
                    {headName ? ` (${headName})` : ' — and none is set, so nobody can act'}. Configure it to let others
                    take these approvals.
                  </>
                )
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
                          ? { ...saved, departmentId: department.id }
                          : {
                              departmentId: department.id,
                              mode: 'Head',
                              headUserId: department.head,
                              memberUserIds: [],
                              active: true,
                            },
                      )
                    }
                    aria-label={`Configure ${department.name}`}
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
        title={draftDepartmentName ? `Routing — ${draftDepartmentName}` : 'Department routing'}
        description="Who a step addressed to this department reaches, and the code it contributes to reference numbers."
        busy={form.busy}
        onSave={() => void save()}
      >
        <Field label="How steps behave">
          <Select
            value={form.draft?.mode ?? 'Head'}
            onValueChange={(next) => form.patch({ mode: next as EApprovalDepartmentMode })}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Anyone">Anyone listed can take it</SelectItem>
              <SelectItem value="Head">Route straight to the head</SelectItem>
              <SelectItem value="Queue">Hold in a queue; the head assigns it</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Department head">
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

        <Field
          label="Reference code"
          hint={`Produces EA/${form.draft?.approvalCode || eApprovalDepartmentCode(draftDepartmentName) || 'XXX'}/2026-27/00001`}
        >
          <Input
            value={form.draft?.approvalCode ?? ''}
            onChange={(event) => form.patch({ approvalCode: event.target.value.toUpperCase() })}
            placeholder={eApprovalDepartmentCode(draftDepartmentName)}
            className="h-9 font-mono"
          />
        </Field>

        {/* Members only matter where somebody other than the head can act. */}
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
              label="Members who may act for this department"
            />
            {!(form.draft?.memberUserIds ?? []).length && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-800">
                <Users className="mt-0.5 h-3 w-3 shrink-0" />
                With no members listed, only the head can act — the same as choosing &quot;route to the head&quot;.
              </p>
            )}
          </div>
        )}
      </SettingsFormDialog>
    </div>
  );
}
