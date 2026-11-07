'use client';

/**
 * A grid of people to pick from: one (a decision's owner) or many (a team's members). From the
 * user's decisions / actions / teams mockup (2026-11-07). The viewer comes first and the picked
 * people next, so the likely choices need no scrolling; the list stops at `limit` and says so.
 */

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OfficeHubPerson } from '@/lib/office-hub';
import { Avatar } from './meeting-form-parts';

export function PeopleGrid({
  people,
  picked,
  onPick,
  viewerId,
  leaderId,
  multiple = false,
  label,
  limit = 60,
  className,
}: {
  people: readonly OfficeHubPerson[];
  picked: readonly string[];
  onPick: (userId: string) => void;
  viewerId: string;
  /** Marks the team leader with a LEAD tag. */
  leaderId?: string | null;
  multiple?: boolean;
  label: string;
  limit?: number;
  className?: string;
}) {
  const chosen = new Set(picked);
  const ordered = [...people].sort(
    (a, b) =>
      Number(b.userId === viewerId) - Number(a.userId === viewerId) ||
      Number(chosen.has(b.userId)) - Number(chosen.has(a.userId)) ||
      a.name.localeCompare(b.name),
  );
  const shown = ordered.slice(0, limit);

  return (
    <div>
      <div role={multiple ? 'group' : 'radiogroup'} aria-label={label} className={cn('grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto p-0.5 pt-2 sm:grid-cols-2', className)}>
        {shown.map((person) => {
          const on = chosen.has(person.userId);
          const lead = leaderId === person.userId;
          return (
            <button
              key={person.userId}
              type="button"
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={on}
              onClick={() => onPick(person.userId)}
              className={cn(
                'relative flex min-w-0 items-center gap-2 rounded-[11px] border px-2 py-1.5 text-left transition-colors',
                on ? 'border-primary bg-primary/5' : 'bg-card hover:border-primary/40',
              )}
            >
              {lead && (
                <span className="absolute -top-2 left-6 rounded-md bg-amber-500 px-1 text-[9px] font-extrabold text-white">LEAD</span>
              )}
              <Avatar seed={person.userId} name={person.name} size={24} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-xs leading-tight">
                  {person.name}
                  {person.userId === viewerId ? ' (you)' : ''}
                </b>
                <span className="block truncate text-[10.5px] font-semibold text-muted-foreground">
                  {[person.designation, person.departmentName].filter(Boolean).join(' · ') || 'No department'}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  'grid h-[18px] w-[18px] shrink-0 place-items-center border-2',
                  multiple ? 'rounded-md' : 'rounded-full',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-transparent',
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3.2} />
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="col-span-full py-3 text-center text-xs text-muted-foreground">Nobody matches.</p>}
      </div>
      {ordered.length > shown.length && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Showing {shown.length} of {ordered.length}. Search to narrow the list.
        </p>
      )}
    </div>
  );
}
