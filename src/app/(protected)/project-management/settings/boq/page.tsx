"use client";

/**
 * Project Management › Settings › BOQ Column Settings — the container: permissions, the load of
 * saved settings merged with headers found in imported BOQ items, the import scan and the save.
 * Everything on screen is `BoqColumnSettingsView`, which takes these as props.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { BoqColumnSettingsView } from "@/components/project-management/boq-column-settings-view";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  BOQ_COLUMN_SETTINGS_COLLECTION,
  BOQ_COLUMN_SETTINGS_DOC,
  mergeBoqColumns,
  type BoqColumnConfig,
} from "@/lib/project-management-boq-columns";

const SETTINGS_PERMISSION = "Project Management.Settings";
const PROJECT_MAPPINGS_COLLECTION = "projectManagementProjects";

export default function ProjectManagementBoqSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const [columns, setColumns] = useState<BoqColumnConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canView = can("View", SETTINGS_PERMISSION);
  const canEdit = can("Edit", SETTINGS_PERMISSION);

  const discoverImportedKeys = useCallback(async () => {
    const mappingsSnapshot = await getDocs(collection(db, PROJECT_MAPPINGS_COLLECTION));
    const globalProjectIds = Array.from(
      new Set(
        mappingsSnapshot.docs
          .map((mappingDoc) => mappingDoc.data().globalProjectId as string | undefined)
          .filter((projectId): projectId is string => Boolean(projectId)),
      ),
    );

    const itemSnapshots = await Promise.all(
      globalProjectIds.map((projectId) =>
        getDocs(query(collection(db, "projects", projectId, "boqItems"), limit(50))),
      ),
    );

    return Array.from(
      new Set(itemSnapshots.flatMap((snapshot) => snapshot.docs.flatMap((itemDoc) => Object.keys(itemDoc.data())))),
    );
  }, []);

  // Runs once, on arrival: `isLoading` starts true, so nothing is set before the first read.
  const loadColumns = useCallback(async () => {
    try {
      const [settingsSnapshot, discoveredKeys] = await Promise.all([
        getDoc(doc(db, BOQ_COLUMN_SETTINGS_COLLECTION, BOQ_COLUMN_SETTINGS_DOC)),
        discoverImportedKeys(),
      ]);
      setColumns(mergeBoqColumns(settingsSnapshot.data()?.columns, discoveredKeys));
    } catch (error) {
      console.error("Failed to load BOQ column settings:", error);
      setColumns(mergeBoqColumns(undefined));
      toast({
        title: "Unable to load every imported column",
        description: "Default BOQ columns are available and can still be configured.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [discoverImportedKeys, toast]);

  // Without View the load never runs; the render below shows Access Denied whatever `isLoading` says.
  useEffect(() => {
    if (isAuthLoading || !canView) return;
    // Loading from Firestore is the external system effects are for; every setState in
    // `loadColumns` runs after its first await, never synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadColumns();
  }, [canView, isAuthLoading, loadColumns]);

  const saveColumns = useCallback(async (next: BoqColumnConfig[]) => {
    await setDoc(
      doc(db, BOQ_COLUMN_SETTINGS_COLLECTION, BOQ_COLUMN_SETTINGS_DOC),
      { columns: next, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }, []);

  const scanImports = useCallback(
    async (current: BoqColumnConfig[]) => mergeBoqColumns(current, await discoverImportedKeys()),
    [discoverImportedKeys],
  );

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Skeleton className="mb-6 h-28 w-full rounded-3xl" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="BOQ Settings" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access Project Management settings.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] p-4 max-sm:[--card-pad:1rem] sm:p-6">
      <BoqColumnSettingsView
        initialColumns={columns}
        canEdit={canEdit}
        onSave={saveColumns}
        onScanImports={scanImports}
      />
    </main>
  );
}
