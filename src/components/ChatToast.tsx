
'use client';

import { useState, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Paperclip, Send, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Chat, User, Message } from '@/lib/types';

interface ChatToastProps {
  chat: Chat;
  latestMessage: Message;
  currentUser: User;
  onSend: (message: string, file?: File) => Promise<void>;
  onClose: () => void;
}

export function ChatToast({ chat, latestMessage, currentUser, onSend, onClose }: ChatToastProps) {
  const { toast } = useToast();
  const [reply, setReply] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getInitials = (name?: string) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  const otherMember = chat.type === 'one-to-one' ? chat.memberDetails.find(m => m.id !== currentUser.id) : null;
  const chatName = chat.type === 'group' ? chat.groupName : otherMember?.name;
  const chatAvatar = chat.type === 'group' ? chat.groupPhotoURL : otherMember?.photoURL;
  const sender = chat.memberDetails.find(m => m.id === latestMessage.senderId);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachment(file);
    }
  };

  const handleSendReply = async () => {
    if (!reply.trim() && !attachment) return;
    setIsSending(true);
    await onSend(reply, attachment || undefined);
    setIsSending(false);
    setReply('');
    setAttachment(null);
    onClose();
  };

  return (
    <div className="w-full p-2">
      <div className="flex items-start gap-3">
        <Avatar>
          <AvatarImage src={chatAvatar} />
          <AvatarFallback>{getInitials(chatName)}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <p className="font-semibold">{chatName}</p>
          <p className="text-sm text-muted-foreground">{sender?.name}: {latestMessage.content}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="h-4 w-4" />
        </Button>
        <Input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
        <Input 
          placeholder="Reply..." 
          className="flex-1"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <Button size="icon" onClick={handleSendReply} disabled={isSending}>
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {attachment && <p className="text-xs text-muted-foreground mt-1">Attachment: {attachment.name}</p>}
    </div>
  );
}
