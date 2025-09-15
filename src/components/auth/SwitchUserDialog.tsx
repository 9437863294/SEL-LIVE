
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
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useAuth } from './AuthProvider';

interface SwitchUserDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function SwitchUserDialog({ isOpen, onOpenChange }: SwitchUserDialogProps) {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
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

  const handleSwitchUser = async () => {
    if (!selectedUser || !password) {
        toast({ title: "Error", description: "Please enter the password for the selected user.", variant: "destructive" });
        return;
    }
    setIsSwitching(true);

    const originalUserEmail = currentUser?.email;
    
    try {
        // Sign out the current user first
        await signOut(auth);

        // Sign in as the new user
        await signInWithEmailAndPassword(auth, selectedUser.email, password);
        
        toast({
            title: "Switched User",
            description: `Successfully signed in as ${selectedUser.name}.`,
        });

        onOpenChange(false);
        setPassword('');
        setSelectedUser(null);
        // The AuthProvider will handle refreshing user data and page reload
        
    } catch (error: any) {
        console.error("Error switching user:", error);
        toast({
            title: "Switch Failed",
            description: "Could not sign in as the selected user. Check the password and try again.",
            variant: "destructive",
        });
        
        // Attempt to sign back in as the original user
        if (originalUserEmail) {
            // This is tricky without the original user's password.
            // For now, we'll just log the error and prompt them to re-login manually.
            console.error("Failed to automatically log back in as original user. Manual login required.");
        }
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
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch User</DialogTitle>
          <DialogDescription>
            Select a user to sign in as. You will need their password.
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
                <Label htmlFor="password">Password for {selectedUser.name}</Label>
                <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password..."
                />
            </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleSwitchUser} disabled={!selectedUser || !password || isSwitching}>
            {isSwitching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Switch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
