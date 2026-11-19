"use client";

/**
 * JMC's page registry and the register the whole module shares.
 *
 * The module gained a sidebar, so the pages have to be named in one place rather than listed again
 * in every screen's back link — that list is `JMC_TABS`. The workflow stages are not in it: they
 * are configured per installation, read from `workflows/jmc-workflow`, and the sidebar builds an
 * entry for each.
 *
 * The register (workflow + entries) is loaded once by the module layout and shared, so the
 * dashboard's figures and the sidebar's waiting count cost one read between them instead of one
 * each, and moving between pages does not re-read the register.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import {
  BarChart3,
  FilePlus,
  History,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { PM_JMC_BASE_PATH } from "@/lib/jmc-module";
import type { ModuleNavTone } from "@/components/shared/module-shell";
import {
  summariseJmcRegister,
  type JmcDashboardReading,
  type JmcRegisterEntry,
  type JmcWorkflowStepLike,
} from "@/lib/project-management-jmc-dashboard";

export type JmcTabKey = "dashboard" | "entry" | "log" | "reports" | "settings";

export interface JmcTab {
  key: JmcTabKey;
  label: string;
  /** The path under the module, empty for the dashboard. */
  path: string;
  icon: LucideIcon;
  tone: ModuleNavTone;
}

export const JMC_TABS: readonly JmcTab[] = [
  { key: "dashboard", label: "Dashboard", path: "", icon: LayoutDashboard, tone: "emerald" },
  { key: "entry", label: "Create JMC", path: "entry", icon: FilePlus, tone: "green" },
  { key: "log", label: "JMC Log", path: "log", icon: History, tone: "amber" },
  { key: "reports", label: "Reports", path: "reports", icon: BarChart3, tone: "pink" },
  { key: "settings", label: "Settings", path: "settings", icon: Settings, tone: "slate" },
];

/** A link to a JMC page, carrying the project on. Mirrors `PmJmcContext.jmcHref`. */
export const jmcTabHref = (path: string, mappingId: string): string => {
  if (!mappingId) return "#";
  const base = path ? `${PM_JMC_BASE_PATH}/${path}` : PM_JMC_BASE_PATH;
  return `${base}?project=${encodeURIComponent(mappingId)}`;
};

/** A stage page's path, from its configured step id. */
export const jmcStagePath = (stepId: string): string => `stage/${stepId}`;

export interface JmcRegisterState {
  projectName: string;
  steps: JmcWorkflowStepLike[];
  entries: JmcRegisterEntry[];
  reading: JmcDashboardReading;
  isLoading: boolean;
  loadError: string;
  reload: () => Promise<void>;
}

const EMPTY_READING: JmcDashboardReading = {
  count: 0,
  completed: 0,
  inProgress: 0,
  totalValue: 0,
  certifiedValue: 0,
  stages: [],
  months: [],
  oldestWaitingDays: null,
};

const JmcRegisterContext = createContext<JmcRegisterState | null>(null);

export function JmcRegisterProvider({
  mappingId,
  globalProjectId,
  canRead,
  projectName,
  children,
}: {
  mappingId: string;
  /** The mapped `projects/{id}`; empty until the mapping document has been read. */
  globalProjectId: string;
  canRead: boolean;
  projectName: string;
  children: ReactNode;
}) {
  const [steps, setSteps] = useState<JmcWorkflowStepLike[]>([]);
  const [entries, setEntries] = useState<JmcRegisterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    if (!canRead || !globalProjectId) {
      setSteps([]);
      setEntries([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const [workflowSnapshot, entriesSnapshot] = await Promise.all([
        getDoc(doc(db, "workflows", "jmc-workflow")),
        getDocs(
          query(collection(db, "projects", globalProjectId, "jmcEntries"), orderBy("createdAt", "desc")),
        ),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? (workflowSnapshot.data()?.steps as unknown)
        : [];
      setSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && (step as { name?: unknown }).name)
          .map((step, index) => ({
            id: String((step as { id?: unknown }).id || index + 1),
            name: String((step as { name?: unknown }).name),
          })),
      );

      setEntries(
        entriesSnapshot.docs.map((snapshot) => ({
          ...(snapshot.data() as Record<string, unknown>),
          id: snapshot.id,
        })) as JmcRegisterEntry[],
      );
    } catch (error) {
      console.error("Failed to load the JMC register:", error);
      // Shown on the dashboard rather than raised as a toast: the sidebar stays usable, and a
      // module whose figures failed to load must not claim the register is empty.
      setLoadError("The JMC register could not be loaded.");
      setSteps([]);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [canRead, globalProjectId]);

  useEffect(() => {
    // `load` sets its own loading flag as it starts, which the rule reads as a setState in this
    // effect. Reading the register when the project resolves is precisely what an effect is for —
    // synchronising React with an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const value = useMemo<JmcRegisterState>(
    () => ({
      projectName,
      steps,
      entries,
      reading: loadError
        ? EMPTY_READING
        : summariseJmcRegister({ entries, steps, now: new Date() }),
      isLoading,
      loadError,
      reload: load,
    }),
    [projectName, steps, entries, isLoading, loadError, load],
  );

  return <JmcRegisterContext.Provider value={value}>{children}</JmcRegisterContext.Provider>;
}

/**
 * The shared register. Returns the empty reading outside the provider, so a JMC screen rendered on
 * its own (a print route, a test) still renders rather than throwing.
 */
export function useJmcRegister(): JmcRegisterState {
  return (
    useContext(JmcRegisterContext) ?? {
      projectName: "",
      steps: [],
      entries: [],
      reading: EMPTY_READING,
      isLoading: false,
      loadError: "",
      reload: async () => {},
    }
  );
}
