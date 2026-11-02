/**
 * Settings › Overview's reading of the company's set-up: a list of checks, each either passing or
 * naming what is missing and the page that fixes it, and the date arithmetic behind the page's
 * holiday and activity figures. Pure (no Firebase, no React), so it runs under node in tests.
 *
 * A check is only made from what the person may see: every source is optional, and a source that
 * is absent (no permission, still loading, failed) leaves its checks out rather than failing them.
 */

export type CheckTone = 'danger' | 'warning' | 'info';

export interface SettingsCheck {
  id: string;
  /** What is checked, worded as it reads when it passes: "Working week saved". */
  label: string;
  /** Absent when the check passes. */
  issue?: { tone: CheckTone; title: string; detail: string };
  /** The page where it is put right. */
  href: string;
  action: string;
}

export interface CheckInput {
  /** "YYYY-MM-DD", in the browser's own day. */
  today: string;
  company?: { gstins: number; pan: boolean; logo: boolean };
  /** Each document series, with the page in its own module where it is set. */
  series?: { id: string; name: string; href: string; configured: boolean; valid: boolean }[];
  workingWeekSaved?: boolean;
  holidayDates?: string[];
  departments?: { active: number; withoutHead: number };
  /** `null`: the copy has never run. */
  reporting?: { status: 'succeeded' | 'failed' | 'stopped' | 'running' } | null;
  themePublished?: boolean;
}

const TONE_ORDER: Record<CheckTone, number> = { danger: 0, warning: 1, info: 2 };

export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString('en-IN')} ${count === 1 ? one : many}`;

export function settingsChecks(input: CheckInput): SettingsCheck[] {
  const checks: SettingsCheck[] = [];
  const year = Number(input.today.slice(0, 4));
  const month = Number(input.today.slice(5, 7));

  // One check per series: each is set on its own module's page, so each issue links to its own.
  for (const row of input.series ?? []) {
    checks.push({
      id: `series:${row.id}`,
      label: `${row.name} numbering set up`,
      href: row.href,
      action: row.configured ? 'Fix' : 'Set up',
      issue: !row.configured
        ? { tone: 'warning', title: `${row.name} numbering not set up`, detail: 'Its document series has never been saved.' }
        : !row.valid
          ? { tone: 'danger', title: `${row.name} cannot make a number`, detail: 'Its date format is not valid, so the next number cannot be composed.' }
          : undefined,
    });
  }

  if (input.workingWeekSaved !== undefined) {
    checks.push({
      id: 'working-week',
      label: 'Working week saved',
      href: '/settings/working-hours',
      action: 'Set up',
      issue: input.workingWeekSaved ? undefined : { tone: 'warning', title: 'No working week saved', detail: 'The working days and hours have never been saved.' },
    });
  }

  if (input.holidayDates) {
    const inYear = (y: number) => input.holidayDates!.filter((date) => date.startsWith(`${y}-`)).length;
    // From November, next year's list is due; before that only this year's is checked.
    const issue = !inYear(year)
      ? { tone: 'warning' as const, title: `No holidays for ${year}`, detail: `The holiday list has nothing dated ${year}.` }
      : month >= 11 && !inYear(year + 1)
        ? { tone: 'warning' as const, title: `${year + 1} holidays not entered`, detail: `Next year starts in ${month === 12 ? 'under a month' : 'two months'}; its holiday list is empty.` }
        : undefined;
    checks.push({ id: 'holidays', label: 'Holiday list up to date', href: '/settings/working-hours', action: 'Add holidays', issue });
  }

  if (input.departments) {
    const { withoutHead } = input.departments;
    checks.push({
      id: 'department-heads',
      label: 'Every department has a head',
      href: '/settings/department',
      action: 'Assign',
      issue: withoutHead
        ? {
            tone: 'warning',
            title: `${plural(withoutHead, 'active department')} without a head`,
            detail: 'Approval steps addressed to the department head have nobody to go to.',
          }
        : undefined,
    });
  }

  if (input.company) {
    const { gstins, pan, logo } = input.company;
    checks.push({
      id: 'company-gst',
      label: 'GST registrations listed',
      href: '/settings/company-profile',
      action: 'Add',
      issue: gstins ? undefined : { tone: 'warning', title: 'No GST registrations', detail: 'Bills and expenses pick their registration from this list.' },
    });
    checks.push({
      id: 'company-pan',
      label: 'Company PAN entered',
      href: '/settings/company-profile',
      action: 'Add',
      issue: pan ? undefined : { tone: 'warning', title: 'No company PAN', detail: 'Company Profile has no PAN.' },
    });
    checks.push({
      id: 'company-logo',
      label: 'Company logo uploaded',
      href: '/settings/company-profile',
      action: 'Upload',
      issue: logo ? undefined : { tone: 'info', title: 'No company logo', detail: 'Letterheads print the company name without a logo.' },
    });
  }

  if (input.themePublished !== undefined) {
    checks.push({
      id: 'theme',
      label: 'Company look published',
      href: '/settings/appearance',
      action: 'Set defaults',
      issue: input.themePublished
        ? undefined
        : { tone: 'info', title: 'Company look never published', detail: 'Everyone sees the built-in theme and home page until a default is set.' },
    });
  }

  if (input.reporting !== undefined) {
    const run = input.reporting;
    checks.push({
      id: 'reporting',
      label: 'Reporting copy refreshing',
      href: '/settings/reporting-database',
      action: 'Review',
      issue: !run
        ? { tone: 'info', title: 'Reporting copy has never run', detail: 'The MongoDB reporting copy is empty until its first refresh.' }
        : run.status === 'failed'
          ? { tone: 'danger', title: 'Reporting copy refresh failed', detail: 'Its last refresh ended in an error; the copy stays as of the last good one.' }
          : run.status === 'stopped'
            ? { tone: 'warning', title: 'Reporting copy refresh was stopped', detail: 'Its last refresh was stopped before it finished.' }
            : undefined,
    });
  }

  return checks;
}

export interface CheckSummary {
  total: number;
  passing: number;
  /** Failing checks, most serious first. */
  issues: SettingsCheck[];
  /** Whole-number share passing; 100 with no checks. */
  score: number;
}

export function summarizeChecks(checks: SettingsCheck[]): CheckSummary {
  const issues = checks.filter((check) => check.issue).sort((a, b) => TONE_ORDER[a.issue!.tone] - TONE_ORDER[b.issue!.tone]);
  const passing = checks.length - issues.length;
  return { total: checks.length, passing, issues, score: checks.length ? Math.round((passing / checks.length) * 100) : 100 };
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────────

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** A "YYYY-MM-DD" as local midnight; `null` when it is not one. */
export function fromIsoDay(iso: string): Date | null {
  const parts = ISO.exec(iso);
  return parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null;
}

/** Whole days from one "YYYY-MM-DD" to another, safe across daylight-saving changes. */
export function daysBetween(from: string, to: string): number {
  const a = fromIsoDay(from);
  const b = fromIsoDay(to);
  if (!a || !b) return Number.NaN;
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}

export interface UpcomingHoliday {
  name: string;
  date: string;
  inDays: number;
}

/** Today's and later holidays, soonest first. */
export function upcomingHolidays(holidays: { name: string; date: string }[], today: string, limit = 4): UpcomingHoliday[] {
  return holidays
    .filter((holiday) => ISO.test(holiday.date) && holiday.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
    .map((holiday) => ({ name: holiday.name, date: holiday.date, inDays: daysBetween(today, holiday.date) }));
}

export const inDaysLabel = (days: number) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);

export interface ActivityDay {
  /** "YYYY-MM-DD". */
  day: string;
  start: Date;
  end: Date;
}

/** The last `count` days ending today, oldest first, each from local midnight to the next. */
export function recentDays(now: Date, count: number): ActivityDay[] {
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (count - 1 - index));
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return { day: isoDay(start), start, end };
  });
}

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "28 Oct" — for a feed of recent changes. */
export function relativeTime(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const then = new Date(time);
  const today = new Date(now);
  const days = daysBetween(isoDay(then), isoDay(today));
  if (days === 0) return `${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return 'Yesterday';
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(then.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}
