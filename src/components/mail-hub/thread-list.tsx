'use client';

import { Link2, Paperclip, Star, StickyNote } from 'lucide-react';

import type { ThreadSummary } from '@/lib/mail-hub/client';
import { displayAddress } from '@/lib/mail-hub/rules';
import { cn } from '@/lib/utils';
import { DeadlineBadge, formatShort } from './ui';

export function ThreadList({
  threads,
  selectedId,
  onSelect,
  showAssignee,
  accountLabel,
}: {
  threads: ThreadSummary[];
  selectedId: string | null;
  onSelect: (thread: ThreadSummary) => void;
  showAssignee?: boolean;
  accountLabel?: (accountId: string) => string | null;
}) {
  return (
    <ul role="listbox" aria-label="Conversations" className="divide-y">
      {threads.map((thread) => {
        const selected = thread.id === selectedId;
        const unread = thread.unreadCount > 0;
        const people = thread.participants.slice(0, 3).map(displayAddress).join(', ');
        const label = accountLabel?.(thread.accountId);
        return (
          <li key={thread.id} role="option" aria-selected={selected}>
            <button
              type="button"
              data-thread-id={thread.id}
              onClick={() => onSelect(thread)}
              className={cn(
                'flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
                selected ? 'bg-indigo-50' : 'hover:bg-slate-50',
              )}
            >
              <div className="flex items-center gap-2">
                {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" aria-label="Unread" />}
                <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-semibold text-slate-900' : 'text-slate-700')}>{people || '(no participants)'}</span>
                {thread.messageCount > 1 && <span className="text-[11px] text-slate-400">{thread.messageCount}</span>}
                <span className={cn('shrink-0 text-[11px]', unread ? 'font-semibold text-slate-700' : 'text-slate-400')}>{formatShort(thread.lastMessageAt)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-medium text-slate-900' : 'text-slate-700')}>{thread.subject || '(no subject)'}</span>
                {thread.isFlagged && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />}
                {thread.hasAttachments && <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Has attachments" />}
                {thread.linkCount > 0 && <Link2 className="h-3.5 w-3.5 shrink-0 text-indigo-400" aria-label="Linked to ERP records" />}
                {thread.noteCount > 0 && <StickyNote className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Has internal notes" />}
              </div>
              <p className="truncate text-xs text-muted-foreground">{thread.snippet}</p>
              {(showAssignee || label || thread.deadline === 'overdue' || thread.deadline === 'due-soon') && (
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  {label && <span className="rounded bg-slate-100 px-1.5 py-0.5">{label}</span>}
                  {showAssignee && <span>{thread.assignment?.assigneeName ?? 'Unassigned'}{thread.assignment?.status === 'closed' ? ' · closed' : thread.assignment?.status === 'pending' ? ' · waiting' : ''}</span>}
                  <DeadlineBadge thread={thread} />
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
