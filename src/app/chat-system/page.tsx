
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  Paperclip,
  Image as ImageIcon,
  Camera,
  Headphones,
  Contact,
  BarChart3,
  Calendar,
  SmilePlus,
  RotateCcw,
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
import { db, storage } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, serverTimestamp, orderBy, limit, doc, updateDoc, writeBatch, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import Image from 'next/image';


export default function ChatSystemPage() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);

  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  
  const [isCameraDialogOpen, setIsCameraDialogOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    if (!currentUser) return;
    setIsLoadingChats(true);
    const q = query(collection(db, "chats"), where("members", "array-contains", currentUser.id));
    
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        const userChats: Chat[] = [];
        const unreadListeners: (() => void)[] = [];

        querySnapshot.forEach((doc) => {
            userChats.push({ id: doc.id, ...doc.data() } as Chat);
        });
        userChats.sort((a,b) => (b.lastMessage?.timestamp?.toMillis() || 0) - (a.lastMessage?.timestamp?.toMillis() || 0));

        const chatPromises = userChats.map(chat => {
            return new Promise<void>(resolve => {
                // Set up listeners for member details if it's a one-to-one chat
                if (chat.type === 'one-to-one') {
                    const otherMemberId = chat.members.find(id => id !== currentUser.id);
                    if (otherMemberId) {
                        const userDocRef = doc(db, 'users', otherMemberId);
                        const unsubUser = onSnapshot(userDocRef, (userDoc) => {
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

                const messagesRef = collection(db, 'chats', chat.id, 'messages');
                onSnapshot(query(messagesRef), (messagesSnapshot) => {
                    const unreadCount = messagesSnapshot.docs.filter(doc => !doc.data().readBy.includes(currentUser.id)).length;
                    setUnreadCounts(prev => ({ ...prev, [chat.id]: unreadCount }));
                });
                resolve();
            });
        });

        Promise.all(chatPromises).then(() => {
            setChats(userChats);
            setIsLoadingChats(false);
        });

        return () => {
          unsubscribe();
          unreadListeners.forEach(unsub => unsub());
        };
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
  
  const getCameraPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setHasCameraPermission(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      setHasCameraPermission(false);
      toast({
        variant: 'destructive',
        title: 'Camera Access Denied',
        description: 'Please enable camera permissions in your browser settings to use this feature.',
      });
    }
  }, [toast]);
  
  useEffect(() => {
    if (isCameraDialogOpen && !isPreviewing) {
        getCameraPermission();
    } else {
        // Cleanup: stop camera stream when dialog closes or goes to preview
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
    }
  }, [isCameraDialogOpen, isPreviewing, getCameraPermission]);


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
        handleSelectChat(existingChat);
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
        const newChat = {id: newChatRef.id, ...newChatData, lastMessage: { ...newChatData.lastMessage, timestamp: new Date() }}
        handleSelectChat(newChat as Chat);
    }
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAttachment(e.target.files[0]);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent, file?: File) => {
    e?.preventDefault();
    const finalAttachment = file || attachment;

    if ((!newMessage.trim() && !finalAttachment) || !currentUser || !selectedChat) return;

    setIsSending(true);
    
    let messageData: Partial<Message> = {
        senderId: currentUser.id,
        timestamp: serverTimestamp(),
        readBy: [currentUser.id]
    };
    
    let lastMessageText = newMessage.trim();

    try {
        if (finalAttachment) {
            const isImage = finalAttachment.type.startsWith('image/');
            const storagePath = `chat-attachments/${selectedChat.id}/${Date.now()}-${finalAttachment.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, finalAttachment);
            const downloadURL = await getDownloadURL(storageRef);

            messageData = {
                ...messageData,
                type: isImage ? 'image' : 'document',
                mediaUrl: downloadURL,
                fileName: finalAttachment.name,
                content: newMessage.trim(), // Include text with attachment
            };
            lastMessageText = finalAttachment.name;
        } else {
            messageData = {
                ...messageData,
                type: 'text',
                content: newMessage.trim(),
            };
        }

        const chatRef = doc(db, 'chats', selectedChat.id);
        const messagesRef = collection(chatRef, 'messages');

        await addDoc(messagesRef, messageData);
        
        await updateDoc(chatRef, {
            lastMessage: {
                text: lastMessageText,
                senderId: currentUser.id,
                timestamp: serverTimestamp(),
            }
        });

        setNewMessage('');
        setAttachment(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    } catch (error) {
        console.error("Error sending message:", error);
    } finally {
        setIsSending(false);
    }
  };
  
  const handleSelectChat = async (chat: Chat) => {
    setSelectedChat(chat);
    if (!currentUser) return;
    
    const messagesRef = collection(db, 'chats', chat.id, 'messages');
    const messagesSnapshot = await getDocs(messagesRef);

    const unreadMessages = messagesSnapshot.docs.filter(doc => !doc.data().readBy.includes(currentUser.id));
    
    if (unreadMessages.length === 0) return;
    
    const batch = writeBatch(db);
    unreadMessages.forEach(doc => {
        batch.update(doc.ref, {
            readBy: arrayUnion(currentUser.id)
        });
    });

    await batch.commit();
  };
  
  const handleCapture = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setCapturedImage(dataUrl);
        setIsPreviewing(true);
      }
    }
  };

  const handleSendPhoto = async () => {
    if (!capturedImage) return;

    const blob = await (await fetch(capturedImage)).blob();
    const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
    
    await handleSendMessage(undefined, file);
    
    setIsCameraDialogOpen(false);
    setIsPreviewing(false);
    setCapturedImage(null);
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
  
  const renderMessageContent = (message: Message) => {
    switch (message.type) {
        case 'image':
            return (
                <div className="space-y-2">
                    {message.mediaUrl && <Image src={message.mediaUrl} alt={message.fileName || 'Uploaded image'} width={200} height={200} className="max-w-xs rounded-lg" />}
                    {message.content && <p className="text-sm">{message.content}</p>}
                </div>
            );
        case 'document':
            return (
                <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-400">
                        {message.fileName}
                    </a>
                </div>
            );
        case 'text':
        default:
            return <p className="text-sm">{message.content}</p>;
    }
  }

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
                        const unreadCount = unreadCounts[chat.id] || 0;
                        const hasUnread = unreadCount > 0;

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
                                <div className="flex flex-col items-end self-start">
                                    {chat.lastMessage?.timestamp?.toDate && (
                                        <p className="text-xs text-muted-foreground">{format(chat.lastMessage.timestamp.toDate(), 'p')}</p>
                                    )}
                                    {hasUnread && (
                                        <Badge className="mt-1 h-5 w-5 p-0 flex items-center justify-center">{unreadCount}</Badge>
                                    )}
                                </div>
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
                                        <div className={cn("rounded-lg px-4 py-2 max-w-sm", isSender ? "bg-primary text-primary-foreground" : "bg-muted")}>
                                            {renderMessageContent(message)}
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
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button type="button" variant="ghost" size="icon">
                                        <Paperclip className="h-5 w-5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                                        <FileText className="mr-2 h-4 w-4" /> Document
                                    </DropdownMenuItem>
                                     <DropdownMenuItem onSelect={() => imageInputRef.current?.click()}>
                                        <ImageIcon className="mr-2 h-4 w-4" /> Photos & Videos
                                    </DropdownMenuItem>
                                     <DropdownMenuItem onSelect={() => setIsCameraDialogOpen(true)}>
                                        <Camera className="mr-2 h-4 w-4" /> Camera
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                        <Headphones className="mr-2 h-4 w-4" /> Audio
                                    </DropdownMenuItem>
                                     <DropdownMenuItem>
                                        <Contact className="mr-2 h-4 w-4" /> Contact
                                    </DropdownMenuItem>
                                     <DropdownMenuItem>
                                        <BarChart3 className="mr-2 h-4 w-4" /> Poll
                                    </DropdownMenuItem>
                                     <DropdownMenuItem>
                                        <Calendar className="mr-2 h-4 w-4" /> Event
                                    </DropdownMenuItem>
                                     <DropdownMenuItem>
                                        <SmilePlus className="mr-2 h-4 w-4" /> New Sticker
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                             <Input
                                ref={imageInputRef}
                                type="file"
                                accept="image/*,video/*"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                            <Input 
                                placeholder="Type a message..."
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                disabled={isSending}
                            />
                            <Button type="submit" disabled={isSending}>
                                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                        </form>
                         {attachment && (
                            <div className="text-sm mt-2 p-2 bg-muted rounded-md flex items-center justify-between">
                                <span className="truncate">Attaching: {attachment.name}</span>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        )}
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
      <Dialog open={isCameraDialogOpen} onOpenChange={setIsCameraDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Camera</DialogTitle>
                <DialogDescription>
                    {isPreviewing ? 'Review your photo before sending.' : 'Position yourself and capture a photo.'}
                </DialogDescription>
            </DialogHeader>
            <div className="relative">
                {isPreviewing && capturedImage ? (
                    <Image src={capturedImage} alt="Captured preview" width={640} height={480} className="w-full aspect-video rounded-md" />
                ) : (
                    <video ref={videoRef} className="w-full aspect-video rounded-md bg-muted" autoPlay muted />
                )}
                
                {hasCameraPermission === false && !isPreviewing && (
                    <Alert variant="destructive" className="mt-4">
                        <AlertTitle>Camera Access Required</AlertTitle>
                        <AlertDescription>
                            Please allow camera access in your browser settings to use this feature.
                        </AlertDescription>
                    </Alert>
                )}
            </div>
            <DialogFooter>
                {isPreviewing ? (
                    <>
                        <Button variant="outline" onClick={() => setIsPreviewing(false)}>
                            <RotateCcw className="mr-2 h-4 w-4" /> Retake
                        </Button>
                        <Button onClick={handleSendPhoto}>
                            <Send className="mr-2 h-4 w-4" /> Send Photo
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="outline" onClick={() => setIsCameraDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleCapture} disabled={!hasCameraPermission}>
                            <Camera className="mr-2 h-4 w-4" /> Capture
                        </Button>
                    </>
                )}
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
