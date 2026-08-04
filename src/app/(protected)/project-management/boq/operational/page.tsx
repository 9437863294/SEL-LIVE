"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardCheck, FolderOpen, ShieldAlert } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
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
import type { Project } from "@/lib/types";

const BOQ_PERMISSION = "Project Management.BOQ";

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

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  useEffect(() => {
    if (isLoading || !canView) return;

    const fetchProjects = async () => {
      setIsLoadingProjects(true);
      try {
        const snapshot = await getDocs(collection(db, "projects"));
        setProjects(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Project)));
      } catch (error) {
        console.error("Error fetching projects:", error);
      } finally {
        setIsLoadingProjects(false);
      }
    };

    fetchProjects();
  }, [isLoading, canView]);

  const handleProjectChange = (slug: string) => {
    if (!slug) return;
    router.push(`/project-management/boq/operational/${slug}`);
  };

  if (isLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Operational BOQ</h1>
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
    <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/project-management/boq" aria-label="Back to BOQ">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
          <ClipboardCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Operational BOQ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a project to track its execution quantities against the BOQ.
          </p>
        </div>
      </div>

      <Card className="mt-6 max-w-md overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 to-purple-600" />
        <CardHeader>
          <CardTitle className="text-base">Select Project</CardTitle>
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
                  {projects.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No projects found.
                    </div>
                  ) : (
                    projects.map((p) => (
                      <SelectItem key={p.id} value={slugify(p.projectName)}>
                        {p.projectName}
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
