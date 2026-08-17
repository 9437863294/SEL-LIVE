"use client";

/**
 * Resolves `?project={mappingId}` into the context the RFQ screens run against.
 *
 * Same shape as the JMC, Survey and Indent equivalents: the mapping document has to be read before
 * the global project id is known, so this reports an explicit resolving state and the screens hold
 * their skeleton rather than briefly rendering as though no project were selected.
 *
 * Also returns the mapped project's global name, which the award screens need when creating a
 * purchase order.
 */

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PM_PROJECT_COLLECTION } from "@/lib/project-management-projects";
import {
  projectManagementRfqContext,
  type PmRfqContext,
} from "@/lib/project-management-rfq-workflow";

export interface PmRfqContextState {
  context: PmRfqContext;
  isResolving: boolean;
  notFound: boolean;
  projectName: string;
  globalProjectName: string;
}

export function useProjectManagementRfqContext(mappingId: string): PmRfqContextState {
  const [globalProjectId, setGlobalProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [globalProjectName, setGlobalProjectName] = useState("");
  const [isResolving, setIsResolving] = useState(Boolean(mappingId));
  const [notFound, setNotFound] = useState(!mappingId);

  useEffect(() => {
    if (!mappingId) {
      setGlobalProjectId("");
      setProjectName("");
      setGlobalProjectName("");
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
          ? (snapshot.data() as {
              globalProjectId?: unknown;
              projectName?: unknown;
              globalProjectName?: unknown;
            })
          : null;
        const mapped = String(data?.globalProjectId ?? "");
        setGlobalProjectId(mapped);
        setProjectName(String(data?.projectName ?? ""));
        setGlobalProjectName(String(data?.globalProjectName ?? ""));
        setNotFound(!mapped);
      } catch (error) {
        console.error("Failed to resolve the Project Management project mapping:", error);
        if (!cancelled) {
          setGlobalProjectId("");
          setProjectName("");
          setGlobalProjectName("");
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
    () => projectManagementRfqContext(mappingId, globalProjectId),
    [mappingId, globalProjectId],
  );

  return { context, isResolving, notFound, projectName, globalProjectName };
}
