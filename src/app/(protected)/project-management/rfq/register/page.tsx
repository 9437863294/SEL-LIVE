"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FileSearch,
  Loader2,
  Plus,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  RFQ_COLLECTION,
  RFQ_PERMISSION_RESOURCE,
  RFQ_STATUSES,
  formatDate,
  type Rfq,
  type RfqItem,
} from "@/lib/rfq";
import { isLegacyRfq, type RfqLike } from "@/lib/project-management-rfq-workflow";
import { useProjectManagementRfqContext } from "@/components/rfq/use-rfq-host-context";
import {
  RFQ_GRADIENT,
  RfqAccessDenied,
  RfqLoadingState,
  RfqProjectNotFound,
} from "@/components/rfq/rfq-page-shell";
import {
  PmContent,
  PmDataList,
  PmEmptyState,
  PmSectionHead,
  PmShell,
  PmSidebar,
  PmTableFoot,
  pmAccent,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { pmStatusTone } from "@/components/project-management/pm-status-tones";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

export default function RfqRegisterPage() {
  const router = useRouter();
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

  /**
   * Status is this register's navigation, the same as Indent's — the screen had no filtering, so
   * "which RFQs are still out with vendors" meant reading the Status column down the page.
   * Kept in `?view=` so a refresh or a shared link keeps the filter.
   */
  const activeTab = searchParams?.get("view") || "all";
  const setActiveTab = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "all") params.delete("view");
    else params.set("view", value);
    // Path from the same helper every other link here uses, so it cannot drift from the route.
    const path = context.rfqHref("register").split("?")[0];
    const query = params.toString();
    router.replace(query ? `${path}?${query}` : path);
  };

  const countsByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rfq of rfqs) counts.set(rfq.status, (counts.get(rfq.status) ?? 0) + 1);
    return counts;
  }, [rfqs]);

  const filteredRfqs = useMemo(
    () => (activeTab === "all" ? rfqs : rfqs.filter((rfq) => rfq.status === activeTab)),
    [rfqs, activeTab],
  );

  const vendorInvitations = useMemo(
    () => filteredRfqs.reduce((sum, rfq) => sum + (rfq.vendorIds?.length ?? 0), 0),
    [filteredRfqs],
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

  const itemColumns: PmListColumn<RfqItem & { id: string }>[] = [
    { header: "BOQ SL No", cell: (item) => item.boqSlNo || "—" },
    {
      header: "Description",
      className: "max-w-sm truncate",
      mobile: "title",
      cell: (item) => <span title={item.description}>{item.description}</span>,
    },
    { header: "Qty", cell: (item) => <>{item.qty} {item.unit}</> },
    { header: "Source Indent", cell: (item) => item.sourceIndentNumber },
    { header: "Awarded To", cell: (item) => item.awardedVendorName || "—" },
  ];

  const columns: PmListColumn<Rfq>[] = [
    {
      header: "",
      className: "w-10",
      // Phones toggle from a button in the card's footer instead — a card with actions is not
      // itself a tap target.
      mobile: "omit",
      cell: (rfq) => {
        const isExpanded = expandedIds.has(rfq.id);
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(rfq.id);
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        );
      },
    },
    { header: "RFQ No.", mobile: "title", cell: (rfq) => <span className="font-medium">{rfq.rfqNumber}</span> },
    { header: "RFQ Date", className: "whitespace-nowrap", cell: (rfq) => formatDate(rfq.rfqDate) },
    { header: "Due Date", className: "whitespace-nowrap", cell: (rfq) => formatDate(rfq.dueDate) },
    { header: "Items", cell: (rfq) => rfq.items?.length ?? 0 },
    { header: "Vendors", cell: (rfq) => rfq.vendorIds?.length ?? 0 },
    {
      header: "Status",
      mobile: "aside",
      cell: (rfq) => (
        <>
          <StatusBadge status={rfq.status} tone={pmStatusTone(rfq.status)} />
          {isLegacyRfq(rfq as RfqLike) && (
            <p
              className="mt-1 text-xs text-muted-foreground"
              title="Raised before award approval existed — awards on this RFQ create a purchase order directly."
            >
              Legacy
            </p>
          )}
        </>
      ),
    },
    {
      header: "Open",
      align: "right",
      mobile: "footer",
      cell: (rfq) => {
        const isExpanded = expandedIds.has(rfq.id);
        return (
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" className="sm:hidden" onClick={() => toggleExpanded(rfq.id)}>
              {isExpanded ? "Hide items" : "Show items"}
            </Button>
            {/* A bordered, thumb-sized button on a phone; the register's plain text link from `sm`. */}
            <Link
              href={`/project-management/rfq/${rfq.id}?project=${encodeURIComponent(mappingId)}`}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-primary hover:underline sm:min-h-0 sm:flex-none sm:border-0 sm:bg-transparent sm:px-0"
            >
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
        );
      },
    },
  ];

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title="RFQ Register"
          subtitle={mapping.projectName}
          icon={FileSearch}
          gradient={RFQ_GRADIENT}
          activeValue={activeTab}
          onChange={setActiveTab}
          groups={[
            {
              label: "Status",
              views: [
                { value: "all", label: "All RFQs", icon: FileSearch, color: "text-slate-600", bg: "bg-slate-100", count: rfqs.length },
                ...RFQ_STATUSES.map((status, index) => {
                  const accent = pmAccent(index);
                  return {
                    value: status,
                    label: status,
                    icon: FileSearch,
                    color: accent.color,
                    bg: accent.bg,
                    count: countsByStatus.get(status) ?? 0,
                  };
                }),
              ],
            },
          ]}
          // Neither is reachable from the topbar: the back button goes to the RFQ hub and the
          // primary action goes to the new-RFQ form.
          footerLinks={[
            {
              href: context.rfqHref("settings/workflow-configuration"),
              label: "Workflow configuration",
              icon: Settings,
              color: "text-slate-600",
              bg: "bg-slate-100",
            },
          ]}
        />
      }
    >
      <PageHeader sticky
        title="RFQ Register"
        breadcrumbs={[
          { label: mapping.projectName, href: `/project-management?project=${encodeURIComponent(mappingId)}` },
          { label: "RFQ", href: context.rfqHref() },
        ]}
        backHref={context.rfqHref()}
        backLabel="Back to RFQ"
        actions={
          <>
            {rfqs.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportRfqs} aria-label="Export">
                <Download className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            )}
            {canAdd && (
              <Button size="sm" asChild>
                <Link href={context.rfqHref("new")}>
                  <Plus className="mr-2 h-4 w-4" /> New RFQ
                </Link>
              </Button>
            )}
          </>
        }
      />

      <PmContent>
        {/* Three stat cards replaced by one line beside the heading. */}
        <PmSectionHead
          title={activeTab === "all" ? "RFQs" : `${activeTab} RFQs`}
          stats={[
            { label: filteredRfqs.length === 1 ? "RFQ" : "RFQs", value: String(filteredRfqs.length) },
            { label: "open", value: String(totalOpen) },
            { label: "vendor invitations sent", value: String(vendorInvitations) },
          ]}
        />
        {/* The card title said "RFQs" under a heading already saying it; the part worth keeping is
            what an RFQ actually bundles, which the table does not show. */}
        <p className="mb-3 max-w-4xl text-[13px] text-muted-foreground">
          Each RFQ can bundle items from multiple indents and go out to multiple vendors.
        </p>

        <PmDataList
          rows={filteredRfqs}
          columns={columns}
          onRowClick={(rfq) => toggleExpanded(rfq.id)}
          expandedIds={expandedIds}
          renderExpanded={(rfq) => (
            <div className="sm:p-3">
              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Vendors invited</p>
              <div className="mb-3 flex flex-wrap gap-1.5 px-1">
                {(rfq.vendorNames ?? []).map((name) => (
                  <Badge key={name} variant="outline" className="max-w-full">
                    <span className="truncate">{name}</span>
                  </Badge>
                ))}
              </div>
              <PmDataList
                rows={(rfq.items ?? []).map((item) => ({ ...item, id: item.rfqItemId }))}
                columns={itemColumns}
              />
            </div>
          )}
          empty={
            <PmEmptyState
              icon={FileSearch}
              title="No RFQs created"
              description="Create an RFQ from one or more indents to invite vendor quotes."
            />
          }
          foot={
            <PmTableFoot
              left={<>Showing <b className="font-semibold tabular-nums text-foreground">{filteredRfqs.length}</b> of <b className="font-semibold tabular-nums text-foreground">{rfqs.length}</b> RFQs</>}
              right={<>Open <b className="font-semibold tabular-nums text-foreground">{totalOpen}</b></>}
            />
          }
        />
      </PmContent>
    </PmShell>
  );
}
