/**
 * Global search (§37) and list filtering (§38).
 *
 * Pure. Given records the caller has already fetched, this ranks and groups them; it does not fetch.
 *
 * ── Why search is ranked in the client over a fetched candidate set ─────────────────────────────
 *
 * Firestore has no substring or full-text search. The three ways out of that are a third-party
 * search service, a pre-computed keyword array on every document, or fetching a bounded candidate
 * set and matching in memory. This module is the third, and it is the right trade here because:
 *
 *   • the candidate set is *already* scoped by permission and recency — a user searching sees their
 *     own meetings and tasks, which is hundreds of documents, not millions (§58);
 *   • it needs no infrastructure, no sync job, and cannot drift out of step with the data;
 *   • ranking in memory means "PR-102" can match a reference exactly and beat a fuzzy title match,
 *     which a keyword-array approach cannot express.
 *
 * `officeHubSearchQueries` in the service layer decides what to fetch. This file decides what wins.
 */

import { formatIsoDate, type IsoDate } from './office-hub-time.ts';
import type {
  ActionItemStatus,
  DecisionStatus,
  MeetingMode,
  MeetingStatus,
  OfficeHubActionItem,
  OfficeHubDecision,
  OfficeHubDocument,
  OfficeHubMeeting,
  OfficeHubPerson,
  OfficeHubPriority,
  OfficeHubTask,
  OfficeHubTeam,
  TaskStatus,
} from './office-hub-model.ts';
import { isTaskOverdue, stripMentionMarkup } from './office-hub-rules.ts';

export type SearchResultKind =
  | 'meeting'
  | 'task'
  | 'decision'
  | 'action-item'
  | 'team'
  | 'employee'
  | 'document';

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  /** One line of context: date, owner, status. */
  subtitle: string;
  /** The words that matched, for the highlight. */
  matchedOn: string;
  link: string;
  score: number;
  status?: string | null;
  priority?: OfficeHubPriority | null;
  date?: IsoDate | null;
}

export interface GroupedSearchResults {
  term: string;
  total: number;
  groups: { kind: SearchResultKind; label: string; results: SearchResult[] }[];
}

const GROUP_LABELS: Record<SearchResultKind, string> = {
  meeting: 'Meetings',
  task: 'Tasks',
  decision: 'Decisions',
  'action-item': 'Action items',
  team: 'Teams',
  employee: 'Employees',
  document: 'Documents',
};

/** The order groups appear in, chosen so the things people search for most are nearest the top. */
const GROUP_ORDER: readonly SearchResultKind[] = [
  'meeting',
  'task',
  'decision',
  'action-item',
  'employee',
  'team',
  'document',
];

export const normalizeSearchTerm = (term: string | null | undefined): string =>
  (term ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Search runs from two characters — one character matches everything and helps nobody. */
export const OFFICE_HUB_MIN_SEARCH_LENGTH = 2;

/**
 * How well a haystack matches the search term.
 *
 * The weights encode one judgement: an **exact** match on an identifier is almost certainly what
 * was meant. Somebody typing "PR-102" or "TSK-2627-0041" is not browsing; they have a reference in
 * front of them. So an exact field match scores far above a prefix, which scores above a
 * word-boundary hit, which scores above a bare substring. A title match outranks a body match by
 * the same reasoning — "Finance Review" in the title is a meeting about it, in the notes it is a
 * mention of one.
 *
 * Returns 0 for no match, so callers filter on the score alone.
 */
export function scoreMatch(term: string, fields: readonly { value: string | null | undefined; weight: number }[]): {
  score: number;
  matchedOn: string;
} {
  const needle = normalizeSearchTerm(term);
  if (needle.length < OFFICE_HUB_MIN_SEARCH_LENGTH) return { score: 0, matchedOn: '' };

  let best = 0;
  let matchedOn = '';

  for (const field of fields) {
    const haystack = normalizeSearchTerm(field.value);
    if (!haystack) continue;

    let hit = 0;
    if (haystack === needle) hit = 100;
    else if (haystack.startsWith(needle)) hit = 60;
    else if (new RegExp(`\\b${escapeRegExp(needle)}`).test(haystack)) hit = 40;
    else if (haystack.includes(needle)) hit = 20;
    else {
      // Every word of a multi-word query present somewhere in the field. "bank meeting" should find
      // "Monthly meeting with the bank", which none of the tests above catch.
      const words = needle.split(' ').filter((word) => word.length >= 2);
      if (words.length > 1 && words.every((word) => haystack.includes(word))) hit = 15;
    }

    const weighted = hit * field.weight;
    if (weighted > best) {
      best = weighted;
      matchedOn = String(field.value ?? '');
    }
  }

  return { score: Math.round(best), matchedOn };
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface SearchCorpus {
  meetings?: readonly OfficeHubMeeting[];
  tasks?: readonly OfficeHubTask[];
  decisions?: readonly OfficeHubDecision[];
  actionItems?: readonly OfficeHubActionItem[];
  teams?: readonly OfficeHubTeam[];
  people?: readonly OfficeHubPerson[];
  documents?: readonly OfficeHubDocument[];
  /** Meeting notes, keyed by meeting id, so a search can reach into what was discussed. */
  notesByMeetingId?: Readonly<Record<string, string>>;
}

/** Search everything the caller supplied, grouped by kind (§37). */
export function searchOfficeHub(
  term: string,
  corpus: SearchCorpus,
  options: { limitPerGroup?: number } = {},
): GroupedSearchResults {
  const needle = normalizeSearchTerm(term);
  if (needle.length < OFFICE_HUB_MIN_SEARCH_LENGTH) {
    return { term, total: 0, groups: [] };
  }
  const limit = options.limitPerGroup ?? 6;
  const results: SearchResult[] = [];

  for (const meeting of corpus.meetings ?? []) {
    const { score, matchedOn } = scoreMatch(needle, [
      { value: meeting.title, weight: 1 },
      { value: meeting.meetingType, weight: 0.5 },
      { value: meeting.organizerName, weight: 0.5 },
      { value: meeting.location, weight: 0.4 },
      { value: meeting.description, weight: 0.3 },
      { value: corpus.notesByMeetingId?.[meeting.id], weight: 0.25 },
      { value: (meeting.tags ?? []).join(' '), weight: 0.4 },
    ]);
    if (!score) continue;
    results.push({
      kind: 'meeting',
      id: meeting.id,
      title: meeting.title,
      subtitle: `${formatIsoDate(meeting.date)} · ${meeting.startTime} · ${meeting.organizerName}`,
      matchedOn,
      link: `/office-hub/meetings/${meeting.id}`,
      score,
      status: meeting.status,
      priority: meeting.priority,
      date: meeting.date,
    });
  }

  for (const task of corpus.tasks ?? []) {
    const { score, matchedOn } = scoreMatch(needle, [
      { value: task.reference, weight: 1.2 },
      { value: task.title, weight: 1 },
      { value: task.assigneeName, weight: 0.5 },
      { value: task.teamName, weight: 0.4 },
      { value: task.description, weight: 0.3 },
      { value: (task.tags ?? []).join(' '), weight: 0.4 },
    ]);
    if (!score) continue;
    results.push({
      kind: 'task',
      id: task.id,
      title: task.title,
      subtitle: `${task.reference} · ${task.assigneeName || task.teamName || 'Unassigned'}${
        task.dueDate ? ` · due ${formatIsoDate(task.dueDate)}` : ''
      }`,
      matchedOn,
      link: `/office-hub/tasks/${task.id}`,
      score,
      status: task.status,
      priority: task.priority,
      date: task.dueDate ?? null,
    });
  }

  for (const decision of corpus.decisions ?? []) {
    const { score, matchedOn } = scoreMatch(needle, [
      { value: decision.reference, weight: 1.2 },
      { value: decision.title, weight: 1 },
      { value: decision.ownerName, weight: 0.5 },
      { value: decision.description, weight: 0.3 },
      { value: decision.meetingTitle, weight: 0.4 },
    ]);
    if (!score) continue;
    results.push({
      kind: 'decision',
      id: decision.id,
      title: decision.title,
      subtitle: `${decision.reference} · ${decision.ownerName} · ${formatIsoDate(decision.decisionDate)}`,
      matchedOn,
      link: `/office-hub/decisions/${decision.id}`,
      score,
      status: decision.status,
      priority: decision.priority,
      date: decision.decisionDate,
    });
  }

  for (const item of corpus.actionItems ?? []) {
    const { score, matchedOn } = scoreMatch(needle, [
      { value: item.reference, weight: 1.2 },
      { value: item.title, weight: 1 },
      { value: item.responsibleUserName, weight: 0.5 },
      { value: item.description, weight: 0.3 },
      { value: item.meetingTitle, weight: 0.4 },
    ]);
    if (!score) continue;
    results.push({
      kind: 'action-item',
      id: item.id,
      title: item.title,
      subtitle: `${item.reference} · ${item.responsibleUserName || item.responsibleTeamName || 'Unassigned'}${
        item.meetingTitle ? ` · from ${item.meetingTitle}` : ''
      }`,
      matchedOn,
      link: item.meetingId ? `/office-hub/meetings/${item.meetingId}` : '/office-hub/action-items',
      score,
      status: item.status,
      priority: item.priority,
      date: item.dueDate ?? null,
    });
  }

  for (const team of corpus.teams ?? []) {
    const { score, matchedOn } = scoreMatch(needle, [
      { value: team.name, weight: 1 },
      { value: team.leaderName, weight: 0.5 },
      { value: team.description, weight: 0.3 },
      { value: team.departmentName, weight: 0.4 },
    ]);
    if (!score) continue;
    results.push({
      kind: 'team',
      id: team.id,
      title: team.name,
      subtitle: `${team.memberCount} member${team.memberCount === 1 ? '' : 's'} · led by ${team.leaderName}`,
      matchedOn,
      link: `/office-hub/teams/${team.id}`,
      score,
      status: team.status,
    });
  }

  for (const person of corpus.people ?? []) {
    const { score, matchedOn } = scoreMatch(needle, [
      { value: person.name, weight: 1 },
      { value: person.employeeId, weight: 1.1 },
      { value: person.designation, weight: 0.6 },
      { value: person.email, weight: 0.5 },
      { value: person.departmentName, weight: 0.4 },
    ]);
    if (!score) continue;
    results.push({
      kind: 'employee',
      id: person.userId,
      title: person.name,
      subtitle: [person.designation, person.departmentName].filter(Boolean).join(' · ') || 'Employee',
      matchedOn,
      link: `/office-hub/employees/${person.userId}`,
      score,
    });
  }

  for (const document of corpus.documents ?? []) {
    const { score, matchedOn } = scoreMatch(needle, [
      { value: document.fileName, weight: 1 },
      { value: document.note, weight: 0.4 },
      { value: document.uploadedByName, weight: 0.3 },
    ]);
    if (!score) continue;
    results.push({
      kind: 'document',
      id: document.id,
      title: document.fileName,
      subtitle: `Uploaded by ${document.uploadedByName}`,
      matchedOn,
      link: linkForDocument(document),
      score,
    });
  }

  const groups = GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABELS[kind],
    results: results
      .filter((result) => result.kind === kind)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, limit),
  })).filter((group) => group.results.length > 0);

  return {
    term,
    total: groups.reduce((sum, group) => sum + group.results.length, 0),
    groups,
  };
}

function linkForDocument(document: OfficeHubDocument): string {
  switch (document.entityType) {
    case 'task':
      return `/office-hub/tasks/${document.entityId}`;
    case 'decision':
      return `/office-hub/decisions/${document.entityId}`;
    case 'team':
      return `/office-hub/teams/${document.entityId}`;
    case 'mom':
      return `/office-hub/meetings/${document.entityId}/mom`;
    default:
      return `/office-hub/meetings/${document.meetingId ?? document.entityId}`;
  }
}

/* ── list filters (§38) ──────────────────────────────────────────────────────────────────────── */

export interface MeetingFilters {
  search?: string;
  fromDate?: IsoDate | null;
  toDate?: IsoDate | null;
  departmentIds?: string[];
  teamIds?: string[];
  organizerIds?: string[];
  participantIds?: string[];
  meetingTypes?: string[];
  statuses?: MeetingStatus[];
  priorities?: OfficeHubPriority[];
  modes?: MeetingMode[];
  projectIds?: string[];
  /** Series only, or single meetings only. */
  recurringOnly?: boolean;
}

export const EMPTY_MEETING_FILTERS: MeetingFilters = {};

/**
 * Apply the filters the Firestore query could not.
 *
 * The query already narrowed by scope and date range — those are the indexed, cheap dimensions.
 * What is left is the multi-select dimensions, which Firestore cannot combine without a composite
 * index per permutation. Applying them here keeps the index list finite (§50).
 */
export function applyMeetingFilters(
  meetings: readonly OfficeHubMeeting[],
  filters: MeetingFilters,
  corpus: { notesByMeetingId?: Readonly<Record<string, string>> } = {},
): OfficeHubMeeting[] {
  const term = normalizeSearchTerm(filters.search);

  return meetings.filter((meeting) => {
    if (filters.fromDate && meeting.date < filters.fromDate) return false;
    if (filters.toDate && meeting.date > filters.toDate) return false;
    if (filters.meetingTypes?.length && !filters.meetingTypes.includes(meeting.meetingType)) return false;
    if (filters.statuses?.length && !filters.statuses.includes(meeting.status)) return false;
    if (filters.priorities?.length && !filters.priorities.includes(meeting.priority)) return false;
    if (filters.modes?.length && !filters.modes.includes(meeting.mode)) return false;
    if (filters.organizerIds?.length && !filters.organizerIds.includes(meeting.organizerId)) return false;
    if (filters.projectIds?.length && !filters.projectIds.includes(meeting.projectId ?? '')) return false;

    if (filters.departmentIds?.length) {
      if (!(meeting.departmentIds ?? []).some((id) => filters.departmentIds!.includes(id))) return false;
    }
    if (filters.teamIds?.length) {
      if (!(meeting.teamIds ?? []).some((id) => filters.teamIds!.includes(id))) return false;
    }
    if (filters.participantIds?.length) {
      if (!(meeting.participantUserIds ?? []).some((id) => filters.participantIds!.includes(id))) return false;
    }
    if (filters.recurringOnly != null) {
      const recurring = Boolean(meeting.recurrence && meeting.recurrence.frequency !== 'None');
      if (recurring !== filters.recurringOnly) return false;
    }

    if (term.length >= OFFICE_HUB_MIN_SEARCH_LENGTH) {
      const { score } = scoreMatch(term, [
        { value: meeting.title, weight: 1 },
        { value: meeting.meetingType, weight: 0.5 },
        { value: meeting.organizerName, weight: 0.5 },
        { value: meeting.location, weight: 0.4 },
        { value: meeting.description, weight: 0.3 },
        { value: corpus.notesByMeetingId?.[meeting.id], weight: 0.25 },
      ]);
      if (!score) return false;
    }

    return true;
  });
}

export interface TaskFilters {
  search?: string;
  assigneeIds?: string[];
  teamIds?: string[];
  departmentIds?: string[];
  statuses?: TaskStatus[];
  priorities?: OfficeHubPriority[];
  dueFrom?: IsoDate | null;
  dueTo?: IsoDate | null;
  meetingIds?: string[];
  projectIds?: string[];
  tags?: string[];
  /** Overdue only, when true. */
  overdueOnly?: boolean;
  /** Tasks with no due date at all, when true. */
  undatedOnly?: boolean;
}

export const EMPTY_TASK_FILTERS: TaskFilters = {};

export function applyTaskFilters(
  tasks: readonly OfficeHubTask[],
  filters: TaskFilters,
  today: IsoDate,
): OfficeHubTask[] {
  const term = normalizeSearchTerm(filters.search);

  return tasks.filter((task) => {
    if (filters.assigneeIds?.length && !filters.assigneeIds.includes(task.assigneeId ?? '')) return false;
    if (filters.teamIds?.length && !filters.teamIds.includes(task.teamId ?? '')) return false;
    if (filters.departmentIds?.length && !filters.departmentIds.includes(task.departmentId ?? '')) return false;
    if (filters.statuses?.length && !filters.statuses.includes(task.status)) return false;
    if (filters.priorities?.length && !filters.priorities.includes(task.priority)) return false;
    if (filters.meetingIds?.length && !filters.meetingIds.includes(task.meetingId ?? '')) return false;
    if (filters.projectIds?.length && !filters.projectIds.includes(task.projectId ?? '')) return false;
    if (filters.tags?.length && !(task.tags ?? []).some((tag) => filters.tags!.includes(tag))) return false;

    if (filters.overdueOnly && !isTaskOverdue(task, today)) return false;
    if (filters.undatedOnly && task.dueDate) return false;

    if (filters.dueFrom && (!task.dueDate || task.dueDate < filters.dueFrom)) return false;
    if (filters.dueTo && (!task.dueDate || task.dueDate > filters.dueTo)) return false;

    if (term.length >= OFFICE_HUB_MIN_SEARCH_LENGTH) {
      const { score } = scoreMatch(term, [
        { value: task.reference, weight: 1.2 },
        { value: task.title, weight: 1 },
        { value: task.assigneeName, weight: 0.5 },
        { value: task.teamName, weight: 0.4 },
        { value: task.description, weight: 0.3 },
      ]);
      if (!score) return false;
    }

    return true;
  });
}

export interface DecisionFilters {
  search?: string;
  departmentIds?: string[];
  ownerIds?: string[];
  statuses?: DecisionStatus[];
  priorities?: OfficeHubPriority[];
  fromDate?: IsoDate | null;
  toDate?: IsoDate | null;
  meetingIds?: string[];
  projectIds?: string[];
  overdueOnly?: boolean;
}

export function applyDecisionFilters(
  decisions: readonly OfficeHubDecision[],
  filters: DecisionFilters,
  today: IsoDate,
): OfficeHubDecision[] {
  const term = normalizeSearchTerm(filters.search);

  return decisions.filter((decision) => {
    if (filters.departmentIds?.length && !filters.departmentIds.includes(decision.departmentId ?? '')) return false;
    if (filters.ownerIds?.length && !filters.ownerIds.includes(decision.ownerId)) return false;
    if (filters.statuses?.length && !filters.statuses.includes(decision.status)) return false;
    if (filters.priorities?.length && !filters.priorities.includes(decision.priority)) return false;
    if (filters.meetingIds?.length && !filters.meetingIds.includes(decision.meetingId ?? '')) return false;
    if (filters.projectIds?.length && !filters.projectIds.includes(decision.projectId ?? '')) return false;
    if (filters.fromDate && decision.decisionDate < filters.fromDate) return false;
    if (filters.toDate && decision.decisionDate > filters.toDate) return false;
    if (filters.overdueOnly) {
      const overdue = Boolean(
        decision.dueDate && decision.dueDate < today && (decision.status === 'Open' || decision.status === 'In Progress'),
      );
      if (!overdue) return false;
    }

    if (term.length >= OFFICE_HUB_MIN_SEARCH_LENGTH) {
      const { score } = scoreMatch(term, [
        { value: decision.reference, weight: 1.2 },
        { value: decision.title, weight: 1 },
        { value: decision.ownerName, weight: 0.5 },
        { value: decision.description, weight: 0.3 },
      ]);
      if (!score) return false;
    }

    return true;
  });
}

export interface ActionItemFilters {
  search?: string;
  responsibleIds?: string[];
  teamIds?: string[];
  statuses?: ActionItemStatus[];
  priorities?: OfficeHubPriority[];
  meetingIds?: string[];
  overdueOnly?: boolean;
  withoutTaskOnly?: boolean;
}

export function applyActionItemFilters(
  items: readonly OfficeHubActionItem[],
  filters: ActionItemFilters,
  today: IsoDate,
): OfficeHubActionItem[] {
  const term = normalizeSearchTerm(filters.search);

  return items.filter((item) => {
    if (filters.responsibleIds?.length && !filters.responsibleIds.includes(item.responsibleUserId ?? '')) return false;
    if (filters.teamIds?.length && !filters.teamIds.includes(item.responsibleTeamId ?? '')) return false;
    if (filters.statuses?.length && !filters.statuses.includes(item.status)) return false;
    if (filters.priorities?.length && !filters.priorities.includes(item.priority)) return false;
    if (filters.meetingIds?.length && !filters.meetingIds.includes(item.meetingId ?? '')) return false;
    if (filters.withoutTaskOnly && item.taskId) return false;
    if (filters.overdueOnly) {
      const open = item.status === 'Open' || item.status === 'In Progress';
      if (!(open && item.dueDate && item.dueDate < today)) return false;
    }

    if (term.length >= OFFICE_HUB_MIN_SEARCH_LENGTH) {
      const { score } = scoreMatch(term, [
        { value: item.reference, weight: 1.2 },
        { value: item.title, weight: 1 },
        { value: item.responsibleUserName, weight: 0.5 },
        { value: stripMentionMarkup(item.description), weight: 0.3 },
      ]);
      if (!score) return false;
    }

    return true;
  });
}

/**
 * Whether a filter value counts as set.
 *
 * `false` and the empty array are "not set" rather than "set to nothing": a boolean filter like
 * `overdueOnly` is off by default, and counting it as active would leave every register claiming a
 * filter is applied and offering a Clear button that does nothing.
 */
const isFilterSet = (value: unknown): boolean => {
  if (value == null || value === '' || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

/**
 * Whether any filter is active, for the "clear filters" affordance.
 *
 * Takes `object` rather than `Record<string, unknown>` so the typed filter interfaces —
 * `MeetingFilters`, `TaskFilters`, `DecisionFilters` — can be passed directly. An interface without
 * an index signature is not assignable to a `Record`, and the alternative was every call site
 * spreading its filters into a fresh literal purely to satisfy the parameter type.
 */
export function hasActiveFilters(filters: object): boolean {
  return Object.values(filters).some(isFilterSet);
}

/** How many filters are set, for the badge on the filter button. */
export function activeFilterCount(filters: object): number {
  return Object.values(filters).filter(isFilterSet).length;
}
