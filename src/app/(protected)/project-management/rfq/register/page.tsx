"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FileSearch,
  Loader2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { Fragment } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  RFQ_COLLECTION,
  RFQ_PERMISSION_RESOURCE,
  formatDate,
  rfqStatusStyles,
  type Rfq,
} from "@/lib/rfq";
import { isLegacyRfq, type RfqLike } from "@/lib/project-management-rfq-workflow";
import { useProjectManagementRfqContext } from "@/components/rfq/use-rfq-host-context";
import { RfqNav } from "@/components/rfq/rfq-nav";
import {
  RFQ_GRADIENT,
  RfqAccessDenied,
  RfqLoadingState,
  RfqPageHeader,
  RfqPageShell,
  RfqProjectNotFound,
} from "@/components/rfq/rfq-page-shell";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

export default function RfqRegisterPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound } = useProjectManagementRfqContext(mappingId);

  const canView = can("View", RFQ_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canAdd = can("Add", RFQ_PERMISSION_RESOURCE);
  const canDelete = can("Delete", RFQ_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
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
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

      const rfqSnapshot = await getDocs(collection(db, "projects", mappingData.globalProjectId, RFQ_COLLECTION));
      const rows = rfqSnapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Rfq)
        .sort((a, b) => (b.rfqDate || "").localeCompare(a.rfqDate || ""));

      setMapping(mappingData);
      setRfqs(rows);
    } catch (error) {
      console.error("Failed to load RFQs:", error);
      toast({
        title: "Unable to load RFQs",
        description: error instanceof Error ? error.message : "Project RFQ data could not be loaded.",
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

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const totalOpen = useMemo(
    () => rfqs.filter((rfq) => !["Closed", "Cancelled"].includes(rfq.status)).length,
    [rfqs],
  );

  // Draft-only, matching Indent/PO's own delete lifecycle — a Draft RFQ has never been sent, so
  // none of its items can have been quoted or awarded yet, and nothing else references it back.
  const exportRfqs = async () => {
    await exportWorkbook(`rfqs-${mapping?.projectName || "project"}.xlsx`, [
      {
        name: "RFQs",
        columns: [
          { header: "RFQ No.", key: "rfqNumber", width: 20 },
          { header: "RFQ Date", key: "rfqDate", width: 14 },
          { header: "Due Date", key: "dueDate", width: 14 },
          { header: "Status", key: "status", width: 16 },
          { header: "Items", key: "itemCount", width: 10 },
          { header: "Vendors Invited", key: "vendorCount", width: 16 },
          { header: "Remarks", key: "remarks", width: 30 },
        ],
        rows: rfqs.map((rfq) => ({
          rfqNumber: rfq.rfqNumber,
          rfqDate: formatDate(rfq.rfqDate),
          dueDate: formatDate(rfq.dueDate),
          status: rfq.status,
          itemCount: rfq.items?.length ?? 0,
          vendorCount: rfq.vendorIds?.length ?? 0,
          remarks: rfq.remarks || "",
        })),
      },
    ]);
  };

  const handleDelete = async (rfq: Rfq) => {
    if (!mapping || rfq.status !== "Draft") return;
    setDeletingId(rfq.id);
    try {
      await deleteDoc(doc(db, "projects", mapping.globalProjectId, RFQ_COLLECTION, rfq.id));
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: "Delete Draft RFQ",
          details: { rfqNumber: rfq.rfqNumber, project: mapping.projectName },
        });
      }
      toast({ title: "Draft RFQ deleted" });
      await loadData();
    } catch (error) {
      console.error("Failed to delete RFQ:", error);
      toast({ title: "Unable to delete RFQ", variant: "destructive" });
    } finally {
      setDeletingId("");
    }
  };

  if (isAuthLoading || isResolving || isLoading) {
    return <RfqLoadingState />;
  }

  if (!canView) {
    return <RfqAccessDenied description="You do not have permission to view RFQs." />;
  }

  if (notFound || !mappingId || !mapping) {
    return (
      <RfqProjectNotFound
        description="Return to Project Management and choose a project before opening RFQs."
        href="/project-management"
      />
    );
  }

  return (
    <RfqPageShell>
      <RfqPageHeader
        title="RFQ Register"
        subtitle={`Request quotations from vendors for ${mapping.projectName}.`}
        icon={FileSearch}
        backHref={context.rfqHref()}
        backLabel="Back to RFQ"
        gradient={RFQ_GRADIENT}
        actions={
          <>
            {rfqs.length > 0 && (
              <Button variant="outline" onClick={exportRfqs}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            )}
            {canAdd && (
              <Button asChild>
                <Link href={context.rfqHref("new")}>
                  <Plus className="mr-2 h-4 w-4" /> New RFQ
                </Link>
              </Button>
            )}
          </>
        }
      />

      <RfqNav context={context} active="register" />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-4"><FileSearch className="h-8 w-8 text-violet-600" /><div><p className="text-2xl font-bold">{rfqs.length}</p><p className="text-xs text-muted-foreground">Total RFQs</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><ClipboardList className="h-8 w-8 text-blue-600" /><div><p className="text-2xl font-bold">{totalOpen}</p><p className="text-xs text-muted-foreground">Open RFQs</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><Users className="h-8 w-8 text-emerald-600" /><div><p className="text-2xl font-bold">{rfqs.reduce((sum, rfq) => sum + (rfq.vendorIds?.length ?? 0), 0)}</p><p className="text-xs text-muted-foreground">Vendor Invitations Sent</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>RFQs</CardTitle>
          <CardDescription>Each RFQ can bundle items from multiple indents and go out to multiple vendors.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>RFQ No.</TableHead>
                  <TableHead>RFQ Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Vendors</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfqs.length ? rfqs.map((rfq) => {
                  const isExpanded = expandedIds.has(rfq.id);
                  return (
                    <Fragment key={rfq.id}>
                      <TableRow className="cursor-pointer" onClick={() => toggleExpanded(rfq.id)}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => toggleExpanded(rfq.id)} aria-label={isExpanded ? "Collapse" : "Expand"}>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">{rfq.rfqNumber}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(rfq.rfqDate)}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(rfq.dueDate)}</TableCell>
                        <TableCell>{rfq.items?.length ?? 0}</TableCell>
                        <TableCell>{rfq.vendorIds?.length ?? 0}</TableCell>
                        <TableCell>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${rfqStatusStyles[rfq.status]}`}>{rfq.status}</span>
                          {isLegacyRfq(rfq as RfqLike) && (
                            <p
                              className="mt-1 text-xs text-muted-foreground"
                              title="Raised before award approval existed — awards on this RFQ create a purchase order directly."
                            >
                              Legacy
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/project-management/rfq/${rfq.id}?project=${encodeURIComponent(mappingId)}`} className="text-sm font-medium text-primary hover:underline">
                              Open
                            </Link>
                            {canDelete && rfq.status === "Draft" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" disabled={deletingId === rfq.id} aria-label={`Delete ${rfq.rfqNumber}`}>
                                    {deletingId === rfq.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete draft RFQ?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This permanently deletes {rfq.rfqNumber} and its vendor quotes. This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => void handleDelete(rfq)}>Delete Draft</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={8} className="p-0">
                            <div className="p-3">
                              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Vendors invited</p>
                              <div className="mb-3 flex flex-wrap gap-1.5 px-1">
                                {(rfq.vendorNames ?? []).map((name) => (
                                  <span key={name} className="rounded-full border bg-background px-2.5 py-1 text-xs">{name}</span>
                                ))}
                              </div>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>BOQ SL No</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Source Indent</TableHead>
                                    <TableHead>Awarded To</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {(rfq.items ?? []).map((item) => (
                                    <TableRow key={item.rfqItemId}>
                                      <TableCell>{item.boqSlNo || "—"}</TableCell>
                                      <TableCell className="max-w-sm truncate" title={item.description}>{item.description}</TableCell>
                                      <TableCell>{item.qty} {item.unit}</TableCell>
                                      <TableCell>{item.sourceIndentNumber}</TableCell>
                                      <TableCell>{item.awardedVendorName || "—"}</TableCell>
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
                    <TableCell colSpan={8} className="h-36 text-center">
                      <FileSearch className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">No RFQs created</p>
                      <p className="text-sm text-muted-foreground">Create an RFQ from one or more indents to invite vendor quotes.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </RfqPageShell>
  );
}
