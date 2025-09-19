
'use client';

import { useState } from 'react';
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
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import type { SavedUser } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

interface PinDialogProps {
  user: SavedUser;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function PinDialog({ user, isOpen, onOpenChange }: PinDialogProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length <= 4) {
      setPin(value);
      setError('');
    }
  };
  
  const handlePinSubmit = async () => {
    if (pin.length !== 4) {
      setError('PIN must be 4 digits.');
      return;
    }
    setIsLoading(true);
    setError('');

    // In a real app, you would not store the password. You'd likely use a custom token
    // system or another auth method. For this prototype, we're using the stored password.
    // This is NOT secure for production.
    if (pin !== user.pin) {
        setTimeout(() => { // Simulate network delay
            setError('Incorrect PIN. Please try again.');
            setIsLoading(false);
            setPin('');
        }, 500);
        return;
    }

    try {
      await signInWithEmailAndPassword(auth, user.email, atob(user.password));
      toast({
        title: 'Success',
        description: `Welcome back, ${user.name}!`,
      });
      onOpenChange(false);
      router.push('/');
    } catch (error: any) {
      console.error('PIN Sign In Failed:', error);
      toast({
        title: 'Sign In Failed',
        description: 'An unexpected error occurred. Please try signing in with your password.',
        variant: 'destructive',
      });
      setIsLoading(false);
    }
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs text-center p-8">
        <div className="flex flex-col items-center gap-4">
            <Avatar className="h-24 w-24">
                <AvatarImage src={user.photoURL} alt={user.name} />
                <AvatarFallback className="text-3xl">{getInitials(user.name)}</AvatarFallback>
            </Avatar>
            <DialogTitle className="text-xl">{user.name}</DialogTitle>
            <Input
              type="password"
              maxLength={4}
              value={pin}
              onChange={handlePinChange}
              onKeyDown={(e) => e.key === 'Enter' && handlePinSubmit()}
              placeholder="Enter PIN"
              className="text-center text-2xl tracking-[1rem] h-14"
            />
             {error && <p className="text-destructive text-sm mt-2">{error}</p>}
             <Button onClick={handlePinSubmit} disabled={isLoading || pin.length !== 4} className="w-full">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
            </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
