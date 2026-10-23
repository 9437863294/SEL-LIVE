'use client';

/**
 * Trip-claims dashboard charts.
 *
 * Colours are the app's validated finance palette (as Bill Tracking uses it), switched for dark
 * mode: one hue for a single measure, and the blue/green pair for own vs company vehicles. The
 * green sits under 3:1 against the light surface, so the split always carries visible text labels.
 * Text stays in the ink colours; colour only marks the bars.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '@/components/theme/ThemeProvider';
import { chartChrome } from '@/components/ui/chart';
import { formatINR, formatINRCompact } from '@/lib/employee-trips/rates';
import { formatKm } from '@/lib/employee-trips/types';
import type { Tally, TrendPoint } from './trip-api';

const PALETTE = {
  light: { single: '#2a78d6', own: '#2a78d6', company: '#1baf7a' },
  dark: { single: '#3987e5', own: '#3987e5', company: '#199e70' },
} as const;

function useTripPalette() {
  const { resolvedMode } = useTheme();
  return PALETTE[resolvedMode === 'dark' ? 'dark' : 'light'];
}

const monthName = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });

export function ChartCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {description ? <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p> : null}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

/** Reimbursement per month — one measure, one hue. A table of the same figures sits behind it for screen readers. */
export function MonthlyAmountChart({ points, label }: { points: TrendPoint[]; label: string }) {
  const palette = useTripPalette();
  const rows = points.map((point) => ({ ...point, name: monthName(point.month) }));
  if (!points.some((point) => point.amount > 0)) return <p className="py-10 text-center text-sm text-muted-foreground">No trips in the last six months.</p>;
  return (
    <>
      <div className="h-56" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={chartChrome.grid} vertical={false} />
            <XAxis dataKey="name" stroke={chartChrome.axis} fontSize={11} tickLine={false} />
            <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => formatINRCompact(value).replace('₹', '')} />
            <Tooltip
              cursor={chartChrome.cursor}
              {...chartChrome.tooltip}
              formatter={(value, _name, item) => {
                const point = item?.payload as TrendPoint | undefined;
                return [`${formatINR(Number(value))} · ${formatKm(point?.km)} · ${point?.trips ?? 0} trips`, 'Reimbursement'];
              }}
            />
            <Bar dataKey="amount" fill={palette.single} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Trips</th>
            <th>Distance</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.month}>
              <td>{point.month}</td>
              <td>{point.trips}</td>
              <td>{formatKm(point.km)}</td>
              <td>{formatINR(point.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Kilometres on own vs company vehicles: one bar in two parts, each labelled with its figure. */
export function OwnershipSplit({ own, company }: { own: number; company: number }) {
  const palette = useTripPalette();
  const total = own + company;
  if (!total) return <p className="py-6 text-center text-sm text-muted-foreground">No kilometres yet.</p>;
  const ownShare = Math.round((own / total) * 100);
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Own vehicle ${formatKm(own)}, company vehicle ${formatKm(company)}`}>
        {own > 0 && <div className="h-full rounded-l-full" style={{ width: `${(own / total) * 100}%`, backgroundColor: palette.own, borderTopRightRadius: company ? 0 : 9999, borderBottomRightRadius: company ? 0 : 9999 }} title={`Own vehicle: ${formatKm(own)}`} />}
        {company > 0 && <div className="h-full rounded-r-full" style={{ width: `${(company / total) * 100}%`, backgroundColor: palette.company, borderTopLeftRadius: own ? 0 : 9999, borderBottomLeftRadius: own ? 0 : 9999 }} title={`Company vehicle: ${formatKm(company)}`} />}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-start gap-2">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: palette.own }} aria-hidden />
          <div>
            <dt className="text-xs text-muted-foreground">Own vehicle</dt>
            <dd className="font-semibold tabular-nums text-slate-800">{formatKm(own)} <span className="text-xs font-normal text-muted-foreground">· {ownShare}%</span></dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: palette.company }} aria-hidden />
          <div>
            <dt className="text-xs text-muted-foreground">Company vehicle</dt>
            <dd className="font-semibold tabular-nums text-slate-800">{formatKm(company)} <span className="text-xs font-normal text-muted-foreground">· {100 - ownShare}%</span></dd>
          </div>
        </div>
      </dl>
    </div>
  );
}

/** Ranked amounts (projects, employees) as thin bars, the figure beside each in text. */
export function RankedAmounts({ rows, empty }: { rows: Tally[]; empty: string }) {
  const palette = useTripPalette();
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.amount), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} title={`${row.label}: ${formatINR(row.amount)} · ${formatKm(row.km)} · ${row.trips} trips`}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <p className="truncate text-xs font-medium text-slate-700">{row.label}</p>
            <p className="shrink-0 text-xs font-semibold tabular-nums text-slate-800">{formatINRCompact(row.amount)}</p>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${(row.amount / max) * 100}%`, backgroundColor: palette.single }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
