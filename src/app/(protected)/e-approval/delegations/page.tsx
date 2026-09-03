'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  canManageEApprovalDelegationFor,
  E_APPROVAL_BASE_PATH,
  resolveEApprovalDelegate,
  type EApprovalDelegationRecord,
} from '@/lib/e-approval';
import {
  deleteEApprovalDelegation,
  listEApprovalDelegations,
  saveEApprovalDelegation,
} from '@/lib/e-approval-service';
import { eApprovalDialogClass, EApprovalEmptyState } from '@/components/e-approval/shared';
import { PageHeader } from '@/components/e-approval/page-header';
import {
  formatEApprovalDate,
  useEApprovalActor,
  useEApprovalDirectory,
  useEApprovalPermissions,
} from '@/components/e-approval/hooks';

/**
 * Substitute approvers (spec section 23).
 *
 * A delegation is a dated window, not a switch: "my approvals go to the CFO from 25 to 30 August"
 * expires on its own, which is the only version of this feature that does not end with somebody
 * permanently approving on somebody else's behalf because nobody remembered to turn it off.
 */
export default function EApprovalDelegationsPage() {
  const { toast } = useToast();
  const { serviceActor } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  const canManage = permissions.canManageDelegations;
  const canManageOthers = permissions.canManageOthersDelegations;
  const { directory } = useEApprovalDirectory();
  const [rows, setRows] = useState<EApprovalDelegationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [fromUserId, setFromUserId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [approvalTypeId, setApprovalTypeId] = useState('ALL');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await listEApprovalDelegations(serviceActor?.organizationId));
    } catch (error) {
      console.error('[e-approval] delegations load failed', error);
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor?.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Without the "Manage Others" grant the delegator is always the signed-in person — pinned here as
  // well as in the form, so it cannot be left stale from a previous open.
  useEffect(() => {
    if (!open || !serviceActor) return;
    if (!canManageOthers) setFromUserId(serviceActor.userId);
    else if (!fromUserId) setFromUserId(serviceActor.userId);
  }, [open, serviceActor, fromUserId, canManageOthers]);

  const engineRows = useMemo(
    () =>
      rows.map((row) => ({
        id: row.id,
        fromUserId: row.fromUserId,
        toUserId: row.toUserId,
        fromDate: row.fromDate,
        toDate: row.toDate ?? null,
        approvalTypeIds: row.approvalTypeIds,
        active: row.active,
      })),
    [rows],
  );

  const save = async () => {
    if (!serviceActor) return;
    if (!fromUserId || !toUserId) {
      toast({ variant: 'destructive', title: 'Choose both people.' });
      return;
    }
    if (fromUserId === toUserId) {
      toast({ variant: 'destructive', title: 'A delegation has to be to somebody else.' });
      return;
    }
    if (!fromDate) {
      toast({ variant: 'destructive', title: 'A start date is required.' });
      return;
    }
    if (toDate && toDate < fromDate) {
      toast({ variant: 'destructive', title: 'The end date cannot precede the start date.' });
      return;
    }
    setBusy(true);
    try {
      await saveEApprovalDelegation(
        {
          fromUserId,
          fromUserName: directory.userById.get(fromUserId)?.name,
          toUserId,
          toUserName: directory.userById.get(toUserId)?.name,
          fromDate,
          toDate: toDate || null,
          reason: reason || undefined,
          approvalTypeIds: approvalTypeId === 'ALL' ? [] : [approvalTypeId],
          active: true,
        },
        serviceActor,
        { canManageOthers },
      );
      toast({ title: 'Delegation saved' });
      setOpen(false);
      setToUserId('');
      setFromDate('');
      setToDate('');
      setReason('');
      setApprovalTypeId('ALL');
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

  const remove = async (row: EApprovalDelegationRecord) => {
    if (!serviceActor) return;
    try {
      await deleteEApprovalDelegation(row, serviceActor, { canManageOthers });
      void load();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Not removed',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    }
  };

  /** Whether this row is one the signed-in person may remove — their own, or anybody's with the grant. */
  const canManageRow = (row: EApprovalDelegationRecord) =>
    canManage && canManageEApprovalDelegationFor(serviceActor, row.fromUserId, { canManageOthers });

  return (
    <div className="space-y-3">
      <PageHeader
        title="Delegations"
        description="While a delegation is in force the delegate can act on the delegator's steps. Every action is recorded as &quot;on behalf of&quot; — the authority is delegated, the accountability is not."
        backHref={E_APPROVAL_BASE_PATH}
        backLabel="Dashboard"
        actions={
          canManage ? (
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New delegation
            </Button>
          ) : undefined
        }
        meta={[{ label: 'Configured', value: `${rows.length}` }]}
      />
      <Card>
        <CardContent className="px-2 py-3 sm:px-3">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EApprovalEmptyState
              icon={CalendarClock}
              title="No delegations"
              description="Set one up before going on leave so approvals do not stall."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="whitespace-nowrap">From date</TableHead>
                    <TableHead className="whitespace-nowrap">To date</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>State</TableHead>
                    {canManage && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const inForce = Boolean(resolveEApprovalDelegate(engineRows, row.fromUserId, new Date()));
                    const isThisOne =
                      inForce && resolveEApprovalDelegate(engineRows, row.fromUserId, new Date())?.id === row.id;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs font-medium">
                          {row.fromUserName || directory.userById.get(row.fromUserId)?.name || row.fromUserId}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs font-medium">
                          {row.toUserName || directory.userById.get(row.toUserId)?.name || row.toUserId}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{formatEApprovalDate(row.fromDate)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {row.toDate ? formatEApprovalDate(row.toDate) : 'Open-ended'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.approvalTypeIds?.length
                            ? row.approvalTypeIds
                                .map((typeId) => directory.types.find((type) => type.id === typeId)?.name || typeId)
                                .join(', ')
                            : 'All approval types'}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {row.reason || '—'}
                        </TableCell>
                        <TableCell>
                          {row.active === false ? (
                            <Badge variant="outline" className="text-[10px]">
                              Disabled
                            </Badge>
                          ) : isThisOne ? (
                            <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">In force</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              Scheduled / expired
                            </Badge>
                          )}
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            {canManageRow(row) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive"
                                onClick={() => void remove(row)}
                                aria-label="Remove delegation"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={eApprovalDialogClass.content}>
          <DialogHeader className={eApprovalDialogClass.header}>
            <DialogTitle>New delegation</DialogTitle>
            <DialogDescription className="text-xs">
              Delegation resolves one level only: if A delegates to B and B delegates to C, A&apos;s files go to B.
            </DialogDescription>
          </DialogHeader>
          <div className={eApprovalDialogClass.body}>
            <div>
              <Label className="text-xs">Delegate approvals of</Label>
              {canManageOthers ? (
                <>
                  <Select value={fromUserId} onValueChange={setFromUserId}>
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue placeholder="Select a person" />
                    </SelectTrigger>
                    <SelectContent>
                      {directory.users.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.name} {row.id === serviceActor?.userId ? '(me)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    You can arrange cover for anybody. Most people can only delegate their own approvals.
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-1 flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                    {serviceActor?.userName || 'You'}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    You can delegate your own approvals. Arranging cover for somebody else needs the &quot;Manage
                    Others&quot; permission.
                  </p>
                </>
              )}
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Select value={toUserId} onValueChange={setToUserId}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Select a person" />
                </SelectTrigger>
                <SelectContent>
                  {directory.users
                    .filter((row) => row.id !== fromUserId)
                    .map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name} — {row.role}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs">To (optional)</Label>
                <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Applies to</Label>
              <Select value={approvalTypeId} onValueChange={setApprovalTypeId}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All approval types</SelectItem>
                  {directory.types.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reason</Label>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                className="mt-1 text-sm"
                placeholder="On leave 25–30 August"
              />
            </div>
          </div>
          <DialogFooter className={eApprovalDialogClass.footer}>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
