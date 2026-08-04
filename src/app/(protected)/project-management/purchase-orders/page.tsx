"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  ShieldAlert,
  ShoppingCart,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
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
import {
  PO_COLLECTION,
  PO_PERMISSION_RESOURCE,
  PO_STATUSES,
  formatCurrency,
  poStatusStyles,
  type POStatus,
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

export default function ProjectPurchaseOrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", PO_PERMISSION_RESOURCE) || can("View", "Project Management.RFQ");
  const canAdd = can("Add", PO_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | POStatus>("all");

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

      const poSnapshot = await getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION));
      const rows = poSnapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as PurchaseOrder)
        .sort((a, b) => (b.poDate || "").localeCompare(a.poDate || ""));

      setMapping(mappingData);
      setPurchaseOrders(rows);
    } catch (error) {
      console.error("Failed to load purchase orders:", error);
      toast({
        title: "Unable to load purchase orders",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, toast]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const filteredOrders = useMemo(
    () => (statusFilter === "all" ? purchaseOrders : purchaseOrders.filter((po) => po.status === statusFilter)),
    [purchaseOrders, statusFilter],
  );

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80 w-full" />
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

  if (!mappingId || !mapping) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>Return to Project Management and choose a project before opening purchase orders.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
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
            <Link href={`/project-management?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Project Management">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
            <ShoppingCart className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Purchase Orders</h1>
            <p className="mt-1 text-sm text-muted-foreground">Purchase orders raised against vendors for {mapping.projectName}.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(value: "all" | POStatus) => setStatusFilter(value)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {PO_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>{status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canAdd && (
            <Button asChild>
              <Link href={`/project-management/purchase-orders/new?project=${encodeURIComponent(mappingId)}`}>
                <Plus className="mr-2 h-4 w-4" /> New Purchase Order
              </Link>
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-600" />
        <CardHeader>
          <CardTitle className="text-lg">All Purchase Orders</CardTitle>
          <CardDescription>{filteredOrders.length} order{filteredOrders.length === 1 ? "" : "s"} shown.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>PO Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Source RFQ</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.length ? filteredOrders.map((po) => (
                  <TableRow
                    key={po.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/project-management/purchase-orders/${po.id}?project=${encodeURIComponent(mappingId)}`)}
                  >
                    <TableCell className="font-medium">{po.poNumber}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(po.poDate)}</TableCell>
                    <TableCell>{po.vendorName}</TableCell>
                    <TableCell>{po.sourceRfqNumbers?.length ? po.sourceRfqNumbers.join(", ") : "—"}</TableCell>
                    <TableCell>{po.items?.length ?? 0}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{formatCurrency(po.totalAmount)}</TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${poStatusStyles[po.status]}`}>
                        {po.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <p className="font-medium">No purchase orders found</p>
                      <p className="mt-1 text-sm text-muted-foreground">Create one directly, or award RFQ items to a vendor.</p>
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
