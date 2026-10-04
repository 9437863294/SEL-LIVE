'use client';

/**
 * Bill Tracking charts. Every mark is a link: clicking a bar opens the register or outstanding list
 * filtered to what the bar counts — no decorative charts.
 *
 * Colours come from the app's validated finance palette (the Bank Balance / Daily Requisition
 * series and ageing ramp), switched for dark mode, with a sixth ageing step for the 365+ bucket.
 * Single-measure charts use one hue; ageing uses the sequential ramp so older reads darker.
 */

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { useTheme } from '@/components/theme/ThemeProvider';
import { chartChrome } from '@/components/ui/chart';
import { monthLabel } from '@/lib/bill-tracking/calculations';
import { formatINR, formatINRCompact } from '@/lib/bill-tracking/money';

const PALETTE = {
  light: {
    billing: '#2a78d6',
    collection: '#1baf7a',
    outstanding: '#eb6834',
    single: '#2a78d6',
    ageing: ['#a9cbf4', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  },
  dark: {
    billing: '#3987e5',
    collection: '#199e70',
    outstanding: '#d95926',
    single: '#3987e5',
    ageing: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#c9ddf8'],
  },
} as const;

export function useBtPalette() {
  const { resolvedMode } = useTheme();
  return PALETTE[resolvedMode === 'dark' ? 'dark' : 'light'];
}

const axisMoney = (value: number) => formatINRCompact(Number(value)).replace('₹', '');
const tooltipMoney = (value: unknown) => formatINR(Number(value));

export function ChartPanel({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-white/60 bg-white/85 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-3">{children}</div>
      {footer ? <div className="mt-2 text-xs text-muted-foreground">{footer}</div> : null}
    </section>
  );
}

export interface FlowPoint {
  month: string;
  billing: number;
  collection: number;
  outstanding: number;
}

/** Billing and collection per month as bars, outstanding at month end as a line (same ₹ axis). */
export function BillingCollectionChart({ data, fy }: { data: FlowPoint[]; fy: string }) {
  const palette = useBtPalette();
  const router = useRouter();
  const rows = data.map((point) => ({ ...point, label: monthLabel(point.month).replace(/ \d{4}$/, '') }));
  return (
    <div className="h-72" role="img" aria-label="Monthly billing, collection and outstanding">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={chartChrome.grid} vertical={false} />
          <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={52} />
          <Tooltip cursor={chartChrome.cursor} {...chartChrome.tooltip} formatter={tooltipMoney} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="billing"
            name="Billing (net)"
            fill={palette.billing}
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
            cursor="pointer"
            onClick={(entry: { payload?: FlowPoint }) => entry.payload && router.push(`/bill-tracking/bills?fy=${fy}&from=${entry.payload.month}-01&to=${entry.payload.month}-31`)}
          />
          <Bar dataKey="collection" name="Collection" fill={palette.collection} radius={[4, 4, 0, 0]} maxBarSize={22} cursor="pointer" onClick={() => router.push(`/bill-tracking/reports/collections?fy=${fy}`)} />
          <Line type="monotone" dataKey="outstanding" name="Outstanding (month end)" stroke={palette.outstanding} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  href: string;
}

/** Horizontal ranked bars of one measure — projects, clients, bill types. */
export function RankedBars({ data, height, valueLabel }: { data: BarDatum[]; height?: number; valueLabel: string }) {
  const palette = useBtPalette();
  const router = useRouter();
  const rows = data.filter((row) => row.value !== 0);
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">Nothing outstanding for the selected filters.</p>;
  return (
    <div style={{ height: height ?? Math.max(160, rows.length * 34 + 20) }} role="img" aria-label={valueLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartChrome.grid} horizontal={false} />
          <XAxis type="number" stroke={chartChrome.axis} fontSize={11} tickLine={false} tickFormatter={axisMoney} />
          <YAxis type="category" dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} width={150} tickFormatter={(value: string) => (value.length > 22 ? `${value.slice(0, 21)}…` : value)} />
          <Tooltip cursor={chartChrome.cursor} {...chartChrome.tooltip} formatter={(value) => [formatINR(Number(value)), valueLabel]} />
          <Bar dataKey="value" fill={palette.single} radius={[0, 4, 4, 0]} maxBarSize={20} cursor="pointer" onClick={(entry: { payload?: BarDatum }) => entry.payload && router.push(entry.payload.href)}>
            <LabelList dataKey="value" position="right" formatter={(value: number) => formatINRCompact(value)} style={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface AgeingDatum {
  label: string;
  amount: number;
  count: number;
}

/** Outstanding by ageing bucket, darker = older. Each bar opens Outstanding filtered to its bucket. */
export function AgeingChart({ data, fy, asOf }: { data: AgeingDatum[]; fy: string; asOf: string }) {
  const palette = useBtPalette();
  const router = useRouter();
  return (
    <div className="h-64" role="img" aria-label="Outstanding by ageing bucket">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartChrome.grid} vertical={false} />
          <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={52} />
          <Tooltip cursor={chartChrome.cursor} {...chartChrome.tooltip} formatter={(value, _name, item) => [`${formatINR(Number(value))} · ${(item.payload as AgeingDatum).count} bills`, 'Outstanding']} labelFormatter={(label) => `${label} days`} />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={48} cursor="pointer" onClick={(entry: { payload?: AgeingDatum }) => entry.payload && router.push(`/bill-tracking/outstanding?fy=${fy}&ageing=${encodeURIComponent(entry.payload.label)}&asOf=${asOf}`)}>
            {data.map((row, index) => (
              <Cell key={row.label} fill={palette.ageing[Math.min(index, palette.ageing.length - 1)]} stroke={chartChrome.surface} strokeWidth={2} />
            ))}
            <LabelList dataKey="amount" position="top" formatter={(value: number) => (value ? formatINRCompact(value) : '')} style={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface TargetDatum {
  week: string;
  target: number;
  actual: number;
  achievement: number | null;
}

export function TargetActualChart({ data }: { data: TargetDatum[] }) {
  const palette = useBtPalette();
  const router = useRouter();
  const rows = data.map((row) => ({ ...row, label: row.week.replace(/^\d{4}-/, '') }));
  if (!rows.some((row) => row.target || row.actual)) return <p className="py-8 text-center text-sm text-muted-foreground">No targets or collections in these weeks. Set weekly targets on the Targets page.</p>;
  return (
    <div className="h-64" role="img" aria-label="Weekly collection target versus actual">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={chartChrome.grid} vertical={false} />
          <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={52} />
          <Tooltip
            cursor={chartChrome.cursor}
            {...chartChrome.tooltip}
            formatter={tooltipMoney}
            labelFormatter={(label, payload) => {
              const row = payload?.[0]?.payload as TargetDatum | undefined;
              return `${label}${row?.achievement !== null && row?.achievement !== undefined ? ` · ${row.achievement}% achieved` : ''}`;
            }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="target" name="Target" fill={palette.billing} radius={[4, 4, 0, 0]} maxBarSize={18} cursor="pointer" onClick={() => router.push('/bill-tracking/targets')} />
          <Bar dataKey="actual" name="Actual" fill={palette.collection} radius={[4, 4, 0, 0]} maxBarSize={18} cursor="pointer" onClick={() => router.push('/bill-tracking/targets')} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Held vs released retention as one proportional bar with direct labels. */
export function RetentionBar({ released, balance, href }: { released: number; balance: number; href: string }) {
  const palette = useBtPalette();
  const router = useRouter();
  const total = released + balance;
  const releasedPct = total > 0 ? Math.max(0, Math.min(100, (released / total) * 100)) : 0;
  return (
    <button type="button" onClick={() => router.push(href)} className="block w-full text-left" aria-label="Open the retention ledger">
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded">
        <div style={{ width: `${releasedPct}%`, background: palette.collection }} className="h-full rounded-l" />
        <div style={{ width: `${100 - releasedPct}%`, background: palette.outstanding }} className="h-full rounded-r" />
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-700">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: palette.collection }} />
          Released {formatINRCompact(released)} ({releasedPct.toFixed(0)}%)
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: palette.outstanding }} />
          Held {formatINRCompact(balance)}
        </span>
      </div>
    </button>
  );
}
