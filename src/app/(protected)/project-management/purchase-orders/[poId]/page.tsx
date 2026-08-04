"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  PackageCheck,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import { deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PO_COLLECTION,
  PO_PERMISSION_RESOURCE,
  formatCurrency,
  formatQuantity,
  poStatusStyles,
  type PurchaseOrder,
} from "@/lib/purchase-orders";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export default function ProjectPurchaseOrderDetailPage() {
  const { poId } = useParams() as { poId: string };
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", PO_PERMISSION_RESOURCE) || can("View", "Project Management.RFQ");
  const canIssue = can("Issue", PO_PERMISSION_RESOURCE);
  const canReceive = can("Receive", PO_PERMISSION_RESOURCE);
  const canCancel = can("Cancel", PO_PERMISSION_RESOURCE);
  const canDelete = can("Delete", PO_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const loadPo = useCallback(async () => {
    if (!mappingId || !poId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");
      setMapping(mappingData);

      const snapshot = await getDoc(doc(db, "projects", mappingData.globalProjectId, PO_COLLECTION, poId));
      if (!snapshot.exists()) {
        setPo(null);
        return;
      }
      setPo({ id: snapshot.id, ...snapshot.data() } as PurchaseOrder);
    } catch (error) {
      console.error("Failed to load purchase order:", error);
      toast({ title: "Unable to load purchase order", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, poId, toast]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadPo();
  }, [canView, isAuthLoading, loadPo]);

  const updateStatus = async (status: PurchaseOrder["status"]) => {
    if (!mapping || !po) return;
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, "projects", mapping.globalProjectId, PO_COLLECTION, po.id), {
        status,
        updatedAt: serverTimestamp(),
      });
      toast({ title: `Purchase order marked as ${status}` });
      await loadPo();
    } catch (error) {
      console.error("Failed to update purchase order status:", error);
      toast({ title: "Unable to update purchase order", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!mapping || !po) return;
    setIsUpdating(true);
    try {
      await deleteDoc(doc(db, "projects", mapping.globalProjectId, PO_COLLECTION, po.id));
      toast({ title: "Draft purchase order deleted" });
      router.push(`/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`);
    } catch (error) {
      console.error("Failed to delete purchase order:", error);
      toast({ title: "Unable to delete purchase order", variant: "destructive" });
      setIsUpdating(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view purchase orders.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!po || !mapping) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Purchase order not found</CardTitle>
            <CardDescription>This purchase order may have been deleted, or the project link is invalid.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href={`/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`}>Back to Purchase Orders</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Purchase Orders">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
            <ShoppingCart className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{po.poNumber}</h1>
            <p className="text-sm text-muted-foreground">
              {po.vendorName}{po.sourceRfqNumbers?.length ? ` · from ${po.sourceRfqNumbers.join(", ")}` : ""}
            </p>
          </div>
          <span className={`ml-2 rounded-full px-3 py-1 text-xs font-medium ${poStatusStyles[po.status]}`}>
            {po.status}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {po.status === "Draft" && canIssue && (
            <Button onClick={() => void updateStatus("Issued")} disabled={isUpdating}>
              <Truck className="mr-2 h-4 w-4" /> Mark as Issued
            </Button>
          )}
          {po.status === "Issued" && canReceive && (
            <Button onClick={() => void updateStatus("Received")} disabled={isUpdating}>
              <PackageCheck className="mr-2 h-4 w-4" /> Mark as Received
            </Button>
          )}
          {(po.status === "Draft" || po.status === "Issued") && canCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={isUpdating}>
                  <Ban className="mr-2 h-4 w-4" /> Cancel PO
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this purchase order?</AlertDialogTitle>
                  <AlertDialogDescription>This marks the PO as cancelled. This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Back</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void updateStatus("Cancelled")}>Cancel PO</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {po.status === "Draft" && canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isUpdating}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this draft purchase order?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">PO Date</p><p className="font-semibold">{formatDate(po.poDate)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Delivery Date</p><p className="font-semibold">{formatDate(po.deliveryDate)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Items</p><p className="font-semibold">{po.items?.length ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Amount</p><p className="font-semibold">{formatCurrency(po.totalAmount)}</p></CardContent></Card>
      </div>

      {po.terms && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Terms / Remarks</CardTitle></CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">{po.terms}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>Line items included in this purchase order.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>BOQ Qty</TableHead>
                  <TableHead>Indent Qty</TableHead>
                  <TableHead>PO Qty</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Source RFQ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(po.items ?? []).map((item, index) => (
                  <TableRow key={index}>
                    <TableCell className="max-w-md">{item.description}</TableCell>
                    <TableCell>{item.unit || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{typeof item.boqQty === "number" ? formatQuantity(item.boqQty) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{typeof item.indentQty === "number" ? formatQuantity(item.indentQty) : "—"}</TableCell>
                    <TableCell>{formatQuantity(item.qty)}</TableCell>
                    <TableCell>{formatCurrency(item.rate)}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(item.amount)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.sourceRfqNumber || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {po.status === "Received" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> This purchase order has been fully received.
        </div>
      )}
    </main>
  );
}
