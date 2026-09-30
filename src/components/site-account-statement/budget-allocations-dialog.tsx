'use client';

import { useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { formatINR, SAS_COLLECTIONS } from '@/lib/site-account-statement';
import {
  ALLOCATION_STATUS_LABEL,
  canAmendAllocation,
  canRejectAllocation,
  canVerifyAllocation,
  sortAllocations,
  summariseAllocations,
  validateAllocationDraft,
  type AllocationDraft,
  type SASBudgetAllocation,
} from '@/lib/site-account-statement-allocations';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  AlertTriangle, CheckCircle2, Clock, ExternalLink, FileText, Loader2, Paperclip,
  Plus, RotateCcw, Trash2, Upload, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const MODULE = 'Site Account Statement';
const MAX_SIZE = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';

export interface AllocationPermissions {
  add: boolean;
  verify: boolean;
  remove: boolean;
}

function StatusChip({ status }: { status: SASBudgetAllocation['status'] }) {
  if (status === 'approved') {
    return (
      <Badge className="gap-1 bg-emerald-600 text-[11px] hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> {ALLOCATION_STATUS_LABEL.approved}
      </Badge>
    );
  }
  if (status === 'rejected') {
    return (
      <Badge variant="destructive" className="gap-1 text-[11px]">
        <XCircle className="h-3 w-3" /> {ALLOCATION_STATUS_LABEL.rejected}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-amber-500 text-[11px] hover:bg-amber-500">
      <Clock className="h-3 w-3" /> {ALLOCATION_STATUS_LABEL.pending}
    </Badge>
  );
}

/**
 * The allocation ledger for one project and month.
 *
 * Reads as a statement rather than a form: the month's figure at the top, the instalments that make
 * it up below, and what each one is still waiting for. Recording an amount and verifying it are
 * separate actions behind separate permissions, because a ledger where the same person does both is
 * just a text field with extra steps.
 */
export function BudgetAllocationsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  period,
  periodLabel,
  allocations,
  legacyAmount,
  permissions,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  period: string;
  periodLabel: string;
  allocations: SASBudgetAllocation[];
  /** The pre-allocation single monthly budget, if this project/month still has one. */
  legacyAmount: number;
  permissions: AllocationPermissions;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const { log } = useActivityLogger(MODULE);
  const { toast } = useToast();

  const [draft, setDraft] = useState<AllocationDraft>({
    amount: '', allocationDate: `${period}-01`, referenceNo: '', notes: '',
  });
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<SASBudgetAllocation | null>(null);

  const rows = useMemo(() => sortAllocations(allocations), [allocations]);
  const summary = useMemo(() => summariseAllocations(allocations), [allocations]);
  const effective = legacyAmount + summary.approved;

  function setField<K extends keyof AllocationDraft>(key: K, value: AllocationDraft[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  async function handleAdd() {
    const check = validateAllocationDraft(draft, period);
    if (!check.ok) {
      toast({ title: 'Check the allocation', description: check.reason, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, SAS_COLLECTIONS.budgetAllocations), {
        projectId, projectName, period,
        amount: Number(draft.amount),
        allocationDate: draft.allocationDate,
        referenceNo: draft.referenceNo.trim(),
        notes: draft.notes.trim(),
        // Always pending. Nothing this form can do makes an allocation spendable.
        status: 'pending',
        approval: null,
        createdAt: serverTimestamp(),
        createdBy: user?.id ?? '',
        createdByName: user?.name ?? '',
      });
      void log('Add SAS Budget Allocation', { project: projectName, period, amount: Number(draft.amount) });
      toast({
        title: 'Recorded',
        description: 'The allocation is awaiting review. It does not change the budget until it is verified.',
      });
      setDraft({ amount: '', allocationDate: `${period}-01`, referenceNo: '', notes: '' });
      setShowAdd(false);
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleAttach(allocation: SASBudgetAllocation, file: File) {
    if (file.size > MAX_SIZE) {
      toast({ title: 'File too large', description: `${file.name} exceeds the 5 MB limit.`, variant: 'destructive' });
      return;
    }
    setBusyId(allocation.id);
    try {
      // Replacing an approval removes the old file, so a superseded sanction letter does not linger
      // in the bucket unreferenced.
      if (allocation.approval?.storagePath) {
        try { await deleteObject(storageRef(storage, allocation.approval.storagePath)); } catch { /* already gone */ }
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      // Same `sas/` root the month-level budget approvals already use, so one Storage rule covers
      // the module rather than each feature inventing its own prefix.
      const path = `sas/budget-allocations/${projectId}/${period}/${allocation.id}/${Date.now()}-${safeName}`;
      const target = storageRef(storage, path);
      await uploadBytes(target, file);
      const url = await getDownloadURL(target);
      await updateDoc(doc(db, SAS_COLLECTIONS.budgetAllocations, allocation.id), {
        approval: { name: file.name, url, storagePath: path, size: file.size, type: file.type || 'application/octet-stream' },
      });
      toast({ title: 'Approval attached', description: 'It can be verified now.' });
      onChanged();
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleVerify(allocation: SASBudgetAllocation) {
    const check = canVerifyAllocation(allocation);
    if (!check.ok) {
      toast({ title: 'Cannot verify', description: check.reason, variant: 'destructive' });
      return;
    }
    setBusyId(allocation.id);
    try {
      await updateDoc(doc(db, SAS_COLLECTIONS.budgetAllocations, allocation.id), {
        status: 'approved',
        rejectedReason: '',
        verifiedAt: serverTimestamp(),
        verifiedBy: user?.id ?? '',
        verifiedByName: user?.name ?? '',
      });
      void log('Verify SAS Budget Allocation', { project: projectName, period, amount: allocation.amount });
      toast({ title: 'Verified', description: `${formatINR(allocation.amount)} now counts towards ${periodLabel}.` });
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(allocation: SASBudgetAllocation) {
    const check = canRejectAllocation(allocation);
    if (!check.ok) {
      toast({ title: 'Cannot reject', description: check.reason, variant: 'destructive' });
      return;
    }
    setBusyId(allocation.id);
    try {
      await updateDoc(doc(db, SAS_COLLECTIONS.budgetAllocations, allocation.id), {
        status: 'rejected',
        verifiedAt: serverTimestamp(),
        verifiedBy: user?.id ?? '',
        verifiedByName: user?.name ?? '',
      });
      void log('Reject SAS Budget Allocation', { project: projectName, period, amount: allocation.amount });
      toast({ title: 'Rejected', description: 'It no longer counts towards the budget.' });
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  /** Sends a verified allocation back for review — the only way to change one. */
  async function handleReopen(allocation: SASBudgetAllocation) {
    setBusyId(allocation.id);
    try {
      await updateDoc(doc(db, SAS_COLLECTIONS.budgetAllocations, allocation.id), {
        status: 'pending',
        verifiedAt: null, verifiedBy: '', verifiedByName: '',
      });
      void log('Reopen SAS Budget Allocation', { project: projectName, period, amount: allocation.amount });
      toast({ title: 'Reopened', description: 'It has been taken back out of the budget pending review.' });
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(allocation: SASBudgetAllocation) {
    const check = canAmendAllocation(allocation);
    if (!check.ok) {
      toast({ title: 'Cannot delete', description: check.reason, variant: 'destructive' });
      return;
    }
    setBusyId(allocation.id);
    try {
      if (allocation.approval?.storagePath) {
        try { await deleteObject(storageRef(storage, allocation.approval.storagePath)); } catch { /* ok */ }
      }
      await deleteDoc(doc(db, SAS_COLLECTIONS.budgetAllocations, allocation.id));
      void log('Delete SAS Budget Allocation', { project: projectName, period });
      toast({ title: 'Deleted', description: 'The allocation has been removed.' });
      onChanged();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Budget Allocations — {periodLabel}</DialogTitle>
          {/* Plain text, not a Badge: Badge renders a div, which is invalid inside a description. */}
          <DialogDescription>
            {projectName} · every instalment sanctioned for this month. An allocation counts towards
            the budget only once it has an approval attached and has been verified.
          </DialogDescription>
        </DialogHeader>

        {/* ── Where the month's figure comes from ── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">Spendable budget</p>
            <p className="text-sm font-bold text-emerald-800">{formatINR(effective)}</p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700">
              Awaiting review · {summary.pendingCount}
            </p>
            <p className="text-sm font-bold text-amber-800">{formatINR(summary.pending)}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Verified · {summary.approvedCount}
            </p>
            <p className="text-sm font-bold text-slate-700">{formatINR(summary.approved)}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Rejected</p>
            <p className="text-sm font-bold text-slate-500">{formatINR(summary.rejected)}</p>
          </div>
        </div>

        {summary.pending > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            {formatINR(summary.pending)} is recorded but not yet verified, so it is not part of the
            spendable budget and does not appear in utilisation or alerts.
          </p>
        )}

        {/* ── The legacy single budget, if this month still has one ── */}
        {legacyAmount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <FileText className="h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-700">{formatINR(legacyAmount)} · original monthly budget</p>
              <p className="text-xs text-muted-foreground">
                Set before allocations existed, so it has no approval trail. It still counts. To bring
                it into the ledger, delete it from the budget row and re-enter it as an allocation.
              </p>
            </div>
          </div>
        )}

        {/* ── Add ── */}
        {permissions.add && (
          showAdd ? (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Amount (₹) <span className="text-destructive">*</span></Label>
                  <Input
                    type="number" min="0" placeholder="0"
                    value={draft.amount}
                    onChange={e => setField('amount', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Sanctioned on <span className="text-destructive">*</span></Label>
                  <Input
                    type="date"
                    value={draft.allocationDate}
                    onChange={e => setField('allocationDate', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Reference No.</Label>
                  <Input
                    placeholder="Sanction / transfer reference"
                    value={draft.referenceNo}
                    onChange={e => setField('referenceNo', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Notes</Label>
                  <Textarea
                    rows={2} placeholder="What this instalment is for"
                    value={draft.notes}
                    onChange={e => setField('notes', e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowAdd(false)} disabled={saving}>Cancel</Button>
                <Button size="sm" className="gap-2 bg-emerald-700 hover:bg-emerald-800" onClick={handleAdd} disabled={saving}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Record allocation
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="gap-2 self-start" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5" /> Record an allocation
            </Button>
          )
        )}

        {/* ── The ledger ── */}
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center">
            <p className="text-sm text-muted-foreground">No allocations recorded for {periodLabel}.</p>
            {permissions.add && (
              <p className="mt-1 text-xs text-muted-foreground">
                Record each instalment as it is sanctioned, then verify it against its approval.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(allocation => {
              const busy = busyId === allocation.id;
              const verifiable = canVerifyAllocation(allocation);
              return (
                <div
                  key={allocation.id}
                  className={cn(
                    'rounded-lg border px-3 py-2.5',
                    allocation.status === 'approved' ? 'border-emerald-200 bg-emerald-50/40'
                      : allocation.status === 'rejected' ? 'border-slate-200 bg-slate-50/60 opacity-75'
                      : 'border-amber-200 bg-amber-50/40',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">{formatINR(allocation.amount)}</span>
                        <StatusChip status={allocation.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Sanctioned {allocation.allocationDate}
                        {allocation.referenceNo && <> · Ref {allocation.referenceNo}</>}
                        {allocation.createdByName && <> · recorded by {allocation.createdByName}</>}
                      </p>
                      {allocation.notes && <p className="mt-1 text-xs text-slate-600">{allocation.notes}</p>}
                      {allocation.status === 'approved' && allocation.verifiedByName && (
                        <p className="mt-0.5 text-xs text-emerald-700">Verified by {allocation.verifiedByName}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {allocation.approval?.url ? (
                        <a
                          href={allocation.approval.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                        >
                          <Paperclip className="h-3 w-3" /> Approval
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded border border-dashed px-2 py-1 text-xs text-muted-foreground">
                          <AlertTriangle className="h-3 w-3" /> No approval
                        </span>
                      )}

                      {permissions.verify && allocation.status !== 'rejected' && (
                        <Button
                          variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs"
                          disabled={busy}
                          onClick={() => { setUploadTarget(allocation); uploadRef.current?.click(); }}
                        >
                          <Upload className="h-3 w-3" />
                          {allocation.approval ? 'Replace' : 'Attach'}
                        </Button>
                      )}

                      {permissions.verify && allocation.status !== 'approved' && (
                        <Button
                          size="sm"
                          className="h-7 gap-1 bg-emerald-600 px-2 text-xs hover:bg-emerald-700"
                          disabled={busy || !verifiable.ok}
                          title={verifiable.ok ? 'Verify this allocation' : verifiable.reason}
                          onClick={() => handleVerify(allocation)}
                        >
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                          Verify
                        </Button>
                      )}

                      {permissions.verify && allocation.status === 'approved' && (
                        <Button
                          variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs"
                          disabled={busy}
                          onClick={() => handleReopen(allocation)}
                        >
                          <RotateCcw className="h-3 w-3" /> Reopen
                        </Button>
                      )}

                      {permissions.verify && allocation.status === 'pending' && (
                        <Button
                          variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-destructive"
                          disabled={busy}
                          onClick={() => handleReject(allocation)}
                        >
                          <XCircle className="h-3 w-3" /> Reject
                        </Button>
                      )}

                      {permissions.remove && allocation.status !== 'approved' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" disabled={busy}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete allocation</AlertDialogTitle>
                              <AlertDialogDescription>
                                Remove {formatINR(allocation.amount)} sanctioned on {allocation.allocationDate}?
                                Its approval document is deleted too. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive hover:bg-destructive/90"
                                onClick={() => handleDelete(allocation)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* One input serves every row; `uploadTarget` says which one asked for it. */}
        <input
          ref={uploadRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={e => {
            const file = e.target.files?.[0];
            const target = uploadTarget;
            e.target.value = '';
            setUploadTarget(null);
            if (file && target) void handleAttach(target, file);
          }}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
