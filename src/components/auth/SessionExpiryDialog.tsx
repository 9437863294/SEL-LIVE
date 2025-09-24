
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { EmailAuthProvider, reauthenticateWithCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';


interface SessionExpiryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSessionExtend: () => void;
  onLogout: () => void;
}

export function SessionExpiryDialog({ isOpen, onOpenChange, onSessionExtend, onLogout }: SessionExpiryDialogProps) {
  const { user, savedUsers } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [authMethod, setAuthMethod] = useState<'pin' | 'password'>('pin');

  const savedUser = useMemo(() => {
    if (!user) return null;
    return savedUsers.find(su => su.id === user.id);
  }, [user, savedUsers]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen) {
      setCountdown(60);
      // Prefer PIN if available, otherwise default to password
      setAuthMethod(savedUser ? 'pin' : 'password');
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            onOpenChange(false);
            onLogout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isOpen, onLogout, savedUser, onOpenChange]);

  const handleExtendWithPassword = async () => {
    if (!user || !user.email || !password) {
      toast({ title: 'Password is required.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);

    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(auth.currentUser!, credential);
      
      onSessionExtend();
      toast({ title: 'Session Extended!', description: 'You can continue working.' });
      setPassword('');
      setPin('');
      onOpenChange(false);

    } catch (error: any) {
      console.error("Re-authentication error:", error);
      toast({
        title: 'Authentication Failed',
        description: 'Incorrect password. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleExtendWithPin = async () => {
    if (!user || !pin || !savedUser || !savedUser.password) {
      toast({ title: 'PIN is required.', variant: 'destructive' });
      return;
    }
    if (pin !== savedUser.pin) {
        toast({ title: 'Incorrect PIN', variant: 'destructive' });
        setIsLoading(false);
        return;
    }

    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, savedUser.email, atob(savedUser.password));
      onSessionExtend();
      toast({ title: 'Session Extended!', description: 'You can continue working.' });
      setPassword('');
      setPin('');
      onOpenChange(false);
    } catch (error) {
      console.error("PIN re-authentication error:", error);
      toast({ title: 'Authentication Failed', description: 'Could not extend session with PIN.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (authMethod === 'pin') {
        handleExtendWithPin();
    } else {
        handleExtendWithPassword();
    }
  }

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      onLogout();
    }
    onOpenChange(open);
  }

  const getInitials = (name: string | undefined | null) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="sm:max-w-xs text-center p-8" onInteractOutside={(e) => e.preventDefault()}>
         <form onSubmit={handleAction}>
            <DialogHeader className="flex flex-col items-center">
                <Avatar className="h-24 w-24 mb-4">
                    <AvatarImage src={user?.photoURL || undefined} alt={user?.name || 'User'} />
                    <AvatarFallback className="text-3xl">{getInitials(user?.name)}</AvatarFallback>
                </Avatar>
                <DialogTitle className="text-2xl font-semibold">{user?.name}</DialogTitle>
                <p className="text-muted-foreground text-sm pt-2">
                    Your session has expired. To continue, please sign in.
                </p>
                <p className="text-xs text-destructive">Auto-logout in {countdown}s</p>
            </DialogHeader>
            <div className="py-6 space-y-4">
                {authMethod === 'pin' ? (
                     <div className="relative w-full">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">PIN</span>
                        <Input
                            id="session-pin"
                            type="password"
                            maxLength={4}
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                            className="text-center text-xl tracking-[1rem] pl-12 border-0 border-b-2 rounded-none border-primary/50 focus-visible:ring-0 focus-visible:border-primary"
                        />
                     </div>
                ) : (
                     <div className="relative w-full">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">Password</span>
                        <Input
                            id="session-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="pl-20 border-0 border-b-2 rounded-none border-primary/50 focus-visible:ring-0 focus-visible:border-primary"
                        />
                    </div>
                )}
                 <Button type="submit" className="w-full !mt-6" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign In
                </Button>
                {savedUser && (
                     <Button type="button" variant="link" className="mt-4 text-muted-foreground" onClick={() => setAuthMethod(authMethod === 'pin' ? 'password' : 'pin')}>
                        Sign-in options
                    </Button>
                )}
            </div>
         </form>
      </DialogContent>
    </Dialog>
  );
}
