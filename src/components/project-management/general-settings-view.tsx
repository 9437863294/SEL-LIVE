"use client";

/**
 * Settings › General Settings, from the user's mock-up (`sel-pm-projects-settings`): a slate band,
 * then one card per module-wide default — what it does, a − value + stepper held to its limits, a
 * "was N" mark once changed, and a small picture of what the number means — and a dark save bar
 * that appears with the first change.
 *
 * Props-only: the page loads the stored values, checks and writes them (`onSave`) and decides
 * permissions, so this view can be rendered with fabricated data.
 */

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BarChart3, Check, Clock, Loader2, Minus, Percent, Plus, Settings2, Truck, type LucideIcon } from "lucide-react";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { HERO_PRIMARY_BUTTON, HeroBand } from "@/components/project-management/hero-band";
import { DprGradientChip, DprReportCallout } from "@/components/project-management/dpr/reports-parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface GeneralSettingsValues {
  variationTolerancePct: number;
  plausibilityLimitPct: number;
  leadTimeDays: number;
  stallDays: number;
}

export interface GeneralSettingsViewProps {
  /** What is stored (or the built-in defaults, before anything is saved). */
  saved: GeneralSettingsValues;
  canEdit: boolean;
  /** Writes the values; resolves true when they saved. */
  onSave: (values: GeneralSettingsValues) => Promise<boolean>;
}

type Key = keyof GeneralSettingsValues;

interface SettingDef {
  key: Key;
  title: string;
  body: (colour: string) => ReactNode;
  label: string;
  unit: string;
  min: number;
  max?: number;
  step: number;
  /** Message for a value outside the limits. */
  rangeMessage: string;
  icon: LucideIcon;
  colours: readonly [string, string];
}

const inlineLink = (href: string, text: string, colour: string) => (
  <Link
    href={href}
    className="font-bold underline underline-offset-2"
    style={{ color: colour, textDecorationColor: colour }}
  >
    {text}
  </Link>
);

/** The page's four defaults, with the limits its save checks hold them to. */
const SETTINGS: readonly SettingDef[] = [
  {
    key: "variationTolerancePct",
    title: "Variation Order Tolerance",
    body: (colour) => (
      <>
        When a surveyed or required quantity exceeds a BOQ item&apos;s stated quantity by more than this
        percentage, it can&apos;t be indented, ordered, or billed until an approved{" "}
        {inlineLink("/project-management/boq/variation-orders", "variation order", colour)} covers the excess.
      </>
    ),
    label: "Tolerance",
    unit: "%",
    min: 0,
    max: 100,
    step: 0.5,
    rangeMessage: "Enter a tolerance between 0 and 100.",
    icon: Percent,
    colours: ["#fda4af", "#e11d48"],
  },
  {
    key: "plausibilityLimitPct",
    title: "Survey Plausibility Limit",
    body: () => (
      <>
        A surveyed quantity deviating from the BOQ by more than this percentage is treated as a likely
        measurement error rather than a real variation — it&apos;s blocked pending re-survey instead of being
        approved.
      </>
    ),
    label: "Plausibility Limit",
    unit: "%",
    min: 1,
    step: 10,
    rangeMessage: "Enter a plausibility limit of 1 or more.",
    icon: BarChart3,
    colours: ["#c4b5fd", "#7c3aed"],
  },
  {
    key: "leadTimeDays",
    title: "Procurement Lead Time",
    body: (colour) => (
      <>
        Default total lead time (RFQ → quotes → PO → manufacturing → inspection → dispatch → transit) used by
        the {inlineLink("/project-management/requirement-planner", "Requirement Planner", colour)} to
        back-calculate each BOQ line&apos;s indent-by date from its required-at-site date.
      </>
    ),
    label: "Lead Time",
    unit: "days",
    min: 0,
    step: 1,
    rangeMessage: "Enter a lead time of 0 days or more.",
    icon: Truck,
    colours: ["#7dd3fc", "#0284c7"],
  },
  {
    key: "stallDays",
    title: "Stall Threshold",
    body: () => (
      <>
        How many days a waiting record (an RFQ sent, an inspection or MDCC requested, a DI issued, an MVAC with
        the client) may age before the project control tower reports it as stalled.
      </>
    ),
    label: "Stall Threshold",
    unit: "days",
    min: 1,
    step: 1,
    rangeMessage: "Enter a stall threshold of at least 1 day.",
    icon: Clock,
    colours: ["#fcd34d", "#d97706"],
  },
];

const KEYS = SETTINGS.map((setting) => setting.key);
const fmt = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);

/** "#e11d48" → "rgba(225, 29, 72, 0.1)": a tint without color-mix (Chrome 109). */
const tint = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const readValue = (text: string, def: SettingDef): number | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < def.min || (def.max !== undefined && value > def.max)) return null;
  return value;
};

export function GeneralSettingsView({ saved, canEdit, onSave }: GeneralSettingsViewProps) {
  const back = useBackNavigation("/project-management/settings", { fallbackLabel: "Settings" });
  const toDraft = (values: GeneralSettingsValues) =>
    Object.fromEntries(KEYS.map((key) => [key, String(values[key])])) as Record<Key, string>;
  const [draft, setDraft] = useState<Record<Key, string>>(() => toDraft(saved));
  const [isSaving, setIsSaving] = useState(false);

  const parsed = useMemo(
    () => Object.fromEntries(SETTINGS.map((def) => [def.key, readValue(draft[def.key], def)])) as Record<Key, number | null>,
    [draft],
  );
  const invalid = SETTINGS.filter((def) => parsed[def.key] === null).map((def) => def.key);
  const changed = KEYS.filter((key) => parsed[key] === null || parsed[key] !== saved[key]);

  const step = (def: SettingDef, direction: -1 | 1) => {
    const current = parsed[def.key] ?? saved[def.key];
    let next = Math.round((current + direction * def.step) * 1000) / 1000;
    next = Math.max(def.min, def.max !== undefined ? Math.min(def.max, next) : next);
    setDraft((previous) => ({ ...previous, [def.key]: String(next) }));
  };

  const save = async () => {
    if (invalid.length > 0) return;
    setIsSaving(true);
    try {
      await onSave(
        Object.fromEntries(KEYS.map((key) => [key, parsed[key] as number])) as unknown as GeneralSettingsValues,
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <HeroBand
        back={back}
        icon={Settings2}
        crumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: "Settings", href: "/project-management/settings" },
        ]}
        title="General Settings"
        description="Module-wide defaults for Project Management."
        band="slate"
      />

      {!canEdit ? (
        <DprReportCallout tone="info" title="You can read these settings but not change them.">
          Ask for the Edit action on Project Management.Settings to change them.
        </DprReportCallout>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SETTINGS.map((def) => {
          const value = parsed[def.key];
          const shown = value ?? saved[def.key];
          const isChanged = value !== null && value !== saved[def.key];
          const error = value === null ? def.rangeMessage : null;
          const [from, to] = def.colours;
          return (
            <section
              key={def.key}
              className="relative min-w-0 overflow-hidden rounded-[22px] border border-border/60 bg-card p-5 shadow-sm"
            >
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundImage: `linear-gradient(90deg, ${from}, ${to})` }}
                aria-hidden="true"
              />
              <div className="flex items-start gap-3">
                <DprGradientChip
                  icon={def.icon}
                  colours={def.colours}
                  className="h-[42px] w-[42px] rounded-[14px] shadow-md"
                  iconClassName="h-5 w-5"
                />
                <div className="min-w-0">
                  <h3 className="text-[15px] font-extrabold">{def.title}</h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{def.body(to)}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label htmlFor={`general-${def.key}`} className="w-full text-xs font-extrabold text-muted-foreground">
                  {def.label} ({def.unit})
                </label>
                <span
                  className={cn(
                    "flex items-center overflow-hidden rounded-[14px] border-[1.5px] bg-background",
                    error ? "border-rose-300" : "",
                  )}
                  style={error ? undefined : { borderColor: tint(to, 0.3) }}
                >
                  <button
                    type="button"
                    className="h-[42px] w-9 text-lg font-extrabold disabled:opacity-40"
                    style={{ backgroundColor: tint(to, 0.08), color: to }}
                    aria-label={`Decrease ${def.label}`}
                    disabled={!canEdit || (value !== null && value <= def.min)}
                    onClick={() => step(def, -1)}
                  >
                    <Minus className="mx-auto h-4 w-4" aria-hidden="true" />
                  </button>
                  <input
                    id={`general-${def.key}`}
                    inputMode={def.step % 1 === 0 ? "numeric" : "decimal"}
                    className="h-[42px] w-20 bg-transparent text-center text-xl font-extrabold tabular-nums outline-none disabled:text-muted-foreground"
                    value={draft[def.key]}
                    disabled={!canEdit}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `general-${def.key}-error` : undefined}
                    onChange={(event) => setDraft((previous) => ({ ...previous, [def.key]: event.target.value }))}
                  />
                  <button
                    type="button"
                    className="h-[42px] w-9 text-lg font-extrabold disabled:opacity-40"
                    style={{ backgroundColor: tint(to, 0.08), color: to }}
                    aria-label={`Increase ${def.label}`}
                    disabled={!canEdit || (value !== null && def.max !== undefined && value >= def.max)}
                    onClick={() => step(def, 1)}
                  >
                    <Plus className="mx-auto h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
                <span className="font-extrabold" style={{ color: to }}>
                  {def.unit}
                </span>
                {isChanged ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-extrabold text-amber-800">
                    was {fmt(saved[def.key])}
                  </span>
                ) : null}
                {error ? (
                  <p id={`general-${def.key}-error`} className="w-full text-[11.5px] font-bold text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>

              <SettingPicture settingKey={def.key} value={shown} colour={to} from={from} />
            </section>
          );
        })}
      </div>

      {canEdit && changed.length > 0 ? (
        <div
          className="keep-light sticky bottom-3 z-10 flex flex-wrap items-center gap-2.5 rounded-2xl px-4 py-3 font-bold text-white shadow-xl"
          style={{ backgroundColor: "#1e1b4b" }}
        >
          <span>
            {changed.length} unsaved change{changed.length === 1 ? "" : "s"}
            {invalid.length > 0 ? " — fix the highlighted value first" : ""}
          </span>
          <span className="flex-1" />
          <Button
            variant="outline"
            className="rounded-xl border-white/40 bg-transparent font-extrabold text-white hover:bg-white/10 hover:text-white"
            disabled={isSaving}
            onClick={() => setDraft(toDraft(saved))}
          >
            Discard
          </Button>
          <Button className={HERO_PRIMARY_BUTTON} disabled={isSaving || invalid.length > 0} onClick={() => void save()}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Save settings
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** What the number means, drawn: the tolerance band, the re-survey bounds, the lead-time chain, the stall clock. */
function SettingPicture({
  settingKey,
  value,
  colour,
  from,
}: {
  settingKey: Key;
  value: number;
  colour: string;
  from: string;
}) {
  const chip = (text: string) => (
    <span
      key={text}
      className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
      style={{ backgroundColor: tint(colour, 0.1), color: colour }}
    >
      {text}
    </span>
  );
  const caption = "mt-1 flex justify-between gap-3 text-[11px] font-bold text-muted-foreground";

  if (settingKey === "variationTolerancePct") {
    // 0 … BOQ 100 … BOQ + tolerance: the first part is the BOQ, the striped part the tolerance.
    const boqShare = 100 / (1 + value / 100);
    return (
      <div className="mt-3">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`BOQ quantity 100, blocked above ${fmt(100 + value)}`}>
          <i
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${boqShare}%`, backgroundImage: `linear-gradient(90deg, ${from}, ${colour})` }}
          />
          <i
            className="absolute inset-y-0"
            style={{
              left: `${boqShare}%`,
              width: `${100 - boqShare}%`,
              backgroundImage: `repeating-linear-gradient(45deg, ${tint(colour, 0.35)}, ${tint(colour, 0.35)} 4px, ${tint(colour, 0.12)} 4px, ${tint(colour, 0.12)} 8px)`,
            }}
          />
        </div>
        <div className={caption}>
          <span>BOQ qty 100</span>
          <span>Blocked above {fmt(100 + value)}</span>
        </div>
      </div>
    );
  }
  if (settingKey === "plausibilityLimitPct") {
    return (
      <p className="mt-3 text-[11px] font-bold text-muted-foreground">
        BOQ 100 → a survey above{" "}
        <b className="font-extrabold" style={{ color: colour }}>
          {fmt(100 + value)}
        </b>
        {value < 100 ? (
          <>
            {" "}
            or below{" "}
            <b className="font-extrabold" style={{ color: colour }}>
              {fmt(100 - value)}
            </b>
          </>
        ) : null}{" "}
        is sent back for re-survey
      </p>
    );
  }
  if (settingKey === "leadTimeDays") {
    const steps = ["RFQ", "quotes", "PO", "manufacturing", "inspection", "dispatch", "transit"];
    return (
      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-1">
          {steps.map((step, index) => (
            <span key={step} className="flex items-center gap-1">
              {index > 0 ? (
                <span className="text-[11px] font-extrabold text-muted-foreground" aria-hidden="true">
                  →
                </span>
              ) : null}
              {chip(step)}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] font-bold text-muted-foreground">
          Needed at site on day 0 → indent by day −{fmt(value)}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1">
        {["RFQ sent", "Inspection / MDCC requested", "DI issued", "MVAC with client"].map(chip)}
      </div>
      <p className="mt-2 text-[11px] font-bold text-muted-foreground">
        Flagged as stalled after {fmt(value)} day{value === 1 ? "" : "s"} waiting
      </p>
    </div>
  );
}
