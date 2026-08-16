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
  limit,
  query,
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
import { useAuth } from "@/components/auth/AuthProvider";
import { logUserActivity } from "@/lib/activity-logger";
import { ControlledField } from "@/components/project-management/controlled-field";
import { useFieldControl, validateFieldControlRequirements } from "@/components/project-management/use-field-control";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  PROJECT_SCOPES,
  PROJECT_TYPES,
  PM_TEAM_ROLES,
  canActivateProject,
  canTransitionLifecycle,
  deriveLegacyStatus,
  nextLifecycleStates,
  projectLifecycleStyles,
  resolveLifecycle,
  validatePmProject,
  type PmProject,
  type PmProjectTeam,
  type ProjectLifecycleState,
  type ProjectScope,
  type ProjectType,
} from "@/lib/project-management-projects";

const COLLECTION_NAME = "projectManagementProjects";
const PERMISSION_RESOURCE = "Project Management.Project Mappings";

type MappingStatus = "Active" | "Inactive";

type ProjectMapping = PmProject & { globalProjectName: string };

type MappingForm = Omit<ProjectMapping, "id" | "globalProjectName" | "globalProjectSite">;

const emptyForm: MappingForm = {
  projectName: "",
  globalProjectId: "",
  description: "",
  startDate: "",
  endDate: "",
  status: "Inactive",
  projectCode: "",
  scopes: [],
  projectManagerId: "",
  projectManagerName: "",
  siteInChargeId: "",
  siteInChargeName: "",
  team: {},
  // New projects start as drafts. A project record should be able to exist before every detail is
  // known; going live is a deliberate act that has to clear the activation bar.
  lifecycle: "Draft",
};

/** Three steps, because the fields genuinely group into three decisions: what and where it is,
 * who runs it, and whether it is ready to go live. */
const WIZARD_STEPS = [
  { key: "details", label: "Project details" },
  { key: "scope", label: "Scope & team" },
  { key: "activation", label: "Review & activate" },
] as const;

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
  const { user } = useAuth();
  const [globalProjects, setGlobalProjects] = useState<Project[]>([]);
  const [mappings, setMappings] = useState<ProjectMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<ProjectMapping | null>(null);
  const [form, setForm] = useState<MappingForm>(emptyForm);
  const [wizardStep, setWizardStep] = useState(0);
  const [staff, setStaff] = useState<Array<{ id: string; name: string; role?: string }>>([]);

  const canView = can("View", PERMISSION_RESOURCE);
  const canAdd = can("Add", PERMISSION_RESOURCE);
  const canEdit = can("Edit", PERMISSION_RESOURCE);
  const canDelete = can("Delete", PERMISSION_RESOURCE);
  const { field } = useFieldControl("projectMapping");

  const globalProjectsById = useMemo(
    () => new Map(globalProjects.map((project) => [project.id, project])),
    [globalProjects],
  );

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
        .map(
          (mappingDoc) =>
            ({ id: mappingDoc.id, ...mappingDoc.data() }) as ProjectMapping,
        )
        .sort((a, b) => a.projectName.localeCompare(b.projectName));

      setGlobalProjects(projects);
      setMappings(projectMappings);
      setStaff(
        usersSnapshot.docs
          .map((userDoc) => {
            const data = userDoc.data() as { name?: string; role?: string; status?: string };
            return { id: userDoc.id, name: data.name ?? "", role: data.role, status: data.status };
          })
          .filter((member) => member.name && member.status !== "Inactive")
          .sort((a, b) => a.name.localeCompare(b.name)),
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
    setWizardStep(0);
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
      projectCode: mapping.projectCode ?? "",
      projectType: mapping.projectType,
      scopes: mapping.scopes ?? [],
      projectManagerId: mapping.projectManagerId ?? "",
      projectManagerName: mapping.projectManagerName ?? "",
      siteInChargeId: mapping.siteInChargeId ?? "",
      siteInChargeName: mapping.siteInChargeName ?? "",
      team: mapping.team ?? {},
      // Legacy mappings predate the lifecycle field — infer it rather than showing a blank.
      lifecycle: resolveLifecycle(mapping),
    });
    setWizardStep(0);
    setIsDialogOpen(true);
  };

  const toggleScope = (scope: ProjectScope) =>
    setForm((current) => {
      const scopes = current.scopes ?? [];
      return {
        ...current,
        scopes: scopes.includes(scope)
          ? scopes.filter((item) => item !== scope)
          : [...scopes, scope],
      };
    });

  const toggleTeamMember = (role: keyof PmProjectTeam, userId: string) =>
    setForm((current) => {
      const members = current.team?.[role] ?? [];
      return {
        ...current,
        team: {
          ...current.team,
          [role]: members.includes(userId)
            ? members.filter((item) => item !== userId)
            : [...members, userId],
        },
      };
    });

  // Blocking problems for the lifecycle the user is actually trying to save.
  const activationErrors = canActivateProject(form);
  const draftErrors = validatePmProject(form);
  const blockingErrors = form.lifecycle === "Active" ? activationErrors : draftErrors;

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

    const missingLabel = validateFieldControlRequirements(
      "projectMapping",
      { ...form },
      field,
    );
    if (missingLabel) {
      toast({ title: `${missingLabel} is required`, variant: "destructive" });
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

    const duplicateName = mappings.some(
      (mapping) =>
        mapping.id !== editingMapping?.id &&
        mapping.projectName.trim().toLowerCase() === projectName.toLowerCase(),
    );
    if (duplicateName) {
      toast({
        title: "Name already in use",
        description: `A Project Management project named "${projectName}" already exists.`,
        variant: "destructive",
      });
      return;
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
      return;
    }

    // Domain rules — light for a Draft, strict for anything going Active.
    if (blockingErrors.length) {
      toast({
        title:
          form.lifecycle === "Active"
            ? "This project cannot be activated yet"
            : "Complete the project details",
        description: blockingErrors.map((error) => error.message).join(" "),
        variant: "destructive",
      });
      return;
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
        return;
      }
    }

    setIsSaving(true);
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
        projectManagerName:
          staff.find((member) => member.id === form.projectManagerId)?.name ?? "",
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
        <Skeleton className="mb-6 h-9 w-72" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
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
    <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
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
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingMapping ? "Edit Project" : "New Project"}
              </DialogTitle>
              <DialogDescription>
                {WIZARD_STEPS[wizardStep].label} — step {wizardStep + 1} of {WIZARD_STEPS.length}
              </DialogDescription>
            </DialogHeader>

            {/* Step rail */}
            <div className="flex items-center gap-2">
              {WIZARD_STEPS.map((step, index) => (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => setWizardStep(index)}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                    index === wizardStep
                      ? "border-primary bg-primary/5 font-medium text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="block">{index + 1}. {step.label}</span>
                </button>
              ))}
            </div>

            <div className={cn("grid gap-4 py-4", wizardStep !== 0 && "hidden")}>
              <ControlledField setting={field("projectName")}>
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
              </ControlledField>

              <ControlledField setting={field("globalProjectId")}>
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
              </ControlledField>

              <ControlledField setting={field("description")}>
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
              </ControlledField>

              <div className="grid gap-4 sm:grid-cols-2">
                <ControlledField setting={field("startDate")}>
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
                </ControlledField>
                <ControlledField setting={field("endDate")}>
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
                </ControlledField>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="project-code">Project Code</Label>
                  <Input
                    id="project-code"
                    placeholder="SEL/PRJ/0031"
                    value={form.projectCode ?? ""}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, projectCode: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-type">Project Type</Label>
                  <Select
                    value={form.projectType ?? ""}
                    onValueChange={(projectType: ProjectType) =>
                      setForm((current) => ({ ...current, projectType }))
                    }
                  >
                    <SelectTrigger id="project-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Step 2 — scope and team */}
            <div className={cn("grid gap-5 py-4", wizardStep !== 1 && "hidden")}>
              <div className="space-y-2">
                <Label>Scope</Label>
                <p className="text-xs text-muted-foreground">
                  Which lanes this project actually runs. Determines which workflow a BOQ line
                  follows and which sections are worth showing.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PROJECT_SCOPES.map((scope) => (
                    <label
                      key={scope}
                      className="flex items-center gap-2 rounded-md border p-2 text-sm"
                    >
                      <Checkbox
                        checked={(form.scopes ?? []).includes(scope)}
                        onCheckedChange={() => toggleScope(scope)}
                      />
                      {scope}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="project-manager">Project Manager</Label>
                  <Select
                    value={form.projectManagerId ?? ""}
                    onValueChange={(projectManagerId) =>
                      setForm((current) => ({ ...current, projectManagerId }))
                    }
                  >
                    <SelectTrigger id="project-manager">
                      <SelectValue placeholder="Select manager" />
                    </SelectTrigger>
                    <SelectContent>
                      {staff.map((member) => (
                        <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="site-incharge">Site In-Charge</Label>
                  <Select
                    value={form.siteInChargeId ?? ""}
                    onValueChange={(siteInChargeId) =>
                      setForm((current) => ({ ...current, siteInChargeId }))
                    }
                  >
                    <SelectTrigger id="site-incharge">
                      <SelectValue placeholder="Select site in-charge" />
                    </SelectTrigger>
                    <SelectContent>
                      {staff.map((member) => (
                        <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Project Team</Label>
                <p className="text-xs text-muted-foreground">
                  Referenced by user account, never copied — a rename or role change in User
                  Management flows through automatically.
                </p>
                <div className="space-y-3">
                  {PM_TEAM_ROLES.map((role) => (
                    <div key={role.key} className="rounded-md border p-2">
                      <p className="mb-1.5 text-xs font-medium">{role.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {staff.map((member) => {
                          const selected = (form.team?.[role.key] ?? []).includes(member.id);
                          return (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() => toggleTeamMember(role.key, member.id)}
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-xs transition-colors",
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:bg-muted",
                              )}
                            >
                              {member.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Step 3 — review and activate */}
            <div className={cn("space-y-4 py-4", wizardStep !== 2 && "hidden")}>
              <div className="space-y-2">
                <Label htmlFor="project-lifecycle">Status</Label>
                <Select
                  value={form.lifecycle ?? "Draft"}
                  onValueChange={(lifecycle: ProjectLifecycleState) =>
                    setForm((current) => ({ ...current, lifecycle }))
                  }
                >
                  <SelectTrigger id="project-lifecycle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(editingMapping
                      ? Array.from(
                          new Set([
                            resolveLifecycle(editingMapping),
                            ...nextLifecycleStates(resolveLifecycle(editingMapping)),
                          ]),
                        )
                      : (["Draft", "Review"] as ProjectLifecycleState[])
                    ).map((state) => (
                      <SelectItem key={state} value={state}>{state}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Only transitions valid from the current status are offered. A new project starts
                  as a Draft and is activated once it clears the checks below.
                </p>
              </div>

              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">Activation checklist</p>
                {activationErrors.length ? (
                  <ul className="space-y-1">
                    {activationErrors.map((error) => (
                      <li key={`${error.field}-${error.message}`} className="text-xs text-red-600">
                        • {error.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-emerald-700">
                    Everything required to activate this project is in place.
                  </p>
                )}
              </div>

              <div className="rounded-lg border p-3 text-xs">
                <p className="mb-2 text-sm font-medium">Summary</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  <span className="text-muted-foreground">Name</span>
                  <span>{form.projectName || "—"}</span>
                  <span className="text-muted-foreground">Code</span>
                  <span>{form.projectCode || "—"}</span>
                  <span className="text-muted-foreground">Type</span>
                  <span>{form.projectType || "—"}</span>
                  <span className="text-muted-foreground">Scope</span>
                  <span>
                    {(form.scopes ?? []).length ? (
                      <span className="flex flex-wrap gap-1">
                        {(form.scopes ?? []).map((scope) => (
                          <Badge key={scope} variant="outline">{scope}</Badge>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span className="text-muted-foreground">Project Manager</span>
                  <span>
                    {staff.find((member) => member.id === form.projectManagerId)?.name || "—"}
                  </span>
                  <span className="text-muted-foreground">Schedule</span>
                  <span>
                    {form.startDate || "—"} → {form.endDate || "—"}
                  </span>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setWizardStep((step) => Math.max(0, step - 1))}
                  disabled={wizardStep === 0}
                >
                  Back
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setWizardStep((step) => Math.min(WIZARD_STEPS.length - 1, step + 1))
                  }
                  disabled={wizardStep === WIZARD_STEPS.length - 1}
                >
                  Next
                </Button>
              </div>
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleSave} disabled={isSaving || blockingErrors.length > 0}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingMapping ? "Save Changes" : "Create Project"}
                </Button>
              </div>
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
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs font-medium",
                              projectLifecycleStyles[resolveLifecycle(mapping)],
                            )}
                          >
                            {resolveLifecycle(mapping)}
                          </span>
                          {mapping.projectCode ? (
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              {mapping.projectCode}
                            </div>
                          ) : null}
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
