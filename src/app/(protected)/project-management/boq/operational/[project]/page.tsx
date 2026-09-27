"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ClipboardCheck, HardHat, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  BOQ_COLUMN_SETTINGS_COLLECTION,
  BOQ_COLUMN_SETTINGS_DOC,
  mergeBoqColumns,
  type BoqColumnConfig,
} from "@/lib/project-management-boq-columns";

const BOQ_PERMISSION = "Project Management.BOQ";

const unslugify = (slug: string) =>
  slug
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

export default function OperationalBoqProjectPage() {
  const { project: projectSlug } = useParams() as { project: string };
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading } = useAuthorization();
  const canView = can("View", BOQ_PERMISSION);
  const [operationalColumns, setOperationalColumns] = useState<BoqColumnConfig[]>([]);
  const [isLoadingColumns, setIsLoadingColumns] = useState(true);

  useEffect(() => {
    if (isLoading || !canView) {
      setIsLoadingColumns(false);
      return;
    }

    const loadColumns = async () => {
      setIsLoadingColumns(true);
      try {
        const settingsSnapshot = await getDoc(
          doc(db, BOQ_COLUMN_SETTINGS_COLLECTION, BOQ_COLUMN_SETTINGS_DOC),
        );
        setOperationalColumns(
          mergeBoqColumns(settingsSnapshot.data()?.columns).filter(
            (column) => column.showInOperational,
          ),
        );
      } catch (error) {
        console.error("Failed to load Operational BOQ columns:", error);
        setOperationalColumns(
          mergeBoqColumns(undefined).filter(
            (column) => column.showInOperational,
          ),
        );
      } finally {
        setIsLoadingColumns(false);
      }
    };

    void loadColumns();
  }, [canView, isLoading]);

  if (isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="Operational BOQ" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access Operational BOQ.
            </CardDescription>
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
      <PageHeader
        title="Operational BOQ"
        description={unslugify(projectSlug)}
        icon={ClipboardCheck}
        backHref={
          mappingId
            ? `/project-management/boq?project=${encodeURIComponent(mappingId)}`
            : "/project-management"
        }
        backLabel="Back to BOQ"
        className="mb-0 sm:mb-0"
      />

      <Card className="mt-5 overflow-hidden border-border/60 sm:mt-6">
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 to-purple-600" />
        <CardHeader>
          <CardTitle>Configured Operational BOQ columns</CardTitle>
          <CardDescription>
            These columns are controlled from Project Management → Settings → BOQ Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingColumns ? (
            <Skeleton className="h-10 w-full" />
          ) : operationalColumns.length ? (
            <div className="flex flex-wrap gap-2">
              {operationalColumns.map((column) => (
                <span
                  key={column.key}
                  className="rounded-full border bg-muted/40 px-3 py-1 text-sm"
                  title={column.key}
                >
                  {column.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No columns are enabled for Operational BOQ.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-5 sm:mt-6">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center sm:p-10">
          <div className="rounded-full bg-primary/10 p-3">
            <HardHat className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Coming Soon</CardTitle>
          <CardDescription className="max-w-sm">
            Site execution and progress tracking against the BOQ for this project will be
            available here.
          </CardDescription>
        </CardContent>
      </Card>
    </main>
  );
}
