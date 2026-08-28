"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Save, Loader2, Search, ShieldAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle as CardTitleShad,
  CardDescription as CardDescriptionShad,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import type { Role, Department, Project } from "@/lib/types";
import { permissionModules } from "@/lib/permissions";
import { useAuth } from "@/components/auth/AuthProvider";
import { logUserActivity } from "@/lib/activity-logger";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import { Badge } from "@/components/ui/badge";
import { AuroraBackdrop } from "@/components/effects/AuroraBackdrop";
import { cn } from "@/lib/utils";

const initializePermissions = (
  departments: Department[],
  projects: Project[],
): Record<string, string[]> => {
  const permissions: Record<string, string[]> = {};
  Object.keys(permissionModules).forEach((moduleName) => {
    const moduleValue =
      permissionModules[moduleName as keyof typeof permissionModules];
    if (Array.isArray(moduleValue)) {
      permissions[moduleName] = [];
    } else {
      if ("View Module" in moduleValue) {
        permissions[moduleName] = [];
      }
      Object.keys(moduleValue).forEach((subModuleKey) => {
        if (subModuleKey === "View Module") return;
        const fullKey = `${moduleName}.${subModuleKey}`;

        if (subModuleKey === "Departments" && departments.length > 0) {
          departments.forEach((dept) => {
            const deptKey = `Expenses.Departments.${dept.id}`;
            permissions[deptKey] = [];
          });
        } else if (
          subModuleKey === "Projects" &&
          moduleName === "Store & Stock Management" &&
          projects.length > 0
        ) {
          projects.forEach((proj) => {
            const projectKey = `Store & Stock Management.Projects.${proj.id}`;
            permissions[projectKey] = [];
          });
        } else {
          permissions[fullKey] = [];

          const subPermissions =
            moduleValue[subModuleKey as keyof typeof moduleValue];
          if (
            typeof subPermissions === "object" &&
            !Array.isArray(subPermissions)
          ) {
            Object.keys(subPermissions).forEach((nestedKey) => {
              const nestedFullKey = `${fullKey}.${nestedKey}`;
              permissions[nestedFullKey] = [];
            });
          }
        }
      });
    }
  });
  return permissions;
};

function moduleMatchesQuery(
  moduleName: string,
  moduleValue: any,
  q: string,
  departments: Department[],
  projects: Project[],
) {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  if (moduleName.toLowerCase().includes(query)) return true;

  const walk = (key: string, value: any): boolean => {
    if (String(key).toLowerCase().includes(query)) return true;
    if (Array.isArray(value))
      return value.some((p) => String(p).toLowerCase().includes(query));
    if (value && typeof value === "object")
      return Object.entries(value).some(([k, v]) => walk(k, v));
    return false;
  };

  if (walk(moduleName, moduleValue)) return true;
  if (
    moduleName === "Expenses" &&
    departments.some((d) => d.name.toLowerCase().includes(query))
  )
    return true;
  if (
    moduleName === "Store & Stock Management" &&
    projects.some((p) => (p.projectName || "").toLowerCase().includes(query))
  ) {
    return true;
  }
  return false;
}

export default function EditRolePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { roleId } = useParams() as { roleId: string };
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canEdit = can("Edit", "Settings.Role Management");

  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [originalName, setOriginalName] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [otherRoles, setOtherRoles] = useState<Role[]>([]);
  const [assignedUserCount, setAssignedUserCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [permissionQuery, setPermissionQuery] = useState("");
  /**
   * One module's content shows below the whole card grid at a time — not an accordion where every
   * module can be open at once and each one's content pushes the modules below it down the page.
   * Picking a different card swaps the panel; it does not add a second one.
   */
  const [selectedModule, setSelectedModule] = useState<string | null>(null);

  // Set once we know a rename would need to cascade to real users; confirmed via dialog before saving.
  const [pendingRenameSave, setPendingRenameSave] = useState<{
    newName: string;
    userCount: number;
  } | null>(null);

  useEffect(() => {
    if (!roleId) return;

    const fetchRoleAndDepartments = async () => {
      setIsLoading(true);
      try {
        const deptsSnap = await getDocs(
          query(collection(db, "departments"), where("status", "==", "Active")),
        );
        const deptsData = deptsSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Department,
        );
        setDepartments(deptsData);

        const projectsSnap = await getDocs(
          query(
            collection(db, "projects"),
            where("stockManagementRequired", "==", true),
          ),
        );
        const projectsData = projectsSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Project,
        );
        setProjects(projectsData);

        const roleDocRef = doc(db, "roles", roleId);
        const roleDocSnap = await getDoc(roleDocRef);

        const rolesSnap = await getDocs(collection(db, "roles"));
        setOtherRoles(
          rolesSnap.docs
            .filter((d) => d.id !== roleId)
            .map((d) => ({ id: d.id, ...d.data() }) as Role),
        );

        if (roleDocSnap.exists()) {
          const roleData = {
            id: roleDocSnap.id,
            ...roleDocSnap.data(),
          } as Role;
          const completePermissions = initializePermissions(
            deptsData,
            projectsData,
          );

          // Merge saved permissions into the complete structure
          for (const key in roleData.permissions) {
            if (completePermissions.hasOwnProperty(key)) {
              completePermissions[key] = roleData.permissions[key];
            }
          }

          setEditingRole({ ...roleData, permissions: completePermissions });
          setOriginalName(roleData.name);

          if (roleData.name?.trim()) {
            const usersSnap = await getDocs(
              query(
                collection(db, "users"),
                where("role", "==", roleData.name),
              ),
            );
            setAssignedUserCount(usersSnap.size);
          }
        } else {
          toast({
            title: "Error",
            description: "Role not found.",
            variant: "destructive",
          });
          router.push("/settings/role-management");
        }
      } catch (error) {
        console.error("Error fetching role:", error);
        toast({
          title: "Error",
          description: "Failed to fetch role details.",
          variant: "destructive",
        });
      }
      setIsLoading(false);
    };

    fetchRoleAndDepartments();
  }, [roleId, router, toast]);

  const handlePermissionChange = (
    moduleKey: string,
    permission: string,
    isChecked: boolean,
  ) => {
    setEditingRole((prev) => {
      if (!prev) return null;
      const newPermissions = { ...prev.permissions };
      const currentPermissions = newPermissions[moduleKey] || [];
      if (isChecked) {
        newPermissions[moduleKey] = [...currentPermissions, permission];
      } else {
        newPermissions[moduleKey] = currentPermissions.filter(
          (p) => p !== permission,
        );
      }
      return { ...prev, permissions: newPermissions };
    });
  };

  const handleSelectAllForGroup = (
    groupKey: string,
    allPermissionsInGroup: string[],
    isChecked: boolean,
  ) => {
    setEditingRole((prev) => {
      if (!prev) return null;
      const newPermissions = { ...prev.permissions };
      newPermissions[groupKey] = isChecked ? allPermissionsInGroup : [];
      return { ...prev, permissions: newPermissions };
    });
  };

  const performSave = async (finalName: string, cascadeToUsers: boolean) => {
    if (!editingRole || !user) return;
    setIsSaving(true);
    try {
      const roleRef = doc(db, "roles", editingRole.id);
      const { id, ...dataToUpdate } = editingRole;
      await updateDoc(roleRef, { ...dataToUpdate, name: finalName });

      if (cascadeToUsers && originalName.trim() && finalName !== originalName) {
        const usersSnap = await getDocs(
          query(collection(db, "users"), where("role", "==", originalName)),
        );
        if (!usersSnap.empty) {
          const batch = writeBatch(db);
          usersSnap.docs.forEach((userDoc) => {
            batch.update(userDoc.ref, { role: finalName });
          });
          await batch.commit();
        }
      }

      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Settings",
        action: "Update Role",
        details: { roleId: editingRole.id, roleName: finalName },
      });
      toast({ title: "Success", description: "Role updated successfully." });
      router.push("/settings/role-management");
    } catch (error) {
      console.error("Error updating role: ", error);
      toast({
        title: "Error",
        description: "Failed to update role.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
      setPendingRenameSave(null);
    }
  };

  const handleUpdateRole = async () => {
    if (!editingRole) return;
    const trimmedName = editingRole.name.trim();
    if (!trimmedName) {
      toast({
        title: "Validation Error",
        description: "Role Name cannot be empty.",
        variant: "destructive",
      });
      return;
    }
    const nameTaken = otherRoles.some(
      (role) => role.name.trim().toLowerCase() === trimmedName.toLowerCase(),
    );
    if (nameTaken) {
      toast({
        title: "Validation Error",
        description: `A role named "${trimmedName}" already exists.`,
        variant: "destructive",
      });
      return;
    }
    if (!user) return;

    const isRename =
      !!originalName.trim() && trimmedName !== originalName.trim();
    if (isRename && assignedUserCount > 0) {
      setPendingRenameSave({ newName: trimmedName, userCount: assignedUserCount });
      return;
    }
    await performSave(trimmedName, false);
  };

  const filteredModules = useMemo(() => {
    return Object.entries(permissionModules).filter(
      ([moduleName, moduleValue]) =>
        moduleMatchesQuery(
          moduleName,
          moduleValue,
          permissionQuery,
          departments,
          projects,
        ),
    );
  }, [permissionQuery, departments, projects]);

  // A search that narrows to exactly one module opens it straight away — picking the only card left
  // would be busywork. It does not auto-select on a broader match, so a query that matches several
  // modules leaves the choice to the administrator rather than guessing which one they meant.
  useEffect(() => {
    if (!permissionQuery.trim()) return;
    if (filteredModules.length === 1) setSelectedModule(filteredModules[0][0]);
  }, [permissionQuery, filteredModules]);

  /** How many permissions are currently set for a module, across its own key and every nested one
   * (including per-department and per-project keys) — the count shown on its card. */
  const countHeldForModule = (moduleName: string): number => {
    let held = 0;
    for (const [key, actions] of Object.entries(editingRole?.permissions ?? {})) {
      if (key === moduleName || key.startsWith(`${moduleName}.`)) held += actions.length;
    }
    return held;
  };

  if (isAuthLoading || isLoading) {
    return (
      <div className="relative overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <div className="w-full">
          <div className="mb-6 flex items-center justify-between">
            <Skeleton className="h-10 w-56" />
            <Skeleton className="h-10 w-32" />
          </div>
          <Skeleton className="h-28 w-full rounded-2xl mb-4" />
          <Skeleton className="h-[520px] w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="relative overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <div className="w-full">
          <div className="mb-6 flex items-center gap-3">
            <Link href="/settings/role-management">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Edit Role
            </h1>
          </div>
          <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_8px_30px_-10px_rgba(2,6,23,0.25)] backdrop-blur">
            <CardHeader>
              <CardTitleShad>Access Denied</CardTitleShad>
              <CardDescriptionShad>
                You do not have permission to edit roles.
              </CardDescriptionShad>
            </CardHeader>
            <CardContent className="flex justify-center p-8">
              <ShieldAlert className="h-14 w-14 text-destructive" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!editingRole) {
    return (
      <div className="relative overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <div className="w-full">
          <div className="mb-6 flex items-center gap-3">
            <Link href="/settings/role-management">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Edit Role
            </h1>
          </div>
          <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_8px_30px_-10px_rgba(2,6,23,0.25)] backdrop-blur">
            <CardHeader>
              <CardTitleShad>Role Not Found</CardTitleShad>
              <CardDescriptionShad>
                The requested role does not exist or you no longer have access.
              </CardDescriptionShad>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden px-4 py-5 sm:px-6 pb-20 lg:pb-0">
      <AuroraBackdrop />
      <div className="w-full">
        {/* ── Header ── */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/settings/role-management">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  Edit Role
                </h1>
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-white/80 text-slate-600 text-xs"
                >
                  {editingRole.name || "Role"}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    assignedUserCount > 0
                      ? "gap-1 border-sky-200 bg-sky-50 text-sky-700 text-xs"
                      : "gap-1 border-slate-200 bg-white/80 text-slate-500 text-xs"
                  }
                >
                  <Users className="h-3 w-3" />
                  {assignedUserCount > 0
                    ? `Assigned to ${assignedUserCount} user${assignedUserCount === 1 ? "" : "s"}`
                    : "No users assigned"}
                </Badge>
              </div>
              <p className="text-sm text-slate-500 mt-0.5">
                Update the role name and fine-tune module permissions.
              </p>
            </div>
          </div>
          <Button
            onClick={handleUpdateRole}
            disabled={isSaving}
            className="rounded-full shadow-md shrink-0"
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>
        </div>

        {/* ── Role Name + Search ── */}
        <Card className="mb-5 overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_8px_30px_-10px_rgba(2,6,23,0.25)] backdrop-blur">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:items-end">
              <div>
                <Label
                  htmlFor="roleName"
                  className="text-sm font-semibold text-slate-700 mb-2 block"
                >
                  Role Name
                </Label>
                <Input
                  id="roleName"
                  value={editingRole.name}
                  onChange={(e) =>
                    setEditingRole({ ...editingRole, name: e.target.value })
                  }
                  className="bg-white/80 border-slate-200"
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-sm font-semibold text-slate-700 mb-2 block">
                  Search Permissions
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      value={permissionQuery}
                      onChange={(e) => setPermissionQuery(e.target.value)}
                      placeholder="Search modules, actions, departments..."
                      className="pl-9 bg-white/80 border-slate-200"
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedModule && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="bg-white/70 border-slate-200 rounded-full"
                        onClick={() => setSelectedModule(null)}
                      >
                        Deselect
                      </Button>
                    )}
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {filteredModules.length} modules
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Permissions ── */}
        <Card
          id="permissions-card"
          className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_8px_30px_-10px_rgba(2,6,23,0.25)] backdrop-blur"
        >
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitleShad className="text-base">
              Module Permissions
            </CardTitleShad>
            <CardDescriptionShad>
              Select the actions this role can perform for each module.
            </CardDescriptionShad>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {/* Every module, as a narrow single-line card, always visible — not an accordion where
                opening one pushes the rest down. Picking a different card swaps the panel below the
                whole grid; it never opens a second one. */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {filteredModules.map(([moduleName, moduleValue]) => {
                const isViewModuleOnly =
                  typeof moduleValue === "object" &&
                  !Array.isArray(moduleValue) &&
                  Object.keys(moduleValue).length === 1 &&
                  "View Module" in moduleValue;
                const held = countHeldForModule(moduleName);
                const selected = selectedModule === moduleName;
                return (
                  <button
                    key={moduleName}
                    type="button"
                    onClick={() => setSelectedModule(moduleName)}
                    aria-pressed={selected}
                    title={moduleName}
                    className={cn(
                      "flex min-w-0 items-center justify-between gap-1.5 rounded-lg border px-2 py-1.5 text-left shadow-sm transition-colors",
                      selected
                        ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                        : "border-slate-200/80 bg-white/60 hover:border-indigo-200 hover:bg-indigo-50/40",
                    )}
                  >
                    <span className="min-w-0 truncate text-xs font-semibold text-slate-800">
                      {moduleName}
                    </span>
                    {isViewModuleOnly ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-slate-200 bg-white px-1 text-[9px] leading-tight text-slate-500"
                      >
                        View
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 px-1 text-[9px] leading-tight",
                          held === 0
                            ? "border-slate-200 bg-white text-slate-500"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700",
                        )}
                      >
                        {held}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>

            {(() => {
              const selectedEntry = filteredModules.find(([name]) => name === selectedModule);
              if (!selectedEntry) {
                return (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white/50 px-3 py-10 text-center text-sm text-slate-500">
                    {filteredModules.length === 0
                      ? "No modules match this search."
                      : "Select a module above to edit its permissions."}
                  </p>
                );
              }
              const [moduleName, moduleValue] = selectedEntry;
              const isViewModulePermission =
                (editingRole.permissions?.[moduleName] || []).includes(
                  "View Module",
                ) || (moduleValue as any)["View Module"] === true;
              return (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
                  <p className="mb-2 text-sm font-semibold text-slate-800">{moduleName}</p>
                  <ScrollArea className="h-[calc(100dvh-26rem)] rounded-xl border border-white/70 bg-white/70">
                    <div className="px-3 pb-3 pt-2.5 space-y-2.5">
                      {Array.isArray(moduleValue) ? (
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {moduleValue.map((permission) => (
                                  <label
                                    key={permission}
                                    className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                                  >
                                    <Checkbox
                                      id={`edit-${moduleName}-${permission}`}
                                      checked={(
                                        editingRole.permissions?.[moduleName] ||
                                        []
                                      ).includes(permission)}
                                      onCheckedChange={(checked) =>
                                        handlePermissionChange(
                                          moduleName,
                                          permission,
                                          !!checked,
                                        )
                                      }
                                    />
                                    <span className="text-sm text-slate-700 leading-tight">
                                      {permission}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <>
                                {"View Module" in moduleValue && (
                                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-primary/5 border border-primary/20">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-800">
                                        View Module
                                      </p>
                                      <p className="text-xs text-slate-500 mt-0.5">
                                        Must be enabled to allow sub-permissions
                                      </p>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <Checkbox
                                        id={`select-all-group-edit-${moduleName}-view`}
                                        checked={isViewModulePermission}
                                        onCheckedChange={(checked) =>
                                          handlePermissionChange(
                                            moduleName,
                                            "View Module",
                                            !!checked,
                                          )
                                        }
                                      />
                                      <span className="text-xs font-medium text-slate-700">
                                        Allow
                                      </span>
                                    </label>
                                  </div>
                                )}
                                <div
                                  className={cn(
                                    "space-y-3",
                                    !isViewModulePermission &&
                                      "opacity-40 pointer-events-none",
                                  )}
                                >
                                  {Object.entries(moduleValue).map(
                                    ([subModuleKey, permissions]) => {
                                      if (subModuleKey === "View Module")
                                        return null;
                                      const fullKey = `${moduleName}.${subModuleKey}`;

                                      if (
                                        subModuleKey === "Departments" &&
                                        departments.length > 0
                                      ) {
                                        return (
                                          <div
                                            key={fullKey}
                                            className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden"
                                          >
                                            <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                                              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                                Department Permissions
                                              </h4>
                                            </div>
                                            <div className="p-3 space-y-3">
                                              {departments.map((dept) => {
                                                const deptKey = `Expenses.Departments.${dept.id}`;
                                                const deptPermissions =
                                                  permissions as string[];
                                                const grantedInDept =
                                                  editingRole.permissions?.[
                                                    deptKey
                                                  ] || [];
                                                const isAllInDeptSelected =
                                                  deptPermissions.length > 0 &&
                                                  grantedInDept.length ===
                                                    deptPermissions.length;
                                                return (
                                                  <div
                                                    key={dept.id}
                                                    className="p-3 rounded-lg bg-white border border-slate-200"
                                                  >
                                                    <div className="flex justify-between items-center mb-2.5">
                                                      <p className="text-sm font-medium text-slate-700">
                                                        {dept.name}
                                                      </p>
                                                      <label className="flex items-center gap-1.5 cursor-pointer">
                                                        <Checkbox
                                                          id={`select-all-dept-edit-${dept.id}`}
                                                          checked={
                                                            isAllInDeptSelected
                                                          }
                                                          onCheckedChange={(
                                                            checked,
                                                          ) =>
                                                            handleSelectAllForGroup(
                                                              deptKey,
                                                              deptPermissions,
                                                              !!checked,
                                                            )
                                                          }
                                                          disabled={
                                                            !isViewModulePermission
                                                          }
                                                        />
                                                        <span className="text-xs text-slate-500">
                                                          All
                                                        </span>
                                                      </label>
                                                    </div>
                                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                      {deptPermissions.map(
                                                        (
                                                          permission: string,
                                                        ) => (
                                                          <label
                                                            key={permission}
                                                            className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer"
                                                          >
                                                            <Checkbox
                                                              id={`edit-${deptKey}-${permission}`}
                                                              checked={grantedInDept.includes(
                                                                permission,
                                                              )}
                                                              onCheckedChange={(
                                                                checked,
                                                              ) =>
                                                                handlePermissionChange(
                                                                  deptKey,
                                                                  permission,
                                                                  !!checked,
                                                                )
                                                              }
                                                              disabled={
                                                                !isViewModulePermission
                                                              }
                                                            />
                                                            <span className="text-xs text-slate-600">
                                                              {permission}
                                                            </span>
                                                          </label>
                                                        ),
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (
                                        subModuleKey === "Projects" &&
                                        moduleName ===
                                          "Store & Stock Management"
                                      ) {
                                        const projectPermissions =
                                          permissions as string[];
                                        return (
                                          <div
                                            key={fullKey}
                                            className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden"
                                          >
                                            <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                                              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                                Project Permissions
                                              </h4>
                                            </div>
                                            <div className="p-3 space-y-3">
                                              {projects.map((proj) => {
                                                const projectKey = `Store & Stock Management.Projects.${proj.id}`;
                                                const grantedInProject =
                                                  editingRole.permissions?.[
                                                    projectKey
                                                  ] || [];
                                                const isAllInProjectSelected =
                                                  projectPermissions.length >
                                                    0 &&
                                                  grantedInProject.length ===
                                                    projectPermissions.length;
                                                return (
                                                  <div
                                                    key={proj.id}
                                                    className="p-3 rounded-lg bg-white border border-slate-200"
                                                  >
                                                    <div className="flex justify-between items-center mb-2.5">
                                                      <p className="text-sm font-medium text-slate-700">
                                                        {proj.projectName}
                                                      </p>
                                                      <label className="flex items-center gap-1.5 cursor-pointer">
                                                        <Checkbox
                                                          id={`select-all-project-edit-${proj.id}`}
                                                          checked={
                                                            isAllInProjectSelected
                                                          }
                                                          onCheckedChange={(
                                                            checked,
                                                          ) =>
                                                            handleSelectAllForGroup(
                                                              projectKey,
                                                              projectPermissions,
                                                              !!checked,
                                                            )
                                                          }
                                                          disabled={
                                                            !isViewModulePermission
                                                          }
                                                        />
                                                        <span className="text-xs text-slate-500">
                                                          All
                                                        </span>
                                                      </label>
                                                    </div>
                                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                      {projectPermissions.map(
                                                        (permission) => (
                                                          <label
                                                            key={permission}
                                                            className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer"
                                                          >
                                                            <Checkbox
                                                              id={`edit-${projectKey}-${permission}`}
                                                              checked={grantedInProject.includes(
                                                                permission,
                                                              )}
                                                              onCheckedChange={(
                                                                checked,
                                                              ) =>
                                                                handlePermissionChange(
                                                                  projectKey,
                                                                  permission,
                                                                  !!checked,
                                                                )
                                                              }
                                                              disabled={
                                                                !isViewModulePermission
                                                              }
                                                            />
                                                            <span className="text-xs text-slate-600">
                                                              {permission}
                                                            </span>
                                                          </label>
                                                        ),
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (
                                        Array.isArray(permissions) &&
                                        permissions.length > 0
                                      ) {
                                        const grantedInGroup =
                                          editingRole.permissions?.[fullKey] ||
                                          [];
                                        const isAllInGroupSelected =
                                          permissions.length > 0 &&
                                          grantedInGroup.length ===
                                            permissions.length;
                                        return (
                                          <div
                                            key={fullKey}
                                            className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden"
                                          >
                                            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                                              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                                {subModuleKey}
                                              </h4>
                                              <label className="flex items-center gap-1.5 cursor-pointer">
                                                <Checkbox
                                                  id={`select-all-group-edit-${fullKey}`}
                                                  checked={isAllInGroupSelected}
                                                  onCheckedChange={(checked) =>
                                                    handleSelectAllForGroup(
                                                      fullKey,
                                                      permissions as string[],
                                                      !!checked,
                                                    )
                                                  }
                                                  disabled={
                                                    !isViewModulePermission
                                                  }
                                                />
                                                <span className="text-xs text-slate-500">
                                                  All
                                                </span>
                                              </label>
                                            </div>
                                            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                              {permissions.map((permission) => (
                                                <label
                                                  key={permission}
                                                  className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-100 hover:border-slate-200 cursor-pointer transition-colors"
                                                >
                                                  <Checkbox
                                                    id={`edit-${fullKey}-${permission}`}
                                                    checked={grantedInGroup.includes(
                                                      permission,
                                                    )}
                                                    onCheckedChange={(
                                                      checked,
                                                    ) =>
                                                      handlePermissionChange(
                                                        fullKey,
                                                        permission,
                                                        !!checked,
                                                      )
                                                    }
                                                    disabled={
                                                      !isViewModulePermission
                                                    }
                                                  />
                                                  <span className="text-xs text-slate-700 leading-tight">
                                                    {permission}
                                                  </span>
                                                </label>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (
                                        typeof permissions === "object" &&
                                        !Array.isArray(permissions)
                                      ) {
                                        return (
                                          <div
                                            key={fullKey}
                                            className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden"
                                          >
                                            <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                                              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                                {subModuleKey}
                                              </h4>
                                            </div>
                                            <div className="p-3 space-y-2">
                                              {Object.entries(permissions).map(
                                                ([nestedKey, nestedPerms]) => {
                                                  if (
                                                    !Array.isArray(nestedPerms)
                                                  )
                                                    return null;
                                                  const nestedFullKey = `${fullKey}.${nestedKey}`;
                                                  const grantedInNestedGroup =
                                                    editingRole.permissions?.[
                                                      nestedFullKey
                                                    ] || [];
                                                  const isAllInNestedSelected =
                                                    nestedPerms.length > 0 &&
                                                    grantedInNestedGroup.length ===
                                                      nestedPerms.length;
                                                  if (
                                                    nestedPerms.length === 0
                                                  ) {
                                                    return (
                                                      <label
                                                        key={nestedFullKey}
                                                        className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-slate-100 hover:border-slate-200 cursor-pointer"
                                                      >
                                                        <Checkbox
                                                          id={`edit-${nestedFullKey}-View`}
                                                          checked={grantedInNestedGroup.includes(
                                                            "View",
                                                          )}
                                                          onCheckedChange={(
                                                            checked,
                                                          ) =>
                                                            handlePermissionChange(
                                                              nestedFullKey,
                                                              "View",
                                                              !!checked,
                                                            )
                                                          }
                                                          disabled={
                                                            !isViewModulePermission
                                                          }
                                                        />
                                                        <span className="text-sm text-slate-700">
                                                          {nestedKey}
                                                        </span>
                                                      </label>
                                                    );
                                                  }
                                                  return (
                                                    <div
                                                      key={nestedFullKey}
                                                      className="rounded-lg border border-slate-200 bg-white overflow-hidden"
                                                    >
                                                      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
                                                        <p className="text-xs font-medium text-slate-700">
                                                          {nestedKey}
                                                        </p>
                                                        {nestedPerms.length >
                                                          1 && (
                                                          <label className="flex items-center gap-1.5 cursor-pointer">
                                                            <Checkbox
                                                              id={`select-all-nested-edit-${nestedFullKey}`}
                                                              checked={
                                                                isAllInNestedSelected
                                                              }
                                                              onCheckedChange={(
                                                                checked,
                                                              ) =>
                                                                handleSelectAllForGroup(
                                                                  nestedFullKey,
                                                                  nestedPerms,
                                                                  !!checked,
                                                                )
                                                              }
                                                              disabled={
                                                                !isViewModulePermission
                                                              }
                                                            />
                                                            <span className="text-xs text-slate-500">
                                                              All
                                                            </span>
                                                          </label>
                                                        )}
                                                      </div>
                                                      <div className="p-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                                        {nestedPerms.map(
                                                          (p) => (
                                                            <label
                                                              key={p}
                                                              className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer"
                                                            >
                                                              <Checkbox
                                                                id={`edit-${nestedFullKey}-${p}`}
                                                                checked={grantedInNestedGroup.includes(
                                                                  p,
                                                                )}
                                                                onCheckedChange={(
                                                                  checked,
                                                                ) =>
                                                                  handlePermissionChange(
                                                                    nestedFullKey,
                                                                    p,
                                                                    !!checked,
                                                                  )
                                                                }
                                                                disabled={
                                                                  !isViewModulePermission
                                                                }
                                                              />
                                                              <span className="text-xs text-slate-600">
                                                                {p}
                                                              </span>
                                                            </label>
                                                          ),
                                                        )}
                                                      </div>
                                                    </div>
                                                  );
                                                },
                                              )}
                                            </div>
                                          </div>
                                        );
                                      }
                                    },
                                  )}
                                </div>
                              </>
                            )}
                    </div>
                  </ScrollArea>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Mobile sticky save bar */}
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-sm p-3 lg:hidden">
          <Button
            onClick={handleUpdateRole}
            disabled={isSaving || !canEdit}
            className="w-full rounded-full shadow-md"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Renaming a role that's still assigned to users requires an explicit, informed confirmation
          before we cascade-update those users' `role` field — otherwise the rename would silently
          orphan them (AuthProvider resolves permissions by role NAME, not id). */}
      <AlertDialog
        open={!!pendingRenameSave}
        onOpenChange={(open) => !open && setPendingRenameSave(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename role and update assigned users?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRenameSave?.userCount} user
              {pendingRenameSave?.userCount === 1 ? "" : "s"} currently{" "}
              {pendingRenameSave?.userCount === 1 ? "has" : "have"} the role &quot;
              {originalName}&quot;. Renaming it to &quot;{pendingRenameSave?.newName}&quot; will
              also update {pendingRenameSave?.userCount === 1 ? "that user" : "those users"} to the
              new name, so nobody loses access. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSaving}
              onClick={() =>
                pendingRenameSave &&
                performSave(pendingRenameSave.newName, true)
              }
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Rename &amp; Update Users
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
