/**
 * Office Hub — the decision, action item and team registers' arithmetic (2026-11-07 redesign, from
 * the user's mockup `sel-decisions-actions-teams-redesign.html`).
 *
 * Pure and tested: which tab a decision or an action item belongs to, how the decision register is
 * grouped by month (with overdue follow-ups pinned above), what a follow-up date reads as, how many
 * of a decision's action items are done, how action items group under the meeting that raised them,
 * which of them can become a task without asking anybody anything, and which teams a tile shows.
 */

import { addDays, addMonths, endOfMonth, formatIsoDate, type IsoDate } from './office-hub-time.ts';
import type { DecisionStatus, OfficeHubActionItem, OfficeHubDecision, OfficeHubTeam } from './office-hub-model.ts';
import { isActionItemOverdue, isDecisionOverdue } from './office-hub-rules.ts';
import { relativeDue } from './office-hub-task-register.ts';

const OPEN = new Set<DecisionStatus>(['Open', 'In Progress']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 2026" for `2026-11-07`. */
export function monthHeading(date: IsoDate): string {
  const [year, month] = date.split('-').map(Number);
  return `${MONTHS[month - 1] ?? ''} ${year}`;
}

/* ── decisions ──────────────────────────────────────────────────────────────────────────────── */

export type DecisionTab = 'open' | 'overdue' | 'mine' | 'all';

export const DECISION_TABS: readonly { value: DecisionTab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'mine', label: 'Mine' },
  { value: 'all', label: 'Everything' },
];

type TabDecision = Pick<OfficeHubDecision, 'status' | 'dueDate' | 'ownerId'>;

export function inDecisionTab(decision: TabDecision, tab: DecisionTab, context: { today: IsoDate; viewerId: string }): boolean {
  if (tab === 'open') return OPEN.has(decision.status);
  if (tab === 'overdue') return isDecisionOverdue(decision, context.today);
  if (tab === 'mine') return decision.ownerId === context.viewerId;
  return true;
}

export interface DecisionGroup<D> {
  key: string;
  label: string;
  /** The pinned group of decisions whose follow-up date has passed. */
  overdue: boolean;
  items: D[];
}

/**
 * Newest first, under month headings. With `pinOverdue`, decisions whose follow-up has passed are
 * lifted into one group above the months, oldest follow-up first: a register sorted only by date
 * reads like a history, and what a reader needs first is what has been sitting.
 */
export function groupDecisions<D extends Pick<OfficeHubDecision, 'decisionDate' | 'status' | 'dueDate'> & Partial<Pick<OfficeHubDecision, 'reference'>>>(
  decisions: readonly D[],
  today: IsoDate,
  options: { pinOverdue: boolean },
): DecisionGroup<D>[] {
  const late: D[] = [];
  const rest: D[] = [];
  for (const decision of decisions) (options.pinOverdue && isDecisionOverdue(decision, today) ? late : rest).push(decision);

  const groups: DecisionGroup<D>[] = [];
  if (late.length) {
    late.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || b.decisionDate.localeCompare(a.decisionDate));
    groups.push({ key: 'overdue', label: 'Follow-up overdue', overdue: true, items: late });
  }

  rest.sort((a, b) => b.decisionDate.localeCompare(a.decisionDate) || (b.reference ?? '').localeCompare(a.reference ?? ''));
  for (const decision of rest) {
    const key = decision.decisionDate.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(decision);
    else groups.push({ key, label: monthHeading(decision.decisionDate), overdue: false, items: [decision] });
  }
  return groups;
}

export interface FollowUpLine {
  label: string;
  detail: string | null;
  tone: 'late' | 'today' | 'done' | 'plain' | 'none';
}

/** What a decision's follow-up column says: "3 days late", "Seen through", "No follow-up". */
export function decisionFollowUp(
  decision: Pick<OfficeHubDecision, 'status' | 'dueDate'> & Partial<Pick<OfficeHubDecision, 'closedAt'>>,
  today: IsoDate,
): FollowUpLine {
  if (decision.status === 'Completed') {
    const closed = typeof decision.closedAt === 'string' ? decision.closedAt.slice(0, 10) : null;
    return { label: 'Seen through', detail: closed ? formatIsoDate(closed, { year: closed.slice(0, 4) !== today.slice(0, 4) }) : null, tone: 'done' };
  }
  if (decision.status === 'Cancelled') return { label: 'Cancelled', detail: null, tone: 'none' };
  if (!decision.dueDate) return { label: 'No follow-up', detail: null, tone: 'none' };
  return {
    label: relativeDue(decision.dueDate, today),
    detail: `Follow-up · ${formatIsoDate(decision.dueDate, { withWeekday: true, year: decision.dueDate.slice(0, 4) !== today.slice(0, 4) })}`,
    tone: isDecisionOverdue(decision, today) ? 'late' : decision.dueDate === today ? 'today' : 'plain',
  };
}

/** How many of each decision's action items are done. Cancelled items count for neither side. */
export function actionProgressByDecision(
  items: readonly Pick<OfficeHubActionItem, 'decisionId' | 'status'>[],
): Map<string, { done: number; total: number }> {
  const progress = new Map<string, { done: number; total: number }>();
  for (const item of items) {
    if (!item.decisionId || item.status === 'Cancelled') continue;
    const entry = progress.get(item.decisionId) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (item.status === 'Completed') entry.done += 1;
    progress.set(item.decisionId, entry);
  }
  return progress;
}

/** The follow-up shortcuts on the decision form, counted from the decision date. */
export function followUpPresets(decisionDate: IsoDate): { label: string; date: IsoDate | null }[] {
  const monthEnd = endOfMonth(decisionDate);
  return [
    { label: 'In 1 week', date: addDays(decisionDate, 7) },
    { label: 'In 2 weeks', date: addDays(decisionDate, 14) },
    // On the last day of a month, "end of month" means the next one.
    { label: 'End of month', date: monthEnd === decisionDate ? endOfMonth(addDays(decisionDate, 1)) : monthEnd },
    { label: 'In 3 months', date: addMonths(decisionDate, 3) },
    { label: 'No follow-up', date: null },
  ];
}

/* ── action items ───────────────────────────────────────────────────────────────────────────── */

export type ActionTab = 'open' | 'overdue' | 'untracked' | 'mine' | 'all';

export const ACTION_TABS: readonly { value: ActionTab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'untracked', label: 'Untracked' },
  { value: 'mine', label: 'Mine' },
  { value: 'all', label: 'Everything' },
];

type TabItem = Pick<OfficeHubActionItem, 'status' | 'dueDate' | 'responsibleUserId'> & Partial<Pick<OfficeHubActionItem, 'taskId'>>;

export function inActionTab(item: TabItem, tab: ActionTab, context: { today: IsoDate; viewerId: string }): boolean {
  if (tab === 'open') return OPEN.has(item.status);
  if (tab === 'overdue') return isActionItemOverdue(item, context.today);
  if (tab === 'untracked') return OPEN.has(item.status) && !item.taskId;
  if (tab === 'mine') return item.responsibleUserId === context.viewerId;
  return true;
}

/** Open, not yet a task, and somebody to give the task to — so it can be converted without a form. */
export function canBecomeTask(
  item: Pick<OfficeHubActionItem, 'status'> & Partial<Pick<OfficeHubActionItem, 'taskId' | 'responsibleUserId' | 'responsibleTeamId'>>,
): boolean {
  return OPEN.has(item.status) && !item.taskId && Boolean(item.responsibleUserId || item.responsibleTeamId);
}

export interface MeetingGroup<A> {
  key: string;
  meetingId: string | null;
  title: string;
  date: IsoDate | null;
  done: number;
  items: A[];
}

/**
 * Action items under the meeting that raised them, the latest meeting first and items raised
 * outside a meeting last. Within a meeting: unfinished before finished, then by due date.
 */
export function groupActionItemsByMeeting<
  A extends Pick<OfficeHubActionItem, 'status' | 'dueDate'> & Partial<Pick<OfficeHubActionItem, 'meetingId' | 'meetingTitle' | 'meetingDate'>>,
>(items: readonly A[]): MeetingGroup<A>[] {
  const groups = new Map<string, MeetingGroup<A>>();
  for (const item of items) {
    const key = item.meetingId || 'none';
    const group = groups.get(key) ?? {
      key,
      meetingId: item.meetingId || null,
      title: item.meetingId ? item.meetingTitle || 'Meeting' : 'Not from a meeting',
      date: item.meetingId ? item.meetingDate ?? null : null,
      done: 0,
      items: [],
    };
    group.items.push(item);
    if (item.status === 'Completed') group.done += 1;
    groups.set(key, group);
  }

  const finished = (item: A) => (OPEN.has(item.status) ? 0 : 1);
  for (const group of groups.values()) {
    group.items.sort((a, b) => finished(a) - finished(b) || (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'));
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.meetingId !== !b.meetingId) return a.meetingId ? -1 : 1;
    return (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title);
  });
}

/* ── teams ──────────────────────────────────────────────────────────────────────────────────── */

export type TeamView = 'all' | 'member' | 'lead' | 'archived';

type ViewTeam = Pick<OfficeHubTeam, 'name' | 'leaderId' | 'leaderName' | 'status'> &
  Partial<Pick<OfficeHubTeam, 'memberUserIds' | 'description' | 'departmentName' | 'members'>>;

export function teamsInView<T extends ViewTeam>(
  teams: readonly T[],
  view: TeamView,
  context: { viewerId: string; showArchived: boolean; search: string },
): T[] {
  const needle = context.search.trim().toLowerCase();
  return teams.filter((team) => {
    const archived = team.status === 'Archived';
    if (view === 'archived' ? !archived : archived && !context.showArchived) return false;
    if (view === 'member' && !(team.memberUserIds ?? []).includes(context.viewerId)) return false;
    if (view === 'lead' && team.leaderId !== context.viewerId) return false;
    if (!needle) return true;
    const haystack = [team.name, team.leaderName, team.description, team.departmentName, ...(team.members ?? []).map((member) => member.name)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/** The departments a team's members come from, the most represented first. */
export function teamDepartments(team: Pick<OfficeHubTeam, 'members'>): string[] {
  const counts = new Map<string, number>();
  for (const member of team.members ?? []) {
    if (member.departmentName) counts.set(member.departmentName, (counts.get(member.departmentName) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

/** The team card's header colours: cyan, emerald, rose, violet, amber — chosen by department. */
export const TEAM_TONES: readonly [string, string][] = [
  ['#67e8f9', '#0e7490'],
  ['#6ee7b7', '#047857'],
  ['#fda4af', '#be123c'],
  ['#c4b5fd', '#6d28d9'],
  ['#fcd34d', '#b45309'],
];

export const ARCHIVED_TEAM_TONE: [string, string] = ['#cbd5e1', '#64748b'];

/** A stable tone for a key (the home department, else the team itself), so a team keeps its colour. */
export function teamTone(key: string): [string, string] {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) | 0;
  return TEAM_TONES[Math.abs(hash) % TEAM_TONES.length];
}
