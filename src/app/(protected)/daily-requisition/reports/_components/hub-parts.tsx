'use client';

/**
 * Pieces of the Reports hub (../page.tsx): the small charts on each report's card, and what the hub
 * remembers for this person in this browser — the reports they pinned, and the reports they last
 * exported (recorded by report-kit's ExportExcelButton). Both are conveniences: kept in
 * localStorage, read safely, and the hub works the same without them.
 */

import { useMemo, useSyncExternalStore } from 'react';

/* ── remembered in this browser ─────────────────────────────────────────── */

export const PINNED_KEY = 'sel.dailyRequisition.reports.pinned';
export const EXPORTED_KEY = 'sel.dailyRequisition.reports.exported';
const CHANGED = 'sel-dr-reports-store';

function readRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

function parse(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: the hub simply does not remember.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The reports pinned here, by key, and a way to pin or unpin one. */
export function usePinnedReports(): [string[], (key: string) => void] {
  const raw = useSyncExternalStore(subscribe, () => readRaw(PINNED_KEY), () => '');
  const pins = useMemo(() => {
    const value = parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }, [raw]);
  const toggle = (key: string) => write(PINNED_KEY, pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key]);
  return [pins, toggle];
}

export interface ExportedReport {
  /** The page it was exported from. */
  path: string;
  /** When, epoch ms. */
  at: number;
}

/** The reports last exported in this browser, newest first. */
export function useExportedReports(): ExportedReport[] {
  const raw = useSyncExternalStore(subscribe, () => readRaw(EXPORTED_KEY), () => '');
  return useMemo(() => {
    const value = parse(raw);
    return Array.isArray(value)
      ? value.filter((v): v is ExportedReport => typeof v?.path === 'string' && typeof v?.at === 'number').slice(0, 6)
      : [];
  }, [raw]);
}

/** Notes an export from this page, for the hub's "Recently exported". */
export function recordExport(path: string) {
  if (typeof window === 'undefined') return;
  const value = parse(readRaw(EXPORTED_KEY));
  const list = Array.isArray(value) ? (value as ExportedReport[]) : [];
  write(EXPORTED_KEY, [{ path, at: Date.now() }, ...list.filter((item) => item?.path !== path)].slice(0, 12));
}

/* ── the cards' small charts ────────────────────────────────────────────── */

const FONT = { fontFamily: 'inherit', fontWeight: 700 } as const;

/** Labelled horizontal bars, longest at full width. */
export function MiniBars({ rows, colour }: { rows: Array<{ label?: string; value: number; colour?: string }>; colour: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const labelled = rows.some((r) => r.label);
  const x0 = labelled ? 34 : 4;
  const width = 146 - x0;
  const gap = rows.length > 4 ? 18 : 22;
  return (
    <svg viewBox="0 0 150 96" className="h-24 w-full" aria-hidden>
      {rows.map((row, i) => (
        <g key={i}>
          {row.label && (
            <text x="0" y={16 + i * gap} fontSize="9" fill="#64748b" style={FONT}>
              {row.label}
            </text>
          )}
          <rect x={x0} y={8 + i * gap} width={width} height="11" rx="5" fill="#eef2f7" />
          <rect x={x0} y={8 + i * gap} width={Math.max(row.value > 0 ? 4 : 0, (row.value / max) * width)} height="11" rx="5" fill={row.colour ?? colour} opacity={row.colour ? 1 : 1 - i * 0.14} />
        </g>
      ))}
    </svg>
  );
}

/** Labelled columns from a shared baseline. */
export function MiniColumns({ bars }: { bars: Array<{ label: string; value: number; colour: string }> }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const step = 144 / bars.length;
  return (
    <svg viewBox="0 0 150 96" className="h-24 w-full" aria-hidden>
      {bars.map((bar, i) => {
        const h = bar.value > 0 ? Math.max(3, (bar.value / max) * 70) : 2;
        return (
          <g key={bar.label}>
            <rect x={6 + i * step + step * 0.14} y={80 - h} width={step * 0.72} height={h} rx="5" fill={bar.colour} opacity={bar.value > 0 ? 1 : 0.35} />
            <text x={6 + i * step + step / 2} y="93" textAnchor="middle" fontSize="8" fill="#64748b" style={FONT}>
              {bar.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** A filled line over the months, the last point marked. */
export function MiniArea({ values, colour, id }: { values: number[]; colour: string; id: string }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? 142 / (values.length - 1) : 0;
  const points = values.map((v, i) => [4 + i * step, 86 - (v / max) * 72] as const);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg viewBox="0 0 150 96" className="h-24 w-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity=".35" />
          <stop offset="1" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      {points.length > 1 && (
        <>
          <path d={`${line} V92 H4Z`} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke={colour} strokeWidth="2.4" strokeLinejoin="round" />
        </>
      )}
      {last && <circle cx={last[0]} cy={last[1]} r="3.5" fill="#fff" stroke={colour} strokeWidth="2" />}
    </svg>
  );
}

/** A ring of parts, with its key beside it. */
export function MiniDonut({ parts }: { parts: Array<{ label: string; value: number; colour: string }> }) {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  let start = 0;
  const r = 38;
  return (
    <svg viewBox="0 0 150 96" className="h-24 w-full" aria-hidden>
      <g transform="translate(48 48)">
        {total <= 0 ? (
          <circle r={r} fill="#eef2f7" />
        ) : (
          parts.map((part) => {
            const share = Math.max(0, part.value) / total;
            if (share <= 0) return null;
            if (share >= 0.9999) return <circle key={part.label} r={r} fill={part.colour} />;
            const a0 = start * 2 * Math.PI;
            const a1 = (start + share) * 2 * Math.PI;
            start += share;
            const d = `M0 0 L${(Math.sin(a0) * r).toFixed(2)} ${(-Math.cos(a0) * r).toFixed(2)} A${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${(Math.sin(a1) * r).toFixed(2)} ${(-Math.cos(a1) * r).toFixed(2)}Z`;
            return <path key={part.label} d={d} fill={part.colour} />;
          })
        )}
        <circle r="20" fill="#fff" />
      </g>
      {parts.map((part, i) => (
        <g key={part.label}>
          <rect x="102" y={18 + i * 16} width="8" height="8" rx="2" fill={part.colour} />
          <text x="114" y={25 + i * 16} fontSize="9" fill="#475569" style={FONT}>
            {part.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
