"use client";

/**
 * A reusable editor for a `workflows/{docId}.steps` document.
 *
 * JMC's configuration screen is bespoke and stays that way — it carries certificate-specific
 * actions and serial-number rules that don't generalise. Survey and Indent, though, configure the
 * exact same thing: an ordered list of stages, each with a name, turnaround, assignment and a set
 * of allowed actions. Writing that UI twice was already a copy too many, so it lives here and the
 * two screens supply only what actually differs — which document, which actions, and the copy
 * explaining what the workflow gates.
 *
 * Owns its own toolbar (Add Stage / Save) rather than pushing buttons into the page header, so a
 * host screen only has to render a header and drop this underneath.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  AssignedTo,
  Department,
  Project,
  User,
  WorkflowAssignmentType,
  WorkflowStep,
} from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const ASSIGNMENT_TYPES: WorkflowAssignmentType[] = [
  "User-based",
  "Project-based",
  "Department-based",
];

const UPLOAD_OPTIONS = ["Not Required", "Optional", "Required"] as const;

/** Sentinel for "no user picked" — Radix Select rejects an empty string value. */
const NONE = "__none__";

const makeStep = (index: number): WorkflowStep =>
  ({
    id: String(Date.now() + index),
    name: "",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject"],
    upload: "Optional",
    description: "",
  }) as WorkflowStep;

const stepActionNames = (step: WorkflowStep) =>
  (step.actions ?? []).map((action) => (typeof action === "string" ? action : action.name));

export interface WorkflowConfigurationEditorProps {
  /** Document under `workflows/` this editor reads and writes. */
  workflowDocId: string;
  /** Seeded into the editor when the document doesn't exist yet. Not persisted until saved. */
  defaultSteps: WorkflowStep[];
  /** The only actions this workflow's stages may offer. */
  allowedActions: readonly string[];
  canEdit: boolean;
  activityModule: string;
  /** Activity-log action name, e.g. "Update Survey Workflow". */
  activityAction: string;
  projectName?: string;
  /** Explains what this particular workflow gates — shown above the stage list. */
  behaviourDescription: ReactNode;
  /** Shown when no stages are configured. */
  emptyStateDescription: string;
  /** Noun for a single routed document, e.g. "survey" or "indent". */
  subjectNoun: string;
}

export function WorkflowConfigurationEditor({
  workflowDocId,
  defaultSteps,
  allowedActions,
  canEdit,
  activityModule,
  activityAction,
  projectName,
  behaviourDescription,
  emptyStateDescription,
  subjectNoun,
}: WorkflowConfigurationEditorProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [workflowSnapshot, userSnapshot, projectSnapshot, departmentSnapshot] = await Promise.all([
        getDoc(doc(db, "workflows", workflowDocId)),
        getDocs(collection(db, "users")),
        getDocs(collection(db, "projects")),
        getDocs(collection(db, "departments")),
      ]);

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : defaultSteps;
      setSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name !== undefined)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );

      setUsers(userSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as User)));
      setProjects(projectSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Project)));
      setDepartments(
        departmentSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Department)),
      );
    } catch (error) {
      console.error(`Failed to load the ${workflowDocId} workflow:`, error);
      toast({ title: "Unable to load the workflow", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
    // defaultSteps is a module-level constant at every call site; excluded so a new array
    // identity can't retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowDocId, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    setSteps((previous) =>
      previous.map((step, position) =>
        position === index ? ({ ...step, ...patch } as WorkflowStep) : step,
      ),
    );
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setSteps((previous) => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const toggleAction = (index: number, action: string, checked: boolean) => {
    setSteps((previous) =>
      previous.map((step, position) => {
        if (position !== index) return step;
        const current = stepActionNames(step);
        const next = checked ? [...current, action] : current.filter((name) => name !== action);
        return { ...step, actions: next } as WorkflowStep;
      }),
    );
  };

  /** Project/Department-based assignment stores `Record<id, {primary, alternative}>`. */
  const setMappedAssignee = (
    index: number,
    key: string,
    field: "primary" | "alternative",
    value: string,
  ) => {
    setSteps((previous) =>
      previous.map((step, position) => {
        if (position !== index) return step;
        const current = (typeof step.assignedTo === "object" && !Array.isArray(step.assignedTo)
          ? step.assignedTo
          : {}) as Record<string, AssignedTo>;
        const existing = current[key] ?? { primary: "" };
        return {
          ...step,
          assignedTo: { ...current, [key]: { ...existing, [field]: value === NONE ? "" : value } },
        } as WorkflowStep;
      }),
    );
  };

  const setUserAssignee = (index: number, slot: 0 | 1, value: string) => {
    setSteps((previous) =>
      previous.map((step, position) => {
        if (position !== index) return step;
        const current = Array.isArray(step.assignedTo) ? [...(step.assignedTo as string[])] : [];
        current[slot] = value === NONE ? "" : value;
        // Trailing empties would read as assignees downstream; keep the primary slot only.
        const next = [current[0] ?? "", current[1] ?? ""].filter(
          (id, slotIndex) => slotIndex === 0 || Boolean(id),
        );
        return { ...step, assignedTo: next } as WorkflowStep;
      }),
    );
  };

  const validationError = useMemo(() => {
    const unnamed = steps.findIndex((step) => !step.name.trim());
    if (unnamed >= 0) return `Stage ${unnamed + 1} needs a name.`;
    const actionless = steps.findIndex((step) => stepActionNames(step).length === 0);
    if (actionless >= 0) return `“${steps[actionless].name}” needs at least one action.`;
    const noApprove = steps.findIndex((step) => !stepActionNames(step).includes("Approve"));
    if (noApprove >= 0)
      return `“${steps[noApprove].name}” has no Approve action, so nothing could ever move past it.`;
    return null;
  }, [steps]);

  const handleSave = async () => {
    if (!canEdit || !user) return;
    if (validationError) {
      toast({ title: "Check the workflow", description: validationError, variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await setDoc(doc(db, "workflows", workflowDocId), { steps }, { merge: true });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: activityModule,
        action: activityAction,
        details: { project: projectName ?? "", stepCount: steps.length },
      });
      toast({
        title: "Workflow saved",
        description: `${steps.length} stage${steps.length === 1 ? "" : "s"} configured.`,
      });
    } catch (error) {
      console.error(`Failed to save the ${workflowDocId} workflow:`, error);
      toast({ title: "Unable to save the workflow", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <>
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How this workflow behaves</CardTitle>
          <CardDescription>{behaviourDescription}</CardDescription>
        </CardHeader>
      </Card>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setSteps((previous) => [...previous, makeStep(previous.length)])}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Stage
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Workflow
          </Button>
        </div>
      ) : null}

      {validationError ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="py-3">
            <CardDescription className="text-destructive">{validationError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {steps.length === 0 ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>No stages configured</CardTitle>
            <CardDescription>{emptyStateDescription}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-3">
          {steps.map((step, index) => {
            const actionNames = stepActionNames(step);
            const mapped = (typeof step.assignedTo === "object" && !Array.isArray(step.assignedTo)
              ? step.assignedTo
              : {}) as Record<string, AssignedTo>;
            const userAssignees = Array.isArray(step.assignedTo) ? (step.assignedTo as string[]) : [];
            const mappingTargets =
              step.assignmentType === "Project-based"
                ? projects.map((project) => ({ id: project.id, label: project.projectName }))
                : step.assignmentType === "Department-based"
                  ? departments.map((department) => ({ id: department.id, label: department.name }))
                  : [];

            return (
              <AccordionItem
                key={step.id}
                value={step.id}
                className="rounded-lg border border-border/60 bg-card px-4"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex flex-1 items-center gap-3 pr-3 text-left">
                    <Badge variant="outline" className="shrink-0">
                      {index + 1}
                    </Badge>
                    <span className="font-semibold">{step.name || "Untitled stage"}</span>
                    <span className="text-xs text-muted-foreground">
                      {step.assignmentType} · {step.tat}h
                      {index === steps.length - 1 ? " · final" : ""}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pb-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`name-${step.id}`}>Stage name</Label>
                      <Input
                        id={`name-${step.id}`}
                        value={step.name}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { name: event.target.value })}
                        placeholder="e.g. Verification"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`tat-${step.id}`}>Turnaround (working hours)</Label>
                      <Input
                        id={`tat-${step.id}`}
                        type="number"
                        min="1"
                        value={step.tat}
                        disabled={!canEdit}
                        onChange={(event) => updateStep(index, { tat: Number(event.target.value) || 0 })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`description-${step.id}`}>Instructions for the assignee</Label>
                    <Textarea
                      id={`description-${step.id}`}
                      value={step.description ?? ""}
                      disabled={!canEdit}
                      onChange={(event) => updateStep(index, { description: event.target.value })}
                      placeholder="Shown at the top of this stage's screen."
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Assignment</Label>
                      <Select
                        value={step.assignmentType}
                        disabled={!canEdit}
                        onValueChange={(value: WorkflowAssignmentType) =>
                          updateStep(index, {
                            assignmentType: value,
                            // assignedTo has a different shape per type — reset rather than carry
                            // an incompatible value across.
                            assignedTo: value === "User-based" ? [] : {},
                          } as Partial<WorkflowStep>)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNMENT_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Evidence upload</Label>
                      <Select
                        value={step.upload}
                        disabled={!canEdit}
                        onValueChange={(value) =>
                          updateStep(index, { upload: value as WorkflowStep["upload"] })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UPLOAD_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {step.assignmentType === "User-based" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Primary reviewer</Label>
                        <Select
                          value={userAssignees[0] || NONE}
                          disabled={!canEdit}
                          onValueChange={(value) => setUserAssignee(index, 0, value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a user" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Unassigned</SelectItem>
                            {users.map((candidate) => (
                              <SelectItem key={candidate.id} value={candidate.id}>
                                {candidate.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Alternative reviewer</Label>
                        <Select
                          value={userAssignees[1] || NONE}
                          disabled={!canEdit}
                          onValueChange={(value) => setUserAssignee(index, 1, value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Optional" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>None</SelectItem>
                            {users.map((candidate) => (
                              <SelectItem key={candidate.id} value={candidate.id}>
                                {candidate.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>
                        Reviewer per {step.assignmentType === "Project-based" ? "project" : "department"}
                      </Label>
                      <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
                        {mappingTargets.length ? (
                          mappingTargets.map((target) => (
                            <div
                              key={target.id}
                              className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr] sm:items-center"
                            >
                              <span className="truncate text-sm" title={target.label}>
                                {target.label}
                              </span>
                              <Select
                                value={mapped[target.id]?.primary || NONE}
                                disabled={!canEdit}
                                onValueChange={(value) => setMappedAssignee(index, target.id, "primary", value)}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder="Primary" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>Unassigned</SelectItem>
                                  {users.map((candidate) => (
                                    <SelectItem key={candidate.id} value={candidate.id}>
                                      {candidate.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={mapped[target.id]?.alternative || NONE}
                                disabled={!canEdit}
                                onValueChange={(value) =>
                                  setMappedAssignee(index, target.id, "alternative", value)
                                }
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder="Alternative" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>None</SelectItem>
                                  {users.map((candidate) => (
                                    <SelectItem key={candidate.id} value={candidate.id}>
                                      {candidate.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No {step.assignmentType === "Project-based" ? "projects" : "departments"} to map.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Actions available at this stage</Label>
                    <div className="flex flex-wrap gap-4">
                      {allowedActions.map((action) => (
                        <label key={action} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={actionNames.includes(action)}
                            disabled={!canEdit}
                            onCheckedChange={(checked) => toggleAction(index, action, checked === true)}
                          />
                          {action}
                        </label>
                      ))}
                    </div>
                  </div>

                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      <Button variant="outline" size="sm" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                        <ArrowUp className="mr-1.5 h-3.5 w-3.5" />
                        Move up
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={index === steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ArrowDown className="mr-1.5 h-3.5 w-3.5" />
                        Move down
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          setSteps((previous) => previous.filter((_, position) => position !== index))
                        }
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Remove stage
                      </Button>
                    </div>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {!canEdit ? (
        <p className="text-sm text-muted-foreground">
          You have read-only access to this workflow. “Edit Settings” is required to change how{" "}
          {subjectNoun}s are approved.
        </p>
      ) : null}
    </>
  );
}
