

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { Chat } from '@/lib/types';
import { useAuth } from './auth/AuthProvider';
import { MoreHorizontal, Shield, UserPlus, Edit, Trash2, X, Image, Link as LinkIcon, FileText } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { format } from 'date-fns';

interface GroupChatDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  chat: Chat | null;
}

export function GroupChatDetailsDialog({ isOpen, onOpenChange, chat }: GroupChatDetailsDialogProps) {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const { users } = useAuth(); // Assuming useAuth provides a list of all users

  const getInitials = (name?: string) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  if (!chat || chat.type !== 'group' || !currentUser) return null;

  const isAdmin = chat.groupAdmins?.includes(currentUser.id);
  const creator = chat.memberDetails.find(m => m.id === chat.createdBy);
  const creationDate = chat.createdAt ? format(chat.createdAt.toDate(), 'dd/MM/yyyy') : 'N/A';

  const handleUpdateAdmins = async (memberId: string, action: 'add' | 'remove') => {
    const chatRef = doc(db, 'chats', chat.id);
    try {
      await updateDoc(chatRef, {
        groupAdmins: action === 'add' ? arrayUnion(memberId) : arrayRemove(memberId)
      });
      toast({ title: 'Success', description: `Admin status updated.` });
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
      <DialogContent className="sm:max-w-md p-0 gap-0">
        <DialogHeader className="p-4 flex-row items-center space-x-4 space-y-0">
           <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)}>
              <X className="h-5 w-5" />
           </Button>
           <h2 className="text-lg font-medium">Group info</h2>
        </DialogHeader>
        <ScrollArea className="max-h-[80vh]">
            <div className="flex flex-col items-center gap-2 p-6 border-b">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={chat.groupPhotoURL} />
                  <AvatarFallback className="text-4xl">{getInitials(chat.groupName)}</AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-semibold">{chat.groupName}</h1>
                    {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-7 w-7"><Edit className="h-4 w-4" /></Button>
                    )}
                </div>
                <p className="text-sm text-muted-foreground">Group · {chat.memberDetails.length} members</p>
            </div>
            
            <div className="p-6 space-y-4 border-b">
                <div className="flex items-center justify-between">
                    <p className="text-muted-foreground">{chat.groupDescription || "Add group description"}</p>
                     {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-7 w-7"><Edit className="h-4 w-4" /></Button>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                    Group created by {creator?.name || 'a user'}, on {creationDate}
                </p>
            </div>

            <div className="p-6 border-b">
                <div className="flex justify-between items-center cursor-pointer">
                    <div className="flex items-center gap-3">
                        <Image className="h-5 w-5 text-muted-foreground" />
                        <span>Media, links and docs</span>
                    </div>
                    <Badge variant="secondary">7</Badge>
                </div>
                 <div className="mt-4 grid grid-cols-3 gap-1">
                    <div className="relative aspect-square bg-muted rounded-md overflow-hidden">
                       <img src="https://picsum.photos/seed/1/200/200" alt="media" className="h-full w-full object-cover" />
                    </div>
                 </div>
            </div>

            <div className="p-6">
                <h4 className="mb-2 text-sm font-medium text-primary">Members</h4>
                 <div className="space-y-1">
                    {isAdmin && (
                        <div className="flex items-center p-2 gap-3 cursor-pointer rounded-md hover:bg-muted">
                            <div className="h-10 w-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                                <UserPlus className="h-5 w-5" />
                            </div>
                            <p className="font-medium text-primary">Add members</p>
                        </div>
                    )}
                    {chat.memberDetails.map(member => {
                        const memberIsAdmin = chat.groupAdmins?.includes(member.id);
                        return (
                            <div key={member.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-10 w-10">
                                        <AvatarImage src={member.photoURL} />
                                        <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="font-medium">{member.name}</p>
                                        {member.id === currentUser?.id && <p className="text-xs text-muted-foreground">You</p>}
                                    </div>
                                </div>
                                <div className="flex items-center">
                                    {memberIsAdmin && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger>
                                            <Shield className="h-5 w-5 text-primary mr-2" />
                                          </TooltipTrigger>
                                          <TooltipContent>Group Admin</TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
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
            </div>
        </ScrollArea>
        <DialogFooter className="p-4 border-t">
          <Button variant="destructive">Leave Group</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
