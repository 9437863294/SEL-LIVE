"use client";

/**
 * MVAC's page registry and the register the whole module shares.
 *
 * The module gained a sidebar, so the pages are named in one place rather than listed again in
 * every screen's back link — that list is `MVAC_TABS`. The workflow stages are not in it: they
 * are configured per installation, read from `workflows/pm-mvac-workflow`, and the sidebar builds
 * an entry for each.
 *
 * The register (workflow + certificates + their lines) is loaded once by the module layout and
 * shared, so the dashboard's figures and the sidebar's waiting counts cost one read between them
 * instead of one each. The *picker* on the create screen is not loaded here — it needs the whole
 * supply chain, which is a much larger read, and only one screen wants it.
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
import { collection, doc, getDoc, getDocs, query } from "firebase/firestore";
import {
  BarChart3,
  FilePlus,
  History,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { PM_MVAC_BASE_PATH, PM_MVAC_WORKFLOW_ID } from "@/lib/project-management-mvac-module";
import { supplyStage } from "@/lib/project-management-supply-ledger";
import type { ModuleNavTone } from "@/components/shared/module-shell";
import {
  summariseMvacRegister,
  type MvacDashboardReading,
  type MvacDocLike,
  type MvacItemLike,
} from "@/lib/project-management-mvac-dashboard";
import type { WorkflowStepLike } from "@/lib/workflow-run-position";
import type { WorkflowStep } from "@/lib/types";

export type MvacTabKey = "dashboard" | "new" | "documents" | "reports" | "settings";

export interface MvacTab {
  key: MvacTabKey;
  label: string;
  /** The path under the module, empty for the dashboard. */
  path: string;
  icon: LucideIcon;
  tone: ModuleNavTone;
}

export const MVAC_TABS: readonly MvacTab[] = [
  { key: "dashboard", label: "Dashboard", path: "", icon: LayoutDashboard, tone: "rose" },
  { key: "new", label: "Create MVAC", path: "new", icon: FilePlus, tone: "pink" },
  { key: "documents", label: "MVAC Register", path: "documents", icon: History, tone: "amber" },
  { key: "reports", label: "Reports", path: "reports", icon: BarChart3, tone: "cyan" },
  { key: "settings", label: "Settings", path: "settings", icon: Settings, tone: "slate" },
];

export const mvacTabPath = (key: MvacTabKey): string =>
  MVAC_TABS.find((tab) => tab.key === key)?.path ?? "";

export { PM_MVAC_BASE_PATH };

export interface MvacRegisterState {
  projectName: string;
  /** The configured run, as the sidebar and the stage pages read it. */
  steps: WorkflowStepLike[];
  /** The same steps whole, for the stage pages that need assignees, TAT and actions. */
  workflow: WorkflowStep[];
  docs: MvacDocLike[];
  items: MvacItemLike[];
  reading: MvacDashboardReading;
  isLoading: boolean;
  loadError: string;
  reload: () => Promise<void>;
}

const EMPTY_READING: MvacDashboardReading = {
  count: 0,
  drafts: 0,
  cancelled: 0,
  inWorkflow: 0,
  completed: 0,
  lines: 0,
  presentedQty: 0,
  acceptedQty: 0,
  rejectedQty: 0,
  vendors: 0,
  stages: [],
  months: [],
  oldestWaitingDays: null,
};

const MvacRegisterContext = createContext<MvacRegisterState | null>(null);

export function MvacRegisterProvider({
  globalProjectId,
  canRead,
  projectName,
  children,
}: {
  /** The mapped `projects/{id}`; empty until the mapping document has been read. */
  globalProjectId: string;
  canRead: boolean;
  projectName: string;
  children: ReactNode;
}) {
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [docs, setDocs] = useState<MvacDocLike[]>([]);
  const [items, setItems] = useState<MvacItemLike[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    if (!canRead || !globalProjectId) {
      setWorkflow([]);
      setDocs([]);
      setItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const definition = supplyStage("mvac");
      const [workflowSnapshot, docsSnapshot, itemsSnapshot] = await Promise.all([
        getDoc(doc(db, "workflows", PM_MVAC_WORKFLOW_ID)),
        getDocs(query(collection(db, "projects", globalProjectId, definition.headerCollection))),
        getDocs(query(collection(db, "projects", globalProjectId, definition.itemCollection))),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? (workflowSnapshot.data()?.steps as unknown)
        : [];
      setWorkflow(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && (step as { name?: unknown }).name)
          .map((step, index) => ({
            ...(step as WorkflowStep),
            id: String((step as { id?: unknown }).id || index + 1),
            name: String((step as { name?: unknown }).name),
          })),
      );

      setDocs(
        docsSnapshot.docs.map((snapshot) => ({
          ...(snapshot.data() as Record<string, unknown>),
          id: snapshot.id,
        })) as MvacDocLike[],
      );
      setItems(
        itemsSnapshot.docs.map((snapshot) => ({
          ...(snapshot.data() as Record<string, unknown>),
          id: snapshot.id,
        })) as MvacItemLike[],
      );
    } catch (error) {
      console.error("Failed to load the MVAC register:", error);
      // Shown on the dashboard rather than raised as a toast: the sidebar stays usable, and a
      // module whose figures failed to load must not claim the register is empty.
      setLoadError("The MVAC register could not be loaded.");
      setWorkflow([]);
      setDocs([]);
      setItems([]);
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

  const value = useMemo<MvacRegisterState>(() => {
    const steps: WorkflowStepLike[] = workflow.map((step) => ({
      id: String(step.id),
      name: String(step.name),
    }));
    return {
      projectName,
      steps,
      workflow,
      docs,
      items,
      reading: loadError
        ? EMPTY_READING
        : summariseMvacRegister({ docs, items, steps, now: new Date() }),
      isLoading,
      loadError,
      reload: load,
    };
  }, [projectName, workflow, docs, items, isLoading, loadError, load]);

  return <MvacRegisterContext.Provider value={value}>{children}</MvacRegisterContext.Provider>;
}

/**
 * The shared register. Returns the empty reading outside the provider, so an MVAC screen rendered
 * on its own (a print route, a test) still renders rather than throwing.
 */
export function useMvacRegister(): MvacRegisterState {
  return (
    useContext(MvacRegisterContext) ?? {
      projectName: "",
      steps: [],
      workflow: [],
      docs: [],
      items: [],
      reading: EMPTY_READING,
      isLoading: false,
      loadError: "",
      reload: async () => {},
    }
  );
}
