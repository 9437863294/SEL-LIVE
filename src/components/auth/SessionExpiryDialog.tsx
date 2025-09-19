
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Label } from '../ui/label';

interface SessionExpiryDialogProps {
  isOpen: boolean;
  onSessionExtend: () => void;
  onLogout: () => void;
}

export function SessionExpiryDialog({ isOpen, onSessionExtend, onLogout }: SessionExpiryDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen) {
      setCountdown(60); // Reset countdown when dialog opens
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            onLogout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isOpen, onLogout]);

  const handleExtendSession = async () => {
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onLogout()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Your session has expired</DialogTitle>
          <DialogDescription>
            For your security, you need to re-enter your password to continue. You will be logged out in {countdown} seconds.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
            <Label htmlFor="session-password">Password</Label>
            <Input
                id="session-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExtendSession()}
                placeholder="Enter your password"
            />
        </div>
        <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onLogout}>Logout</Button>
            <Button onClick={handleExtendSession} disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continue Session
            </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
