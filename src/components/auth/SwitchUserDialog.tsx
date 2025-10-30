'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { Loader2, Search, AlertCircle, ShieldAlert } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { useAuth } from './AuthProvider';
import { Alert, AlertDescription } from '../ui/alert';

// Configuration
const MAX_SWITCH_ATTEMPTS = 3;
const LOCKOUT_DURATION = 300000; // 5 minutes in milliseconds

interface SwitchUserDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function SwitchUserDialog({ isOpen, onOpenChange }: SwitchUserDialogProps) {
  const { toast } = useToast();
  const { user: currentUser, refreshUserData } = useAuth();
  
  // State management
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [password, setPassword] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [lockoutEndTime, setLockoutEndTime] = useState<number | null>(null);

  // Refs
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const lockoutTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check if currently locked out
  useEffect(() => {
    const checkLockout = () => {
      const storedLockout = sessionStorage.getItem('switchUserLockout');
      if (storedLockout) {
        const lockoutEnd = parseInt(storedLockout, 10);
        if (Date.now() < lockoutEnd) {
          setIsLocked(true);
          setLockoutEndTime(lockoutEnd);
          
          // Set timer to unlock
          const timeRemaining = lockoutEnd - Date.now();
          lockoutTimerRef.current = setTimeout(() => {
            setIsLocked(false);
            setLockoutEndTime(null);
            setFailedAttempts(0);
            sessionStorage.removeItem('switchUserLockout');
          }, timeRemaining);
        } else {
          // Lockout expired
          sessionStorage.removeItem('switchUserLockout');
        }
      }
    };

    if (isOpen) {
      checkLockout();
    }

    return () => {
      if (lockoutTimerRef.current) {
        clearTimeout(lockoutTimerRef.current);
      }
    };
  }, [isOpen]);

  // Fetch users when dialog opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchUsers = async () => {
      setIsLoading(true);
      try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const usersData = usersSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as User))
          .filter(user => user.id !== currentUser?.id); // Exclude current user
        
        setUsers(usersData);
      } catch (error) {
        console.error('Error fetching users:', error);
        toast({ 
          title: 'Error', 
          description: 'Could not fetch users. Please try again.', 
          variant: 'destructive' 
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsers();
  }, [isOpen, currentUser?.id, toast]);

  // Auto-focus password input when user is selected
  useEffect(() => {
    if (selectedUser && passwordInputRef.current) {
      setTimeout(() => passwordInputRef.current?.focus(), 100);
    }
  }, [selectedUser]);

  const resetDialog = useCallback(() => {
    setSearchTerm('');
    setPassword('');
    setSelectedUser(null);
    if (!isLocked) {
      setFailedAttempts(0);
    }
  }, [isLocked]);

  const handleLockout = useCallback(() => {
    const lockoutEnd = Date.now() + LOCKOUT_DURATION;
    setIsLocked(true);
    setLockoutEndTime(lockoutEnd);
    sessionStorage.setItem('switchUserLockout', lockoutEnd.toString());

    toast({
      title: 'Too Many Failed Attempts',
      description: `Account locked for 5 minutes due to security reasons.`,
      variant: 'destructive',
    });

    // Set timer to unlock
    lockoutTimerRef.current = setTimeout(() => {
      setIsLocked(false);
      setLockoutEndTime(null);
      setFailedAttempts(0);
      sessionStorage.removeItem('switchUserLockout');
    }, LOCKOUT_DURATION);
  }, [toast]);

  const handleSwitchUser = async () => {
    if (!selectedUser || !password.trim() || !currentUser || !currentUser.email) {
      toast({ 
        title: 'Error', 
        description: 'Please select a user and enter your password.', 
        variant: 'destructive' 
      });
      return;
    }

    if (isLocked) {
      toast({
        title: 'Account Locked',
        description: 'Please wait before trying again.',
        variant: 'destructive',
      });
      return;
    }

    setIsSwitching(true);
    
    try {
      // Verify current user is still authenticated
      if (!auth.currentUser) {
        throw new Error('No authenticated user found');
      }

      // Re-authenticate the admin user with their own password
      const credential = EmailAuthProvider.credential(currentUser.email, password);
      await reauthenticateWithCredential(auth.currentUser, credential);
      
      // If re-authentication is successful, start the impersonation session
      sessionStorage.setItem('impersonationUserId', selectedUser.id);
      sessionStorage.setItem('originalAdminUser', JSON.stringify(currentUser));
      
      toast({
        title: 'Switched User',
        description: `You are now viewing as ${selectedUser.name}.`,
      });
      
      onOpenChange(false);
      resetDialog();
      
      // Reset failed attempts on success
      setFailedAttempts(0);
      sessionStorage.removeItem('switchUserLockout');
      
      // Use reload to ensure all states and contexts are reset correctly
      window.location.reload();
      
    } catch (error: any) {
      console.error('Error switching user:', error);
      
      const isAuthError = 
        error.code === 'auth/wrong-password' || 
        error.code === 'auth/invalid-credential' ||
        error.code === 'auth/invalid-login-credentials';
      
      if (isAuthError) {
        const newAttempts = failedAttempts + 1;
        setFailedAttempts(newAttempts);

        if (newAttempts >= MAX_SWITCH_ATTEMPTS) {
          handleLockout();
          setPassword('');
          return;
        }

        const remaining = MAX_SWITCH_ATTEMPTS - newAttempts;
        toast({
          title: 'Authentication Failed',
          description: `Incorrect password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
          variant: 'destructive',
        });
        
        setPassword('');
      } else if (error.code === 'auth/too-many-requests') {
        toast({
          title: 'Too Many Requests',
          description: 'Please wait a moment before trying again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Switch Failed',
          description: 'An unexpected error occurred. Please try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSwitching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && selectedUser && password && !isLocked && !isSwitching) {
      handleSwitchUser();
    }
  };

  const getInitials = (name: string | undefined | null) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };
  
  const filteredUsers = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();
    
    if (!search) return users;
    
    return users.filter(user => 
      user.name?.toLowerCase().includes(search) || 
      user.email?.toLowerCase().includes(search) ||
      user.role?.toLowerCase().includes(search)
    );
  }, [users, searchTerm]);

  const getLockoutTimeRemaining = () => {
    if (!lockoutEndTime) return '';
    const remaining = Math.ceil((lockoutEndTime - Date.now()) / 1000);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog 
      open={isOpen} 
      onOpenChange={(open) => {
        if (!open) resetDialog();
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-orange-500" />
            Switch User
          </DialogTitle>
          <DialogDescription>
            Select a user to impersonate. You will need to enter your admin password to confirm.
          </DialogDescription>
        </DialogHeader>

        {isLocked && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Account locked due to multiple failed attempts. Time remaining: {getLockoutTimeRemaining()}
            </AlertDescription>
          </Alert>
        )}

        <div className="relative mt-4">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
            disabled={isLocked}
          />
        </div>

        <ScrollArea className="h-64 mt-4 pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Search className="h-12 w-12 mb-2 opacity-50" />
              <p className="text-sm">
                {searchTerm ? 'No users found matching your search.' : 'No users available.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map(user => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => !isLocked && setSelectedUser(user)}
                  disabled={isLocked}
                  className={`w-full p-3 rounded-md cursor-pointer flex items-center gap-3 text-left transition-all ${
                    selectedUser?.id === user.id 
                      ? 'bg-primary/20 ring-2 ring-primary' 
                      : 'hover:bg-muted'
                  } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Avatar>
                    <AvatarImage src={user.photoURL} alt={user.name} />
                    <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{user.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                    {user.role && (
                      <p className="text-xs text-muted-foreground mt-0.5 capitalize">{user.role}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {selectedUser && (
          <div className="mt-4 space-y-2">
            <Label htmlFor="admin-password">
              Enter your admin password to confirm
            </Label>
            <Input
              ref={passwordInputRef}
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Your password..."
              disabled={isLocked || isSwitching}
              autoComplete="current-password"
            />
            {failedAttempts > 0 && !isLocked && (
              <p className="text-xs text-orange-500">
                {MAX_SWITCH_ATTEMPTS - failedAttempts} attempt{MAX_SWITCH_ATTEMPTS - failedAttempts !== 1 ? 's' : ''} remaining
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button 
              type="button" 
              variant="outline"
              disabled={isSwitching}
            >
              Cancel
            </Button>
          </DialogClose>
          <Button 
            type="button" 
            onClick={handleSwitchUser} 
            disabled={!selectedUser || !password.trim() || isSwitching || isLocked}
          >
            {isSwitching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Switch to {selectedUser?.name || 'User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}