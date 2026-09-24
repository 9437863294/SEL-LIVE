'use client';

/**
 * The two-pane mail view every folder page uses: conversations on the left, the open one on the
 * right. On a phone it is one pane at a time, with Back.
 *
 * Keyboard shortcuts (when enabled in Mail settings, and never while typing): j/k next/previous,
 * r reply, a reply all, f forward, e archive, # trash, u mark unread, s star, c compose, / search,
 * Esc back to the list, ? this help.
 */

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, Keyboard, Plug, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { mailApi, type ThreadSummary } from '@/lib/mail-hub/client';
import { cn } from '@/lib/utils';
import { Conversation, type ConversationHandle } from './conversation';
import { useMailHub } from './hooks';
import { ThreadList } from './thread-list';
import { EmptyState, ErrorNotice, PageHeader, RecoveryPanel, Spinner } from './ui';

export type MailViewName = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam' | 'starred';

const FILTERS_PERSONAL = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'attachments', label: 'Attachments' },
];
const FILTERS_SHARED = [
  { value: 'open', label: 'Open' },
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'all', label: 'All' },
];

const SHORTCUTS: [string, string][] = [
  ['j / k', 'Next / previous conversation'],
  ['Enter', 'Open the selected conversation'],
  ['r', 'Reply'],
  ['a', 'Reply all'],
  ['f', 'Forward'],
  ['e', 'Archive'],
  ['#', 'Move to Trash'],
  ['u', 'Mark unread'],
  ['s', 'Star / unstar'],
  ['c', 'Compose'],
  ['/', 'Search'],
  ['Esc', 'Back to the list'],
];

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)));
}

export function MailView({
  view,
  title,
  description,
  sharedAccountId,
  sharedLabel,
}: {
  view: MailViewName;
  title: string;
  description?: string;
  /** Shared mode: one shared mailbox, with assignment filters. */
  sharedAccountId?: string | null;
  sharedLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const { data, version, bump, openComposer, composer } = useMailHub();
  const shared = Boolean(sharedAccountId);
  const accountParam = sharedAccountId ?? params?.get('account') ?? null;
  const folderParam = shared ? null : (params?.get('folder') ?? null);
  const threadParam = params?.get('thread') ?? null;
  const [filter, setFilter] = useState(shared ? 'open' : 'all');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [help, setHelp] = useState(false);
  const handle = useRef<ConversationHandle | null>(null);

  const personal = useMemo(() => (data?.accounts ?? []).filter((account) => account.kind === 'personal' && account.access.canRead), [data?.accounts]);
  const scopeAccounts = shared ? (data?.accounts ?? []).filter((account) => account.id === sharedAccountId) : accountParam ? personal.filter((account) => account.id === accountParam) : personal;
  const folderName = folderParam && accountParam ? data?.folders[accountParam]?.find((folder) => folder.id === folderParam)?.name : null;

  const setQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      Object.entries(patch).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
      router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(
    async (append = false) => {
      setLoading(true);
      try {
        const result = await mailApi.threads({
          view,
          accountId: accountParam,
          folderId: folderParam,
          filter: filter === 'all' ? null : filter,
          before: append ? nextBefore : null,
          limit: 50,
        });
        setThreads((current) => (append ? [...current, ...result.threads.filter((thread) => !current.some((existing) => existing.id === thread.id))] : result.threads));
        setNextBefore(result.nextBefore);
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load conversations.');
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, accountParam, folderParam, filter, nextBefore],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, accountParam, folderParam, filter, version]);

  const select = useCallback((thread: ThreadSummary | null) => setQuery({ thread: thread?.id ?? null }), [setQuery]);

  useEffect(() => {
    if (!data?.settings.keyboardShortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || composer) return;
      const key = event.key;
      if (key === 'j' || key === 'k') {
        event.preventDefault();
        const next = Math.min(Math.max(cursor + (key === 'j' ? 1 : -1), 0), threads.length - 1);
        setCursor(next);
        if (threads[next]) {
          document.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(threads[next].id)}"]`)?.focus();
          if (threadParam) select(threads[next]);
        }
      } else if (key === 'Enter' && !threadParam && threads[cursor]) select(threads[cursor]);
      else if (key === 'Escape' && threadParam) select(null);
      else if (key === 'c' && data.capabilities.canSend) openComposer({ mode: 'new', accountId: shared ? null : accountParam });
      else if (key === '/') {
        event.preventDefault();
        router.push('/mail/search');
      } else if (key === '?') setHelp(true);
      else if (handle.current && threadParam) {
        const actions: Record<string, () => void> = {
          r: handle.current.reply,
          a: handle.current.replyAll,
          f: handle.current.forward,
          e: handle.current.archive,
          '#': handle.current.trash,
          u: handle.current.toggleRead,
          s: handle.current.toggleStar,
        };
        if (actions[key]) {
          event.preventDefault();
          actions[key]();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, composer, cursor, threads, threadParam, select, openComposer, router, shared, accountParam]);

  if (!data) return null;

  if (!shared && personal.length === 0) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <EmptyState
          icon={<Plug className="h-10 w-10" />}
          title="Connect an email account"
          body="Connect your Google Workspace, Microsoft 365 or company mailbox to read and send mail here, and link it to your ERP work."
          action={
            data.capabilities.canConnectAccount ? (
              <Button asChild className="mt-2"><Link href="/mail/settings/accounts">Connect email account</Link></Button>
            ) : (
              <p className="text-xs text-muted-foreground">Ask your administrator for the Mail Hub › Accounts › Connect permission.</p>
            )
          }
        />
      </>
    );
  }

  const unhealthy = scopeAccounts.filter((account) => account.recovery && account.status !== 'active');
  const filters = shared ? FILTERS_SHARED : FILTERS_PERSONAL;
  const accountLabel = !shared && !accountParam && personal.length > 1 ? (id: string) => personal.find((account) => account.id === id)?.emailAddress ?? null : undefined;

  return (
    <div className="flex min-h-0 flex-col">
      <PageHeader
        title={folderName ?? title}
        description={sharedLabel ?? description}
        actions={
          <>
            {!shared && personal.length > 1 && (
              <Select value={accountParam ?? 'all'} onValueChange={(value) => setQuery({ account: value === 'all' ? null : value, folder: null, thread: null })}>
                <SelectTrigger className="h-9 w-[220px] bg-white" aria-label="Mailbox"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All my mailboxes</SelectItem>
                  {personal.map((account) => <SelectItem key={account.id} value={account.id}>{account.emailAddress}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="icon" className="h-9 w-9 bg-white" aria-label="Refresh" onClick={() => { bump(); }}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
            {data.settings.keyboardShortcuts && (
              <Button variant="outline" size="icon" className="hidden h-9 w-9 bg-white lg:inline-flex" aria-label="Keyboard shortcuts" onClick={() => setHelp(true)}>
                <Keyboard className="h-4 w-4" />
              </Button>
            )}
          </>
        }
      />

      {unhealthy.length > 0 && (
        <div className="mb-3 space-y-2">
          {unhealthy.map((account) => (
            <RecoveryPanel
              key={account.id}
              advice={{ ...account.recovery!, title: `${account.emailAddress}: ${account.recovery!.title}` }}
              actions={<Button asChild size="sm" variant="outline" className="h-7 bg-white"><Link href="/mail/settings/accounts">Fix in Accounts</Link></Button>}
            />
          ))}
        </div>
      )}

      <div className="grid min-h-[70vh] grid-cols-1 overflow-hidden rounded-xl border bg-white lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <section className={cn('flex min-h-0 flex-col border-r', threadParam && 'hidden lg:flex')} aria-label="Conversation list">
          <div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
            {filters.map((entry) => (
              <Button key={entry.value} size="sm" variant={filter === entry.value ? 'secondary' : 'ghost'} className="h-7 shrink-0 px-2.5 text-xs" onClick={() => setFilter(entry.value)}>
                {entry.label}
              </Button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto lg:max-h-[calc(100vh-15rem)]">
            {error && <div className="p-3"><ErrorNotice message={error} onRetry={() => load(false)} /></div>}
            {!error && loading && threads.length === 0 && <div className="px-3"><Spinner /></div>}
            {!error && !loading && threads.length === 0 && (
              <div className="p-6"><EmptyState icon={<Inbox className="h-8 w-8" />} title="Nothing here" body={scopeAccounts.some((account) => account.status === 'connecting') ? 'The first sync is still running — mail will appear shortly.' : undefined} /></div>
            )}
            <ThreadList threads={threads} selectedId={threadParam} onSelect={(thread) => { setCursor(threads.indexOf(thread)); select(thread); }} showAssignee={shared} accountLabel={accountLabel} />
            {nextBefore && (
              <div className="p-3 text-center">
                <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>Load more</Button>
              </div>
            )}
          </div>
        </section>
        <section className={cn('min-h-0 min-w-0 overflow-y-auto lg:max-h-[calc(100vh-12rem)]', !threadParam && 'hidden lg:block')} aria-label="Conversation">
          {threadParam ? (
            <Conversation
              key={threadParam}
              threadId={threadParam}
              onBack={() => select(null)}
              onChanged={() => void load(false)}
              registerHandle={(value) => {
                handle.current = value;
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">Choose a conversation to read it.</div>
          )}
        </section>
      </div>

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle></DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="contents">
                <dt><kbd className="rounded border bg-slate-50 px-1.5 py-0.5 font-mono text-xs">{keys}</kbd></dt>
                <dd className="text-slate-600">{label}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">Turn shortcuts off in Settings › Rules & notifications.</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
