"use client";

/**
 * Record Daily Progress — one day, one scope.
 *
 * Opening a date that already has an entry loads it for editing, because a site files one DPR per
 * scope per day and a second one would double-count.
 *
 * **Actual is the only thing this sheet asks for.** Projection is read-only here: it is whatever
 * the projection register (`dprTargets`) says for this date, pro-rated by day, and it is shown
 * purely so the recorder can see what the day was aimed at. A BOQ line with no projection behind
 * it still takes an actual — most days on a site are worked without a figure having been set for
 * them, and refusing the record because nobody filed a plan would lose the only hard fact of the
 * day. `plannedQty` is still written onto the saved line, as a snapshot of the projection at the
 * time of filing, so the log can show plan against actual without re-deriving it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  CloudSun,
  Loader2,
  Plus,
  Save,
  Trash2,
  Truck,
  Users,
} from "lucide-react";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { nanoid } from "nanoid";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DPR_BASE_PATH,
  DPR_ENTRY_COLLECTION,
  DPR_PERMISSION_RESOURCE,
  DPR_SCOPES,
  dailyPlannedByBoqItem,
  dprNumber,
  validateDprEntry,
  type DprEntry,
  type DprEntryDraft,
  type DprEquipmentLine,
  type DprLine,
  type DprManpowerLine,
  type DprScope,
} from "@/lib/project-management-dpr";
import { useDprData, type DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprLoadingState,
  DprPageShell,
  DprProjectNotFound,
  formatQty,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const emptyLine = (): DprLine => ({
  id: nanoid(),
  boqItemId: "",
  boqSlNo: "",
  description: "",
  unit: "",
  plannedQty: 0,
  actualQty: 0,
});

export default function RecordDailyProgressPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canRecord = !isAuthLoading && can("Add", DPR_PERMISSION_RESOURCE);

  const { globalProjectId, projectName, isResolving, notFound, boqItems, entries, targets, isLoading, reload } =
    useDprData(mappingId, canView);

  const initialScope = (searchParams?.get("scope") as DprScope | null) ?? "Civil";
  const initialDate = searchParams?.get("date") ?? todayIso();

  const [scope, setScope] = useState<DprScope>(
    DPR_SCOPES.includes(initialScope) ? initialScope : "Civil",
  );
  const [date, setDate] = useState(initialDate);
  const [lines, setLines] = useState<DprLine[]>([]);
  /**
   * What is literally in each Actual box, keyed by line id. The line itself keeps the parsed
   * number; this keeps the text, so a line that has not been typed into shows empty rather than a
   * pre-filled `0`, and "0.5" survives being typed one character at a time (a controlled number
   * input fed from the parsed value would blank itself on the leading "0").
   */
  const [actualText, setActualText] = useState<Record<string, string>>({});
  const [manpower, setManpower] = useState<DprManpowerLine[]>([]);
  const [equipment, setEquipment] = useState<DprEquipmentLine[]>([]);
  const [weather, setWeather] = useState("");
  const [lostTimeHours, setLostTimeHours] = useState("");
  const [lostTimeReason, setLostTimeReason] = useState("");
  const [hindrances, setHindrances] = useState("");
  const [remarks, setRemarks] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  /** The entry this screen is editing, if the chosen date already has one. */
  const [existingId, setExistingId] = useState("");

  const scopeBoqItems = useMemo(
    () => boqItems.filter((item) => item.scope === scope),
    [boqItems, scope],
  );

  const boqById = useMemo(() => {
    const map = new Map<string, DprBoqItem>();
    for (const item of boqItems) map.set(item.id, item);
    return map;
  }, [boqItems]);

  /** The day's share of every projection covering this date — the default each line starts at. */
  const plannedToday = useMemo(
    () => dailyPlannedByBoqItem(targets, date, { scope }),
    [targets, date, scope],
  );

  /** Load whatever is already filed for this date and scope, or start a fresh sheet. */
  const loadForDate = useCallback(() => {
    const existing = entries.find((entry) => entry.date === date && entry.scope === scope);
    if (existing) {
      setExistingId(existing.id);
      setLines((existing.lines ?? []).map((line) => ({ ...line })));
      // A filed sheet shows its figures as filed, zeros included: a recorded 0 is a statement that
      // the line was not worked, not an untouched box.
      setActualText(
        Object.fromEntries(
          (existing.lines ?? []).map((line) => [line.id, String(dprNumber(line.actualQty))]),
        ),
      );
      setManpower((existing.manpower ?? []).map((line) => ({ ...line })));
      setEquipment((existing.equipment ?? []).map((line) => ({ ...line })));
      setWeather(existing.weather ?? "");
      setLostTimeHours(existing.lostTimeHours ? String(existing.lostTimeHours) : "");
      setLostTimeReason(existing.lostTimeReason ?? "");
      setHindrances(existing.hindrances ?? "");
      setRemarks(existing.remarks ?? "");
      return;
    }
    setExistingId("");
    // A fresh sheet is seeded with whatever was projected for the day, so the recorder confirms
    // the plan rather than retyping it.
    const seeded: DprLine[] = [];
    for (const [boqItemId, plannedQty] of plannedToday) {
      const item = boqById.get(boqItemId);
      if (!item) continue;
      seeded.push({
        id: nanoid(),
        boqItemId,
        boqSlNo: item.boqSlNo,
        erpSlNo: item.erpSlNo,
        description: item.description,
        unit: item.unit,
        plannedQty: Math.round(plannedQty * 1000) / 1000,
        actualQty: 0,
      });
    }
    // No projection covers this day: open with one blank line rather than an empty sheet, so the
    // recorder can pick a BOQ item and type the actual straight away.
    setLines(seeded.length > 0 ? seeded : [emptyLine()]);
    setActualText({});
    setManpower([]);
    setEquipment([]);
    setWeather("");
    setLostTimeHours("");
    setLostTimeReason("");
    setHindrances("");
    setRemarks("");
  }, [entries, date, scope, plannedToday, boqById]);

  // Loading a filed sheet into an editable form is exactly the "sync React state from an external
  // system" case effects are for: the register is the source, and changing the date or scope must
  // re-seed every field. eslint's set-state-in-effect rule flags the shape regardless; the sibling
  // Project Management hooks carry the same finding.
  useEffect(() => {
    if (isLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadForDate();
  }, [isLoading, loadForDate]);

  const setLine = (index: number, patch: Partial<DprLine>) => {
    setLines((previous) =>
      previous.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  };

  const chooseBoqItem = (index: number, boqItemId: string) => {
    const item = boqById.get(boqItemId);
    if (!item) return;
    setLine(index, {
      boqItemId,
      boqSlNo: item.boqSlNo,
      erpSlNo: item.erpSlNo,
      description: item.description,
      unit: item.unit,
      plannedQty: Math.round((plannedToday.get(boqItemId) ?? 0) * 1000) / 1000,
    });
  };

  /**
   * What the register projects for one BOQ line on this date. Always read from `dprTargets` —
   * nothing on this screen types a projection, so there is no typed value to prefer.
   */
  const plannedFor = useCallback(
    (boqItemId: string) =>
      boqItemId ? Math.round((plannedToday.get(boqItemId) ?? 0) * 1000) / 1000 : 0,
    [plannedToday],
  );

  /** Whether the projection register says anything at all about this scope on this date. */
  const hasProjection = plannedToday.size > 0;

  const totals = useMemo(
    () => ({
      planned: lines.reduce((sum, line) => sum + plannedFor(line.boqItemId), 0),
      actual: lines.reduce((sum, line) => sum + dprNumber(line.actualQty), 0),
      manpower: manpower.reduce((sum, line) => sum + dprNumber(line.count), 0),
    }),
    [lines, manpower, plannedFor],
  );

  const buildDraft = (status: "Draft" | "Submitted"): DprEntryDraft => ({
    scope,
    date,
    status,
    lines: lines
      .filter((line) => line.boqItemId)
      .map((line) => ({
        ...line,
        // Snapshot the projection as it stands now, so the log can show plan against actual for
        // this day without re-deriving it. Zero simply means nothing was projected for the line.
        plannedQty: plannedFor(line.boqItemId),
        actualQty: dprNumber(line.actualQty),
      })),
    manpower: manpower.filter((line) => String(line.trade ?? "").trim()),
    equipment: equipment.filter((line) => String(line.name ?? "").trim()),
    weather: weather.trim(),
    lostTimeHours: dprNumber(lostTimeHours),
    lostTimeReason: lostTimeReason.trim(),
    hindrances: hindrances.trim(),
    remarks: remarks.trim(),
    preparedByName: user?.name ?? "",
  });

  const handleSave = async (status: "Draft" | "Submitted") => {
    if (!globalProjectId || !user) return;
    const draft = buildDraft(status);
    const errors = validateDprEntry(draft);
    if (errors.length > 0) {
      toast({
        title: "Check the entry",
        description: errors[0]!.message,
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const entryRef = existingId
        ? doc(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION, existingId)
        : doc(collection(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION));
      const audit = existingId
        ? { updatedAt: serverTimestamp(), updatedBy: user.id, updatedByName: user.name ?? "" }
        : {
            createdAt: serverTimestamp(),
            createdBy: user.id,
            createdByName: user.name ?? "",
            updatedAt: serverTimestamp(),
            updatedBy: user.id,
            updatedByName: user.name ?? "",
          };
      await setDoc(entryRef, { ...draft, ...audit }, { merge: true });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `${existingId ? "Update" : "Record"} Daily Progress`,
        details: {
          project: projectName,
          scope,
          date,
          status,
          lines: draft.lines.length,
          actualQty: draft.lines.reduce((sum, line) => sum + line.actualQty, 0),
        },
      });

      toast({
        title: status === "Draft" ? "Saved as draft" : "Daily progress recorded",
        description: `${scope} progress for ${date} has been ${existingId ? "updated" : "saved"}.`,
      });
      await reload();
      if (status === "Submitted") {
        router.push(`${DPR_BASE_PATH}?project=${encodeURIComponent(mappingId)}`);
      }
    } catch (error) {
      console.error("Failed to save the daily progress entry:", error);
      toast({
        title: "Save failed",
        description: "The daily progress entry could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const withProject = (path: string) =>
    `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(mappingId)}`;

  if (isAuthLoading || isResolving) return <DprLoadingState blocks={2} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before recording progress."
        href="/project-management"
      />
    );
  }

  return (
    <DprPageShell>
      <PageHeader
        title={existingId ? "Edit daily progress" : "Record daily progress"}
        description="One sheet per scope per day: what was planned, what was done, and the site diary behind it."
        icon={Activity}
        breadcrumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: "Daily Progress", href: withProject(DPR_BASE_PATH) },
          { label: projectName || "Project" },
        ]}
        backHref={withProject(DPR_BASE_PATH)}
        backLabel="Daily Progress"
        actions={
          <>
            <Button
              variant="outline"
              disabled={!canRecord || isSaving}
              onClick={() => void handleSave("Draft")}
            >
              Save draft
            </Button>
            <Button disabled={!canRecord || isSaving} onClick={() => void handleSave("Submitted")}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Submit
            </Button>
          </>
        }
      />

      {!canRecord ? (
        <Card className="border-amber-500/40">
          <CardContent className="p-4 text-sm text-muted-foreground">
            You can read this register but not record against it. Ask for the Add action on{" "}
            {DPR_PERMISSION_RESOURCE}.
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/60">
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="dpr-scope">Scope</Label>
            <Select value={scope} onValueChange={(next) => setScope(next as DprScope)}>
              <SelectTrigger id="dpr-scope" className="text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DPR_SCOPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dpr-date">Date</Label>
            <Input
              id="dpr-date"
              type="date"
              value={date}
              max={todayIso()}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dpr-weather">Weather</Label>
            <Input
              id="dpr-weather"
              value={weather}
              placeholder="Clear / Rain / Hot"
              onChange={(event) => setWeather(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <div className="flex h-10 items-center rounded-md border border-border/60 bg-muted/40 px-3 text-sm">
              {existingId ? "Editing the sheet already filed for this day" : "New sheet"}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Progress lines ───────────────────────────────────────────────────────────────── */}
      <Card className="border-border/60">
        <SectionHeader
          title="Work done"
          description={`${lines.length} line${lines.length === 1 ? "" : "s"} · actual ${formatQty(totals.actual)}${
            hasProjection ? ` · against a projection of ${formatQty(totals.planned)}` : ""
          }`}
          icon={Activity}
          className="p-4 pb-0"
        />
        <CardContent className="p-0">
          {scopeBoqItems.length === 0 ? (
            <PmEmptyState
              icon={Activity}
              title={`No ${scope} BOQ lines on this project`}
              description={`BOQ items are read as ${scope} when their Scope 2 column says so. Import or tag them first.`}
            />
          ) : (
            <>
              {!hasProjection ? (
                <p className="border-y border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                  No projection covers this day. Record what was actually done — a projection is a
                  reference, not a precondition. Figures are set in{" "}
                  <Link
                    href={withProject(`${DPR_BASE_PATH}/targets`)}
                    className="underline underline-offset-2"
                  >
                    Projections
                  </Link>
                  .
                </p>
              ) : null}
              <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[260px]">BOQ line</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Projected</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Agency</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead className="w-12 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          No lines yet. Add the BOQ items worked on today.
                        </TableCell>
                      </TableRow>
                    ) : (
                      lines.map((line, index) => (
                        <TableRow key={line.id}>
                          <TableCell className="min-w-[260px]">
                            <Select
                              value={line.boqItemId}
                              onValueChange={(next) => chooseBoqItem(index, next)}
                            >
                              <SelectTrigger className="text-left">
                                <SelectValue placeholder="Choose a BOQ item" />
                              </SelectTrigger>
                              <SelectContent>
                                {scopeBoqItems.map((item) => (
                                  <SelectItem key={item.id} value={item.id}>
                                    {item.boqSlNo ? `${item.boqSlNo} · ` : ""}
                                    {item.description || "BOQ line"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{line.unit || "—"}</TableCell>
                          {/* Read-only: the projection register owns this figure, not the sheet. */}
                          <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                            {plannedFor(line.boqItemId) > 0 ? (
                              formatQty(plannedFor(line.boqItemId))
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              inputMode="decimal"
                              placeholder="0"
                              aria-label={`Actual quantity for ${line.boqSlNo || "this line"}`}
                              className="ml-auto min-w-[96px] text-right"
                              value={actualText[line.id] ?? (line.actualQty ? String(line.actualQty) : "")}
                              onChange={(event) => {
                                const text = event.target.value;
                                setActualText((previous) => ({ ...previous, [line.id]: text }));
                                setLine(index, { actualQty: dprNumber(text) });
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="min-w-[120px]"
                              value={line.location ?? ""}
                              onChange={(event) => setLine(index, { location: event.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="min-w-[120px]"
                              value={line.agency ?? ""}
                              onChange={(event) => setLine(index, { agency: event.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="min-w-[140px]"
                              value={line.remarks ?? ""}
                              onChange={(event) => setLine(index, { remarks: event.target.value })}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Remove line"
                              onClick={() =>
                                setLines((previous) =>
                                  previous.filter((candidate) => candidate.id !== line.id),
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
              </Table>
              <div className="border-t border-border/60 p-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((previous) => [...previous, emptyLine()])}
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Add BOQ line
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Site diary ───────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-border/60">
          <SectionHeader
            title="Manpower"
            description={`${formatQty(totals.manpower)} on site`}
            icon={Users}
            className="p-4 pb-0"
          />
          <CardContent className="space-y-2 p-4">
            {manpower.map((line, index) => (
              <div key={line.id} className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="sr-only" htmlFor={`trade-${line.id}`}>
                    Trade
                  </Label>
                  <Input
                    id={`trade-${line.id}`}
                    placeholder="Trade (mason, fitter, rigger…)"
                    value={line.trade}
                    onChange={(event) =>
                      setManpower((previous) =>
                        previous.map((candidate, position) =>
                          position === index ? { ...candidate, trade: event.target.value } : candidate,
                        ),
                      )
                    }
                  />
                </div>
                <div className="w-24 space-y-1.5">
                  <Label className="sr-only" htmlFor={`count-${line.id}`}>
                    Count
                  </Label>
                  <Input
                    id={`count-${line.id}`}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="text-right"
                    value={line.count}
                    onChange={(event) =>
                      setManpower((previous) =>
                        previous.map((candidate, position) =>
                          position === index
                            ? { ...candidate, count: dprNumber(event.target.value) }
                            : candidate,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove trade"
                  onClick={() =>
                    setManpower((previous) =>
                      previous.filter((candidate) => candidate.id !== line.id),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setManpower((previous) => [...previous, { id: nanoid(), trade: "", count: 0 }])
              }
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add trade
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <SectionHeader
            title="Plant and equipment"
            description="What was on site, and how it was used."
            icon={Truck}
            className="p-4 pb-0"
          />
          <CardContent className="space-y-2 p-4">
            {equipment.map((line, index) => (
              <div key={line.id} className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  placeholder="Equipment"
                  value={line.name}
                  onChange={(event) =>
                    setEquipment((previous) =>
                      previous.map((candidate, position) =>
                        position === index ? { ...candidate, name: event.target.value } : candidate,
                      ),
                    )
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove equipment"
                  onClick={() =>
                    setEquipment((previous) =>
                      previous.filter((candidate) => candidate.id !== line.id),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
                <div className="col-span-2 grid grid-cols-3 gap-2">
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="Nos"
                    value={line.deployed}
                    onChange={(event) =>
                      setEquipment((previous) =>
                        previous.map((candidate, position) =>
                          position === index
                            ? { ...candidate, deployed: dprNumber(event.target.value) }
                            : candidate,
                        ),
                      )
                    }
                  />
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    placeholder="Running hrs"
                    value={line.runningHours ?? ""}
                    onChange={(event) =>
                      setEquipment((previous) =>
                        previous.map((candidate, position) =>
                          position === index
                            ? { ...candidate, runningHours: dprNumber(event.target.value) }
                            : candidate,
                        ),
                      )
                    }
                  />
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    placeholder="Idle hrs"
                    value={line.idleHours ?? ""}
                    onChange={(event) =>
                      setEquipment((previous) =>
                        previous.map((candidate, position) =>
                          position === index
                            ? { ...candidate, idleHours: dprNumber(event.target.value) }
                            : candidate,
                        ),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setEquipment((previous) => [
                  ...previous,
                  { id: nanoid(), name: "", deployed: 1, runningHours: 0, idleHours: 0 },
                ])
              }
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add equipment
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <SectionHeader
          title="Lost time, hindrances and remarks"
          description="The basis for any delay the day caused."
          icon={CloudSun}
          className="p-4 pb-0"
        />
        <CardContent className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dpr-lost-hours">Time lost (hours)</Label>
            <Input
              id="dpr-lost-hours"
              type="number"
              min={0}
              max={24}
              step="any"
              inputMode="decimal"
              value={lostTimeHours}
              onChange={(event) => setLostTimeHours(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dpr-lost-reason">Reason</Label>
            <Input
              id="dpr-lost-reason"
              placeholder="Rain, power failure, material shortage…"
              value={lostTimeReason}
              onChange={(event) => setLostTimeReason(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dpr-hindrances">Hindrances</Label>
            <Textarea
              id="dpr-hindrances"
              rows={3}
              placeholder="Blockers raised today and who they sit with."
              value={hindrances}
              onChange={(event) => setHindrances(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dpr-remarks">Remarks</Label>
            <Textarea
              id="dpr-remarks"
              rows={3}
              placeholder="Anything else the day should be remembered by."
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2 pb-4">
        <Button asChild variant="ghost">
          <Link href={withProject(DPR_BASE_PATH)}>Cancel</Link>
        </Button>
        <Button
          variant="outline"
          disabled={!canRecord || isSaving}
          onClick={() => void handleSave("Draft")}
        >
          Save draft
        </Button>
        <Button disabled={!canRecord || isSaving} onClick={() => void handleSave("Submitted")}>
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Submit
        </Button>
      </div>
    </DprPageShell>
  );
}
