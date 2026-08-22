'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
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
import type { EApprovalDirectory } from '../hooks';

/**
 * Department routing (spec sections 11 and 33).
 *
 * This screen exists because the codebase has no user→department field: department membership for
 * approval purposes has to be stated somewhere, and stating it here makes it an administrator's
 * explicit decision. Without a routing document, a step addressed to a department can only reach its
 * head — which is the safe failure, not a silent one.
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
  const [editing, setEditing] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<EApprovalDepartmentRouting>>>({});

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

  const rowFor = (departmentId: string): Partial<EApprovalDepartmentRouting> => {
    if (drafts[departmentId]) return drafts[departmentId];
    const saved = rows.find((row) => row.departmentId === departmentId);
    const department = directory.departmentById.get(departmentId);
    return (
      saved ?? {
        departmentId,
        departmentName: department?.name,
        mode: 'Head' as EApprovalDepartmentMode,
        headUserId: department?.head,
        memberUserIds: [],
        active: true,
      }
    );
  };

  const setDraft = (departmentId: string, patch: Partial<EApprovalDepartmentRouting>) =>
    setDrafts((current) => ({ ...current, [departmentId]: { ...rowFor(departmentId), ...patch } }));

  const save = async (departmentId: string) => {
    if (!serviceActor) return;
    const draft = rowFor(departmentId);
    setBusy(true);
    try {
      await saveEApprovalDepartmentRouting(
        {
          id: departmentId,
          departmentId,
          departmentName: directory.departmentById.get(departmentId)?.name,
          approvalCode: draft.approvalCode,
          mode: (draft.mode ?? 'Head') as EApprovalDepartmentMode,
          headUserId: draft.headUserId,
          headUserName: draft.headUserId ? directory.userById.get(draft.headUserId)?.name : undefined,
          memberUserIds: draft.memberUserIds ?? [],
          active: draft.active !== false,
        },
        serviceActor,
      );
      toast({ title: 'Routing saved' });
      setEditing(null);
      setDrafts((current) => {
        const next = { ...current };
        delete next[departmentId];
        return next;
      });
      void load();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Not saved',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="px-3 py-2.5 sm:px-4">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Building2 className="h-4 w-4" /> Department Routing
        </CardTitle>
        <CardDescription className="text-xs">
          Who a step addressed to a department reaches, and the code used in its reference numbers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3 sm:px-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : directory.departments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No departments configured.</p>
        ) : (
          directory.departments.map((department) => {
            const row = rowFor(department.id);
            const open = editing === department.id;
            const configured = rows.some((saved) => saved.departmentId === department.id);
            const memberAssignments = (row.memberUserIds ?? []).map((userId) => ({
              kind: 'User' as const,
              userId,
              userName: directory.userById.get(userId)?.name,
            }));
            return (
              <div key={department.id} className="rounded-lg border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{department.name}</p>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {row.approvalCode || eApprovalDepartmentCode(department.name) || '—'}
                  </Badge>
                  <Badge variant={configured ? 'secondary' : 'outline'} className="text-[10px]">
                    {row.mode ?? 'Head'}
                  </Badge>
                  {!configured && (
                    <span className="text-[11px] text-amber-700">
                      Not configured — only the department head can act
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {(row.memberUserIds ?? []).length} member{(row.memberUserIds ?? []).length === 1 ? '' : 's'}
                  </span>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-7 text-xs"
                      onClick={() => setEditing(open ? null : department.id)}
                    >
                      {open ? 'Close' : 'Configure'}
                    </Button>
                  )}
                </div>

                {open && (
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs">How steps addressed to this department behave</Label>
                        <Select
                          value={row.mode ?? 'Head'}
                          onValueChange={(next) =>
                            setDraft(department.id, { mode: next as EApprovalDepartmentMode })
                          }
                        >
                          <SelectTrigger className="mt-1 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Anyone">Anyone listed can take it</SelectItem>
                            <SelectItem value="Head">Route straight to the head</SelectItem>
                            <SelectItem value="Queue">Hold in a queue; the head assigns it</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Department head</Label>
                        <Select
                          value={row.headUserId ?? 'NONE'}
                          onValueChange={(next) =>
                            setDraft(department.id, { headUserId: next === 'NONE' ? undefined : next })
                          }
                        >
                          <SelectTrigger className="mt-1 h-8 text-xs">
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
                      </div>
                      <div>
                        <Label className="text-xs">Reference code</Label>
                        <Input
                          value={row.approvalCode ?? ''}
                          onChange={(event) =>
                            setDraft(department.id, { approvalCode: event.target.value.toUpperCase() })
                          }
                          placeholder={eApprovalDepartmentCode(department.name)}
                          className="mt-1 h-8 font-mono text-xs"
                        />
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Used as EA/{row.approvalCode || eApprovalDepartmentCode(department.name) || 'XXX'}/2026-27/00001
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <AssigneePicker
                        directory={directory}
                        value={memberAssignments}
                        onChange={(next) =>
                          setDraft(department.id, {
                            memberUserIds: next.map((entry) => entry.userId).filter(Boolean) as string[],
                          })
                        }
                        multiple
                        allowDepartment={false}
                        allowRole={false}
                        label="Members who may act for this department"
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() => void save(department.id)}
                          disabled={busy}
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
