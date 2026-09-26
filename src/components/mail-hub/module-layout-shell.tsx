'use client';

/**
 * Mail Hub's chrome: sidebar on a desktop, slide-out sheet on a phone — the same shape as Office
 * Hub's shell so the two modules feel like one application. The sidebar lists the folders and, under
 * them, each connected mailbox with a status dot, so a mailbox that needs reconnecting is visible
 * from every page rather than only on Settings.
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  Archive,
  BarChart3,
  CalendarClock,
  FileText,
  Inbox,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  Mail,
  Menu,
  PenLine,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  Signature,
  Trash2,
  Users,
  Workflow,
} from 'lucide-react';

import { ModuleBottomNav, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { MAIL_HUB_BASE_PATH } from '@/lib/mail-hub/model';
import { cn } from '@/lib/utils';
import { Composer } from './composer';
import { MailHubProvider, useMailHub } from './hooks';
import { statusDot } from './ui';

type Gate = 'always' | 'shared' | 'templates' | 'reports' | 'admin';

const SECTIONS: { href: string; label: string; icon: typeof Inbox; group: 'mail' | 'work' | 'config'; gate: Gate; exact?: boolean }[] = [
  { href: `${MAIL_HUB_BASE_PATH}/inbox`, label: 'Inbox', icon: Inbox, group: 'mail', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/sent`, label: 'Sent', icon: Send, group: 'mail', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/drafts`, label: 'Drafts', icon: FileText, group: 'mail', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/scheduled`, label: 'Scheduled', icon: CalendarClock, group: 'mail', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/archive`, label: 'Archive', icon: Archive, group: 'mail', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/trash`, label: 'Trash', icon: Trash2, group: 'mail', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/search`, label: 'Search', icon: Search, group: 'mail', gate: 'always' },

  { href: `${MAIL_HUB_BASE_PATH}/tasks`, label: 'Tasks & follow-ups', icon: ListChecks, group: 'work', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/shared`, label: 'Shared mailboxes', icon: Users, group: 'work', gate: 'shared' },
  { href: `${MAIL_HUB_BASE_PATH}/templates`, label: 'Templates', icon: LayoutTemplate, group: 'work', gate: 'templates' },
  { href: `${MAIL_HUB_BASE_PATH}/reports`, label: 'Reports', icon: BarChart3, group: 'work', gate: 'reports' },

  { href: `${MAIL_HUB_BASE_PATH}/settings/accounts`, label: 'Accounts', icon: KeyRound, group: 'config', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/settings/signatures`, label: 'Signatures', icon: Signature, group: 'config', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/settings/rules`, label: 'Rules & notifications', icon: Workflow, group: 'config', gate: 'always' },
  { href: `${MAIL_HUB_BASE_PATH}/settings/permissions`, label: 'Permissions & sharing', icon: Settings2, group: 'config', gate: 'admin' },
];

const GROUP_LABELS = { mail: 'Mail', work: 'Work', config: 'Settings' } as const;

export default function MailHubLayoutShell({ children }: { children: ReactNode }) {
  return (
    <MailHubProvider>
      <Shell>{children}</Shell>
    </MailHubProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const { data, loading, error, openComposer, composer } = useMailHub();
  const [open, setOpen] = useState(false);

  if (pathname.startsWith(`${MAIL_HUB_BASE_PATH}/link`)) return <>{children}</>;

  if (loading && !data) {
    return (
      <div className="w-full px-3 py-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Skeleton className="hidden h-[28rem] w-full rounded-xl lg:block" />
          <div className="space-y-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const caps = data?.capabilities;
  if (!data || !caps || (!caps.canOpenModule && !caps.canConnectAccount)) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>{error && !data ? 'Mail Hub is unavailable' : 'Access Denied'}</CardTitle>
            <CardDescription>{error && !data ? error : 'You do not have permission to use Mail Hub.'}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2 py-8">
            <ShieldAlert className="h-14 w-14 text-destructive" />
            <p className="text-sm text-muted-foreground">Contact your administrator to request access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const gates: Record<Gate, boolean> = {
    always: true,
    shared: caps.canReadShared || caps.canAdministerConnections,
    templates: caps.canViewTemplates || caps.canSend,
    reports: caps.canViewReports,
    admin: caps.canAdministerConnections || caps.canViewAudit,
  };
  const sections = SECTIONS.filter((section) => gates[section.gate]);
  const current = [...sections].sort((a, b) => b.href.length - a.href.length).find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`));
  const personal = data.accounts.filter((account) => account.kind === 'personal' && account.access.canRead);
  const activeAccount = search?.get('account');
  const activeFolder = search?.get('folder');

  // The phone's bottom bar: the overview, the inbox with its unread count, follow-ups and search,
  // and "More" opening the menu sheet. Compose stays the header's button — it is a dialog, not a
  // page, and the bar gets out of the dialog's way (it sits under the overlay, and hides while typing).
  const unread = personal.reduce(
    (sum, account) => sum + ((data.folders[account.id] ?? []).find((folder) => folder.role === 'inbox')?.unreadCount ?? 0),
    0,
  );
  const bottomTabs: ModuleNavTab[] = [
    { href: MAIL_HUB_BASE_PATH, label: 'Home', icon: Mail, exact: true, ariaLabel: 'Mail overview' },
    { href: `${MAIL_HUB_BASE_PATH}/inbox`, label: 'Inbox', icon: Inbox, badge: unread },
    { href: `${MAIL_HUB_BASE_PATH}/tasks`, label: 'Tasks', icon: ListChecks, ariaLabel: 'Tasks & follow-ups' },
    { href: `${MAIL_HUB_BASE_PATH}/search`, label: 'Search', icon: Search },
  ];

  const nav = (onNavigate?: () => void) => {
    let last = '';
    return (
      <>
        {caps.canSend && personal.length > 0 && (
          <Button className="mb-2 w-full gap-2 bg-gradient-to-r from-sky-500 to-indigo-600 text-white hover:opacity-95" onClick={() => { openComposer({ mode: 'new' }); onNavigate?.(); }}>
            <PenLine className="h-4 w-4" /> Compose <kbd className="ml-auto hidden rounded bg-white/20 px-1 text-[10px] lg:inline">c</kbd>
          </Button>
        )}
        {sections.map((section) => {
          const showGroup = section.group !== last;
          last = section.group;
          const active = current?.href === section.href && !activeFolder;
          const Icon = section.icon;
          return (
            <div key={section.href}>
              {showGroup && <p className="px-2.5 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 first:pt-1">{GROUP_LABELS[section.group]}</p>}
              <Link
                href={section.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                  active ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{section.label}</span>
              </Link>
            </div>
          );
        })}
        {personal.length > 0 && (
          <div className="mt-3 border-t pt-2">
            <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Mailboxes</p>
            {personal.map((account) => {
              const custom = (data.folders[account.id] ?? []).filter((folder) => folder.role === 'custom').slice(0, 12);
              return (
                <div key={account.id} className="mb-1">
                  <Link
                    href={`${MAIL_HUB_BASE_PATH}/inbox?account=${account.id}`}
                    onClick={onNavigate}
                    className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 hover:bg-white/70', activeAccount === account.id && !activeFolder && 'bg-white font-semibold text-slate-900')}
                    title={account.recovery?.title ?? account.emailAddress}
                  >
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDot(account.status))} />
                    <span className="truncate">{account.emailAddress}</span>
                  </Link>
                  {custom.map((folder) => (
                    <Link
                      key={folder.id}
                      href={`${MAIL_HUB_BASE_PATH}/inbox?account=${account.id}&folder=${folder.id}`}
                      onClick={onNavigate}
                      className={cn('ml-4 flex items-center justify-between gap-2 rounded-md px-2.5 py-1 text-xs text-slate-500 hover:bg-white/70', activeFolder === folder.id && 'bg-white font-semibold text-slate-900')}
                    >
                      <span className="truncate">{folder.name}</span>
                      {folder.unreadCount ? <span className="text-[10px] text-slate-400">{folder.unreadCount}</span> : null}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="relative w-full px-2 py-2 sm:px-4 sm:py-3 lg:px-6">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50/60 via-white to-indigo-50/60" />
      <div className="mb-2 lg:hidden">
        <Card>
          <CardContent className="flex items-center gap-2 px-2.5 py-2">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-10 shrink-0 gap-2 bg-white/90 px-3 text-sm">
                  <Menu className="h-4 w-4" /> Menu
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-[88vw] max-w-[300px] flex-col bg-slate-50 p-0">
                <SheetHeader className="border-b px-4 py-3 text-left">
                  <SheetTitle className="text-sm">Mail Hub</SheetTitle>
                  <SheetDescription className="text-[11px]">Tap a section to open it</SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2 pb-8">{nav(() => setOpen(false))}</div>
              </SheetContent>
            </Sheet>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600">
                <Mail className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Mail Hub</p>
                <p className="truncate text-[11px] text-muted-foreground">{current?.label ?? 'Overview'}</p>
              </div>
            </div>
            {caps.canSend && personal.length > 0 && (
              <Button size="icon" className="h-10 w-10 shrink-0" aria-label="Compose" onClick={() => openComposer({ mode: 'new' })}>
                <PenLine className="h-4 w-4" />
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[232px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden">
            <Link href={MAIL_HUB_BASE_PATH} className="flex items-center gap-2.5 border-b bg-gradient-to-r from-sky-500/10 to-indigo-500/5 px-4 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600">
                <Mail className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Mail Hub</p>
                <p className="text-[11px] text-muted-foreground">Read · Link · Follow up</p>
              </div>
            </Link>
            <CardContent className="max-h-[calc(100vh-10rem)] overflow-y-auto p-2">
              <nav aria-label="Mail Hub sections">{nav()}</nav>
            </CardContent>
          </Card>
        </aside>
        <main className="min-w-0 w-full">{children}</main>
      </div>
      <ModuleBottomNav tabs={bottomTabs} onMore={() => setOpen(true)} moduleName="Mail Hub" />
      {composer && <Composer />}
    </div>
  );
}
