
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { useAuth } from './auth/AuthProvider';

interface NewChatDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelectUser: (user: User) => void;
}

export function NewChatDialog({ isOpen, onOpenChange, onSelectUser }: NewChatDialogProps) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen) {
      const fetchUsers = async () => {
        setIsLoading(true);
        try {
          const usersSnapshot = await getDocs(collection(db, 'users'));
          const usersData = usersSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as User))
            .filter(user => user.id !== currentUser?.id); // Exclude current user
          setUsers(usersData);
        } catch (error) {
          console.error("Error fetching users for new chat:", error);
        }
        setIsLoading(false);
      };
      fetchUsers();
    }
  }, [isOpen, currentUser]);

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
          <DialogDescription>Select a user to start a conversation.</DialogDescription>
        </DialogHeader>
        <div className="relative mt-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
            />
        </div>
        <ScrollArea className="h-72 mt-4">
            {isLoading ? (
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : (
                <div className="space-y-2">
                    {filteredUsers.map(user => (
                        <div 
                            key={user.id}
                            onClick={() => onSelectUser(user)}
                            className="p-2 rounded-md cursor-pointer flex items-center gap-3 hover:bg-muted"
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
        <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
