'use client';

/**
 * One conversation: the messages (newest expanded), the actions the mailbox supports, and the ERP
 * panels beside them. On a phone the panels stack under the messages.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  Forward,
  FolderInput,
  Loader2,
  MailOpen,
  MoreHorizontal,
  Reply,
  ReplyAll,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { mailApi, type MessageItem, type ThreadDetail } from '@/lib/mail-hub/client';
import type { MailMailboxMember } from '@/lib/mail-hub/model';
import { displayAddress, formatAddress, plainTextToHtml } from '@/lib/mail-hub/rules';
import { cn } from '@/lib/utils';
import { AssignmentPanel, FollowUpsPanel, LinksPanel, NotesPanel } from './erp-panels';
import { useMailHub } from './hooks';
import { MessageBody } from './message-body';
import { ErrorNotice, Spinner, formatLong } from './ui';

export interface ConversationHandle {
  reply: () => void;
  replyAll: () => void;
  forward: () => void;
  archive: () => void;
  trash: () => void;
  toggleRead: () => void;
  toggleStar: () => void;
}

function Header({ message, expanded, onToggle }: { message: MessageItem; expanded: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 text-left" aria-expanded={expanded}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-xs font-semibold text-indigo-700">
        {displayAddress(message.from).slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-sm', !message.isRead ? 'font-semibold' : 'font-medium')}>{displayAddress(message.from)}</span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">{message.from?.address}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatLong(message.receivedAt)}</span>
        </div>
        {expanded ? (
          <p className="truncate text-xs text-muted-foreground">
            to {message.to.map(formatAddress).join(', ') || '—'}
            {message.cc.length > 0 && <> · cc {message.cc.map(formatAddress).join(', ')}</>}
            {message.bcc.length > 0 && <> · bcc {message.bcc.map(formatAddress).join(', ')}</>}
          </p>
        ) : (
          <p className="truncate text-xs text-muted-foreground">{message.snippet}</p>
        )}
      </div>
    </button>
  );
}

export function Conversation({
  threadId,
  onBack,
  onChanged,
  registerHandle,
}: {
  threadId: string;
  onBack?: () => void;
  onChanged: () => void;
  registerHandle?: (handle: ConversationHandle | null) => void;
}) {
  const { toast } = useToast();
  const { data, openComposer } = useMailHub();
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<MailMailboxMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<{ kind: 'summary' | 'reply'; text: string } | null>(null);
  const [aiLoading, setAiLoading] = useState<'summary' | 'reply' | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await mailApi.thread(threadId);
      setDetail(next);
      setError(null);
      setExpanded((current) => (current.size ? current : new Set(next.messages.slice(-1).map((message) => message.id))));
      if (next.sharedMailbox) mailApi.members(next.sharedMailbox.id).then((result) => setMembers(result.members)).catch(() => setMembers([]));
      // Opening marks it read, as every mail client does — unless the reader cannot change state.
      if (next.thread.unreadCount > 0 && next.access.canModify) {
        mailApi.action({ threadId, action: { type: 'markRead', value: true } }).then(onChanged).catch(() => {});
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The conversation could not be loaded.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    setDetail(null);
    setExpanded(new Set());
    setAi(null);
    void load();
  }, [load]);

  const latest = detail?.messages[detail.messages.length - 1] ?? null;
  const caps = detail?.account.capabilities;
  const inTrash = Boolean(detail && data?.folders[detail.account.id]?.some((folder) => folder.role === 'trash' && latest?.folderIds.includes(folder.id)));

  const act = useCallback(
    async (action: { type: string; value?: boolean; folderId?: string }, message?: string) => {
      if (!detail) return;
      setBusy(true);
      try {
        const result = await mailApi.action({ threadId: detail.thread.id, action });
        if (result.failed.length) toast({ variant: 'destructive', title: `${result.failed.length} message(s) could not be changed` });
        else if (message) toast({ title: message });
        onChanged();
        if (['archive', 'trash', 'move', 'delete', 'untrash'].includes(action.type)) onBack?.();
        else void load();
      } catch (caught) {
        toast({ variant: 'destructive', title: 'That did not work', description: caught instanceof Error ? caught.message : undefined });
      } finally {
        setBusy(false);
      }
    },
    [detail, load, onBack, onChanged, toast],
  );

  const compose = useCallback(
    (mode: 'reply' | 'replyAll' | 'forward', bodyHtml?: string, aiAssisted?: boolean) => {
      if (!detail || !latest) return;
      if (!detail.access.canSend) {
        toast({ variant: 'destructive', title: 'You cannot send from this mailbox', description: detail.sharedMailbox ? 'Sending from a shared mailbox needs the Send permission, send rights on your membership, and a verified provider grant.' : 'Your account needs the Compose › Send permission and an active connection.' });
        return;
      }
      openComposer({ mode, accountId: detail.account.id, sourceMessageId: latest.id, bodyHtml, aiAssisted });
    },
    [detail, latest, openComposer, toast],
  );

  useEffect(() => {
    if (!registerHandle) return;
    registerHandle(
      detail
        ? {
            reply: () => compose('reply'),
            replyAll: () => compose('replyAll'),
            forward: () => compose('forward'),
            archive: () => caps?.archive && detail.access.canModify && void act({ type: 'archive' }, 'Archived'),
            trash: () => detail.access.canModify && void act({ type: 'trash' }, 'Moved to Trash'),
            toggleRead: () => detail.access.canModify && void act({ type: 'markRead', value: false }, 'Marked unread'),
            toggleStar: () => detail.access.canModify && void act({ type: 'flag', value: !detail.thread.isFlagged }),
          }
        : null,
    );
    return () => registerHandle(null);
  }, [registerHandle, detail, caps, act, compose]);

  const suggest = async (kind: 'summary' | 'reply') => {
    if (!detail) return;
    setAiLoading(kind);
    try {
      const result = await mailApi.ai(detail.thread.id, kind);
      setAi({ kind, text: result.text });
    } catch (caught) {
      toast({ variant: 'destructive', title: 'No suggestion', description: caught instanceof Error ? caught.message : undefined });
    } finally {
      setAiLoading(null);
    }
  };

  if (error) return <div className="p-4"><ErrorNotice message={error} onRetry={load} /></div>;
  if (!detail) return <div className="p-4"><Spinner label="Opening conversation…" /></div>;

  const folders = (data?.folders[detail.account.id] ?? []).filter((folder) => ['inbox', 'archive', 'custom', 'spam'].includes(folder.role));
  const aiAvailable = Boolean(data?.capabilities.canUseAi && data.settings.aiOptIn);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b bg-white/95 px-2 py-1.5 backdrop-blur">
        {onBack && (
          <Button size="icon" variant="ghost" className="h-9 w-9 lg:hidden" onClick={onBack} aria-label="Back to list">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        <TooltipProvider delayDuration={300}>
          {[
            { key: 'reply', icon: Reply, label: 'Reply (r)', onClick: () => compose('reply'), show: true },
            { key: 'replyAll', icon: ReplyAll, label: 'Reply all (a)', onClick: () => compose('replyAll'), show: true },
            { key: 'forward', icon: Forward, label: 'Forward (f)', onClick: () => compose('forward'), show: true },
            { key: 'archive', icon: Archive, label: 'Archive (e)', onClick: () => act({ type: 'archive' }, 'Archived'), show: Boolean(caps?.archive && detail.access.canModify && !inTrash) },
            { key: 'restore', icon: ArchiveRestore, label: 'Restore to inbox', onClick: () => act({ type: 'untrash' }, 'Restored'), show: inTrash && detail.access.canModify },
            { key: 'trash', icon: Trash2, label: 'Move to Trash (#)', onClick: () => act({ type: 'trash' }, 'Moved to Trash'), show: detail.access.canModify && !inTrash },
            { key: 'unread', icon: MailOpen, label: 'Mark unread (u)', onClick: () => act({ type: 'markRead', value: false }, 'Marked unread'), show: detail.access.canModify },
            { key: 'star', icon: Star, label: detail.thread.isFlagged ? 'Unstar (s)' : 'Star (s)', onClick: () => act({ type: 'flag', value: !detail.thread.isFlagged }), show: Boolean(caps?.flag && detail.access.canModify) },
          ]
            .filter((entry) => entry.show)
            .map((entry) => (
              <Tooltip key={entry.key}>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={entry.onClick} disabled={busy} aria-label={entry.label}>
                    <entry.icon className={cn('h-4 w-4', entry.key === 'star' && detail.thread.isFlagged && 'fill-amber-400 text-amber-500')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{entry.label}</TooltipContent>
              </Tooltip>
            ))}
        </TooltipProvider>
        {caps?.move && detail.access.canModify && folders.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Move to folder"><FolderInput className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              <DropdownMenuLabel>{caps.labels ? 'Label and move' : 'Move to'}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {folders.map((folder) => (
                <DropdownMenuItem key={folder.id} onClick={() => act({ type: 'move', folderId: folder.id }, `Moved to ${folder.name}`)}>{folder.name}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {aiAvailable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-9 gap-1.5" disabled={Boolean(aiLoading)}>
                {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-violet-600" />} AI
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => suggest('summary')}>Summarise this conversation</DropdownMenuItem>
              <DropdownMenuItem onClick={() => suggest('reply')}>Suggest a reply</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {detail.account.capabilities.permanentDelete && inTrash && detail.access.canModify && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="More"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem className="text-rose-700" onClick={() => { if (window.confirm('Delete this conversation permanently? This cannot be undone.')) void act({ type: 'delete' }, 'Deleted'); }}>Delete forever</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-2">
          <div className="px-1">
            <h2 className="break-words text-base font-semibold text-slate-900 sm:text-lg">{detail.thread.subject || '(no subject)'}</h2>
            <p className="text-xs text-muted-foreground">
              {detail.sharedMailbox ? `${detail.sharedMailbox.name} · ${detail.sharedMailbox.address}` : detail.account.emailAddress}
            </p>
          </div>
          {detail.messages.map((message) => {
            const open = expanded.has(message.id);
            return (
              <article key={message.id} className={cn('rounded-xl border bg-white p-3', message.direction === 'outbound' && 'border-indigo-100')}>
                <Header
                  message={message}
                  expanded={open}
                  onToggle={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(message.id)) next.delete(message.id);
                      else next.add(message.id);
                      return next;
                    })
                  }
                />
                {open && <div className="mt-3"><MessageBody message={message} /></div>}
              </article>
            );
          })}
          <div className="flex flex-wrap gap-2 px-1 pt-1">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => compose('reply')}><Reply className="h-4 w-4" /> Reply</Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => compose('replyAll')}><ReplyAll className="h-4 w-4" /> Reply all</Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => compose('forward')}><Forward className="h-4 w-4" /> Forward</Button>
          </div>
        </div>

        <aside className="min-w-0 space-y-3">
          {detail.sharedMailbox && <AssignmentPanel detail={detail} members={members} onChange={() => { void load(); onChanged(); }} />}
          <LinksPanel detail={detail} onChange={load} />
          <FollowUpsPanel detail={detail} members={members} onChange={load} />
          <NotesPanel detail={detail} members={members} onChange={load} />
        </aside>
      </div>

      <Dialog open={Boolean(ai)} onOpenChange={(next) => !next && setAi(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{ai?.kind === 'summary' ? 'AI summary' : 'Suggested reply'}</DialogTitle>
            <DialogDescription>Generated by AI from this conversation. Check it before relying on it — nothing is sent automatically.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-violet-50 p-3 font-sans text-sm text-slate-800">{ai?.text}</pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAi(null)}>Close</Button>
            {ai?.kind === 'reply' && (
              <Button
                onClick={() => {
                  const text = ai.text;
                  setAi(null);
                  compose('reply', plainTextToHtml(text), true);
                }}
              >
                Edit in a reply
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
