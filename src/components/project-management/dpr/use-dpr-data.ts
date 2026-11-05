"use client";

/**
 * The data every DPR screen needs: the project mapping, this project's Civil/Erection BOQ lines,
 * and the register's entries and projections.
 *
 * Resolving `?project={mappingId}` to the global project id takes a read of its own, so the
 * resolving state is reported explicitly and the screens hold their skeleton rather than briefly
 * rendering as though no project were selected (same shape as use-survey-host-context.ts).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PM_PROJECT_COLLECTION } from "@/lib/project-management-projects";
import { isBoqSectionHeader } from "@/lib/project-management-boq-columns";
import { readBoqSlNo, readErpSlNo, compareByErpSlNo } from "@/lib/civil-execution";
import {
  DPR_ENTRY_COLLECTION,
  DPR_TARGET_COLLECTION,
  dprNumber,
  type DprBoqLike,
  type DprEntry,
  type DprScope,
  type DprTarget,
} from "@/lib/project-management-dpr";

/** A BOQ line with the raw document kept alongside, for screens that need other columns. */
export interface DprBoqItem extends DprBoqLike {
  scope: DprScope;
  raw: Record<string, unknown>;
}

export interface DprDataState {
  globalProjectId: string;
  projectName: string;
  isResolving: boolean;
  notFound: boolean;
  boqItems: DprBoqItem[];
  entries: DprEntry[];
  targets: DprTarget[];
  isLoading: boolean;
  loadError: string;
  reload: () => Promise<void>;
}

const readText = (item: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = item[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
};

/** `Scope 2` carries Civil / Erection, the same column the execution workspaces filter on. */
const readScope = (item: Record<string, unknown>): DprScope | null => {
  const value = String(item["Scope 2"] ?? "").trim().toLowerCase();
  if (value === "civil") return "Civil";
  if (value === "erection") return "Erection";
  return null;
};

export function useDprData(mappingId: string, canRead: boolean): DprDataState {
  const [globalProjectId, setGlobalProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  /**
   * The mapping id the resolved state above belongs to.
   *
   * Resolving is derived from this rather than held as its own flag: that needs no setState on the
   * way *into* the effect, and it means switching projects reads as resolving immediately instead
   * of briefly showing the previous project's data as though it were the new one's.
   */
  const [resolvedFor, setResolvedFor] = useState("");

  const [boqItems, setBoqItems] = useState<DprBoqItem[]>([]);
  const [entries, setEntries] = useState<DprEntry[]>([]);
  const [targets, setTargets] = useState<DprTarget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    // No project in the URL is not a state to transition into — it is simply the absence of one,
    // so it is derived below rather than written back through setState from inside this effect.
    if (!mappingId || mappingId === resolvedFor) return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getDoc(doc(db, PM_PROJECT_COLLECTION, mappingId));
        if (cancelled) return;
        const data = snapshot.exists()
          ? (snapshot.data() as { globalProjectId?: unknown; projectName?: unknown })
          : null;
        setGlobalProjectId(String(data?.globalProjectId ?? ""));
        setProjectName(String(data?.projectName ?? ""));
      } catch (error) {
        console.error("Failed to resolve the Project Management project mapping:", error);
        if (!cancelled) {
          setGlobalProjectId("");
          setProjectName("");
        }
      } finally {
        // Marked resolved either way: a mapping that cannot be read is "not found", not "still
        // loading", or the screens would hold their skeleton for ever.
        if (!cancelled) setResolvedFor(mappingId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mappingId, resolvedFor]);

  const reload = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const [boqSnapshot, entrySnapshot, targetSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION)),
        getDocs(collection(db, "projects", globalProjectId, DPR_TARGET_COLLECTION)),
      ]);

      const items: DprBoqItem[] = [];
      for (const boqDoc of boqSnapshot.docs) {
        const raw = { id: boqDoc.id, ...boqDoc.data() } as Record<string, unknown> & { id: string };
        const scope = readScope(raw);
        // Only the two execution scopes are progressed daily, and a section header is a caption
        // with no quantity behind it.
        if (!scope) continue;
        if (isBoqSectionHeader(raw as { Unit?: unknown; QTY?: unknown })) continue;
        items.push({
          id: raw.id,
          scope,
          boqSlNo: readBoqSlNo(raw),
          erpSlNo: readErpSlNo(raw),
          description: readText(raw, ["Description", "DESCRIPTION OF ITEMS"]),
          unit: readText(raw, ["Unit", "UNIT", "Units"]),
          boqQty: dprNumber(raw.QTY ?? raw.Quantity ?? raw.quantity),
          raw,
        });
      }
      items.sort(compareByErpSlNo);

      setBoqItems(items);
      setEntries(
        entrySnapshot.docs
          .map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() }) as DprEntry)
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
      setTargets(
        targetSnapshot.docs.map(
          (targetDoc) => ({ id: targetDoc.id, ...targetDoc.data() }) as DprTarget,
        ),
      );
    } catch (error) {
      console.error("Failed to load the daily progress register:", error);
      setLoadError("The daily progress register could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId]);

  const isResolving = Boolean(mappingId) && mappingId !== resolvedFor;

  useEffect(() => {
    // Nothing to load without a resolved project or the right to read it; "not loading" is derived
    // below rather than written back through setState from inside this effect.
    if (isResolving || !canRead || !globalProjectId) return;
    // `reload` sets its own loading flag as it starts, which the rule reads as a setState in this
    // effect. Fetching when the project resolves is precisely what the effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [canRead, globalProjectId, isResolving, reload]);

  return useMemo(
    () => ({
      globalProjectId,
      projectName,
      isResolving,
      // No project in the URL, or one whose mapping did not resolve to a global project.
      notFound: !mappingId || (!isResolving && !globalProjectId),
      boqItems,
      entries,
      targets,
      // The initial `true` means "a load is coming"; where none is, the screens must not be left
      // holding a skeleton for ever.
      isLoading: isLoading && canRead && Boolean(globalProjectId),
      loadError,
      reload,
    }),
    [
      mappingId,
      canRead,
      globalProjectId,
      projectName,
      isResolving,
      boqItems,
      entries,
      targets,
      isLoading,
      loadError,
      reload,
    ],
  );
}
