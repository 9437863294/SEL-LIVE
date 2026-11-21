"use client";

/**
 * Daily Progress log — every sheet filed on this project, newest first, each with the BOQ lines on
 * it — and each sheet as a progress record, as on Record progress:
 *
 *  - the log itself is `DprLogView` (`components/project-management/dpr/log-view.tsx`);
 *  - `?record=<sheet id>` opens the sheet in full (`ProgressRecordView`, shared with Record progress);
 *  - `&edit=1` opens it in the sheet editor (`DprEntryView`), where lines are changed, added and
 *    taken off. A submitted sheet is reopened first, after a confirm — a DPR approver only.
 *
 * Opening, editing and deleting all stay on the log, so Back returns here. The writes are
 * `useDprSheetActions`, the same as Record progress uses.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { DPR_BASE_PATH, DPR_PERMISSION_RESOURCE, type DprEntry, type DprScope } from "@/lib/project-management-dpr";
import { dprRecordEditAction, type DprRecordAccess } from "@/lib/project-management-dpr-progress-records";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import { useDprSheetActions } from "@/components/project-management/dpr/use-dpr-sheet-actions";
import {
  DPR_TABS,
  DprAccessDenied,
  DprLoadingState,
  DprPageShell,
  DprProjectNotFound,
  dprHref,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { DprLogView } from "@/components/project-management/dpr/log-view";
import { ProgressRecordView, ReopenSheetDialog } from "@/components/project-management/dpr/entry-record";
import { DprEntryView, type DprEntrySaveRequest } from "@/components/project-management/dpr/entry-view";
import { DprReportsHero } from "@/components/project-management/dpr/reports-hero";

type RecordMode = "view" | "edit";

const LOG_TAB = DPR_TABS.find((tab) => tab.key === "log")!;

export default function DprLogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
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

  const data = useDprData(mappingId, canView);
  const { saveSheet, reopenSheet, deleteSheet } = useDprSheetActions({
    globalProjectId: data.globalProjectId,
    projectName: data.projectName,
    reload: data.reload,
    canReopen,
    canDelete,
  });
  // Fixed for the life of the screen, so the log and the record agree across midnight.
  const [today] = useState(todayIso);

  /** The open sheet (its id), and whether it is open in the sheet editor; both in the address. */
  const [recordId, setRecordId] = useState<string | null>(searchParams?.get("record") || null);
  const [recordMode, setRecordMode] = useState<RecordMode>(searchParams?.get("edit") === "1" ? "edit" : "view");
  /** A submitted sheet waiting on "Reopen and edit" to be confirmed. */
  const [reopening, setReopening] = useState<DprEntry | null>(null);

  const openRecord = useMemo(
    () => (recordId ? (data.entries.find((entry) => entry.id === recordId) ?? null) : null),
    [data.entries, recordId],
  );

  const showRecord = useCallback(
    (id: string | null, mode: RecordMode = "view") => {
      setRecordId(id);
      setRecordMode(mode);
      const query: Record<string, string> = {};
      if (id) query.record = id;
      if (id && mode === "edit") query.edit = "1";
      router.replace(dprHref(`${DPR_BASE_PATH}/log`, mappingId, query), { scroll: true });
    },
    [router, mappingId],
  );

  /** Edit a sheet: straight into the editor, or — submitted — reopened first, after a confirm. */
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

  const handleSave = async (request: DprEntrySaveRequest): Promise<boolean> => {
    const savedId = await saveSheet(request);
    if (!savedId) return false;
    // Back to the sheet, showing what was saved.
    showRecord(savedId, "view");
    return true;
  };

  const handleDelete = async (entry: DprEntry): Promise<boolean> => {
    const deleted = await deleteSheet(entry);
    if (deleted && entry.id === recordId) showRecord(null);
    return deleted;
  };

  /** Another scope or day picked in the editor: that sheet is on Record progress. */
  const openOtherSheet = (next: { scope?: DprScope; date?: string }) => {
    if (!openRecord) return;
    router.push(
      dprHref(`${DPR_BASE_PATH}/entry`, mappingId, {
        scope: next.scope ?? openRecord.scope,
        date: next.date ?? openRecord.date,
      }),
    );
  };

  if (isAuthLoading || data.isResolving) return <DprLoadingState blocks={1} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (data.notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening the log."
        href="/project-management"
      />
    );
  }

  const reopenDialog = (
    <ReopenSheetDialog entry={reopening} onClose={() => setReopening(null)} onConfirm={confirmReopen} />
  );

  // A sheet open in the editor, with a way back to it.
  if (recordId && recordMode === "edit" && (openRecord || data.isLoading)) {
    return (
      <>
        {openRecord ? (
          <DprEntryView
            key={`record-${openRecord.id}`}
            data={data}
            mappingId={mappingId}
            scope={openRecord.scope}
            date={openRecord.date}
            onSheetChange={openOtherSheet}
            canRecord={canRecord}
            canReopen={canReopen}
            preparedByName={user?.name ?? ""}
            onSave={handleSave}
            onReopen={reopenSheet}
            onBack={() => showRecord(openRecord.id, "view")}
          />
        ) : (
          <DprLoadingState blocks={2} />
        )}
        {reopenDialog}
      </>
    );
  }

  // A sheet open in full.
  if (recordId) {
    return (
      <DprPageShell>
        <DprReportsHero
          mappingId={mappingId}
          projectName={data.projectName}
          title={LOG_TAB.label}
          description={LOG_TAB.description}
          icon={LOG_TAB.icon}
          band="violet"
        />
        <ProgressRecordView
          key={recordId}
          data={data}
          entry={openRecord}
          access={access}
          onBack={() => showRecord(null)}
          backLabel="Back to the log"
          onEdit={requestEdit}
          onDelete={handleDelete}
          today={today}
        />
        {reopenDialog}
      </DprPageShell>
    );
  }

  return (
    <>
      <DprLogView
        data={data}
        mappingId={mappingId}
        canRecord={canRecord}
        access={access}
        onOpen={(entry) => showRecord(entry.id, "view")}
        onEdit={requestEdit}
        onDelete={handleDelete}
        today={today}
      />
      {reopenDialog}
    </>
  );
}
