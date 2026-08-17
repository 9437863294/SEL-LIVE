"use client";

/**
 * A single manufacturing-clearance approval stage — the requests sitting on it and the actions the
 * step allows.
 *
 * Approving the last configured step is what writes the MC record as Cleared, which is what opens
 * the gate for inspection. Rejecting a request refuses the clearance without opening it; that is
 * distinct from rejecting the clearance outright, which the register still does directly.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Clock, GitMerge, Loader2 } from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { actOnMcClearance } from "@/lib/project-management-mc-entries";
import { formatGateDate } from "@/lib/supply-gates";
import {
  DEFAULT_MC_CLEARANCE_STEPS,
  MC_APPROVAL_ACTIONS,
  MC_CLEARANCE_APPROVAL_COLLECTION,
  MC_CLEARANCE_WORKFLOW_DOC_ID,
  canActOnMcApproval,
  mcApprovalStatusStyles,
  mcApprovalsForStep,
  type McApprovalAction,
  type McClearanceApproval,
} from "@/lib/project-management-mc-workflow";
import { useProjectManagementMcContext } from "@/components/mc/use-mc-host-context";
import { McNav } from "@/components/mc/mc-nav";
import {
  MC_GRADIENT,
  McAccessDenied,
  McLoadingState,
  McPageHeader,
  McPageShell,
  McProjectNotFound,
} from "@/components/mc/mc-page-shell";
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

export default function McClearanceStagePage() {
  const params = useParams();
  const stageId = String(params?.stageId ?? "");
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementMcContext(mappingId);

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [approvals, setApprovals] = useState<McClearanceApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [pending, setPending] = useState<{
    approval: McClearanceApproval;
    action: McApprovalAction;
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
        getDoc(doc(db, "workflows", MC_CLEARANCE_WORKFLOW_DOC_ID)),
        getDocs(collection(db, "projects", globalProjectId, MC_CLEARANCE_APPROVAL_COLLECTION)),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_MC_CLEARANCE_STEPS;
      setSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );

      setApprovals(
        approvalSnapshot.docs.map(
          (approvalDoc) => ({ id: approvalDoc.id, ...approvalDoc.data() } as McClearanceApproval),
        ),
      );
    } catch (error) {
      console.error("Failed to load MC clearance stage:", error);
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
    () => mcApprovalsForStep(approvals, stageId, steps),
    [approvals, stageId, steps],
  );

  const allowedActions = useMemo<McApprovalAction[]>(() => {
    if (!step) return [];
    const configured = (step.actions ?? []).map((action) =>
      typeof action === "string" ? action : action.name,
    );
    return MC_APPROVAL_ACTIONS.filter((action) => configured.includes(action));
  }, [step]);

  const handleAct = async () => {
    if (!pending || !user || !globalProjectId) return;
    setIsActing(true);
    try {
      const result = await actOnMcClearance({
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
        action: `MC Clearance ${pending.action}`,
        details: {
          project: projectName,
          boqSlNo: pending.approval.boqSlNo,
          poNumber: pending.approval.poNumber,
          stage: step?.name ?? "",
        },
      });

      toast({
        title: `Clearance request ${result.status.toLowerCase()}`,
        description: result.cleared
          ? `${pending.approval.boqSlNo} is cleared — inspection can now be requested.`
          : undefined,
      });
      setPending(null);
      setComment("");
      await loadData();
    } catch (error) {
      console.error("Failed to action MC clearance request:", error);
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
    return <McLoadingState />;
  }

  if (!canViewModule) {
    return (
      <McAccessDenied description="You do not have permission to access manufacturing clearance." />
    );
  }

  if (notFound) {
    return (
      <McProjectNotFound
        description="Return to Project Management and choose a project before opening manufacturing clearance."
        href="/project-management"
      />
    );
  }

  if (!step) {
    return (
      <McPageShell>
        <McPageHeader
          title="Stage not found"
          subtitle="This stage is no longer part of the clearance approval workflow."
          icon={GitMerge}
          backHref={context.mcHref()}
          backLabel="Back to Manufacturing Clearance"
          gradient={MC_GRADIENT}
        />
        <McNav context={context} active="hub" />
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Stage removed</CardTitle>
            <CardDescription>
              It may have been deleted in Workflow Configuration. Open the Manufacturing Clearance
              hub to see the current stages.
            </CardDescription>
          </CardHeader>
        </Card>
      </McPageShell>
    );
  }

  const isFinalStep = steps[steps.length - 1]?.id === step.id;

  return (
    <McPageShell>
      <McPageHeader
        title={step.name}
        subtitle={
          step.description ||
          (projectName
            ? `Clearance requests awaiting ${step.name} for ${projectName}.`
            : `Clearance requests awaiting ${step.name}.`)
        }
        icon={GitMerge}
        backHref={context.mcHref()}
        backLabel="Back to Manufacturing Clearance"
        gradient={MC_GRADIENT}
      />

      <McNav context={context} active="hub" />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BOQ SL No</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>PO No.</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Clearance Date</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageApprovals.length ? (
                  stageApprovals.map((approval) => {
                    const mayAct = user ? canActOnMcApproval(approval, user.id) : false;
                    const due = toDateSafe(approval.deadline);

                    return (
                      <TableRow key={approval.id}>
                        <TableCell className="whitespace-nowrap">{approval.boqSlNo || "—"}</TableCell>
                        <TableCell className="max-w-xs truncate" title={approval.description}>
                          {approval.description || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{approval.poNumber || "—"}</TableCell>
                        <TableCell>{approval.vendorName || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatGateDate(approval.clearedDate)}
                        </TableCell>
                        <TableCell className="text-sm">{approval.requestedByName || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={mcApprovalStatusStyles[approval.status]}>
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
                        <TableCell className="text-right">
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
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center">
                      <GitMerge className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Nothing waiting at this stage</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Clearances submitted from the register will appear here.
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
            <DialogTitle>{pending?.action} clearance request</DialogTitle>
            <DialogDescription>
              {pending ? `${pending.approval.boqSlNo} — ${pending.approval.description}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm">
              {pending?.approval.vendorName} on {pending?.approval.poNumber}, clearance dated{" "}
              {pending ? formatGateDate(pending.approval.clearedDate) : ""}.
            </p>
            {pending?.approval.remarks ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Requester notes:</span>{" "}
                {pending.approval.remarks}
              </p>
            ) : null}
            {pending?.action === "Approve" && isFinalStep && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                This is the final step — approving clears manufacturing, which lets the vendor begin
                production and opens the gate for inspection.
              </p>
            )}
            {pending?.action === "Needs Correction" && (
              <p className="rounded-md bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800">
                This sends the request back so it can be re-raised with corrections.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="mc-action-comment">Comment</Label>
              <Textarea
                id="mc-action-comment"
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
    </McPageShell>
  );
}
