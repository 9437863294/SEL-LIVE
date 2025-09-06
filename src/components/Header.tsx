
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Bell, Settings, LogOut, User as UserIcon, Lock, Home, FileText, Loader2 } from 'lucide-react';
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
import { signOut } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';
import { cn } from '@/lib/utils';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import type { Requisition, Project, Department } from '@/lib/types';
import ViewRequisitionDialog from './ViewRequisitionDialog';


export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  
  const [pendingTasks, setPendingTasks] = useState<Requisition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [selectedRequisition, setSelectedRequisition] = useState<Requisition | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'requisitions'),
      where('assignedToId', '==', user.id),
      where('status', 'in', ['Pending', 'In Progress'])
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
       const tasks = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Requisition));
       setPendingTasks(tasks);
    }, (error) => {
      console.error("Error fetching pending tasks:", error);
    });
    
    // Fetch projects and departments needed for the dialog
    const fetchSupportingData = async () => {
        try {
            const projectsSnap = await getDocs(collection(db, 'projects'));
            setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
            
            const deptsSnap = await getDocs(collection(db, 'departments'));
            setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        } catch (error) {
            console.error("Failed to fetch projects/departments for dialog:", error);
        }
    };
    fetchSupportingData();

    return () => unsubscribe();
  }, [user]);
  
  const handleViewTask = (task: Requisition) => {
    setSelectedRequisition(task);
    setIsViewDialogOpen(true);
  };
  
  const refreshTasks = () => {
    // This is a placeholder for a more direct refresh mechanism if needed.
    // Currently, onSnapshot provides real-time updates.
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      toast({
        title: 'Signed Out',
        description: 'You have been successfully signed out.',
      });
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
       toast({
        title: 'Error',
        description: 'Failed to sign out.',
        variant: 'destructive',
      });
    }
  };

  if (pathname === '/login') {
    return null;
  }

  const getInitials = (name: string | undefined | null) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }
  
  const getPageTitle = () => {
    if (pathname.startsWith('/site-fund-requisition')) return 'Site Fund Requisition';
    if (pathname.startsWith('/settings')) return 'Settings';
    return '';
  }
  
  const pageTitle = getPageTitle();

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-16 items-center px-4 md:px-6">
          <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Home className="h-5 w-5" />
                </Button>
              </Link>
              {pageTitle && <h1 className="text-lg font-semibold text-foreground">{pageTitle}</h1>}
          </div>


          <div className="ml-auto flex items-center gap-2">
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
                   <DropdownMenuItem disabled>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user?.name}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user?.email}
                        </p>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <UserIcon className="mr-2 h-4 w-4" />
                      <span>Profile</span>
                    </DropdownMenuItem>
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
                   <DropdownMenuSeparator />
                   <DropdownMenuItem onClick={handleSignOut}>
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
                            <span className="font-semibold">{task.requisitionId}</span>
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
