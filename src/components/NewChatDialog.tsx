
'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { Loader2, Search, Users, UserPlus } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { useAuth } from './auth/AuthProvider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Checkbox } from './ui/checkbox';

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
  
  // Group chat state
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

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
  
  const toggleMemberSelection = (userId: string) => {
    setSelectedMembers(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(userId)) {
            newSelection.delete(userId);
        } else {
            newSelection.add(userId);
        }
        return newSelection;
    });
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMembers.size === 0 || !currentUser) return;
    
    const memberIds = [currentUser.id, ...Array.from(selectedMembers)];
    const memberDetails = [currentUser, ...users.filter(u => selectedMembers.has(u.id))].map(u => ({
        id: u.id,
        name: u.name,
        photoURL: u.photoURL || '',
    }));
    
    try {
        await addDoc(collection(db, 'chats'), {
            type: 'group',
            groupName,
            members: memberIds,
            memberDetails,
            groupAdmin: currentUser.id,
            lastMessage: {
                text: `${currentUser.name} created the group "${groupName}"`,
                senderId: 'system',
                timestamp: serverTimestamp(),
            }
        });
        onOpenChange(false);
    } catch(e) {
        console.error("Error creating group:", e);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <Tabs defaultValue="one-to-one">
          <DialogHeader>
            <DialogTitle>New Chat</DialogTitle>
            <TabsList className="grid w-full grid-cols-2 mt-2">
              <TabsTrigger value="one-to-one"><UserPlus className="mr-2 h-4 w-4" />One-to-One</TabsTrigger>
              <TabsTrigger value="group"><Users className="mr-2 h-4 w-4" />New Group</TabsTrigger>
            </TabsList>
          </DialogHeader>
          <TabsContent value="one-to-one">
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
          </TabsContent>
          <TabsContent value="group">
             <div className="space-y-4">
                <Input 
                    placeholder="Group Name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                />
                <div className="relative">
                     <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                     <Input
                        placeholder="Search users to add..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8"
                    />
                </div>
                 <ScrollArea className="h-60 mt-4 border rounded-md">
                    <div className="p-2 space-y-1">
                        {filteredUsers.map(user => (
                            <div key={user.id} className="flex items-center p-2 rounded-md hover:bg-muted gap-3">
                               <Checkbox 
                                    id={`member-${user.id}`}
                                    checked={selectedMembers.has(user.id)}
                                    onCheckedChange={() => toggleMemberSelection(user.id)}
                                />
                               <label htmlFor={`member-${user.id}`} className="flex items-center gap-3 cursor-pointer flex-1">
                                 <Avatar className="h-8 w-8">
                                    <AvatarImage src={user.photoURL} />
                                    <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                                 </Avatar>
                                 <div>
                                    <p className="font-medium text-sm">{user.name}</p>
                                 </div>
                               </label>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleCreateGroup} disabled={!groupName.trim() || selectedMembers.size === 0}>Create Group</Button>
                </DialogFooter>
             </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
