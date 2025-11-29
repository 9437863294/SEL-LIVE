
'use client';

import { useState, useEffect } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import type { User, SavedUser } from '@/lib/types';
import { useAuth } from './AuthProvider';
import { signInWithEmailAndPassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '@/lib/firebase';

interface PinSetupDialogProps {
  user: User;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onPinSet: () => void;
}

type Stage = 'initial' | 'verify' | 'passwordVerify' | 'set' | 'change';

export function PinSetupDialog({ user, isOpen, onOpenChange, onPinSet }: PinSetupDialogProps) {
  const { toast } = useToast();
  const { savedUsers } = useAuth();
  
  const [stage, setStage] = useState<Stage>('initial');
  const [oldPin, setOldPin] = useState('');
  const [password, setPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const savedUser = savedUsers.find(su => su.id === user.id);

  useEffect(() => {
    if (isOpen) {
      // Reset state when dialog opens
      setOldPin('');
      setPassword('');
      setNewPin('');
      setConfirmPin('');
      setError('');
      setIsSaving(false);
      setStage(savedUser ? 'verify' : 'set'); // Determine initial stage
    }
  }, [isOpen, savedUser]);

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<string>>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length <= 4) {
      setter(value);
      setError('');
    }
  };
  
  const handleVerify = () => {
    if (oldPin.length !== 4) {
        setError('PIN must be 4 digits.');
        return;
    }
    if (savedUser && oldPin === savedUser.pin) {
        setStage('change');
        setError('');
    } else {
        setError('Incorrect PIN.');
    }
  };
  
  const handlePasswordVerify = async () => {
    if (!password) {
      setError('Password is required.');
      return;
    }
    if (!auth.currentUser || !auth.currentUser.email) {
      setError('Could not verify user. Please sign in again.');
      return;
    }
    setIsSaving(true);
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
      await reauthenticateWithCredential(auth.currentUser, credential);
      setStage('change');
      setError('');
    } catch (error) {
      setError('Incorrect password. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePin = async () => {
    const pinToSave = newPin;
    const pinToConfirm = confirmPin;
    
    if (pinToSave.length !== 4) {
      setError('New PIN must be 4 digits.');
      return;
    }
    if (pinToSave !== pinToConfirm) {
      setError('PINs do not match.');
      return;
    }
    setIsSaving(true);
    setError('');

    const tempPassword = localStorage.getItem('tempPassword');
    const passwordToUse = tempPassword || (savedUser?.password ? atob(savedUser.password) : null);
    
    // We re-verify with password if it's a new pin setup without a temp password
    if (!passwordToUse) {
       setStage('passwordVerify');
       toast({
        title: 'Password Verification Required',
        description: 'For security, please enter your password to set up a new PIN.',
        variant: 'default',
       });
       setIsSaving(false);
       return;
    }
    
    try {
        const currentSavedUsers: SavedUser[] = JSON.parse(localStorage.getItem('savedUsers') || '[]');
        
        const newUserPinData: SavedUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            photoURL: user.photoURL || '',
            pin: pinToSave,
            password: btoa(passwordToUse),
        };

        const existingUserIndex = currentSavedUsers.findIndex(u => u.id === user.id);
        if (existingUserIndex > -1) {
            currentSavedUsers[existingUserIndex] = newUserPinData;
        } else {
            currentSavedUsers.push(newUserPinData);
        }

        localStorage.setItem('savedUsers', JSON.stringify(currentSavedUsers));
        if (tempPassword) localStorage.removeItem('tempPassword'); // Clean up temp password
        
        toast({ title: 'PIN Saved!', description: 'You can now use your PIN to sign in on this device.' });
        onPinSet(); // Refresh saved users in AuthProvider
        onOpenChange(false);

    } catch (error) {
        console.error("Error saving PIN to localStorage", error);
        toast({ title: 'Error', description: 'Failed to save PIN.', variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
  };

  const renderContent = () => {
    switch(stage) {
      case 'verify':
        return (
          <div className="space-y-4 py-4">
              <Input
                type="password"
                maxLength={4}
                value={oldPin}
                onChange={(e) => handlePinChange(e, setOldPin)}
                placeholder="Enter Old PIN"
                className="text-base"
              />
              <Button onClick={handleVerify} className="w-full">Verify</Button>
              <Button variant="link" className="w-full text-xs" onClick={() => setStage('passwordVerify')}>Forgot PIN?</Button>
          </div>
        );
      case 'passwordVerify':
        return (
           <div className="space-y-4 py-4">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter Your Password"
              />
              <Button onClick={handlePasswordVerify} disabled={isSaving} className="w-full">
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify Password
              </Button>
          </div>
        );
      case 'set':
      case 'change':
        return (
          <div className="space-y-4 py-4">
            <Input
              type="password"
              maxLength={4}
              value={newPin}
              onChange={(e) => handlePinChange(e, setNewPin)}
              placeholder="New PIN"
              className="text-base"
            />
            <Input
              type="password"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => handlePinChange(e, setConfirmPin)}
              placeholder="Confirm PIN"
              className="text-base"
            />
            <Button onClick={handleSavePin} disabled={isSaving} className="w-full">
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {stage === 'change' ? 'Change PIN' : 'Save PIN'}
            </Button>
          </div>
        );
      default:
        return null;
    }
  }
  
  const title = stage === 'set' ? 'Set Up Your PIN' : (stage === 'change' ? 'Set New PIN' : (stage === 'passwordVerify' ? 'Verify Password' : 'Verify Identity'));
  const description = stage === 'set' 
      ? 'Create a 4-digit PIN for faster sign-in on this device.' 
      : (stage === 'change' ? 'Enter your new 4-digit PIN.' : (stage === 'passwordVerify' ? 'Enter your account password to continue.' : 'Enter your old PIN to continue.'));


  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {renderContent()}
        {error && <p className="text-destructive text-sm mt-2 text-center">{error}</p>}
         <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
