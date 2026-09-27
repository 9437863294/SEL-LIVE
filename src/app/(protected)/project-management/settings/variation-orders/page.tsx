"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  GitPullRequestArrow,
  Loader2,
  Plus,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  computeVariancePct,
  VARIATION_COLLECTION,
  VARIATION_PERMISSION_RESOURCE,
  type BoqVariation,
} from "@/lib/project-management-variations";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { BoqItemSelector } from "@/components/billing-recon/BoqItemSelector";
import {
  PM_DIALOG,
  PmDataList,
  PmEmptyState,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import { cn } from "@/lib/utils";

const PROJECTS_COLLECTION = "projectManagementProjects";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
  status: "Active" | "Inactive";
};

const formatDate = (value?: { toDate?: () => Date }) => {
  if (!value?.toDate) return "—";
  return value.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const statusStyles: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-700",
  Approved: "bg-emerald-100 text-emerald-700",
  Rejected: "bg-red-100 text-red-700",
};

export default function VariationOrdersPage() {
  const searchParams = useSearchParams();
  const deepLinkMappingId = searchParams?.get("project") ?? "";
  const deepLinkBoqItemId = searchParams?.get("boqItemId") ?? "";
  const deepLinkSurveyedQty = searchParams?.get("surveyedQty") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();

  const canView = can("View", VARIATION_PERMISSION_RESOURCE);
  const canAdd = can("Add", VARIATION_PERMISSION_RESOURCE);
  const canDecide = can("Approve", VARIATION_PERMISSION_RESOURCE) || can("Reject", VARIATION_PERMISSION_RESOURCE);

  const [variations, setVariations] = useState<BoqVariation[]>([]);
  const [mappings, setMappings] = useState<ProjectMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [decidingId, setDecidingId] = useState("");

  const [selectedMappingId, setSelectedMappingId] = useState("");
  const [projectBoqItems, setProjectBoqItems] = useState<BoqItem[]>([]);
  const [isLoadingBoqItems, setIsLoadingBoqItems] = useState(false);
  const [selectedBoqItem, setSelectedBoqItem] = useState<BoqItem | null>(null);
  const [requestedQty, setRequestedQty] = useState("");
  const [reason, setReason] = useState("");
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [variationSnapshot, mappingSnapshot] = await Promise.all([
        getDocs(collection(db, VARIATION_COLLECTION)),
        getDocs(collection(db, PROJECTS_COLLECTION)),
      ]);
      setVariations(
        variationSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as BoqVariation)
          .sort((a, b) => {
            if (a.status !== b.status) return a.status === "Pending" ? -1 : 1;
            return (b.requestedOn?.toMillis?.() ?? 0) - (a.requestedOn?.toMillis?.() ?? 0);
          }),
      );
      setMappings(
        mappingSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as ProjectMapping)
          .filter((item) => item.status === "Active")
          .sort((a, b) => a.projectName.localeCompare(b.projectName)),
      );
    } catch (error) {
      console.error("Failed to load variation orders:", error);
      toast({ title: "Unable to load variation orders", variant: "destructive" });
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

  // Arriving from Survey with ?project=&boqItemId= — open the request dialog pre-filled instead
  // of making the user re-select what they just came from.
  useEffect(() => {
    if (deepLinkApplied || !deepLinkMappingId || !mappings.length) return;
    const mapping = mappings.find((item) => item.id === deepLinkMappingId);
    if (!mapping) return;
    setDeepLinkApplied(true);
    setIsDialogOpen(true);
    setSelectedMappingId(mapping.id);
    setIsLoadingBoqItems(true);
    (async () => {
      try {
        const snapshot = await getDocs(collection(db, "projects", mapping.globalProjectId, "boqItems"));
        const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as BoqItem);
        setProjectBoqItems(items);
        if (deepLinkBoqItemId) {
          const match = items.find((item) => item.id === deepLinkBoqItemId);
          if (match) setSelectedBoqItem(match);
        }
        if (deepLinkSurveyedQty) setRequestedQty(deepLinkSurveyedQty);
      } catch (error) {
        console.error("Failed to load BOQ items for variation request:", error);
        toast({ title: "Unable to load BOQ items", variant: "destructive" });
      } finally {
        setIsLoadingBoqItems(false);
      }
    })();
  }, [deepLinkApplied, deepLinkMappingId, deepLinkBoqItemId, deepLinkSurveyedQty, mappings, toast]);

  const resetDialog = () => {
    setSelectedMappingId("");
    setProjectBoqItems([]);
    setSelectedBoqItem(null);
    setRequestedQty("");
    setReason("");
  };

  const handleMappingChange = async (mappingId: string) => {
    setSelectedMappingId(mappingId);
    setSelectedBoqItem(null);
    const mapping = mappings.find((item) => item.id === mappingId);
    if (!mapping) return;
    setIsLoadingBoqItems(true);
    try {
      const snapshot = await getDocs(collection(db, "projects", mapping.globalProjectId, "boqItems"));
      setProjectBoqItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as BoqItem));
    } catch (error) {
      console.error("Failed to load BOQ items for variation request:", error);
      toast({ title: "Unable to load BOQ items", variant: "destructive" });
    } finally {
      setIsLoadingBoqItems(false);
    }
  };

  const handleCreate = async () => {
    const mapping = mappings.find((item) => item.id === selectedMappingId);
    if (!mapping || !selectedBoqItem || !user) {
      toast({ title: "Select a project and a BOQ item", variant: "destructive" });
      return;
    }
    const qty = Number(requestedQty);
    if (!qty || qty <= 0) {
      toast({ title: "Enter a valid requested quantity", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "A reason is required", variant: "destructive" });
      return;
    }
    const boqQty = Number(selectedBoqItem["QTY"] ?? 0);

    setIsSaving(true);
    try {
      await addDoc(collection(db, VARIATION_COLLECTION), {
        projectMappingId: mapping.id,
        projectManagementProjectName: mapping.projectName,
        globalProjectId: mapping.globalProjectId,
        globalProjectName: mapping.globalProjectName,
        boqItemId: selectedBoqItem.id,
        boqSlNo: String(selectedBoqItem["BOQ SL No"] ?? selectedBoqItem["SL. No."] ?? ""),
        description: String(selectedBoqItem["Description"] ?? ""),
        boqQty,
        requestedQty: qty,
        variancePct: computeVariancePct(qty, boqQty),
        reason: reason.trim(),
        requestedBy: user.id,
        requestedByName: user.name,
        requestedOn: serverTimestamp(),
        status: "Pending",
      });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Request Variation Order",
        details: { project: mapping.projectName, boqSlNo: selectedBoqItem["BOQ SL No"], requestedQty: qty },
      });
      toast({ title: "Variation order requested" });
      setIsDialogOpen(false);
      resetDialog();
      await loadData();
    } catch (error) {
      console.error("Failed to create variation order:", error);
      toast({ title: "Unable to create variation order", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const decide = async (variation: BoqVariation, status: "Approved" | "Rejected") => {
    if (!user) return;
    setDecidingId(variation.id);
    try {
      await updateDoc(doc(db, VARIATION_COLLECTION, variation.id), {
        status,
        decidedBy: user.id,
        decidedByName: user.name,
        decidedOn: serverTimestamp(),
      });
      if (status === "Approved") {
        // Raises the BOQ item's effective allowance by exactly the excess this variation covers,
        // so Indent's own availability check (boqQty + variationApprovedQty - alreadyIndented)
        // now permits the requested quantity.
        const extra = Math.max(0, variation.requestedQty - variation.boqQty);
        if (extra > 0) {
          await updateDoc(doc(db, "projects", variation.globalProjectId, "boqItems", variation.boqItemId), {
            variationApprovedQty: increment(extra),
          });
        }
      }
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `${status} Variation Order`,
        details: { project: variation.projectManagementProjectName, boqSlNo: variation.boqSlNo },
      });
      toast({ title: `Variation order ${status.toLowerCase()}` });
      await loadData();
    } catch (error) {
      console.error("Failed to decide variation order:", error);
      toast({ title: "Unable to update variation order", variant: "destructive" });
    } finally {
      setDecidingId("");
    }
  };

  const pendingCount = useMemo(() => variations.filter((item) => item.status === "Pending").length, [variations]);

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
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Variation Orders</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view variation orders.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  const columns: PmListColumn<BoqVariation>[] = [
    {
      header: "Project",
      mobile: "title",
      className: "whitespace-nowrap font-medium",
      cell: (variation) => variation.projectManagementProjectName,
    },
    {
      header: "BOQ Item",
      mobile: "title",
      className: "max-w-xs truncate",
      cell: (variation) => (
        <span title={variation.description}>
          {variation.boqSlNo} — {variation.description}
        </span>
      ),
    },
    { header: "BOQ Qty", align: "right", cell: (variation) => variation.boqQty },
    {
      header: "Requested",
      align: "right",
      className: "font-medium",
      cell: (variation) => variation.requestedQty,
    },
    {
      header: "Variance",
      align: "right",
      cell: (variation) => (
        <span className={variation.variancePct > 0 ? "text-amber-600" : ""}>
          {variation.variancePct > 0 ? "+" : ""}{variation.variancePct}%
        </span>
      ),
    },
    {
      // Free text: a wrapping sub-line on the phone card rather than a truncated detail.
      header: "Reason",
      mobile: "title",
      className: "max-w-xs truncate",
      cell: (variation) => <span title={variation.reason}>{variation.reason}</span>,
    },
    {
      header: "Requested By",
      className: "whitespace-nowrap",
      cell: (variation) => variation.requestedByName,
    },
    {
      header: "Status",
      mobile: "aside",
      cell: (variation) => (
        <Badge variant="outline" className={statusStyles[variation.status]}>
          {variation.status}
        </Badge>
      ),
    },
    {
      header: "Actions",
      align: "right",
      mobile: "footer",
      className: "w-28",
      cell: (variation) =>
        variation.status === "Pending" && canDecide ? (
          // Icon-only in the table; on a phone card each stretches into a labelled button.
          <div className="flex w-full justify-end gap-1 sm:w-auto">
            <Button
              variant="ghost"
              size="icon"
              className="max-sm:border"
              disabled={decidingId === variation.id}
              onClick={() => void decide(variation, "Approved")}
              title="Approve"
            >
              {decidingId === variation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-emerald-600" />}
              <span className="ml-2 sm:hidden">Approve</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="max-sm:border"
              disabled={decidingId === variation.id}
              onClick={() => void decide(variation, "Rejected")}
              title="Reject"
            >
              <X className="h-4 w-4 text-destructive" />
              <span className="ml-2 sm:hidden">Reject</span>
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {variation.decidedByName ? `by ${variation.decidedByName}` : "—"}
          </span>
        ),
    },
  ];

  return (
    <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <Link href="/project-management/settings" aria-label="Back to Settings">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm sm:flex">
            <GitPullRequestArrow className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold sm:text-3xl">Variation Orders</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground sm:mt-1 sm:text-sm">
              {variations.length} total · {pendingCount} pending approval
            </p>
          </div>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetDialog(); }}>
          <DialogTrigger asChild>
            <Button disabled={!canAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Request Variation
            </Button>
          </DialogTrigger>
          <DialogContent className={cn(PM_DIALOG.content, "sm:max-w-xl")}>
            <DialogHeader className={PM_DIALOG.header}>
              <DialogTitle>Request a Variation Order</DialogTitle>
              <DialogDescription>
                Quantities above the approved BOQ (beyond the configured tolerance) can&apos;t be indented, ordered, or
                billed without an approved variation covering the excess.
              </DialogDescription>
            </DialogHeader>
            <div className={cn(PM_DIALOG.body, "grid grid-cols-1 gap-4 space-y-0 py-4")}>
              <div className="space-y-2">
                <Label>Project</Label>
                <Select value={selectedMappingId} onValueChange={handleMappingChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project..." />
                  </SelectTrigger>
                  <SelectContent>
                    {mappings.map((mapping) => (
                      <SelectItem key={mapping.id} value={mapping.id}>
                        {mapping.projectName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedMappingId && (
                <div className="space-y-2">
                  <Label>BOQ Item</Label>
                  <BoqItemSelector
                    boqItems={projectBoqItems}
                    selectedSlNo={selectedBoqItem ? String(selectedBoqItem["BOQ SL No"] ?? "") : null}
                    onSelect={setSelectedBoqItem}
                    isLoading={isLoadingBoqItems}
                  />
                </div>
              )}
              {selectedBoqItem && (
                <p className="text-xs text-muted-foreground">
                  Current BOQ quantity: {String(selectedBoqItem["QTY"] ?? 0)} {String(selectedBoqItem["Unit"] ?? "")}
                </p>
              )}
              <div className="space-y-2">
                <Label>Requested quantity</Label>
                <Input
                  type="number"
                  min="0"
                  value={requestedQty}
                  onChange={(event) => setRequestedQty(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  placeholder="Why does the surveyed/required quantity exceed the BOQ?"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter className={PM_DIALOG.footer}>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleCreate} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit Request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <PmDataList
        rows={variations}
        columns={columns}
        empty={
          <PmEmptyState
            icon={GitPullRequestArrow}
            title="No variation orders"
            description="Requests appear here when surveyed or required quantities exceed the BOQ."
          />
        }
      />
    </main>
  );
}
