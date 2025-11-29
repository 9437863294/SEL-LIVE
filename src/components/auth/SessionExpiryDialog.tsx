
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { EmailAuthProvider, reauthenticateWithCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

// Configuration
const COUNTDOWN_DURATION = 60; // seconds
const MAX_PIN_ATTEMPTS = 5;

interface SessionExpiryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSessionExtend: () => void;
  onLogout: () => void;
}

export function SessionExpiryDialog({ 
  isOpen, 
  onOpenChange, 
  onSessionExtend, 
  onLogout 
}: SessionExpiryDialogProps) {
  const { user, savedUsers } = useAuth();
  const { toast } = useToast();
  
  // Form state
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_DURATION);
  const [authMethod, setAuthMethod] = useState<'pin' | 'password'>('pin');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);

  // Refs for cleanup
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const savedUser = useMemo(() => {
    if (!user) return null;
    return savedUsers.find(su => su.id === user.id);
  }, [user, savedUsers]);

  // Clear countdown timer
  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  // Handle dialog close
  const handleDialogClose = useCallback((open: boolean) => {
    if (!open) {
      clearCountdownTimer();
      onLogout();
    }
    onOpenChange(open);
  }, [onLogout, onOpenChange, clearCountdownTimer]);

  // Initialize dialog state when opened
  useEffect(() => {
    if (!isOpen) {
      // Reset state when dialog closes
      setPassword('');
      setPin('');
      setFailedAttempts(0);
      setIsLocked(false);
      setIsLoading(false);
      clearCountdownTimer();
      return;
    }

    // Dialog is opening - initialize state
    setCountdown(COUNTDOWN_DURATION);
    setAuthMethod(savedUser ? 'pin' : 'password');
    setPassword('');
    setPin('');
    setFailedAttempts(0);
    setIsLocked(false);

    // Start countdown timer
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearCountdownTimer();
          handleDialogClose(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearCountdownTimer();
  }, [isOpen, savedUser, clearCountdownTimer, handleDialogClose]);

  // Auto-focus input when auth method changes
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, authMethod]);

  const handleExtendWithPassword = async () => {
    if (!user || !user.email || !password.trim()) {
      toast({ 
        title: 'Password Required', 
        description: 'Please enter your password.',
        variant: 'destructive' 
      });
      return;
    }

    setIsLoading(true);

    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      
      if (!auth.currentUser) {
        throw new Error('No authenticated user found');
      }

      await reauthenticateWithCredential(auth.currentUser, credential);
      
      onSessionExtend();
      toast({ 
        title: 'Session Extended', 
        description: 'You can continue working.' 
      });
      
      // Reset form and close
      setPassword('');
      setPin('');
      setFailedAttempts(0);
      onOpenChange(false);

    } catch (error: any) {
      console.error('Re-authentication error:', error);
      
      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);

      if (newAttempts >= MAX_PIN_ATTEMPTS) {
        setIsLocked(true);
        toast({
          title: 'Too Many Failed Attempts',
          description: 'You will be logged out for security.',
          variant: 'destructive'
        });
        setTimeout(() => handleDialogClose(false), 2000);
        return;
      }

      const remainingAttempts = MAX_PIN_ATTEMPTS - newAttempts;
      toast({
        title: 'Authentication Failed',
        description: `Incorrect password. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
        variant: 'destructive'
      });
      
      setPassword('');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleExtendWithPin = async () => {
    if (!user || !pin.trim() || !savedUser) {
      toast({ 
        title: 'PIN Required', 
        description: 'Please enter your 4-digit PIN.',
        variant: 'destructive' 
      });
      return;
    }

    if (pin.length !== 4) {
      toast({ 
        title: 'Invalid PIN', 
        description: 'PIN must be 4 digits.',
        variant: 'destructive' 
      });
      return;
    }

    // Verify PIN
    if (pin !== savedUser.pin) {
      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);

      if (newAttempts >= MAX_PIN_ATTEMPTS) {
        setIsLocked(true);
        toast({
          title: 'Too Many Failed Attempts',
          description: 'You will be logged out for security.',
          variant: 'destructive'
        });
        setTimeout(() => handleDialogClose(false), 2000);
        return;
      }

      const remainingAttempts = MAX_PIN_ATTEMPTS - newAttempts;
      toast({ 
        title: 'Incorrect PIN',
        description: `${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
        variant: 'destructive' 
      });
      
      setPin('');
      return;
    }

    if (!savedUser.password) {
      toast({ 
        title: 'Error', 
        description: 'Saved credentials not found.',
        variant: 'destructive' 
      });
      return;
    }

    setIsLoading(true);

    try {
      // Decode and re-authenticate
      const decodedPassword = atob(savedUser.password);
      await signInWithEmailAndPassword(auth, savedUser.email, decodedPassword);
      
      onSessionExtend();
      toast({ 
        title: 'Session Extended', 
        description: 'You can continue working.' 
      });
      
      // Reset form and close
      setPassword('');
      setPin('');
      setFailedAttempts(0);
      onOpenChange(false);

    } catch (error: any) {
      console.error('PIN re-authentication error:', error);
      
      toast({ 
        title: 'Authentication Failed', 
        description: 'Could not extend session. Please try password.',
        variant: 'destructive' 
      });
      
      // Switch to password method
      setAuthMethod('password');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isLocked || isLoading) return;

    if (authMethod === 'pin') {
      await handleExtendWithPin();
    } else {
      await handleExtendWithPassword();
    }
  };

  const toggleAuthMethod = () => {
    setAuthMethod(prev => prev === 'pin' ? 'password' : 'pin');
    setPassword('');
    setPin('');
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

  const getCountdownColor = () => {
    if (countdown <= 10) return 'text-destructive';
    if (countdown <= 30) return 'text-orange-500';
    return 'text-muted-foreground';
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent 
        className="sm:max-w-xs text-center p-8" 
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader className="flex flex-col items-center">
            <Avatar className="h-24 w-24 mb-4">
              <AvatarImage 
                src={user?.photoURL || undefined} 
                alt={user?.name || 'User'} 
              />
              <AvatarFallback className="text-3xl">
                {getInitials(user?.name)}
              </AvatarFallback>
            </Avatar>
            
            <DialogTitle className="text-2xl font-semibold">
              {user?.name || 'User'}
            </DialogTitle>
            
            <p className="text-muted-foreground text-sm pt-2">
              Your session has expired. To continue, please sign in.
            </p>
            
            <p className={`text-xs font-medium ${getCountdownColor()}`}>
              Auto-logout in {countdown}s
            </p>

            {isLocked && (
              <div className="flex items-center gap-2 text-destructive text-sm mt-2">
                <AlertCircle className="h-4 w-4" />
                <span>Too many failed attempts</span>
              </div>
            )}
          </DialogHeader>

          <div className="py-6 space-y-4">
            {authMethod === 'pin' ? (
              <div className="relative w-full">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                  PIN
                </span>
                <Input
                  ref={inputRef}
                  id="session-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                  disabled={isLoading || isLocked}
                  className="text-center text-xl tracking-[1rem] pl-12 border-0 border-b-2 rounded-none border-primary/50 focus-visible:ring-0 focus-visible:border-primary disabled:opacity-50"
                  placeholder="••••"
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="relative w-full">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                  Password
                </span>
                <Input
                  ref={inputRef}
                  id="session-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading || isLocked}
                  className="pl-24 border-0 border-b-2 rounded-none border-primary/50 focus-visible:ring-0 focus-visible:border-primary disabled:opacity-50"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full !mt-6" 
              disabled={isLoading || isLocked}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>

            {savedUser && !isLocked && (
              <Button 
                type="button" 
                variant="link" 
                className="mt-4 text-muted-foreground text-sm"
                onClick={toggleAuthMethod}
                disabled={isLoading}
              >
                {authMethod === 'pin' 
                  ? 'Use password instead' 
                  : 'Use PIN instead'}
              </Button>
            )}

            {failedAttempts > 0 && failedAttempts < MAX_PIN_ATTEMPTS && (
              <p className="text-xs text-muted-foreground">
                {MAX_PIN_ATTEMPTS - failedAttempts} attempt{MAX_PIN_ATTEMPTS - failedAttempts !== 1 ? 's' : ''} remaining
              </p>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
