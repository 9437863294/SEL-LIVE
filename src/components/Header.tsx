
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bell, Settings, LogOut, User as UserIcon, Lock, Home, FileText, Loader2, Users, LogIn, History as HistoryIcon } from 'lucide-react';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';
import { cn } from '@/lib/utils';
import { collection, query, where, onSnapshot, getDocs, collectionGroup } from 'firebase/firestore';
import type { Requisition, Project, Department, JmcEntry } from '@/lib/types';
import ViewRequisitionDialog from './ViewRequisitionDialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { SwitchUserDialog } from './auth/SwitchUserDialog';


function ImpersonationBanner() {
    const { user, originalUser } = useAuth();
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
    }, []);

    const handleSwitchBack = () => {
        sessionStorage.removeItem('impersonationUserId');
        sessionStorage.removeItem('originalAdminUser');
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


export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isImpersonating, handleSignOut } = useAuth();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isSwitchUserOpen, setIsSwitchUserOpen] = useState(false);
  const { can } = useAuthorization();
  
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [selectedRequisition, setSelectedRequisition] = useState<Requisition | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  
  const canSwitchUser = can('Switch User', 'Settings.User Management');

  useEffect(() => {
    if (!user || isImpersonating) {
        setPendingTasks([]);
        return;
    }

    const unsubscribes: (() => void)[] = [];

    const fetchSupportingDataAndTasks = async () => {
        try {
            // Fetch supporting data first
            const projectsSnap = await getDocs(collection(db, 'projects'));
            const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
            setProjects(projectsData);
            
            const deptsSnap = await getDocs(collection(db, 'departments'));
            setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));

            // Set up listeners using the fetched projects data
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

            // Fetch JMC entries for each project
            projectsData.forEach(project => {
                const jmcQuery = query(
                    collection(db, 'projects', project.id, 'jmcEntries'),
                    where('assignees', 'array-contains', user.id)
                );
                const unsubscribeJmc = onSnapshot(jmcQuery, (snapshot) => {
                    const jmcTasks = snapshot.docs
                        .map(doc => ({ ...doc.data(), id: doc.id, taskType: 'jmc' } as PendingTask))
                        .filter(task => ['Pending', 'In Progress', 'Needs Review'].includes(task.status));
                    
                    setPendingTasks(prev => {
                        // Remove old tasks for this project to avoid duplicates, then add new ones
                        const otherTasks = prev.filter(t => t.taskType !== 'jmc' || (t as JmcEntry).projectId !== project.id);
                        return [...otherTasks, ...jmcTasks].sort((a,b) => b.createdAt.toMillis() - a.createdAt.toMillis());
                    });
                }, (error) => {
                    console.error(`Error fetching JMC tasks for project ${project.projectName}:`, error);
                });
                unsubscribes.push(unsubscribeJmc);
            });

        } catch (error) {
            console.error("Failed to fetch initial data for Header:", error);
        }
    };
    
    fetchSupportingDataAndTasks();

    return () => unsubscribes.forEach(unsub => unsub());
  }, [user, isImpersonating]);
  
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
        <div className="flex h-16 items-center px-4 md:px-6">
          <div className="flex items-center gap-4">
              <Link href="/">
                <div className="relative h-10 w-28">
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
              <div className="border-l pl-4">
                 <h1 className="text-lg font-semibold text-foreground hidden md:block">Siddhartha Engineering Limited</h1>
              </div>
          </div>


          <div className="ml-auto flex items-center gap-4">
             <span className="text-sm font-medium text-foreground hidden sm:inline">{user?.name}</span>
            <TooltipProvider>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
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
                  <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-full">
                    <Bell className="h-5 w-5" />
                    {pendingTasks.length > 0 && (
                      <span className="absolute top-0 right-0 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                      </span>
                    )}
                    <span className="sr-only">Notifications</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Pending Tasks ({pendingTasks.length})</DropdownMenuLabel>
                  <DropdownMenuSeparator />
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
                </DropdownMenuContent>
              </DropdownMenu>

            </TooltipProvider>
          </div>
        </div>
        <ChangePasswordDialog isOpen={isChangePasswordOpen} onOpenChange={setIsChangePasswordOpen} />
        {canSwitchUser && <SwitchUserDialog isOpen={isSwitchUserOpen} onOpenChange={setIsSwitchUserOpen} />}
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
