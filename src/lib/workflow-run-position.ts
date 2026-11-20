/**
 * Where a record sits in a configured workflow run.
 *
 * Several modules keep the same shape of record: a document with a `history` of actions, each
 * naming the step it was taken at, travelling a list of steps configured per installation. "Which
 * desk is this on" is then not a stored field but a reading of that history — which matters,
 * because the stored field goes stale whenever the workflow is reconfigured, a step is renamed, or
 * an action is recorded by a screen that forgot to update it.
 *
 * The rule, in one place so two screens cannot disagree:
 *
 *   - a step is done when the history holds an *approving* action naming it;
 *   - the record sits at the first step that has none;
 *   - once every step is done it sits at `steps.length`, which is past the end of the run.
 *
 * Steps are checked in order rather than counted, so a record that skipped one — possible when the
 * workflow was reconfigured after it was raised — reports the earliest gap rather than claiming the
 * progress of the latest action on it.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 * JMC reads it through `project-management-jmc-dashboard.ts`, which re-exports it under its own
 * names; MVAC reads it directly.
 */

/** The actions that complete a step. Matches the JMC log's original list. */
export const WORKFLOW_APPROVE_ACTIONS: readonly string[] = ["Approve", "Complete", "Verified"];

export interface WorkflowHistoryAction {
  stepName?: unknown;
  action?: unknown;
  timestamp?: unknown;
}

export interface WorkflowStepLike {
  id: string;
  name: string;
}

/** The step names a record's history holds an approving action for. */
export function approvedStepNames(
  history: readonly WorkflowHistoryAction[] = [],
  approveActions: readonly string[] = WORKFLOW_APPROVE_ACTIONS,
): Set<string> {
  const approved = new Set<string>();
  for (const action of history) {
    if (!approveActions.includes(String(action?.action ?? ""))) continue;
    const step = String(action?.stepName ?? "").trim();
    if (step) approved.add(step);
  }
  return approved;
}

/**
 * The index of the first step the record has not completed, or `steps.length` when it has
 * completed them all.
 */
export function workflowRunPosition(
  history: readonly WorkflowHistoryAction[] = [],
  steps: readonly WorkflowStepLike[] = [],
  approveActions: readonly string[] = WORKFLOW_APPROVE_ACTIONS,
): number {
  const approved = approvedStepNames(history, approveActions);
  for (let index = 0; index < steps.length; index += 1) {
    if (!approved.has(String(steps[index]?.name ?? "").trim())) return index;
  }
  return steps.length;
}
