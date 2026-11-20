"use client";

/**
 * A JMC workflow stage — the desk a certificate is sitting on.
 *
 * The screen itself is `WorkflowStageView`, which was written here from the user's
 * `sel-jmc-verification-v2` mock-up and then moved out when MVAC's stages wanted exactly it. What
 * stays with JMC is its vocabulary and its money: a task's figure is formatted here, because only
 * this module knows its number is an amount.
 */

import type { MouseEvent, ReactNode } from "react";
import { formatJmcAmount } from "@/lib/project-management-jmc-dashboard";
import {
  WorkflowStageView,
  type WorkflowStageTab,
  type WorkflowStageTask,
} from "@/components/workflow/workflow-stage-view";

export type JmcStageTab = WorkflowStageTab;

export interface JmcStageTask {
  id: string;
  jmcNo: string;
  /** The JMC date as it should read, already formatted. */
  dateLabel: string;
  amount: number;
  status: string;
  /**
   * What the deadline says, already worded — "Due in 3 days", "2 days overdue". Omitted where the
   * certificate carries no deadline, which is most of the completed ones.
   */
  due?: { label: string; overdue: boolean } | null;
}

export interface JmcStageViewProps {
  back: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
  crumbs?: readonly { label: string; href?: string }[];
  stageName: string;
  /** This stage's place in the configured run, 0-based; -1 if it is not one of the steps. */
  stageIndex: number;
  /** The configured workflow step names, in order. */
  steps: readonly string[];
  projectName: string;
  description: ReactNode;
  pending: readonly JmcStageTask[];
  completed: readonly JmcStageTask[];
  logHref: string;
  createHref?: string;
  onOpen: (task: JmcStageTask) => void;
  /** The page's own buttons for a task — the workflow actions, details. */
  renderActions?: (task: JmcStageTask, tab: JmcStageTab) => ReactNode;
  isLoading?: boolean;
}

/** A certificate as the shared screen reads it, with its amount written out. */
const toStageTask = (task: JmcStageTask): WorkflowStageTask => ({
  id: task.id,
  title: task.jmcNo,
  dateLabel: `JMC date ${task.dateLabel}`,
  figure: formatJmcAmount(task.amount),
  status: task.status,
  due: task.due,
});

export function JmcStageView({
  back,
  crumbs,
  stageName,
  stageIndex,
  steps,
  projectName,
  description,
  pending,
  completed,
  logHref,
  createHref,
  onOpen,
  renderActions,
  isLoading,
}: JmcStageViewProps) {
  // The page's handlers want the JMC task it passed in, not the shared shape, so each one is
  // found by id on the way back out.
  const byId = new Map<string, JmcStageTask>(
    [...pending, ...completed].map((task) => [task.id, task]),
  );

  return (
    <WorkflowStageView
      back={back}
      crumbs={crumbs}
      stageName={stageName}
      stageIndex={stageIndex}
      steps={steps}
      projectName={projectName}
      description={description}
      pending={pending.map(toStageTask)}
      completed={completed.map(toStageTask)}
      recordPlural="JMCs"
      figureLabel="Total amount"
      createStepLabel="Create JMC"
      log={{ href: logHref, label: "JMC Log" }}
      create={createHref ? { href: createHref, label: "Create JMC" } : undefined}
      onOpen={(task) => {
        const original = byId.get(task.id);
        if (original) onOpen(original);
      }}
      renderActions={
        renderActions
          ? (task, tab) => {
              const original = byId.get(task.id);
              return original ? renderActions(original, tab) : null;
            }
          : undefined
      }
      isLoading={isLoading}
    />
  );
}
