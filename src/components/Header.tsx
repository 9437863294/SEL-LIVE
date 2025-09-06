
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, Settings, LogOut, User as UserIcon, Lock, Home, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { usePathname, useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';
import { cn } from '@/lib/utils';

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

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

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                  <Bell className="h-5 w-5" />
                  <span className="sr-only">Notifications</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Notifications</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                 <Link href="#">
                    <Button variant="ghost" size="icon" className={cn("h-8 w-8 rounded-full", { 'hidden': pageTitle !== 'Site Fund Requisition' })}>
                      <FileText className="h-5 w-5" />
                      <span className="sr-only">Reports</span>
                    </Button>
                  </Link>
              </TooltipTrigger>
              <TooltipContent>
                <p>Reports</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                 <Link href="/site-fund-requisition/settings">
                    <Button variant="ghost" size="icon" className={cn("h-8 w-8 rounded-full", { 'hidden': pageTitle !== 'Site Fund Requisition' })}>
                      <Settings className="h-5 w-5" />
                      <span className="sr-only">Site Fund Requisition Settings</span>
                    </Button>
                  </Link>
              </TooltipTrigger>
              <TooltipContent>
                <p>Site Fund Requisition Settings</p>
              </TooltipContent>
            </Tooltip>

          </TooltipProvider>
        </div>
      </div>
      <ChangePasswordDialog isOpen={isChangePasswordOpen} onOpenChange={setIsChangePasswordOpen} />
    </header>
  );
}
