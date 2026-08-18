"use client";

/**
 * Resolves `?project={mappingId}` into the context the Inspection screens run against.
 *
 * Same shape as the other module equivalents: the mapping document has to be read before the global
 * project id is known, so this reports an explicit resolving state and the screens hold their
 * skeleton rather than briefly rendering as though no project were selected.
 */

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PM_PROJECT_COLLECTION } from "@/lib/project-management-projects";
import {
  projectManagementInspectionContext,
  type PmInspectionContext,
} from "@/lib/project-management-inspection-workflow";

export interface PmInspectionContextState {
  context: PmInspectionContext;
  isResolving: boolean;
  notFound: boolean;
  projectName: string;
}

export function useProjectManagementInspectionContext(mappingId: string): PmInspectionContextState {
  const [globalProjectId, setGlobalProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [isResolving, setIsResolving] = useState(Boolean(mappingId));
  const [notFound, setNotFound] = useState(!mappingId);

  useEffect(() => {
    if (!mappingId) {
      setGlobalProjectId("");
      setProjectName("");
      setIsResolving(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    setIsResolving(true);
    setNotFound(false);
    void (async () => {
      try {
        const snapshot = await getDoc(doc(db, PM_PROJECT_COLLECTION, mappingId));
        if (cancelled) return;
        const data = snapshot.exists()
          ? (snapshot.data() as { globalProjectId?: unknown; projectName?: unknown })
          : null;
        const mapped = String(data?.globalProjectId ?? "");
        setGlobalProjectId(mapped);
        setProjectName(String(data?.projectName ?? ""));
        setNotFound(!mapped);
      } catch (error) {
        console.error("Failed to resolve the Project Management project mapping:", error);
        if (!cancelled) {
          setGlobalProjectId("");
          setProjectName("");
          setNotFound(true);
        }
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mappingId]);

  const context = useMemo(
    () => projectManagementInspectionContext(mappingId, globalProjectId),
    [mappingId, globalProjectId],
  );

  return { context, isResolving, notFound, projectName };
}
