
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
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { Loader2, Search } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { useAuth } from './AuthProvider';

interface SwitchUserDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function SwitchUserDialog({ isOpen, onOpenChange }: SwitchUserDialogProps) {
  const { toast } = useToast();
  const { user: currentUser, refreshUserData } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [password, setPassword] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  useEffect(() => {
    if (isOpen) {
      const fetchUsers = async () => {
        setIsLoading(true);
        try {
          const usersSnapshot = await getDocs(collection(db, 'users'));
          const usersData = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
          setUsers(usersData);
        } catch (error) {
          toast({ title: 'Error', description: 'Could not fetch users.', variant: 'destructive' });
        }
        setIsLoading(false);
      };
      fetchUsers();
    }
  }, [isOpen, toast]);
  
  const resetDialog = () => {
    setSearchTerm('');
    setPassword('');
    setSelectedUser(null);
  };

  const handleSwitchUser = async () => {
    if (!selectedUser || !password || !currentUser || !currentUser.email) {
        toast({ title: "Error", description: "An unexpected error occurred. Please try again.", variant: "destructive" });
        return;
    }
    setIsSwitching(true);
    
    try {
        // Re-authenticate the admin user with their own password
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(auth.currentUser!, credential);
        
        // If re-authentication is successful, start the impersonation session
        sessionStorage.setItem('impersonationUserId', selectedUser.id);
        sessionStorage.setItem('originalAdminUser', JSON.stringify(currentUser));
        
        toast({
            title: "Switched User",
            description: `You are now viewing the application as ${selectedUser.name}.`,
        });
        
        onOpenChange(false);
        resetDialog();
        refreshUserData(); // Trigger the provider to update context based on session storage
        
    } catch (error: any) {
        console.error("Error switching user:", error);
        const isWrongPassword = error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential';
        toast({
            title: "Switch Failed",
            description: isWrongPassword
                ? 'Your admin password was incorrect.' 
                : 'Could not switch user.',
            variant: "destructive",
        });
    } finally {
        setIsSwitching(false);
    }
  };

  const getInitials = (name: string | undefined | null) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };
  
  const filteredUsers = users.filter(user => 
      user.id !== currentUser?.id &&
      (user.name.toLowerCase().includes(searchTerm.toLowerCase()) || user.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
        if(!open) resetDialog();
        onOpenChange(open);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch User</DialogTitle>
          <DialogDescription>
            Select a user to impersonate. You will need to enter your own password to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="relative mt-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
                placeholder="Search for a user..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
            />
        </div>
        <ScrollArea className="h-64 mt-4">
            {isLoading ? <Loader2 className="mx-auto h-8 w-8 animate-spin" /> : (
                <div className="space-y-2">
                    {filteredUsers.map(user => (
                        <div 
                            key={user.id}
                            onClick={() => setSelectedUser(user)}
                            className={`p-2 rounded-md cursor-pointer flex items-center gap-3 ${selectedUser?.id === user.id ? 'bg-primary/20 ring-2 ring-primary' : 'hover:bg-muted'}`}
                        >
                           <Avatar>
                                <AvatarImage src={user.photoURL} />
                                <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                           </Avatar>
                           <div>
                                <p className="font-medium">{user.name}</p>
                                <p className="text-sm text-muted-foreground">{user.email}</p>
                           </div>
                        </div>
                    ))}
                </div>
            )}
        </ScrollArea>
        {selectedUser && (
            <div className="mt-4 space-y-2">
                <Label htmlFor="password">Enter your admin password to confirm</Label>
                <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password..."
                />
            </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleSwitchUser} disabled={!selectedUser || !password || isSwitching}>
            {isSwitching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Switch to {selectedUser?.name || 'User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
