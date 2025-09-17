

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { Chat } from '@/lib/types';
import { useAuth } from './auth/AuthProvider';
import { MoreHorizontal, Shield, UserPlus, Edit, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';

interface GroupChatDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  chat: Chat | null;
}

export function GroupChatDetailsDialog({ isOpen, onOpenChange, chat }: GroupChatDetailsDialogProps) {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();

  const getInitials = (name?: string) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  if (!chat || chat.type !== 'group' || !currentUser) return null;

  const isAdmin = chat.groupAdmins?.includes(currentUser.id);

  const handleUpdateAdmins = async (memberId: string, action: 'add' | 'remove') => {
    const chatRef = doc(db, 'chats', chat.id);
    try {
      await updateDoc(chatRef, {
        groupAdmins: action === 'add' ? arrayUnion(memberId) : arrayRemove(memberId)
      });
      toast({ title: 'Success', description: `Admin status updated.` });
      // Note: This won't reflect immediately in the dialog without re-fetching chat data.
      // A real-time listener on the chat document would be needed for instant UI updates.
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Error', description: 'Could not update admin status.', variant: 'destructive' });
    }
  };
  
  const handleRemoveMember = async (memberId: string) => {
     const chatRef = doc(db, 'chats', chat.id);
     const memberToRemove = chat.memberDetails.find(m => m.id === memberId);
     if (!memberToRemove) return;
     try {
         await updateDoc(chatRef, {
             members: arrayRemove(memberId),
             memberDetails: arrayRemove(memberToRemove)
         });
         toast({ title: 'Success', description: `${memberToRemove.name} has been removed from the group.` });
         onOpenChange(false);
     } catch (e) {
        toast({ title: 'Error', description: 'Could not remove member.', variant: 'destructive' });
     }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex flex-col items-center gap-4 relative">
            {isAdmin && (
                <Button variant="ghost" size="icon" className="absolute top-0 right-0 h-8 w-8">
                    <Edit className="h-4 w-4" />
                </Button>
            )}
            <Avatar className="h-20 w-20">
              <AvatarImage src={chat.groupPhotoURL} />
              <AvatarFallback className="text-3xl">{getInitials(chat.groupName)}</AvatarFallback>
            </Avatar>
            <DialogTitle className="text-2xl">{chat.groupName}</DialogTitle>
            <DialogDescription>{chat.memberDetails.length} members</DialogDescription>
          </div>
        </DialogHeader>
        <div className="py-4">
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">Members</h4>
            <ScrollArea className="h-64 border rounded-md">
                 <div className="p-2 space-y-1">
                    {chat.memberDetails.map(member => {
                        const memberIsAdmin = chat.groupAdmins?.includes(member.id);
                        return (
                            <div key={member.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-8 w-8">
                                        <AvatarImage src={member.photoURL} />
                                        <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="font-medium text-sm">{member.name}</p>
                                        {member.id === currentUser?.id && <p className="text-xs text-muted-foreground">You</p>}
                                    </div>
                                </div>
                                <div className="flex items-center">
                                    {memberIsAdmin && <Badge variant="secondary" className="mr-2">Admin</Badge>}
                                    {isAdmin && member.id !== currentUser.id && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {!memberIsAdmin ? (
                                                    <DropdownMenuItem onSelect={() => handleUpdateAdmins(member.id, 'add')}>
                                                        <Shield className="mr-2 h-4 w-4" /> Make Admin
                                                    </DropdownMenuItem>
                                                ) : (
                                                    <DropdownMenuItem onSelect={() => handleUpdateAdmins(member.id, 'remove')}>
                                                         <Shield className="mr-2 h-4 w-4" /> Dismiss as Admin
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuItem onSelect={() => handleRemoveMember(member.id)} className="text-destructive">
                                                     <Trash2 className="mr-2 h-4 w-4" /> Remove from Group
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                 </div>
            </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="destructive">Leave Group</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
