"use client";

/**
 * The writes to a Daily Progress sheet, shared by the screens that change one (Record progress and
 * the Log): save a draft or submit, reopen a submitted sheet, delete one that is not submitted.
 *
 *  - **Save / Submit**: a new sheet is keyed `{scope}-{date}`, so two people opening the same empty
 *    day cannot file two sheets for it; an existing one is merged into. Submitting stamps who
 *    submitted, which locks the sheet.
 *  - **Reopen** (a DPR approver, the `Reopen` action) turns a submitted sheet back into a draft.
 *  - **Delete** (the `Delete` action) removes a sheet, never a submitted one.
 *
 * Each write is logged to the user's activity, toasts its outcome and reloads the register, which
 * re-seeds whatever is showing from what was stored.
 */

import { useCallback } from "react";
import { collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { DPR_ENTRY_COLLECTION, type DprEntry } from "@/lib/project-management-dpr";
import type { DprEntrySaveRequest } from "@/components/project-management/dpr/entry-view";
import { formatDisplayDate } from "@/components/project-management/dpr/dpr-shell";

export interface DprSheetActionsInput {
  globalProjectId: string;
  projectName: string;
  reload: () => Promise<void>;
  canReopen: boolean;
  canDelete: boolean;
}

export interface DprSheetActions {
  /** Write the sheet; resolves to its id once written, or null if it was not. */
  saveSheet: (request: DprEntrySaveRequest) => Promise<string | null>;
  /** Turn a submitted sheet back into a draft; resolves true once done. */
  reopenSheet: (entry: DprEntry) => Promise<boolean>;
  /** Delete a sheet that is not submitted; resolves true once done. */
  deleteSheet: (entry: DprEntry) => Promise<boolean>;
}

export function useDprSheetActions({
  globalProjectId,
  projectName,
  reload,
  canReopen,
  canDelete,
}: DprSheetActionsInput): DprSheetActions {
  const { user } = useAuth();
  const { toast } = useToast();

  const saveSheet = useCallback(
    async ({ draft, status, existing }: DprEntrySaveRequest): Promise<string | null> => {
      if (!globalProjectId || !user) return null;
      try {
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
        return entryRef.id;
      } catch (error) {
        console.error("Failed to save the daily progress sheet:", error);
        toast({
          title: "Save failed",
          description: "The daily progress sheet could not be saved.",
          variant: "destructive",
        });
        return null;
      }
    },
    [globalProjectId, user, projectName, toast, reload],
  );

  const reopenSheet = useCallback(
    async (existing: DprEntry): Promise<boolean> => {
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
    },
    [globalProjectId, user, canReopen, projectName, toast, reload],
  );

  const deleteSheet = useCallback(
    async (entry: DprEntry): Promise<boolean> => {
      if (!globalProjectId || !user || !canDelete || entry.status === "Submitted") return false;
      try {
        await deleteDoc(doc(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION, entry.id));
        const lines = entry.lines?.length ?? 0;
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: "Delete Daily Progress",
          details: { project: projectName, scope: entry.scope, date: entry.date, status: entry.status, lines },
        });
        toast({
          title: "Progress record deleted",
          description: `${entry.scope} · ${formatDisplayDate(entry.date)} · ${lines} BOQ line${lines === 1 ? "" : "s"}.`,
        });
        await reload();
        return true;
      } catch (error) {
        console.error("Failed to delete the daily progress sheet:", error);
        toast({
          title: "Delete failed",
          description: "The progress record could not be deleted.",
          variant: "destructive",
        });
        return false;
      }
    },
    [globalProjectId, user, canDelete, projectName, toast, reload],
  );

  return { saveSheet, reopenSheet, deleteSheet };
}
