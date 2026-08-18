"use client";

/**
 * A single inspection result-approval stage — the requests sitting on it and the actions the step
 * allows.
 *
 * Approving the last configured step is what writes the result onto the inspection record, which is
 * what opens the MDCC gate. What the reviewer most needs to see — rejected quantity and open punch
 * items — is surfaced inline via inspectionResultConcerns, so the thresholds can't drift between
 * this list and the confirm dialog.
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
  Paperclip,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { actOnInspectionResult } from "@/lib/project-management-inspection-entries";
import { formatGateDate, inspectionStatusStyles } from "@/lib/supply-gates";
import { formatSerialList } from "@/lib/serial-tracking";
import {
  DEFAULT_INSPECTION_RESULT_STEPS,
  INSPECTION_APPROVAL_ACTIONS,
  INSPECTION_RESULT_APPROVAL_COLLECTION,
  INSPECTION_RESULT_WORKFLOW_DOC_ID,
  canActOnInspectionApproval,
  inspectionApprovalStatusStyles,
  inspectionApprovalsForStep,
  inspectionResultConcerns,
  type InspectionApprovalAction,
  type InspectionResultApproval,
} from "@/lib/project-management-inspection-workflow";
import { useProjectManagementInspectionContext } from "@/components/inspection/use-inspection-host-context";
import { InspectionNav } from "@/components/inspection/inspection-nav";
import {
  INSPECTION_GRADIENT,
  InspectionAccessDenied,
  InspectionLoadingState,
  InspectionPageHeader,
  InspectionPageShell,
  InspectionProjectNotFound,
} from "@/components/inspection/inspection-page-shell";
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

export default function InspectionResultStagePage() {
  const params = useParams();
  const stageId = String(params?.stageId ?? "");
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } =
    useProjectManagementInspectionContext(mappingId);

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [approvals, setApprovals] = useState<InspectionResultApproval[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [pending, setPending] = useState<{
    approval: InspectionResultApproval;
    action: InspectionApprovalAction;
  } | null>(null);
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
        getDoc(doc(db, "workflows", INSPECTION_RESULT_WORKFLOW_DOC_ID)),
        getDocs(
          collection(db, "projects", globalProjectId, INSPECTION_RESULT_APPROVAL_COLLECTION),
        ),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_INSPECTION_RESULT_STEPS;
      setSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );

      setApprovals(
        approvalSnapshot.docs.map(
          (approvalDoc) =>
            ({ id: approvalDoc.id, ...approvalDoc.data() } as InspectionResultApproval),
        ),
      );
    } catch (error) {
      console.error("Failed to load inspection result stage:", error);
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
    () => inspectionApprovalsForStep(approvals, stageId, steps),
    [approvals, stageId, steps],
  );

  const allowedActions = useMemo<InspectionApprovalAction[]>(() => {
    if (!step) return [];
    const configured = (step.actions ?? []).map((action) =>
      typeof action === "string" ? action : action.name,
    );
    return INSPECTION_APPROVAL_ACTIONS.filter((action) => configured.includes(action));
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
      const result = await actOnInspectionResult({
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
            amount: 0,
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
        action: `Inspection Result ${pending.action}`,
        details: {
          project: projectName,
          boqSlNo: pending.approval.boqSlNo,
          poNumber: pending.approval.poNumber,
          result: pending.approval.result,
          stage: step?.name ?? "",
        },
      });

      toast({
        title: `Result request ${result.status.toLowerCase()}`,
        description: result.recorded
          ? `${pending.approval.boqSlNo} recorded as ${pending.approval.result.toLowerCase()}.`
          : undefined,
      });
      setPending(null);
      setComment("");
      await loadData();
    } catch (error) {
      console.error("Failed to action inspection result request:", error);
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
    return <InspectionLoadingState />;
  }

  if (!canViewModule) {
    return <InspectionAccessDenied description="You do not have permission to access inspections." />;
  }

  if (notFound) {
    return (
      <InspectionProjectNotFound
        description="Return to Project Management and choose a project before opening inspections."
        href="/project-management"
      />
    );
  }

  if (!step) {
    return (
      <InspectionPageShell>
        <InspectionPageHeader
          title="Stage not found"
          subtitle="This stage is no longer part of the result approval workflow."
          icon={GitMerge}
          backHref={context.inspectionHref()}
          backLabel="Back to Inspections"
          gradient={INSPECTION_GRADIENT}
        />
        <InspectionNav context={context} active="hub" />
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Stage removed</CardTitle>
            <CardDescription>
              It may have been deleted in Workflow Configuration. Open the Inspections hub to see the
              current stages.
            </CardDescription>
          </CardHeader>
        </Card>
      </InspectionPageShell>
    );
  }

  const isFinalStep = steps[steps.length - 1]?.id === step.id;

  return (
    <InspectionPageShell>
      <InspectionPageHeader
        title={step.name}
        subtitle={
          step.description ||
          (projectName
            ? `Inspection results awaiting ${step.name} for ${projectName}.`
            : `Inspection results awaiting ${step.name}.`)
        }
        icon={GitMerge}
        backHref={context.inspectionHref()}
        backLabel="Back to Inspections"
        gradient={INSPECTION_GRADIENT}
      />

      <InspectionNav context={context} active="hub" />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>BOQ SL No</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>PO No.</TableHead>
                  <TableHead>Proposed Result</TableHead>
                  <TableHead className="text-right">Accepted / Rejected</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Inspector</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageApprovals.length ? (
                  stageApprovals.map((approval) => {
                    const isExpanded = expandedIds.has(approval.id);
                    const mayAct = user ? canActOnInspectionApproval(approval, user.id) : false;
                    const due = toDateSafe(approval.deadline);
                    const concerns = inspectionResultConcerns(approval);

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
                          <TableCell className="whitespace-nowrap">{approval.boqSlNo || "—"}</TableCell>
                          <TableCell className="max-w-xs truncate" title={approval.description}>
                            {approval.description || "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{approval.poNumber || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={inspectionStatusStyles[approval.result]}>
                              {approval.result}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">
                            {approval.qtyAccepted} / {approval.qtyRejected}
                            <span className="ml-1 text-xs text-muted-foreground">
                              of {approval.qtyOffered}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            {concerns.length ? (
                              <span className="flex items-center gap-1 font-medium text-amber-700">
                                <AlertTriangle className="h-3 w-3" />
                                {concerns.length}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Clean</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{approval.inspectorName || "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={inspectionApprovalStatusStyles[approval.status]}
                            >
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
                                <p className="text-xs text-muted-foreground">
                                  Inspected {formatGateDate(approval.inspectionDate)}
                                  {approval.remarks ? ` — ${approval.remarks}` : ""}
                                </p>

                                {approval.reportFileUrl ? (
                                  <Button variant="outline" size="sm" asChild>
                                    <a
                                      href={approval.reportFileUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                                      {approval.reportFileName || "Inspection report"}
                                    </a>
                                  </Button>
                                ) : (
                                  <p className="text-xs text-muted-foreground">No report attached.</p>
                                )}

                                {concerns.length ? (
                                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                                    <p className="text-xs font-semibold text-amber-900">
                                      Worth checking before approving:
                                    </p>
                                    <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                                      {concerns.map((concern, index) => (
                                        <li key={index} className="text-xs text-amber-900">
                                          {concern}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}

                                {approval.punchItems?.length ? (
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Punch item</TableHead>
                                        <TableHead>Severity</TableHead>
                                        <TableHead>Target</TableHead>
                                        <TableHead>Closed</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {approval.punchItems.map((punch) => (
                                        <TableRow key={punch.punchId}>
                                          <TableCell className="max-w-sm truncate" title={punch.description}>
                                            {punch.description}
                                          </TableCell>
                                          <TableCell>{punch.severity}</TableCell>
                                          <TableCell>{formatGateDate(punch.targetDate)}</TableCell>
                                          <TableCell>{punch.closed ? "Yes" : "No"}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                ) : null}

                                {approval.serials?.length ? (
                                  <p className="text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">Serials:</span>{" "}
                                    {formatSerialList(approval.serials)}
                                  </p>
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
                        Passing results submitted from the register will appear here.
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
            <DialogTitle>{pending?.action} inspection result</DialogTitle>
            <DialogDescription>
              {pending ? `${pending.approval.boqSlNo} — ${pending.approval.description}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm">
              Proposed result: <span className="font-medium">{pending?.approval.result}</span> —{" "}
              {pending?.approval.qtyAccepted} accepted, {pending?.approval.qtyRejected} rejected of{" "}
              {pending?.approval.qtyOffered} offered.
            </p>
            {pending && inspectionResultConcerns(pending.approval).length > 0 && (
              <div className="rounded-md bg-amber-50 px-3 py-2">
                <ul className="list-inside list-disc space-y-0.5">
                  {inspectionResultConcerns(pending.approval).map((concern, index) => (
                    <li key={index} className="text-xs font-medium text-amber-800">
                      {concern}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pending?.action === "Approve" && isFinalStep && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                This is the final step — approving records the result, which opens the MDCC gate for
                this item.
              </p>
            )}
            {pending?.action === "Reject" && (
              <p className="rounded-md bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800">
                This refuses the proposed result. The inspection stays Requested — it does not record
                a failure, which only an inspector should do.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="inspection-action-comment">Comment</Label>
              <Textarea
                id="inspection-action-comment"
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
    </InspectionPageShell>
  );
}
