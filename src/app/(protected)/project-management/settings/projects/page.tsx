"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarRange,
  Link2,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";

const COLLECTION_NAME = "projectManagementProjects";
const PERMISSION_RESOURCE = "Project Management.Project Mappings";

type MappingStatus = "Active" | "Inactive";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
  globalProjectSite?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  status: MappingStatus;
};

type MappingForm = Omit<ProjectMapping, "id" | "globalProjectName" | "globalProjectSite">;

const emptyForm: MappingForm = {
  projectName: "",
  globalProjectId: "",
  description: "",
  startDate: "",
  endDate: "",
  status: "Active",
};

const formatProjectDate = (value?: string) => {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

export default function ProjectMappingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const [globalProjects, setGlobalProjects] = useState<Project[]>([]);
  const [mappings, setMappings] = useState<ProjectMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<ProjectMapping | null>(null);
  const [form, setForm] = useState<MappingForm>(emptyForm);

  const canView = can("View", PERMISSION_RESOURCE);
  const canAdd = can("Add", PERMISSION_RESOURCE);
  const canEdit = can("Edit", PERMISSION_RESOURCE);
  const canDelete = can("Delete", PERMISSION_RESOURCE);

  const globalProjectsById = useMemo(
    () => new Map(globalProjects.map((project) => [project.id, project])),
    [globalProjects],
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [projectsSnapshot, mappingsSnapshot] = await Promise.all([
        getDocs(collection(db, "projects")),
        getDocs(collection(db, COLLECTION_NAME)),
      ]);

      const projects = projectsSnapshot.docs
        .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }) as Project)
        .sort((a, b) => a.projectName.localeCompare(b.projectName));
      const projectMappings = mappingsSnapshot.docs
        .map(
          (mappingDoc) =>
            ({ id: mappingDoc.id, ...mappingDoc.data() }) as ProjectMapping,
        )
        .sort((a, b) => a.projectName.localeCompare(b.projectName));

      setGlobalProjects(projects);
      setMappings(projectMappings);
    } catch (error) {
      console.error("Failed to load project mappings:", error);
      toast({
        title: "Unable to load projects",
        description: "Global projects or Project Management mappings could not be loaded.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const openCreateDialog = () => {
    setEditingMapping(null);
    setForm(emptyForm);
    setIsDialogOpen(true);
  };

  const openEditDialog = (mapping: ProjectMapping) => {
    setEditingMapping(mapping);
    setForm({
      projectName: mapping.projectName,
      globalProjectId: mapping.globalProjectId,
      description: mapping.description ?? "",
      startDate: mapping.startDate ?? "",
      endDate: mapping.endDate ?? "",
      status: mapping.status,
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const projectName = form.projectName.trim();
    const globalProject = globalProjectsById.get(form.globalProjectId);

    if (!projectName || !globalProject) {
      toast({
        title: "Complete the mapping",
        description: "Enter the new project name and select a global project.",
        variant: "destructive",
      });
      return;
    }

    if (Boolean(form.startDate) !== Boolean(form.endDate)) {
      toast({
        title: "Complete the project timeline",
        description: "Select both the start date and end date.",
        variant: "destructive",
      });
      return;
    }

    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      toast({
        title: "Invalid project timeline",
        description: "The end date cannot be before the start date.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        projectName,
        globalProjectId: globalProject.id,
        globalProjectName: globalProject.projectName,
        globalProjectSite: globalProject.projectSite ?? "",
        description: form.description?.trim() ?? "",
        startDate: form.startDate ?? "",
        endDate: form.endDate ?? "",
        status: form.status,
        updatedAt: serverTimestamp(),
      };

      if (editingMapping) {
        await updateDoc(doc(db, COLLECTION_NAME, editingMapping.id), payload);
        toast({ title: "Project mapping updated" });
      } else {
        await addDoc(collection(db, COLLECTION_NAME), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast({ title: "Project mapping created" });
      }

      setIsDialogOpen(false);
      setEditingMapping(null);
      setForm(emptyForm);
      await loadData();
    } catch (error) {
      console.error("Failed to save project mapping:", error);
      toast({
        title: "Unable to save mapping",
        description: "The Project Management project could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (mapping: ProjectMapping) => {
    try {
      await deleteDoc(doc(db, COLLECTION_NAME, mapping.id));
      toast({ title: "Project mapping deleted" });
      await loadData();
    } catch (error) {
      console.error("Failed to delete project mapping:", error);
      toast({
        title: "Unable to delete mapping",
        variant: "destructive",
      });
    }
  };

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Skeleton className="mb-6 h-9 w-72" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Manage Projects</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view Project Management mappings.
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
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/project-management/settings" aria-label="Back to Settings">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-sm">
            <Link2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Manage Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create Project Management projects and map each one to a global project.
            </p>
          </div>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog} disabled={!canAdd}>
              <Plus className="mr-2 h-4 w-4" />
              New Project Mapping
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editingMapping ? "Edit Project Mapping" : "Create Project Mapping"}
              </DialogTitle>
              <DialogDescription>
                Give the new Project Management project its own name, then map it to an
                existing global project.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">New project name</Label>
                <Input
                  id="project-name"
                  placeholder="For example: Project Y"
                  value={form.projectName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      projectName: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="global-project">Map to global project</Label>
                <Select
                  value={form.globalProjectId}
                  onValueChange={(globalProjectId) =>
                    setForm((current) => ({ ...current, globalProjectId }))
                  }
                >
                  <SelectTrigger id="global-project">
                    <SelectValue placeholder="Select global project X" />
                  </SelectTrigger>
                  <SelectContent>
                    {globalProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.projectName}
                        {project.siteCode ? ` (${project.siteCode})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mapping-description">Description</Label>
                <Input
                  id="mapping-description"
                  placeholder="Optional description"
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="project-start-date">Start date</Label>
                  <Input
                    id="project-start-date"
                    type="date"
                    value={form.startDate}
                    max={form.endDate || undefined}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        startDate: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-end-date">End date</Label>
                  <Input
                    id="project-end-date"
                    type="date"
                    value={form.endDate}
                    min={form.startDate || undefined}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        endDate: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mapping-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(status: MappingStatus) =>
                    setForm((current) => ({ ...current, status }))
                  }
                >
                  <SelectTrigger id="mapping-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingMapping ? "Save Changes" : "Create Mapping"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-blue-600" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link2 className="h-5 w-5 text-primary" />
            Project mappings
          </CardTitle>
          <CardDescription>
            The new project name is used inside Project Management. The mapped global
            project remains the source for shared project data.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project Management project</TableHead>
                  <TableHead>Mapped global project</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Project timeline</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.length ? (
                  mappings.map((mapping) => {
                    const liveGlobalProject = globalProjectsById.get(
                      mapping.globalProjectId,
                    );

                    return (
                      <TableRow key={mapping.id}>
                        <TableCell>
                          <p className="font-medium">{mapping.projectName}</p>
                          {mapping.description && (
                            <p className="text-xs text-muted-foreground">
                              {mapping.description}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Link2 className="h-4 w-4 text-muted-foreground" />
                            {liveGlobalProject?.projectName ?? mapping.globalProjectName}
                          </div>
                        </TableCell>
                        <TableCell>
                          {liveGlobalProject?.projectSite ?? mapping.globalProjectSite ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <CalendarRange className="h-4 w-4 text-muted-foreground" />
                            <span>
                              {mapping.startDate && mapping.endDate
                                ? `${formatProjectDate(mapping.startDate)} – ${formatProjectDate(mapping.endDate)}`
                                : "Not set"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              mapping.status === "Active"
                                ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700"
                                : "rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                            }
                          >
                            {mapping.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => openEditDialog(mapping)}
                              disabled={!canEdit}
                              aria-label={`Edit ${mapping.projectName}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="destructive"
                                  size="icon"
                                  disabled={!canDelete}
                                  aria-label={`Delete ${mapping.projectName}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete project mapping?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This removes “{mapping.projectName}” from Project
                                    Management. The mapped global project will not be deleted.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(mapping)}
                                  >
                                    Delete Mapping
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <p className="font-medium">No Project Management projects yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Create project Y and map it to an existing global project X.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
