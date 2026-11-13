"use client";

/**
 * Daily Progress settings — the per-project rules the planning engine and the checks read.
 *
 * Everything here is stored in one document, `projects/{globalProjectId}/dprSettings/config`, and
 * read through `sanitizeDprSettings`, so a missing or partial document still yields settings every
 * screen can rely on. The defaults (every day working, no tolerance) reproduce how figures were
 * worked out before this page existed, so nothing moves until someone changes a value here.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  Database,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
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
  sanitizeDprSettings,
  type DprHoliday,
  type DprSettings,
} from "@/lib/project-management-dpr-plan";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprHeader,
  DprLoadingState,
  DprMessages,
  DprPageShell,
  DprProjectNotFound,
  dprHref,
  formatDisplayDate,
} from "@/components/project-management/dpr/dpr-shell";
import { SettingsColumns, SettingsSection } from "@/components/settings/settings-ui";
import { InfoTip } from "@/components/shared/info-tip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

/** A section title with its explanation behind an (i). */
function TitleWithTip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {title}
      <InfoTip label={`About “${title}”`}>{children}</InfoTip>
    </span>
  );
}

/** Removable chips plus an input that adds one. Duplicates are refused case-insensitively. */
function ChipListEditor({
  id,
  label,
  values,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const duplicate = values.some((value) => value.toLowerCase() === trimmed.toLowerCase());
  const add = () => {
    if (!trimmed || duplicate) return;
    onChange([...values, trimmed.slice(0, 40)]);
    setText("");
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 ? (
          <span className="text-xs text-muted-foreground">None yet.</span>
        ) : (
          values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 py-0.5 pl-2.5 pr-1 text-xs"
            >
              {value}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(values.filter((candidate) => candidate !== value))}
                aria-label={`Remove ${value}`}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={40}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" disabled={disabled || !trimmed || duplicate} onClick={add}>
          <Plus className="mr-1.5 h-4 w-4" /> Add
        </Button>
      </div>
      {trimmed && duplicate ? (
        <p className="text-xs text-muted-foreground">“{trimmed}” is already in the list.</p>
      ) : null}
    </div>
  );
}

export default function DprSettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canEdit = !isAuthLoading && can("Edit Settings", DPR_PERMISSION_RESOURCE);

  const {
    globalProjectId,
    projectName,
    isResolving,
    notFound,
    settings,
    settingsSaved,
    projectRecordDates,
    boqLines,
    breakdown,
    isLoading,
    loadError,
    reload,
  } = useDprData(mappingId, canView);

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

  const handleSave = async () => {
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

  if (isAuthLoading || isResolving) return <DprLoadingState blocks={2} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening these settings."
        href="/project-management"
      />
    );
  }

  const disabled = !canEdit || isSaving;
  const effectiveDates = dprProjectDates(form, projectRecordDates);

  const saveBar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isDirty ? <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Unsaved changes</span> : null}
      <Button variant="outline" disabled={!isDirty || isSaving} onClick={() => setForm(toForm(settings))}>
        <RotateCcw className="mr-2 h-4 w-4" /> Reset to saved
      </Button>
      <Button disabled={!canEdit || !isDirty || isSaving} onClick={() => void handleSave()}>
        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save settings
      </Button>
    </div>
  );

  const dateField = (key: "startDate" | "endDate", label: string) => {
    const recordDate = projectRecordDates[key];
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`dpr-${key}`}>{label}</Label>
        <Input
          id={`dpr-${key}`}
          type="date"
          value={form[key]}
          disabled={disabled}
          onChange={(event) => patch({ [key]: event.target.value } as Partial<SettingsForm>)}
        />
        <p className="text-xs text-muted-foreground">
          {form[key] ? (
            <>
              Overrides the project record ({recordDate ? formatDisplayDate(recordDate) : "not set"}).{" "}
              <button
                type="button"
                disabled={disabled}
                className="font-medium text-primary underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
                onClick={() => patch({ [key]: "" } as Partial<SettingsForm>)}
              >
                Use the project’s
              </button>
            </>
          ) : recordDate ? (
            <>Using the project record: {formatDisplayDate(recordDate)}.</>
          ) : (
            <>Not set here or on the project record, so no date check applies.</>
          )}
        </p>
      </div>
    );
  };

  return (
    <DprPageShell>
      <DprHeader active="settings" mappingId={mappingId} projectName={projectName} actions={saveBar} />

      {!canEdit ? (
        <Card className="border-amber-500/40">
          <CardContent className="p-4 text-sm text-muted-foreground">
            You can read these settings but not change them. Ask for the Edit Settings action on{" "}
            {DPR_PERMISSION_RESOURCE}.
          </CardContent>
        </Card>
      ) : null}

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      ) : null}

      {!isLoading && !settingsSaved ? (
        <p className="text-sm text-muted-foreground">
          Nothing has been saved for this project yet, so the starting values below are in use.
        </p>
      ) : null}

      {showErrors ? <DprMessages errors={errors} warnings={[]} /> : null}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full" />
          ))}
        </div>
      ) : (
        <SettingsColumns>
          <SettingsSection
            icon={CalendarDays}
            title={
              <TitleWithTip title="Working calendar">
                Projections are spread over working days only, and “needed per day” counts the
                working days left. With no weekly off and no holidays, every day is a working day,
                which is how figures were worked out before this setting existed.
              </TitleWithTip>
            }
          >
            <div className="space-y-2">
              <span className="text-sm font-medium">Weekly off</span>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {DPR_WEEKDAYS.map(({ day, label }) => (
                  <div key={day} className="flex items-center gap-2">
                    <Checkbox
                      id={`dpr-off-${day}`}
                      checked={form.weeklyOff.includes(day)}
                      disabled={disabled}
                      onCheckedChange={(checked) => toggleWeeklyOff(day, checked === true)}
                    />
                    <Label htmlFor={`dpr-off-${day}`} className="font-normal">
                      {label}
                    </Label>
                  </div>
                ))}
              </div>
              {form.weeklyOff.length >= 7 ? (
                <p className="text-xs text-destructive">Leave at least one working day in the week.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Holidays and shutdown days</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
                <div className="space-y-1">
                  <Label htmlFor="dpr-holiday-date" className="sr-only">
                    Holiday date
                  </Label>
                  <Input
                    id="dpr-holiday-date"
                    type="date"
                    value={holidayDate}
                    disabled={disabled}
                    onChange={(event) => setHolidayDate(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
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
                  />
                </div>
                <Button type="button" variant="outline" disabled={disabled || !canAddHoliday} onClick={addHoliday}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add day
                </Button>
              </div>
              {holidayDate && holidayDuplicate ? (
                <p className="text-xs text-muted-foreground">
                  {formatDisplayDate(holidayDate)} is already a holiday.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {form.holidays.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No holidays set.</span>
                ) : (
                  form.holidays.map((holiday) => (
                    <span
                      key={holiday.date}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 py-0.5 pl-2.5 pr-1 text-xs tabular-nums"
                    >
                      {formatDisplayDate(holiday.date)}
                      {holiday.reason ? <span className="text-muted-foreground">· {holiday.reason}</span> : null}
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Remove ${formatDisplayDate(holiday.date)}`}
                        onClick={() =>
                          patch({ holidays: form.holidays.filter((candidate) => candidate.date !== holiday.date) })
                        }
                        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {dateField("startDate", "Project start")}
              {dateField("endDate", "Project completion")}
            </div>
            {effectiveDates.startDate && effectiveDates.endDate && effectiveDates.endDate < effectiveDates.startDate ? (
              <p className="text-xs text-destructive">
                The completion date cannot be before the start date.
              </p>
            ) : null}
          </SettingsSection>

          <SettingsSection
            icon={SlidersHorizontal}
            title={
              <TitleWithTip title="Limits used by the checks">
                These decide when a projection or a daily sheet is refused, and when the recorder is
                asked to confirm a figure. Set them to your own policy.
              </TitleWithTip>
            }
            contentClassName="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            {(
              [
                {
                  key: "tolerancePct",
                  label: "Tolerance over BOQ quantity (%)",
                  tip: "How far cumulative work, or work still planned, may run past the BOQ quantity before it is refused. 0 means not past the BOQ quantity at all.",
                  step: "any",
                },
                {
                  key: "backdateDays",
                  label: "Backdating allowed (days)",
                  tip: "How many days back a sheet may be submitted. Older dates need someone with the DPR Reopen action.",
                  step: "1",
                },
                {
                  key: "shiftHours",
                  label: "Shift length (hours)",
                  tip: "The longest a day's lost time can be.",
                  step: "any",
                },
                {
                  key: "spikeMultiple",
                  label: "Query an actual above this multiple of plan",
                  tip: "An actual more than this many times the day's plan asks the recorder to check the figure before submitting.",
                  step: "any",
                },
              ] as const
            ).map((field) => (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={`dpr-${field.key}`}>{field.label}</Label>
                  <InfoTip label={`About “${field.label}”`}>{field.tip}</InfoTip>
                </div>
                <Input
                  id={`dpr-${field.key}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={field.step}
                  value={form[field.key]}
                  disabled={disabled}
                  onChange={(event) => patch({ [field.key]: event.target.value } as Partial<SettingsForm>)}
                />
              </div>
            ))}
          </SettingsSection>

          <SettingsSection
            icon={ListChecks}
            title={
              <TitleWithTip title="Lists">
                Weather is chosen from this list on every daily sheet. Units in the second list are
                counted in whole numbers — projections spread as 1s and 2s and actuals cannot take a
                fraction. Every other unit takes up to three decimals. Units match ignoring case,
                dots and spaces, so “Nos.” matches “NOS”.
              </TitleWithTip>
            }
          >
            <ChipListEditor
              id="dpr-weather"
              label="Weather options"
              values={form.weatherOptions}
              onChange={(weatherOptions) => patch({ weatherOptions })}
              placeholder="Add a weather option"
              disabled={disabled}
            />
            <ChipListEditor
              id="dpr-whole-units"
              label="Units counted in whole numbers"
              values={form.wholeNumberUnits}
              onChange={(wholeNumberUnits) => patch({ wholeNumberUnits })}
              placeholder="Add a unit (Nos, Set…)"
              disabled={disabled}
            />
          </SettingsSection>

          <SettingsSection
            icon={Database}
            title={
              <TitleWithTip title="BOQ data the checks rely on">
                BOQ quantity and rate come from the BOQ register, not from here. The quantity turns
                on the balance checks; the rate lets achievement across lines of different units be
                weighted by BOQ value.
              </TitleWithTip>
            }
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={dprHref("/project-management/boq", mappingId)}>Open the BOQ register</Link>
              </Button>
            }
            flush
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
              <ul className="space-y-1 border-t border-border/60 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
                {missingQty > 0 ? (
                  <li>
                    {missingQty} line{missingQty === 1 ? " has" : "s have"} no BOQ quantity, so the
                    balance checks skip {missingQty === 1 ? "it" : "them"}.
                  </li>
                ) : null}
                {missingRate > 0 ? (
                  <li>
                    {missingRate} line{missingRate === 1 ? " has" : "s have"} no rate. Wherever one of
                    them is planned, achievement is the average of each line’s own percentage rather
                    than weighted by BOQ value.
                  </li>
                ) : null}
              </ul>
            ) : boqSummary.some((row) => row.lines > 0) ? (
              <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
                Every Civil and Erection line has a quantity and a rate.
              </p>
            ) : (
              <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
                No Civil or Erection BOQ lines on this project yet.
              </p>
            )}
          </SettingsSection>
        </SettingsColumns>
      )}

      {!isLoading ? <div className="pb-4">{saveBar}</div> : null}
    </DprPageShell>
  );
}
