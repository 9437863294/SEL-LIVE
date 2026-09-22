'use client';

/**
 * Project Management's seven approval workflows, as dashboard sources.
 *
 * Split out from `work-dashboard-sources.ts` because these seven are the only ones that are not a
 * single query against a top-level collection, and the three things that makes them need doing once
 * rather than seven times:
 *
 *   1. **They live in subcollections.** Every one is `projects/{projectId}/{entries}`, so "pending
 *      with me across every project" is a `collectionGroup` query. Those are not covered by
 *      Firestore's automatic single-field indexes at collection-group scope, which is why each of
 *      the seven `assignees` fields has a `COLLECTION_GROUP` / `CONTAINS` entry under
 *      `fieldOverrides` in `firestore.indexes.json`. One was already there for `jmcEntries`; the
 *      other six are added by this feature.
 *
 *   2. **Their routes need a mapping id, not a project id.** The stage screens resolve
 *      `?project={mappingId}` against `projectManagementProjects` to reach the global project — see
 *      `useProjectManagementIndentContext`. The approval records carry `mappingId` themselves, but
 *      indents, survey entries and JMC entries do not, so those are recovered from the document's
 *      parent project id through a reverse index built once per load.
 *
 *   3. **Their routes need a step id, but the records store a step index.** `/…/stage/[stageId]`
 *      matches on `WorkflowStep.id`, while six of the seven track position as `currentStepIndex`.
 *      Resolving one to the other means reading the workflow document, so those reads are shared
 *      and cached here too. JMC is the exception — it stores `currentStepId` directly.
 *
 * A row whose mapping id or step id cannot be resolved still links somewhere useful: the module's
 * own front page. A dashboard row that goes nowhere would be worse than one that goes one click
 * short of the work.
 */

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { ACTIVITY_MODULES } from './activity-modules';
import type { WorkflowStep } from './types';
import { toWorkDate, type WorkItem, type WorkKind, type WorkLane } from './work-dashboard';
import type { WorkContext, WorkSource } from './work-dashboard-sources';
import { PM_PROJECT_COLLECTION } from './project-management-projects';

import {
  DEFAULT_INDENT_STEPS,
  INDENT_BASE_PATH,
  INDENT_COLLECTION,
  INDENT_PERMISSION_RESOURCE,
  INDENT_WORKFLOW_DOC_ID,
} from './project-management-indent-workflow';
import {
  DEFAULT_PO_ISSUE_STEPS,
  PO_BASE_PATH,
  PO_ISSUE_APPROVAL_COLLECTION,
  PO_ISSUE_WORKFLOW_DOC_ID,
  PO_PERMISSION_RESOURCE,
  isTerminalPoIssueStatus,
} from './project-management-po-workflow';
import {
  DEFAULT_MC_CLEARANCE_STEPS,
  MC_BASE_PATH,
  MC_CLEARANCE_APPROVAL_COLLECTION,
  MC_CLEARANCE_WORKFLOW_DOC_ID,
  MC_PERMISSION_RESOURCE,
  isTerminalMcApprovalStatus,
} from './project-management-mc-workflow';
import {
  DEFAULT_RFQ_AWARD_STEPS,
  RFQ_AWARD_APPROVAL_COLLECTION,
  RFQ_AWARD_WORKFLOW_DOC_ID,
  RFQ_BASE_PATH,
  RFQ_PERMISSION_RESOURCE,
  isTerminalRfqAwardStatus,
} from './project-management-rfq-workflow';
import {
  DEFAULT_INSPECTION_RESULT_STEPS,
  INSPECTION_BASE_PATH,
  INSPECTION_PERMISSION_RESOURCE,
  INSPECTION_RESULT_APPROVAL_COLLECTION,
  INSPECTION_RESULT_WORKFLOW_DOC_ID,
  isTerminalInspectionApprovalStatus,
} from './project-management-inspection-workflow';
import {
  DEFAULT_SURVEY_STEPS,
  SURVEY_BASE_PATH,
  SURVEY_ENTRY_COLLECTION,
  SURVEY_OPEN_STATUSES,
  SURVEY_PERMISSION_RESOURCE,
  SURVEY_WORKFLOW_DOC_ID,
} from './project-management-survey-workflow';
import { PM_JMC_BASE_PATH } from './jmc-module';

/** Rows per workflow. Seven of these run together, so the cap is tighter than the general one. */
const CAP = 50;

/* ── shared lookups ────────────────────────────────────────────────────────────────────────────── */

/**
 * Lookups are cached for a minute.
 *
 * Seven sources run concurrently on every refresh and six of them want the project mapping. Without
 * this, opening the dashboard would read `projectManagementProjects` six times over. A minute is
 * short enough that adding a project and refreshing shows it, and long enough that the refresh
 * button is not a way to hammer the collection.
 */
const LOOKUP_TTL_MS = 60_000;

interface CachedLookup<T> {
  at: number;
  value: Promise<T>;
}

let projectMapCache: CachedLookup<Map<string, string>> | null = null;
const stepCache = new Map<string, CachedLookup<WorkflowStep[]>>();

/** `globalProjectId` → the `projectManagementProjects` document id the routes expect. */
function loadProjectMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (projectMapCache && now - projectMapCache.at < LOOKUP_TTL_MS) return projectMapCache.value;

  const value = (async () => {
    const map = new Map<string, string>();
    try {
      const snapshot = await getDocs(query(collection(db, PM_PROJECT_COLLECTION), fsLimit(500)));
      for (const entry of snapshot.docs) {
        const globalProjectId = String(entry.data().globalProjectId ?? '');
        if (globalProjectId) map.set(globalProjectId, entry.id);
      }
    } catch {
      // An unreadable mapping collection costs the rows their `?project=` parameter, nothing more.
    }
    return map;
  })();

  projectMapCache = { at: now, value };
  return value;
}

/** A workflow's configured steps, falling back to the module's defaults when unconfigured. */
function loadSteps(workflowDocId: string, fallback: WorkflowStep[]): Promise<WorkflowStep[]> {
  const now = Date.now();
  const cached = stepCache.get(workflowDocId);
  if (cached && now - cached.at < LOOKUP_TTL_MS) return cached.value;

  const value = (async () => {
    try {
      const snapshot = await getDoc(doc(db, 'workflows', workflowDocId));
      const steps = snapshot.exists() ? (snapshot.data()?.steps as WorkflowStep[] | undefined) : undefined;
      return Array.isArray(steps) && steps.length ? steps : fallback;
    } catch {
      return fallback;
    }
  })();

  stepCache.set(workflowDocId, { at: now, value });
  return value;
}

/** Clears the cached lookups, so the dashboard's Refresh really refetches. */
export function resetProjectWorkLookups(): void {
  projectMapCache = null;
  stepCache.clear();
}

/* ── the builder ───────────────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

const text = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
};

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

interface ProjectWorkflowConfig {
  id: string;
  label: string;
  /** The subcollection under `projects/{projectId}`. */
  subcollection: string;
  basePath: string;
  permissionResource: string;
  workflowDocId: string;
  defaultSteps: WorkflowStep[];
  /** Whether a row is still somebody's problem. Takes the whole row: indents also test enrolment. */
  isOpen: (row: Row) => boolean;
  /** How the row names itself on the dashboard. */
  describe: (row: Row) => { title: string; reference: string | null };
  /**
   * JMC stores `currentStepId`; the other six store `currentStepIndex` and need the workflow's step
   * list to turn it into the id the stage route matches on.
   */
  stepId: (row: Row, steps: WorkflowStep[]) => string;
}

function projectWorkflowSource(config: ProjectWorkflowConfig): WorkSource {
  return {
    id: config.id,
    module: ACTIVITY_MODULES.PROJECT_MANAGEMENT,
    label: config.label,
    lane: 'action',
    // The nested resource, not just the module: somebody who can see Project Management but not its
    // RFQ screens should not be handed RFQ rows they cannot open.
    visible: (context: WorkContext) =>
      context.can('View', config.permissionResource) || context.can('View Module', 'Project Management'),
    load: async (context: WorkContext): Promise<WorkItem[]> => {
      const built = query(
        collectionGroup(db, config.subcollection),
        where('assignees', 'array-contains', context.userId),
        fsLimit(CAP),
      );
      const snapshot = await getDocs(built);
      if (snapshot.empty) return [];

      const [projectMap, steps] = await Promise.all([
        loadProjectMap(),
        loadSteps(config.workflowDocId, config.defaultSteps),
      ]);

      return snapshot.docs
        .map((entry: QueryDocumentSnapshot<DocumentData>) => ({
          docId: entry.id,
          row: entry.data() as Row,
          // `projects/{projectId}/{subcollection}/{docId}` — the grandparent is the project.
          projectId: entry.ref.parent.parent?.id ?? '',
        }))
        .filter(({ row }) => row.isDeleted !== true && config.isOpen(row))
        .map(({ docId, row, projectId }) => {
          const described = config.describe(row);
          const mappingId = text(row.mappingId) || projectMap.get(projectId) || '';
          const stepId = config.stepId(row, steps);
          const href =
            mappingId && stepId
              ? `${config.basePath}/stage/${encodeURIComponent(stepId)}?project=${encodeURIComponent(mappingId)}`
              : mappingId
                ? `${config.basePath}?project=${encodeURIComponent(mappingId)}`
                : config.basePath;

          return {
            id: `${config.id}:${docId}`,
            sourceId: config.id,
            kind: 'approval' as WorkKind,
            module: ACTIVITY_MODULES.PROJECT_MANAGEMENT,
            lane: 'action' as WorkLane,
            title: described.title,
            reference: described.reference,
            stage: text(row.currentStepName) || text(row.stage) || null,
            href,
            dueAt: toWorkDate(row.deadline),
            amount: num(row.totalAmount) ?? num(row.amount),
            raisedBy: text(row.requestedByName) || text(row.surveyedByName) || null,
          };
        });
    },
  };
}

/** Turn a stored step index into the step id the `/stage/[stageId]` route matches on. */
const stepIdFromIndex = (row: Row, steps: WorkflowStep[]): string => {
  const index = typeof row.currentStepIndex === 'number' ? row.currentStepIndex : -1;
  if (index < 0 || index >= steps.length) return '';
  return String(steps[index]?.id ?? '');
};

/* ── the seven ─────────────────────────────────────────────────────────────────────────────────── */

export const PROJECT_WORK_SOURCES: WorkSource[] = [
  projectWorkflowSource({
    id: 'pm-indents',
    label: 'Indents at your approval stage',
    subcollection: INDENT_COLLECTION,
    basePath: INDENT_BASE_PATH,
    permissionResource: INDENT_PERMISSION_RESOURCE,
    workflowDocId: INDENT_WORKFLOW_DOC_ID,
    defaultSteps: DEFAULT_INDENT_STEPS,
    // `workflowEnrolled` is what separates indents raised after the workflow shipped from the legacy
    // ones, which are grandfathered as approved — see the note on `IndentWorkflowFields`. Without
    // this test the dashboard would present every pre-workflow indent as a surprise backlog.
    isOpen: (row) => row.workflowEnrolled === true && text(row.status) === 'Submitted',
    describe: (row) => ({
      title: `Indent — ${text(row.description) || text(row.itemName, 'material')}`,
      reference: text(row.indentNo) || text(row.indentNumber) || null,
    }),
    stepId: stepIdFromIndex,
  }),
  projectWorkflowSource({
    id: 'pm-po-issues',
    label: 'Purchase orders awaiting your approval',
    subcollection: PO_ISSUE_APPROVAL_COLLECTION,
    basePath: PO_BASE_PATH,
    permissionResource: PO_PERMISSION_RESOURCE,
    workflowDocId: PO_ISSUE_WORKFLOW_DOC_ID,
    defaultSteps: DEFAULT_PO_ISSUE_STEPS,
    isOpen: (row) => !isTerminalPoIssueStatus(text(row.status) as never),
    describe: (row) => ({
      title: `PO issue — ${text(row.vendorName, 'vendor')}`,
      reference: text(row.poNumber) || null,
    }),
    stepId: stepIdFromIndex,
  }),
  projectWorkflowSource({
    id: 'pm-mc-clearances',
    label: 'Manufacturing clearances awaiting your approval',
    subcollection: MC_CLEARANCE_APPROVAL_COLLECTION,
    basePath: MC_BASE_PATH,
    permissionResource: MC_PERMISSION_RESOURCE,
    workflowDocId: MC_CLEARANCE_WORKFLOW_DOC_ID,
    defaultSteps: DEFAULT_MC_CLEARANCE_STEPS,
    isOpen: (row) => !isTerminalMcApprovalStatus(text(row.status) as never),
    describe: (row) => ({
      title: `MC — ${text(row.description) || text(row.boqSlNo, 'BOQ item')}`,
      reference: text(row.poNumber) || null,
    }),
    stepId: stepIdFromIndex,
  }),
  projectWorkflowSource({
    id: 'pm-rfq-awards',
    label: 'RFQ awards awaiting your approval',
    subcollection: RFQ_AWARD_APPROVAL_COLLECTION,
    basePath: RFQ_BASE_PATH,
    permissionResource: RFQ_PERMISSION_RESOURCE,
    workflowDocId: RFQ_AWARD_WORKFLOW_DOC_ID,
    defaultSteps: DEFAULT_RFQ_AWARD_STEPS,
    isOpen: (row) => !isTerminalRfqAwardStatus(text(row.status) as never),
    describe: (row) => ({
      title: `RFQ award — ${text(row.vendorName, 'vendor')}`,
      reference: text(row.rfqNumber) || text(row.rfqNo) || null,
    }),
    stepId: stepIdFromIndex,
  }),
  projectWorkflowSource({
    id: 'pm-inspections',
    label: 'Inspection results awaiting your approval',
    subcollection: INSPECTION_RESULT_APPROVAL_COLLECTION,
    basePath: INSPECTION_BASE_PATH,
    permissionResource: INSPECTION_PERMISSION_RESOURCE,
    workflowDocId: INSPECTION_RESULT_WORKFLOW_DOC_ID,
    defaultSteps: DEFAULT_INSPECTION_RESULT_STEPS,
    isOpen: (row) => !isTerminalInspectionApprovalStatus(text(row.status) as never),
    describe: (row) => ({
      title: `Inspection — ${text(row.description) || text(row.vendorName, 'item')}`,
      reference: text(row.callNumber) || text(row.poNumber) || null,
    }),
    stepId: stepIdFromIndex,
  }),
  projectWorkflowSource({
    id: 'pm-survey-entries',
    label: 'Survey entries at your review stage',
    subcollection: SURVEY_ENTRY_COLLECTION,
    basePath: SURVEY_BASE_PATH,
    permissionResource: SURVEY_PERMISSION_RESOURCE,
    workflowDocId: SURVEY_WORKFLOW_DOC_ID,
    defaultSteps: DEFAULT_SURVEY_STEPS,
    isOpen: (row) => (SURVEY_OPEN_STATUSES as string[]).includes(text(row.status)),
    describe: (row) => ({
      title: `Survey — ${text(row.description, 'BOQ item')}`,
      reference: text(row.boqSlNo) || null,
    }),
    stepId: stepIdFromIndex,
  }),
  projectWorkflowSource({
    id: 'pm-jmc-entries',
    label: 'JMC entries at your stage',
    subcollection: 'jmcEntries',
    basePath: PM_JMC_BASE_PATH,
    permissionResource: 'Project Management.JMC',
    // JMC tracks `currentStepId` directly, so it needs no workflow document. The id and defaults
    // below are never read — the builder takes them unconditionally and `stepId` ignores them.
    workflowDocId: 'jmc-workflow',
    defaultSteps: [],
    isOpen: (row) => ['Pending', 'In Progress', 'Needs Review'].includes(text(row.status)),
    describe: (row) => ({
      title: `JMC — ${text(row.woNo, 'work order')}`,
      reference: text(row.jmcNo) || null,
    }),
    stepId: (row) => text(row.currentStepId),
  }),
];
