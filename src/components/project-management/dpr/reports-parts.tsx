"use client";

/**
 * The pieces every report on the Reports screen is built from, after the user's mock-ups
 * (`sel-dpr-reports-manpower-colour`, `sel-dpr-reports-colour`): a gradient icon chip, a figure
 * tile with a tinted corner, a card with its gradient header, a callout in four tones, a pill, and
 * the empty state with its soft glow.
 *
 * Colours are plain hex / rgba — no color-mix(), which Chrome 109 (the Windows 7 PCs) drops
 * silently. Light utility tints (amber-50, rose-50…) are remapped for dark mode by dark-compat.css.
 */

import type { CSSProperties, ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Check, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type DprGradient = readonly [string, string];

/** A rounded square filled with a light-to-dark gradient, an icon in white on it. */
export function DprGradientChip({
  icon: Icon,
  colours,
  className,
  iconClassName,
}: {
  icon: LucideIcon;
  colours: DprGradient;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center text-white", className)}
      style={{ backgroundImage: `linear-gradient(140deg, ${colours[0]}, ${colours[1]})` }}
      aria-hidden="true"
    >
      <Icon className={iconClassName} />
    </span>
  );
}

/** A tinted card corner, as the mock-up's tiles have. */
const corner = (rgb: string): CSSProperties => ({
  backgroundImage: `radial-gradient(200px 110px at 100% 0%, rgba(${rgb}, 0.16), transparent 70%)`,
});

/** "#7c3aed" → "124, 58, 237". */
const rgbOf = (hex: string): string => {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  const n = Number.parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

const ALERT_TILE = {
  warning: { box: "border-amber-200 bg-gradient-to-br from-amber-50 to-transparent", value: "text-amber-700", icon: "text-amber-600" },
  danger: { box: "border-rose-200 bg-gradient-to-br from-rose-50 to-transparent", value: "text-rose-600", icon: "text-rose-600" },
} as const;

/** One headline figure: icon chip, label, value, and a line on what it is. */
export function DprFigureTile({
  icon,
  colours,
  label,
  value,
  detail,
  alert,
  valueClassName,
}: {
  icon: LucideIcon;
  colours: DprGradient;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  /** Draws the tile in a status tone, with an icon beside the detail so it is never colour alone. */
  alert?: "warning" | "danger";
  valueClassName?: string;
}) {
  const tone = alert ? ALERT_TILE[alert] : null;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm",
        tone ? tone.box : "border-border/60",
      )}
      style={tone ? undefined : corner(rgbOf(colours[1]))}
    >
      <DprGradientChip
        icon={icon}
        colours={colours}
        className="h-[46px] w-[46px] rounded-[15px] shadow-md"
        iconClassName="h-[21px] w-[21px]"
      />
      <div className="min-w-0">
        <small className="block text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</small>
        <b
          className={cn(
            "block truncate text-[28px] font-extrabold leading-tight tracking-tight",
            tone?.value,
            valueClassName,
          )}
        >
          {value}
        </b>
        <span className="block truncate text-xs font-semibold text-muted-foreground">
          {tone ? (
            <AlertTriangle className={cn("mr-1 inline h-3 w-3 align-[-1px]", tone.icon)} aria-label="Needs attention" />
          ) : null}
          {detail}
        </span>
      </div>
    </div>
  );
}

/** The row of figure tiles: four across on a wide screen, two on a tablet, one on a phone. */
export function DprFigureRow({ children, columns = 4 }: { children: ReactNode; columns?: 2 | 4 }) {
  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2",
        columns === 4 ? "xl:grid-cols-4" : "",
      )}
    >
      {children}
    </section>
  );
}

/** A report card: a gradient-tinted header (chip, title, subtitle, and anything at its right), then the body. */
export function DprReportCard({
  icon,
  colours,
  title,
  subtitle,
  aside,
  children,
  className,
}: {
  icon: LucideIcon;
  colours: DprGradient;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm", className)}>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border/60 bg-gradient-to-r from-violet-50 to-transparent px-4 py-3 sm:px-5">
        <DprGradientChip icon={icon} colours={colours} className="h-[30px] w-[30px] rounded-[10px]" iconClassName="h-[15px] w-[15px]" />
        <div className="min-w-0 flex-1">
          <b className="block text-sm leading-tight">{title}</b>
          {subtitle ? (
            <small className="block truncate text-[11.5px] text-muted-foreground" title={subtitle}>
              {subtitle}
            </small>
          ) : null}
        </div>
        {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

const CALLOUT = {
  danger: { box: "border-rose-200 bg-gradient-to-r from-rose-50 to-transparent", chip: "bg-rose-600", title: "text-rose-900", icon: AlertCircle },
  warning: { box: "border-amber-200 bg-gradient-to-r from-amber-50 to-transparent", chip: "bg-amber-600", title: "text-amber-900", icon: AlertTriangle },
  success: { box: "border-emerald-200 bg-gradient-to-r from-emerald-50 to-transparent", chip: "bg-emerald-600", title: "text-emerald-900", icon: CheckCircle2 },
  info: { box: "border-slate-200 bg-slate-50", chip: "bg-slate-500", title: "text-slate-700", icon: Info },
} as const;

export type DprCalloutTone = keyof typeof CALLOUT;

/** A finding worth reading: a toned icon chip, a bold line, what it means, and an optional action. */
export function DprReportCallout({
  tone,
  title,
  children,
  action,
}: {
  tone: DprCalloutTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const style = CALLOUT[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-[12.5px]", style.box)}>
      <span
        className={cn("flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg text-white", style.chip)}
        aria-hidden="true"
      >
        <style.icon className="h-[15px] w-[15px]" />
      </span>
      <div className="min-w-0 flex-1">
        <b className={cn("block", style.title)}>{title}</b>
        {children ? <span className="text-muted-foreground">{children}</span> : null}
        {action ? <div className="mt-1.5">{action}</div> : null}
      </div>
    </div>
  );
}

const PILL = {
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-rose-100 text-rose-700",
  success: "bg-emerald-100 text-emerald-700",
  neutral: "bg-muted text-muted-foreground",
} as const;

/** A small count beside a card's title: "0 recorded", "3 hrs". */
export function DprReportPill({ tone, children }: { tone: keyof typeof PILL; children: ReactNode }) {
  return (
    <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-extrabold tabular-nums", PILL[tone])}>
      {children}
    </span>
  );
}

/**
 * A report with nothing in it yet: a large chip over a soft two-colour glow, what would show here,
 * and optionally an "All clear" mark or the steps that fill it.
 */
export function DprReportZero({
  icon,
  colours,
  glow,
  title,
  text,
  clear,
  steps,
}: {
  icon: LucideIcon;
  colours: DprGradient;
  /** Two light tints for the glow behind the chip, as rgba. */
  glow: readonly [string, string];
  title: string;
  text?: string;
  /** An emerald "All clear"-style mark under the title, for a report where nothing is good news. */
  clear?: string;
  steps?: ReadonlyArray<{ text: string; colours: readonly [string, string, string] }>;
}) {
  return (
    <div>
      <div className="relative overflow-hidden px-5 pb-10 pt-11 text-center text-muted-foreground">
        <div
          className="pointer-events-none absolute inset-x-[-10%] top-[-40%] h-[120%] opacity-50"
          style={{
            backgroundImage: `radial-gradient(closest-side, ${glow[0]}, transparent), radial-gradient(closest-side at 70% 60%, ${glow[1]}, transparent)`,
          }}
          aria-hidden="true"
        />
        <div className="relative">
          <DprGradientChip
            icon={icon}
            colours={colours}
            className="mx-auto mb-3 h-[66px] w-[66px] rounded-[20px] shadow-lg"
            iconClassName="h-7 w-7"
          />
          <b className="mb-1 block text-base text-foreground">{title}</b>
          {text ? <p className="mx-auto max-w-[360px] text-[13px]">{text}</p> : null}
          {clear ? (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-700">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {clear}
            </span>
          ) : null}
        </div>
      </div>
      {steps?.length ? (
        <ol className="grid grid-cols-1 gap-3 px-4 pb-4 sm:px-5 sm:pb-5 md:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step.text}
              className="flex items-center gap-2.5 rounded-[14px] border px-3.5 py-3 text-[12.5px] font-semibold text-muted-foreground"
              style={{ backgroundImage: `linear-gradient(135deg, ${step.colours[0]}, transparent)`, borderColor: step.colours[1] }}
            >
              <i
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px] font-extrabold not-italic text-white"
                style={{ backgroundColor: step.colours[2] }}
              >
                {index + 1}
              </i>
              {step.text}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
