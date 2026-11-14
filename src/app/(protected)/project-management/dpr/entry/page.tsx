"use client";

/**
 * Record progress — one sheet per scope per day.
 *
 * The screen itself is `DprEntryView` (`components/project-management/dpr/entry-view.tsx`), which
 * holds the sheet and every rule about it and takes all it reads as props. This page only resolves
 * the project and the permissions, keeps the sheet's scope and date in the URL, shows the loading /
 * denied / not-found states, and does the writes:
 *
 *  - **Save draft / Submit** write the sheet. A new sheet is keyed `{scope}-{date}`, so two people
 *    opening the same empty day cannot file two sheets for it; an existing one is merged into.
 *    Submitting stamps who submitted, which locks the sheet.
 *  - **Reopen** (a DPR approver, the `Reopen` action) turns a submitted sheet back into a draft.
 *
 * Each write is logged to the user's activity and reloads the register, which re-seeds the sheet
 * from what was stored.
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
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
  parseIsoDate,
  type DprEntry,
  type DprScope,
} from "@/lib/project-management-dpr";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import { DprEntryView, type DprEntrySaveRequest } from "@/components/project-management/dpr/entry-view";
import {
  DprAccessDenied,
  DprLoadingState,
  DprProjectNotFound,
  dprHref,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";

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
  const data = useDprData(mappingIdParam, canView);
  const { globalProjectId, mappingId, projectName, isResolving, notFound, reload } = data;

  const initialScope = searchParams?.get("scope");
  const [scope, setScope] = useState<DprScope>(
    DPR_SCOPES.includes(initialScope as DprScope) ? (initialScope as DprScope) : "Civil",
  );
  const [date, setDate] = useState(() => {
    const fromUrl = searchParams?.get("date") ?? "";
    return parseIsoDate(fromUrl) ? fromUrl : todayIso();
  });

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

  const handleSave = async ({ draft, status, existing }: DprEntrySaveRequest): Promise<boolean> => {
    if (!globalProjectId || !user) return false;
    try {
      // New sheets are keyed by scope and date, so two people opening the same empty day cannot
      // file two sheets for it.
      const entryRef = existing
        ? doc(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION, existing.id)
        : doc(collection(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION), `${draft.scope}-${draft.date}`);
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
          scope: draft.scope,
          date: draft.date,
          status,
          lines: draft.lines.length,
          linesWorked: draft.lines.filter((line) => line.actualQty > 0).length,
        },
      });

      toast({
        title: status === "Submitted" ? "Sheet submitted and locked" : "Draft saved",
        description: `${draft.scope} progress for ${draft.date}.`,
      });
      await reload();
      return true;
    } catch (error) {
      console.error("Failed to save the daily progress sheet:", error);
      toast({
        title: "Save failed",
        description: "The daily progress sheet could not be saved.",
        variant: "destructive",
      });
      return false;
    }
  };

  const handleReopen = async (existing: DprEntry): Promise<boolean> => {
    if (!globalProjectId || !user || !canReopen) return false;
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
        details: { project: projectName, scope: existing.scope, date: existing.date },
      });
      toast({ title: "Reopened as a draft", description: `${existing.scope} progress for ${existing.date}.` });
      await reload();
      return true;
    } catch (error) {
      console.error("Failed to reopen the daily progress sheet:", error);
      toast({
        title: "Reopen failed",
        description: "The sheet could not be reopened.",
        variant: "destructive",
      });
      return false;
    }
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
      onReopen={handleReopen}
    />
  );
}
