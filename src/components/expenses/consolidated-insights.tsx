'use client';

/**
 * The pieces of the Consolidated Expenses page that sit above the register
 * (expense-register.module.css): the hero's figure tiles and the three insight cards — where the
 * money went by department, where it is booked by head of A/c, and what in the register is worth a
 * second look.
 *
 * Presentational only: the page works the numbers out from the requests in view and hands them in.
 */

import type { CSSProperties, ReactNode } from 'react';
import { BarChart3, LayoutGrid, TriangleAlert, type LucideIcon } from 'lucide-react';
import { formatInr } from '@/lib/bank-balance-ledger';
import { cn } from '@/lib/utils';
import type { ProgressTone } from '@/lib/requisition-progress';
import styles from './expense-register.module.css';

export { styles as cx };

/* ── colour ─────────────────────────────────────────────────────────────────────────────────────── */

/** A light and a strong shade; everything coloured on the page is tinted from the pair. */
export type AccentPair = readonly [light: string, strong: string];

export const PALETTE = {
  blue: ['#93c5fd', '#2563eb'],
  emerald: ['#6ee7b7', '#059669'],
  cyan: ['#67e8f9', '#0e7490'],
  violet: ['#c4b5fd', '#7c3aed'],
  amber: ['#fcd34d', '#d97706'],
  pink: ['#f9a8d4', '#db2777'],
  indigo: ['#a5b4fc', '#4f46e5'],
  teal: ['#5eead4', '#0d9488'],
  rose: ['#fda4af', '#e11d48'],
  lime: ['#bef264', '#65a30d'],
  orange: ['#fdba74', '#ea580c'],
  slate: ['#cbd5e1', '#64748b'],
} as const satisfies Record<string, AccentPair>;

/** Departments take these in turn, by name, so a department keeps its colour whatever is filtered. */
export const DEPARTMENT_ACCENTS: readonly AccentPair[] = [
  PALETTE.blue,
  PALETTE.emerald,
  PALETTE.cyan,
  PALETTE.violet,
  PALETTE.amber,
  PALETTE.pink,
  PALETTE.indigo,
  PALETTE.teal,
  PALETTE.orange,
  PALETTE.lime,
  PALETTE.rose,
];

/** Bars in "By head of A/c", largest first. */
const HEAD_ACCENTS: readonly AccentPair[] = [
  PALETTE.emerald,
  PALETTE.violet,
  PALETTE.amber,
  PALETTE.blue,
  PALETTE.pink,
  PALETTE.cyan,
  PALETTE.slate,
];

/** The status-badge tones (src/lib/status-tone.ts) as accents. */
export const TONE_ACCENT: Record<ProgressTone, AccentPair> = {
  neutral: PALETTE.slate,
  info: PALETTE.blue,
  progress: PALETTE.violet,
  success: PALETTE.emerald,
  warning: PALETTE.amber,
  danger: PALETTE.rose,
};

/** `--a` / `--b` for an accent, plus any other custom properties the element reads. */
export const accentVars = (accent: AccentPair, extra?: Record<string, string>): CSSProperties =>
  ({ '--a': accent[0], '--b': accent[1], ...extra }) as CSSProperties;

/** A department's short code for its swatch: "IT", "HR", "FIN", "PRO"; initials for several words. */
export function departmentCode(name: string): string {
  const words = name.trim().split(/[\s&/-]+/).filter(Boolean);
  if (!words.length) return '—';
  if (words.length > 1) return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
  return words[0].slice(0, 3).toUpperCase();
}

/* ── hero figures ──────────────────────────────────────────────────────────────────────────────── */

export function KpiTile({
  icon: Icon,
  accent,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  accent: AccentPair;
  label: string;
  value: ReactNode;
  note: ReactNode;
}) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiIcon} style={accentVars(accent)} aria-hidden="true">
        <Icon />
      </span>
      <div className={styles.kpiText}>
        <span className={styles.kpiLabel}>{label}</span>
        <b className={cn(styles.kpiValue, styles.num)}>{value}</b>
        <span className={styles.kpiNote}>{note}</span>
      </div>
    </div>
  );
}

/* ── cards ─────────────────────────────────────────────────────────────────────────────────────── */

export function InsightCard({
  icon: Icon,
  accent,
  title,
  note,
  aside,
  children,
  className,
  bodyClassName,
}: {
  icon: LucideIcon;
  accent: AccentPair;
  title: ReactNode;
  note?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn(styles.card, className)}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} style={accentVars(accent)} aria-hidden="true">
          <Icon />
        </span>
        <div className={styles.cardTitleBlock}>
          <h2 className={styles.cardTitle}>{title}</h2>
          {note && <p className={styles.cardNote}>{note}</p>}
        </div>
        {aside}
      </div>
      <div className={cn(styles.cardBody, bodyClassName)}>{children}</div>
    </section>
  );
}

export interface DepartmentShare {
  name: string;
  code: string;
  accent: AccentPair;
  amount: number;
  count: number;
}

/** Where the money went, by the department that raised it. Picking one filters the register. */
export function ByDepartmentCard({
  items,
  total,
  selected,
  onSelect,
}: {
  items: DepartmentShare[];
  total: number;
  /** The department the register is filtered to, or `'all'`. */
  selected: string;
  onSelect: (name: string) => void;
}) {
  const share = (amount: number) => (total > 0 ? (amount / total) * 100 : 0);
  return (
    <InsightCard icon={LayoutGrid} accent={PALETTE.violet} title="By department" note="Pick one to filter the register">
      {items.length === 0 || total <= 0 ? (
        <p className={styles.empty}>No requests in view.</p>
      ) : (
        <>
          <div className={styles.stack}>
            {items.map(item => (
              <button
                key={item.name}
                type="button"
                className={styles.stackSeg}
                style={{ ...accentVars(item.accent), width: `${share(item.amount)}%` }}
                title={`${item.name} · ${formatInr(item.amount, 0)}`}
                aria-label={`Filter to ${item.name}, ${formatInr(item.amount, 0)}`}
                onClick={() => onSelect(item.name)}
              />
            ))}
          </div>
          <div className={styles.deptList}>
            {items.map(item => (
              <button
                key={item.name}
                type="button"
                className={cn(styles.deptRow, selected === item.name && styles.deptRowOn)}
                style={accentVars(item.accent)}
                aria-pressed={selected === item.name}
                onClick={() => onSelect(item.name)}
              >
                <span className={styles.swatch} aria-hidden="true">
                  {item.code}
                </span>
                <span className={styles.deptName}>
                  {item.name}{' '}
                  <small>
                    · {item.count} request{item.count === 1 ? '' : 's'}
                  </small>
                </span>
                <span className={cn(styles.deptValue, styles.num)}>{formatInr(item.amount, 0)}</span>
                <span className={cn(styles.deptShare, styles.num)}>{Math.round(share(item.amount))}%</span>
              </button>
            ))}
          </div>
        </>
      )}
    </InsightCard>
  );
}

/** Where the money is booked. The page passes the largest heads, the rest folded into one line. */
export function ByHeadCard({ items }: { items: { name: string; amount: number }[] }) {
  const max = Math.max(1, ...items.map(item => item.amount));
  return (
    <InsightCard icon={BarChart3} accent={PALETTE.amber} title="By head of A/c" note="Where the money is booked">
      {items.length === 0 ? (
        <p className={styles.empty}>No requests in view.</p>
      ) : (
        items.map((item, index) => (
          <div key={item.name} className={styles.barRow} style={accentVars(HEAD_ACCENTS[index % HEAD_ACCENTS.length])}>
            <span className={styles.barLabel} title={item.name}>
              {item.name}
            </span>
            <span className={styles.barTrack} aria-hidden="true">
              <i className={styles.barFill} style={{ width: `${(item.amount / max) * 100}%` }} />
            </span>
            <b className={cn(styles.barValue, styles.num)}>{formatInr(item.amount, 0)}</b>
          </div>
        ))
      )}
    </InsightCard>
  );
}

export interface RegisterFlag {
  key: string;
  accent: AccentPair;
  icon: LucideIcon;
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}

/** Things in the register worth a second look — each with the one click that shows them. */
export function WorthALookCard({ flags }: { flags: RegisterFlag[] }) {
  return (
    <InsightCard icon={TriangleAlert} accent={PALETTE.rose} title="Worth a look" note="Things the register spotted">
      {flags.length === 0 ? (
        <p className={styles.empty}>Nothing unusual.</p>
      ) : (
        flags.map(flag => (
          <div key={flag.key} className={styles.flag} style={accentVars(flag.accent)}>
            <span className={styles.flagIcon} aria-hidden="true">
              <flag.icon />
            </span>
            <div className={styles.flagText}>
              <b className={styles.flagTitle}>{flag.title}</b>
              <span className={styles.flagDetail}>{flag.detail}</span>
            </div>
            {flag.action && (
              <button type="button" className={styles.flagBtn} onClick={flag.action.onClick}>
                {flag.action.label}
              </button>
            )}
          </div>
        ))
      )}
    </InsightCard>
  );
}
