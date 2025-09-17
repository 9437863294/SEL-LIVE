
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  File,
  Inbox,
  Send,
  Trash2,
  Archive,
  FileText,
  Search,
  PlusCircle,
  Loader2,
  Users,
  MessageSquare,
  Check,
  CheckCheck,
} from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { NewChatDialog } from '@/components/NewChatDialog';
import type { User, Chat, Message } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, serverTimestamp, orderBy, limit, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';


export default function ChatSystemPage() {
  const { user: currentUser } = useAuth();
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');

  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});


  useEffect(() => {
    if (!currentUser) return;
    setIsLoadingChats(true);
    const q = query(collection(db, "chats"), where("members", "array-contains", currentUser.id));
    
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        const userChats: Chat[] = [];
        querySnapshot.forEach((doc) => {
            userChats.push({ id: doc.id, ...doc.data() } as Chat);
        });
        userChats.sort((a,b) => (b.lastMessage?.timestamp?.toMillis() || 0) - (a.lastMessage?.timestamp?.toMillis() || 0));

        for (const chat of userChats) {
            // Set up listeners for member details if it's a one-to-one chat
            if (chat.type === 'one-to-one') {
                const otherMemberId = chat.members.find(id => id !== currentUser.id);
                if (otherMemberId) {
                    const userDocRef = doc(db, 'users', otherMemberId);
                    onSnapshot(userDocRef, (userDoc) => {
                        if (userDoc.exists()) {
                            const userData = userDoc.data() as User;
                            setChats(prevChats => prevChats.map(c => {
                                if (c.id === chat.id) {
                                    return {
                                        ...c,
                                        memberDetails: c.memberDetails.map(md => md.id === otherMemberId ? { ...md, isOnline: userData.isOnline, lastSeen: userData.lastSeen } : md)
                                    };
                                }
                                return c;
                            }));
                        }
                    });
                }
            }

            // Set up listeners for unread messages count
            const messagesRef = collection(db, 'chats', chat.id, 'messages');
            const unreadQuery = query(messagesRef, where('readBy', 'not-in', [[currentUser.id]]));
            onSnapshot(unreadQuery, (unreadSnapshot) => {
                setUnreadCounts(prev => ({ ...prev, [chat.id]: unreadSnapshot.size }));
            });
        }
        
        setChats(userChats);
        setIsLoadingChats(false);
    });

    return () => unsubscribe();
  }, [currentUser]);
  
   useEffect(() => {
    if (!selectedChat) {
        setMessages([]);
        return;
    };
    setIsLoadingMessages(true);
    const messagesRef = collection(db, 'chats', selectedChat.id, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const chatMessages: Message[] = [];
        querySnapshot.forEach((doc) => {
            chatMessages.push({ id: doc.id, ...doc.data() } as Message);
        });
        setMessages(chatMessages);
        setIsLoadingMessages(false);
    });

    return () => unsubscribe();
  }, [selectedChat]);


  const handleSelectUser = async (user: User) => {
    setIsNewChatOpen(false);
    if(!currentUser) return;

    // Check if a 1-on-1 chat already exists
    const existingChat = chats.find(chat => 
        chat.type === 'one-to-one' && 
        chat.members.length === 2 && 
        chat.members.includes(user.id)
    );

    if (existingChat) {
        setSelectedChat(existingChat);
    } else {
        // Create a new chat
        const newChatData = {
            type: 'one-to-one' as const,
            members: [currentUser.id, user.id],
            memberDetails: [
                {id: currentUser.id, name: currentUser.name, photoURL: currentUser.photoURL || ''},
                {id: user.id, name: user.name, photoURL: user.photoURL || ''}
            ],
            lastMessage: {
                text: 'Chat created',
                senderId: '',
                timestamp: serverTimestamp(),
            }
        };
        const newChatRef = await addDoc(collection(db, 'chats'), newChatData);
        // We can't immediately get the server timestamp, so we'll use a local new Date() for immediate display.
        // The onSnapshot listener will soon update it with the real server time.
        const newChat = {id: newChatRef.id, ...newChatData, lastMessage: { ...newChatData.lastMessage, timestamp: new Date() }}
        setSelectedChat(newChat as Chat);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUser || !selectedChat) return;

    const messageData = {
        content: newMessage,
        senderId: currentUser.id,
        timestamp: serverTimestamp(),
        type: 'text' as const,
        readBy: [currentUser.id]
    };

    const chatRef = doc(db, 'chats', selectedChat.id);
    const messagesRef = collection(chatRef, 'messages');

    await addDoc(messagesRef, messageData);
    
    await updateDoc(chatRef, {
        lastMessage: {
            text: newMessage,
            senderId: currentUser.id,
            timestamp: serverTimestamp(),
        }
    });

    setNewMessage('');
  };
  
  const handleSelectChat = async (chat: Chat) => {
    setSelectedChat(chat);
    if (!currentUser || (unreadCounts[chat.id] || 0) === 0) return;

    const messagesRef = collection(db, 'chats', chat.id, 'messages');
    const q = query(messagesRef, where('readBy', 'not-in', [[currentUser.id]]));
    const unreadSnapshot = await getDocs(q);
    
    if (unreadSnapshot.empty) return;

    const batch = writeBatch(db);
    unreadSnapshot.docs.forEach(messageDoc => {
        const messageRef = doc(db, 'chats', chat.id, 'messages', messageDoc.id);
        const currentReadBy = messageDoc.data().readBy || [];
        batch.update(messageRef, { readBy: [...currentReadBy, currentUser.id] });
    });

    await batch.commit();
  };
  
  const getOtherMember = (chat: Chat) => {
      if(!currentUser || !chat.memberDetails) return null;
      return chat.memberDetails.find(m => m.id !== currentUser.id);
  }

  const getInitials = (name?: string) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  const chatPartner = selectedChat ? getOtherMember(selectedChat) : null;

  return (
    <>
      <div className="h-[calc(100vh-6rem)] w-full flex flex-col bg-background text-foreground rounded-lg border">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={25} minSize={15} maxSize={30}>
            <div className="p-2 h-full flex flex-col">
                <div className="p-2">
                  <Button className="w-full" onClick={() => setIsNewChatOpen(true)}>
                      <PlusCircle className="mr-2 h-4 w-4" /> New Chat
                  </Button>
                </div>
                <Separator />
                <div className="p-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search chats..." className="pl-8" />
                    </div>
                </div>
              <ScrollArea className="flex-1">
                {isLoadingChats ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 rounded-lg">
                          <Skeleton className="h-10 w-10 rounded-full" />
                          <div className="flex-1 space-y-1">
                              <Skeleton className="h-4 w-3/4" />
                              <Skeleton className="h-3 w-full" />
                          </div>
                      </div>
                    ))
                ) : (
                    chats.map(chat => {
                        const otherMember = getOtherMember(chat);
                        const chatName = chat.type === 'group' ? chat.groupName : otherMember?.name;
                        const chatAvatar = chat.type === 'group' ? undefined : otherMember?.photoURL;
                        const hasUnread = (unreadCounts[chat.id] || 0) > 0;

                        return (
                            <div 
                                key={chat.id} 
                                className={cn(
                                    "flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted",
                                    selectedChat?.id === chat.id && 'bg-muted'
                                )}
                                onClick={() => handleSelectChat(chat)}
                            >
                                <Avatar>
                                    <AvatarImage src={chatAvatar} />
                                    <AvatarFallback>{getInitials(chatName)}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 overflow-hidden">
                                    <p className={cn("font-semibold truncate", hasUnread && "font-bold text-primary")}>{chatName}</p>
                                    <p className="text-xs text-muted-foreground truncate">{chat.lastMessage?.text}</p>
                                </div>
                                {chat.lastMessage?.timestamp?.toDate && (
                                     <p className="text-xs text-muted-foreground self-start">{format(chat.lastMessage.timestamp.toDate(), 'p')}</p>
                                )}
                            </div>
                        )
                    })
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={75}>
            {selectedChat ? (
                <div className="flex flex-col h-full">
                   <div className="p-4 border-b flex items-center gap-4">
                        <Avatar>
                            <AvatarImage src={chatPartner?.photoURL} />
                            <AvatarFallback>{getInitials(chatPartner?.name)}</AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="font-semibold">{chatPartner?.name}</p>
                            {chatPartner?.isOnline ? (
                                <p className="text-xs text-green-500">Online</p>
                            ) : (
                                <p className="text-xs text-muted-foreground">
                                    Last seen {chatPartner?.lastSeen ? formatDistanceToNowStrict(chatPartner.lastSeen.toDate(), { addSuffix: true }) : 'a while ago'}
                                </p>
                            )}
                        </div>
                   </div>
                    <ScrollArea className="flex-1 p-4">
                        {isLoadingMessages ? (
                            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto my-12" />
                        ) : (
                            messages.map(message => {
                                const isSender = message.senderId === currentUser?.id;
                                if (!message.timestamp) return null; // Don't render message if timestamp is not yet available
                                
                                const isRead = selectedChat.type === 'one-to-one' && message.readBy.length > 1;

                                return (
                                    <div key={message.id} className={cn("flex mb-4", isSender ? "justify-end" : "justify-start")}>
                                        <div className={cn("rounded-lg px-3 py-2 max-w-sm", isSender ? "bg-primary text-primary-foreground" : "bg-muted")}>
                                            <p className="text-sm">{message.content}</p>
                                            <div className="flex items-center justify-end gap-1 mt-1">
                                                {message.timestamp?.toDate && (
                                                   <p className="text-xs opacity-70">{format(message.timestamp.toDate(), 'p')}</p>
                                                )}
                                                {isSender && (
                                                  isRead 
                                                    ? <CheckCheck className="h-4 w-4 text-blue-400" /> 
                                                    : <Check className="h-4 w-4 opacity-70" />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </ScrollArea>
                    <div className="p-4 border-t">
                        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                            <Input 
                                placeholder="Type a message..."
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                            />
                            <Button type="submit"><Send className="h-4 w-4" /></Button>
                        </form>
                    </div>
                </div>
            ) : (
                <div className="flex h-full flex-col items-center justify-center bg-muted/50">
                    <MessageSquare className="h-16 w-16 text-muted-foreground" />
                    <p className="mt-4 text-lg text-muted-foreground">Select a chat to start messaging</p>
                </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <NewChatDialog 
        isOpen={isNewChatOpen} 
        onOpenChange={setIsNewChatOpen} 
        onSelectUser={handleSelectUser}
      />
    </>
  );
}
