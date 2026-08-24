"use client";

/**
 * Loads the Tower Progress workspace once and shares it across every screen in the sub-module.
 *
 * The provider is mounted from `tower-progress/layout.tsx`, which the App Router keeps alive while
 * the user moves between the dashboard, the register, a tower and the reports. So a 186-tower project
 * reads its three collections on entry and then navigates instantly, rather than re-reading the whole
 * register on every click — which is what a per-page load would do, since every screen here needs the
 * same two arrays.
 *
 * `reload()` is exposed for after a write. Writes go through the service layer, which recomputes the
 * tower document server-side; reloading afterwards is what brings that recomputation back into view.
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
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_TOWER_PROGRESS_SETTINGS,
  TOWER_PROGRESS_PERMISSION_RESOURCE,
  calculateTowerProgressSummary,
  compareTowers,
  type ProjectTower,
  type TowerProgressSettings,
  type TowerProgressSummary,
  type TowerProgressUpdate,
} from "@/lib/project-management-tower-progress";
import {
  loadTowerProgressWorkspace,
  resolveTowerProjectContext,
  type TowerActor,
  type TowerProjectContext,
} from "@/lib/project-management-tower-service";

const ERECTION_RESOURCE = "Project Management.Erection";

export interface TowerProgressPermissions {
  view: boolean;
  addTower: boolean;
  editTower: boolean;
  deleteTower: boolean;
  importTowers: boolean;
  updateProgress: boolean;
  verifyProgress: boolean;
  viewReports: boolean;
  export: boolean;
  viewSettings: boolean;
  editSettings: boolean;
}

export interface TowerProgressContextValue {
  mappingId: string;
  project: TowerProjectContext | null;
  towers: ProjectTower[];
  updates: TowerProgressUpdate[];
  settings: TowerProgressSettings;
  summary: TowerProgressSummary;
  permissions: TowerProgressPermissions;
  actor: TowerActor | null;
  isLoading: boolean;
  isAuthLoading: boolean;
  notFound: boolean;
  error: string;
  reload: () => Promise<void>;
  towerById: (towerId: string) => ProjectTower | undefined;
}

const TowerProgressContext = createContext<TowerProgressContextValue | null>(null);

export function useTowerProgress(): TowerProgressContextValue {
  const value = useContext(TowerProgressContext);
  if (!value) {
    throw new Error("useTowerProgress must be used inside the Tower Progress layout.");
  }
  return value;
}

export function TowerProgressProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [project, setProject] = useState<TowerProjectContext | null>(null);
  const [towers, setTowers] = useState<ProjectTower[]>([]);
  const [updates, setUpdates] = useState<TowerProgressUpdate[]>([]);
  const [settings, setSettings] = useState<TowerProgressSettings>(DEFAULT_TOWER_PROGRESS_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  /**
   * Tower Progress has its own permission resource, but an existing Erection right also grants the
   * equivalent action. Without that fallback the feature would be invisible to everyone on the day it
   * ships — including the site engineers who already hold Erection rights — until an administrator
   * had gone through every role. The module already pairs resources this way (Erection falls back to
   * BOQ, JMC to Billing Recon), so this follows the same rule rather than inventing one.
   */
  const permissions = useMemo<TowerProgressPermissions>(() => {
    const allow = (action: string, erectionAction?: string) =>
      can(action, TOWER_PROGRESS_PERMISSION_RESOURCE) ||
      (erectionAction ? can(erectionAction, ERECTION_RESOURCE) : false);
    return {
      view: allow("View", "View"),
      addTower: allow("Add Tower", "Add"),
      editTower: allow("Edit Tower", "Edit"),
      deleteTower: allow("Delete Tower", "Delete"),
      importTowers: allow("Import Towers", "Add"),
      updateProgress: allow("Update Progress", "Edit"),
      // Verification is a distinct authority — an engineer who can record progress must not be able
      // to sign off their own claim — so it never falls back to a generic Erection edit right.
      verifyProgress: allow("Verify Progress"),
      viewReports: allow("View Reports", "View"),
      export: allow("Export", "Export"),
      viewSettings: allow("View Settings"),
      editSettings: allow("Edit Settings"),
    };
  }, [can]);

  const actor = useMemo<TowerActor | null>(
    () => (user ? { id: user.id, name: user.name, email: user.email } : null),
    [user],
  );

  const load = useCallback(async () => {
    if (!mappingId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const resolved = await resolveTowerProjectContext(mappingId);
      if (!resolved) {
        setProject(null);
        setNotFound(true);
        return;
      }
      setProject(resolved);
      setNotFound(false);
      const workspace = await loadTowerProgressWorkspace(resolved.globalProjectId);
      setTowers([...workspace.towers].sort(compareTowers));
      setUpdates(workspace.updates);
      setSettings(workspace.settings);
    } catch (loadError) {
      console.error("Failed to load the Tower Progress workspace:", loadError);
      setError("The tower register could not be loaded. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }, [mappingId]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!permissions.view) {
      setIsLoading(false);
      return;
    }
    void load();
  }, [isAuthLoading, permissions.view, load]);

  const summary = useMemo(
    () => calculateTowerProgressSummary(towers, settings),
    [towers, settings],
  );

  const towerById = useCallback(
    (towerId: string) => towers.find((tower) => tower.id === towerId),
    [towers],
  );

  const value = useMemo<TowerProgressContextValue>(
    () => ({
      mappingId,
      project,
      towers,
      updates,
      settings,
      summary,
      permissions,
      actor,
      isLoading,
      isAuthLoading,
      notFound,
      error,
      reload: load,
      towerById,
    }),
    [
      mappingId,
      project,
      towers,
      updates,
      settings,
      summary,
      permissions,
      actor,
      isLoading,
      isAuthLoading,
      notFound,
      error,
      load,
      towerById,
    ],
  );

  return <TowerProgressContext.Provider value={value}>{children}</TowerProgressContext.Provider>;
}
