"use client";

/**
 * A single RFQ award-approval stage — the award requests sitting on it and the actions the step
 * allows.
 *
 * Approving the last configured step is what creates the purchase order; every earlier approval
 * just advances the request. The PO build itself is shared with the direct award path (see
 * project-management-rfq-awards.ts) so an approved award produces exactly the same PO.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Clock, GitMerge, Loader2, TrendingUp } from "lucide-react";
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
} from "@/lib/project-management-rfq-workflow";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <RfqPageShell>
        <RfqPageHeader
          title="Stage not found"
          subtitle="This stage is no longer part of the award approval workflow."
          icon={GitMerge}
          backHref={context.rfqHref()}
          backLabel="Back to RFQ"
          gradient={RFQ_GRADIENT}
        />
        <RfqNav context={context} active="hub" />
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Stage removed</CardTitle>
            <CardDescription>
              It may have been deleted in Workflow Configuration. Open the RFQ hub to see the
              current stages.
            </CardDescription>
          </CardHeader>
        </Card>
      </RfqPageShell>
    );
  }

  const isFinalStep = steps[steps.length - 1]?.id === step.id;

  return (
    <RfqPageShell>
      <RfqPageHeader
        title={step.name}
        subtitle={
          step.description ||
          (projectName
            ? `Award requests awaiting ${step.name} for ${projectName}.`
            : `Award requests awaiting ${step.name}.`)
        }
        icon={GitMerge}
        backHref={context.rfqHref()}
        backLabel="Back to RFQ"
        gradient={RFQ_GRADIENT}
      />

      <RfqNav context={context} active="hub" />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>RFQ No.</TableHead>
                  <TableHead>Recommended Vendor</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Award Value</TableHead>
                  <TableHead>vs Lowest</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageApprovals.length ? (
                  stageApprovals.map((approval) => {
                    const isExpanded = expandedIds.has(approval.id);
                    const mayAct = user ? canActOnRfqAward(approval, user.id) : false;
                    const due = toDateSafe(approval.deadline);
                    const premium = awardPremium(approval.totalAmount, approval.lowestLandedCost);

                    return (
                      <Fragment key={approval.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggleExpanded(approval.id)}>
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleExpanded(approval.id)}
                              aria-label={isExpanded ? "Collapse" : "Expand"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">{approval.rfqNumber}</TableCell>
                          <TableCell>{approval.vendorName}</TableCell>
                          <TableCell>{approval.items.length}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-medium">
                            {formatCurrency(approval.totalAmount)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {approval.lowestLandedCost == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : premium.isLowest ? (
                              <span className="font-medium text-emerald-700">Lowest</span>
                            ) : (
                              <span
                                className="flex items-center gap-1 font-medium text-amber-700"
                                title={`Lowest comparable quote: ${formatCurrency(approval.lowestLandedCost)}`}
                              >
                                <TrendingUp className="h-3 w-3" />+{formatCurrency(premium.premium)} (
                                {premium.premiumPct.toFixed(1)}%)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{approval.requestedByName || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={rfqAwardStatusStyles[approval.status]}>
                              {approval.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {due ? (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {due.toLocaleDateString()}
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                            {mayAct ? (
                              <div className="flex flex-wrap justify-end gap-1">
                                {allowedActions.map((action) => (
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
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not assigned to you</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={10} className="p-0">
                              <div className="p-3">
                                <p className="mb-2 px-1 text-xs text-muted-foreground">
                                  RFQ dated {formatDate(approval.rfqDate)}
                                </p>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>BOQ SL No</TableHead>
                                      <TableHead>Description</TableHead>
                                      <TableHead>Indent</TableHead>
                                      <TableHead className="text-right">Qty</TableHead>
                                      <TableHead className="text-right">Rate</TableHead>
                                      <TableHead className="text-right">Amount</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {approval.items.map((item) => (
                                      <TableRow key={item.rfqItemId}>
                                        <TableCell>{item.boqSlNo || "—"}</TableCell>
                                        <TableCell className="max-w-sm truncate" title={item.description}>
                                          {item.description || "—"}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                          {item.sourceIndentNumber || "—"}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-right">
                                          {formatQuantity(item.qty)} {item.unit}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-right">
                                          {formatCurrency(item.rate)}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-right font-medium">
                                          {formatCurrency(item.amount)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
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
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="h-32 text-center">
                      <GitMerge className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Nothing waiting at this stage</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Awards confirmed on an RFQ will appear here for approval.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.action} award</DialogTitle>
            <DialogDescription>
              {pending ? `${pending.approval.rfqNumber} — ${pending.approval.vendorName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
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
          <DialogFooter>
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
    </RfqPageShell>
  );
}
