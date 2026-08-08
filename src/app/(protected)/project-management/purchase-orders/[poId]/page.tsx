"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  FileUp,
  Loader2,
  Paperclip,
  PackageCheck,
  Pencil,
  Printer,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  isPoOverdue,
  poStatusStyles,
  toNumber,
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
  const canEditDates = can("Add", PO_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [budgetPriceByBoqItemId, setBudgetPriceByBoqItemId] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDatesDialogOpen, setIsDatesDialogOpen] = useState(false);
  const [datesForm, setDatesForm] = useState({ startDate: "", endDate: "" });
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);

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

      const [snapshot, boqSnapshot] = await Promise.all([
        getDoc(doc(db, "projects", mappingData.globalProjectId, PO_COLLECTION, poId)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
      ]);
      setBudgetPriceByBoqItemId(
        new Map(
          boqSnapshot.docs.map((d) => [d.id, toNumber((d.data() as Record<string, unknown>)["Budget Price"])]),
        ),
      );
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

  const openDatesDialog = () => {
    if (!po) return;
    setDatesForm({ startDate: po.startDate ?? "", endDate: po.endDate ?? "" });
    setIsDatesDialogOpen(true);
  };

  const handleSaveDates = async () => {
    if (!mapping || !po) return;
    if (!datesForm.startDate || !datesForm.endDate) {
      toast({ title: "Both dates are required", variant: "destructive" });
      return;
    }
    if (datesForm.endDate < datesForm.startDate) {
      toast({ title: "End date cannot be before the start date", variant: "destructive" });
      return;
    }
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, "projects", mapping.globalProjectId, PO_COLLECTION, po.id), {
        startDate: datesForm.startDate,
        endDate: datesForm.endDate,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Dates updated" });
      setIsDatesDialogOpen(false);
      await loadPo();
    } catch (error) {
      console.error("Failed to update purchase order dates:", error);
      toast({ title: "Unable to update dates", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePrint = () => {
    if (!mapping) return;
    window.open(`/project-management/purchase-orders/${poId}/print?project=${encodeURIComponent(mapping.id)}`, "_blank");
  };

  const handleUploadApprovedDocument = async (file: File | null) => {
    if (!file || !mapping || !po) return;
    setIsUploadingDocument(true);
    try {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const path = `project-management/purchase-orders/${mapping.globalProjectId}/${po.id}/approved-${Date.now()}-${safeName}`;
      const target = storageRef(storage, path);
      await uploadBytes(target, file);
      const approvedDocumentUrl = await getDownloadURL(target);
      await updateDoc(doc(db, "projects", mapping.globalProjectId, PO_COLLECTION, po.id), {
        approvedDocumentUrl,
        approvedDocumentName: file.name,
        approvedDocumentPath: path,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Approved document uploaded" });
      await loadPo();
    } catch (error) {
      console.error("Failed to upload approved document:", error);
      toast({ title: "Unable to upload document", variant: "destructive" });
    } finally {
      setIsUploadingDocument(false);
    }
  };

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
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" /> Print for Approval
          </Button>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">PO Date</p><p className="font-semibold">{formatDate(po.poDate)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Start Date</p><p className="font-semibold">{formatDate(po.startDate)}</p></CardContent></Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">End Date</p>
              {canEditDates && (
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={openDatesDialog} aria-label="Edit dates">
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </div>
            <p className={`font-semibold ${isPoOverdue(po) ? "text-red-600" : ""}`}>
              {formatDate(po.endDate)}
              {isPoOverdue(po) && <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Overdue</span>}
            </p>
          </CardContent>
        </Card>
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
                  <TableHead>Budget Price</TableHead>
                  <TableHead>Total Budget Price</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Source RFQ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(po.items ?? []).map((item, index) => {
                  const budgetPrice = item.boqItemId ? budgetPriceByBoqItemId.get(item.boqItemId) ?? 0 : 0;
                  return (
                    <TableRow key={index}>
                      <TableCell className="max-w-md">{item.description}</TableCell>
                      <TableCell>{item.unit || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{typeof item.boqQty === "number" ? formatQuantity(item.boqQty) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{typeof item.indentQty === "number" ? formatQuantity(item.indentQty) : "—"}</TableCell>
                      <TableCell>{formatQuantity(item.qty)}</TableCell>
                      <TableCell>{formatCurrency(item.rate)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatCurrency(budgetPrice)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatCurrency(budgetPrice * item.qty)}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(item.amount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.sourceRfqNumber || "—"}</TableCell>
                    </TableRow>
                  );
                })}
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Approved Document</CardTitle>
          <CardDescription>
            Print this PO for approval, get it signed, then upload the signed copy here for the record.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 pt-0">
          {po.approvedDocumentUrl && (
            <a
              href={po.approvedDocumentUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              <Paperclip className="h-4 w-4" /> {po.approvedDocumentName || "View uploaded document"}
            </a>
          )}
          <Button variant="outline" size="sm" asChild disabled={isUploadingDocument}>
            <label className="cursor-pointer">
              {isUploadingDocument ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
              {po.approvedDocumentUrl ? "Replace Document" : "Upload Approved Document"}
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="sr-only"
                disabled={isUploadingDocument}
                onChange={(e) => void handleUploadApprovedDocument(e.target.files?.[0] ?? null)}
              />
            </label>
          </Button>
        </CardContent>
      </Card>

      <Dialog open={isDatesDialogOpen} onOpenChange={setIsDatesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delivery Window</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="po-start-date">Start Date</Label>
              <Input
                id="po-start-date"
                type="date"
                value={datesForm.startDate}
                onChange={(e) => setDatesForm((c) => ({ ...c, startDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-end-date">End Date</Label>
              <Input
                id="po-end-date"
                type="date"
                min={datesForm.startDate || undefined}
                value={datesForm.endDate}
                onChange={(e) => setDatesForm((c) => ({ ...c, endDate: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => void handleSaveDates()} disabled={isUpdating}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
