'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  MessageCircle,
  MessageSquarePlus,
  MoreVertical,
  Search,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytesResumable, type UploadTaskSnapshot } from 'firebase/storage';
import { useSearchParams } from 'next/navigation';
import type { User } from '@/lib/types';
import type { Role } from '@/lib/types';
import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  directConversationId,
  createReplyPreview,
  formatConversationTime,
  getConversationPhoto,
  getConversationTitle,
  getInitials,
  getAttachmentKind,
  getMessagePreview,
  timestampMillis,
  type ChatAttachment,
  type ChatConversation,
  type ChatMessage,
} from '@/lib/chat';
import { NewConversationDialog } from './NewConversationDialog';
import { notifyChatRecipients } from '@/lib/chat-push-client';
import { ChatComposer } from './ChatComposer';
import { ChatMessageItem, type MessageDeliveryStatus } from './ChatMessageItem';
import { ForwardMessageDialog } from './ForwardMessageDialog';
import { GroupInfoDialog } from './GroupInfoDialog';
import { canRoleReceiveChats } from '@/lib/chat-access';
import {
  createRealtimeConversation,
  getRealtimeConversation,
  listenToMessages,
  listenToUserConversations,
  newRealtimeKey,
  persistRealtimeMessage,
  realtimeServerTimestamp,
  transactMessageReactions,
  transactMessageStars,
  updateConversation,
  updateMessage,
  updateRealtimePaths,
} from '@/lib/chat-realtime';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

export default function ChatModule() {
  const { user, users } = useAuth();
  const { can, isLoading: isLoadingPermissions } = useAuthorization();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const requestedConversationId = searchParams?.get('conversation') || '';
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<ChatMessage | null>(null);
  const [clearChatOpen, setClearChatOpen] = useState(false);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [messageToForward, setMessageToForward] = useState<ChatMessage | null>(null);
  const [isForwarding, setIsForwarding] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [typingClock, setTypingClock] = useState(Date.now());
  const [chatEnabledRoles, setChatEnabledRoles] = useState<Set<string>>(new Set());
  const [isLoadingChatRoles, setIsLoadingChatRoles] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canViewChat =
    can('View Module', 'Chat System') &&
    can('View', 'Chat System.Conversations');
  const canSendChat = canViewChat && can('Send', 'Chat System.Conversations');
  const canCreateGroups = canSendChat && can('Create', 'Chat System.Groups');

  const eligibleChatUsers = useMemo(
    () => users.filter((candidate) =>
      candidate.status !== 'Inactive' && chatEnabledRoles.has(candidate.role)
    ),
    [chatEnabledRoles, users]
  );
  const eligibleChatUserIds = useMemo(
    () => new Set(eligibleChatUsers.map((candidate) => candidate.id)),
    [eligibleChatUsers]
  );

  const usersById = useMemo(
    () => new Map(users.map((candidate) => [candidate.id, candidate])),
    [users]
  );

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const searchMatches = useMemo(() => {
    const normalized = messageSearch.trim().toLowerCase();
    if (!normalized) return [] as ChatMessage[];
    return messages.filter((message) =>
      `${message.senderName} ${message.text} ${(message.attachments || []).map((item) => item.name).join(' ')}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [messageSearch, messages]);

  const activeTypingNames = useMemo(() => {
    if (!selectedConversation?.typing || !user?.id) return [];
    return Object.entries(selectedConversation.typing)
      .filter(([userId, lastTypedAt]) => userId !== user.id && typingClock - Number(lastTypedAt) < 5000)
      .map(([userId]) => usersById.get(userId)?.name || 'Someone');
  }, [selectedConversation?.typing, typingClock, user?.id, usersById]);

  useEffect(() => {
    const interval = window.setInterval(() => setTypingClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isLoadingPermissions || !canViewChat) {
      setChatEnabledRoles(new Set());
      setIsLoadingChatRoles(false);
      return;
    }

    setIsLoadingChatRoles(true);
    return onSnapshot(
      collection(db, 'roles'),
      (snapshot) => {
        setChatEnabledRoles(new Set(
          snapshot.docs
            .map((roleDocument) => roleDocument.data() as Role)
            .filter((role) => canRoleReceiveChats(role.permissions))
            .map((role) => role.name)
        ));
        setIsLoadingChatRoles(false);
      },
      (error) => {
        console.error('Unable to load chat-enabled roles:', error);
        setChatEnabledRoles(new Set());
        setIsLoadingChatRoles(false);
      }
    );
  }, [canViewChat, isLoadingPermissions]);

  useEffect(() => {
    setReplyingTo(null);
    setEditingMessage(null);
    setDraft('');
    setMessageSearch('');
    setMessageSearchOpen(false);
    setActiveSearchIndex(0);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!searchMatches.length) return;
    const safeIndex = Math.min(activeSearchIndex, searchMatches.length - 1);
    if (safeIndex !== activeSearchIndex) setActiveSearchIndex(safeIndex);
    document.getElementById(`message-${searchMatches[safeIndex].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeSearchIndex, searchMatches]);

  useEffect(() => {
    if (
      requestedConversationId &&
      conversations.some((conversation) => conversation.id === requestedConversationId)
    ) {
      setSelectedConversationId(requestedConversationId);
    }
  }, [conversations, requestedConversationId]);

  useEffect(() => {
    if (!user?.id || !canViewChat) return;
    setIsLoadingConversations(true);
    return listenToUserConversations(
      user.id,
      (nextValues) => {
        const nextConversations = nextValues.sort(
            (a, b) =>
              timestampMillis(b.lastMessageAt || b.updatedAt || b.createdAt) -
              timestampMillis(a.lastMessageAt || a.updatedAt || a.createdAt)
          );
        setConversations(nextConversations);
        nextConversations.forEach((conversation) => {
          const lastMessageAt = timestampMillis(conversation.lastMessageAt);
          const deliveredAt = timestampMillis(conversation.deliveredAt?.[user.id]);
          if (conversation.lastMessageSenderId !== user.id && lastMessageAt > deliveredAt) {
            updateConversation(conversation.id, {
              [`deliveredAt/${user.id}`]: realtimeServerTimestamp(),
            }).catch(() => {});
          }
        });
        setSelectedConversationId((current) => {
          if (current && nextConversations.some((conversation) => conversation.id === current)) {
            return current;
          }
          return null;
        });
        setIsLoadingConversations(false);
      },
      (error) => {
        console.error('Unable to load conversations:', error);
        setIsLoadingConversations(false);
        toast({
          title: 'Could not load chat',
          description: 'Please check your connection and try again.',
          variant: 'destructive',
        });
      }
    );
  }, [canViewChat, toast, user?.id]);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }
    setIsLoadingMessages(true);
    return listenToMessages(
      selectedConversationId,
      (nextMessages) => {
        setMessages(nextMessages);
        setIsLoadingMessages(false);
      },
      (error) => {
        console.error('Unable to load messages:', error);
        setIsLoadingMessages(false);
        toast({
          title: 'Could not load messages',
          description: 'Please refresh and try again.',
          variant: 'destructive',
        });
      }
    );
  }, [selectedConversationId, toast]);

  const selectedUnreadCount =
    user?.id && selectedConversation?.unreadCounts
      ? selectedConversation.unreadCounts[user.id] || 0
      : 0;

  useEffect(() => {
    if (!user?.id || !selectedConversationId || selectedUnreadCount < 1) return;
    updateConversation(selectedConversationId, {
      [`unreadCounts/${user.id}`]: 0,
      [`lastReadAt/${user.id}`]: realtimeServerTimestamp(),
      [`deliveredAt/${user.id}`]: realtimeServerTimestamp(),
    }).catch((error) => console.error('Unable to mark conversation as read:', error));
  }, [selectedConversationId, selectedUnreadCount, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, selectedConversationId]);

  const filteredConversations = useMemo(() => {
    const normalized = conversationSearch.trim().toLowerCase();
    if (!normalized || !user?.id) return conversations;
    return conversations.filter((conversation) => {
      const title = getConversationTitle(conversation, user.id, usersById);
      return `${title} ${conversation.lastMessageText || ''}`.toLowerCase().includes(normalized);
    });
  }, [conversationSearch, conversations, user?.id, usersById]);

  const startDirectConversation = useCallback(
    async (otherUser: User) => {
      if (!user?.id || !canSendChat || !eligibleChatUserIds.has(otherUser.id)) {
        throw new Error('You do not have permission to start this conversation.');
      }
      setIsCreating(true);
      try {
        const conversationId = directConversationId(user.id, otherUser.id);
        const existing = await getRealtimeConversation(conversationId);
        if (!existing) {
          await createRealtimeConversation(conversationId, {
            type: 'direct',
            memberIds: [user.id, otherUser.id].sort(),
            createdBy: user.id,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastMessageAt: Date.now(),
            lastMessageText: '',
            unreadCounts: {
              [user.id]: 0,
              [otherUser.id]: 0,
            },
          });
        } else {
          await updateRealtimePaths({
            [`chatUserConversations/${user.id}/${conversationId}`]: true,
          });
        }
        setSelectedConversationId(conversationId);
      } catch (error) {
        console.error('Unable to start direct conversation:', error);
        toast({
          title: 'Conversation not created',
          description: 'Please try again.',
          variant: 'destructive',
        });
        throw error;
      } finally {
        setIsCreating(false);
      }
    },
    [canSendChat, eligibleChatUserIds, toast, user?.id]
  );

  const createGroupConversation = useCallback(
    async (name: string, selectedMemberIds: string[]) => {
      if (
        !user?.id ||
        !canCreateGroups ||
        selectedMemberIds.some((memberId) => !eligibleChatUserIds.has(memberId))
      ) {
        throw new Error('You do not have permission to create this group.');
      }
      setIsCreating(true);
      try {
        const memberIds = Array.from(new Set([user.id, ...selectedMemberIds]));
        const conversationId = newRealtimeKey('chatConversations');
        const messageId = newRealtimeKey(`chatMessages/${conversationId}`);
        const unreadCounts = Object.fromEntries(memberIds.map((memberId) => [memberId, 0]));
        const createdAt = Date.now();
        await createRealtimeConversation(conversationId, {
          type: 'group',
          name,
          memberIds,
          createdBy: user.id,
          adminIds: [user.id],
          createdAt,
          updatedAt: createdAt,
          lastMessageAt: createdAt,
          lastMessageText: `${user.name} created the group`,
          lastMessageId: messageId,
          lastMessageSenderId: user.id,
          lastMessageSenderName: user.name,
          unreadCounts,
        }, {
          senderId: user.id,
          senderName: user.name,
          text: `${user.name} created the group`,
          type: 'system',
          createdAt,
          clientCreatedAt: createdAt,
        });
        setSelectedConversationId(conversationId);
      } catch (error) {
        console.error('Unable to create group:', error);
        toast({
          title: 'Group not created',
          description: 'Please try again.',
          variant: 'destructive',
        });
        throw error;
      } finally {
        setIsCreating(false);
      }
    },
    [canCreateGroups, eligibleChatUserIds, toast, user?.id, user?.name]
  );

  const persistMessage = async (
    conversation: ChatConversation,
    payload: Partial<ChatMessage> & Pick<ChatMessage, 'text' | 'type'>,
    preparedMessageId?: string,
    notifyRecipients = true,
    incrementUnread = true
  ) => {
    if (!user?.id || !canSendChat) throw new Error('You do not have permission to send messages.');
    const preview = getMessagePreview(payload as ChatMessage);
    const createdAt = Date.now();
    const messageId = await persistRealtimeMessage(conversation, {
      senderId: user.id,
      senderName: user.name,
      text: payload.text,
      type: payload.type,
      createdAt,
      clientCreatedAt: createdAt,
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
      ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
      ...(payload.forwardedFrom ? { forwardedFrom: payload.forwardedFrom } : {}),
    }, user.id, preparedMessageId, preview, incrementUnread);
    if (notifyRecipients) {
      try {
        await notifyChatRecipients(conversation.id, messageId);
      } catch (notificationError) {
        console.warn('Message saved, but push notification delivery failed:', notificationError);
      }
    }
    return messageId;
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !user?.id || !selectedConversation || isSending) return;
    setIsSending(true);
    try {
      if (editingMessage) {
        await updateMessage(selectedConversation.id, editingMessage.id, {
          text,
          editedAt: realtimeServerTimestamp(),
        });
        if (selectedConversation.lastMessageId === editingMessage.id) {
          await updateConversation(selectedConversation.id, { lastMessageText: text });
        }
      } else {
        await persistMessage(selectedConversation, {
          text,
          type: 'text',
          ...(replyingTo ? { replyTo: createReplyPreview(replyingTo) } : {}),
        });
      }
      setDraft('');
      setReplyingTo(null);
      setEditingMessage(null);
    } catch (error) {
      console.error('Unable to send message:', error);
      toast({ title: 'Message not sent', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value.slice(0, MAX_MESSAGE_LENGTH));
    if (!user?.id || !selectedConversationId) return;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (value.trim()) {
      updateConversation(selectedConversationId, { [`typing/${user.id}`]: Date.now() }).catch(() => {});
      typingTimerRef.current = setTimeout(() => {
        updateConversation(selectedConversationId, { [`typing/${user.id}`]: null }).catch(() => {});
      }, 1800);
    } else {
      updateConversation(selectedConversationId, { [`typing/${user.id}`]: null }).catch(() => {});
    }
  };

  const uploadAttachments = async (files: File[], voiceDurationSeconds?: number) => {
    if (!selectedConversation || !user?.id || !files.length) return;
    const selectedFiles = files.slice(0, 5);
    const invalid = selectedFiles.find((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (invalid) {
      toast({ title: 'Attachment too large', description: `${invalid.name} exceeds the 25 MB limit.`, variant: 'destructive' });
      return;
    }
    setUploadProgress(0);
    try {
      const messageId = newRealtimeKey(`chatMessages/${selectedConversation.id}`);
      const attachments: ChatAttachment[] = [];
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `chat/${selectedConversation.id}/${messageId}/${Date.now()}-${safeName}`;
        const uploadRef = storageRef(storage, path);
        const snapshot = await new Promise<UploadTaskSnapshot>((resolve, reject) => {
          const task = uploadBytesResumable(uploadRef, file, { contentType: file.type || 'application/octet-stream' });
          task.on('state_changed', (state) => {
            setUploadProgress(((index + state.bytesTransferred / state.totalBytes) / selectedFiles.length) * 100);
          }, reject, () => resolve(task.snapshot));
        });
        attachments.push({
          name: file.name,
          url: await getDownloadURL(snapshot.ref),
          storagePath: path,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          kind: getAttachmentKind(file.type || ''),
          ...(voiceDurationSeconds ? { durationSeconds: voiceDurationSeconds } : {}),
        });
      }
      const primaryType = attachments[0].kind;
      await persistMessage(selectedConversation, {
        text: draft.trim(),
        type: primaryType,
        attachments,
        ...(replyingTo ? { replyTo: createReplyPreview(replyingTo) } : {}),
      }, messageId);
      setDraft('');
      setReplyingTo(null);
    } catch (error) {
      console.error('Attachment upload failed:', error);
      toast({ title: 'Upload failed', description: 'The attachment could not be sent.', variant: 'destructive' });
    } finally {
      setUploadProgress(null);
    }
  };

  const toggleReaction = async (message: ChatMessage, emoji: string) => {
    if (!user?.id || !selectedConversationId) return;
    await transactMessageReactions(selectedConversationId, message.id, (currentReactions) => {
      const reactions = { ...currentReactions };
      const usersForReaction = reactions[emoji] || [];
      reactions[emoji] = usersForReaction.includes(user.id)
        ? usersForReaction.filter((id) => id !== user.id)
        : [...usersForReaction, user.id];
      if (!reactions[emoji].length) delete reactions[emoji];
      return reactions;
    });
  };

  const toggleStar = async (message: ChatMessage) => {
    if (!user?.id || !selectedConversationId) return;
    await transactMessageStars(selectedConversationId, message.id, user.id);
  };

  const deleteMessage = async () => {
    if (!messageToDelete || !selectedConversation || !user?.id) return;
    await updateMessage(selectedConversation.id, messageToDelete.id, {
      text: '',
      attachments: [],
      replyTo: null,
      deletedAt: realtimeServerTimestamp(),
      deletedBy: user.id,
    });
    if (selectedConversation.lastMessageId === messageToDelete.id) {
      await updateConversation(selectedConversation.id, {
        lastMessageText: 'This message was deleted',
      });
    }
    setMessageToDelete(null);
  };

  const clearDirectChat = async () => {
    if (!selectedConversation || selectedConversation.type !== 'direct' || isClearingChat) return;
    setIsClearingChat(true);
    try {
      const conversationId = selectedConversation.id;
      const updates: Record<string, unknown> = {
        [`chatMessages/${conversationId}`]: null,
        [`chatConversations/${conversationId}/updatedAt`]: realtimeServerTimestamp(),
        [`chatConversations/${conversationId}/lastMessageAt`]: null,
        [`chatConversations/${conversationId}/lastMessageId`]: null,
        [`chatConversations/${conversationId}/lastMessageText`]: '',
        [`chatConversations/${conversationId}/lastMessageSenderId`]: null,
        [`chatConversations/${conversationId}/lastMessageSenderName`]: null,
        [`chatConversations/${conversationId}/lastReadAt`]: null,
        [`chatConversations/${conversationId}/deliveredAt`]: null,
        [`chatConversations/${conversationId}/typing`]: null,
      };
      selectedConversation.memberIds.forEach((memberId) => {
        updates[`chatConversations/${conversationId}/unreadCounts/${memberId}`] = 0;
      });
      await updateRealtimePaths(updates);
      setMessages([]);
      setDraft('');
      setReplyingTo(null);
      setEditingMessage(null);
      setMessageSearch('');
      setClearChatOpen(false);
      toast({
        title: 'Chat cleared',
        description: 'The messages were deleted for both participants.',
      });
    } catch (error) {
      console.error('Unable to clear direct chat:', error);
      toast({
        title: 'Chat not cleared',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsClearingChat(false);
    }
  };

  const forwardMessage = async (conversationIds: string[]) => {
    if (!messageToForward) return;
    setIsForwarding(true);
    try {
      for (const conversationId of conversationIds) {
        const target = conversations.find((conversation) => conversation.id === conversationId);
        if (!target) continue;
        await persistMessage(target, {
          text: messageToForward.text,
          type: messageToForward.type,
          attachments: messageToForward.attachments,
          forwardedFrom: { messageId: messageToForward.id, senderName: messageToForward.senderName },
        });
      }
      setMessageToForward(null);
    } catch (error) {
      console.error('Unable to forward message:', error);
      toast({ title: 'Forward failed', description: 'The message could not be forwarded.', variant: 'destructive' });
      throw error;
    } finally {
      setIsForwarding(false);
    }
  };

  const addSystemMessage = async (text: string) => {
    if (!selectedConversation || !user?.id) return;
    await persistMessage(selectedConversation, { text, type: 'system' }, undefined, false, false);
  };

  const renameGroup = async (name: string) => {
    if (!selectedConversation) return;
    await updateConversation(selectedConversation.id, {
      name,
      updatedAt: realtimeServerTimestamp(),
    });
    await addSystemMessage(`${user?.name} changed the group name to ${name}`);
  };

  const addGroupMembers = async (memberIds: string[]) => {
    if (
      !selectedConversation ||
      !canCreateGroups ||
      memberIds.some((memberId) => !eligibleChatUserIds.has(memberId))
    ) return;
    const updates: Record<string, unknown> = {
      [`chatConversations/${selectedConversation.id}/updatedAt`]: realtimeServerTimestamp(),
    };
    memberIds.forEach((id) => {
      updates[`chatConversations/${selectedConversation.id}/memberIds/${id}`] = true;
      updates[`chatConversations/${selectedConversation.id}/unreadCounts/${id}`] = 0;
      updates[`chatUserConversations/${id}/${selectedConversation.id}`] = true;
    });
    await updateRealtimePaths(updates);
    const names = memberIds.map((id) => usersById.get(id)?.name).filter(Boolean).join(', ');
    await addSystemMessage(`${user?.name} added ${names}`);
  };

  const removeGroupMember = async (memberId: string) => {
    if (!selectedConversation) return;
    await addSystemMessage(`${user?.name} removed ${usersById.get(memberId)?.name || 'a member'}`);
    const nextAdminIds = (selectedConversation.adminIds || []).filter((id) => id !== memberId);
    await updateRealtimePaths({
      [`chatConversations/${selectedConversation.id}/memberIds/${memberId}`]: null,
      [`chatConversations/${selectedConversation.id}/adminIds`]: nextAdminIds,
      [`chatConversations/${selectedConversation.id}/unreadCounts/${memberId}`]: null,
      [`chatConversations/${selectedConversation.id}/lastReadAt/${memberId}`]: null,
      [`chatConversations/${selectedConversation.id}/deliveredAt/${memberId}`]: null,
      [`chatUserConversations/${memberId}/${selectedConversation.id}`]: null,
    });
  };

  const leaveGroup = async () => {
    if (!selectedConversation || !user?.id) return;
    await addSystemMessage(`${user.name} left the group`);
    const nextAdminIds = (selectedConversation.adminIds || []).filter((id) => id !== user.id);
    await updateRealtimePaths({
      [`chatConversations/${selectedConversation.id}/memberIds/${user.id}`]: null,
      [`chatConversations/${selectedConversation.id}/adminIds`]: nextAdminIds,
      [`chatConversations/${selectedConversation.id}/unreadCounts/${user.id}`]: null,
      [`chatConversations/${selectedConversation.id}/lastReadAt/${user.id}`]: null,
      [`chatConversations/${selectedConversation.id}/deliveredAt/${user.id}`]: null,
      [`chatUserConversations/${user.id}/${selectedConversation.id}`]: null,
    });
    setGroupInfoOpen(false);
    setSelectedConversationId(null);
  };

  const getDeliveryStatus = (message: ChatMessage): MessageDeliveryStatus => {
    if (!selectedConversation || message.senderId !== user?.id) return 'sent';
    const others = selectedConversation.memberIds.filter((id) => id !== user.id);
    const messageTime = timestampMillis(message.createdAt) || message.clientCreatedAt;
    if (others.length && others.every((id) => timestampMillis(selectedConversation.lastReadAt?.[id]) >= messageTime)) return 'read';
    if (others.length && others.every((id) => timestampMillis(selectedConversation.deliveredAt?.[id]) >= messageTime)) return 'delivered';
    return 'sent';
  };

  const jumpToMessage = (messageId: string) => {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (!user || isLoadingPermissions || isLoadingChatRoles) {
    return <ChatLoadingScreen />;
  }

  if (!canViewChat) {
    return <ChatAccessDenied />;
  }

  return (
    <main className="h-[calc(100dvh-3.5rem)] overflow-hidden bg-gradient-to-br from-background via-background to-primary/[0.04] md:h-[calc(100dvh-4rem)]">
      <div className="mx-auto flex h-full max-w-[1600px] overflow-hidden border-x bg-background shadow-sm">
        <aside
          className={cn(
            'h-full w-full shrink-0 flex-col border-r bg-card md:flex md:w-[360px] lg:w-[390px]',
            selectedConversationId ? 'hidden' : 'flex'
          )}
        >
          <div className="border-b px-4 pb-3 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold tracking-tight">Conversations</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">Direct messages and team groups</p>
              </div>
              {canSendChat && (
                <Button
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  onClick={() => setNewConversationOpen(true)}
                  aria-label="Start a conversation"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={conversationSearch}
                onChange={(event) => setConversationSearch(event.target.value)}
                placeholder="Search conversations"
                className="h-9 bg-muted/50 pl-9"
              />
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {isLoadingConversations ? (
              <ConversationListSkeleton />
            ) : filteredConversations.length ? (
              <div className="py-2">
                {filteredConversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    currentUser={user}
                    usersById={usersById}
                    selected={conversation.id === selectedConversationId}
                    onClick={() => setSelectedConversationId(conversation.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyConversationList
                hasSearch={Boolean(conversationSearch.trim())}
                onStart={() => setNewConversationOpen(true)}
              />
            )}
          </ScrollArea>
        </aside>

        <section
          className={cn(
            'min-w-0 flex-1 flex-col bg-muted/15 md:flex',
            selectedConversationId ? 'flex' : 'hidden'
          )}
        >
          {selectedConversation ? (
            <>
              <ConversationHeader
                conversation={selectedConversation}
                currentUser={user}
                usersById={usersById}
                onBack={() => setSelectedConversationId(null)}
                typingText={activeTypingNames.length ? `${activeTypingNames.join(', ')} typing…` : ''}
                onSearch={() => setMessageSearchOpen((open) => !open)}
                onInfo={() => selectedConversation.type === 'group' && setGroupInfoOpen(true)}
                onClearChat={() => setClearChatOpen(true)}
              />
              {messageSearchOpen && (
                <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-5">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={messageSearch}
                    onChange={(event) => { setMessageSearch(event.target.value); setActiveSearchIndex(0); }}
                    placeholder="Search in conversation"
                    className="h-8 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {searchMatches.length ? `${activeSearchIndex + 1}/${searchMatches.length}` : '0/0'}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!searchMatches.length} onClick={() => setActiveSearchIndex((index) => (index - 1 + searchMatches.length) % searchMatches.length)}><ChevronUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!searchMatches.length} onClick={() => setActiveSearchIndex((index) => (index + 1) % searchMatches.length)}><ChevronDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setMessageSearchOpen(false); setMessageSearch(''); }}><X className="h-4 w-4" /></Button>
                </div>
              )}
              <div className="relative min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
                <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end">
                  {isLoadingMessages ? (
                    <MessageListSkeleton />
                  ) : messages.length ? (
                    messages.map((message, index) => (
                      <ChatMessageItem
                        key={message.id}
                        message={message}
                        previousMessage={messages[index - 1]}
                        currentUserId={user.id}
                        isGroup={selectedConversation.type === 'group'}
                        usersById={usersById}
                        deliveryStatus={getDeliveryStatus(message)}
                        isSearchMatch={searchMatches.some((match) => match.id === message.id)}
                        isActiveSearchMatch={searchMatches[activeSearchIndex]?.id === message.id}
                        onReply={(selected) => { setEditingMessage(null); setReplyingTo(selected); }}
                        onEdit={(selected) => { setReplyingTo(null); setEditingMessage(selected); setDraft(selected.text); }}
                        onDelete={setMessageToDelete}
                        onReact={(selected, emoji) => void toggleReaction(selected, emoji)}
                        onStar={(selected) => void toggleStar(selected)}
                        onForward={setMessageToForward}
                        onJumpToMessage={jumpToMessage}
                      />
                    ))
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center py-14 text-center">
                      <div className="rounded-full bg-primary/10 p-4">
                        <MessageCircle className="h-7 w-7 text-primary" />
                      </div>
                      <h2 className="mt-4 font-semibold">Start the conversation</h2>
                      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                        Send a message to begin. Everyone in this conversation will see it instantly.
                      </p>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              </div>
              {canSendChat ? (
                <ChatComposer
                  draft={draft}
                  onDraftChange={handleDraftChange}
                  replyingTo={replyingTo}
                  editingMessage={editingMessage}
                  onCancelContext={() => { setReplyingTo(null); setEditingMessage(null); setDraft(''); }}
                  onSend={sendMessage}
                  onFilesSelected={uploadAttachments}
                  isSending={isSending}
                  uploadProgress={uploadProgress}
                />
              ) : (
                <div className="border-t bg-background px-4 py-3 text-center text-sm text-muted-foreground">
                  You have read-only access to this conversation.
                </div>
              )}
            </>
          ) : (
            <EmptyChat onStart={canSendChat ? () => setNewConversationOpen(true) : undefined} />
          )}
        </section>
      </div>

      <NewConversationDialog
        open={newConversationOpen}
        onOpenChange={setNewConversationOpen}
        currentUserId={user.id}
        users={eligibleChatUsers}
        canCreateGroup={canCreateGroups}
        isCreating={isCreating}
        onStartDirect={startDirectConversation}
        onCreateGroup={createGroupConversation}
      />

      <ForwardMessageDialog
        open={Boolean(messageToForward)}
        onOpenChange={(open) => { if (!open) setMessageToForward(null); }}
        message={messageToForward}
        conversations={conversations}
        currentUserId={user.id}
        usersById={usersById}
        onForward={forwardMessage}
        isForwarding={isForwarding}
      />

      {selectedConversation?.type === 'group' && (
        <GroupInfoDialog
          open={groupInfoOpen}
          onOpenChange={setGroupInfoOpen}
          conversation={selectedConversation}
          currentUser={user}
          users={users}
          eligibleUserIds={eligibleChatUserIds}
          onRename={renameGroup}
          onAddMembers={addGroupMembers}
          onRemoveMember={removeGroupMember}
          onLeave={leaveGroup}
        />
      )}

      <AlertDialog open={Boolean(messageToDelete)} onOpenChange={(open) => { if (!open) setMessageToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>This replaces the message with “This message was deleted” for everyone in the conversation.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteMessage()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete for everyone</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearChatOpen} onOpenChange={(open) => { if (!isClearingChat) setClearChatOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this chat for both sides?</AlertDialogTitle>
            <AlertDialogDescription>
              Every message in this direct chat will be permanently deleted for both participants. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearingChat}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isClearingChat}
              onClick={(event) => {
                event.preventDefault();
                void clearDirectChat();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isClearingChat && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Clear for both
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function ConversationRow({
  conversation,
  currentUser,
  usersById,
  selected,
  onClick,
}: {
  conversation: ChatConversation;
  currentUser: User;
  usersById: Map<string, User>;
  selected: boolean;
  onClick: () => void;
}) {
  const title = getConversationTitle(conversation, currentUser.id, usersById);
  const photo = getConversationPhoto(conversation, currentUser.id, usersById);
  const unread = conversation.unreadCounts?.[currentUser.id] || 0;
  const lastMessage = conversation.lastMessageText || 'No messages yet';
  const fromCurrentUser = conversation.lastMessageSenderId === currentUser.id;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
        selected && 'bg-primary/8 hover:bg-primary/10'
      )}
    >
      {selected && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />}
      <ConversationAvatar conversation={conversation} title={title} photo={photo} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn('truncate text-sm', unread ? 'font-bold' : 'font-semibold')}>{title}</p>
          <span className={cn('shrink-0 text-[11px]', unread ? 'font-semibold text-primary' : 'text-muted-foreground')}>
            {formatConversationTime(conversation.lastMessageAt || conversation.updatedAt)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className={cn('min-w-0 flex-1 truncate text-xs', unread ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            {fromCurrentUser && conversation.lastMessageText ? 'You: ' : ''}{lastMessage}
          </p>
          {unread > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ConversationHeader({
  conversation,
  currentUser,
  usersById,
  onBack,
  typingText,
  onSearch,
  onInfo,
  onClearChat,
}: {
  conversation: ChatConversation;
  currentUser: User;
  usersById: Map<string, User>;
  onBack: () => void;
  typingText: string;
  onSearch: () => void;
  onInfo: () => void;
  onClearChat: () => void;
}) {
  const title = getConversationTitle(conversation, currentUser.id, usersById);
  const photo = getConversationPhoto(conversation, currentUser.id, usersById);
  const otherUserId = conversation.memberIds.find((id) => id !== currentUser.id);
  const otherUser = otherUserId ? usersById.get(otherUserId) : undefined;
  const subtitle = typingText || (conversation.type === 'group'
    ? `${conversation.memberIds.length} members`
    : otherUser?.isOnline
      ? 'Online'
      : otherUser?.role || 'Direct message');

  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-5">
      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 md:hidden" onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />
        <span className="sr-only">Back to conversations</span>
      </Button>
      <ConversationAvatar conversation={conversation} title={title} photo={photo} size="sm" />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onInfo}>
        <h2 className="truncate text-sm font-bold sm:text-base">{title}</h2>
        <p className={cn('truncate text-xs text-muted-foreground', (typingText || otherUser?.isOnline) && 'text-emerald-600')}>
          {subtitle}
        </p>
      </button>
      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onSearch} aria-label="Search messages"><Search className="h-4 w-4" /></Button>
      {conversation.type === 'group' && <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onInfo} aria-label="Group information"><Info className="h-4 w-4" /></Button>}
      {conversation.type === 'direct' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Chat options">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={onClearChat}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function ConversationAvatar({
  conversation,
  title,
  photo,
  size = 'default',
}: {
  conversation: ChatConversation;
  title: string;
  photo?: string;
  size?: 'default' | 'sm';
}) {
  const sizeClass = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11';
  if (conversation.type === 'group') {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm', sizeClass)}>
        <UsersRound className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
      </div>
    );
  }

  return (
    <Avatar className={cn('shrink-0', sizeClass)}>
      <AvatarImage src={photo} alt={title} />
      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
        {getInitials(title)}
      </AvatarFallback>
    </Avatar>
  );
}

function EmptyConversationList({ hasSearch, onStart }: { hasSearch: boolean; onStart: () => void }) {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center">
      <div className="rounded-full bg-primary/10 p-4">
        {hasSearch ? <Search className="h-6 w-6 text-primary" /> : <MessageCircle className="h-6 w-6 text-primary" />}
      </div>
      <p className="mt-4 text-sm font-semibold">{hasSearch ? 'No matches found' : 'No conversations yet'}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {hasSearch ? 'Try a different search term.' : 'Start a direct message or create your first group.'}
      </p>
      {!hasSearch && (
        <Button size="sm" className="mt-4" onClick={onStart}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> New conversation
        </Button>
      )}
    </div>
  );
}

function EmptyChat({ onStart }: { onStart?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="relative">
        <div className="absolute inset-0 scale-150 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative rounded-3xl border bg-background p-5 shadow-sm">
          <MessageCircle className="h-9 w-9 text-primary" />
        </div>
      </div>
      <h2 className="mt-7 text-xl font-bold">Your conversations, together</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Choose a conversation from the left, message a colleague, or create a group for your team.
      </p>
      {onStart && (
        <Button className="mt-5" onClick={onStart}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> Start a conversation
        </Button>
      )}
    </div>
  );
}

function ChatAccessDenied() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center px-6 md:h-[calc(100dvh-4rem)]">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <MessageCircle className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="mt-4 text-lg font-bold">Chat access is not enabled</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your role does not have permission to view Chat System conversations. Contact an administrator if you need access.
        </p>
      </div>
    </div>
  );
}

function ConversationListSkeleton() {
  return (
    <div className="space-y-1 p-3">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl px-1 py-2">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageListSkeleton() {
  return (
    <div className="space-y-4 pb-4">
      <Skeleton className="ml-auto h-14 w-2/3 rounded-2xl" />
      <Skeleton className="h-20 w-3/5 rounded-2xl" />
      <Skeleton className="h-14 w-1/2 rounded-2xl" />
      <Skeleton className="ml-auto h-20 w-3/4 rounded-2xl" />
    </div>
  );
}

function ChatLoadingScreen() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center md:h-[calc(100dvh-4rem)]">
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
    </div>
  );
}
