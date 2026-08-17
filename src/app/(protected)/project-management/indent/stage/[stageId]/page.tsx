"use client";

/**
 * A single indent workflow stage — the indents sitting on it and the actions the step allows.
 *
 * Approving the last configured step is what finally grants the indent its BOQ reservation; every
 * earlier approval just advances it. The transition itself is in
 * project-management-indent-entries.ts so this screen never decides it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Clock, GitMerge, Loader2 } from "lucide-react";
import { Fragment } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { actOnIndent } from "@/lib/project-management-indent-entries";
import {
  DEFAULT_INDENT_STEPS,
  INDENT_ACTIONS,
  INDENT_COLLECTION,
  INDENT_WORKFLOW_DOC_ID,
  canActOnIndent,
  indentStatusStyles,
  indentsForStep,
  type IndentAction,
  type IndentStatus,
  type IndentWorkflowFields,
} from "@/lib/project-management-indent-workflow";
import { useProjectManagementIndentContext } from "@/components/indent/use-indent-host-context";
import { IndentNav } from "@/components/indent/indent-nav";
import {
  INDENT_GRADIENT,
  IndentAccessDenied,
  IndentLoadingState,
  IndentPageHeader,
  IndentPageShell,
  IndentProjectNotFound,
} from "@/components/indent/indent-page-shell";
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

type IndentLineItem = {
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  requestedQty: number;
  budgetPrice: number;
  lineTotal: number;
};

type StageIndent = IndentWorkflowFields & {
  id: string;
  indentNumber: string;
  indentDate: string;
  requiredDate?: string;
  remarks?: string;
  status: IndentStatus;
  items: IndentLineItem[];
  totalAmount: number;
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
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

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

export default function IndentStagePage() {
  const params = useParams();
  const stageId = String(params?.stageId ?? "");
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementIndentContext(mappingId);

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [indents, setIndents] = useState<StageIndent[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [pending, setPending] = useState<{ indent: StageIndent; action: IndentAction } | null>(null);
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
      const [workflowSnapshot, indentSnapshot] = await Promise.all([
        getDoc(doc(db, "workflows", INDENT_WORKFLOW_DOC_ID)),
        getDocs(collection(db, "projects", globalProjectId, INDENT_COLLECTION)),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_INDENT_STEPS;
      setSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );

      setIndents(
        indentSnapshot.docs.map((indentDoc) => {
          const data = indentDoc.data() as Record<string, any>;
          const items = (Array.isArray(data.items) ? data.items : []) as IndentLineItem[];
          return {
            id: indentDoc.id,
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
            createdByName: data.createdByName,
            workflowEnrolled: data.workflowEnrolled,
            currentStepIndex: data.currentStepIndex,
            currentStepName: data.currentStepName,
            assignees: data.assignees,
            deadline: data.deadline,
            actionLogs: data.actionLogs,
          } as StageIndent;
        }),
      );
    } catch (error) {
      console.error("Failed to load indent stage:", error);
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

  const stageIndents = useMemo(
    () => indentsForStep(indents, stageId, steps),
    [indents, stageId, steps],
  );

  const allowedActions = useMemo<IndentAction[]>(() => {
    if (!step) return [];
    const configured = (step.actions ?? []).map((action) =>
      typeof action === "string" ? action : action.name,
    );
    return INDENT_ACTIONS.filter((action) => configured.includes(action));
  }, [step]);

  const toggleExpanded = (indentId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(indentId)) next.delete(indentId);
      else next.add(indentId);
      return next;
    });
  };

  const handleAct = async () => {
    if (!pending || !user || !globalProjectId) return;
    setIsActing(true);
    try {
      const result = await actOnIndent({
        projectId: globalProjectId,
        indentId: pending.indent.id,
        action: pending.action,
        comment: comment.trim(),
        steps,
        actor: { id: user.id, name: user.name },
        resolveAssignees: (nextStep) =>
          getAssigneeForStep(nextStep, {
            projectId: globalProjectId,
            departmentId: "",
            amount: toNumber(pending.indent.totalAmount),
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
        action: `Indent ${pending.action}`,
        details: {
          project: projectName,
          indentNumber: pending.indent.indentNumber,
          stage: step?.name ?? "",
          totalAmount: toNumber(pending.indent.totalAmount),
        },
      });

      toast({
        title: `Indent ${result.status.toLowerCase()}`,
        description: result.reserves
          ? "It now reserves quantity against its BOQ items."
          : pending.action === "Needs Correction"
            ? "Returned to the raiser as an editable draft."
            : undefined,
      });
      setPending(null);
      setComment("");
      await loadData();
    } catch (error) {
      console.error("Failed to action indent:", error);
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
    return <IndentLoadingState />;
  }

  if (!canViewModule) {
    return <IndentAccessDenied description="You do not have permission to access the Indent module." />;
  }

  if (notFound) {
    return (
      <IndentProjectNotFound
        description="Return to Project Management and choose a project before opening Indent."
        href="/project-management"
      />
    );
  }

  if (!step) {
    return (
      <IndentPageShell>
        <IndentPageHeader
          title="Stage not found"
          subtitle="This stage is no longer part of the indent workflow."
          icon={GitMerge}
          backHref={context.indentHref()}
          backLabel="Back to Indent"
          gradient={INDENT_GRADIENT}
        />
        <IndentNav context={context} active="hub" />
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Stage removed</CardTitle>
            <CardDescription>
              It may have been deleted in Workflow Configuration. Open the Indent hub to see the
              current stages.
            </CardDescription>
          </CardHeader>
        </Card>
      </IndentPageShell>
    );
  }

  const isFinalStep = steps[steps.length - 1]?.id === step.id;

  return (
    <IndentPageShell>
      <IndentPageHeader
        title={step.name}
        subtitle={
          step.description ||
          (projectName ? `Indents awaiting ${step.name} for ${projectName}.` : `Indents awaiting ${step.name}.`)
        }
        icon={GitMerge}
        backHref={context.indentHref()}
        backLabel="Back to Indent"
        gradient={INDENT_GRADIENT}
      />

      <IndentNav context={context} active="hub" />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Indent No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Raised By</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageIndents.length ? (
                  stageIndents.map((indent) => {
                    const isExpanded = expandedIds.has(indent.id);
                    const totalQty = indent.items.reduce(
                      (sum, item) => sum + toNumber(item.requestedQty),
                      0,
                    );
                    const mayAct = user ? canActOnIndent(indent, user.id) : false;
                    const due = toDateSafe(indent.deadline);

                    return (
                      <Fragment key={indent.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggleExpanded(indent.id)}>
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleExpanded(indent.id)}
                              aria-label={isExpanded ? "Collapse" : "Expand"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">{indent.indentNumber}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(indent.indentDate)}</TableCell>
                          <TableCell>{indent.items.length}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{formatQuantity(totalQty)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-medium">
                            {formatCurrency(toNumber(indent.totalAmount))}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(indent.requiredDate)}</TableCell>
                          <TableCell className="text-sm">{indent.createdByName || "—"}</TableCell>
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
                                      setPending({ indent, action });
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
                                {indent.remarks && (
                                  <p className="mb-2 px-1 text-sm text-muted-foreground">
                                    <span className="font-medium text-foreground">Remarks: </span>
                                    {indent.remarks}
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
                                        <TableCell className="max-w-sm truncate" title={item.description}>
                                          {item.description || "—"}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                          {formatQuantity(toNumber(item.requestedQty))} {item.unit}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                          {formatCurrency(toNumber(item.budgetPrice))}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap font-medium">
                                          {formatCurrency(toNumber(item.lineTotal))}
                                        </TableCell>
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
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="h-32 text-center">
                      <GitMerge className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Nothing waiting at this stage</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Indents submitted from the register will appear here.
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
            <DialogTitle>{pending?.action} indent</DialogTitle>
            <DialogDescription>
              {pending ? `${pending.indent.indentNumber} — ${pending.indent.items.length} item(s)` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm">
              Total value:{" "}
              <span className="font-medium">
                {pending ? formatCurrency(toNumber(pending.indent.totalAmount)) : ""}
              </span>
            </p>
            {pending?.action === "Approve" && isFinalStep && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                This is the final step — approving reserves these quantities against their BOQ items.
              </p>
            )}
            {pending?.action === "Needs Correction" && (
              <p className="rounded-md bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800">
                This returns the indent to the raiser as an editable draft.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="indent-action-comment">Comment</Label>
              <Textarea
                id="indent-action-comment"
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
    </IndentPageShell>
  );
}
