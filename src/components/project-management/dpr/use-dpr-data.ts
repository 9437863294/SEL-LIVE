"use client";

/**
 * The data every DPR screen needs: the project mapping, this project's Civil/Erection BOQ lines,
 * and the register's entries and projections.
 *
 * Resolving `?project={mappingId}` to the global project id takes a read of its own, so the
 * resolving state is reported explicitly and the screens hold their skeleton rather than briefly
 * rendering as though no project were selected (same shape as use-survey-host-context.ts).
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
import {
  DPR_SETTINGS_COLLECTION,
  DPR_SETTINGS_DOC_ID,
  buildDprPlan,
  defaultDprSettings,
  dprCalendar,
  dprProjectDates,
  dprUnitDecimals,
  sanitizeDprSettings,
  type DprPlan,
  type DprSettings,
} from "@/lib/project-management-dpr-plan";
import {
  DPR_SUB_ITEM_COLLECTION,
  buildDprBreakdown,
  type DprBreakdown,
  type DprSubItem,
} from "@/lib/project-management-dpr-breakdown";

/** A BOQ line with the raw document kept alongside, for screens that need other columns. */
export interface DprBoqItem extends DprBoqLike {
  scope: DprScope;
  raw: Record<string, unknown>;
  /** "sub" for a work-breakdown sub-item standing in for part of a BOQ line. */
  kind?: "boq" | "sub";
  /** The BOQ line a sub-item belongs to. */
  rootBoqItemId?: string;
  /** 0 for a BOQ line, 1 for its sub-items, 2 for theirs… */
  depth?: number;
  /** "7 Earthing system › 7.2 GI strip" — the lines above a sub-item, for its tooltip. */
  path?: string;
}

export interface DprDataState {
  globalProjectId: string;
  /** The Project Management mapping id from `?project=`. */
  mappingId: string;
  projectName: string;
  /** This project's DPR settings (Daily Progress › Settings), or the defaults when none are saved. */
  settings: DprSettings;
  /** Whether a settings document exists yet. */
  settingsSaved: boolean;
  /** The project record's own dates, before any DPR override. */
  projectRecordDates: { startDate: string; endDate: string };
  /** Start and completion the checks use: the DPR setting, else the project record's. */
  projectDates: { startDate: string; endDate: string };
  /** The planning engine over `targets` with this project's calendar and unit precision. */
  plan: DprPlan;
  /** Decimal places for a unit under this project's settings. */
  decimalsFor: (unit: string) => number;
  isResolving: boolean;
  notFound: boolean;
  /**
   * What progress is planned and recorded against: BOQ lines with no sub-items, and the lowest
   * sub-items of those that have them. A BOQ line with sub-items is a group and is not listed here.
   */
  boqItems: DprBoqItem[];
  /** Every Civil/Erection BOQ line, groups included — the roots of the work breakdown. */
  boqLines: DprBoqItem[];
  subItems: DprSubItem[];
  /** The work breakdown: the tree, each node's share, and the roll-up of leaf figures to groups. */
  breakdown: DprBreakdown;
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

/**
 * The register, loaded once by the module layout and shared with every Daily Progress screen, so
 * moving between Dashboard, Projections, Record and the rest does not re-read the whole register.
 */
const DprDataContext = createContext<DprDataState | null>(null);

export function DprDataProvider({
  mappingId,
  canRead,
  children,
}: {
  mappingId: string;
  canRead: boolean;
  children: ReactNode;
}) {
  const value = useDprDataSource(mappingId, canRead);
  return createElement(DprDataContext.Provider, { value }, children);
}

/**
 * The screens' entry point. Inside the module layout it returns the shared register (the layout's
 * own load, for the same `?project=`); outside one it loads its own, as it always did.
 */
export function useDprData(mappingId: string, canRead: boolean): DprDataState {
  const shared = useContext(DprDataContext);
  const useShared = Boolean(shared && shared.mappingId === mappingId);
  // Hooks cannot be skipped, so the local load is handed no project when the shared one applies.
  const own = useDprDataSource(useShared ? "" : mappingId, useShared ? false : canRead);
  return useShared && shared ? shared : own;
}

function useDprDataSource(mappingId: string, canRead: boolean): DprDataState {
  const [globalProjectId, setGlobalProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectRecordDates, setProjectRecordDates] = useState({ startDate: "", endDate: "" });
  const [settings, setSettings] = useState<DprSettings>(() => defaultDprSettings());
  const [settingsSaved, setSettingsSaved] = useState(false);
  /**
   * The mapping id the resolved state above belongs to.
   *
   * Resolving is derived from this rather than held as its own flag: that needs no setState on the
   * way *into* the effect, and it means switching projects reads as resolving immediately instead
   * of briefly showing the previous project's data as though it were the new one's.
   */
  const [resolvedFor, setResolvedFor] = useState("");

  const [boqLines, setBoqLines] = useState<DprBoqItem[]>([]);
  const [subItems, setSubItems] = useState<DprSubItem[]>([]);
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
          ? (snapshot.data() as {
              globalProjectId?: unknown;
              projectName?: unknown;
              startDate?: unknown;
              endDate?: unknown;
            })
          : null;
        setGlobalProjectId(String(data?.globalProjectId ?? ""));
        setProjectName(String(data?.projectName ?? ""));
        setProjectRecordDates({
          startDate: typeof data?.startDate === "string" ? data.startDate : "",
          endDate: typeof data?.endDate === "string" ? data.endDate : "",
        });
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
      const [boqSnapshot, entrySnapshot, targetSnapshot, settingsSnapshot, subItemSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", globalProjectId, DPR_ENTRY_COLLECTION)),
        getDocs(collection(db, "projects", globalProjectId, DPR_TARGET_COLLECTION)),
        // A settings read that fails must not take the register down with it: the defaults
        // reproduce how figures were worked out before settings existed.
        getDoc(doc(db, "projects", globalProjectId, DPR_SETTINGS_COLLECTION, DPR_SETTINGS_DOC_ID)).catch(
          (error: unknown) => {
            console.error("Failed to read the DPR settings; using the defaults:", error);
            return null;
          },
        ),
        // Likewise the work breakdown: without it every BOQ line is simply its own leaf.
        getDocs(collection(db, "projects", globalProjectId, DPR_SUB_ITEM_COLLECTION)).catch(
          (error: unknown) => {
            console.error("Failed to read the DPR work breakdown:", error);
            return null;
          },
        ),
      ]);
      setSubItems(
        (subItemSnapshot?.docs ?? []).map(
          (subDoc) => ({ id: subDoc.id, ...subDoc.data() }) as DprSubItem,
        ),
      );
      setSettings(sanitizeDprSettings(settingsSnapshot?.exists() ? settingsSnapshot.data() : null));
      setSettingsSaved(Boolean(settingsSnapshot?.exists()));

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
          // The same columns the Civil hub prices lines from. Only weights achievement here.
          rate: dprNumber(raw["Budget Price"] ?? raw["Unit Rate"] ?? raw.Rate ?? raw.rate),
          raw,
        });
      }
      items.sort(compareByErpSlNo);

      setBoqLines(items);
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

  const decimalsFor = useCallback((unit: string) => dprUnitDecimals(unit, settings), [settings]);

  const breakdown = useMemo(() => buildDprBreakdown(boqLines, subItems), [boqLines, subItems]);

  /** The leaves, as BOQ items: a sub-item stands in for its share of its BOQ line. */
  const boqItems = useMemo<DprBoqItem[]>(() => {
    const lineById = new Map(boqLines.map((line) => [line.id, line]));
    return breakdown.leaves.flatMap((node): DprBoqItem[] => {
      const line = lineById.get(node.boqItemId);
      if (!line) return [];
      if (node.kind === "boq") return [{ ...line, kind: "boq", rootBoqItemId: line.id, depth: 0 }];
      return [
        {
          id: node.id,
          kind: "sub",
          scope: line.scope,
          boqSlNo: node.slNo,
          erpSlNo: line.erpSlNo,
          description: node.description,
          unit: node.unit,
          boqQty: node.qty,
          // Its share of the line's value, so value-weighted figures still add up to the line.
          rate: node.rate,
          raw: line.raw,
          rootBoqItemId: line.id,
          depth: node.depth,
          path: node.ancestors
            .map((ancestor) => `${ancestor.slNo} ${ancestor.description}`.trim())
            .join(" › "),
        },
      ];
    });
  }, [boqLines, breakdown]);

  const plan = useMemo(() => {
    // A projection is spread at its BOQ line's current unit, falling back to the unit it was saved with.
    const unitById = new Map(boqItems.map((item) => [item.id, item.unit]));
    return buildDprPlan(targets, {
      calendar: dprCalendar(settings),
      decimalsFor: (target) => dprUnitDecimals(unitById.get(target.boqItemId) || target.unit, settings),
    });
  }, [targets, boqItems, settings]);

  const projectDates = useMemo(
    () => dprProjectDates(settings, projectRecordDates),
    [settings, projectRecordDates],
  );

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
      mappingId,
      projectName,
      settings,
      settingsSaved,
      projectRecordDates,
      projectDates,
      plan,
      decimalsFor,
      isResolving,
      // No project in the URL, or one whose mapping did not resolve to a global project.
      notFound: !mappingId || (!isResolving && !globalProjectId),
      boqItems,
      boqLines,
      subItems,
      breakdown,
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
      settings,
      settingsSaved,
      projectRecordDates,
      projectDates,
      plan,
      decimalsFor,
      isResolving,
      boqItems,
      boqLines,
      subItems,
      breakdown,
      entries,
      targets,
      isLoading,
      loadError,
      reload,
    ],
  );
}
