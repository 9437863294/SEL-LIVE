
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
import {
  Loader2,
  Search,
  AlertCircle,
  ShieldAlert,
  Check,
  X,
  ChevronRight,
  Lock,
  UserRound,
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { cn } from '@/lib/utils';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { useAuth } from './AuthProvider';
import { Alert, AlertDescription } from '../ui/alert';

// Configuration
const MAX_SWITCH_ATTEMPTS = 3;
const LOCKOUT_DURATION = 300000; // 5 minutes in milliseconds

/**
 * Per-row entrance delay for the list reveal, and the row index it stops growing at — without a cap
 * a long directory would leave the last rows animating in seconds after the dialog opened.
 */
const ROW_STAGGER_MS = 30;
const ROW_STAGGER_CAP = 12;

/**
 * How the administrator proves who they are before impersonating someone.
 *
 * Not every account can answer a password prompt: an administrator who signed in with Google has
 * no `password` provider at all, so `EmailAuthProvider.credential(...)` could never verify for them
 * — the backend rejects it with `auth/invalid-credential` no matter what is typed, which read as
 * "wrong password" and locked the feature for those accounts entirely.
 */
type ReauthMethod = 'password' | 'google';

const PROVIDER_PASSWORD = 'password';
const PROVIDER_GOOGLE = 'google.com';

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
  const [reauthMethod, setReauthMethod] = useState<ReauthMethod>('password');
  // Drives the lockout countdown. Without it the remaining time was computed once at render and
  // then sat frozen until something else happened to re-render the dialog.
  const [tick, setTick] = useState(() => Date.now());

  // Refs
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const lockoutTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check if currently locked out
  useEffect(() => {
    const checkLockout = () => {
      const storedLockout = localStorage.getItem('switchUserLockout');
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
            localStorage.removeItem('switchUserLockout');
          }, timeRemaining);
        } else {
          // Lockout expired
          localStorage.removeItem('switchUserLockout');
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

  // Keep the lockout countdown moving while it is on screen.
  useEffect(() => {
    if (!isOpen || !isLocked || !lockoutEndTime) return;
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen, isLocked, lockoutEndTime]);

  // Decide how this administrator can confirm, from the providers actually on their auth account.
  useEffect(() => {
    if (!isOpen) return;

    const providers = auth.currentUser?.providerData.map((entry) => entry.providerId) ?? [];
    if (providers.includes(PROVIDER_PASSWORD)) {
      setReauthMethod('password');
    } else if (providers.includes(PROVIDER_GOOGLE)) {
      setReauthMethod('google');
    } else {
      // Unknown or no provider — keep the password prompt; the error handling below explains it.
      setReauthMethod('password');
    }
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
    localStorage.setItem('switchUserLockout', lockoutEnd.toString());

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
      localStorage.removeItem('switchUserLockout');
    }, LOCKOUT_DURATION);
  }, [toast]);

  /**
   * Re-verify the signed-in administrator.
   *
   * The email must come from `auth.currentUser`, not from the `users` document: the two can differ
   * (`AuthProvider` deliberately falls back to matching a user doc by email when the doc id is not
   * the uid), and a credential built for a different address than the account being re-verified is
   * rejected as `auth/invalid-credential` — again indistinguishable from a mistyped password.
   */
  const reauthenticateAdmin = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      throw new Error('No authenticated user found');
    }

    if (reauthMethod === 'google') {
      if (Capacitor.isNativePlatform()) {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const result = await FirebaseAuthentication.signInWithGoogle({
          useCredentialManager: false,
        } as any);
        const idToken = result.credential?.idToken;
        if (!idToken) {
          throw new Error('Google sign-in did not return an ID token.');
        }
        await reauthenticateWithCredential(firebaseUser, GoogleAuthProvider.credential(idToken));
        return;
      }

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account',
        ...(firebaseUser.email ? { login_hint: firebaseUser.email } : {}),
      });
      await reauthenticateWithPopup(firebaseUser, provider);
      return;
    }

    const email = firebaseUser.email || currentUser?.email;
    if (!email) {
      throw new Error('Your account has no email address on file.');
    }
    await reauthenticateWithCredential(
      firebaseUser,
      EmailAuthProvider.credential(email, password)
    );
  }, [currentUser?.email, password, reauthMethod]);

  const handleSwitchUser = async () => {
    if (!selectedUser || !currentUser || (reauthMethod === 'password' && !password.trim())) {
      toast({
        title: 'Error',
        description: reauthMethod === 'password'
          ? 'Please select a user and enter your password.'
          : 'Please select a user to switch to.',
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
      // Re-authenticate the admin with whichever method their account supports
      await reauthenticateAdmin();

      // If re-authentication is successful, start the impersonation session
      localStorage.setItem('impersonationUserId', selectedUser.id);
      localStorage.setItem('originalAdminUser', JSON.stringify(currentUser));
      
      toast({
        title: 'Switched User',
        description: `You are now viewing as ${selectedUser.name}.`,
      });
      
      onOpenChange(false);
      resetDialog();
      
      // Reset failed attempts on success
      setFailedAttempts(0);
      localStorage.removeItem('switchUserLockout');
      
      // Use reload to ensure all states and contexts are reset correctly
      window.location.reload();
      
    } catch (error: any) {
      const code: string = error?.code || '';

      // The administrator dismissed the Google window — not a failed attempt.
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/user-cancelled'
      ) {
        return;
      }

      console.error('Error switching user:', error);

      const isAuthError =
        reauthMethod === 'password' &&
        (code === 'auth/wrong-password' ||
          code === 'auth/invalid-credential' ||
          code === 'auth/invalid-login-credentials');

      // A rejected password on an account that has no password at all is not a wrong password,
      // and no number of retries will change it.
      const hasPasswordProvider =
        auth.currentUser?.providerData.some((entry) => entry.providerId === PROVIDER_PASSWORD) ?? true;

      if (isAuthError && !hasPasswordProvider) {
        toast({
          title: 'Password Not Supported',
          description:
            'This account signs in with an external provider, so it has no password. Contact your administrator to enable password sign-in.',
          variant: 'destructive',
        });
      } else if (code === 'auth/user-mismatch') {
        // Confirmed as somebody else — nothing to do with the password, so it must not count
        // towards the lockout.
        toast({
          title: 'Wrong Account',
          description: 'That is not the account you are signed in with. Confirm with your own account.',
          variant: 'destructive',
        });
      } else if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        toast({
          title: 'Popup Blocked',
          description: 'Allow popups for this site to confirm with Google, then try again.',
          variant: 'destructive',
        });
      } else if (isAuthError) {
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
      } else if (code === 'auth/too-many-requests') {
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

  const canConfirm =
    !!selectedUser &&
    !isSwitching &&
    !isLocked &&
    (reauthMethod === 'google' || password.trim().length > 0);

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

  const lockoutSecondsLeft = lockoutEndTime
    ? Math.max(0, Math.ceil((lockoutEndTime - tick) / 1000))
    : 0;

  const getLockoutTimeRemaining = () => {
    if (!lockoutEndTime) return '';
    const minutes = Math.floor(lockoutSecondsLeft / 60);
    const seconds = lockoutSecondsLeft % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const lockoutProgress = lockoutEndTime
    ? Math.min(100, Math.max(0, (lockoutSecondsLeft * 1000 * 100) / LOCKOUT_DURATION))
    : 0;

  const adminEmail = auth.currentUser?.email || currentUser?.email || '';
  const confirmLabel = reauthMethod === 'google' ? 'Confirm with Google' : 'Switch user';

  return (
    <Dialog 
      open={isOpen} 
      onOpenChange={(open) => {
        if (!open) resetDialog();
        onOpenChange(open);
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        {/* Header — tinted rather than plain, because impersonating another user is a privileged
            action and the screen should not look like an ordinary picker. */}
        <DialogHeader className="relative space-y-0 border-b bg-gradient-to-br from-amber-50 via-orange-50/60 to-background px-5 py-4 text-left dark:from-amber-950/40 dark:via-orange-950/20 dark:to-background">
          <div className="flex items-start gap-3 pr-8">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-orange-500/25">
              <span className="absolute inset-0 rounded-xl bg-amber-400/40 animate-pulse motion-reduce:animate-none" />
              <ShieldAlert className="relative h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base sm:text-lg">Switch User</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Pick someone to view the app as. You&apos;ll confirm with your own credentials first.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {isLocked && (
            <div className="px-5 pt-4">
              <Alert
                variant="destructive"
                className="animate-in fade-in slide-in-from-top-1 fill-mode-both duration-300 motion-reduce:animate-none"
              >
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="space-y-2">
                  <span className="block">
                    Locked after {MAX_SWITCH_ATTEMPTS} failed attempts — unlocks in{' '}
                    <span className="font-mono font-semibold tabular-nums">
                      {getLockoutTimeRemaining()}
                    </span>
                  </span>
                  <span
                    className="block h-1 overflow-hidden rounded-full bg-destructive/20"
                    role="presentation"
                  >
                    <span
                      className="block h-full rounded-full bg-destructive transition-[width] duration-1000 ease-linear"
                      style={{ width: `${lockoutProgress}%` }}
                    />
                  </span>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Search */}
          <div className="px-5 pt-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or role..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 pl-9 pr-9 transition-shadow focus-visible:shadow-sm"
                disabled={isLocked}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {!isLoading && users.length > 0 && (
              <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                {filteredUsers.length} of {users.length} users
              </p>
            )}
          </div>

          {/* User list */}
          {/* Shorter on small screens so the confirmation panel and footer stay on screen
              inside the dialog's 95vh cap. */}
          <ScrollArea className="mt-2 h-[13rem] max-h-[40vh] px-5 sm:h-[16rem] sm:max-h-[45vh]">
            {isLoading ? (
              <div className="space-y-2 py-1">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex animate-in fade-in items-center gap-3 rounded-xl p-2.5 fill-mode-both motion-reduce:animate-none"
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-1/3" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="flex h-full animate-in fade-in zoom-in-95 flex-col items-center justify-center gap-3 py-8 text-center fill-mode-both duration-300 motion-reduce:animate-none">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <UserRound className="h-7 w-7 text-muted-foreground" />
                </span>
                <p className="text-sm text-muted-foreground">
                  {searchTerm ? `No users match “${searchTerm}”.` : 'No users available.'}
                </p>
                {searchTerm && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSearchTerm('')}>
                    Clear search
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-1.5 py-1">
                {filteredUsers.map((user, index) => {
                  const isSelected = selectedUser?.id === user.id;
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => !isLocked && setSelectedUser(user)}
                      disabled={isLocked}
                      aria-pressed={isSelected}
                      className={cn(
                        'group relative flex w-full items-center gap-3 rounded-xl border p-2.5 text-left',
                        // One `duration-200` on purpose: tailwindcss-animate's `duration-*` sets
                        // animation-duration alongside Tailwind's transition-duration, and a second
                        // duration class would just be dropped by tailwind-merge.
                        'animate-in fade-in slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none',
                        'transition-[background-color,border-color,box-shadow,transform] duration-200',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        isSelected
                          ? 'border-primary/40 bg-primary/10 shadow-sm'
                          : 'border-transparent hover:border-border hover:bg-muted/70',
                        isLocked
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer active:scale-[0.99] motion-reduce:active:scale-100'
                      )}
                      style={{
                        animationDelay: `${Math.min(index, ROW_STAGGER_CAP) * ROW_STAGGER_MS}ms`,
                      }}
                    >
                      <span className="relative shrink-0">
                        <Avatar
                          className={cn(
                            'h-10 w-10 ring-2 ring-offset-2 ring-offset-background transition-all duration-200',
                            isSelected ? 'ring-primary' : 'ring-transparent group-hover:ring-border'
                          )}
                        >
                          <AvatarImage src={user.photoURL} alt={user.name} />
                          <AvatarFallback className="text-xs font-semibold">
                            {getInitials(user.name)}
                          </AvatarFallback>
                        </Avatar>
                        {isSelected && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 animate-in zoom-in-50 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background fill-mode-both motion-reduce:animate-none">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          </span>
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      </div>

                      {user.role && (
                        <Badge
                          variant="secondary"
                          className="max-w-[5rem] shrink-0 px-2 py-0 text-[10px] font-medium capitalize sm:max-w-[8rem]"
                        >
                          <span className="truncate">{user.role}</span>
                        </Badge>
                      )}

                      <ChevronRight
                        className={cn(
                          'h-4 w-4 shrink-0 transition-all duration-200',
                          isSelected
                            ? 'text-primary opacity-100'
                            : '-translate-x-1 text-muted-foreground opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Confirmation — only appears once a target is chosen, so the list is never crowded
              by a prompt that has nothing to act on yet. */}
          {selectedUser && (
            <div
              // Re-keyed per selection so picking a different person replays the reveal instead of
              // silently swapping the name in place.
              key={selectedUser.id}
              className="animate-in fade-in slide-in-from-bottom-2 space-y-3 border-t bg-muted/30 px-5 py-4 fill-mode-both duration-300 motion-reduce:animate-none"
            >
              <div className="flex items-center gap-2.5">
                <Avatar className="h-9 w-9 shrink-0 ring-2 ring-primary/40 ring-offset-1 ring-offset-background">
                  <AvatarImage src={selectedUser.photoURL} alt={selectedUser.name} />
                  <AvatarFallback className="text-[10px] font-semibold">
                    {getInitials(selectedUser.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Switching to
                  </p>
                  <p className="truncate text-sm font-semibold">{selectedUser.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  Confirming as <span className="font-medium text-foreground">{adminEmail}</span>
                </span>
              </div>

              {reauthMethod === 'password' ? (
                <div className="space-y-2">
                  <Label htmlFor="admin-password" className="text-xs">
                    Your admin password
                  </Label>
                  <Input
                    ref={passwordInputRef}
                    id="admin-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter password to continue"
                    disabled={isLocked || isSwitching}
                    autoComplete="current-password"
                    className="h-10"
                  />
                  {failedAttempts > 0 && !isLocked && (
                    <p className="animate-in fade-in slide-in-from-left-1 text-xs font-medium text-orange-500 fill-mode-both motion-reduce:animate-none">
                      {MAX_SWITCH_ATTEMPTS - failedAttempts} attempt
                      {MAX_SWITCH_ATTEMPTS - failedAttempts !== 1 ? 's' : ''} remaining
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  You signed in with Google, so a Google window will open to confirm it&apos;s you.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 border-t px-5 py-4">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isSwitching}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={handleSwitchUser}
              disabled={!canConfirm}
              className="min-w-[9.5rem] transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
            >
              {isSwitching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Switching...
                </>
              ) : (
                <span className="truncate">{confirmLabel}</span>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
