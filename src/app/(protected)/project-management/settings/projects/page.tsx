"use client";

/**
 * Settings › Manage Projects — the container. It holds the permissions, loads the global projects,
 * the mappings and the staff, and runs every rule before it writes: Field Control requirements,
 * the timeline, duplicate names and global projects, the activation bar and the allowed lifecycle
 * transitions. The screen itself is `ProjectMappingsView`, which only renders and calls back.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Project } from "@/lib/types";
import { withDesignations } from "@/lib/people-directory-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth/AuthProvider";
import { logUserActivity } from "@/lib/activity-logger";
import { useFieldControl, validateFieldControlRequirements } from "@/components/project-management/use-field-control";
import {
  ProjectMappingsView,
  type MappingForm,
  type MappingStaffMember,
  type ProjectMapping,
} from "@/components/project-management/project-mappings-view";
import {
  canActivateProject,
  canTransitionLifecycle,
  deriveLegacyStatus,
  resolveLifecycle,
  validatePmProject,
} from "@/lib/project-management-projects";

const COLLECTION_NAME = "projectManagementProjects";
const PERMISSION_RESOURCE = "Project Management.Project Mappings";

export default function ProjectMappingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const { user } = useAuth();
  const [globalProjects, setGlobalProjects] = useState<Project[]>([]);
  const [mappings, setMappings] = useState<ProjectMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [staff, setStaff] = useState<MappingStaffMember[]>([]);

  const canView = can("View", PERMISSION_RESOURCE);
  const canAdd = can("Add", PERMISSION_RESOURCE);
  const canEdit = can("Edit", PERMISSION_RESOURCE);
  const canDelete = can("Delete", PERMISSION_RESOURCE);
  const { field } = useFieldControl("projectMapping");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [projectsSnapshot, mappingsSnapshot, usersSnapshot] = await Promise.all([
        getDocs(collection(db, "projects")),
        getDocs(collection(db, COLLECTION_NAME)),
        // Team assignment references `users` by id — never copies staff records.
        getDocs(collection(db, "users")),
      ]);

      const projects = projectsSnapshot.docs
        .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }) as Project)
        .sort((a, b) => a.projectName.localeCompare(b.projectName));
      const projectMappings = mappingsSnapshot.docs
        .map((mappingDoc) => ({ id: mappingDoc.id, ...mappingDoc.data() }) as ProjectMapping)
        .sort((a, b) => a.projectName.localeCompare(b.projectName));

      setGlobalProjects(projects);
      setMappings(projectMappings);
      setStaff(
        // Designations joined on so the manager and site-in-charge pickers name a job title rather
        // than the login's permission bundle — see `src/lib/people-directory.ts`.
        await withDesignations(
          usersSnapshot.docs
            .map((userDoc) => {
              const data = userDoc.data() as {
                name?: string;
                email?: string;
                role?: string;
                status?: string;
                employeeId?: string;
              };
              return {
                id: userDoc.id,
                name: data.name ?? "",
                email: data.email,
                role: data.role,
                employeeId: data.employeeId,
                status: data.status,
              };
            })
            .filter((member) => member.name && member.status !== "Inactive")
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      );
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
    // Without View the denied state renders whatever `isLoading` holds, so nothing to reset here.
    if (isAuthLoading || !canView) return;
    // Loading the registers from Firestore is the "sync with an external system" case effects are
    // for; `loadData` marks itself loading before it reads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  /** Every rule, then the write. Resolves true when saved, so the wizard can close. */
  const handleSave = async (form: MappingForm, editingMapping: ProjectMapping | null): Promise<boolean> => {
    if (editingMapping ? !canEdit : !canAdd) {
      toast({ title: "You don't have permission to do that", variant: "destructive" });
      return false;
    }
    const projectName = form.projectName.trim();
    const globalProject = globalProjects.find((project) => project.id === form.globalProjectId);

    if (!projectName || !globalProject) {
      toast({
        title: "Complete the mapping",
        description: "Enter the new project name and select a global project.",
        variant: "destructive",
      });
      return false;
    }

    const missingLabel = validateFieldControlRequirements("projectMapping", { ...form }, field);
    if (missingLabel) {
      toast({ title: `${missingLabel} is required`, variant: "destructive" });
      return false;
    }

    if (Boolean(form.startDate) !== Boolean(form.endDate)) {
      toast({
        title: "Complete the project timeline",
        description: "Select both the start date and end date.",
        variant: "destructive",
      });
      return false;
    }

    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      toast({
        title: "Invalid project timeline",
        description: "The end date cannot be before the start date.",
        variant: "destructive",
      });
      return false;
    }

    const duplicateName = mappings.some(
      (mapping) =>
        mapping.id !== editingMapping?.id && mapping.projectName.trim().toLowerCase() === projectName.toLowerCase(),
    );
    if (duplicateName) {
      toast({
        title: "Name already in use",
        description: `A Project Management project named "${projectName}" already exists.`,
        variant: "destructive",
      });
      return false;
    }

    const duplicateGlobalProject = mappings.find(
      (mapping) => mapping.id !== editingMapping?.id && mapping.globalProjectId === globalProject.id,
    );
    if (duplicateGlobalProject) {
      toast({
        title: "Project already mapped",
        description: `"${globalProject.projectName}" is already mapped as "${duplicateGlobalProject.projectName}". Each global project can only be mapped once.`,
        variant: "destructive",
      });
      return false;
    }

    // Domain rules — light for a Draft, strict for anything going Active.
    const blockingErrors = form.lifecycle === "Active" ? canActivateProject(form) : validatePmProject(form);
    if (blockingErrors.length) {
      toast({
        title: form.lifecycle === "Active" ? "This project cannot be activated yet" : "Complete the project details",
        description: blockingErrors.map((error) => error.message).join(" "),
        variant: "destructive",
      });
      return false;
    }

    // Status changes follow the allowed graph rather than free-form dropdown editing.
    if (editingMapping) {
      const from = resolveLifecycle(editingMapping);
      const to = form.lifecycle ?? "Draft";
      if (!canTransitionLifecycle(from, to)) {
        toast({
          title: "Status change not allowed",
          description: `A project cannot move directly from ${from} to ${to}.`,
          variant: "destructive",
        });
        return false;
      }
    }

    try {
      const lifecycle = form.lifecycle ?? "Draft";
      const payload = {
        projectName,
        globalProjectId: globalProject.id,
        globalProjectName: globalProject.projectName,
        globalProjectSite: globalProject.projectSite ?? "",
        description: form.description?.trim() ?? "",
        startDate: form.startDate ?? "",
        endDate: form.endDate ?? "",
        // The legacy Active/Inactive flag is derived, never edited directly, so existing screens
        // that filter on `status` stay correct without knowing lifecycle exists.
        status: deriveLegacyStatus(lifecycle),
        lifecycle,
        projectCode: form.projectCode?.trim() ?? "",
        ...(form.projectType ? { projectType: form.projectType } : {}),
        scopes: form.scopes ?? [],
        projectManagerId: form.projectManagerId ?? "",
        projectManagerName: staff.find((member) => member.id === form.projectManagerId)?.name ?? "",
        siteInChargeId: form.siteInChargeId ?? "",
        siteInChargeName: staff.find((member) => member.id === form.siteInChargeId)?.name ?? "",
        team: form.team ?? {},
        updatedAt: serverTimestamp(),
      };

      if (editingMapping) {
        await updateDoc(doc(db, COLLECTION_NAME, editingMapping.id), payload);
        if (user) {
          void logUserActivity({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            module: "Project Management",
            action: "Update Project Mapping",
            details: { projectName },
          });
        }
        toast({ title: "Project mapping updated" });
      } else {
        await addDoc(collection(db, COLLECTION_NAME), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        if (user) {
          void logUserActivity({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            module: "Project Management",
            action: "Create Project Mapping",
            details: { projectName, globalProjectName: globalProject.projectName },
          });
        }
        toast({ title: "Project mapping created" });
      }

      await loadData();
      return true;
    } catch (error) {
      console.error("Failed to save project mapping:", error);
      toast({
        title: "Unable to save mapping",
        description: "The Project Management project could not be saved.",
        variant: "destructive",
      });
      return false;
    }
  };

  const handleDelete = async (mapping: ProjectMapping) => {
    if (!canDelete) return;
    try {
      // Deleting the mapping doesn't touch the underlying subcollections — it just makes them
      // unreachable from every Project Management page, which all resolve data via this mapping.
      // Block the delete if the project actually has anything under it yet.
      const [boqSnap, indentSnap, rfqSnap, poSnap] = await Promise.all([
        getDocs(query(collection(db, "projects", mapping.globalProjectId, "boqItems"), limit(1))),
        getDocs(query(collection(db, "projects", mapping.globalProjectId, "indents"), limit(1))),
        getDocs(query(collection(db, "projects", mapping.globalProjectId, "rfqs"), limit(1))),
        getDocs(query(collection(db, "projects", mapping.globalProjectId, "purchaseOrders"), limit(1))),
      ]);
      const inUse = [
        boqSnap.empty ? null : "BOQ items",
        indentSnap.empty ? null : "indents",
        rfqSnap.empty ? null : "RFQs",
        poSnap.empty ? null : "purchase orders",
      ].filter((label): label is string => Boolean(label));
      if (inUse.length > 0) {
        toast({
          title: "Can't delete this project",
          description: `"${mapping.projectName}" still has ${inUse.join(", ")}. Remove those first, or leave the mapping and just set its status to Inactive.`,
          variant: "destructive",
        });
        return;
      }
      await deleteDoc(doc(db, COLLECTION_NAME, mapping.id));
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: "Delete Project Mapping",
          details: { projectName: mapping.projectName },
        });
      }
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
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Skeleton className="mb-6 h-32 w-full rounded-3xl" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="Manage Projects" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view Project Management mappings.</CardDescription>
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
      <ProjectMappingsView
        mappings={mappings}
        globalProjects={globalProjects}
        staff={staff}
        field={field}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </main>
  );
}
