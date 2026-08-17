"use client";

/**
 * A single PO issue-approval stage — the requests sitting on it and the actions the step allows.
 *
 * Approving the last configured step is what flips the purchase order to Issued, which is the point
 * at which it becomes a commitment everywhere downstream. The exceptions the buyer asked to be
 * accepted are shown inline, because accepting them is the substance of the decision.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  GitMerge,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { actOnPoIssue } from "@/lib/project-management-po-entries";
import { formatCurrency } from "@/lib/purchase-orders";
import {
  DEFAULT_PO_ISSUE_STEPS,
  PO_ISSUE_ACTIONS,
  PO_ISSUE_APPROVAL_COLLECTION,
  PO_ISSUE_WORKFLOW_DOC_ID,
  canActOnPoIssue,
  poIssueStatusStyles,
  poIssuesForStep,
  type PoIssueAction,
  type PoIssueApproval,
} from "@/lib/project-management-po-workflow";
import { useProjectManagementPoContext } from "@/components/po/use-po-host-context";
import { PoNav } from "@/components/po/po-nav";
import {
  PO_GRADIENT,
  PoAccessDenied,
  PoLoadingState,
  PoPageHeader,
  PoPageShell,
  PoProjectNotFound,
} from "@/components/po/po-page-shell";
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

/** PO dates are plain yyyy-mm-dd strings, matching how the other PO screens render them. */
const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

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

export default function PoIssueStagePage() {
  const params = useParams();
  const stageId = String(params?.stageId ?? "");
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementPoContext(mappingId);

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [approvals, setApprovals] = useState<PoIssueApproval[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [pending, setPending] = useState<{ approval: PoIssueApproval; action: PoIssueAction } | null>(
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
        getDoc(doc(db, "workflows", PO_ISSUE_WORKFLOW_DOC_ID)),
        getDocs(collection(db, "projects", globalProjectId, PO_ISSUE_APPROVAL_COLLECTION)),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_PO_ISSUE_STEPS;
      setSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );

      setApprovals(
        approvalSnapshot.docs.map(
          (approvalDoc) => ({ id: approvalDoc.id, ...approvalDoc.data() } as PoIssueApproval),
        ),
      );
    } catch (error) {
      console.error("Failed to load PO issue stage:", error);
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
    () => poIssuesForStep(approvals, stageId, steps),
    [approvals, stageId, steps],
  );

  const allowedActions = useMemo<PoIssueAction[]>(() => {
    if (!step) return [];
    const configured = (step.actions ?? []).map((action) =>
      typeof action === "string" ? action : action.name,
    );
    return PO_ISSUE_ACTIONS.filter((action) => configured.includes(action));
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
      const result = await actOnPoIssue({
        globalProjectId,
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
        action: `PO Issue ${pending.action}`,
        details: {
          project: projectName,
          poNumber: pending.approval.poNumber,
          vendor: pending.approval.vendorName,
          stage: step?.name ?? "",
          totalAmount: pending.approval.totalAmount,
        },
      });

      toast({
        title: `Issue request ${result.status.toLowerCase()}`,
        description: result.issued
          ? `${pending.approval.poNumber} is now Issued and counts as a commitment.`
          : undefined,
      });
      setPending(null);
      setComment("");
      await loadData();
    } catch (error) {
      console.error("Failed to action PO issue request:", error);
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
    return <PoLoadingState />;
  }

  if (!canViewModule) {
    return <PoAccessDenied description="You do not have permission to access purchase orders." />;
  }

  if (notFound) {
    return (
      <PoProjectNotFound
        description="Return to Project Management and choose a project before opening purchase orders."
        href="/project-management"
      />
    );
  }

  if (!step) {
    return (
      <PoPageShell>
        <PoPageHeader
          title="Stage not found"
          subtitle="This stage is no longer part of the issue approval workflow."
          icon={GitMerge}
          backHref={context.poHref()}
          backLabel="Back to Purchase Orders"
          gradient={PO_GRADIENT}
        />
        <PoNav context={context} active="hub" />
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Stage removed</CardTitle>
            <CardDescription>
              It may have been deleted in Workflow Configuration. Open the Purchase Orders hub to see
              the current stages.
            </CardDescription>
          </CardHeader>
        </Card>
      </PoPageShell>
    );
  }

  const isFinalStep = steps[steps.length - 1]?.id === step.id;

  return (
    <PoPageShell>
      <PoPageHeader
        title={step.name}
        subtitle={
          step.description ||
          (projectName
            ? `Purchase orders awaiting ${step.name} for ${projectName}.`
            : `Purchase orders awaiting ${step.name}.`)
        }
        icon={GitMerge}
        backHref={context.poHref()}
        backLabel="Back to Purchase Orders"
        gradient={PO_GRADIENT}
      />

      <PoNav context={context} active="hub" />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>PO No.</TableHead>
                  <TableHead>PO Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Exceptions</TableHead>
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
                    const mayAct = user ? canActOnPoIssue(approval, user.id) : false;
                    const due = toDateSafe(approval.deadline);
                    const exceptionCount = approval.exceptions?.length ?? 0;

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
                          <TableCell className="font-medium">{approval.poNumber}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(approval.poDate)}</TableCell>
                          <TableCell>{approval.vendorName}</TableCell>
                          <TableCell>{approval.itemCount}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-medium">
                            {formatCurrency(approval.totalAmount)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {exceptionCount ? (
                              <span className="flex items-center gap-1 font-medium text-amber-700">
                                <AlertTriangle className="h-3 w-3" />
                                {exceptionCount}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">None</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{approval.requestedByName || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={poIssueStatusStyles[approval.status]}>
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
                            <TableCell colSpan={11} className="p-0">
                              <div className="space-y-3 p-3">
                                <Button variant="outline" size="sm" asChild>
                                  <Link href={`${context.poHref(approval.poId)}`}>
                                    Open {approval.poNumber}
                                  </Link>
                                </Button>

                                {exceptionCount ? (
                                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                                    <p className="text-xs font-semibold text-amber-900">
                                      The buyer is asking you to accept {exceptionCount} exception
                                      {exceptionCount === 1 ? "" : "s"}:
                                    </p>
                                    <ul className="mt-1.5 space-y-1">
                                      {approval.exceptions.map((exception, index) => (
                                        <li key={index} className="text-xs text-amber-900">
                                          <span className="font-medium">
                                            {exception.kind === "flow-down"
                                              ? "Flow-down gap"
                                              : "Commitment over BOQ"}
                                            :
                                          </span>{" "}
                                          {exception.label}
                                          {exception.detail ? ` — ${exception.detail}` : ""}
                                        </li>
                                      ))}
                                    </ul>
                                    {approval.overrideReason ? (
                                      <p className="mt-2 text-xs text-amber-900">
                                        <span className="font-medium">Stated reason:</span>{" "}
                                        {approval.overrideReason}
                                      </p>
                                    ) : null}
                                  </div>
                                ) : null}

                                {approval.actionLogs?.length ? (
                                  <ul className="space-y-1">
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
                    <TableCell colSpan={11} className="h-32 text-center">
                      <GitMerge className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Nothing waiting at this stage</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Purchase orders submitted for issue will appear here.
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
            <DialogTitle>{pending?.action} issue request</DialogTitle>
            <DialogDescription>
              {pending ? `${pending.approval.poNumber} — ${pending.approval.vendorName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm">
              Order value:{" "}
              <span className="font-medium">
                {pending ? formatCurrency(pending.approval.totalAmount) : ""}
              </span>{" "}
              across {pending?.approval.itemCount} item(s).
            </p>
            {pending && (pending.approval.exceptions?.length ?? 0) > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                This PO carries {pending.approval.exceptions.length} unresolved exception
                {pending.approval.exceptions.length === 1 ? "" : "s"}. Approving accepts{" "}
                {pending.approval.exceptions.length === 1 ? "it" : "them"} in your name.
              </p>
            )}
            {pending?.action === "Approve" && isFinalStep && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                This is the final step — approving issues the purchase order, which commits the
                quantities and value against the BOQ.
              </p>
            )}
            {pending?.action === "Needs Correction" && (
              <p className="rounded-md bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800">
                This sends the PO back to the buyer, who can edit the draft and resubmit.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="po-issue-comment">Comment</Label>
              <Textarea
                id="po-issue-comment"
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
    </PoPageShell>
  );
}
