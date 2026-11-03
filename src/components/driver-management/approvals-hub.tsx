'use client';

/**
 * Driver Management › Approvals: everything waiting for this person's decision, in one place.
 *
 * - **Trip claims** — claims at an approval stage this person is named on (ClaimsList, approvals
 *   mode), for those named on an approval stage, holding Override Workflow, or with a claim waiting.
 * - **Extra km requests** — drivers asking to run a company vehicle past its daily km limit.
 * - **Trips to review** — fleet trips whose GPS and odometer disagree, or closed without a reading.
 *
 * The page leads with one card per kind: what it is in plain words, how many wait, and whether it
 * needs a decision. The cards are the tabs. Under them, the chosen kind's list, headed by the three
 * steps that clear one — so someone new to the page knows what each thing is and what to do with it.
 *
 * The fleet kinds show for the vehicles' approvers, backups and reporting authorities, the
 * escalation list, Fleet Trips · Review holders, and anyone something has reached (the fleet
 * bootstrap says which). These used to be a second page, Fleet Approvals; one inbox is easier to
 * keep empty than two. Being assigned is the authority — no role permission is needed to decide.
 *
 * `?tab=claims|fleet|reviews` picks the tab (the fleet notifications and the Fleet Control
 * dashboard link straight to theirs); `?open=<id>` opens an over-limit request.
 */

import { useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Gauge, Inbox, ReceiptText, Scale, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { useFleet } from '@/components/fleet/fleet-provider';
import { cn } from '@/lib/utils';
import ClaimsList from './trips/claims-list';
import { useTripClaims } from './trips/trip-claims-provider';
import { EmptyBlock, LoadingBlock, Money, StepLine } from './trips/trip-ui';
import { APPROVALS_PATH, FleetRequestsSection, FleetReviewsSection } from './fleet/fleet-approvals';

type Tab = 'claims' | 'fleet' | 'reviews';

const TABS: Tab[] = ['claims', 'fleet', 'reviews'];

const asTab = (value: string | null): Tab | null => (TABS.includes(value as Tab) ? (value as Tab) : null);

/** Each kind of approval in plain words, and the three steps that clear one. */
const KINDS: Record<Tab, { title: string; blurb: string; steps: readonly [string, string, string]; icon: LucideIcon; chip: string }> = {
  claims: {
    title: 'Trip claims',
    blurb: 'Employees claiming money for their trips',
    steps: ['Open a claim', 'Check its trips and amounts', 'Approve, send back or reject'],
    icon: ReceiptText,
    chip: 'bg-sky-100 text-sky-700',
  },
  fleet: {
    title: 'Extra km requests',
    blurb: 'Drivers asking to run past the daily km limit',
    steps: ['Open a request', 'Check the reason and the km asked for', 'Approve or reject before it expires'],
    icon: Gauge,
    chip: 'bg-amber-100 text-amber-700',
  },
  reviews: {
    title: 'Trips to review',
    blurb: 'Trips where GPS and odometer km don’t match',
    steps: ['Open a trip', 'Compare its GPS and odometer km', 'Pick the distance to bill'],
    icon: Scale,
    chip: 'bg-violet-100 text-violet-700',
  },
};

type Option = { value: Tab; count?: number; detail?: ReactNode };

const GRID_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

export default function ApprovalsHub() {
  const router = useRouter();
  const params = useSearchParams();
  const claims = useTripClaims();
  const fleet = useFleet();

  // The tab the address asks for; a notification tapped while the page is open changes only that.
  const linked = params.get('open') ? 'fleet' : asTab(params.get('tab'));
  const [chosen, setChosen] = useState<Tab | null>(linked);
  const [lastLinked, setLastLinked] = useState(linked);
  if (linked !== lastLinked) {
    setLastLinked(linked);
    if (linked) setChosen(linked);
  }

  const trips = claims.data;
  const bootstrap = fleet.data;
  const showClaims = Boolean(trips && (trips.named.approval || trips.access.override || trips.inbox.approvals > 0));
  const showFleet = Boolean(bootstrap && (bootstrap.isApprover || bootstrap.access.review || bootstrap.inbox.approvals > 0 || bootstrap.inbox.reviews > 0));
  const settled = (Boolean(trips) || Boolean(claims.error) || !claims.loading) && (Boolean(bootstrap) || Boolean(fleet.error) || !fleet.loading);

  const options: Option[] = [
    ...(showClaims
      ? [
          {
            value: 'claims' as const,
            count: trips?.inbox.approvals,
            detail: trips && trips.inbox.approvals > 0 ? (
              <>
                <Money value={trips.inbox.approvalsAmount} compact /> claimed
              </>
            ) : undefined,
          },
        ]
      : []),
    ...(showFleet
      ? [
          { value: 'fleet' as const, count: bootstrap?.inbox.approvals },
          { value: 'reviews' as const, count: bootstrap?.inbox.reviews },
        ]
      : []),
  ];
  // The chosen tab when it is shown; else the first with something waiting; else the first.
  const tab = options.find((option) => option.value === chosen)?.value ?? options.find((option) => (option.count ?? 0) > 0)?.value ?? options[0]?.value ?? null;

  const select = (next: Tab) => {
    setChosen(next);
    router.replace(`${APPROVALS_PATH}?tab=${next}`, { scroll: false });
  };

  const waiting = options.reduce((sum, option) => sum + (option.count ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        icon={Inbox}
        description="Everything that needs your decision, in one place. Pick a type below to see what is waiting and act on it."
        badge={options.length ? <WaitingBadge total={waiting} /> : undefined}
      />

      {!settled && !options.length ? (
        <LoadingBlock />
      ) : !tab ? (
        <EmptyBlock icon={Inbox} title="Nothing for you to approve">
          Trip claims, extra km requests and trips to review appear here once you are named as an approver for them.
        </EmptyBlock>
      ) : (
        <>
          <div role="tablist" aria-label="Approval types" className={cn('grid gap-2 sm:gap-3', GRID_COLS[options.length])}>
            {options.map((option) => (
              <KindCard key={option.value} kind={option.value} count={option.count} detail={option.detail} active={option.value === tab} onSelect={() => select(option.value)} />
            ))}
          </div>

          <section id="approvals-panel" role="tabpanel" aria-labelledby={`approvals-tab-${tab}`} className="space-y-3">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
              <h2 className="text-sm font-semibold text-slate-800 sm:text-base">{KINDS[tab].title}</h2>
              <StepLine label="How to clear these" steps={KINDS[tab].steps} />
            </div>
            {tab === 'claims' && <ClaimsList mode="approvals" embedded />}
            {tab === 'fleet' && <FleetRequestsSection />}
            {tab === 'reviews' && <FleetReviewsSection />}
          </section>
        </>
      )}
    </div>
  );
}

/** Beside the title: how many things wait across every kind, or that none do. */
function WaitingBadge({ total }: { total: number }) {
  return total > 0 ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
      {total} waiting
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
      <Check className="h-3.5 w-3.5" aria-hidden />
      All caught up
    </span>
  );
}

/**
 * One kind of approval as a compact one-line tile that is also its tab: icon, name and a short
 * description, and on the right a count badge — amber when something waits, a green tick when not.
 * On a phone, three share the row, so the icon and description drop out and the name may wrap.
 */
function KindCard({ kind, count, detail, active, onSelect }: { kind: Tab; count?: number; detail?: ReactNode; active: boolean; onSelect: () => void }) {
  const { title, blurb, icon: Icon, chip } = KINDS[kind];
  const pending = (count ?? 0) > 0;

  return (
    <button
      type="button"
      role="tab"
      id={`approvals-tab-${kind}`}
      aria-selected={active}
      aria-controls="approvals-panel"
      title={blurb}
      onClick={onSelect}
      className={cn(
        'relative flex min-w-0 items-center gap-2.5 overflow-hidden rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:px-3 sm:py-2.5',
        active ? 'border-primary/50 shadow-[0_8px_20px_-14px_var(--sel-tab-glow)]' : 'border-slate-200 hover:border-slate-300',
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-[3px] bg-[image:var(--sel-tab-gradient)]" aria-hidden />}
      <span className={cn('hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:flex', chip)} aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold leading-tight text-slate-800 sm:truncate sm:text-sm">{title}</span>
        <span className="mt-0.5 hidden truncate text-[11px] text-muted-foreground md:block">{blurb}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {pending ? (
          <span className="min-w-[1.5rem] rounded-full bg-amber-500 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-white">
            {count}
            <span className="sr-only"> waiting</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-slate-400">
            {count !== undefined && <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />}
            {count ?? '—'}
          </span>
        )}
        {detail && <span className="hidden whitespace-nowrap text-[10px] text-muted-foreground sm:block">{detail}</span>}
      </span>
    </button>
  );
}
