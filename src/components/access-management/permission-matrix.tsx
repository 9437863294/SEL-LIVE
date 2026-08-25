'use client';

/**
 * The visual permission matrix (§11).
 *
 * Modules down, canonical actions across. The subject can be a role or a user, because the two
 * questions an administrator asks of a matrix — "what does this role cover?" and "what can this
 * person do?" — want identical rendering and only differ in what feeds them.
 *
 * ── Why the columns are canonical rather than literal ───────────────────────────────────────────
 *
 * The registry was written module by module over years, so "create" is `Add` in HR, `Create` in
 * Billing Recon and `Record` in Survey. A matrix with a column per literal verb would be 60 columns
 * wide and mostly blank; one with seven canonical columns is scannable. The grouping lives in
 * `MATRIX_ACTION_SYNONYMS` and is used for display only — nothing is ever granted through it, so a
 * mis-grouped verb costs a confusing tick, not access. The tooltip carries the exact actions behind
 * every tick for when the grouping is not enough.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { Check, Download, Grid3x3, Minus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HrEmptyState } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  buildPermissionMatrix,
  countPermissions,
  MATRIX_ACTIONS,
  searchRegistry,
  type EffectiveAccess,
  type MatrixAction,
  type PermissionMap,
} from '@/lib/access-control';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';

type SubjectKind = 'role' | 'user';

export function PermissionMatrixView({ state }: { state: AccessDirectoryState }) {
  const { toast } = useToast();
  const { directory, accessByUser, registry } = state;

  const [kind, setKind] = useState<SubjectKind>('role');
  const [subjectId, setSubjectId] = useState('');
  const [term, setTerm] = useState('');
  const [onlyGranted, setOnlyGranted] = useState(false);

  const subject: { permissions: PermissionMap; access: EffectiveAccess | null; label: string } | null =
    useMemo(() => {
      if (!subjectId) return null;
      if (kind === 'role') {
        const role = directory.roles.find((entry) => entry.id === subjectId);
        if (!role) return null;
        return { permissions: (role.permissions ?? {}) as PermissionMap, access: null, label: role.name };
      }
      const user = directory.users.find((entry) => entry.id === subjectId);
      const access = accessByUser[subjectId];
      if (!user || !access) return null;
      return { permissions: access.permissions, access, label: user.name || user.email || user.id };
    }, [kind, subjectId, directory, accessByUser]);

  const filteredRegistry = useMemo(() => searchRegistry(registry, term), [registry, term]);

  const rows = useMemo(() => {
    if (!subject) return [];
    const built = buildPermissionMatrix(subject.permissions, filteredRegistry, {
      access: subject.access,
    });
    return onlyGranted ? built.filter((row) => row.grantedCount > 0) : built;
  }, [subject, filteredRegistry, onlyGranted]);

  const handleExport = async () => {
    if (!subject || !rows.length) return;
    try {
      await exportRowsToExcel(
        `Permission matrix — ${subject.label}`,
        rows.map((row) => ({
          Module: row.module,
          ...Object.fromEntries(
            MATRIX_ACTIONS.map((action) => [action, row.cells[action].granted ? 'Yes' : '—']),
          ),
          Granted: row.grantedCount,
          Available: row.totalCount,
        })),
        { filename: `permission-matrix-${subject.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xlsx` },
      );
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unexpected error.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-3">
      <Card className="border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
        <CardContent className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Show the matrix for</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value as SubjectKind);
                setSubjectId('');
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="role">A role</SelectItem>
                <SelectItem value="user">A user (effective access)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs">{kind === 'role' ? 'Role' : 'User'}</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder={kind === 'role' ? 'Select a role' : 'Select a user'} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {kind === 'role'
                  ? directory.roles
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name} · {countPermissions(role.permissions)} permissions
                        </SelectItem>
                      ))
                  : directory.users
                      .slice()
                      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                      .map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name || user.email}
                        </SelectItem>
                      ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Search modules</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Filter…"
                className="pl-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {!subject ? (
        <HrEmptyState
          icon={Grid3x3}
          title="Pick a role or a user"
          description="You'll get one row per module and one column per action family, with the exact permissions behind every tick in the tooltip."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                {subject.label}
              </Badge>
              <span className="text-muted-foreground">
                {countPermissions(subject.permissions)} permissions across {rows.length} module(s)
              </span>
              {subject.access && (
                <span className="text-muted-foreground">
                  · roles in force: {subject.access.effectiveRoleNames.join(', ') || 'none'}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant={onlyGranted ? 'default' : 'outline'}
                size="sm"
                onClick={() => setOnlyGranted((flag) => !flag)}
              >
                Granted modules only
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleExport()}>
                <Download className="mr-1.5 h-4 w-4" />
                Export
              </Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <HrEmptyState title="No modules match" description="Try clearing the search or the granted-only filter." />
          ) : (
            <Card className="overflow-hidden border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
              <ScrollArea className="h-[30rem]">
                <Table className="min-w-[46rem]">
                  <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur">
                    <TableRow>
                      <TableHead className="w-64">Module</TableHead>
                      {MATRIX_ACTIONS.map((action) => (
                        <TableHead key={action} className="text-center text-xs">
                          {action}
                        </TableHead>
                      ))}
                      <TableHead className="text-right text-xs">Coverage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.module} className={row.grantedCount === 0 ? 'opacity-60' : undefined}>
                        <TableCell className="font-medium text-slate-800">{row.module}</TableCell>
                        {MATRIX_ACTIONS.map((action) => (
                          <MatrixCellView key={action} action={action} cell={row.cells[action]} />
                        ))}
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {row.grantedCount}/{row.totalCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </Card>
          )}

          <p className="px-1 text-[11px] text-muted-foreground">
            A tick means the subject holds at least one action in that family somewhere in the module —
            hover it for the exact permissions. An indigo ring marks a tick that comes entirely from
            additional access rather than the base role.
          </p>
        </>
      )}
    </div>
  );
}

function MatrixCellView({
  action,
  cell,
}: {
  action: MatrixAction;
  cell: { granted: boolean; actions: string[]; inherited: boolean };
}) {
  if (!cell.granted) {
    return (
      <TableCell className="text-center">
        <Minus className="mx-auto h-3.5 w-3.5 text-slate-300" />
      </TableCell>
    );
  }

  return (
    <TableCell className="text-center">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'mx-auto flex h-6 w-6 items-center justify-center rounded-md',
                cell.inherited
                  ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300'
                  : 'bg-emerald-100 text-emerald-700',
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="mb-1 text-xs font-semibold">
              {action}
              {cell.inherited ? ' — from additional access' : ''}
            </p>
            <ul className="space-y-0.5 text-[11px]">
              {cell.actions.slice(0, 14).map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
              {cell.actions.length > 14 && <li>+{cell.actions.length - 14} more</li>}
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </TableCell>
  );
}
