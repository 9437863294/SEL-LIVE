"use client";

/**
 * Settings › Clients — the container: permissions, Field Control, and the Firestore reads and
 * writes. Everything on screen is `ClientsView` (props-only, so it can be rendered with fabricated
 * data).
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
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Client } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { useFieldControl, validateFieldControlRequirements } from "@/components/project-management/use-field-control";
import { clientFormToRecord, type ClientForm } from "@/components/project-management/client-dialog";
import { ClientsView } from "@/components/project-management/clients-view";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";

const COLLECTION_NAME = "clients";
const PERMISSION_RESOURCE = "Project Management.Clients";

async function fetchClients(): Promise<Client[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_NAME));
  return snapshot.docs
    .map((clientDoc) => ({ id: clientDoc.id, ...clientDoc.data() }) as Client)
    .sort((a, b) => a.name.localeCompare(b.name));
}

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

  /**
   * Reads every client, by name. `isLoading` starts true for the first read; a reload after a save
   * keeps the cards on screen until the fresh list replaces them, rather than flashing the skeleton.
   */
  const loadData = useCallback(async () => {
    try {
      setClients(await fetchClients());
    } catch (error) {
      console.error("Failed to load clients:", error);
      toast({ title: "Unable to load clients", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Without View the page shows Access Denied and never reads, so "loading" only matters with it.
  useEffect(() => {
    if (isAuthLoading || !canView) return;
    const load = async () => {
      try {
        setClients(await fetchClients());
      } catch (error) {
        console.error("Failed to load clients:", error);
        toast({ title: "Unable to load clients", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [canView, isAuthLoading, toast]);

  const handleSave = async ({ id, form }: { id: string | null; form: ClientForm }): Promise<boolean> => {
    // The dialog checks all of this as it is typed; these stay as the last word before a write.
    const name = form.name.trim();
    if (!name) {
      toast({ title: "Client name is required", variant: "destructive" });
      return false;
    }
    if (id ? !canEdit : !canAdd) return false;
    const missingLabel = validateFieldControlRequirements("clientMaster", { ...form }, fieldControl);
    if (missingLabel) {
      toast({ title: `${missingLabel} is required`, variant: "destructive" });
      return false;
    }
    const duplicateName = clients.some(
      (client) => client.id !== id && client.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicateName) {
      toast({
        title: "Name already in use",
        description: `A client named "${name}" already exists.`,
        variant: "destructive",
      });
      return false;
    }

    try {
      const payload = { ...clientFormToRecord(form), updatedAt: serverTimestamp() };
      if (id) {
        await updateDoc(doc(db, COLLECTION_NAME, id), payload);
      } else {
        await addDoc(collection(db, COLLECTION_NAME), { ...payload, createdAt: serverTimestamp() });
      }
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: id ? "Update Client" : "Create Client",
          details: { clientName: name },
        });
      }
      toast({ title: id ? "Client updated" : "Client created" });
      await loadData();
      return true;
    } catch (error) {
      console.error("Failed to save client:", error);
      toast({ title: "Unable to save client", variant: "destructive" });
      return false;
    }
  };

  const handleDelete = async (client: Client): Promise<boolean> => {
    if (!canDelete) return false;
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
        return false;
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
      await loadData();
      return true;
    } catch (error) {
      console.error("Failed to delete client:", error);
      toast({ title: "Unable to delete client", variant: "destructive" });
      return false;
    }
  };

  if (isAuthLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Skeleton className="mb-6 h-28 w-full rounded-3xl" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="Clients" />
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
      <ClientsView
        clients={clients}
        isLoading={isLoading}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
        fieldControl={fieldControl}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </main>
  );
}
