"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  Users,
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
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Client } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { ControlledField } from "@/components/project-management/controlled-field";
import { useFieldControl, validateFieldControlRequirements } from "@/components/project-management/use-field-control";
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

const COLLECTION_NAME = "clients";
const PERMISSION_RESOURCE = "Project Management.Clients";

type ClientForm = {
  name: string;
  gstin: string;
  pan: string;
  address: string;
  paymentTermsDays: string;
  retentionPct: string;
  defaultTdsPct: string;
  warrantyMonths: string;
  ldRatePct: string;
  ldCapPct: string;
  performanceSecurityPct: string;
  inspectionRegime: string;
  status: "Active" | "Inactive";
};

const emptyForm: ClientForm = {
  name: "",
  gstin: "",
  pan: "",
  address: "",
  paymentTermsDays: "",
  retentionPct: "",
  defaultTdsPct: "",
  warrantyMonths: "",
  ldRatePct: "",
  ldCapPct: "",
  performanceSecurityPct: "",
  inspectionRegime: "",
  status: "Active",
};

export default function ClientMasterPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();
  const { field: fieldControl } = useFieldControl("clientMaster");

  const canView = can("View", PERMISSION_RESOURCE);
  const canAdd = can("Add", PERMISSION_RESOURCE);
  const canEdit = can("Edit", PERMISSION_RESOURCE);
  const canDelete = can("Delete", PERMISSION_RESOURCE);

  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const snapshot = await getDocs(collection(db, COLLECTION_NAME));
      setClients(
        snapshot.docs
          .map((clientDoc) => ({ id: clientDoc.id, ...clientDoc.data() }) as Client)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (error) {
      console.error("Failed to load clients:", error);
      toast({ title: "Unable to load clients", variant: "destructive" });
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
    setEditingClient(null);
    setForm(emptyForm);
    setIsDialogOpen(true);
  };

  const openEditDialog = (client: Client) => {
    setEditingClient(client);
    setForm({
      name: client.name,
      gstin: client.gstin ?? "",
      pan: client.pan ?? "",
      address: client.addresses?.[0] ?? "",
      paymentTermsDays: client.paymentTermsDays != null ? String(client.paymentTermsDays) : "",
      retentionPct: client.retentionPct != null ? String(client.retentionPct) : "",
      defaultTdsPct: client.defaultTdsPct != null ? String(client.defaultTdsPct) : "",
      warrantyMonths: client.warrantyMonths != null ? String(client.warrantyMonths) : "",
      ldRatePct: client.ldRatePct != null ? String(client.ldRatePct) : "",
      ldCapPct: client.ldCapPct != null ? String(client.ldCapPct) : "",
      performanceSecurityPct: client.performanceSecurityPct != null ? String(client.performanceSecurityPct) : "",
      inspectionRegime: client.inspectionRegime ?? "",
      status: client.status,
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      toast({ title: "Client name is required", variant: "destructive" });
      return;
    }

    const missingLabel = validateFieldControlRequirements("clientMaster", { ...form }, fieldControl);
    if (missingLabel) {
      toast({ title: `${missingLabel} is required`, variant: "destructive" });
      return;
    }

    const duplicateName = clients.some(
      (client) => client.id !== editingClient?.id && client.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicateName) {
      toast({
        title: "Name already in use",
        description: `A client named "${name}" already exists.`,
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name,
        gstin: form.gstin.trim(),
        pan: form.pan.trim(),
        addresses: form.address.trim() ? [form.address.trim()] : [],
        paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : null,
        retentionPct: form.retentionPct ? Number(form.retentionPct) : null,
        defaultTdsPct: form.defaultTdsPct ? Number(form.defaultTdsPct) : null,
        warrantyMonths: form.warrantyMonths ? Number(form.warrantyMonths) : null,
        ldRatePct: form.ldRatePct ? Number(form.ldRatePct) : null,
        ldCapPct: form.ldCapPct ? Number(form.ldCapPct) : null,
        performanceSecurityPct: form.performanceSecurityPct ? Number(form.performanceSecurityPct) : null,
        inspectionRegime: form.inspectionRegime.trim(),
        status: form.status,
        updatedAt: serverTimestamp(),
      };

      if (editingClient) {
        await updateDoc(doc(db, COLLECTION_NAME, editingClient.id), payload);
      } else {
        await addDoc(collection(db, COLLECTION_NAME), { ...payload, createdAt: serverTimestamp() });
      }

      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: editingClient ? "Update Client" : "Create Client",
          details: { clientName: name },
        });
      }

      toast({ title: editingClient ? "Client updated" : "Client created" });
      setIsDialogOpen(false);
      setEditingClient(null);
      setForm(emptyForm);
      await loadData();
    } catch (error) {
      console.error("Failed to save client:", error);
      toast({ title: "Unable to save client", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (client: Client) => {
    setIsDeleting(true);
    try {
      // A client referenced by any project shouldn't quietly become unreachable — block instead.
      const projectsSnapshot = await getDocs(
        query(collection(db, "projects"), where("clientId", "==", client.id), limit(1)),
      );
      if (!projectsSnapshot.empty) {
        toast({
          title: "Can't delete this client",
          description: `At least one project is still linked to "${client.name}". Unlink or reassign it first.`,
          variant: "destructive",
        });
        return;
      }
      await deleteDoc(doc(db, COLLECTION_NAME, client.id));
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: "Delete Client",
          details: { clientName: client.name },
        });
      }
      toast({ title: "Client deleted" });
      setDeleteTarget(null);
      await loadData();
    } catch (error) {
      console.error("Failed to delete client:", error);
      toast({ title: "Unable to delete client", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const activeCount = useMemo(() => clients.filter((client) => client.status === "Active").length, [clients]);

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
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Clients</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view clients.</CardDescription>
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
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Clients</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {clients.length} client{clients.length === 1 ? "" : "s"} · {activeCount} active
            </p>
          </div>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog} disabled={!canAdd}>
              <Plus className="mr-2 h-4 w-4" />
              New Client
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{editingClient ? "Edit Client" : "Create Client"}</DialogTitle>
              <DialogDescription>
                Clients are the paying customer for one or more projects — contract terms like retention and
                payment terms can default from here.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <ControlledField setting={fieldControl("name")}>
                <Input
                  value={form.name}
                  placeholder="e.g. Power Grid Corporation"
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </ControlledField>

              <div className="grid gap-4 sm:grid-cols-2">
                <ControlledField setting={fieldControl("gstin")}>
                  <Input value={form.gstin} onChange={(event) => setForm((current) => ({ ...current, gstin: event.target.value }))} />
                </ControlledField>
                <ControlledField setting={fieldControl("pan")}>
                  <Input value={form.pan} onChange={(event) => setForm((current) => ({ ...current, pan: event.target.value }))} />
                </ControlledField>
              </div>

              <ControlledField setting={fieldControl("address")}>
                <Input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
              </ControlledField>

              <div className="grid gap-4 sm:grid-cols-3">
                <ControlledField setting={fieldControl("paymentTermsDays")}>
                  <Input
                    type="number"
                    min="0"
                    value={form.paymentTermsDays}
                    onChange={(event) => setForm((current) => ({ ...current, paymentTermsDays: event.target.value }))}
                  />
                </ControlledField>
                <ControlledField setting={fieldControl("retentionPct")}>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={form.retentionPct}
                    onChange={(event) => setForm((current) => ({ ...current, retentionPct: event.target.value }))}
                  />
                </ControlledField>
                <ControlledField setting={fieldControl("defaultTdsPct")}>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={form.defaultTdsPct}
                    onChange={(event) => setForm((current) => ({ ...current, defaultTdsPct: event.target.value }))}
                  />
                </ControlledField>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium">Flow-Down Terms</p>
                <p className="text-xs text-muted-foreground">
                  What this client&apos;s contract obligates SEL to — every purchase order is checked against
                  these before issue.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <ControlledField setting={fieldControl("warrantyMonths")}>
                  <Input
                    type="number"
                    min="0"
                    value={form.warrantyMonths}
                    onChange={(event) => setForm((current) => ({ ...current, warrantyMonths: event.target.value }))}
                  />
                </ControlledField>
                <ControlledField setting={fieldControl("ldRatePct")}>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={form.ldRatePct}
                    onChange={(event) => setForm((current) => ({ ...current, ldRatePct: event.target.value }))}
                  />
                </ControlledField>
                <ControlledField setting={fieldControl("ldCapPct")}>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={form.ldCapPct}
                    onChange={(event) => setForm((current) => ({ ...current, ldCapPct: event.target.value }))}
                  />
                </ControlledField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ControlledField setting={fieldControl("performanceSecurityPct")}>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={form.performanceSecurityPct}
                    onChange={(event) => setForm((current) => ({ ...current, performanceSecurityPct: event.target.value }))}
                  />
                </ControlledField>
                <ControlledField setting={fieldControl("inspectionRegime")}>
                  <Input
                    placeholder="e.g. Client inspection at works, 15-day notice"
                    value={form.inspectionRegime}
                    onChange={(event) => setForm((current) => ({ ...current, inspectionRegime: event.target.value }))}
                  />
                </ControlledField>
              </div>

              <div className="space-y-2">
                <Select
                  value={form.status}
                  onValueChange={(status: "Active" | "Inactive") => setForm((current) => ({ ...current, status }))}
                >
                  <SelectTrigger>
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
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingClient ? "Save Changes" : "Create Client"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead className="text-right">Payment Terms</TableHead>
                  <TableHead className="text-right">Retention %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.length ? (
                  clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="font-medium">{client.name}</TableCell>
                      <TableCell>{client.gstin || "—"}</TableCell>
                      <TableCell>{client.pan || "—"}</TableCell>
                      <TableCell className="text-right">
                        {client.paymentTermsDays != null ? `${client.paymentTermsDays} days` : "—"}
                      </TableCell>
                      <TableCell className="text-right">{client.retentionPct != null ? `${client.retentionPct}%` : "—"}</TableCell>
                      <TableCell>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            client.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {client.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" disabled={!canEdit} onClick={() => openEditDialog(client)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog open={deleteTarget?.id === client.id} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" disabled={!canDelete} onClick={() => setDeleteTarget(client)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete &quot;{client.name}&quot;?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This action cannot be undone. Projects still linked to this client will block the delete.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                                <AlertDialogAction disabled={isDeleting} onClick={() => void handleDelete(client)}>
                                  {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">No clients yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">Add the customers projects are executed for.</p>
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
