"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, FolderOpen, ShieldAlert } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";

const BOQ_PERMISSION = "Project Management.BOQ";
// Matches the module home page's own project picker — the PM "project" is a mapping onto a
// global project, not the global project itself.
const PROJECTS_COLLECTION = "projectManagementProjects";

type ProjectMapping = {
  id: string;
  projectName: string;
  status: "Active" | "Inactive";
};

const slugify = (text: string) =>
  text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

export default function OperationalBoqPage() {
  const router = useRouter();
  const { can, isLoading } = useAuthorization();
  const canView = can("View", BOQ_PERMISSION);

  const [mappings, setMappings] = useState<ProjectMapping[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  useEffect(() => {
    if (isLoading || !canView) return;

    const fetchProjects = async () => {
      setIsLoadingProjects(true);
      try {
        const snapshot = await getDocs(collection(db, PROJECTS_COLLECTION));
        setMappings(
          snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }) as ProjectMapping)
            .filter((mapping) => mapping.status === "Active")
            .sort((a, b) => a.projectName.localeCompare(b.projectName)),
        );
      } catch (error) {
        console.error("Error fetching project mappings:", error);
      } finally {
        setIsLoadingProjects(false);
      }
    };

    fetchProjects();
  }, [isLoading, canView]);

  const handleProjectChange = (mappingId: string) => {
    const mapping = mappings.find((item) => item.id === mappingId);
    if (!mapping) return;
    router.push(
      `/project-management/boq/operational/${slugify(mapping.projectName)}?project=${encodeURIComponent(mapping.id)}`,
    );
  };

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
        description="Select a project to track its execution quantities against the BOQ."
        icon={ClipboardCheck}
        backHref="/project-management/boq"
        backLabel="Back to BOQ"
      />

      <Card className="mt-5 max-w-md overflow-hidden border-border/60 sm:mt-6">
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 to-purple-600" />
        <CardHeader>
          <CardTitle>Select Project</CardTitle>
          <CardDescription>Choose a project to open its Operational BOQ.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingProjects ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
              <Select onValueChange={handleProjectChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a project..." />
                </SelectTrigger>
                <SelectContent>
                  {mappings.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No mapped projects found. Add one from Settings → Manage Projects first.
                    </div>
                  ) : (
                    mappings.map((mapping) => (
                      <SelectItem key={mapping.id} value={mapping.id}>
                        {mapping.projectName}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
