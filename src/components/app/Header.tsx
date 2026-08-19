
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bell, Settings, LogOut, User as UserIcon, Lock, Home, FileText, Loader2, Users, LogIn, History as HistoryIcon, AlertTriangle, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { usePathname, useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { signOut, signInWithEmailAndPassword } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { collection, query, where, onSnapshot, getDocs, collectionGroup, orderBy, limit, updateDoc, doc } from 'firebase/firestore';
import type { Requisition, Project, Department, JmcEntry } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { isConversationArchived } from '@/lib/chat';
import {
  countUnreadNotifications,
  fetchRoleTargetedNotifications,
  markAllNotificationsReadForUser,
  markNotificationRead,
  normalizeNotification,
  type NormalizedNotification,
} from '@/lib/notifications';
import { moduleBadgeClass } from '@/lib/activity-modules';

// The header renders on every authenticated page, but these dialogs are only
// reachable behind a click. Loading them eagerly put ~60KB of dialog code (and
// ViewRequisitionDialog's firebase/storage + date-fns dependencies) into the
// first paint of every route.
const ChangePasswordDialog = dynamic(
  () => import('@/components/auth/ChangePasswordDialog').then((m) => m.ChangePasswordDialog),
  { ssr: false }
);
const SwitchUserDialog = dynamic(
  () => import('@/components/auth/SwitchUserDialog').then((m) => m.SwitchUserDialog),
  { ssr: false }
);
const ViewRequisitionDialog = dynamic(
  () => import('@/components/site-fund-requisition/ViewRequisitionDialog'),
  { ssr: false }
);


function ImpersonationBanner() {
    const { user, originalUser } = useAuth();
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
    }, []);

    const handleSwitchBack = () => {
        localStorage.removeItem('impersonationUserId');
        localStorage.removeItem('originalAdminUser');
        window.location.reload();
    };
    
    // Only render on the client-side after hydration, and only if an originalUser exists.
    if (!isClient || !originalUser) return null;

    return (
        <div className="bg-yellow-500 text-yellow-900 text-center py-2 px-4 text-sm font-semibold">
            You are currently viewing as {user?.name}. 
            <Button variant="link" className="text-yellow-900 h-auto p-0 ml-2 underline" onClick={handleSwitchBack}>
                Switch back to {originalUser.name}
            </Button>
        </div>
    );
}

type PendingTask = (Requisition & { taskType: 'requisition' }) | (JmcEntry & { taskType: 'jmc' });

/**
 * How many unread notifications the bell streams. The list scrolls, so this is a
 * cost ceiling on the live listener rather than a display limit; the label shows
 * the true unread total whenever there is more than this.
 */
const BELL_ALERT_LIMIT = 50;


export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isImpersonating, handleSignOut } = useAuth();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isSwitchUserOpen, setIsSwitchUserOpen] = useState(false);
  const { can } = useAuthorization();
  
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [alerts, setAlerts] = useState<NormalizedNotification[]>([]);
  /** Notifications addressed to the user's role rather than to them. See the loader below. */
  const [roleAlerts, setRoleAlerts] = useState<NormalizedNotification[]>([]);
  /**
   * Alerts hidden the moment they are read, before Firestore confirms it. The
   * listener drops a notification only once the write lands, so without this a
   * slow round-trip left the item sitting in the list looking like the click was
   * ignored. Restored if the write turns out to have failed.
   */
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  /** Unread count past what the listener streams; null until known or unavailable. */
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [selectedRequisition, setSelectedRequisition] = useState<Requisition | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  
  const canSwitchUser = can('Switch User', 'Settings.User Management');
  const canViewChat =
    can('View Module', 'Chat System') &&
    can('View', 'Chat System.Conversations');

  useEffect(() => {
    if (!user || isImpersonating) {
        setPendingTasks([]);
        setAlerts([]);
        setRoleAlerts([]);
        setDismissedAlertIds(new Set());
        setUnreadTotal(null);
        return;
    }

    const unsubscribes: (() => void)[] = [];

    const fetchSupportingDataAndTasks = async () => {
        try {
            // Independent reads — fetch concurrently rather than in series.
            const [projectsSnap, deptsSnap] = await Promise.all([
              getDocs(collection(db, 'projects')),
              getDocs(collection(db, 'departments')),
            ]);
            setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
            setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        } catch (error) {
            console.error("Failed to fetch initial data for Header:", error);
        }
    };

    fetchSupportingDataAndTasks();

    const reqQuery = query(
      collection(db, 'requisitions'),
      where('assignees', 'array-contains', user.id),
      where('status', 'in', ['Pending', 'In Progress', 'Needs Review'])
    );

    const unsubscribeReqs = onSnapshot(reqQuery, (querySnapshot) => {
       const reqTasks = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, taskType: 'requisition' } as PendingTask));
       setPendingTasks(prev => {
           const otherTasks = prev.filter(t => t.taskType !== 'requisition');
           return [...otherTasks, ...reqTasks].sort((a,b) => b.createdAt.toMillis() - a.createdAt.toMillis());
       });
    }, (error) => {
      console.error("Error fetching pending requisitions:", error);
    });
    unsubscribes.push(unsubscribeReqs);

    // One collection-group listener across every project's jmcEntries, instead of
    // opening a separate listener per project (which scaled with the project count
    // and had to wait on the projects fetch before it could start).
    const jmcQuery = query(
        collectionGroup(db, 'jmcEntries'),
        where('assignees', 'array-contains', user.id)
    );
    const unsubscribeJmc = onSnapshot(jmcQuery, (snapshot) => {
        const jmcTasks = snapshot.docs
            .map(doc => ({
                ...doc.data(),
                id: doc.id,
                // Derive from the ref so this holds even if the field is absent.
                projectId: doc.ref.parent.parent?.id,
                taskType: 'jmc',
            } as PendingTask))
            .filter(task => ['Pending', 'In Progress', 'Needs Review'].includes(task.status));

        setPendingTasks(prev => {
            const otherTasks = prev.filter(t => t.taskType !== 'jmc');
            return [...otherTasks, ...jmcTasks].sort((a,b) => b.createdAt.toMillis() - a.createdAt.toMillis());
        });
    }, (error) => {
        // A collection-group query on `assignees array-contains` needs a COLLECTION_GROUP-scoped
        // index. It's declared in firestore.indexes.json, but until that is deployed this listener
        // fails and retries — which shows up as repeated Firestore 'Listen' transport errors and an
        // empty JMC section in the bell, with nothing explaining why. Say so explicitly.
        if ((error as { code?: string }).code === 'failed-precondition') {
            console.error(
                'JMC tasks need a Firestore collection-group index that has not been deployed yet. ' +
                'Run: firebase deploy --only firestore:indexes\nOriginal error:',
                error,
            );
            return;
        }
        console.error("Error fetching JMC tasks:", error);
    });
    unsubscribes.push(unsubscribeJmc);

    // Every unread notification addressed to this user, whatever module raised it.
    //
    // This deliberately does NOT filter on `type`. It used to carry
    // where('type', 'in', ['budget_alert', 'recurring_payment_workflow',
    // 'recurring_payment_reminder']), which meant a module could only reach the bell
    // by having its type added here — so tat_escalation, step_entry and
    // workflow_complete were all written to Firestore and displayed to nobody. Any
    // new producer now shows up without touching this file.
    const alertQuery = query(
      collection(db, 'userNotifications'),
      where('userId', '==', user.id),
      where('read', '==', false),
      orderBy('createdAt', 'desc'),
      limit(BELL_ALERT_LIMIT)
    );
    const userId = user.id;
    const unsubscribeAlerts = onSnapshot(alertQuery, snap => {
      setAlerts(snap.docs.map(d => normalizeNotification(d.id, d.data())));
      // Only when the listener is saturated is there anything the list cannot show,
      // and only then is the aggregation query worth paying for.
      if (snap.size < BELL_ALERT_LIMIT) {
        setUnreadTotal(snap.size);
      } else {
        void countUnreadNotifications(userId).then(setUnreadTotal);
      }
    }, (error) => {
      // This listener previously swallowed every error with an empty callback, so a
      // missing composite index looked identical to having no notifications. The
      // index it needs (userId, read, createdAt desc) is declared in
      // firestore.indexes.json; say so rather than failing silently.
      if ((error as { code?: string }).code === 'failed-precondition') {
        console.error(
          'Notifications need a Firestore composite index on userNotifications '
          + '(userId, read, createdAt desc) that has not been deployed yet. '
          + 'Run: firebase deploy --only firestore:indexes\nOriginal error:',
          error,
        );
        return;
      }
      console.error('Error fetching notifications:', error);
    });
    unsubscribes.push(unsubscribeAlerts);

    // Notifications addressed to a role rather than to a user. The bank-guarantee
    // and letter-of-credit services raise theirs from inside a Firestore transaction,
    // where roles cannot be resolved to users, so they write one document carrying
    // `targetRoles` and no `userId` — which the listener above cannot see.
    //
    // Held in its own state rather than merged into `alerts`, because the listener
    // above replaces that array wholesale on every snapshot and would drop them.
    let cancelled = false;
    void fetchRoleTargetedNotifications(user.role).then(roleTargeted => {
      if (!cancelled) setRoleAlerts(roleTargeted);
    });
    unsubscribes.push(() => { cancelled = true; });

    return () => unsubscribes.forEach(unsub => unsub());
    // Keyed on the id and role, not the whole object: unrelated profile edits
    // (theme, etc.) shouldn't tear down and rebuild every listener, but the legacy
    // role-notification read above is scoped by role, so a role change has to re-run it.
  }, [user?.id, user?.role, isImpersonating]);

  useEffect(() => {
    if (!user?.id || !canViewChat) {
      setChatUnreadCount(0);
      return;
    }

    const userId = user.id;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    // Imported on demand: this pulls in the Realtime Database SDK, and the header
    // renders on every page. An unread badge isn't worth putting that on the
    // critical path of routes that have nothing to do with chat.
    void import('@/lib/chat-conversations-store').then(({ subscribeToUserConversations }) => {
      if (cancelled) return;
      unsubscribe = subscribeToUserConversations(userId, {
        onConversations: (conversations) => {
          // Archived chats are deliberately quiet: their unread count stays on the
          // Archived row inside the module instead of the badge on every page.
          const total = conversations.reduce((sum, conversation) => {
            if (isConversationArchived(conversation, userId)) return sum;
            return sum + (conversation.unreadCounts?.[userId] || 0);
          }, 0);
          setChatUnreadCount(total);
        },
        onError: () => setChatUnreadCount(0),
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [canViewChat, user?.id]);
  
  const handleViewTask = (task: PendingTask) => {
    if(task.taskType === 'requisition'){
        setSelectedRequisition(task as Requisition);
        setIsViewDialogOpen(true);
    } else if (task.taskType === 'jmc') {
        const jmcTask = task as JmcEntry;
        const project = projects.find(p => p.id === jmcTask.projectId);
        if(project) {
             const slug = project.projectName.toLowerCase().replace(/\s+/g, '-');
             // For now, let's just log it, as opening JMC dialog from here is complex
             console.log(`Navigate to JMC Task: /billing-recon/${slug}/jmc/stage/${jmcTask.currentStepId}`);
             toast({title: "JMC Task", description: `Task ${jmcTask.jmcNo} is pending at stage: ${jmcTask.stage}`})
        }
    }
  };
  
  // Live notifications plus the historical role-targeted ones, newest first.
  const visibleAlerts = useMemo(() => {
    const seen = new Set(alerts.map(item => item.id));
    const merged = [...alerts, ...roleAlerts.filter(item => !seen.has(item.id))];
    return merged
      .filter(item => !dismissedAlertIds.has(item.id))
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
  }, [alerts, roleAlerts, dismissedAlertIds]);

  /**
   * Put notifications back in the list after a failed write.
   *
   * Ids are otherwise never removed from the dismissed set, which is safe: they are
   * Firestore document ids, so one can never come back attached to a different
   * notification, and the set only grows by what the user reads in a session.
   */
  const restoreAlerts = (ids: string[]) => {
    if (!ids.length) return;
    setDismissedAlertIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  };

  async function markAlertRead(alertId: string) {
    // Hide it now, and drop the legacy role-targeted copy for good: those aren't
    // streamed, so nothing else would ever remove them.
    setDismissedAlertIds(prev => new Set(prev).add(alertId));
    // Writes both `read: true` and `status: 'READ'`, so the legacy documents that
    // track read state as a string also stop counting as unread.
    const ok = await markNotificationRead(alertId);
    if (ok) {
      setRoleAlerts(prev => prev.filter(item => item.id !== alertId));
      setUnreadTotal(prev => (prev === null ? prev : Math.max(0, prev - 1)));
    } else {
      restoreAlerts([alertId]);
      toast({
        variant: 'destructive',
        title: 'Could not mark as read',
        description: 'The notification is still unread. Please try again.',
      });
    }
  }

  async function markAllAlertsRead() {
    if (!user?.id || isMarkingAllRead) return;
    const shown = visibleAlerts.map(item => item.id);
    if (!shown.length) return;

    setIsMarkingAllRead(true);
    setDismissedAlertIds(prev => new Set([...prev, ...shown]));
    try {
      // Sweeps every unread notification, not just the page the bell is holding —
      // marking only the visible ones let the listener backfill the next unread
      // batch, so the list appeared not to clear at all.
      const { marked, failed, truncated } = await markAllNotificationsReadForUser(
        user.id,
        user.role,
      );
      setRoleAlerts(prev => prev.filter(item => failed.includes(item.id)));
      restoreAlerts(failed);
      if (failed.length || truncated) {
        toast({
          variant: 'destructive',
          title: truncated ? 'Some notifications are still unread' : 'Some could not be cleared',
          description: truncated
            ? `Cleared ${marked}. There were too many to clear at once — try again.`
            : `Cleared ${marked}, but ${failed.length} could not be updated.`,
        });
      }
    } finally {
      setIsMarkingAllRead(false);
    }
  }

  const refreshTasks = () => {
    // This is a placeholder for a more direct refresh mechanism if needed.
    // Currently, onSnapshot provides real-time updates.
  };

  if (pathname === '/login') {
    return null;
  }

  const getInitials = (name: string | undefined | null) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }
  
  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <ImpersonationBanner />
        <div className="flex h-14 items-center px-3 md:h-16 md:px-6">
          <div className="flex items-center gap-2 md:gap-4">
              <Link href="/">
                <div className="relative h-8 w-24 md:h-10 md:w-28">
                  <Image
                    src="https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2FSEL%20%20logo2%20.png?alt=media&token=39b0f804-0610-4f3a-b26e-8ce334f94788"
                    alt="Company Logo"
                    fill
                    sizes="112px"
                    style={{ objectFit: 'contain' }}
                    priority
                  />
                </div>
              </Link>
              <div className="border-l pl-3 md:pl-4">
                 <h1 className="text-sm font-semibold text-foreground hidden sm:block md:text-lg">Siddhartha Engineering Limited</h1>
              </div>
          </div>


          <div className="ml-auto flex items-center gap-2 md:gap-4">
             <span className="text-sm font-medium text-foreground hidden sm:inline">{user?.name}</span>
            <TooltipProvider>

              {canViewChat && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button asChild variant="ghost" size="icon" className="relative h-10 w-10 rounded-full">
                      <Link href="/chat-system" aria-label="Open chat">
                        <MessageCircle className="h-5 w-5" />
                        {chatUnreadCount > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                            {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                          </span>
                        )}
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Chat{chatUnreadCount ? ` (${chatUnreadCount} unread)` : ''}</TooltipContent>
                </Tooltip>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={user?.photoURL || undefined} alt={user?.name || 'User avatar'} />
                      <AvatarFallback>{getInitials(user?.name)}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                   <DropdownMenuLabel>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user?.name}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user?.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                     <Link href="/settings/profile">
                        <DropdownMenuItem>
                            <UserIcon className="mr-2 h-4 w-4" />
                            <span>Profile</span>
                        </DropdownMenuItem>
                     </Link>
                    <Link href="/settings">
                      <DropdownMenuItem>
                          <Settings className="mr-2 h-4 w-4" />
                          <span>Settings</span>
                      </DropdownMenuItem>
                    </Link>
                    <DropdownMenuItem onSelect={() => setIsChangePasswordOpen(true)}>
                      <Lock className="mr-2 h-4 w-4" />
                      <span>Change Password</span>
                    </DropdownMenuItem>
                     {canSwitchUser && !isImpersonating && (
                        <DropdownMenuItem onSelect={() => setIsSwitchUserOpen(true)}>
                            <LogIn className="mr-2 h-4 w-4" />
                            <span>Switch User</span>
                        </DropdownMenuItem>
                    )}
                   <DropdownMenuSeparator />
                   <DropdownMenuItem onClick={() => handleSignOut()}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sign Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

               <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative h-10 w-10 rounded-full">
                    <Bell className="h-5 w-5" />
                    {(pendingTasks.length + visibleAlerts.length) > 0 && (
                      <span className="absolute top-1 right-1 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                      </span>
                    )}
                    <span className="sr-only">Notifications</span>
                  </Button>
                </DropdownMenuTrigger>
                {/*
                  Height is capped to what Radix measures as available below the
                  trigger, and each list scrolls inside it — an unread backlog used
                  to render as one column taller than the viewport, with the oldest
                  notifications unreachable.
                */}
                <DropdownMenuContent
                  align="end"
                  className="flex max-h-[min(34rem,var(--radix-dropdown-menu-content-available-height))] w-[min(320px,calc(100vw-1rem))] flex-col"
                >
                  <DropdownMenuLabel>Pending Tasks ({pendingTasks.length})</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="max-h-40 shrink-0 overflow-y-auto">
                    {pendingTasks.length > 0 ? (
                      pendingTasks.map(task => (
                          <DropdownMenuItem key={task.id} onSelect={() => handleViewTask(task)}>
                            <div className="flex flex-col">
                              <span className="font-semibold">
                                  {task.taskType === 'requisition' ? (task as Requisition).requisitionId : (task as JmcEntry).jmcNo}
                              </span>
                              <span className="text-xs text-muted-foreground">{task.stage}</span>
                            </div>
                          </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>
                        <p className="text-sm text-muted-foreground">No pending tasks.</p>
                      </DropdownMenuItem>
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  <div className="flex items-center justify-between pr-1">
                    <DropdownMenuLabel>
                      {/* "of N" only when the listener's page is smaller than the backlog. */}
                      Notifications ({visibleAlerts.length > 0 && unreadTotal !== null && unreadTotal > visibleAlerts.length
                        ? `${visibleAlerts.length} of ${unreadTotal}`
                        : visibleAlerts.length})
                    </DropdownMenuLabel>
                    {visibleAlerts.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isMarkingAllRead}
                        className="h-6 px-2 text-xs font-normal text-muted-foreground"
                        onClick={(event) => {
                          // Keep the menu open so clearing the list is visible.
                          event.preventDefault();
                          void markAllAlertsRead();
                        }}
                      >
                        {isMarkingAllRead ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            Clearing
                          </>
                        ) : (
                          'Mark all read'
                        )}
                      </Button>
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  {/* max-h as well as flex-1: the list still scrolls if the Radix
                      available-height variable is not resolved. */}
                  <div className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto">
                  {visibleAlerts.length > 0 ? (
                    visibleAlerts.map(alert => (
                      <DropdownMenuItem
                        key={alert.id}
                        onSelect={() => {
                          void markAlertRead(alert.id);
                          if (alert.link) router.push(alert.link);
                        }}
                      >
                        <div className="flex items-start gap-2 w-full">
                          {alert.severity === 'CRITICAL' ? (
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
                          ) : alert.severity === 'WARNING' ? (
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                          ) : (
                            <Bell className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                          )}
                          <div className="flex flex-col min-w-0 gap-0.5">
                            <span className="font-semibold truncate">{alert.title}</span>
                            <span className="text-xs text-muted-foreground line-clamp-2">{alert.body}</span>
                            {alert.module && alert.module !== 'Unknown' && (
                              <span className={cn(
                                'mt-0.5 w-fit rounded border px-1 text-[10px] leading-4',
                                moduleBadgeClass(alert.module),
                              )}>
                                {alert.module}
                              </span>
                            )}
                          </div>
                        </div>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>
                      <p className="text-sm text-muted-foreground">No notifications.</p>
                    </DropdownMenuItem>
                  )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

            </TooltipProvider>
          </div>
        </div>
        {/* Mounted only while open so the lazy chunk is fetched on demand. */}
        {isChangePasswordOpen && (
          <ChangePasswordDialog isOpen onOpenChange={setIsChangePasswordOpen} />
        )}
        {canSwitchUser && isSwitchUserOpen && (
          <SwitchUserDialog isOpen onOpenChange={setIsSwitchUserOpen} />
        )}
      </header>
      
      {selectedRequisition && (
        <ViewRequisitionDialog
            isOpen={isViewDialogOpen}
            onOpenChange={setIsViewDialogOpen}
            requisition={selectedRequisition}
            projects={projects}
            departments={departments}
            onRequisitionUpdate={refreshTasks}
        />
      )}
    </>
  );
}
