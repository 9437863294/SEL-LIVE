'use client';

/**
 * A team as a card (2026-11-07, from the user's decisions / actions / teams mockup): a coloured
 * header chosen by the home department, the team's initials, its purpose, its leader, its members
 * and the departments they come from. The register adds what the team has on (meetings, open tasks,
 * open action items) and its buttons; the team window shows the same card as a live preview.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ARCHIVED_TEAM_TONE, teamTone } from '@/lib/office-hub';
import { Avatar, initialsOf } from './meeting-form-parts';

export interface TeamCardMember {
  userId: string;
  name: string;
  departmentName?: string | null;
}

export function TeamCard({
  name,
  description,
  toneKey,
  archived,
  role,
  departmentName,
  leader,
  members,
  departments,
  href,
  usage,
  actions,
  compact,
}: {
  name: string;
  description?: string | null;
  /** The home department's id, else the team's own — keeps a team's colour stable. */
  toneKey: string;
  archived?: boolean;
  role?: 'lead' | 'member' | null;
  departmentName?: string | null;
  leader: { userId: string; name: string; subtitle?: string | null; you?: boolean } | null;
  members: readonly TeamCardMember[];
  departments: readonly string[];
  href?: string;
  usage?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  const [from, to] = archived ? ARCHIVED_TEAM_TONE : teamTone(toneKey);
  const title = name.trim() || 'Team name';

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-[18px] border bg-card transition-[transform,box-shadow]', !compact && 'hover:-translate-y-0.5 hover:shadow-lg', archived && 'opacity-60')}>
      <div
        className={cn('keep-light relative text-white', compact ? 'h-12' : 'h-14')}
        style={{ background: `radial-gradient(200px 90px at 100% 0%, rgb(255 255 255 / 0.25), transparent 70%), linear-gradient(130deg, ${from}, ${to})` }}
      >
        {(role || archived) && (
          <span className="absolute right-3 top-2.5 rounded-full border border-white/40 bg-white/20 px-2 text-[11px] font-extrabold">
            {archived ? 'Archived' : role === 'lead' ? '👑 You lead' : 'Member'}
          </span>
        )}
      </div>
      {/* Positioned, so it paints above the (positioned) header the logo overlaps. */}
      <div className="relative flex flex-1 flex-col px-3.5 pb-3">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className="-mt-6 grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[14px] border-[3px] border-card bg-card text-[15px] font-extrabold shadow-md"
            style={{ color: to }}
          >
            {name.trim() ? initialsOf(name) : 'T'}
          </span>
          <span className="min-w-0 pt-1.5">
            {href ? (
              <Link href={href} className="block truncate text-[15px] font-bold leading-tight hover:underline">
                {title}
              </Link>
            ) : (
              <b className={cn('block truncate text-[15px] leading-tight', !name.trim() && 'text-muted-foreground/60')}>{title}</b>
            )}
            <span className="block truncate text-[11.5px] font-semibold text-muted-foreground">
              {departmentName || 'No department'} · {members.length} member{members.length === 1 ? '' : 's'}
            </span>
          </span>
        </div>

        <p className={cn('my-2 line-clamp-2 text-[12.5px] text-muted-foreground', !compact && 'min-h-[38px]')}>
          {description?.trim() || <span className="text-muted-foreground/60">What this team is for</span>}
        </p>

        {leader && (
          <div className="flex items-center gap-2 border-t py-2 text-xs font-bold">
            <Avatar seed={leader.userId} name={leader.name} size={24} />
            <span className="min-w-0">
              <span className="block truncate">{leader.you ? 'You' : leader.name}</span>
              <small className="block truncate text-[11px] font-semibold text-muted-foreground">
                Team leader{leader.subtitle ? ` · ${leader.subtitle}` : ''}
              </small>
            </span>
          </div>
        )}

        <div className="flex items-center gap-2.5 border-t py-2">
          <span className="flex">
            {members.slice(0, 6).map((member, index) => (
              <Avatar key={member.userId} seed={member.userId} name={member.name} size={24} className={cn('border-2 border-card', index > 0 && '-ml-[7px]')} />
            ))}
            {members.length > 6 && (
              <span className="-ml-[7px] grid h-6 w-6 place-items-center rounded-full border-2 border-card bg-muted text-[9px] font-extrabold text-muted-foreground">
                +{members.length - 6}
              </span>
            )}
          </span>
          <span className="flex-1" />
          <span className="flex min-w-0 flex-wrap justify-end gap-1">
            {departments.slice(0, 3).map((department) => (
              <span key={department} className="max-w-[110px] truncate rounded-md bg-muted px-1.5 text-[10.5px] font-extrabold text-muted-foreground">
                {department}
              </span>
            ))}
            {departments.length > 3 && <span className="text-[10.5px] font-extrabold text-muted-foreground">+{departments.length - 3}</span>}
          </span>
        </div>

        {usage}
        {actions && <div className="mt-auto flex flex-wrap gap-1.5 pt-1">{actions}</div>}
      </div>
    </div>
  );
}

/** Meetings / open tasks / action items, three small figures. `null` = not visible to this viewer. */
export function TeamUsage({ items }: { items: readonly [string, number | null][] }) {
  return (
    <div className="mb-2.5 mt-1.5 grid grid-cols-3 gap-1.5">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-[10px] bg-muted px-2 py-1" title={value === null ? 'Not visible to you' : undefined}>
          <small className="block truncate text-[10px] font-bold text-muted-foreground">{label}</small>
          <b className="text-sm tabular-nums">{value === null ? '—' : value}</b>
        </div>
      ))}
    </div>
  );
}
