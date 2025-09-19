
'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { EmailAuthProvider, reauthenticateWithCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

interface SessionExpiryDialogProps {
  isOpen: boolean;
  onSessionExtend: () => void;
  onLogout: () => void;
}

export function SessionExpiryDialog({ isOpen, onSessionExtend, onLogout }: SessionExpiryDialogProps) {
  const { user, savedUsers } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [activeTab, setActiveTab] = useState('password');

  const savedUser = useMemo(() => {
    if (!user) return null;
    return savedUsers.find(su => su.id === user.id);
  }, [user, savedUsers]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen) {
      setCountdown(60); 
      // Default to PIN if available, otherwise password
      setActiveTab(savedUser ? 'pin' : 'password');
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
  }, [isOpen, onLogout, savedUser]);

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
        return;
    }

    setIsLoading(true);
    try {
      // Re-authenticate silently using the stored (albeit insecurely) password
      await signInWithEmailAndPassword(auth, savedUser.email, atob(savedUser.password));
      onSessionExtend();
      toast({ title: 'Session Extended!', description: 'You can continue working.' });
      setPassword('');
      setPin('');
    } catch (error) {
      console.error("PIN re-authentication error:", error);
      toast({ title: 'Authentication Failed', description: 'Could not extend session with PIN.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = () => {
    if (activeTab === 'pin') {
        handleExtendWithPin();
    } else {
        handleExtendWithPassword();
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onLogout()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Your session has expired</DialogTitle>
          <DialogDescription>
            For your security, please re-authenticate to continue. You will be logged out in {countdown} seconds.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="password">Password</TabsTrigger>
                <TabsTrigger value="pin" disabled={!savedUser}>PIN</TabsTrigger>
            </TabsList>
            <TabsContent value="password">
                <div className="space-y-2 py-4">
                    <Label htmlFor="session-password">Password</Label>
                    <Input
                        id="session-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleExtendWithPassword()}
                        placeholder="Enter your password"
                    />
                </div>
            </TabsContent>
             <TabsContent value="pin">
                <div className="space-y-2 py-4">
                    <Label htmlFor="session-pin">PIN</Label>
                    <Input
                        id="session-pin"
                        type="password"
                        maxLength={4}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                        onKeyDown={(e) => e.key === 'Enter' && handleExtendWithPin()}
                        placeholder="Enter your 4-digit PIN"
                        className="text-center text-xl tracking-[1rem]"
                    />
                </div>
            </TabsContent>
        </Tabs>
        <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onLogout}>Logout</Button>
            <Button onClick={handleAction} disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continue Session
            </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
