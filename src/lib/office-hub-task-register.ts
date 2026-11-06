/**
 * Office Hub — the task register's arithmetic (2026-11-06 redesign, from the user's mockup).
 *
 * Pure and tested: the quick-add line ("Send RA-14 backup @rajesh fri !high #billing"), the due
 * groups the list is sorted into, the relative due labels, the due-date shortcuts, and the tag
 * suggestions drawn from tags people already use.
 */

import { addDays, daysBetween, endOfMonth, weekdayOf, OFFICE_HUB_WEEKDAYS, formatIsoDate, type IsoDate } from './office-hub-time.ts';
import type { OfficeHubPriority, OfficeHubTask } from './office-hub-model.ts';

export interface QuickTask {
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** The @word that matched nobody, so the screen can say so rather than drop it silently. */
  unknownMention: string | null;
  dueDate: IsoDate | null;
  priority: OfficeHubPriority;
  tags: string[];
}

const PRIORITY_WORDS: Record<string, OfficeHubPriority> = {
  low: 'Low',
  medium: 'Medium',
  normal: 'Medium',
  high: 'High',
  urgent: 'Critical',
  critical: 'Critical',
};

const DAY_WORDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The next date (after today) that falls on `weekday`. */
function nextWeekday(today: IsoDate, weekday: number): IsoDate {
  const ahead = (weekday - weekdayOf(today) + 7) % 7 || 7;
  return addDays(today, ahead);
}

/**
 * Read a quick-add line: `@name` assigns (first name, last name or user id prefix), `#tag` tags,
 * `!high` sets priority, and today / tomorrow / next week / a weekday sets the due date. Whatever is
 * left is the title. An @name that matches nobody — or more than one person — is left in the title
 * and reported, never guessed.
 */
export function parseQuickTask(
  text: string,
  context: { today: IsoDate; people: readonly { userId: string; name: string }[]; defaultAssignee?: { userId: string; name: string } | null },
): QuickTask {
  let rest = ` ${text} `;
  const tags: string[] = [];
  rest = rest.replace(/\s#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu, (_, tag: string) => {
    const clean = tag.toLowerCase();
    if (!tags.includes(clean)) tags.push(clean);
    return ' ';
  });

  let priority: OfficeHubPriority = 'Medium';
  rest = rest.replace(/\s!(\w+)\b/g, (match, word: string) => {
    const found = PRIORITY_WORDS[word.toLowerCase()];
    if (!found) return match;
    priority = found;
    return ' ';
  });

  let assigneeId: string | null = context.defaultAssignee?.userId ?? null;
  let assigneeName: string | null = context.defaultAssignee?.name ?? null;
  let unknownMention: string | null = null;
  rest = rest.replace(/\s@([\p{L}\p{N}._-]+)/u, (match, mention: string) => {
    const needle = mention.toLowerCase();
    const matches = context.people.filter((person) =>
      person.name
        .toLowerCase()
        .split(/[\s.]+/)
        .filter(Boolean)
        .some((part) => part === needle),
    );
    if (matches.length === 1) {
      assigneeId = matches[0].userId;
      assigneeName = matches[0].name;
      return ' ';
    }
    unknownMention = mention;
    return match;
  });

  let dueDate: IsoDate | null = null;
  rest = rest.replace(/\s(today|tomorrow|next week|sun|mon|tue|wed|thu|fri|sat)(day|sday|nesday|rsday|urday)?\b/i, (_, word: string) => {
    const key = word.toLowerCase();
    if (key === 'today') dueDate = context.today;
    else if (key === 'tomorrow') dueDate = addDays(context.today, 1);
    else if (key === 'next week') dueDate = addDays(context.today, 7);
    else dueDate = nextWeekday(context.today, DAY_WORDS.indexOf(key.slice(0, 3)));
    return ' ';
  });

  return { title: rest.replace(/\s+/g, ' ').trim(), assigneeId, assigneeName, unknownMention, dueDate, priority, tags };
}

export type DueGroup = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'done';

export const DUE_GROUPS: readonly { value: DueGroup; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'This week' },
  { value: 'later', label: 'Later' },
  { value: 'none', label: 'No due date' },
  { value: 'done', label: 'Completed' },
];

const CLOSED = new Set(['Completed', 'Cancelled']);

/** Which group a task sits in on the list. */
export function dueGroupOf(task: Pick<OfficeHubTask, 'status'> & Partial<Pick<OfficeHubTask, 'dueDate'>>, today: IsoDate): DueGroup {
  if (CLOSED.has(task.status)) return 'done';
  if (!task.dueDate) return 'none';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  return daysBetween(today, task.dueDate) <= 7 ? 'week' : 'later';
}

/** "Today", "Tomorrow", "3 days late", "Friday", "18 Nov". */
export function relativeDue(dueDate: IsoDate | null | undefined, today: IsoDate): string {
  if (!dueDate) return 'No due date';
  const days = daysBetween(today, dueDate);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${-days} days late`;
  if (days < 7) return OFFICE_HUB_WEEKDAYS[weekdayOf(dueDate)].name;
  return formatIsoDate(dueDate, { year: dueDate.slice(0, 4) !== today.slice(0, 4) });
}

/** The due-date shortcuts on the new-task form. */
export function dueQuickPicks(today: IsoDate): { label: string; date: IsoDate | null }[] {
  return [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: OFFICE_HUB_WEEKDAYS[5].short, date: nextWeekday(today, 5) },
    { label: 'Next week', date: addDays(today, 7) },
    { label: 'In 2 weeks', date: addDays(today, 14) },
    { label: 'End of month', date: endOfMonth(today) === today ? endOfMonth(addDays(today, 1)) : endOfMonth(today) },
    { label: 'No due date', date: null },
  ];
}

/** Tags already in use, most used first, minus the ones already chosen. */
export function tagSuggestions(tasks: readonly Pick<OfficeHubTask, 'tags'>[], chosen: readonly string[], limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const tag of task.tags ?? []) {
      const clean = tag.trim().toLowerCase();
      if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }
  }
  const taken = new Set(chosen.map((tag) => tag.toLowerCase()));
  return [...counts]
    .filter(([tag]) => !taken.has(tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}
