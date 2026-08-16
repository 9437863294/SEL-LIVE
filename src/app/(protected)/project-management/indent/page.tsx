"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FilePlus2,
  IndianRupee,
  ListChecks,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { collection, deleteDoc, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { logUserActivity } from "@/lib/activity-logger";
import { exportWorkbook } from "@/lib/report-excel";
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
import { useToast } from "@/hooks/use-toast";
import { useAuthorization } from "@/hooks/useAuthorization";

const PERMISSION_RESOURCE = "Project Management.Indent";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type BoqItem = {
  id: string;
  "BOQ SL No"?: string | number;
  "ERP SL NO"?: string | number;
  Description?: string;
  Unit?: string;
  QTY?: string | number;
  "Budget Price"?: string | number;
  "Scope 1"?: string;
  "Scope 2"?: string;
  "Start Date"?: string;
  "End Date"?: string;
  [key: string]: unknown;
};

type IndentStatus = "Draft" | "Submitted" | "Approved" | "Rejected" | "Cancelled";

type IndentLineItem = {
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  requestedQty: number;
  budgetPrice: number;
  lineTotal: number;
};

type IndentRecord = {
  id: string;
  indentNumber: string;
  indentDate: string;
  requiredDate?: string;
  remarks?: string;
  status: IndentStatus;
  items: IndentLineItem[];
  totalAmount: number;
  createdAt?: unknown;
  createdByName?: string;
};

const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

const getTimestampMillis = (value: unknown) => {
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: () => number }).toMillis;
    return typeof toMillis === "function" ? toMillis.call(value) : 0;
  }
  return 0;
};

// Older indent documents were stored as a single flat item rather than an `items` array.
function normalizeIndentDoc(
  id: string,
  data: Record<string, any>,
  boqItemsById: Map<string, BoqItem>,
): IndentRecord {
  if (Array.isArray(data.items)) {
    const items = data.items as IndentLineItem[];
    return {
      id,
      indentNumber: data.indentNumber,
      indentDate: data.indentDate,
      requiredDate: data.requiredDate,
      remarks: data.remarks,
      status: data.status,
      items,
      totalAmount:
        typeof data.totalAmount === "number"
          ? data.totalAmount
          : items.reduce((total, item) => total + toNumber(item.lineTotal), 0),
      createdAt: data.createdAt,
      createdByName: data.createdByName,
    };
  }

  const boqItem = boqItemsById.get(data.boqItemId);
  const requestedQty = toNumber(data.requestedQty);
  const budgetPrice = toNumber(boqItem?.["Budget Price"]);
  const lineTotal = Math.round(budgetPrice * requestedQty * 100) / 100;
  const legacyItem: IndentLineItem = {
    boqItemId: data.boqItemId,
    boqSlNo: data.boqSlNo,
    description: data.description,
    unit: data.unit,
    boqQty: toNumber(data.boqQty),
    requestedQty,
    budgetPrice,
    lineTotal,
  };

  return {
    id,
    indentNumber: data.indentNumber,
    indentDate: data.indentDate,
    requiredDate: data.requiredDate,
    remarks: data.remarks,
    status: data.status,
    items: [legacyItem],
    totalAmount: lineTotal,
    createdAt: data.createdAt,
    createdByName: data.createdByName,
  };
}

export default function ProjectIndentPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView =
    can("View", PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canAdd =
    can("Add", PERMISSION_RESOURCE) || can("Import", "Project Management.BOQ");
  const canDelete =
    can("Delete", PERMISSION_RESOURCE) || can("Import", "Project Management.BOQ");

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [indents, setIndents] = useState<IndentRecord[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(
        doc(db, "projectManagementProjects", mappingId),
      );
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = {
        id: mappingSnapshot.id,
        ...mappingSnapshot.data(),
      } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

      const [projectSnapshot, boqSnapshot, indentSnapshot] = await Promise.all([
        getDoc(doc(db, "projects", mappingData.globalProjectId)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
      ]);
      if (!projectSnapshot.exists()) throw new Error("Mapped global project not found");

      const nextBoqItems = boqSnapshot.docs
        .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }) as BoqItem)
        .sort((left, right) =>
          String(left["BOQ SL No"] ?? left["ERP SL NO"] ?? "").localeCompare(
            String(right["BOQ SL No"] ?? right["ERP SL NO"] ?? ""),
            undefined,
            { numeric: true },
          ),
        );
      const boqItemsById = new Map(nextBoqItems.map((item) => [item.id, item]));
      const nextIndents = indentSnapshot.docs
        .map((indentDoc) => normalizeIndentDoc(indentDoc.id, indentDoc.data(), boqItemsById))
        .sort((left, right) => getTimestampMillis(right.createdAt) - getTimestampMillis(left.createdAt));

      setMapping(mappingData);
      setBoqItems(nextBoqItems);
      setIndents(nextIndents);
    } catch (error) {
      console.error("Failed to load project indents:", error);
      toast({
        title: "Unable to load Indent module",
        description: error instanceof Error ? error.message : "Project indent data could not be loaded.",
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

  const totalRequestedQty = useMemo(
    () =>
      indents.reduce(
        (total, indent) => total + indent.items.reduce((sum, item) => sum + toNumber(item.requestedQty), 0),
        0,
      ),
    [indents],
  );
  const totalIndentValue = useMemo(
    () => indents.reduce((total, indent) => total + toNumber(indent.totalAmount), 0),
    [indents],
  );

  const exportIndents = async () => {
    await exportWorkbook(`indents-${mapping?.projectName || "project"}.xlsx`, [
      {
        name: "Indents",
        columns: [
          { header: "Indent No.", key: "indentNumber", width: 20 },
          { header: "Indent Date", key: "indentDate", width: 14 },
          { header: "Required Date", key: "requiredDate", width: 14 },
          { header: "Status", key: "status", width: 14 },
          { header: "Items", key: "itemCount", width: 10 },
          { header: "Total Amount", key: "totalAmount", width: 16 },
          { header: "Remarks", key: "remarks", width: 30 },
        ],
        rows: indents.map((indent) => ({
          indentNumber: indent.indentNumber,
          indentDate: formatDate(indent.indentDate),
          requiredDate: formatDate(indent.requiredDate),
          status: indent.status,
          itemCount: indent.items?.length ?? 0,
          totalAmount: toNumber(indent.totalAmount),
          remarks: indent.remarks || "",
        })),
      },
    ]);
  };

  const handleDelete = async (indent: IndentRecord) => {
    if (!mapping || indent.status !== "Draft") return;
    setDeletingId(indent.id);
    try {
      await deleteDoc(doc(db, "projects", mapping.globalProjectId, "indents", indent.id));
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: "Delete Draft Indent",
          details: { indentNumber: indent.indentNumber, project: mapping.projectName },
        });
      }
      toast({ title: "Draft indent deleted" });
      await loadData();
    } catch (error) {
      console.error("Failed to delete indent:", error);
      toast({ title: "Unable to delete indent", variant: "destructive" });
    } finally {
      setDeletingId("");
    }
  };

  const toggleExpanded = (indentId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      next.has(indentId) ? next.delete(indentId) : next.add(indentId);
      return next;
    });
  };

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-24" />)}
        </div>
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view Project Management indents.</CardDescription>
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
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>Return to Project Management and choose a project before opening Indent.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Project Management">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm">
            <ListChecks className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Indent</h1>
            <p className="text-sm text-muted-foreground">Create multi-item material indents against BOQ items for {mapping.projectName}.</p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            {indents.length > 0 && (
              <Button variant="outline" onClick={exportIndents}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            )}
            {canAdd && boqItems.length ? (
              <Button asChild>
                <Link href={`/project-management/indent/new?project=${encodeURIComponent(mappingId)}`}>
                  <Plus className="mr-2 h-4 w-4" /> New Indent
                </Link>
              </Button>
            ) : (
              <Button disabled>
                <Plus className="mr-2 h-4 w-4" /> New Indent
              </Button>
            )}
          </div>
          {!canAdd && (
            <p className="max-w-xs text-right text-xs text-destructive">
              You don&apos;t have permission to add indents. Ask an admin to grant &quot;Add&quot; under Project Management &rsaquo; Indent in Role Management.
            </p>
          )}
          {canAdd && !boqItems.length && (
            <p className="max-w-xs text-right text-xs text-muted-foreground">
              No BOQ items found for this project. Import the BOQ first.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="flex items-center gap-3 p-4"><ClipboardList className="h-8 w-8 text-blue-600" /><div><p className="text-2xl font-bold">{boqItems.length}</p><p className="text-xs text-muted-foreground">BOQ Items</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><ListChecks className="h-8 w-8 text-amber-600" /><div><p className="text-2xl font-bold">{indents.length}</p><p className="text-xs text-muted-foreground">Total Indents</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><FilePlus2 className="h-8 w-8 text-emerald-600" /><div><p className="text-2xl font-bold">{formatQuantity(totalRequestedQty)}</p><p className="text-xs text-muted-foreground">Total Requested Qty</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><IndianRupee className="h-8 w-8 text-violet-600" /><div><p className="text-2xl font-bold">{formatCurrency(totalIndentValue)}</p><p className="text-xs text-muted-foreground">Total Indent Value</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Indents</CardTitle>
          <CardDescription>Each indent can contain multiple BOQ items. Draft indents reserve quantity from their linked BOQ items.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Indent No.</TableHead>
                  <TableHead>Indent Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total Qty</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Required Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {indents.length ? indents.map((indent) => {
                  const isExpanded = expandedIds.has(indent.id);
                  const totalQty = indent.items.reduce((sum, item) => sum + toNumber(item.requestedQty), 0);

                  return (
                    <Fragment key={indent.id}>
                      <TableRow className="cursor-pointer" onClick={() => toggleExpanded(indent.id)}>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => toggleExpanded(indent.id)} aria-label={isExpanded ? "Collapse" : "Expand"}>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">{indent.indentNumber}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(indent.indentDate)}</TableCell>
                        <TableCell>{indent.items.length}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatQuantity(totalQty)}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{formatCurrency(indent.totalAmount)}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(indent.requiredDate)}</TableCell>
                        <TableCell><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">{indent.status}</span></TableCell>
                        <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                          {indent.status === "Draft" && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" disabled={!canDelete || deletingId === indent.id} aria-label={`Delete ${indent.indentNumber}`}>
                                  {deletingId === indent.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Delete draft indent?</AlertDialogTitle><AlertDialogDescription>This releases all reserved BOQ quantities in this indent. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void handleDelete(indent)}>Delete Draft</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={9} className="p-0">
                            <div className="p-3">
                              {indent.remarks && (
                                <p className="mb-2 px-1 text-sm text-muted-foreground">
                                  <span className="font-medium text-foreground">Remarks: </span>{indent.remarks}
                                </p>
                              )}
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>BOQ SL No</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Budget Price</TableHead>
                                    <TableHead>Line Total</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {indent.items.map((item, index) => (
                                    <TableRow key={`${indent.id}-${item.boqItemId}-${index}`}>
                                      <TableCell>{item.boqSlNo || "—"}</TableCell>
                                      <TableCell className="max-w-sm truncate" title={item.description}>{item.description || "—"}</TableCell>
                                      <TableCell className="whitespace-nowrap">{formatQuantity(item.requestedQty)} {item.unit}</TableCell>
                                      <TableCell className="whitespace-nowrap">{formatCurrency(item.budgetPrice)}</TableCell>
                                      <TableCell className="whitespace-nowrap font-medium">{formatCurrency(item.lineTotal)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                }) : (
                  <TableRow>
                    <TableCell colSpan={9} className="h-36 text-center">
                      <ListChecks className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">No indents created</p>
                      <p className="text-sm text-muted-foreground">Create the first indent against one or more BOQ items.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {!boqItems.length && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <CalendarDays className="h-9 w-9 text-muted-foreground" />
            <div><p className="font-medium">No BOQ items available</p><p className="text-sm text-muted-foreground">Import or configure the project BOQ before creating an indent.</p></div>
            <Button variant="outline" asChild><Link href={`/project-management/boq?project=${encodeURIComponent(mappingId)}`}>Open BOQ</Link></Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
