'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, CalendarClock, ChevronRight, Download, Files, HardHat, History, MapPin, Plus } from 'lucide-react';
import type { InsuredAsset, Project, ProjectInsurancePolicy } from '@/lib/types';
import { formatDay, formatInr, projectPolicyState, relativeDays, toDate, type ProjectPolicyState } from '@/lib/insurance';
import { exportRowsToExcel } from '@/lib/report-excel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * How well an insured asset is covered, judged from its policies: the worst one decides, so a site
 * with one expired policy among three current ones still asks for attention.
 */
type Standing = 'expired' | 'expiring' | 'uncovered' | 'covered' | 'inactive';
type Bucket = 'all' | Standing;

const STANDING: Record<Standing, { label: string; tone: StatusTone }> = {
  expired:   { label: 'Cover Expired', tone: 'danger' },
  expiring:  { label: 'Expiring Soon', tone: 'warning' },
  uncovered: { label: 'No Live Cover', tone: 'danger' },
  covered:   { label: 'Covered', tone: 'success' },
  inactive:  { label: 'Inactive Asset', tone: 'neutral' },
};

/** Most urgent first. */
const URGENCY: Record<Standing, number> = { expired: 0, expiring: 1, uncovered: 2, covered: 3, inactive: 4 };

const LIVE: readonly ProjectPolicyState[] = ['active', 'expiring'];

interface Row {
  asset: InsuredAsset;
  name: string;
  location: string;
  policies: number;
  live: number;
  expiring: number;
  expired: number;
  cover: number;
  premium: number;
  insurers: string[];
  /** Earliest end date among live policies — when cover next needs renewing. */
  nextExpiry: Date | null;
  /** Earliest end date among expired policies, for a site whose cover has already run out. */
  expiredSince: Date | null;
  standing: Standing;
}

// ─── register ─────────────────────────────────────────────────────────────────

interface Props {
  assets: InsuredAsset[];
  projects: Project[];
  policies: ProjectInsurancePolicy[];
  canAdd: boolean;
}

/**
 * The project insurance register: one row per insured project or property, with its cover,
 * premium and when it next needs renewing. Figures and charts live on the Project Dashboard; this
 * renders from data already loaded so the page owns fetching and access.
 */
export function ProjectRegister({ assets, projects, policies, canAdd }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState<Bucket>('all');
  const [type, setType] = useState('all');
  const [insurer, setInsurer] = useState('all');

  // ─── computed ─────────────────────────────────────────────────────────────

  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const byAsset = new Map<string, { p: ProjectInsurancePolicy; s: ProjectPolicyState }[]>();
    for (const p of policies) {
      const list = byAsset.get(p.assetId) ?? [];
      list.push({ p, s: projectPolicyState(p, now) });
      byAsset.set(p.assetId, list);
    }
    const earliest = (dates: (Date | null)[]) =>
      dates.filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    return assets.map((asset) => {
      const proj = asset.type === 'Project' && asset.projectId ? projectById.get(asset.projectId) : undefined;
      const list = byAsset.get(asset.id) ?? [];
      const live = list.filter((r) => LIVE.includes(r.s));
      const expiring = list.filter((r) => r.s === 'expiring').length;
      const expired = list.filter((r) => r.s === 'expired');
      const standing: Standing = asset.status === 'Inactive' ? 'inactive'
        : expired.length ? 'expired'
        : expiring ? 'expiring'
        : live.length ? 'covered'
        : 'uncovered';
      return {
        asset,
        name: proj?.projectName || asset.name,
        location: proj?.location || asset.location || '',
        policies: list.length,
        live: live.length,
        expiring,
        expired: expired.length,
        cover: live.reduce((s, r) => s + (r.p.sum_insured || 0), 0),
        premium: live.reduce((s, r) => s + (r.p.premium || 0), 0),
        insurers: Array.from(new Set(live.map((r) => r.p.insurance_company).filter(Boolean))).sort(),
        nextExpiry: earliest(live.map((r) => toDate(r.p.insured_until))),
        expiredSince: earliest(expired.map((r) => toDate(r.p.insured_until))),
        standing,
      };
    });
  }, [assets, projects, policies]);

  const types = useMemo(() => Array.from(new Set(assets.map((a) => a.type).filter(Boolean))).sort(), [assets]);
  const insurers = useMemo(() => Array.from(new Set(rows.flatMap((r) => r.insurers))).sort(), [rows]);

  const stats = useMemo(() => {
    const count = (s: Standing) => rows.filter((r) => r.standing === s).length;
    const current = rows.filter((r) => r.standing !== 'inactive');
    return {
      total: rows.length,
      covered: count('covered'),
      expiring: count('expiring'),
      expired: count('expired'),
      uncovered: count('uncovered'),
      inactive: count('inactive'),
      cover: current.reduce((s, r) => s + r.cover, 0),
      premium: current.reduce((s, r) => s + r.premium, 0),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => bucket === 'all' || r.standing === bucket)
      .filter((r) => type === 'all' || r.asset.type === type)
      .filter((r) => insurer === 'all' || r.insurers.includes(insurer))
      .filter((r) => !q || [r.name, r.location, r.asset.type, ...r.insurers].some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) =>
        URGENCY[a.standing] - URGENCY[b.standing]
        || (a.nextExpiry?.getTime() ?? Infinity) - (b.nextExpiry?.getTime() ?? Infinity)
        || a.name.localeCompare(b.name));
  }, [rows, bucket, type, insurer, search]);

  const exportRegister = () =>
    exportRowsToExcel('Project Insurance Register', filtered.map((r) => ({
      Asset: r.name,
      Type: r.asset.type,
      Location: r.location,
      Standing: STANDING[r.standing].label,
      'Live Policies': r.live,
      'Total Policies': r.policies,
      'Expiring (30d)': r.expiring,
      Expired: r.expired,
      'Sum Insured (live)': r.cover,
      'Premium (live)': r.premium,
      Insurers: r.insurers.join(', '),
      'Next Expiry': r.nextExpiry ? formatDay(r.nextExpiry) : '',
      'Expired Since': r.expiredSince ? formatDay(r.expiredSince) : '',
    })));


  const activeFilters = (bucket !== 'all' ? 1 : 0) + (type !== 'all' ? 1 : 0) + (insurer !== 'all' ? 1 : 0);

  /** When cover next runs out, or since when it has been out. */
  const expiryCell = (r: Row) => {
    if (r.standing === 'expired' && r.expiredSince) {
      return <span className="text-red-600">Expired {formatDay(r.expiredSince)}</span>;
    }
    if (!r.nextExpiry) return <span className="text-muted-foreground">—</span>;
    return (
      <span className={cn(r.standing === 'expiring' && 'text-amber-700')}>
        {formatDay(r.nextExpiry)} <span className="text-xs text-muted-foreground">· {relativeDays(r.nextExpiry)}</span>
      </span>
    );
  };

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <PageHeader
        icon={HardHat}
        title="Project Insurance"
        description={`${stats.total} insured asset${stats.total === 1 ? '' : 's'} · ${formatInr(stats.cover)} cover in force · ${formatInr(stats.premium)} premium on live cover`}
        actions={
          <>
            {/* On a phone these three sit in the bottom bar's More sheet; the header keeps Export and Add. */}
            <Link href="/insurance/project/history" className="hidden sm:block">
              <Button variant="outline" size="sm" className="w-full gap-1.5"><History className="h-3.5 w-3.5" /> History</Button>
            </Link>
            <Link href="/insurance/project/premium-due" className="hidden sm:block">
              <Button variant="outline" size="sm" className="w-full gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> Renewals Due</Button>
            </Link>
            <Link href="/insurance/project/all-policies" className="hidden sm:block">
              <Button variant="outline" size="sm" className="w-full gap-1.5"><Files className="h-3.5 w-3.5" /> All Policies</Button>
            </Link>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportRegister} disabled={filtered.length === 0}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            {canAdd && (
              <Link href="/insurance/project/new">
                <Button size="sm" className="w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"><Plus className="h-3.5 w-3.5" /> Add Policy</Button>
              </Link>
            )}
          </>
        }
      />

      {/* ── Stats strip — each figure filters the register ─────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-6">
          {([
            { label: 'Total',          value: stats.total,     key: 'all',       color: 'text-slate-700' },
            { label: 'Covered',        value: stats.covered,   key: 'covered',   color: 'text-emerald-600' },
            { label: 'Expiring (30d)', value: stats.expiring,  key: 'expiring',  color: 'text-amber-600' },
            { label: 'Expired',        value: stats.expired,   key: 'expired',   color: 'text-red-600' },
            { label: 'No Live Cover',  value: stats.uncovered, key: 'uncovered', color: 'text-rose-600' },
            { label: 'Inactive',       value: stats.inactive,  key: 'inactive',  color: 'text-slate-400' },
          ] as const).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setBucket(bucket === s.key ? 'all' : s.key)}
              aria-pressed={bucket === s.key}
              className={cn(
                'flex flex-col items-center justify-center rounded-lg px-1 py-2 text-center transition-all',
                bucket === s.key ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/50',
              )}
            >
              <span className={cn('text-xl font-bold leading-tight', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      <TableCard
        title="Insured Assets"
        icon={HardHat}
        count={filtered.length}
        total={rows.length}
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search asset, location, insurer…' }}
            activeCount={activeFilters}
            onClear={() => { setSearch(''); setBucket('all'); setType('all'); setInsurer('all'); }}
          >
            <Select value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
              <SelectTrigger aria-label="Standing"><SelectValue placeholder="All Standings" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Standings</SelectItem>
                {(Object.keys(STANDING) as Standing[]).map((s) => <SelectItem key={s} value={s}>{STANDING[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger aria-label="Asset type"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={insurer} onValueChange={setInsurer}>
              <SelectTrigger aria-label="Insurer"><SelectValue placeholder="All Insurers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Insurers</SelectItem>
                {insurers.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        {/* Cards until the table has room for expiry and standing; two to a row on a tablet. */}
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:hidden">
          {filtered.length === 0 ? (
            <div className="sm:col-span-2"><EmptyState hasRows={rows.length > 0} canAdd={canAdd} /></div>
          ) : (
            filtered.map((r) => (
              <Card
                key={r.asset.id}
                className="cursor-pointer overflow-hidden border-border/60 transition-all hover:-translate-y-0.5 hover:shadow-sm"
                onClick={() => router.push(`/insurance/project/${r.asset.id}`)}
              >
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <AssetIcon type={r.asset.type} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.name}</p>
                        {r.location && <p className="truncate text-xs text-muted-foreground">{r.location}</p>}
                      </div>
                    </div>
                    <StatusBadge status={STANDING[r.standing].label} tone={STANDING[r.standing].tone} className="shrink-0" />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div><span className="text-muted-foreground">Policies: </span>{r.live} live / {r.policies}</div>
                    <div><span className="text-muted-foreground">Cover: </span>{r.cover ? formatInr(r.cover) : '—'}</div>
                    <div><span className="text-muted-foreground">Premium: </span>{r.premium ? formatInr(r.premium) : '—'}</div>
                    <div className="min-w-0 truncate">
                      <span className="text-muted-foreground">Insurer: </span>{r.insurers.join(', ') || '—'}
                    </div>
                    <div className="col-span-2 min-w-0 truncate"><span className="text-muted-foreground">Expiry: </span>{expiryCell(r)}</div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Desktop table; type and insurers join once there is width to spare. */}
        <Table containerClassName="hidden lg:block">
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead className="hidden xl:table-cell">Type</TableHead>
              <TableHead className="text-center">Policies</TableHead>
              <TableHead className="hidden xl:table-cell">Insurers</TableHead>
              <TableHead className="text-right">Sum Insured</TableHead>
              <TableHead className="text-right">Premium</TableHead>
              <TableHead>Next Expiry</TableHead>
              <TableHead>Standing</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center"><EmptyState hasRows={rows.length > 0} canAdd={canAdd} /></TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.asset.id} onClick={() => router.push(`/insurance/project/${r.asset.id}`)} className="group cursor-pointer">
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <AssetIcon type={r.asset.type} />
                      <div className="min-w-0">
                        <p className="max-w-[260px] truncate font-medium" title={r.name}>{r.name}</p>
                        {r.location && (
                          <p className="flex max-w-[260px] items-center gap-1 truncate text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{r.location}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell"><Badge variant="outline">{r.asset.type}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-center tabular-nums">
                    <span className="font-medium">{r.live}</span>
                    <span className="text-muted-foreground"> / {r.policies}</span>
                  </TableCell>
                  <TableCell className="hidden max-w-[200px] truncate xl:table-cell" title={r.insurers.join(', ')}>{r.insurers.join(', ') || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{r.cover ? formatInr(r.cover) : '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{r.premium ? formatInr(r.premium) : '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{expiryCell(r)}</TableCell>
                  <TableCell><StatusBadge status={STANDING[r.standing].label} tone={STANDING[r.standing].tone} /></TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" aria-hidden />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

function AssetIcon({ type }: { type: InsuredAsset['type'] }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
        type === 'Project' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600',
      )}
      aria-hidden
    >
      {type === 'Project' ? <HardHat className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
    </span>
  );
}

function EmptyState({ hasRows, canAdd }: { hasRows: boolean; canAdd: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <HardHat className="h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{hasRows ? 'No assets match your filters.' : 'No insured assets yet.'}</p>
      {!hasRows && canAdd && (
        <Link href="/insurance/project/new">
          <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add First Policy</Button>
        </Link>
      )}
    </div>
  );
}
