"use client";

/**
 * Record progress — one sheet per scope per day — and every sheet filed so far.
 *
 * Two views, as tabs in the headline band:
 *  - **Record a day**: the sheet editor, `DprEntryView` (`components/project-management/dpr/entry-view.tsx`),
 *    which holds the sheet and every rule about it and takes all it reads as props.
 *  - **Progress records**: every sheet, newest first, with the BOQ lines on it
 *    (`entry-records-list.tsx`). A record opens to show its lines, manpower, plant and diary
 *    (`entry-record.tsx`); Edit opens it in the sheet editor, where lines are changed, added and
 *    taken off. A submitted sheet is locked: a DPR approver (the `Reopen` action) reopens it as a
 *    draft first, after a confirm, because a draft stops counting until it is submitted again.
 *
 * The view, the sheet's scope and date, and the open record (`record`, `edit=1`) live in the URL,
 * so a refresh or a shared link lands in the same place. This page resolves the project and the
 * permissions and shows the loading / denied / not-found states; the writes (save, submit, reopen,
 * delete) are `useDprSheetActions`, shared with the Log.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardPen, ListChecks } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DPR_BASE_PATH,
  DPR_PERMISSION_RESOURCE,
  DPR_SCOPES,
  parseIsoDate,
  type DprEntry,
  type DprScope,
} from "@/lib/project-management-dpr";
import {
  dprRecordEditAction,
  type DprRecordAccess,
} from "@/lib/project-management-dpr-progress-records";
import { dprCalendar } from "@/lib/project-management-dpr-plan";
import { dprLatestRecordingDay, dprScopeScheduleOf } from "@/lib/project-management-dpr-schedule";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import { useDprSheetActions } from "@/components/project-management/dpr/use-dpr-sheet-actions";
import { DprEntryView, type DprEntrySaveRequest } from "@/components/project-management/dpr/entry-view";
import { ProgressRecordList } from "@/components/project-management/dpr/entry-records-list";
import { ProgressRecordView, ReopenSheetDialog } from "@/components/project-management/dpr/entry-record";
import {
  DPR_TABS,
  DprAccessDenied,
  DprLoadingState,
  DprPageShell,
  DprProjectNotFound,
  dprHref,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { DprReportsHero, type DprReportTab } from "@/components/project-management/dpr/reports-hero";
import { Card, CardContent } from "@/components/ui/card";

type ViewId = "sheet" | "records";
type RecordMode = "view" | "edit";

/** The two views, as tabs in the headline band. */
const VIEWS: readonly DprReportTab<ViewId>[] = [
  { id: "sheet", label: "Record a day", icon: ClipboardPen, colours: ["#c4b5fd", "#7c3aed"] },
  { id: "records", label: "Progress records", icon: ListChecks, colours: ["#6ee7b7", "#059669"] },
];

const RECORD_TAB = DPR_TABS.find((tab) => tab.key === "record")!;

export default function RecordDailyProgressPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canRecord = !isAuthLoading && can("Add", DPR_PERMISSION_RESOURCE);
  const canReopen = !isAuthLoading && can("Reopen", DPR_PERMISSION_RESOURCE);
  const canDelete = !isAuthLoading && can("Delete", DPR_PERMISSION_RESOURCE);
  const access: DprRecordAccess = useMemo(
    () => ({ canRecord, canReopen, canDelete }),
    [canRecord, canReopen, canDelete],
  );

  const mappingIdParam = searchParams?.get("project") ?? "";
  const data = useDprData(mappingIdParam, canView);
  const { globalProjectId, mappingId, projectName, isResolving, notFound, reload } = data;
  const { saveSheet, reopenSheet, deleteSheet } = useDprSheetActions({
    globalProjectId,
    projectName,
    reload,
    canReopen,
    canDelete,
  });
  // Fixed for the life of the screen, so the list and the record agree across midnight.
  const [today] = useState(todayIso);

  const initialScope = searchParams?.get("scope");
  const [scope, setScope] = useState<DprScope>(
    DPR_SCOPES.includes(initialScope as DprScope) ? (initialScope as DprScope) : "Civil",
  );
  /**
   * A date given in the address or picked by hand. Until there is one, the sheet opens on the
   * scope's latest recording day on or before today (Daily Progress › Settings › Recording
   * schedule) — today itself on a daily scope's working day — and follows the scope when it changes.
   */
  const [chosenDate, setChosenDate] = useState<string | null>(() => {
    const fromUrl = searchParams?.get("date") ?? "";
    return parseIsoDate(fromUrl) ? fromUrl : null;
  });
  const scheduledDate = useMemo(
    () =>
      dprLatestRecordingDay(
        dprScopeScheduleOf(data.settings.recordingSchedule, scope),
        dprCalendar(data.settings),
        today,
      ) ?? today,
    [data.settings, scope, today],
  );
  const date = chosenDate ?? scheduledDate;
  /** The sheet's place in the address: its scope, and its date only once one was chosen. */
  const sheetQuery = (nextScope: DprScope, nextChosen: string | null): Record<string, string> =>
    nextChosen ? { scope: nextScope, date: nextChosen } : { scope: nextScope };
  const [view, setView] = useState<ViewId>(searchParams?.get("view") === "records" ? "records" : "sheet");
  /** The open progress record (a sheet's id), and whether it is open in the sheet editor. */
  const [recordId, setRecordId] = useState<string | null>(searchParams?.get("record") || null);
  const [recordMode, setRecordMode] = useState<RecordMode>(searchParams?.get("edit") === "1" ? "edit" : "view");
  /** A submitted record waiting on "Reopen and edit" to be confirmed. */
  const [reopening, setReopening] = useState<DprEntry | null>(null);

  const openRecord = useMemo(
    () => (recordId ? (data.entries.find((entry) => entry.id === recordId) ?? null) : null),
    [data.entries, recordId],
  );

  /** Scope and date live in the URL too, so a refresh or a shared link opens the same sheet. */
  const changeSheet = (next: { scope?: DprScope; date?: string }) => {
    const nextScope = next.scope ?? scope;
    const nextChosen = next.date !== undefined ? next.date : chosenDate;
    if (next.scope) setScope(next.scope);
    if (next.date !== undefined) setChosenDate(next.date);
    // Picking another day or scope while editing a record leaves the record for that sheet.
    setView("sheet");
    setRecordId(null);
    setRecordMode("view");
    // A half-typed date stays out of the address; no date at all follows the schedule.
    if (mappingId && (nextChosen === null || parseIsoDate(nextChosen))) {
      router.replace(dprHref(`${DPR_BASE_PATH}/entry`, mappingId, sheetQuery(nextScope, nextChosen)), {
        scroll: false,
      });
    }
  };

  /** The records view, the open record and its mode, kept in the URL. */
  const showRecord = useCallback(
    (id: string | null, mode: RecordMode = "view") => {
      setView("records");
      setRecordId(id);
      setRecordMode(mode);
      const query: Record<string, string> = { view: "records" };
      if (id) query.record = id;
      if (id && mode === "edit") query.edit = "1";
      router.replace(dprHref(`${DPR_BASE_PATH}/entry`, mappingId, query), { scroll: true });
    },
    [router, mappingId],
  );

  const changeView = (next: string) => {
    if (next === "records") {
      showRecord(null);
      return;
    }
    setView("sheet");
    setRecordId(null);
    setRecordMode("view");
    router.replace(dprHref(`${DPR_BASE_PATH}/entry`, mappingId, sheetQuery(scope, chosenDate)), {
      scroll: false,
    });
  };

  const handleSave = async (request: DprEntrySaveRequest): Promise<boolean> => {
    const savedId = await saveSheet(request);
    if (!savedId) return false;
    // Edited from a progress record: back to the record, showing what was saved.
    if (view === "records" && recordId) showRecord(savedId, "view");
    return true;
  };

  /** Edit a record: straight into the sheet editor, or — submitted — reopened first, after a confirm. */
  const requestEdit = (entry: DprEntry) => {
    const action = dprRecordEditAction(entry, access);
    if (!action.allowed) return;
    if (action.reopenFirst) setReopening(entry);
    else showRecord(entry.id, "edit");
  };

  const confirmReopen = async () => {
    if (!reopening) return;
    const reopened = await reopenSheet(reopening);
    // Throwing keeps the dialog open for a retry; the failure was already reported.
    if (!reopened) throw new Error("The sheet was not reopened.");
    showRecord(reopening.id, "edit");
  };

  const handleDelete = async (entry: DprEntry): Promise<boolean> => {
    const deleted = await deleteSheet(entry);
    if (deleted && entry.id === recordId) showRecord(null);
    return deleted;
  };

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

  const reopenDialog = (
    <ReopenSheetDialog entry={reopening} onClose={() => setReopening(null)} onConfirm={confirmReopen} />
  );

  // A record open in the sheet editor: the editor, with a way back to the record.
  if (view === "records" && recordId && recordMode === "edit" && (openRecord || data.isLoading)) {
    return (
      <>
        {openRecord ? (
          <DprEntryView
            key={`record-${openRecord.id}`}
            data={data}
            mappingId={mappingId}
            scope={openRecord.scope}
            date={openRecord.date}
            onSheetChange={changeSheet}
            canRecord={canRecord}
            canReopen={canReopen}
            preparedByName={user?.name ?? ""}
            onSave={handleSave}
            onReopen={reopenSheet}
            tabs={VIEWS}
            activeTab="records"
            onTabChange={changeView}
            onBack={() => showRecord(openRecord.id, "view")}
          />
        ) : (
          <DprLoadingState blocks={2} />
        )}
        {reopenDialog}
      </>
    );
  }

  if (view === "records") {
    return (
      <DprPageShell>
        <DprReportsHero
          mappingId={mappingId}
          projectName={projectName}
          title={RECORD_TAB.label}
          description="Every sheet filed on this project, with the BOQ lines recorded on it. Open one to see it, or edit it in the sheet."
          icon={RECORD_TAB.icon}
          band="violet"
          tabs={VIEWS}
          active="records"
          onTabChange={changeView}
        />
        {data.loadError ? (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{data.loadError}</CardContent>
          </Card>
        ) : null}
        {recordId ? (
          <ProgressRecordView
            key={recordId}
            data={data}
            entry={openRecord}
            access={access}
            onBack={() => showRecord(null)}
            onEdit={requestEdit}
            onDelete={handleDelete}
            today={today}
          />
        ) : (
          <ProgressRecordList
            data={data}
            access={access}
            onOpen={(entry) => showRecord(entry.id, "view")}
            onEdit={requestEdit}
            onDelete={handleDelete}
            onRecordDay={() => changeView("sheet")}
            today={today}
          />
        )}
        {reopenDialog}
      </DprPageShell>
    );
  }

  return (
    <DprEntryView
      data={data}
      mappingId={mappingId}
      scope={scope}
      date={date}
      onSheetChange={changeSheet}
      canRecord={canRecord}
      canReopen={canReopen}
      preparedByName={user?.name ?? ""}
      onSave={handleSave}
      onReopen={reopenSheet}
      tabs={VIEWS}
      activeTab="sheet"
      onTabChange={changeView}
    />
  );
}
