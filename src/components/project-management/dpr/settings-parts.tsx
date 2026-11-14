"use client";

/**
 * The pieces of the Daily Progress Settings page, after the user's mock-up
 * (`sel-dpr-register-log-settings`): a titled section with its count pill, the weekly-off day
 * toggles, a tinted limit tile with a large number input, and a list editor of coloured tags.
 *
 * Tints on the limit tiles are low-alpha rgba so they read in both themes (inline styles are not
 * remapped by dark-compat.css); the list tags use light utility tints that dark-compat.css remaps.
 * No color-mix() — Chrome 109 (the Windows 7 PCs) drops it silently.
 */

import { useState, type ReactNode } from "react";
import { History, Plus, X, type LucideIcon } from "lucide-react";
import { DPR_WEEKDAYS } from "@/lib/project-management-dpr-plan";
import { useToast } from "@/hooks/use-toast";
import { InfoTip } from "@/components/shared/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** One block of a settings card: a small heading (with an optional count pill) and its controls. */
export function DprSettingsBlock({
  title,
  htmlFor,
  pill,
  icon,
  tip,
  children,
  className,
}: {
  title: string;
  htmlFor?: string;
  pill?: ReactNode;
  /** A coloured icon chip before the title (the lists). */
  icon?: ReactNode;
  tip?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-border/60 px-4 py-4 last:border-b-0 sm:px-5", className)}>
      <div className="mb-2.5 flex min-w-0 flex-wrap items-center gap-2">
        {icon}
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-[13px] font-bold">
            {title}
          </Label>
        ) : (
          <span className="text-[13px] font-bold">{title}</span>
        )}
        {pill}
        {tip ? <InfoTip label={`About “${title}”`}>{tip}</InfoTip> : null}
      </div>
      {children}
    </div>
  );
}

/** Seven day toggles; a day that is off is filled rose. */
export function DprWeekdayToggles({
  value,
  onToggle,
  disabled,
}: {
  value: readonly number[];
  onToggle: (day: number, off: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekly off days">
      {DPR_WEEKDAYS.map(({ day, label }) => {
        const off = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={off}
            aria-label={`${label}${off ? " — off" : " — working"}`}
            disabled={disabled}
            onClick={() => onToggle(day, !off)}
            className={cn(
              "h-10 w-[52px] rounded-xl border text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
              off
                ? "keep-light border-transparent text-white shadow-sm"
                : "border-border/70 bg-background text-muted-foreground hover:bg-muted/50 disabled:bg-muted/40 disabled:opacity-70",
            )}
            style={off ? { backgroundImage: "linear-gradient(135deg, #fb7185, #e11d48)" } : undefined}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** The four limits' tones: a soft tint for the tile, its border, and the solid icon chip. */
const LIMIT_TONES = {
  rose: { tint: "rgba(244, 63, 94, 0.08)", border: "rgba(244, 63, 94, 0.28)", chip: "#e11d48" },
  amber: { tint: "rgba(245, 158, 11, 0.09)", border: "rgba(245, 158, 11, 0.32)", chip: "#d97706" },
  blue: { tint: "rgba(59, 130, 246, 0.08)", border: "rgba(59, 130, 246, 0.28)", chip: "#2563eb" },
  violet: { tint: "rgba(139, 92, 246, 0.08)", border: "rgba(139, 92, 246, 0.28)", chip: "#7c3aed" },
} as const;
export type DprLimitTone = keyof typeof LIMIT_TONES;

/** One limit: a tinted tile with its icon, label (explanation behind an i), a big number and its unit. */
export function DprLimitTile({
  id,
  label,
  tip,
  hint,
  unit,
  icon: Icon,
  tone,
  value,
  step,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  tip: string;
  hint: string;
  unit: string;
  icon: LucideIcon;
  tone: DprLimitTone;
  value: string;
  step: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const colours = LIMIT_TONES[tone];
  return (
    <div
      className="min-w-0 rounded-2xl border px-3.5 py-3"
      style={{ backgroundImage: `linear-gradient(135deg, ${colours.tint}, transparent)`, borderColor: colours.border }}
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <span
          className="keep-light flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px] text-white"
          style={{ backgroundColor: colours.chip }}
          aria-hidden="true"
        >
          <Icon className="h-[13px] w-[13px]" />
        </span>
        <Label htmlFor={id} className="min-w-0 truncate text-xs font-extrabold text-muted-foreground" title={label}>
          {label}
        </Label>
        <InfoTip label={`About “${label}”`}>{tip}</InfoTip>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-[38px] w-[92px] rounded-[11px] bg-background text-center text-base font-extrabold tabular-nums"
          style={{ borderColor: colours.border }}
        />
        <span className="text-xs font-bold text-muted-foreground">{unit}</span>
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** The six lists' tones, after the mock-up: chip and tags share one light tint and its ink. */
const LIST_TONES = {
  sky: { chip: "bg-sky-100 text-sky-700", tag: "border-sky-200 bg-sky-100 text-sky-700" },
  violet: { chip: "bg-violet-100 text-violet-700", tag: "border-violet-200 bg-violet-100 text-violet-700" },
  blue: { chip: "bg-blue-100 text-blue-700", tag: "border-blue-200 bg-blue-100 text-blue-700" },
  amber: { chip: "bg-amber-100 text-amber-700", tag: "border-amber-200 bg-amber-100 text-amber-800" },
  emerald: { chip: "bg-emerald-100 text-emerald-700", tag: "border-emerald-200 bg-emerald-100 text-emerald-700" },
  pink: { chip: "bg-pink-100 text-pink-700", tag: "border-pink-200 bg-pink-100 text-pink-700" },
} as const;
export type DprListTone = keyof typeof LIST_TONES;

/** A small tinted tag with an optional × to remove it. */
export function DprTag({
  tone,
  children,
  removeLabel,
  onRemove,
  className,
}: {
  tone: DprListTone;
  children: ReactNode;
  /** Shown to screen readers on the × button. */
  removeLabel?: string;
  /** Leave out to hide the × (read-only). */
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 text-xs font-bold",
        onRemove ? "pl-3 pr-1.5" : "px-3",
        LIST_TONES[tone].tag,
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-background/70 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-2.5 w-2.5" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

/**
 * One list of choices offered on the daily sheet: its coloured heading and count, the values as
 * tags, and an input that adds one (Enter adds; a duplicate, ignoring case, is refused with a
 * toast). Values already typed on this project's sheets can be added in one click.
 */
export function DprListEditor({
  id,
  label,
  values,
  onChange,
  placeholder,
  icon: Icon,
  tone,
  readOnly,
  disabled,
  suggestions,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  icon: LucideIcon;
  tone: DprListTone;
  /** No Edit Settings: tags without ×, inputs disabled. */
  readOnly?: boolean;
  /** Briefly off, as while saving. */
  disabled?: boolean;
  /** Values already typed on this project's sheets, offered in one click. */
  suggestions?: readonly string[];
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const locked = readOnly || disabled;
  const missingSuggestions = (suggestions ?? []).filter(
    (suggestion) => !values.some((value) => value.toLowerCase() === suggestion.toLowerCase()),
  );

  const add = () => {
    if (!trimmed || locked) return;
    if (values.some((value) => value.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: `“${trimmed}” is already in the list`, description: label });
      return;
    }
    onChange([...values, trimmed.slice(0, 40)]);
    setText("");
  };

  return (
    <DprSettingsBlock
      title={label}
      htmlFor={id}
      icon={
        <span
          className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", LIST_TONES[tone].chip)}
          aria-hidden="true"
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      }
      pill={
        <span className={cn("rounded-full px-2 py-px text-[10.5px] font-extrabold tabular-nums", LIST_TONES[tone].chip)}>
          {values.length}
        </span>
      }
    >
      {values.length === 0 ? (
        <p className="mb-2.5 text-xs italic text-muted-foreground">None yet.</p>
      ) : (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <DprTag
              key={value}
              tone={tone}
              removeLabel={`Remove ${value}`}
              onRemove={readOnly ? undefined : () => onChange(values.filter((candidate) => candidate !== value))}
            >
              {value}
            </DprTag>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input
          id={id}
          value={text}
          disabled={locked}
          placeholder={placeholder}
          maxLength={40}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className="h-[38px] rounded-[11px]"
        />
        <Button
          type="button"
          variant="outline"
          disabled={locked || !trimmed}
          onClick={add}
          className="h-[38px] rounded-[11px] font-extrabold text-violet-700"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add
        </Button>
      </div>
      {missingSuggestions.length > 0 && !readOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1.5 h-7 px-2 text-xs"
          disabled={disabled}
          title={missingSuggestions.join(", ")}
          onClick={() => onChange([...values, ...missingSuggestions.map((value) => value.slice(0, 40))])}
        >
          <History className="mr-1.5 h-3.5 w-3.5" />
          Add {missingSuggestions.length} used on past sheets
        </Button>
      ) : null}
    </DprSettingsBlock>
  );
}
