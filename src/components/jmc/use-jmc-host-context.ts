"use client";

/**
 * Resolves `?project={mappingId}` into the JMC context the Project Management copies of the JMC
 * screens run against.
 *
 * Billing Recon identifies its project by URL slug, available synchronously from the route params.
 * Project Management identifies it by a `projectManagementProjects` mapping document that has to be
 * read before the global project id is known — so this reports an explicit resolving state, and the
 * screens hold their skeleton until it settles rather than briefly rendering as though no project
 * were selected.
 *
 * See src/lib/jmc-module.ts for why the two hosts differ only in these few respects.
 */

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PM_PROJECT_COLLECTION } from "@/lib/project-management-projects";
import { projectManagementJmcContext, type PmJmcContext } from "@/lib/jmc-module";

export interface PmJmcContextState {
  context: PmJmcContext;
  /** True while the mapping document is being read. */
  isResolving: boolean;
  /** True when no mapping id was supplied, or it names a mapping that does not exist. */
  notFound: boolean;
  /** The mapped project's Project Management name, for page subtitles. */
  projectName: string;
}

export function useProjectManagementJmcContext(mappingId: string): PmJmcContextState {
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
    () => projectManagementJmcContext(mappingId, globalProjectId),
    [mappingId, globalProjectId],
  );

  return { context, isResolving, notFound, projectName };
}
