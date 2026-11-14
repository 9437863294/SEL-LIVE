"use client";

/**
 * Daily Progress settings — the per-project rules the planning engine and the checks read, laid out
 * after the user's mock-up (`sel-dpr-register-log-settings`): a rose headline band carrying Reset
 * and Save, the working calendar and the limits on the left, the lists offered on the daily sheet
 * on the right.
 *
 * Everything here is stored in one document, `projects/{globalProjectId}/dprSettings/config`, and
 * read through `sanitizeDprSettings`, so a missing or partial document still yields settings every
 * screen can rely on. The defaults (every day working, no tolerance) reproduce how figures were
 * worked out before this page existed, so nothing moves until someone changes a value here.
 *
 * The view takes everything as props — the page only resolves the project and the permissions — so
 * it can be rendered with fabricated data. With no project id the save does nothing.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  CalendarDays,
  Clock,
  CloudSun,
  Database,
  Hash,
  History,
  Info,
  ListChecks,
  Loader2,
  Lock,
  MapPin,
  Percent,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  TrendingUp,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DPR_PERMISSION_RESOURCE,
  DPR_SCOPES,
  dprNumber,
  parseIsoDate,
} from "@/lib/project-management-dpr";
import {
  DPR_SETTINGS_COLLECTION,
  DPR_SETTINGS_DOC_ID,
  DPR_WEEKDAYS,
  dprProjectDates,
  dprSuggestions,
  sanitizeDprSettings,
  type DprHoliday,
  type DprSettings,
} from "@/lib/project-management-dpr-plan";
import type { DprDataState } from "@/components/project-management/dpr/use-dpr-data";
import {
  DPR_TABS,
  DprFieldLabel,
  DprMessages,
  DprPageShell,
  dprHref,
  formatDisplayDate,
} from "@/components/project-management/dpr/dpr-shell";
import {
  DPR_HERO_PRIMARY,
  DPR_HERO_SECONDARY,
  DprReportsHero,
} from "@/components/project-management/dpr/reports-hero";
import { DprReportCard, DprReportPill } from "@/components/project-management/dpr/reports-parts";
import {
  DprLimitTile,
  DprListEditor,
  DprSettingsBlock,
  DprTag,
  DprWeekdayToggles,
  type DprLimitTone,
  type DprListTone,
} from "@/components/project-management/dpr/settings-parts";
import { InfoTip } from "@/components/shared/info-tip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DprSettingsUser {
  id: string;
  name?: string;
  email?: string;
}

const SETTINGS_TAB = DPR_TABS.find((tab) => tab.key === "settings")!;

/** The form as typed. Numbers stay text so a half-typed "0." is not clamped under the cursor. */
interface SettingsForm {
  weeklyOff: number[];
  holidays: DprHoliday[];
  startDate: string;
  endDate: string;
  tolerancePct: string;
  backdateDays: string;
  shiftHours: string;
  spikeMultiple: string;
  wholeNumberUnits: string[];
  weatherOptions: string[];
  trades: string[];
  equipmentTypes: string[];
  locations: string[];
  agencies: string[];
}

const toForm = (settings: DprSettings): SettingsForm => ({
  weeklyOff: [...settings.weeklyOff],
  holidays: settings.holidays.map((holiday) => ({ ...holiday })),
  startDate: settings.startDate,
  endDate: settings.endDate,
  tolerancePct: String(settings.tolerancePct),
  backdateDays: String(settings.backdateDays),
  shiftHours: String(settings.shiftHours),
  spikeMultiple: String(settings.spikeMultiple),
  wholeNumberUnits: [...settings.wholeNumberUnits],
  weatherOptions: [...settings.weatherOptions],
  trades: [...settings.trades],
  equipmentTypes: [...settings.equipmentTypes],
  locations: [...settings.locations],
  agencies: [...settings.agencies],
});

/** The stored shape. `sanitizeDprSettings` then clamps it, exactly as every reader does. */
const fromForm = (form: SettingsForm): DprSettings => sanitizeDprSettings(form);

const readTyped = (text: string): number | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
};

/** What stops a save. Clamping would quietly change a figure, so out-of-range values are refused. */
function validateForm(
  form: SettingsForm,
  projectRecordDates: { startDate: string; endDate: string },
): string[] {
  const errors: string[] = [];
  if (form.weeklyOff.length >= 7) errors.push("Leave at least one working day in the week.");
  const dates = dprProjectDates(form, projectRecordDates);
  if (dates.startDate && dates.endDate && dates.endDate < dates.startDate) {
    errors.push("The project completion date cannot be before its start date.");
  }
  const number = (
    text: string,
    label: string,
    { min, max, whole = false }: { min: number; max: number; whole?: boolean },
  ) => {
    const value = readTyped(text);
    if (value === null || Number.isNaN(value) || value < min || value > max || (whole && !Number.isInteger(value))) {
      errors.push(
        `${label} must be ${whole ? "a whole number " : ""}between ${min} and ${max}.`,
      );
    }
  };
  number(form.tolerancePct, "Tolerance over BOQ quantity", { min: 0, max: 100 });
  number(form.backdateDays, "Backdating allowed", { min: 0, max: 365, whole: true });
  number(form.shiftHours, "Shift length", { min: 1, max: 24 });
  number(form.spikeMultiple, "The multiple of plan that is queried", { min: 1, max: 100 });
  if (form.weatherOptions.length === 0) errors.push("Keep at least one weather option.");
  return errors;
}

type LimitKey = "tolerancePct" | "backdateDays" | "shiftHours" | "spikeMultiple";

const LIMITS: ReadonlyArray<{
  key: LimitKey;
  label: string;
  unit: string;
  hint: string;
  tip: string;
  step: string;
  tone: DprLimitTone;
  icon: LucideIcon;
}> = [
  {
    key: "tolerancePct",
    label: "Tolerance over BOQ quantity",
    unit: "%",
    hint: "0 = no recording past the BOQ quantity.",
    tip: "How far cumulative work, or work still planned, may run past the BOQ quantity before it is refused. 0 means not past the BOQ quantity at all.",
    step: "any",
    tone: "rose",
    icon: Percent,
  },
  {
    key: "backdateDays",
    label: "Backdating allowed",
    unit: "days",
    hint: "How far back a sheet can be filed.",
    tip: "How many days back a sheet may be submitted. Older dates need someone with the DPR Reopen action.",
    step: "1",
    tone: "amber",
    icon: History,
  },
  {
    key: "shiftHours",
    label: "Shift length",
    unit: "hours",
    hint: "The most time a day can lose.",
    tip: "The longest a day's lost time can be.",
    step: "any",
    tone: "blue",
    icon: Clock,
  },
  {
    key: "spikeMultiple",
    label: "Query multiple",
    unit: "× plan",
    hint: "Actuals above this get a query.",
    tip: "An actual more than this many times the day's plan asks the recorder to check the figure before submitting.",
    step: "any",
    tone: "violet",
    icon: TrendingUp,
  },
];

type ListKey = "weatherOptions" | "wholeNumberUnits" | "trades" | "equipmentTypes" | "locations" | "agencies";

const LISTS: ReadonlyArray<{
  key: ListKey;
  id: string;
  label: string;
  placeholder: string;
  tone: DprListTone;
  icon: LucideIcon;
  /** Values typed on past sheets, offered in one click. */
  suggest?: "locations" | "agencies";
}> = [
  { key: "weatherOptions", id: "dpr-weather", label: "Weather options", placeholder: "Add a weather option", tone: "sky", icon: CloudSun },
  { key: "wholeNumberUnits", id: "dpr-whole-units", label: "Units counted in whole numbers", placeholder: "Add a unit (Nos, Set…)", tone: "violet", icon: Hash },
  { key: "trades", id: "dpr-trades", label: "Trades (manpower)", placeholder: "Add a trade (Mason, Fitter…)", tone: "blue", icon: Users },
  { key: "equipmentTypes", id: "dpr-equipment-types", label: "Plant and equipment", placeholder: "Add equipment (Excavator, Crane…)", tone: "amber", icon: Truck },
  { key: "locations", id: "dpr-locations", label: "Locations (work lines)", placeholder: "Add a location (Tower 12, Zone A…)", tone: "emerald", icon: MapPin, suggest: "locations" },
  { key: "agencies", id: "dpr-agencies", label: "Agencies (work lines)", placeholder: "Add an agency (Departmental, a subcontractor…)", tone: "pink", icon: Building2, suggest: "agencies" },
];

export function DprSettingsView({
  data,
  mappingId,
  user,
  canEditSettings,
}: {
  data: DprDataState;
  mappingId: string;
  user: DprSettingsUser | null;
  /** The DPR "Edit Settings" action. Without it every control is read-only. */
  canEditSettings: boolean;
}) {
  const { toast } = useToast();
  const {
    globalProjectId,
    projectName,
    settings,
    settingsSaved,
    projectRecordDates,
    boqLines,
    breakdown,
    entries,
    isLoading,
    loadError,
    reload,
  } = data;
  const canEdit = canEditSettings;

  /** Locations and agencies already typed on this project's sheets, for one-click adding. */
  const pastValues = useMemo(() => dprSuggestions(entries), [entries]);

  const [form, setForm] = useState<SettingsForm>(() => toForm(settings));
  /**
   * The saved settings the form was last filled from. When a load or a save brings new ones, the
   * form is refilled during render — React's pattern for state derived from a prop — rather than
   * from an effect that would paint the stale form first.
   */
  const [filledFrom, setFilledFrom] = useState<DprSettings>(settings);
  if (filledFrom !== settings) {
    setFilledFrom(settings);
    setForm(toForm(settings));
  }

  const [holidayDate, setHolidayDate] = useState("");
  const [holidayReason, setHolidayReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const errors = useMemo(() => validateForm(form, projectRecordDates), [form, projectRecordDates]);
  const isDirty = useMemo(
    () => JSON.stringify(fromForm(form)) !== JSON.stringify(settings),
    [form, settings],
  );

  // Counted on the BOQ register's own lines; sub-items are counted separately, so a line split
  // into five sub-items still reads as one BOQ line here.
  const boqSummary = useMemo(
    () =>
      DPR_SCOPES.map((scope) => {
        const lines = boqLines.filter((item) => item.scope === scope);
        return {
          scope,
          lines: lines.length,
          withQty: lines.filter((item) => item.boqQty > 0).length,
          withRate: lines.filter((item) => dprNumber(item.rate) > 0).length,
          brokenDown: lines.filter((item) => breakdown.groupLineIds.has(item.id)).length,
          subItems: [...breakdown.nodes.values()].filter(
            (node) => node.kind === "sub" && node.scope === scope,
          ).length,
        };
      }),
    [boqLines, breakdown],
  );
  const missingQty = boqSummary.reduce((sum, row) => sum + (row.lines - row.withQty), 0);
  const missingRate = boqSummary.reduce((sum, row) => sum + (row.lines - row.withRate), 0);

  const patch = (next: Partial<SettingsForm>) => setForm((previous) => ({ ...previous, ...next }));

  const toggleWeeklyOff = (day: number, off: boolean) =>
    setForm((previous) => ({
      ...previous,
      weeklyOff: off
        ? [...new Set([...previous.weeklyOff, day])].sort((a, b) => a - b)
        : previous.weeklyOff.filter((candidate) => candidate !== day),
    }));

  const holidayDuplicate = form.holidays.some((holiday) => holiday.date === holidayDate);
  const canAddHoliday = Boolean(parseIsoDate(holidayDate)) && !holidayDuplicate;
  const addHoliday = () => {
    if (!canAddHoliday) return;
    setForm((previous) => ({
      ...previous,
      holidays: [...previous.holidays, { date: holidayDate, reason: holidayReason.trim().slice(0, 80) }].sort(
        (a, b) => a.date.localeCompare(b.date),
      ),
    }));
    setHolidayDate("");
    setHolidayReason("");
  };

  const resetForm = () => {
    setForm(toForm(settings));
    setShowErrors(false);
  };

  const handleSave = async () => {
    // No project (or no one signed in, or no right to): nothing to write to.
    if (!globalProjectId || !user || !canEdit) return;
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    const clean = fromForm(form);
    setIsSaving(true);
    try {
      await setDoc(doc(db, "projects", globalProjectId, DPR_SETTINGS_COLLECTION, DPR_SETTINGS_DOC_ID), {
        ...clean,
        updatedAt: serverTimestamp(),
        updatedBy: user.id,
        updatedByName: user.name ?? "",
      });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Update DPR Settings",
        details: {
          project: projectName,
          weeklyOff: clean.weeklyOff.join(","),
          holidays: clean.holidays.length,
          startDate: clean.startDate,
          endDate: clean.endDate,
          tolerancePct: clean.tolerancePct,
          backdateDays: clean.backdateDays,
          shiftHours: clean.shiftHours,
          spikeMultiple: clean.spikeMultiple,
        },
      });
      setShowErrors(false);
      toast({ title: "Daily Progress settings saved" });
      await reload();
    } catch (error) {
      console.error("Failed to save the DPR settings:", error);
      toast({
        title: "Save failed",
        description: "The Daily Progress settings could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const disabled = !canEdit || isSaving;
  const canSave = canEdit && isDirty && !isSaving;
  const effectiveDates = dprProjectDates(form, projectRecordDates);
  const offDays = DPR_WEEKDAYS.filter(({ day }) => form.weeklyOff.includes(day)).map(({ label }) => label);

  const dateField = (key: "startDate" | "endDate", label: string) => {
    const recordDate = projectRecordDates[key];
    const consequence =
      key === "startDate" ? "Entries before this date will be refused." : "Entries after this date will be flagged.";
    return (
      <div className="min-w-0 space-y-1.5">
        <DprFieldLabel htmlFor={`dpr-${key}`}>{label}</DprFieldLabel>
        <Input
          id={`dpr-${key}`}
          type="date"
          value={form[key]}
          disabled={disabled}
          onChange={(event) => patch({ [key]: event.target.value } as Partial<SettingsForm>)}
          className="h-[38px] rounded-[11px]"
        />
        <p className="text-[11.5px] text-muted-foreground">
          {form[key] ? (
            <>
              {consequence} Overrides the project record ({recordDate ? formatDisplayDate(recordDate) : "not set"}).{" "}
              {canEdit ? (
                <button
                  type="button"
                  disabled={disabled}
                  className="font-medium text-primary underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => patch({ [key]: "" } as Partial<SettingsForm>)}
                >
                  Use the project’s
                </button>
              ) : null}
            </>
          ) : recordDate ? (
            <>
              Using the project record: {formatDisplayDate(recordDate)}. {consequence}
            </>
          ) : (
            <>Not set here or on the project record, so no date check applies.</>
          )}
        </p>
      </div>
    );
  };

  return (
    <DprPageShell>
      <DprReportsHero
        mappingId={mappingId}
        projectName={projectName}
        title={SETTINGS_TAB.label}
        description={SETTINGS_TAB.description}
        icon={SETTINGS_TAB.icon}
        band="rose"
        actions={
          <>
            <Button className={DPR_HERO_SECONDARY} disabled={!canSave} onClick={resetForm}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reset to saved
            </Button>
            <Button className={DPR_HERO_PRIMARY} disabled={!canSave} onClick={() => void handleSave()}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save settings
            </Button>
          </>
        }
      />

      {!canEdit ? (
        <div
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-transparent px-4 py-3 text-sm font-semibold text-amber-900"
          role="note"
        >
          <span
            className="keep-light flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] text-white"
            style={{ backgroundImage: "linear-gradient(135deg, #fbbf24, #d97706)" }}
            aria-hidden="true"
          >
            <Lock className="h-4 w-4" />
          </span>
          <span>
            You can read these settings but not change them. Ask for the <b>Edit Settings</b> action on{" "}
            {DPR_PERMISSION_RESOURCE}.
          </span>
        </div>
      ) : null}

      {!isLoading && !settingsSaved ? (
        <p className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Nothing has been saved for this project yet, so the starting values below are in use.
        </p>
      ) : null}

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      ) : null}

      {showErrors ? <DprMessages errors={errors} warnings={[]} /> : null}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <DprReportCard
              icon={CalendarDays}
              colours={["#fda4af", "#e11d48"]}
              title="Working calendar"
              subtitle="Days off, holidays and project dates"
              aside={
                <InfoTip label="About the working calendar">
                  Projections are spread over working days only, and “needed per day” counts the working
                  days left. With no weekly off and no holidays, every day is a working day, which is how
                  figures were worked out before this setting existed.
                </InfoTip>
              }
            >
              <DprSettingsBlock
                title="Weekly off"
                pill={
                  <DprReportPill tone={offDays.length > 0 ? "danger" : "neutral"}>
                    {offDays.length > 0 ? offDays.join(", ") : "None"}
                  </DprReportPill>
                }
              >
                <DprWeekdayToggles value={form.weeklyOff} onToggle={toggleWeeklyOff} disabled={disabled} />
                {form.weeklyOff.length >= 7 ? (
                  <p className="mt-2 text-xs text-destructive">Leave at least one working day in the week.</p>
                ) : null}
              </DprSettingsBlock>

              <DprSettingsBlock
                title="Holidays and shutdown days"
                pill={<DprReportPill tone="warning">{form.holidays.length}</DprReportPill>}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                  <div>
                    <Label htmlFor="dpr-holiday-date" className="sr-only">
                      Holiday date
                    </Label>
                    <Input
                      id="dpr-holiday-date"
                      type="date"
                      value={holidayDate}
                      disabled={disabled}
                      onChange={(event) => setHolidayDate(event.target.value)}
                      className="h-[38px] rounded-[11px]"
                    />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="dpr-holiday-reason" className="sr-only">
                      Reason
                    </Label>
                    <Input
                      id="dpr-holiday-reason"
                      value={holidayReason}
                      disabled={disabled}
                      maxLength={80}
                      placeholder="Reason (Diwali, client shutdown…)"
                      onChange={(event) => setHolidayReason(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addHoliday();
                        }
                      }}
                      className="h-[38px] rounded-[11px]"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled || !canAddHoliday}
                    onClick={addHoliday}
                    className="h-[38px] rounded-[11px] font-extrabold text-violet-700"
                  >
                    <Plus className="mr-1.5 h-4 w-4" /> Add day
                  </Button>
                </div>
                {holidayDate && holidayDuplicate ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {formatDisplayDate(holidayDate)} is already a holiday.
                  </p>
                ) : null}
                {form.holidays.length === 0 ? (
                  <p className="mt-2 text-[11.5px] text-muted-foreground">No holidays set.</p>
                ) : (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {form.holidays.map((holiday) => (
                      <DprTag
                        key={holiday.date}
                        tone="amber"
                        className="tabular-nums"
                        removeLabel={`Remove ${formatDisplayDate(holiday.date)}`}
                        onRemove={
                          canEdit && !isSaving
                            ? () => patch({ holidays: form.holidays.filter((candidate) => candidate.date !== holiday.date) })
                            : undefined
                        }
                      >
                        {formatDisplayDate(holiday.date)}
                        {holiday.reason ? ` · ${holiday.reason}` : ""}
                      </DprTag>
                    ))}
                  </div>
                )}
              </DprSettingsBlock>

              <DprSettingsBlock title="Project dates">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {dateField("startDate", "Project start")}
                  {dateField("endDate", "Project completion")}
                </div>
                {effectiveDates.startDate && effectiveDates.endDate && effectiveDates.endDate < effectiveDates.startDate ? (
                  <p className="mt-2 text-xs text-destructive">The completion date cannot be before the start date.</p>
                ) : null}
              </DprSettingsBlock>
            </DprReportCard>

            <DprReportCard
              icon={SlidersHorizontal}
              colours={["#a5b4fc", "#4f46e5"]}
              title="Limits used by the checks"
              subtitle="When a sheet entry gets flagged"
              aside={
                <InfoTip label="About the limits">
                  These decide when a projection or a daily sheet is refused, and when the recorder is asked
                  to confirm a figure. Set them to your own policy.
                </InfoTip>
              }
            >
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5">
                {LIMITS.map((limit) => (
                  <DprLimitTile
                    key={limit.key}
                    id={`dpr-${limit.key}`}
                    label={limit.label}
                    tip={limit.tip}
                    hint={limit.hint}
                    unit={limit.unit}
                    icon={limit.icon}
                    tone={limit.tone}
                    step={limit.step}
                    value={form[limit.key]}
                    disabled={disabled}
                    onChange={(value) => patch({ [limit.key]: value } as Partial<SettingsForm>)}
                  />
                ))}
              </div>
            </DprReportCard>

            <DprReportCard
              icon={Database}
              colours={["#93c5fd", "#2563eb"]}
              title="BOQ data the checks rely on"
              subtitle="Quantities and rates from the BOQ register"
              aside={
                <>
                  <InfoTip label="About the BOQ data">
                    BOQ quantity and rate come from the BOQ register, not from here. The quantity turns on
                    the balance checks; the rate lets achievement across lines of different units be
                    weighted by BOQ value.
                  </InfoTip>
                  <Button asChild size="sm" variant="outline" className="rounded-[10px]">
                    <Link href={dprHref("/project-management/boq", mappingId)}>Open the BOQ register</Link>
                  </Button>
                </>
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scope</TableHead>
                    <TableHead className="text-right">BOQ lines</TableHead>
                    <TableHead className="text-right">With a quantity</TableHead>
                    <TableHead className="text-right">With a rate</TableHead>
                    <TableHead className="text-right" title="BOQ lines split into sub-items in Work breakdown">
                      Broken down
                    </TableHead>
                    <TableHead className="text-right" title="Sub-items at every level, under those lines">
                      Sub-items
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boqSummary.map((row) => (
                    <TableRow key={row.scope}>
                      <TableCell className="font-medium">{row.scope}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.lines}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.withQty}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.withRate}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.brokenDown}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.subItems}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {missingQty > 0 || missingRate > 0 ? (
                <ul className="space-y-1 border-t border-border/60 px-4 py-3 text-xs text-amber-800 dark:text-amber-300 sm:px-5">
                  {missingQty > 0 ? (
                    <li>
                      {missingQty} line{missingQty === 1 ? " has" : "s have"} no BOQ quantity, so the balance
                      checks skip {missingQty === 1 ? "it" : "them"}.
                    </li>
                  ) : null}
                  {missingRate > 0 ? (
                    <li>
                      {missingRate} line{missingRate === 1 ? " has" : "s have"} no rate. Wherever one of them
                      is planned, achievement is the average of each line’s own percentage rather than
                      weighted by BOQ value.
                    </li>
                  ) : null}
                </ul>
              ) : boqSummary.some((row) => row.lines > 0) ? (
                <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
                  Every Civil and Erection line has a quantity and a rate.
                </p>
              ) : (
                <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
                  No Civil or Erection BOQ lines on this project yet.
                </p>
              )}
            </DprReportCard>
          </div>

          <DprReportCard
            icon={ListChecks}
            colours={["#6ee7b7", "#059669"]}
            title="Lists"
            subtitle="Choices offered on the daily sheet"
            aside={
              <InfoTip label="About the lists">
                A daily sheet&apos;s weather (optional) is chosen from the first list. Units in the second list
                are counted in whole numbers — projections spread as 1s and 2s and actuals cannot take a
                fraction. Every other unit takes up to three decimals. Units match ignoring case, dots and
                spaces, so “Nos.” matches “NOS”. Trades and plant are the dropdowns on every daily
                sheet&apos;s manpower and equipment rows, and locations and agencies the dropdowns on its
                work lines; an empty list is typed instead, with earlier values suggested.
              </InfoTip>
            }
          >
            {LISTS.map((list) => (
              <DprListEditor
                key={list.key}
                id={list.id}
                label={list.label}
                values={form[list.key]}
                onChange={(next) => patch({ [list.key]: next } as Partial<SettingsForm>)}
                placeholder={list.placeholder}
                icon={list.icon}
                tone={list.tone}
                readOnly={!canEdit}
                disabled={isSaving}
                suggestions={list.suggest ? pastValues[list.suggest] : undefined}
              />
            ))}
          </DprReportCard>
        </div>
      )}

      {/* The band scrolls away on a long page: changes keep a save within reach at the bottom. */}
      {!isLoading && canEdit && isDirty ? (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-violet-200 bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur">
          <span className="mr-auto text-xs font-semibold text-amber-700 dark:text-amber-300">Unsaved changes</span>
          <Button variant="outline" disabled={isSaving} onClick={resetForm}>
            <RotateCcw className="mr-2 h-4 w-4" /> Reset to saved
          </Button>
          <Button disabled={!canSave} onClick={() => void handleSave()}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save settings
          </Button>
        </div>
      ) : null}
    </DprPageShell>
  );
}
