"use client";

/**
 * A single RFQ award-approval stage — the award requests sitting on it and the actions the step
 * allows.
 *
 * Approving the last configured step is what creates the purchase order; every earlier approval
 * just advances the request. The PO build itself is shared with the direct award path (see
 * project-management-rfq-awards.ts) so an approved award produces exactly the same PO.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Clock, GitMerge, Loader2, Settings, TrendingUp } from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { actOnRfqAward } from "@/lib/project-management-rfq-award-entries";
import { formatCurrency, formatQuantity, formatDate } from "@/lib/rfq";
import {
  DEFAULT_RFQ_AWARD_STEPS,
  RFQ_AWARD_ACTIONS,
  RFQ_AWARD_APPROVAL_COLLECTION,
  RFQ_AWARD_WORKFLOW_DOC_ID,
  awardPremium,
  canActOnRfqAward,
  rfqAwardStatusStyles,
  rfqAwardsForStep,
  type RfqAwardAction,
  type RfqAwardApproval,
  type RfqAwardApprovalItem,
} from "@/lib/project-management-rfq-workflow";
import { useProjectManagementRfqContext } from "@/components/rfq/use-rfq-host-context";
import {
  RFQ_GRADIENT,
  RfqAccessDenied,
  RfqLoadingState,
  RfqProjectNotFound,
} from "@/components/rfq/rfq-page-shell";
import {
  PM_DIALOG,
  PmContent,
  PmDataList,
  PmEmptyState,
  PmSectionHead,
  PmShell,
  PmSidebar,
  PmTopbar,
  pmAccent,
  type PmListColumn,
  type PmSidebarLink,
} from "@/components/project-management/pm-shell";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const toDateSafe = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
};

export default function RfqAwardStagePage() {
  const params = useParams();
  const stageId = String(params?.stageId ?? "");
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName, globalProjectName } =
    useProjectManagementRfqContext(mappingId);

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [approvals, setApprovals] = useState<RfqAwardApproval[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [pending, setPending] = useState<{ approval: RfqAwardApproval; action: RfqAwardAction } | null>(
    null,
  );
  const [comment, setComment] = useState("");

  const canViewModule = useMemo(() => {
    if (isAuthLoading) return false;
    try {
      return can("View", context.permissionResource);
    } catch {
      return false;
    }
  }, [isAuthLoading, can, context.permissionResource]);

  const globalProjectId = context.globalProjectId;

  const loadData = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [workflowSnapshot, approvalSnapshot] = await Promise.all([
        getDoc(doc(db, "workflows", RFQ_AWARD_WORKFLOW_DOC_ID)),
        getDocs(collection(db, "projects", globalProjectId, RFQ_AWARD_APPROVAL_COLLECTION)),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_RFQ_AWARD_STEPS;
      setSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );

      setApprovals(
        approvalSnapshot.docs.map(
          (approvalDoc) => ({ id: approvalDoc.id, ...approvalDoc.data() } as RfqAwardApproval),
        ),
      );
    } catch (error) {
      console.error("Failed to load RFQ award stage:", error);
      toast({ title: "Unable to load this stage", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, toast]);

  useEffect(() => {
    if (isAuthLoading || isResolving || !canViewModule) {
      if (!isAuthLoading && !isResolving) setIsLoading(false);
      return;
    }
    void loadData();
  }, [canViewModule, isAuthLoading, isResolving, loadData]);

  const step = useMemo(
    () => steps.find((candidate) => String(candidate.id) === stageId) ?? null,
    [steps, stageId],
  );

  /**
   * The stages are this screen's navigation: an approver wants to see what is waiting at each
   * step and move between them. Built for both branches, so a deleted stage still leaves a way out.
   */
  const stageSidebar = useMemo(() => {
    const links: PmSidebarLink[] = steps.map((candidate, index) => {
      const accent = pmAccent(index);
      return {
        href: context.rfqHref(`stage/${candidate.id}`),
        label: candidate.name,
        icon: GitMerge,
        color: accent.color,
        bg: accent.bg,
        count: rfqAwardsForStep(approvals, String(candidate.id), steps).length,
        active: String(candidate.id) === stageId,
      };
    });
    return (
      <PmSidebar
        title="Award approval"
        subtitle={projectName || undefined}
        icon={GitMerge}
        gradient={RFQ_GRADIENT}
        groups={[{ label: "Stages", links }]}
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
    );
  }, [steps, approvals, stageId, context, projectName]);

  const rfqBreadcrumbs = useMemo(
    () => [
      ...(projectName
        ? [{ label: projectName, href: `/project-management?project=${encodeURIComponent(mappingId)}` }]
        : []),
      { label: "RFQ", href: context.rfqHref() },
    ],
    [projectName, mappingId, context],
  );

  const stageApprovals = useMemo(
    () => rfqAwardsForStep(approvals, stageId, steps),
    [approvals, stageId, steps],
  );

  const allowedActions = useMemo<RfqAwardAction[]>(() => {
    if (!step) return [];
    const configured = (step.actions ?? []).map((action) =>
      typeof action === "string" ? action : action.name,
    );
    return RFQ_AWARD_ACTIONS.filter((action) => configured.includes(action));
  }, [step]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAct = async () => {
    if (!pending || !user || !globalProjectId) return;
    setIsActing(true);
    try {
      const result = await actOnRfqAward({
        globalProjectId,
        projectMappingId: mappingId,
        projectManagementProjectName: projectName,
        globalProjectName,
        approvalId: pending.approval.id,
        action: pending.action,
        comment: comment.trim(),
        steps,
        actor: { id: user.id, name: user.name },
        resolveAssignees: (nextStep) =>
          getAssigneeForStep(nextStep, {
            projectId: globalProjectId,
            departmentId: "",
            amount: pending.approval.totalAmount,
          }),
        resolveDeadline: async (nextStep) => {
          try {
            return await calculateDeadline(new Date(), nextStep.tat);
          } catch {
            return null;
          }
        },
      });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: context.activityModule,
        action: `RFQ Award ${pending.action}`,
        details: {
          project: projectName,
          rfqNumber: pending.approval.rfqNumber,
          vendor: pending.approval.vendorName,
          stage: step?.name ?? "",
          totalAmount: pending.approval.totalAmount,
        },
      });

      toast({
        title: `Award ${result.status.toLowerCase()}`,
        description: result.poCount
          ? `${result.poCount} purchase order${result.poCount === 1 ? "" : "s"} created.`
          : undefined,
      });
      setPending(null);
      setComment("");
      await loadData();
    } catch (error) {
      console.error("Failed to action RFQ award:", error);
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsActing(false);
    }
  };

  if (isAuthLoading || isResolving || (isLoading && canViewModule)) {
    return <RfqLoadingState />;
  }

  if (!canViewModule) {
    return <RfqAccessDenied description="You do not have permission to access the RFQ module." />;
  }

  if (notFound) {
    return (
      <RfqProjectNotFound
        description="Return to Project Management and choose a project before opening RFQs."
        href="/project-management"
      />
    );
  }

  if (!step) {
    return (
      <PmShell sidebar={stageSidebar}>
        <PmTopbar
          title="Stage not found"
          breadcrumbs={rfqBreadcrumbs}
          backHref={context.rfqHref()}
          backLabel="Back to RFQ"
        />
        <PmContent>
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Stage removed</CardTitle>
              <CardDescription>
                It may have been deleted in Workflow Configuration. Pick a stage from the sidebar,
                or open the RFQ hub to see the current ones.
              </CardDescription>
            </CardHeader>
          </Card>
        </PmContent>
      </PmShell>
    );
  }

  const isFinalStep = steps[steps.length - 1]?.id === step.id;

  // Numeric columns right-align through `className` rather than `align`, which would also
  // right-align them in the phone card's two-column grid.
  const itemColumns: PmListColumn<RfqAwardApprovalItem & { id: string }>[] = [
    { header: "BOQ SL No", cell: (item) => item.boqSlNo || "—" },
    {
      header: "Description",
      className: "max-w-sm truncate",
      mobile: "title",
      cell: (item) => <span title={item.description}>{item.description || "—"}</span>,
    },
    { header: "Indent", className: "text-xs", cell: (item) => item.sourceIndentNumber || "—" },
    {
      header: "Qty",
      className: "whitespace-nowrap text-right",
      cell: (item) => <>{formatQuantity(item.qty)} {item.unit}</>,
    },
    { header: "Rate", className: "whitespace-nowrap text-right", cell: (item) => formatCurrency(item.rate) },
    {
      header: "Amount",
      className: "whitespace-nowrap text-right",
      cell: (item) => <span className="font-medium">{formatCurrency(item.amount)}</span>,
    },
  ];

  const columns: PmListColumn<RfqAwardApproval>[] = [
    {
      header: "",
      className: "w-10",
      // Phones toggle from a button in the card's footer — a card with actions is not a tap target.
      mobile: "omit",
      cell: (approval) => {
        const isExpanded = expandedIds.has(approval.id);
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded(approval.id);
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        );
      },
    },
    { header: "RFQ No.", mobile: "title", cell: (approval) => <span className="font-medium">{approval.rfqNumber}</span> },
    { header: "Recommended Vendor", mobile: "title", cell: (approval) => approval.vendorName },
    { header: "Items", cell: (approval) => approval.items.length },
    {
      header: "Award Value",
      align: "right",
      className: "whitespace-nowrap",
      cell: (approval) => <span className="font-medium">{formatCurrency(approval.totalAmount)}</span>,
    },
    {
      header: "vs Lowest",
      className: "text-xs",
      cell: (approval) => {
        const premium = awardPremium(approval.totalAmount, approval.lowestLandedCost);
        return approval.lowestLandedCost == null ? (
          <span className="text-muted-foreground">—</span>
        ) : premium.isLowest ? (
          <span className="font-medium text-emerald-700">Lowest</span>
        ) : (
          <span
            className="flex items-center gap-1 font-medium text-amber-700"
            title={`Lowest comparable quote: ${formatCurrency(approval.lowestLandedCost)}`}
          >
            <TrendingUp className="h-3 w-3 shrink-0" />+{formatCurrency(premium.premium)} (
            {premium.premiumPct.toFixed(1)}%)
          </span>
        );
      },
    },
    { header: "Requested By", className: "text-sm", cell: (approval) => approval.requestedByName || "—" },
    {
      header: "Status",
      mobile: "aside",
      cell: (approval) => (
        <Badge variant="outline" className={rfqAwardStatusStyles[approval.status]}>
          {approval.status}
        </Badge>
      ),
    },
    {
      header: "Due",
      className: "text-xs text-muted-foreground",
      cell: (approval) => {
        const due = toDateSafe(approval.deadline);
        return due ? (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" />
            {due.toLocaleDateString()}
          </span>
        ) : (
          "—"
        );
      },
    },
    {
      header: "Actions",
      align: "right",
      mobile: "footer",
      cell: (approval) => {
        const isExpanded = expandedIds.has(approval.id);
        const mayAct = user ? canActOnRfqAward(approval, user.id) : false;
        return (
          <div
            className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            <Button variant="outline" size="sm" className="sm:hidden" onClick={() => toggleExpanded(approval.id)}>
              {isExpanded ? "Hide items" : "Show items"}
            </Button>
            {mayAct ? (
              allowedActions.map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant={action === "Approve" ? "default" : "outline"}
                  onClick={() => {
                    setPending({ approval, action });
                    setComment("");
                  }}
                >
                  {action}
                </Button>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">Not assigned to you</span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <PmShell sidebar={stageSidebar}>
      <PmTopbar
        title={step.name}
        breadcrumbs={rfqBreadcrumbs}
        backHref={context.rfqHref()}
        backLabel="Back to RFQ"
      />

      <PmContent>
        <PmSectionHead
          title={step.name}
          stats={[
            {
              label: stageApprovals.length === 1 ? "award awaiting" : "awards awaiting",
              value: String(stageApprovals.length),
            },
          ]}
        />
        {/* Prose, not a figure. Approving the last stage is what raises the purchase order. */}
        {(step.description || isFinalStep) && (
          <p className="mb-3 max-w-3xl text-[13px] text-muted-foreground">
            {step.description}
            {step.description && isFinalStep && " "}
            {isFinalStep && (
              <span className="font-medium text-amber-700">
                This is the final stage — approving here raises the purchase order.
              </span>
            )}
          </p>
        )}

        <PmDataList
          rows={stageApprovals}
          columns={columns}
          onRowClick={(approval) => toggleExpanded(approval.id)}
          expandedIds={expandedIds}
          renderExpanded={(approval) => (
            <div className="sm:p-3">
              <p className="mb-2 px-1 text-xs text-muted-foreground">
                RFQ dated {formatDate(approval.rfqDate)}
              </p>
              <PmDataList
                rows={approval.items.map((item) => ({ ...item, id: item.rfqItemId }))}
                columns={itemColumns}
              />
              {approval.actionLogs?.length ? (
                <ul className="mt-3 space-y-1 px-1">
                  {approval.actionLogs.map((log, index) => (
                    <li key={index} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{log.action}</span>
                      {log.stepName ? ` at ${log.stepName}` : ""} — {log.userName}
                      {log.comment ? `: ${log.comment}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          empty={
            <PmEmptyState
              icon={GitMerge}
              title="Nothing waiting at this stage"
              description="Awards confirmed on an RFQ will appear here for approval."
            />
          }
        />
      </PmContent>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className={PM_DIALOG.content}>
          <DialogHeader className={PM_DIALOG.header}>
            <DialogTitle>{pending?.action} award</DialogTitle>
            <DialogDescription>
              {pending ? `${pending.approval.rfqNumber} — ${pending.approval.vendorName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className={cn(PM_DIALOG.body, "py-2")}>
            <p className="text-sm">
              Award value:{" "}
              <span className="font-medium">
                {pending ? formatCurrency(pending.approval.totalAmount) : ""}
              </span>{" "}
              across {pending?.approval.items.length} item(s).
            </p>
            {pending && pending.approval.lowestLandedCost != null && (
              <p className="text-xs text-muted-foreground">
                Lowest comparable quote: {formatCurrency(pending.approval.lowestLandedCost)}
                {awardPremium(pending.approval.totalAmount, pending.approval.lowestLandedCost).isLowest
                  ? " — this is the lowest."
                  : " — this award is above the lowest quote."}
              </p>
            )}
            {pending?.action === "Approve" && isFinalStep && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                This is the final step — approving creates the purchase order for this vendor.
              </p>
            )}
            {pending?.action === "Needs Correction" && (
              <p className="rounded-md bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800">
                This sends the recommendation back to the buyer to rework.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="rfq-award-comment">Comment</Label>
              <Textarea
                id="rfq-award-comment"
                placeholder="Optional notes for the audit trail..."
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter className={PM_DIALOG.footer}>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleAct} disabled={isActing}>
              {isActing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm {pending?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PmShell>
  );
}
