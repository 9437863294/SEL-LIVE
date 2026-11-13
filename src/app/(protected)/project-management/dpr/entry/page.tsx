"use client";

/**
 * Record progress — one sheet per scope per day.
 *
 * Opening a date that already has a sheet loads it, because a site files one DPR per scope per day
 * and a second would double-count. New sheets are keyed `{scope}-{date}` for the same reason.
 *
 * **Actual is the only thing this sheet asks for.** Planned is read-only: it is whatever the
 * planning engine says for the date (working days, spread, the shorter overlapping period owning
 * the day). A BOQ line with nothing planned still takes an actual — most site days are worked
 * without a figure having been set, and refusing the record would lose the only hard fact of the
 * day. `plannedQty` is still written onto each saved line as a snapshot, so the log can show plan
 * against actual without re-deriving it.
 *
 * The sheet is held as typed text, so an Actual left empty is told apart from a 0 — the checks
 * (`checkDprSheet`, rules D1–D10) require every row to say which it is. Submitting locks the
 * sheet; only a DPR approver (`Reopen`) can turn it back into a draft.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardList,
  CloudSun,
  Loader2,
  Lock,
  Plus,
  Send,
  Trash2,
  Truck,
  Unlock,
  Users,
} from "lucide-react";
import { collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
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
  dprNumber,
  parseIsoDate,
  validateDprEntry,
  type DprBoqLike,
  type DprEntry,
  type DprEntryDraft,
  type DprEquipmentLine,
  type DprLine,
  type DprManpowerLine,
  type DprScope,
  type DprStatus,
} from "@/lib/project-management-dpr";
import {
  checkDprSheet,
  dprSuggestions,
  indexDprActuals,
  roundToDecimals,
  type DprSheet,
} from "@/lib/project-management-dpr-plan";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprBoqPicker,
  DprHeader,
  DprLoadingState,
  DprMessages,
  DprPageShell,
  DprProjectNotFound,
  dprHref,
  formatQtyAt,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { DprBranchMark, breakdownTitle } from "@/components/project-management/dpr/dpr-indent";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { SectionHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { InfoTip } from "@/components/shared/info-tip";
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

/* ── Sheet state: everything as typed ───────────────────────────────────────────────────────── */

interface RowState {
  id: string;
  boqItemId: string;
  /** "" means not entered yet, which is not the same as 0. */
  actual: string;
  location: string;
  agency: string;
  remarks: string;
}

interface ManpowerState {
  id: string;
  trade: string;
  count: string;
}

interface EquipmentState {
  id: string;
  name: string;
  deployed: string;
  runningHours: string;
  idleHours: string;
}

interface SheetState {
  weather: string;
  rows: RowState[];
  manpower: ManpowerState[];
  equipment: EquipmentState[];
  lostTimeHours: string;
  lostTimeReason: string;
  hindrances: string;
  remarks: string;
}

/**
 * A draft can be saved with an Actual still empty. The stored line then carries `actualQty: 0`
 * and `actualEntered: false`, so reopening the draft shows the box empty rather than a 0 nobody
 * typed. Sheets saved before this flag existed read as entered.
 */
type StoredLine = DprLine & { actualEntered?: boolean };

const blankRow = (boqItemId = ""): RowState => ({
  id: nanoid(),
  boqItemId,
  actual: "",
  location: "",
  agency: "",
  remarks: "",
});

const numberText = (value: unknown): string =>
  value === null || value === undefined || value === "" ? "" : String(dprNumber(value));

const sheetFromEntry = (entry: DprEntry): SheetState => ({
  weather: entry.weather ?? "",
  rows: (entry.lines ?? []).map((line) => {
    const stored = line as StoredLine;
    return {
      id: stored.id || nanoid(),
      boqItemId: stored.boqItemId ?? "",
      actual: stored.actualEntered === false ? "" : String(dprNumber(stored.actualQty)),
      location: stored.location ?? "",
      agency: stored.agency ?? "",
      remarks: stored.remarks ?? "",
    };
  }),
  manpower: (entry.manpower ?? []).map((line) => ({
    id: line.id || nanoid(),
    trade: line.trade ?? "",
    count: numberText(line.count),
  })),
  equipment: (entry.equipment ?? []).map((line) => ({
    id: line.id || nanoid(),
    name: line.name ?? "",
    deployed: numberText(line.deployed),
    runningHours: numberText(line.runningHours),
    idleHours: numberText(line.idleHours),
  })),
  lostTimeHours: entry.lostTimeHours ? String(entry.lostTimeHours) : "",
  lostTimeReason: entry.lostTimeReason ?? "",
  hindrances: entry.hindrances ?? "",
  remarks: entry.remarks ?? "",
});

const emptySheet = (rows: RowState[]): SheetState => ({
  weather: "",
  rows,
  manpower: [],
  equipment: [],
  lostTimeHours: "",
  lostTimeReason: "",
  hindrances: "",
  remarks: "",
});

interface Messages {
  errors: string[];
  warnings: string[];
}

export default function RecordDailyProgressPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canRecord = !isAuthLoading && can("Add", DPR_PERMISSION_RESOURCE);
  const canReopen = !isAuthLoading && can("Reopen", DPR_PERMISSION_RESOURCE);

  const mappingIdParam = searchParams?.get("project") ?? "";
  const {
    globalProjectId,
    mappingId,
    projectName,
    isResolving,
    notFound,
    boqItems,
    entries,
    settings,
    projectDates,
    plan,
    decimalsFor,
    isLoading,
    reload,
  } = useDprData(mappingIdParam, canView);

  const initialScope = searchParams?.get("scope");
  const [scope, setScope] = useState<DprScope>(
    DPR_SCOPES.includes(initialScope as DprScope) ? (initialScope as DprScope) : "Civil",
  );
  const [date, setDate] = useState(() => {
    const fromUrl = searchParams?.get("date") ?? "";
    return parseIsoDate(fromUrl) ? fromUrl : todayIso();
  });
  const today = todayIso();

  const [sheet, setSheet] = useState<SheetState>(() => emptySheet([]));
  /** The sheet already filed for this scope and date, if there is one. */
  const [existing, setExisting] = useState<DprEntry | null>(null);
  const [messages, setMessages] = useState<Messages | null>(null);
  /** Set once warnings have been shown: the next Submit goes through ("Submit anyway"). */
  const [confirming, setConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const scopeItems = useMemo(() => boqItems.filter((item) => item.scope === scope), [boqItems, scope]);
  const itemById = useMemo(() => {
    const map = new Map<string, (typeof boqItems)[number]>();
    for (const item of boqItems) map.set(item.id, item);
    return map;
  }, [boqItems]);

  /** BOQ lines the plan puts work on for this date — what a fresh sheet opens with. */
  const plannedItems = useMemo(
    () => scopeItems.filter((item) => plan.onDate(item.id, date) > 0),
    [scopeItems, plan, date],
  );

  /** Everything counted except this sheet, so "done before" and the BOQ check exclude it. */
  const actualsBefore = useMemo(
    () => indexDprActuals(entries, { excludeEntryId: existing?.id }),
    [entries, existing?.id],
  );

  const suggestions = useMemo(() => dprSuggestions(entries), [entries]);

  const loadForDate = useCallback(() => {
    const filed = entries.find((entry) => entry.date === date && entry.scope === scope) ?? null;
    setExisting(filed);
    setMessages(null);
    setConfirming(false);
    if (filed) {
      setSheet(sheetFromEntry(filed));
      return;
    }
    // Nothing planned for the day: one blank row rather than an empty table, so the recorder can
    // pick the BOQ line worked and type the actual straight away.
    setSheet(
      emptySheet(
        plannedItems.length > 0 ? plannedItems.map((item) => blankRow(item.id)) : [blankRow()],
      ),
    );
  }, [entries, date, scope, plannedItems]);

  // Loading a filed sheet into an editable form is the "sync state from an external system" case
  // effects are for: the register is the source, and a new date or scope must re-seed every field.
  useEffect(() => {
    if (isLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadForDate();
  }, [isLoading, loadForDate]);

  const locked = existing?.status === "Submitted";
  const editable = canRecord && !locked;

  /** Every edit drops a pending "Submit anyway": the warnings were about the sheet as it was. */
  const edit = (change: (previous: SheetState) => SheetState) => {
    setConfirming(false);
    setSheet(change);
  };
  const editRow = (id: string, patch: Partial<RowState>) =>
    edit((previous) => ({
      ...previous,
      rows: previous.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  const editManpower = (id: string, patch: Partial<ManpowerState>) =>
    edit((previous) => ({
      ...previous,
      manpower: previous.manpower.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  const editEquipment = (id: string, patch: Partial<EquipmentState>) =>
    edit((previous) => ({
      ...previous,
      equipment: previous.equipment.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));

  /** Scope and date live in the URL too, so a refresh or a shared link opens the same sheet. */
  const changeSheet = (next: { scope?: DprScope; date?: string }) => {
    const nextScope = next.scope ?? scope;
    const nextDate = next.date ?? date;
    if (next.scope) setScope(next.scope);
    if (next.date !== undefined) setDate(next.date);
    if (mappingId && parseIsoDate(nextDate)) {
      router.replace(dprHref(`${DPR_BASE_PATH}/entry`, mappingId, { scope: nextScope, date: nextDate }), {
        scroll: false,
      });
    }
  };

  const weatherOptions = useMemo(() => {
    const options = [...settings.weatherOptions];
    // A sheet filed before the list changed keeps its own value selectable.
    if (sheet.weather && !options.some((option) => option.toLowerCase() === sheet.weather.toLowerCase())) {
      options.push(sheet.weather);
    }
    return options;
  }, [settings.weatherOptions, sheet.weather]);

  const enteredCount = sheet.rows.filter((row) => row.actual.trim() !== "").length;
  const headcount = sheet.manpower.reduce((sum, row) => sum + dprNumber(row.count), 0);

  /* ── Saving ────────────────────────────────────────────────────────────────────────────── */

  const sheetForCheck = (): DprSheet => ({
    scope,
    date,
    weather: sheet.weather,
    lines: sheet.rows.map((row) => ({
      boqItemId: row.boqItemId,
      actual: row.actual,
      location: row.location,
      remarks: row.remarks,
    })),
    manpower: sheet.manpower.map((row) => ({ trade: row.trade, count: row.count })),
    equipment: sheet.equipment.map((row) => ({
      name: row.name,
      deployed: row.deployed,
      runningHours: row.runningHours,
      idleHours: row.idleHours,
    })),
    lostTimeHours: sheet.lostTimeHours,
    lostTimeReason: sheet.lostTimeReason,
    hindrances: sheet.hindrances,
  });

  const buildDraft = (status: DprStatus): DprEntryDraft => {
    const lines: StoredLine[] = sheet.rows
      .filter((row) => row.boqItemId)
      .map((row) => {
        const item = itemById.get(row.boqItemId);
        const decimals = decimalsFor(item?.unit ?? "");
        return {
          id: row.id,
          boqItemId: row.boqItemId,
          boqSlNo: item?.boqSlNo ?? "",
          erpSlNo: item?.erpSlNo ?? "",
          description: item?.description ?? "",
          unit: item?.unit ?? "",
          // A snapshot of the plan as it stands, so the log can show plan against actual.
          plannedQty: roundToDecimals(plan.onDate(row.boqItemId, date), decimals),
          actualQty: dprNumber(row.actual),
          actualEntered: row.actual.trim() !== "",
          location: row.location.trim(),
          agency: row.agency.trim(),
          remarks: row.remarks.trim(),
        };
      });
    const manpower: DprManpowerLine[] = sheet.manpower
      .filter((row) => row.trade.trim())
      .map((row) => ({ id: row.id, trade: row.trade.trim(), count: dprNumber(row.count) }));
    const equipment: DprEquipmentLine[] = sheet.equipment
      .filter((row) => row.name.trim())
      .map((row) => ({
        id: row.id,
        name: row.name.trim(),
        // Blank means the one unit the row describes.
        deployed: row.deployed.trim() === "" ? 1 : dprNumber(row.deployed),
        runningHours: dprNumber(row.runningHours),
        idleHours: dprNumber(row.idleHours),
      }));
    return {
      scope,
      date,
      status,
      lines,
      manpower,
      equipment,
      weather: sheet.weather.trim(),
      lostTimeHours: dprNumber(sheet.lostTimeHours),
      lostTimeReason: sheet.lostTimeReason.trim(),
      hindrances: sheet.hindrances.trim(),
      remarks: sheet.remarks.trim(),
      preparedByName: user?.name ?? "",
    };
  };

  const handleSave = async (status: "Draft" | "Submitted") => {
    if (!globalProjectId || !user || !editable) return;

    if (!parseIsoDate(date)) {
      setMessages({ errors: ["Pick the date this progress was recorded on."], warnings: [] });
      return;
    }
    if (date > today) {
      setMessages({ errors: ["Future dates cannot be recorded."], warnings: [] });
      return;
    }

    const draft = buildDraft(status);
    if (status === "Submitted") {
      const check = checkDprSheet({
        sheet: sheetForCheck(),
        items: itemById as ReadonlyMap<string, DprBoqLike>,
        plan,
        actuals: actualsBefore,
        settings,
        projectDates,
        today,
        canRecordAnyDate: canReopen,
      });
      // The structural guard catches anything the sheet checks do not word themselves.
      const errors =
        check.errors.length > 0 ? check.errors : validateDprEntry(draft).map((error) => error.message);
      if (errors.length > 0 || (check.warnings.length > 0 && !confirming)) {
        setMessages({ errors, warnings: check.warnings });
        setConfirming(errors.length === 0);
        return;
      }
    }

    setIsSaving(true);
    try {
      // New sheets are keyed by scope and date, so two people opening the same empty day cannot
      // file two sheets for it.
      const entryRef = existing
        ? doc(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION, existing.id)
        : doc(collection(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION), `${scope}-${date}`);
      const audit = existing
        ? { updatedAt: serverTimestamp(), updatedBy: user.id, updatedByName: user.name ?? "" }
        : {
            createdAt: serverTimestamp(),
            createdBy: user.id,
            createdByName: user.name ?? "",
            updatedAt: serverTimestamp(),
            updatedBy: user.id,
            updatedByName: user.name ?? "",
          };
      const submitted =
        status === "Submitted"
          ? { submittedAt: serverTimestamp(), submittedBy: user.id, submittedByName: user.name ?? "" }
          : {};
      await setDoc(entryRef, { ...draft, ...audit, ...submitted }, { merge: true });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: status === "Submitted" ? "Submit Daily Progress" : "Save Daily Progress Draft",
        details: {
          project: projectName,
          scope,
          date,
          status,
          lines: draft.lines.length,
          linesWorked: draft.lines.filter((line) => line.actualQty > 0).length,
        },
      });

      toast({
        title: status === "Submitted" ? "Sheet submitted and locked" : "Draft saved",
        description: `${scope} progress for ${date}.`,
      });
      setMessages(null);
      setConfirming(false);
      await reload();
    } catch (error) {
      console.error("Failed to save the daily progress sheet:", error);
      toast({
        title: "Save failed",
        description: "The daily progress sheet could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReopen = async () => {
    if (!globalProjectId || !user || !existing || !canReopen) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION, existing.id), {
        status: "Draft",
        reopenedAt: serverTimestamp(),
        reopenedBy: user.id,
        reopenedByName: user.name ?? "",
        updatedAt: serverTimestamp(),
        updatedBy: user.id,
        updatedByName: user.name ?? "",
      });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Reopen Daily Progress",
        details: { project: projectName, scope, date },
      });
      toast({ title: "Reopened as a draft", description: `${scope} progress for ${date}.` });
      await reload();
    } catch (error) {
      console.error("Failed to reopen the daily progress sheet:", error);
      toast({
        title: "Reopen failed",
        description: "The sheet could not be reopened.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Guards ────────────────────────────────────────────────────────────────────────────── */

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

  const actionButtons = locked ? (
    canReopen ? (
      <Button variant="outline" disabled={isSaving} onClick={() => void handleReopen()}>
        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlock className="mr-2 h-4 w-4" />}
        Reopen
      </Button>
    ) : (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Only a DPR approver can reopen this sheet.
      </span>
    )
  ) : (
    <>
      <Button
        variant="outline"
        disabled={!canRecord || isSaving || isLoading}
        onClick={() => void handleSave("Draft")}
      >
        Save draft
      </Button>
      <Button disabled={!canRecord || isSaving || isLoading} onClick={() => void handleSave("Submitted")}>
        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
        {confirming ? "Submit anyway" : "Submit"}
      </Button>
    </>
  );

  const statusReadout = locked ? (
    <StatusBadge status="Submitted" tone="success" dot>
      Submitted, locked
    </StatusBadge>
  ) : existing?.status === "Draft" ? (
    <StatusBadge status="Draft" tone="warning" dot>
      Draft
    </StatusBadge>
  ) : (
    <span className="text-sm text-muted-foreground">New sheet</span>
  );

  const lockedBy = locked
    ? existing?.submittedByName || existing?.updatedByName || existing?.createdByName || ""
    : "";

  return (
    <DprPageShell>
      <DprHeader
        active="record"
        mappingId={mappingId}
        projectName={projectName}
        title={existing ? "Edit daily progress" : "Record progress"}
      />

      {!canRecord ? (
        <Card className="border-amber-500/40">
          <CardContent className="p-4 text-sm text-muted-foreground">
            You can read this register but not record against it. Ask for the Add action on{" "}
            {DPR_PERMISSION_RESOURCE}.
          </CardContent>
        </Card>
      ) : null}

      {/* ── Sheet header ─────────────────────────────────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardContent className="space-y-3 p-4">
          {/* Every control and the sheet's actions on one line; it wraps only on a narrow screen. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[8rem] flex-1 space-y-1.5">
              <Label htmlFor="dpr-scope">Scope</Label>
              <Select value={scope} onValueChange={(next) => changeSheet({ scope: next as DprScope })}>
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
            <div className="min-w-[9rem] flex-1 space-y-1.5">
              <Label htmlFor="dpr-date">Date</Label>
              <Input
                id="dpr-date"
                type="date"
                value={date}
                max={today}
                onChange={(event) => changeSheet({ date: event.target.value })}
              />
            </div>
            <div className="min-w-[8rem] flex-1 space-y-1.5">
              {/* h-6: the height a bare Label takes, so this label lines up with the others. */}
              <div className="flex h-6 items-center gap-1.5">
                <Label htmlFor="dpr-weather">Weather</Label>
                <InfoTip label="About “Weather”">
                  A fixed list, set under Daily Progress › Settings. Required before the sheet can be
                  submitted.
                </InfoTip>
              </div>
              <Select
                // "" keeps the Select controlled and shows the placeholder (Radix 2.x), so moving to
                // a sheet with no weather clears the previous one instead of leaving it showing.
                value={sheet.weather}
                disabled={!editable}
                onValueChange={(next) => edit((previous) => ({ ...previous, weather: next }))}
              >
                <SelectTrigger id="dpr-weather" className="text-left">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {weatherOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[10rem] flex-1 space-y-1.5">
              <Label>Status</Label>
              <div
                className="flex h-10 items-center rounded-md border border-border/60 bg-muted/40 px-3"
                title={lockedBy ? `Submitted by ${lockedBy}` : undefined}
              >
                {statusReadout}
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actionButtons}</div>
          </div>
          {messages ? (
            <DprMessages
              errors={messages.errors}
              warnings={messages.warnings}
              errorTitle="Fix these before submitting"
              warningTitle={
                messages.errors.length > 0 ? "Also check" : "Check these, then press “Submit anyway”"
              }
            />
          ) : null}
        </CardContent>
      </Card>

      <fieldset disabled={!editable} className="min-w-0 space-y-4">
        {/* ── Work done ──────────────────────────────────────────────────────────────────── */}
        <Card className="border-border/60">
          <SectionHeader
            title="Work done"
            description="Planned today comes from Projections and cannot be typed here. Done before is everything submitted on the line, this sheet excluded. Enter an actual on every row, 0 if no work was done."
            descriptionAs="info"
            icon={ClipboardList}
            badge={
              <span className="text-xs font-normal text-muted-foreground">
                {sheet.rows.length} line{sheet.rows.length === 1 ? "" : "s"}, {enteredCount} with a
                quantity entered
              </span>
            }
            className="p-4 pb-0"
          />
          <CardContent className="p-0">
            {scopeItems.length === 0 ? (
              <PmEmptyState
                icon={ClipboardList}
                title={`No ${scope} BOQ lines on this project`}
                description={`BOQ items are read as ${scope} when their Scope 2 column says so. Import or tag them first.`}
              />
            ) : (
              <>
                {plannedItems.length === 0 && !existing ? (
                  <p className="border-y border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                    Nothing is planned for {scope} on this date. Record what was actually done — a
                    projection is a reference, not a precondition. Plans are set in{" "}
                    <Link
                      href={dprHref(`${DPR_BASE_PATH}/targets`, mappingId)}
                      className="underline underline-offset-2"
                    >
                      Projections
                    </Link>
                    .
                  </p>
                ) : null}
                {/* One line per BOQ line, all of it inside the table: fixed columns, a bounded
                    height under a pinned header, and a narrow screen scrolls it sideways. */}
                <Table
                  stickyHeader
                  containerClassName="max-h-[65vh]"
                  className="min-w-[1252px] table-fixed"
                >
                  <colgroup>
                    <col className="w-[72px]" />
                    <col />
                    <col className="w-[76px]" />
                    <col className="w-[100px]" />
                    <col className="w-[130px]" />
                    <col className="w-[120px]" />
                    <col className="w-[150px]" />
                    <col className="w-[150px]" />
                    <col className="w-[170px]" />
                    <col className="w-[48px]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="truncate">SL No</TableHead>
                      <TableHead className="truncate">BOQ line</TableHead>
                      <TableHead className="truncate">Unit</TableHead>
                      <TableHead className="truncate text-right">Planned today</TableHead>
                      <TableHead className="truncate text-right" title="Submitted before this sheet, of the BOQ quantity">
                        Done / BOQ
                      </TableHead>
                      <TableHead className="truncate text-right">Actual</TableHead>
                      <TableHead className="truncate">Location</TableHead>
                      <TableHead className="truncate">Agency</TableHead>
                      <TableHead className="truncate">Remarks</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">Remove</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheet.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                          No lines yet. Add the BOQ lines worked on this day.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sheet.rows.map((row, index) => {
                        const item = itemById.get(row.boqItemId);
                        const decimals = decimalsFor(item?.unit ?? "");
                        const planned = row.boqItemId ? plan.onDate(row.boqItemId, date) : 0;
                        const doneBefore = row.boqItemId ? actualsBefore.total(row.boqItemId) : 0;
                        const label = item?.boqSlNo || `row ${index + 1}`;
                        return (
                          <TableRow key={row.id}>
                            <TableCell
                              className="truncate text-sm font-semibold tabular-nums"
                              title={item?.boqSlNo}
                            >
                              {item?.boqSlNo || "—"}
                            </TableCell>
                            <TableCell className="py-1.5">
                              {/* A sub-item sits indented by its depth, its parents in the tooltip. */}
                              <div
                                className="flex min-w-0 items-center gap-1"
                                style={(item?.depth ?? 0) > 0 ? { paddingLeft: (item?.depth ?? 0) * 16 } : undefined}
                                title={item?.path ? breakdownTitle(item) : undefined}
                              >
                                {(item?.depth ?? 0) > 0 ? <DprBranchMark /> : null}
                                <div className="min-w-0 flex-1">
                                  <DprBoqPicker
                                    compact
                                    showSlNo={false}
                                    items={scopeItems}
                                    value={row.boqItemId}
                                    disabled={!editable}
                                    ariaLabel={`BOQ line for ${label}`}
                                    onChange={(boqItemId) => editRow(row.id, { boqItemId })}
                                  />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="truncate text-sm" title={item?.unit}>
                              {item?.unit || "—"}
                            </TableCell>
                            <TableCell className="truncate text-right text-sm tabular-nums">
                              {planned > 0 ? (
                                formatQtyAt(planned, decimals)
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell
                              className="truncate text-right text-sm tabular-nums"
                              title={
                                item && item.boqQty > 0
                                  ? `${formatQtyAt(doneBefore, decimals)} of ${formatQtyAt(item.boqQty, decimals)} ${item.unit}`
                                  : undefined
                              }
                            >
                              {item ? (
                                <>
                                  {formatQtyAt(doneBefore, decimals)}
                                  {item.boqQty > 0 ? (
                                    <span className="text-xs text-muted-foreground">
                                      {" / "}
                                      {formatQtyAt(item.boqQty, decimals)}
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                type="number"
                                min={0}
                                step={decimals === 0 ? "1" : "0.001"}
                                inputMode={decimals === 0 ? "numeric" : "decimal"}
                                placeholder="0"
                                aria-label={`Actual quantity for ${label}`}
                                className="h-8 w-full min-w-0 text-right tabular-nums"
                                value={row.actual}
                                onChange={(event) => editRow(row.id, { actual: event.target.value })}
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                className="h-8 w-full min-w-0"
                                list="dpr-locations"
                                aria-label={`Location for ${label}`}
                                value={row.location}
                                onChange={(event) => editRow(row.id, { location: event.target.value })}
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                className="h-8 w-full min-w-0"
                                list="dpr-agencies"
                                aria-label={`Agency for ${label}`}
                                value={row.agency}
                                onChange={(event) => editRow(row.id, { agency: event.target.value })}
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                className="h-8 w-full min-w-0"
                                aria-label={`Remarks for ${label}`}
                                value={row.remarks}
                                onChange={(event) => editRow(row.id, { remarks: event.target.value })}
                              />
                            </TableCell>
                            <TableCell className="py-1.5 text-right">
                              {editable ? (
                                <Button
                                  size="icon"
                                  className="h-8 w-8"
                                  variant="ghost"
                                  aria-label={`Remove ${label}`}
                                  onClick={() =>
                                    edit((previous) => ({
                                      ...previous,
                                      rows: previous.rows.filter((candidate) => candidate.id !== row.id),
                                    }))
                                  }
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                {editable ? (
                  <div className="border-t border-border/60 p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => edit((previous) => ({ ...previous, rows: [...previous.rows, blankRow()] }))}
                    >
                      <Plus className="mr-1.5 h-4 w-4" /> Add BOQ line
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Site diary ─────────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-border/60">
            <SectionHeader
              title="Manpower"
              description="Headcount by trade. Required when any work is recorded; each headcount is a whole number above zero."
              descriptionAs="info"
              icon={Users}
              badge={
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {headcount} on site
                </span>
              }
              className="p-4 pb-0"
            />
            <CardContent className="space-y-2 p-4">
              {sheet.manpower.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-border/60">
                  <Table stickyHeader containerClassName="max-h-[40vh]" className="table-fixed">
                    <colgroup>
                      <col />
                      <col className="w-[120px]" />
                      <col className="w-[48px]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="truncate">Trade</TableHead>
                        <TableHead className="truncate text-right">Headcount</TableHead>
                        <TableHead className="text-right">
                          <span className="sr-only">Remove</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sheet.manpower.map((row, index) => (
                        <TableRow key={row.id}>
                          <TableCell className="py-1.5">
                            <Input
                              className="h-8 w-full min-w-0"
                              list="dpr-trades"
                              placeholder="Mason, fitter, rigger…"
                              aria-label={`Trade, row ${index + 1}`}
                              value={row.trade}
                              onChange={(event) => editManpower(row.id, { trade: event.target.value })}
                            />
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Input
                              className="h-8 w-full min-w-0 text-right tabular-nums"
                              type="number"
                              min={0}
                              step="1"
                              inputMode="numeric"
                              placeholder="0"
                              aria-label={`Headcount, row ${index + 1}`}
                              value={row.count}
                              onChange={(event) => editManpower(row.id, { count: event.target.value })}
                            />
                          </TableCell>
                          <TableCell className="py-1.5 text-right">
                            {editable ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                aria-label={`Remove trade, row ${index + 1}`}
                                onClick={() =>
                                  edit((previous) => ({
                                    ...previous,
                                    manpower: previous.manpower.filter((candidate) => candidate.id !== row.id),
                                  }))
                                }
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
              {sheet.manpower.length === 0 && !editable ? (
                <p className="text-sm text-muted-foreground">No manpower recorded.</p>
              ) : null}
              {editable ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    edit((previous) => ({
                      ...previous,
                      manpower: [...previous.manpower, { id: nanoid(), trade: "", count: "" }],
                    }))
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Add trade
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <SectionHeader
              title="Plant and equipment"
              description="What was on site and how long it worked. Running and idle hours together cannot exceed 24 a day for each unit deployed."
              descriptionAs="info"
              icon={Truck}
              className="p-4 pb-0"
            />
            <CardContent className="space-y-3 p-4">
              {sheet.equipment.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-border/60">
                  <Table stickyHeader containerClassName="max-h-[40vh]" className="min-w-[460px] table-fixed">
                    <colgroup>
                      <col />
                      <col className="w-[72px]" />
                      <col className="w-[96px]" />
                      <col className="w-[96px]" />
                      <col className="w-[48px]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="truncate">Equipment</TableHead>
                        <TableHead className="truncate text-right">Nos</TableHead>
                        <TableHead className="truncate text-right">Running hrs</TableHead>
                        <TableHead className="truncate text-right">Idle hrs</TableHead>
                        <TableHead className="text-right">
                          <span className="sr-only">Remove</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sheet.equipment.map((row, index) => (
                        <TableRow key={row.id}>
                          <TableCell className="py-1.5">
                            <Input
                              className="h-8 w-full min-w-0"
                              list="dpr-equipment"
                              placeholder="Excavator, crane…"
                              aria-label={`Equipment, row ${index + 1}`}
                              value={row.name}
                              onChange={(event) => editEquipment(row.id, { name: event.target.value })}
                            />
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Input
                              type="number"
                              min={0}
                              step="1"
                              inputMode="numeric"
                              placeholder="1"
                              aria-label={`Number deployed, row ${index + 1}`}
                              className="h-8 w-full min-w-0 text-right tabular-nums"
                              value={row.deployed}
                              onChange={(event) => editEquipment(row.id, { deployed: event.target.value })}
                            />
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Input
                              type="number"
                              min={0}
                              step="0.5"
                              inputMode="decimal"
                              placeholder="0"
                              aria-label={`Running hours, row ${index + 1}`}
                              className="h-8 w-full min-w-0 text-right tabular-nums"
                              value={row.runningHours}
                              onChange={(event) => editEquipment(row.id, { runningHours: event.target.value })}
                            />
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Input
                              type="number"
                              min={0}
                              step="0.5"
                              inputMode="decimal"
                              placeholder="0"
                              aria-label={`Idle hours, row ${index + 1}`}
                              className="h-8 w-full min-w-0 text-right tabular-nums"
                              value={row.idleHours}
                              onChange={(event) => editEquipment(row.id, { idleHours: event.target.value })}
                            />
                          </TableCell>
                          <TableCell className="py-1.5 text-right">
                            {editable ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                aria-label={`Remove equipment, row ${index + 1}`}
                                onClick={() =>
                                  edit((previous) => ({
                                    ...previous,
                                    equipment: previous.equipment.filter((candidate) => candidate.id !== row.id),
                                  }))
                                }
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
              {sheet.equipment.length === 0 && !editable ? (
                <p className="text-sm text-muted-foreground">No plant recorded.</p>
              ) : null}
              {editable ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    edit((previous) => ({
                      ...previous,
                      equipment: [
                        ...previous.equipment,
                        { id: nanoid(), name: "", deployed: "1", runningHours: "", idleHours: "" },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Add equipment
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60">
          <SectionHeader
            title="Lost time, hindrances and remarks"
            description="The basis for any delay the day caused. Time lost above zero needs a reason; a planned line left at zero needs a row remark or a hindrance."
            descriptionAs="info"
            icon={CloudSun}
            className="p-4 pb-0"
          />
          {/* Time lost and its reason on one line; hindrances and remarks side by side under it. */}
          <CardContent className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="dpr-lost-hours">Time lost (hrs, max {settings.shiftHours})</Label>
              <Input
                id="dpr-lost-hours"
                type="number"
                min={0}
                max={settings.shiftHours}
                step="0.5"
                inputMode="decimal"
                value={sheet.lostTimeHours}
                onChange={(event) => edit((previous) => ({ ...previous, lostTimeHours: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dpr-lost-reason">Reason</Label>
              <Input
                id="dpr-lost-reason"
                placeholder="Rain, power failure, material shortage…"
                value={sheet.lostTimeReason}
                onChange={(event) => edit((previous) => ({ ...previous, lostTimeReason: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dpr-hindrances">Hindrances</Label>
              <Textarea
                id="dpr-hindrances"
                rows={2}
                placeholder="Blockers raised today and who they sit with."
                value={sheet.hindrances}
                onChange={(event) => edit((previous) => ({ ...previous, hindrances: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dpr-remarks">Remarks</Label>
              <Textarea
                id="dpr-remarks"
                rows={2}
                placeholder="Anything else the day should be remembered by."
                value={sheet.remarks}
                onChange={(event) => edit((previous) => ({ ...previous, remarks: event.target.value }))}
              />
            </div>
          </CardContent>
        </Card>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2 pb-4">{actionButtons}</div>

      {/* Values already used on this project's sheets, offered as the recorder types. */}
      <datalist id="dpr-locations">
        {suggestions.locations.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="dpr-agencies">
        {suggestions.agencies.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="dpr-trades">
        {suggestions.trades.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="dpr-equipment">
        {suggestions.equipment.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </DprPageShell>
  );
}
