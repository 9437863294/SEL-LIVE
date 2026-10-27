'use client';

/**
 * My Trips — every trip the employee has recorded, and the place to claim them.
 *
 * Trips are recorded on Fleet Trip, by GPS: its Own vehicle tab drives & records a trip and saves it
 * here (a company vehicle there is a fleet trip — a separate calculation, never claimed). This page
 * records nothing itself unless Trip Settings › Rules allows trips to be typed in; it edits and
 * deletes unclaimed trips and puts them on claims.
 *
 * A trip is one journey; a claim is what gets approved and paid. "Create claim" puts one, several
 * or all unclaimed trips on a claim (the dialog picks them), a trip's own "Claim" button claims just
 * that one, and ticking rows first preselects them. Trips on a claim are locked and show where it
 * stands. Trips sent back by an approver come back here as unclaimed, with the reason, ready to
 * correct and claim again. Trips near the end of the claim window are called out before they expire.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, ListChecks, Plus, ReceiptText, Route, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataList } from '@/components/shared/data-list';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FilterBar } from '@/components/shared/filter-bar';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { useToast } from '@/hooks/use-toast';
import { sumMoney } from '@/lib/employee-trips/rates';
import { daysLeftToClaim, isClaimable, withinClaimWindow } from '@/lib/employee-trips/trips';
import { myTripColumns } from './my-trips-columns';
import { formatKm, type TripRecord, type TripStatus } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import { onOwnTripSaved } from './own-trip-outbox';
import { OwnTripOutboxPanel } from './own-trip-outbox-panel';
import { errorMessage, tripFetch } from './trip-api';
import { useTripClaims } from './trip-claims-provider';
import { useTripQuery } from './use-trip-query';
import { CreateClaimDialog, type CreatedClaim } from './submit-claim-dialog';
import { TripFormDialog } from './trip-form-dialog';
import { ClaimSteps, EmptyBlock, ErrorBlock, LoadingBlock, Money, SegmentTabs, shortDate } from './trip-ui';

type View = 'unclaimed' | 'process' | 'paid' | 'rejected' | 'all';

const VIEW_STATUSES: Record<View, TripStatus[] | null> = {
  unclaimed: ['draft'],
  process: ['submitted', 'approved'],
  paid: ['paid'],
  rejected: ['rejected'],
  all: null,
};

/** Where a trip is recorded: Fleet Trip, on its own-vehicle tab. */
const RECORD_HREF = '/driver-management/fleet?kind=own';

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

export default function MyTrips() {
  const router = useRouter();
  const { toast } = useToast();
  const { data, error: bootError, loading: bootLoading, reload: reloadBootstrap } = useTripClaims();
  const tripsQuery = useTripQuery<{ trips: TripRecord[] }>('trips');
  const trips = tripsQuery.data?.trips ?? null;
  const loadError = trips ? null : tripsQuery.error;
  const setTrips = (change: (current: TripRecord[]) => TripRecord[]) => tripsQuery.setData((current) => ({ trips: change(current?.trips ?? []) }));
  const [view, setView] = useState<View>('unclaimed');
  const [month, setMonth] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TripRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimPreselect, setClaimPreselect] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<TripRecord | null>(null);

  // A trip saved offline on Fleet Trip reached the server: it appears in the list.
  const setTripsData = tripsQuery.setData;
  useEffect(() => onOwnTripSaved((trip) => setTripsData((current) => ({ trips: [trip, ...(current?.trips ?? []).filter((entry) => entry.id !== trip.id)] }))), [setTripsData]);

  // Old links land here with ?new=1 (record a trip) or ?claim=1 (create a claim). A new trip is
  // recorded on Fleet Trip by GPS (typed in here only when Trip rules allow it); a claim opens here
  // once the trips are in, and the flag is dropped.
  const ready = Boolean(data) && trips !== null;
  const typedAllowed = Boolean(data?.settings.rules.allowTypedTrips);
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('new') === '1' ? 'trip' : params.get('claim') === '1' ? 'claim' : null;
    if (!wanted) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (wanted === 'trip' && !typedAllowed) {
      router.replace(RECORD_HREF);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time open from the URL once the data has loaded
    if (wanted === 'trip') setFormOpen(true);
    else setClaimOpen(true);
  }, [ready, typedAllowed, router]);

  const all = useMemo(() => trips ?? [], [trips]);
  const rules = data?.settings.rules;
  const today = data?.today ?? '';
  const claimable = useCallback((trip: TripRecord) => Boolean(rules) && isClaimable(trip, today, rules!), [rules, today]);
  const candidates = useMemo(() => all.filter(claimable), [all, claimable]);

  /** Opens "Create claim" with these trips ticked (none: every unclaimed trip). */
  const openClaim = (tripIds: string[]) => {
    setClaimPreselect(tripIds);
    setClaimOpen(true);
  };

  const onClaimCreated = (claims: CreatedClaim[]) => {
    setSelected(new Set());
    tripsQuery.reload();
    reloadBootstrap();
    // Show what was made: the claim itself, or the list when the trips became several claims.
    router.push(claims.length === 1 ? `/driver-management/claims/${claims[0].id}` : '/driver-management/my-claims');
  };

  const counts = useMemo(() => {
    const result = {} as Record<View, number>;
    for (const key of Object.keys(VIEW_STATUSES) as View[]) {
      const statuses = VIEW_STATUSES[key];
      result[key] = statuses ? all.filter((trip) => statuses.includes(trip.status)).length : all.length;
    }
    return result;
  }, [all]);

  const months = useMemo(() => [...new Set(all.map((trip) => trip.tripDate.slice(0, 7)))].sort().reverse(), [all]);

  const visible = useMemo(() => {
    const statuses = VIEW_STATUSES[view];
    const needle = search.trim().toLowerCase();
    return all.filter(
      (trip) =>
        (!statuses || statuses.includes(trip.status)) &&
        (month === 'all' || trip.tripDate.startsWith(month)) &&
        (!needle || [trip.fromPlace, trip.toPlace, trip.purpose, trip.vehicleNumber, trip.projectName, trip.claimNumber].some((value) => String(value ?? '').toLowerCase().includes(needle))),
    );
  }, [all, month, search, view]);

  // Selection holds only trips that can still be claimed.
  const chosen = useMemo(() => all.filter((trip) => selected.has(trip.id) && claimable(trip)), [all, claimable, selected]);
  const chosenKm = Math.round(chosen.reduce((total, trip) => total + trip.distanceKm, 0) * 10) / 10;
  const chosenAmount = sumMoney(chosen.map((trip) => trip.totalAmount));
  const visibleClaimable = visible.filter(claimable);

  const drafts = all.filter((trip) => trip.status === 'draft');
  const sentBack = drafts.filter((trip) => trip.returnNote);
  const expiring = rules ? drafts.filter((trip) => { const left = daysLeftToClaim(trip.tripDate, today, rules); return left !== null && left >= 0 && left <= 7; }) : [];
  const expired = rules ? drafts.filter((trip) => !withinClaimWindow(trip.tripDate, today, rules)) : [];

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const onSaved = (trip: TripRecord) =>
    setTrips((list) => {
      const exists = list.some((entry) => entry.id === trip.id);
      const next = exists ? list.map((entry) => (entry.id === trip.id ? trip : entry)) : [trip, ...list];
      return next.sort((a, b) => b.tripDate.localeCompare(a.tripDate) || b.createdAt.localeCompare(a.createdAt));
    });

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await tripFetch(`trips/${deleting.id}`, { method: 'DELETE' });
      setTrips((list) => list.filter((trip) => trip.id !== deleting.id));
      toggle(deleting.id, false);
      toast({ title: 'Trip deleted' });
    } catch (failure) {
      toast({ variant: 'destructive', title: 'Not deleted', description: errorMessage(failure) });
      throw failure;
    }
  }

  const columns = myTripColumns({
    rules,
    today,
    claimable,
    selected,
    toggle,
    openClaim,
    onEdit: (trip) => {
      setEditing(trip);
      setFormOpen(true);
    },
    onDelete: setDeleting,
  });

  if (bootLoading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBlock message={bootError ?? 'Could not load trip claims.'} onRetry={() => void reloadBootstrap()} />;

  const noRates = data.settings.rateRevisions.length === 0;

  return (
      <div className="space-y-4">
      {/*
        No page title, description or totals — the module header names the page and the list below
        is the rest — and no Record a trip: trips are recorded on Fleet Trip. Create claim sits on the
        search line below; only a typed trip, when Trip rules allow one, keeps a row up here.
      */}
      {typedAllowed && (
        <div className="page-header-actions flex w-full min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Type it in
          </Button>
        </div>
      )}

      {/* Trips saved on the phone without a connection, until the server has them. */}
      <OwnTripOutboxPanel />

      {/* The four steps are a desktop explainer; on a phone they pushed the trips below the fold. */}
      <div className="hidden sm:block">
      <ClaimSteps approvalName={data.settings.stages.find((stage) => stage.kind === 'approval')?.name} paymentName={data.settings.stages.find((stage) => stage.kind === 'payment')?.name} />
      </div>

      {noRates && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          No per-km rates have been set yet, so trips are recorded at ₹0 per km for now. They are priced again when you put them on a claim, so once Settings › Rates has a rate card the claim uses it.
        </p>
      )}
      {sentBack.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {sentBack.length} trip{sentBack.length === 1 ? ' was' : 's were'} sent back by an approver. Correct {sentBack.length === 1 ? 'it' : 'them'} and claim again.
        </p>
      )}
      {expiring.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {expiring.length} unclaimed trip{expiring.length === 1 ? '' : 's'} must be put on a claim within a week, or {expiring.length === 1 ? 'it' : 'they'} can no longer be claimed.
        </p>
      )}

      {/*
        Search, filters and Create claim on one line, a phone included: the button sits beside the
        filter bar rather than in its `actions`, which a phone stacks on a row of their own. "Claim"
        on a phone, so the search keeps room to type.
      */}
      <div className="flex min-w-0 items-start gap-2">
        <FilterBar
          className="min-w-0 flex-1"
          search={{ value: search, onChange: setSearch, placeholder: 'Search trips…', label: 'Search trips by place, purpose, vehicle or claim' }}
          activeCount={month !== 'all' ? 1 : 0}
          onClear={() => { setMonth('all'); setSearch(''); }}
        >
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-full bg-white text-left sm:w-40" aria-label="Month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {months.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {monthLabel(entry)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterBar>
        <Button type="button" variant={candidates.length ? 'default' : 'outline'} className={cn('shrink-0', candidates.length && VM_PRIMARY_BUTTON)} onClick={() => openClaim(chosen.map((trip) => trip.id))}>
          <ReceiptText className="mr-2 h-4 w-4" aria-hidden />
          <span className="sm:hidden">Claim</span>
          <span className="hidden sm:inline">
            Create claim
            {chosen.length ? ` (${chosen.length} selected)` : candidates.length ? ` (${candidates.length} unclaimed)` : ''}
          </span>
        </Button>
      </div>

      {/* The tabs fill the line (all of it on a phone; beside Select all from sm up). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentTabs
          fill
          className="sm:w-auto sm:flex-1"
          label="Trip status"
          value={view}
          onChange={setView}
          options={[
            { value: 'unclaimed', label: 'Unclaimed', count: counts.unclaimed },
            { value: 'process', label: 'In process', count: counts.process },
            { value: 'paid', label: 'Paid', count: counts.paid },
            { value: 'rejected', label: 'Rejected', count: counts.rejected },
            { value: 'all', label: 'All', count: counts.all },
          ]}
        />
        {visibleClaimable.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected((current) => (visibleClaimable.every((trip) => current.has(trip.id)) ? new Set() : new Set(visibleClaimable.map((trip) => trip.id))))}
          >
            <ListChecks className="mr-1.5 h-4 w-4" aria-hidden />
            {visibleClaimable.every((trip) => selected.has(trip.id)) ? 'Clear selection' : `Select all ${visibleClaimable.length}`}
          </Button>
        )}
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <p className="text-sm text-slate-700">
            <span className="font-semibold">{chosen.length} selected</span> · {formatKm(chosenKm)} · <Money value={chosenAmount} className="font-semibold" />
          </p>
          <Button type="button" className={cn(VM_PRIMARY_BUTTON, 'w-full sm:w-auto')} onClick={() => openClaim(chosen.map((trip) => trip.id))}>
            <ReceiptText className="mr-2 h-4 w-4" aria-hidden />
            Create claim with {chosen.length === 1 ? 'this trip' : `these ${chosen.length} trips`}
          </Button>
        </div>
      )}

      {loadError ? (
        <ErrorBlock message={loadError} onRetry={tripsQuery.reload} />
      ) : trips === null ? (
        <LoadingBlock />
      ) : (
        <DataList
          rows={visible}
          columns={columns}
          dense
          rowClassName={(trip) => (selected.has(trip.id) && claimable(trip) ? 'bg-primary/5' : undefined)}
          empty={
            <EmptyBlock icon={Route} title={all.length ? 'No trips here' : 'No trips recorded yet'}>
              {all.length ? 'Try another tab or clear the filters.' : 'Record your first trip on Fleet Trip › Own vehicle — the amount is worked out from the company rate for your vehicle.'}
            </EmptyBlock>
          }
        />
      )}
      {expired.length > 0 && view === 'unclaimed' && (
        <p className="text-[11px] text-muted-foreground">
          {expired.length} unclaimed trip{expired.length === 1 ? ' is' : 's are'} past the {rules?.claimWindowDays}-day claim window and can only be deleted.
        </p>
      )}

      <TripFormDialog open={formOpen} onOpenChange={setFormOpen} data={data} trip={editing} myTrips={all} onSaved={onSaved} />
      <CreateClaimDialog
        open={claimOpen}
        onOpenChange={setClaimOpen}
        data={data}
        candidates={candidates}
        preselected={claimPreselect}
        onSubmitted={onClaimCreated}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title="Delete this trip?"
        description={deleting ? `${deleting.fromPlace} → ${deleting.toPlace} on ${shortDate(deleting.tripDate)}. This cannot be undone.` : undefined}
        onConfirm={confirmDelete}
      />
      </div>
  );
}
