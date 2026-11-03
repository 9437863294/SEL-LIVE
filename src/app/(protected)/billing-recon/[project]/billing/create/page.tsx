'use client';

/**
 * New RA bill — and, with `?edit={billId}`, editing a draft.
 *
 * Lists every certified JMC / MVAC line of the project with what is already billed on other bills
 * and the balance, and takes a quantity to bill on each. Quantities only: the bill's money is
 * recorded in Bill Tracking. Rules (balances, numbering, validation): src/lib/billing-recon/ra-bill.ts.
 *
 * Saving re-reads the entries and bills first and re-validates against them, so a quantity billed
 * or decertified elsewhere since the page opened is caught instead of over-billed.
 */

import { Fragment, Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { addDoc, collection, deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { AlertTriangle, Calculator, Layers, Loader2, Save, Send, Wand2, XCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { PageAccessDenied } from '@/components/shared/module-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { readBillingReconRegisters, useBillingReconData } from '@/components/billing-recon/ra-bills/use-billing-recon-data';
import {
  computeBillableLines,
  formatRaBillNo,
  isDuplicateBillNo,
  lineRef,
  nextRaSequence,
  validateRaBillDraft,
  type BillableLine,
  type RaBillDraftInput,
} from '@/lib/billing-recon/ra-bill';
import {
  QTY_TOLERANCE,
  compareNatural,
  formatAmount,
  formatIsoDate,
  formatQty,
  localIsoDate,
  normaliseScope,
  parseQtyInput,
  round2,
} from '@/lib/billing-recon/lines';
import { cn } from '@/lib/utils';

const MODULE = 'Billing Recon';
const RESOURCE = 'Billing Recon.Billing';
const COLS = 9;

type SourceFilter = 'all' | 'JMC' | 'MVAC';

function PageSkeleton() {
  return (
    <div className="min-w-0 space-y-4">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export default function NewRaBillPage() {
  // ?edit= is read with useSearchParams, which needs a Suspense boundary above it.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RaBillForm />
    </Suspense>
  );
}

interface EntryGroup {
  key: string;
  source: BillableLine['source'];
  entryId: string;
  entryNo: string;
  entryDate: string;
  lines: BillableLine[];
}

function RaBillForm() {
  const { project: projectSlug } = useParams() as { project: string };
  const searchParams = useSearchParams();
  const editId = searchParams?.get('edit')?.trim() ?? '';
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const canView = can('View', RESOURCE);
  const allowed = canView && (editId ? can('Edit Bill', RESOURCE) : can('Create Bill', RESOURCE));

  const { project, register, jmcEntries, mvacEntries, bills, loading, error, reload, replaceData } = useBillingReconData(
    projectSlug,
    { entries: true, bills: true },
    !authLoading && allowed,
  );

  const editing = useMemo(() => (editId ? bills.find((bill) => bill.id === editId) ?? null : null), [bills, editId]);

  // Header fields.
  const [billNo, setBillNo] = useState('');
  // Today's date is set once the form fills (in the browser), not during the server render.
  const [billDate, setBillDate] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [remarks, setRemarks] = useState('');
  /** Quantity typed per entry line (by `lineRef`). */
  const [qty, setQty] = useState<Record<string, string>>({});
  const [initialised, setInitialised] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);

  // Line filters.
  const [source, setSource] = useState<SourceFilter>('all');
  const [entryFilter, setEntryFilter] = useState('all');
  const [scope1, setScope1] = useState('all');
  const [scope2, setScope2] = useState('all');
  const [search, setSearch] = useState('');
  const [showBilled, setShowBilled] = useState(false);
  const [onlyOnBill, setOnlyOnBill] = useState(false);

  const billableLines = useMemo(
    () => computeBillableLines({ jmcEntries, mvacEntries, bills, excludeBillId: editId || undefined }),
    [jmcEntries, mvacEntries, bills, editId],
  );

  const prefix = project?.siteCode?.trim() ? `${project.siteCode.trim()}/` : '';
  const suggestedSequence = editing ? editing.raSequence : nextRaSequence(bills);
  const suggestedBillNo = formatRaBillNo(suggestedSequence, prefix);

  // Fill the form once, as soon as the registers are in — the draft's own values, or the suggested
  // number — while rendering, not in an effect. Only ever in the browser: the registers load
  // client-side, so the server render never reaches this (and never stamps its own "today").
  const readyToFill = !loading && Boolean(project) && (!editId || (editing !== null && editing.status === 'Draft'));
  if (readyToFill && !initialised) {
    setInitialised(true);
    if (editing) {
      setBillNo(editing.billNo ?? '');
      setBillDate(editing.billDate || localIsoDate());
      setPeriodFrom(editing.periodFrom ?? '');
      setPeriodTo(editing.periodTo ?? '');
      setRemarks(editing.remarks ?? '');
      const typed: Record<string, string> = {};
      for (const item of editing.items ?? []) {
        typed[lineRef(item.source, item.entryId, item.itemIndex)] = String(item.billedQty ?? '');
      }
      setQty(typed);
      setOnlyOnBill(Object.keys(typed).length > 0);
    } else {
      setBillNo(suggestedBillNo);
      setBillDate(localIsoDate());
    }
  }

  const draftInput: RaBillDraftInput = useMemo(
    () => ({
      billNo,
      billDate,
      periodFrom: periodFrom || undefined,
      periodTo: periodTo || undefined,
      lines: Object.entries(qty).map(([ref, billedQty]) => ({ ref, billedQty })),
    }),
    [billNo, billDate, periodFrom, periodTo, qty],
  );

  const validation = useMemo(
    () => validateRaBillDraft(draftInput, billableLines, bills, { editingBillId: editId || undefined }),
    [draftInput, billableLines, bills, editId],
  );

  const knownRefs = useMemo(() => new Set(billableLines.map((line) => line.ref)), [billableLines]);
  const staleRefs = useMemo(
    () => Object.keys(qty).filter((ref) => !knownRefs.has(ref) && parseQtyInput(qty[ref]) !== 0),
    [qty, knownRefs],
  );

  /* ── Filters ─────────────────────────────────────────────────────────────────────────────── */

  const entryOptions = useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>();
    for (const line of billableLines) {
      if (source !== 'all' && line.source !== source) continue;
      const value = `${line.source}|${line.entryId}`;
      if (!seen.has(value)) seen.set(value, { value, label: `${line.source} ${line.entryNo || line.entryId}` });
    }
    return [...seen.values()];
  }, [billableLines, source]);

  const scopeChoices = useMemo(() => {
    const first = new Map<string, string>();
    const second = new Map<string, string>();
    for (const line of billableLines) {
      if (line.scope1 && !first.has(normaliseScope(line.scope1))) first.set(normaliseScope(line.scope1), line.scope1);
      if (scope1 !== 'all' && normaliseScope(line.scope1) !== normaliseScope(scope1)) continue;
      if (line.scope2 && !second.has(normaliseScope(line.scope2))) second.set(normaliseScope(line.scope2), line.scope2);
    }
    return { scope1: [...first.values()].sort(compareNatural), scope2: [...second.values()].sort(compareNatural) };
  }, [billableLines, scope1]);

  const visibleLines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return billableLines.filter((line) => {
      // A line stays on screen while it has an input value, even one being retyped from blank;
      // "Clear" removes it from the form.
      const onForm = Object.prototype.hasOwnProperty.call(qty, line.ref);
      if (onlyOnBill && !onForm) return false;
      if (!showBilled && line.balanceQty <= QTY_TOLERANCE && !onForm) return false;
      if (source !== 'all' && line.source !== source) return false;
      if (entryFilter !== 'all' && `${line.source}|${line.entryId}` !== entryFilter) return false;
      if (scope1 !== 'all' && normaliseScope(line.scope1) !== normaliseScope(scope1)) return false;
      if (scope2 !== 'all' && normaliseScope(line.scope2) !== normaliseScope(scope2)) return false;
      if (!needle) return true;
      return [line.boqSlNo, line.description, line.entryNo, line.scope1, line.scope2].some((text) => text.toLowerCase().includes(needle));
    });
  }, [billableLines, qty, onlyOnBill, showBilled, source, entryFilter, scope1, scope2, search]);

  const groups = useMemo(() => {
    const byKey = new Map<string, EntryGroup>();
    for (const line of visibleLines) {
      const key = `${line.source}|${line.entryId}`;
      let group = byKey.get(key);
      if (!group) {
        group = { key, source: line.source, entryId: line.entryId, entryNo: line.entryNo, entryDate: line.entryDate, lines: [] };
        byKey.set(key, group);
      }
      group.lines.push(line);
    }
    return [...byKey.values()];
  }, [visibleLines]);

  const activeFilters =
    (source !== 'all' ? 1 : 0) +
    (entryFilter !== 'all' ? 1 : 0) +
    (scope1 !== 'all' ? 1 : 0) +
    (scope2 !== 'all' ? 1 : 0) +
    (showBilled ? 1 : 0) +
    (onlyOnBill ? 1 : 0);

  const clearFilters = () => {
    setSource('all');
    setEntryFilter('all');
    setScope1('all');
    setScope2('all');
    setSearch('');
    setShowBilled(false);
    setOnlyOnBill(false);
  };

  /* ── Quantities ──────────────────────────────────────────────────────────────────────────── */

  const setLineQty = (ref: string, value: string) => setQty((prev) => ({ ...prev, [ref]: value }));

  const fillLines = (lines: readonly BillableLine[]) =>
    setQty((prev) => {
      const next = { ...prev };
      for (const line of lines) {
        if (line.balanceQty > QTY_TOLERANCE) next[line.ref] = String(line.balanceQty);
      }
      return next;
    });

  const clearLines = (refs: readonly string[]) =>
    setQty((prev) => {
      const next = { ...prev };
      for (const ref of refs) delete next[ref];
      return next;
    });

  const duplicateBillNo = isDuplicateBillNo(billNo, bills, editId || undefined);
  const typedLineCount = Object.values(qty).filter((value) => parseQtyInput(value) !== 0).length;
  const lineErrorCount = Object.keys(validation.lineErrors).length;

  /* ── Saving ──────────────────────────────────────────────────────────────────────────────── */

  const save = async (submit: boolean) => {
    if (!user || !project || saving) return;
    setAttempted(true);
    if (!validation.ok) {
      toast({ title: 'Check the bill', description: validation.errors[0] ?? 'Some lines need correcting.', variant: 'destructive' });
      return;
    }
    setSaving(submit ? 'submit' : 'draft');
    const actor = user.name || user.email || 'Unknown user';
    try {
      // Re-read and re-check: another bill, or a change to an entry, may have used the balance.
      const fresh = await readBillingReconRegisters(project, { entries: true, bills: true });
      const freshLines = computeBillableLines({
        jmcEntries: fresh.jmcEntries,
        mvacEntries: fresh.mvacEntries,
        bills: fresh.bills,
        excludeBillId: editId || undefined,
      });
      const check = validateRaBillDraft(draftInput, freshLines, fresh.bills, { editingBillId: editId || undefined });
      if (!check.ok) {
        replaceData(fresh);
        toast({
          title: 'The balances have changed',
          description: `${check.errors[0] ?? 'Some lines need correcting.'} The lines now show the latest figures.`,
          variant: 'destructive',
        });
        return;
      }

      const now = new Date().toISOString();
      const cleanBillNo = billNo.trim().replace(/\s+/g, ' ');
      const cleanRemarks = remarks.trim();
      let billId = editId;
      let raSequence = editing?.raSequence ?? 0;

      if (editId) {
        const ref = doc(db, 'projects', project.id, register.raBills, editId);
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error('This draft no longer exists.');
          if (snap.data()?.status !== 'Draft') throw new Error('This bill is no longer a draft, so it cannot be edited.');
          tx.update(ref, {
            billNo: cleanBillNo,
            billDate,
            periodFrom: periodFrom ? periodFrom : deleteField(),
            periodTo: periodTo ? periodTo : deleteField(),
            remarks: cleanRemarks ? cleanRemarks : deleteField(),
            items: check.items,
            totalAmount: check.totalAmount,
            updatedAt: serverTimestamp(),
            ...(submit ? { status: 'Submitted', submittedAt: now, submittedByName: actor } : {}),
          });
        });
      } else {
        raSequence = nextRaSequence(fresh.bills);
        // Firestore rejects `undefined`: optional fields are left out, never set to undefined.
        const payload = {
          projectId: project.id,
          projectName: project.projectName ?? '',
          billNo: cleanBillNo,
          billDate,
          raSequence,
          ...(periodFrom ? { periodFrom } : {}),
          ...(periodTo ? { periodTo } : {}),
          items: check.items,
          totalAmount: check.totalAmount,
          status: submit ? 'Submitted' : 'Draft',
          ...(cleanRemarks ? { remarks: cleanRemarks } : {}),
          createdAt: serverTimestamp(),
          createdById: user.id,
          createdByName: actor,
          ...(submit ? { submittedAt: now, submittedByName: actor } : {}),
        };
        const created = await addDoc(collection(db, 'projects', project.id, register.raBills), payload);
        billId = created.id;
      }

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: MODULE,
        action: editId ? (submit ? 'Edit and Submit RA Bill' : 'Edit RA Bill') : submit ? 'Create and Submit RA Bill' : 'Create RA Bill',
        recordId: billId,
        recordRef: cleanBillNo,
        details: {
          projectId: project.id,
          projectName: project.projectName ?? '',
          billNo: cleanBillNo,
          raSequence,
          lines: check.items.length,
          totalAmount: check.totalAmount,
          status: submit ? 'Submitted' : 'Draft',
        },
      });
      toast({
        title: submit ? 'RA bill submitted' : 'Draft saved',
        description: `${cleanBillNo} · ${check.items.length} line${check.items.length === 1 ? '' : 's'} · ${formatAmount(check.totalAmount)}`,
      });
      router.push(`/billing-recon/${projectSlug}/billing`);
    } catch (err) {
      console.error('Could not save the RA bill', err);
      toast({
        title: 'Could not save the bill',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  /* ── Render ──────────────────────────────────────────────────────────────────────────────── */

  const title = editId ? 'Edit RA bill' : 'New RA bill';
  const backHref = `/billing-recon/${projectSlug}/billing`;

  if (authLoading) return <PageSkeleton />;

  if (!allowed) {
    return (
      <div className="min-w-0 space-y-4">
        <PageHeader title={title} icon={Calculator} backHref={backHref} backLabel="Back to RA bills" />
        <PageAccessDenied
          message={editId ? 'You do not have permission to edit RA bills.' : 'You do not have permission to create RA bills.'}
        />
      </div>
    );
  }

  if (loading && !initialised) return <PageSkeleton />;

  const blocked =
    error === 'not-found'
      ? { title: 'Project not found', text: 'This link does not match any project. It may have been renamed or removed.' }
      : error === 'failed'
        ? { title: 'Could not load the project', text: 'Check your connection and try again.' }
        : editId && !editing
          ? { title: 'Bill not found', text: 'This RA bill does not exist on this project.' }
          : editId && editing && editing.status !== 'Draft' && !initialised
            ? { title: 'Only a draft can be edited', text: `${editing.billNo} is ${editing.status}. Cancel it from the register to bill its quantities again.` }
            : null;

  if (blocked) {
    return (
      <div className="min-w-0 space-y-4">
        <PageHeader title={title} icon={Calculator} backHref={backHref} backLabel="Back to RA bills" />
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <p className="font-semibold text-foreground">{blocked.title}</p>
            <p className="text-sm text-muted-foreground">{blocked.text}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {error === 'failed' && (
                <Button type="button" variant="outline" onClick={() => void reload()}>
                  Try again
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href={backHref}>Back to RA bills</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const showBillErrors = attempted && validation.errors.length > 0;
  const busy = saving !== null;

  const saveButtons = (
    <>
      <Button type="button" variant="outline" onClick={() => void save(false)} disabled={busy}>
        {saving === 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save as draft
      </Button>
      <Button type="button" onClick={() => void save(true)} disabled={busy}>
        {saving === 'submit' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
        Save &amp; submit
      </Button>
    </>
  );

  return (
    <div className="min-w-0 space-y-4 pb-24">
      <PageHeader
        title={editing ? `Edit ${editing.billNo}` : title}
        icon={Calculator}
        backHref={backHref}
        backLabel="Back to RA bills"
        description="Bill certified JMC and MVAC quantities to the client. Each line can be billed up to its balance — what is certified less what other bills already carry."
        meta={project ? [{ label: 'Project', value: project.projectName }, { label: 'RA no', value: String(suggestedSequence) }] : undefined}
      />

      {/* Header fields */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bill details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="ra-bill-no">Bill no</Label>
            <Input
              id="ra-bill-no"
              value={billNo}
              onChange={(event) => setBillNo(event.target.value)}
              autoComplete="off"
              aria-invalid={duplicateBillNo}
              className={cn(duplicateBillNo && 'border-rose-400')}
            />
            {duplicateBillNo && <p className="text-xs text-rose-700">Another RA bill of this project already has this number.</p>}
            {!editId && billNo.trim() !== suggestedBillNo && (
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setBillNo(suggestedBillNo)}>
                Use {suggestedBillNo}
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ra-bill-date">Bill date</Label>
            <Input id="ra-bill-date" type="date" value={billDate} onChange={(event) => setBillDate(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ra-bill-from">Period from (optional)</Label>
            <Input id="ra-bill-from" type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ra-bill-to">Period to (optional)</Label>
            <Input id="ra-bill-to" type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="ra-bill-remarks">Remarks (optional)</Label>
            <Textarea id="ra-bill-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      {showBillErrors && (
        <div role="alert" className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <ul className="space-y-0.5">
            {validation.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {staleRefs.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 sm:flex-row sm:items-center">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {staleRefs.length} line{staleRefs.length === 1 ? ' on this draft is' : 's on this draft are'} no longer certified (the entry was
            rejected, cancelled or changed). Remove {staleRefs.length === 1 ? 'it' : 'them'} to save.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => clearLines(staleRefs)}>
            <XCircle className="mr-2 h-4 w-4" /> Remove
          </Button>
        </div>
      )}

      <TableCard
        title="Certified lines"
        icon={Layers}
        count={visibleLines.length}
        total={billableLines.length}
        noun="line"
        scroll="natural"
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => fillLines(visibleLines)} disabled={!visibleLines.some((l) => l.balanceQty > QTY_TOLERANCE)}>
              <Wand2 className="mr-2 h-4 w-4" /> Fill balance (shown)
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => clearLines(visibleLines.map((l) => l.ref))} disabled={!visibleLines.some((l) => qty[l.ref])}>
              Clear (shown)
            </Button>
          </>
        }
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'BOQ SL No, description, JMC / MVAC no' }}
            activeCount={activeFilters}
            onClear={clearFilters}
          >
            <Select
              value={source}
              onValueChange={(value) => {
                setSource(value as SourceFilter);
                setEntryFilter('all');
              }}
            >
              <SelectTrigger aria-label="Source">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">JMC and MVAC</SelectItem>
                <SelectItem value="JMC">JMC only</SelectItem>
                <SelectItem value="MVAC">MVAC only</SelectItem>
              </SelectContent>
            </Select>
            {entryOptions.length > 0 && (
              <Select value={entryFilter} onValueChange={setEntryFilter}>
                <SelectTrigger aria-label="JMC / MVAC no" className="text-left">
                  <span className="truncate">
                    <SelectValue placeholder="JMC / MVAC no" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every entry</SelectItem>
                  {entryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {scopeChoices.scope1.length > 0 && (
              <Select
                value={scope1}
                onValueChange={(value) => {
                  setScope1(value);
                  setScope2('all');
                }}
              >
                <SelectTrigger aria-label="Scope 1" className="text-left">
                  <span className="truncate">
                    <SelectValue placeholder="Scope 1" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every scope 1</SelectItem>
                  {scopeChoices.scope1.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {scopeChoices.scope2.length > 0 && (
              <Select value={scope2} onValueChange={setScope2}>
                <SelectTrigger aria-label="Scope 2" className="text-left">
                  <span className="truncate">
                    <SelectValue placeholder="Scope 2" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every scope 2</SelectItem>
                  {scopeChoices.scope2.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Switch checked={onlyOnBill} onCheckedChange={setOnlyOnBill} aria-label="Only lines on this bill" />
              Only lines on this bill
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Switch checked={showBilled} onCheckedChange={setShowBilled} aria-label="Show fully billed lines" />
              Show fully billed
            </label>
          </FilterBar>
        }
      >
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead>BOQ SL No</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="hidden md:table-cell">Unit</TableHead>
              <TableHead className="hidden text-right md:table-cell">Rate</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Certified</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Prev. billed</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">This bill</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {billableLines.length === 0 ? (
              <TableEmpty colSpan={COLS}>
                Nothing is certified yet. Certify quantities on the project&apos;s JMC or MVAC entries, then bill them here.
              </TableEmpty>
            ) : groups.length === 0 ? (
              <TableEmpty colSpan={COLS}>
                {showBilled || activeFilters || search ? 'No lines match these filters.' : 'Every certified line is fully billed. Turn on “Show fully billed” to see them.'}
              </TableEmpty>
            ) : (
              groups.map((group) => {
                const fillable = group.lines.filter((line) => line.balanceQty > QTY_TOLERANCE);
                return (
                  <Fragment key={group.key}>
                    <TableRow className="bg-muted/60 hover:bg-muted/60">
                      <TableCell colSpan={COLS} className="py-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="rounded bg-background px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border">
                            {group.source}
                          </span>
                          <span className="font-semibold text-foreground">{group.entryNo || group.entryId}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatIsoDate(group.entryDate, 'No date')} · {group.lines.length} line{group.lines.length === 1 ? '' : 's'}
                          </span>
                          {fillable.length > 0 && (
                            <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={() => fillLines(fillable)}>
                              <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Fill this entry
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {group.lines.map((line) => {
                      const typed = qty[line.ref] ?? '';
                      const parsed = parseQtyInput(typed);
                      const lineError = validation.lineErrors[line.ref];
                      const amount =
                        !lineError && Number.isFinite(parsed) && parsed > 0 ? round2(Math.min(parsed, line.balanceQty) * line.rate) : null;
                      return (
                        <TableRow key={line.ref} className={cn(lineError && 'bg-rose-50')}>
                          <TableCell className="whitespace-nowrap align-top font-medium">{line.boqSlNo || '—'}</TableCell>
                          <TableCell className="min-w-[12rem] max-w-md align-top">
                            <div className="line-clamp-2" title={line.description}>
                              {line.description || '—'}
                            </div>
                            {(line.scope1 || line.scope2) && (
                              <div className="text-xs text-muted-foreground">{[line.scope1, line.scope2].filter(Boolean).join(' / ')}</div>
                            )}
                            <div className="mt-0.5 text-xs text-muted-foreground lg:hidden">
                              Cert {formatQty(line.certifiedQty)} · Prev {formatQty(line.previouslyBilledQty)}
                              <span className="md:hidden">
                                {' '}
                                · {formatAmount(line.rate)}/{line.unit || 'unit'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden align-top md:table-cell">{line.unit || '—'}</TableCell>
                          <TableCell className="hidden whitespace-nowrap text-right align-top tabular-nums md:table-cell">{formatAmount(line.rate)}</TableCell>
                          <TableCell className="hidden text-right align-top tabular-nums lg:table-cell">{formatQty(line.certifiedQty)}</TableCell>
                          <TableCell className="hidden text-right align-top tabular-nums lg:table-cell">{formatQty(line.previouslyBilledQty)}</TableCell>
                          <TableCell
                            className={cn(
                              'text-right align-top tabular-nums',
                              line.balanceQty > QTY_TOLERANCE ? 'font-medium text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {formatQty(line.balanceQty)}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                inputMode="decimal"
                                value={typed}
                                onChange={(event) => setLineQty(line.ref, event.target.value)}
                                placeholder="0"
                                aria-label={`Quantity to bill on ${line.entryNo} line ${line.boqSlNo}`}
                                aria-invalid={Boolean(lineError)}
                                className={cn('h-8 w-24 text-right tabular-nums', lineError && 'border-rose-400')}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                title="Fill the balance"
                                aria-label={`Fill the balance on ${line.entryNo} line ${line.boqSlNo}`}
                                disabled={line.balanceQty <= QTY_TOLERANCE}
                                onClick={() => setLineQty(line.ref, String(line.balanceQty))}
                              >
                                <Wand2 className="h-4 w-4" />
                              </Button>
                            </div>
                            {lineError && <p className="mt-1 max-w-[14rem] text-right text-xs text-rose-700 sm:ml-auto">{lineError}</p>}
                            {amount !== null && <p className="mt-1 text-right text-xs text-muted-foreground sm:hidden">{formatAmount(amount)}</p>}
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap text-right align-top tabular-nums sm:table-cell">
                            {amount !== null ? formatAmount(amount) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableCard>

      {/* Totals and save, kept in reach while scrolling the lines (above the phone's tab bar). */}
      <div className="sticky bottom-20 z-20 -mx-1 print:hidden lg:bottom-3">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-lg sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-foreground">
              {validation.items.length} line{validation.items.length === 1 ? '' : 's'} · {formatAmount(validation.totalAmount)}
            </div>
            <div className="text-xs text-muted-foreground">
              {lineErrorCount > 0
                ? `${lineErrorCount} line${lineErrorCount === 1 ? ' needs' : 's need'} correcting`
                : typedLineCount === 0
                  ? 'Enter a quantity on the lines to bill'
                  : 'Quantity × each line’s rate — GST, retention and deductions are recorded in Bill Tracking'}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">{saveButtons}</div>
        </div>
      </div>
    </div>
  );
}
