
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
import type { User, SavedUser } from '@/lib/types';

interface PinSetupDialogProps {
  user: User;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onPinSet: () => void;
}

export function PinSetupDialog({ user, isOpen, onOpenChange, onPinSet }: PinSetupDialogProps) {
  const { toast } = useToast();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<string>>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length <= 4) {
      setter(value);
      setError('');
    }
  };

  const handleSavePin = async () => {
    if (pin.length !== 4) {
      setError('PIN must be 4 digits.');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs do not match.');
      return;
    }
    setIsSaving(true);
    setError('');

    const tempPassword = sessionStorage.getItem('tempPassword');
    if (!tempPassword) {
      toast({
        title: 'Error',
        description: 'Could not save PIN. Please sign in again.',
        variant: 'destructive',
      });
      setIsSaving(false);
      return;
    }
    
    try {
        const savedUsers: SavedUser[] = JSON.parse(localStorage.getItem('savedUsers') || '[]');
        
        const newUser: SavedUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            photoURL: user.photoURL || '',
            pin: pin,
            password: btoa(tempPassword), // Base64 encode for simple obfuscation. NOT secure for production.
        };

        const existingUserIndex = savedUsers.findIndex(u => u.id === user.id);
        if (existingUserIndex > -1) {
            savedUsers[existingUserIndex] = newUser;
        } else {
            savedUsers.push(newUser);
        }

        localStorage.setItem('savedUsers', JSON.stringify(savedUsers));
        sessionStorage.removeItem('tempPassword');
        toast({ title: 'PIN Saved!', description: 'You can now use your PIN to sign in on this device.' });
        onPinSet();
        onOpenChange(false);

    } catch (error) {
        console.error("Error saving PIN to localStorage", error);
        toast({ title: 'Error', description: 'Failed to save PIN.', variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set Up Your PIN</DialogTitle>
          <DialogDescription>
            Create a 4-digit PIN for faster sign-in on this device.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
            <Input
              type="password"
              maxLength={4}
              value={pin}
              onChange={(e) => handlePinChange(e, setPin)}
              placeholder="PIN"
              className="text-center text-2xl tracking-[1rem] h-14"
            />
             <Input
              type="password"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => handlePinChange(e, setConfirmPin)}
              placeholder="Confirm PIN"
              className="text-center text-2xl tracking-[1rem] h-14"
            />
            {error && <p className="text-destructive text-sm mt-2 text-center">{error}</p>}
        </div>
        <Button onClick={handleSavePin} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save PIN
        </Button>
      </DialogContent>
    </Dialog>
  );
}
