'use client';

/**
 * Fleet Control's charts and panels.
 *
 * One measure per chart (km), so one hue: the app's validated single-series blue, stepped for dark
 * mode (checked with the dataviz validator against both surfaces — lightness band, chroma, 3:1
 * contrast). The `--chart-*` tokens are dark-only and would draw nothing in the light default, so
 * the colours are written out. Figures and labels stay in the ink colours; colour only marks bars.
 * Each chart has a screen-reader table of the same figures.
 */

import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme/ThemeProvider';
import { chartChrome } from '@/components/ui/chart';
import { shortDateLabel } from '@/lib/fleet/dates';
import { formatKm } from '@/lib/fleet/types';

const PALETTE = {
  light: { single: '#2a78d6' },
  dark: { single: '#3987e5' },
} as const;

function useFleetPalette() {
  const { resolvedMode } = useTheme();
  return PALETTE[resolvedMode === 'dark' ? 'dark' : 'light'];
}

/** A titled white panel: the dashboard's unit of layout. */
export function FleetPanel({ title, description, actions, children, className }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ${className ?? ''}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {description ? <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="min-w-0 flex-1 p-4">{children}</div>
    </section>
  );
}

/** A load that failed for a reason other than access (network, server): say so and offer a retry. */
export function FleetLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-8 text-center">
      <p className="text-sm text-rose-800">{message}</p>
      <Button type="button" variant="outline" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
        Try again
      </Button>
    </div>
  );
}

const compactKm = (value: number) => (value >= 1000 ? `${Math.round(value / 100) / 10}K` : String(Math.round(value)));

/** Billable km per day for the last fortnight (a trip over midnight counts on both days). */
export function KmByDayChart({ points, today }: { points: Array<{ dateKey: string; km: number; trips: number }>; today: string }) {
  const palette = useFleetPalette();
  const rows = points.map((point) => ({ ...point, name: String(Number(point.dateKey.slice(8, 10))) }));
  const label = 'Fleet km by day, last 14 days';
  if (!points.some((point) => point.km > 0)) return <p className="py-10 text-center text-sm text-muted-foreground">No fleet running in the last 14 days.</p>;
  return (
    <>
      <div className="h-56" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={chartChrome.grid} vertical={false} />
            <XAxis dataKey="name" stroke={chartChrome.axis} fontSize={11} tickLine={false} interval={0} />
            <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} width={40} tickFormatter={(value: number) => compactKm(value)} />
            <Tooltip
              cursor={chartChrome.cursor}
              {...chartChrome.tooltip}
              labelFormatter={(_label, payload) => {
                const point = payload?.[0]?.payload as { dateKey?: string } | undefined;
                return point?.dateKey ? shortDateLabel(point.dateKey, today) : '';
              }}
              formatter={(value, _name, item) => {
                const point = item?.payload as { trips?: number } | undefined;
                return [`${formatKm(Number(value))} · ${point?.trips ?? 0} trip${point?.trips === 1 ? '' : 's'} started`, 'Running'];
              }}
            />
            <Bar dataKey="km" fill={palette.single} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Km</th>
            <th>Trips started</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.dateKey}>
              <td>{point.dateKey}</td>
              <td>{formatKm(point.km)}</td>
              <td>{point.trips}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Ranked km (vehicles, projects) as thin bars, the figure beside each in text. */
export function RankedKm({ rows, empty }: { rows: Array<{ key: string; label: string; km: number; trips: number }>; empty: string }) {
  const palette = useFleetPalette();
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.km), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key} title={`${row.label}: ${formatKm(row.km)} · ${row.trips} trip${row.trips === 1 ? '' : 's'}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-xs font-medium text-slate-700">{row.label}</span>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-800">
              {formatKm(row.km)} <span className="font-normal text-muted-foreground">· {row.trips}</span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${(row.km / max) * 100}%`, backgroundColor: palette.single }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
