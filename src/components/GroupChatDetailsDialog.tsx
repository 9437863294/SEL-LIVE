
'use client';

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

interface GroupChatDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  chat: Chat | null;
}

export function GroupChatDetailsDialog({ isOpen, onOpenChange, chat }: GroupChatDetailsDialogProps) {
  const { user: currentUser } = useAuth();
  
  const getInitials = (name?: string) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  if (!chat || chat.type !== 'group') return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex flex-col items-center gap-4">
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
                    {chat.memberDetails.map(member => (
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
                            {member.id === chat.groupAdmin && <Badge variant="secondary">Admin</Badge>}
                        </div>
                    ))}
                 </div>
            </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="destructive">Exit Group</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
