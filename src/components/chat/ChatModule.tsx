'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
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
  getDocs,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytesResumable, type UploadTaskSnapshot } from 'firebase/storage';
import { useSearchParams } from 'next/navigation';
import type { User } from '@/lib/types';
import type { Role } from '@/lib/types';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToastAction } from '@/components/ui/toast';
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
  isConversationArchived,
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
  clearTypingOnDisconnect,
  createRealtimeConversation,
  fetchOlderMessages,
  getRealtimeConversation,
  listenToMessages,
  MESSAGE_PAGE_SIZE,
  newRealtimeKey,
  persistRealtimeMessage,
  realtimeServerTimestamp,
  setConversationArchived,
  transactMessageReactions,
  transactMessageStars,
  updateConversation,
  updateMessage,
  updateRealtimePaths,
} from '@/lib/chat-realtime';
import { subscribeToUserConversations } from '@/lib/chat-conversations-store';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
const TYPING_HEARTBEAT_MS = 2000;

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
  const [showArchived, setShowArchived] = useState(false);
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
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const messageContentRef = useRef<HTMLDivElement>(null);
  /** The conversation the view has already been dropped to the bottom of. */
  const landedConversationRef = useRef<string | null>(null);
  /** Whether the reader is sitting at the newest message and wants to follow it. */
  const stickToBottomRef = useRef(true);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingHeartbeatRef = useRef<number>(0);

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

  // The live listener holds only the newest page; anything paged in via
  // "load older" is kept separately and prepended for display.
  const visibleMessages = useMemo(() => {
    if (!olderMessages.length) return messages;
    const seen = new Set(messages.map((message) => message.id));
    return [...olderMessages.filter((message) => !seen.has(message.id)), ...messages];
  }, [messages, olderMessages]);

  const searchMatches = useMemo(() => {
    const normalized = messageSearch.trim().toLowerCase();
    if (!normalized) return [] as ChatMessage[];
    return visibleMessages.filter((message) =>
      `${message.senderName} ${message.text} ${(message.attachments || []).map((item) => item.name).join(' ')}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [messageSearch, visibleMessages]);

  // Membership lookup per rendered row was O(matches); a set makes it O(1).
  const searchMatchIds = useMemo(
    () => new Set(searchMatches.map((message) => message.id)),
    [searchMatches]
  );

  const activeSearchMatchId = searchMatches.length
    ? searchMatches[Math.min(activeSearchIndex, searchMatches.length - 1)]?.id ?? null
    : null;

  const handleLoadOlderMessages = useCallback(async () => {
    if (!selectedConversationId || isLoadingOlder || !hasMoreHistory) return;
    const oldest = visibleMessages[0];
    if (!oldest) return;
    setIsLoadingOlder(true);
    try {
      const page = await fetchOlderMessages(selectedConversationId, oldest.clientCreatedAt);
      if (page.length < MESSAGE_PAGE_SIZE) setHasMoreHistory(false);
      if (page.length) setOlderMessages((prev) => [...page, ...prev]);
    } catch (error) {
      console.error('Unable to load older messages:', error);
      toast({
        title: 'Could not load older messages',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingOlder(false);
    }
  }, [hasMoreHistory, isLoadingOlder, selectedConversationId, toast, visibleMessages]);

  const activeTypingNames = useMemo(() => {
    if (!selectedConversation?.typing || !user?.id) return [];
    return Object.entries(selectedConversation.typing)
      .filter(([userId, lastTypedAt]) => userId !== user.id && typingClock - Number(lastTypedAt) < 5000)
      .map(([userId]) => usersById.get(userId)?.name || 'Someone');
  }, [selectedConversation?.typing, typingClock, user?.id, usersById]);

  // Only tick while someone is actually typing. This used to run unconditionally,
  // re-rendering the whole module and every message row once a second forever.
  const hasTypingActivity = useMemo(() => {
    const typing = selectedConversation?.typing;
    if (!typing || !user?.id) return false;
    return Object.entries(typing).some(
      ([userId, lastTypedAt]) => userId !== user.id && Date.now() - Number(lastTypedAt) < 5000
    );
    // typingClock is a dep so each tick re-evaluates and the interval can stop
    // itself once the last entry goes stale, even if the peer's clear never lands.
  }, [selectedConversation?.typing, typingClock, user?.id]);

  useEffect(() => {
    if (!hasTypingActivity) return;
    const interval = window.setInterval(() => setTypingClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasTypingActivity]);

  useEffect(() => {
    if (isLoadingPermissions || !canViewChat) {
      setChatEnabledRoles(new Set());
      setIsLoadingChatRoles(false);
      return;
    }

    // Which roles may receive chats changes about as often as the role list
    // itself — a one-shot read on mount, not a standing listener over the whole
    // collection for the lifetime of the page.
    let cancelled = false;
    setIsLoadingChatRoles(true);
    getDocs(collection(db, 'roles'))
      .then((snapshot) => {
        if (cancelled) return;
        setChatEnabledRoles(new Set(
          snapshot.docs
            .map((roleDocument) => roleDocument.data() as Role)
            .filter((role) => canRoleReceiveChats(role.permissions))
            .map((role) => role.name)
        ));
        setIsLoadingChatRoles(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Unable to load chat-enabled roles:', error);
        setChatEnabledRoles(new Set());
        setIsLoadingChatRoles(false);
      });
    return () => { cancelled = true; };
  }, [canViewChat, isLoadingPermissions]);

  useEffect(() => {
    setReplyingTo(null);
    setEditingMessage(null);
    setDraft('');
    setMessageSearch('');
    setMessageSearchOpen(false);
    setActiveSearchIndex(0);

    // Cancel any pending "stop typing" write and clear the flag we may have set.
    // Without this the timer fired after navigation, writing to the conversation
    // we just left, and the previous chat kept showing us as typing.
    const previousConversationId = selectedConversationId;
    const userId = user?.id;
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      if (typingHeartbeatRef.current && previousConversationId && userId) {
        updateConversation(previousConversationId, { [`typing/${userId}`]: null }).catch(() => {});
      }
      typingHeartbeatRef.current = 0;
    };
  }, [selectedConversationId, user?.id]);

  useEffect(() => {
    if (searchMatches.length && activeSearchIndex > searchMatches.length - 1) {
      setActiveSearchIndex(searchMatches.length - 1);
    }
  }, [activeSearchIndex, searchMatches.length]);

  useEffect(() => {
    if (!activeSearchMatchId) return;
    document.getElementById(`message-${activeSearchMatchId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Keyed on the matched id rather than the matches array: the array gets a new
    // identity on every incoming message, which re-scrolled the viewport each time.
  }, [activeSearchMatchId]);

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
    // Shared with the header's unread badge; the store sorts the list and owns
    // the delivery receipts, so this callback is pure state assignment.
    return subscribeToUserConversations(user.id, {
      onConversations: (nextConversations) => {
        setConversations(nextConversations);
        setSelectedConversationId((current) => {
          if (current && nextConversations.some((conversation) => conversation.id === current)) {
            return current;
          }
          return null;
        });
        setIsLoadingConversations(false);
      },
      onError: (error) => {
        console.error('Unable to load conversations:', error);
        setIsLoadingConversations(false);
        toast({
          title: 'Could not load chat',
          description: 'Please check your connection and try again.',
          variant: 'destructive',
        });
      },
    });
  }, [canViewChat, toast, user?.id]);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }
    setIsLoadingMessages(true);
    setOlderMessages([]);
    setHasMoreHistory(true);
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

  const scrollToLatest = useCallback(() => {
    const container = messageScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    // Opening a conversation lands on its newest message however long the history
    // is. The near-bottom test only decides whether to follow *later* arrivals —
    // applying it to the landing left every chat taller than the viewport parked
    // at the top of the loaded page, because a fresh list starts at scrollTop 0.
    if (!selectedConversationId) {
      // Leaving the chat unmounts the scroller, so its position is gone: the next
      // visit has to land again even if it is the same conversation.
      landedConversationRef.current = null;
      return;
    }
    if (isLoadingMessages) return;
    if (landedConversationRef.current !== selectedConversationId) {
      landedConversationRef.current = selectedConversationId;
      stickToBottomRef.current = true;
      scrollToLatest();
      return;
    }
    if (stickToBottomRef.current) scrollToLatest();
  }, [isLoadingMessages, messages.length, scrollToLatest, selectedConversationId]);

  useEffect(() => {
    // Attachments carry no intrinsic size until they load, so the list keeps
    // growing after the scroll above and the view drifts off the newest message.
    // Re-pin on each height change while the reader is at the bottom; once they
    // scroll up into history, leave the viewport where they put it.
    const container = messageScrollRef.current;
    const content = messageContentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') return;

    const trackScrollPosition = () => {
      stickToBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    };
    container.addEventListener('scroll', trackScrollPosition, { passive: true });

    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToLatest();
    });
    observer.observe(content);

    return () => {
      container.removeEventListener('scroll', trackScrollPosition);
      observer.disconnect();
    };
  }, [scrollToLatest, selectedConversationId]);

  const [activeConversations, archivedConversations] = useMemo(() => {
    if (!user?.id) return [conversations, [] as ChatConversation[]];
    const userId = user.id;
    const active: ChatConversation[] = [];
    const archived: ChatConversation[] = [];
    conversations.forEach((conversation) => {
      (isConversationArchived(conversation, userId) ? archived : active).push(conversation);
    });
    return [active, archived];
  }, [conversations, user?.id]);

  const archivedUnreadCount = useMemo(() => {
    if (!user?.id) return 0;
    const userId = user.id;
    return archivedConversations.reduce(
      (total, conversation) => total + (conversation.unreadCounts?.[userId] || 0),
      0
    );
  }, [archivedConversations, user?.id]);

  const listedConversations = showArchived ? archivedConversations : activeConversations;

  const filteredConversations = useMemo(() => {
    const normalized = conversationSearch.trim().toLowerCase();
    if (!normalized || !user?.id) return listedConversations;
    return listedConversations.filter((conversation) => {
      const title = getConversationTitle(conversation, user.id, usersById);
      return `${title} ${conversation.lastMessageText || ''}`.toLowerCase().includes(normalized);
    });
  }, [conversationSearch, listedConversations, user?.id, usersById]);

  // Restoring the last archived chat (from here or another device) leaves nothing
  // to show, so fall back to the main list instead of an empty screen.
  useEffect(() => {
    if (showArchived && !archivedConversations.length) setShowArchived(false);
  }, [archivedConversations.length, showArchived]);

  const updateArchiveState = useCallback(
    async (conversation: ChatConversation, archived: boolean) => {
      if (!user?.id) return;
      const userId = user.id;
      try {
        await setConversationArchived(conversation.id, userId, archived);
        if (archived) {
          // The chat just left the list underneath the reader; drop back to it.
          setSelectedConversationId((current) => (current === conversation.id ? null : current));
          toast({
            title: 'Chat archived',
            description: 'It moved to Archived and will stop sending you notifications.',
            action: (
              <ToastAction
                altText="Undo archiving this chat"
                onClick={() => {
                  void setConversationArchived(conversation.id, userId, false).catch((error) => {
                    console.error('Unable to restore conversation:', error);
                  });
                }}
              >
                Undo
              </ToastAction>
            ),
          });
        } else {
          toast({
            title: 'Chat restored',
            description: 'It is back in your conversation list.',
          });
        }
      } catch (error) {
        console.error('Unable to change the archive state:', error);
        toast({
          title: archived ? 'Chat not archived' : 'Chat not restored',
          description: 'Please try again.',
          variant: 'destructive',
        });
      }
    },
    [toast, user?.id]
  );

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
      // The message is already in Realtime DB and has rendered for everyone with
      // the app open. Push dispatch is best-effort follow-up work (the route
      // answers 202 and finishes in the background), so don't hold the composer
      // — or a multi-target forward — open waiting for the round trip.
      void notifyChatRecipients(conversation.id, messageId).catch((notificationError) => {
        console.warn('Message saved, but push notification delivery failed:', notificationError);
      });
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

    if (!value.trim()) {
      typingHeartbeatRef.current = 0;
      updateConversation(selectedConversationId, { [`typing/${user.id}`]: null }).catch(() => {});
      return;
    }

    // Peers treat a heartbeat as live for 5s, so re-announcing on every keystroke
    // was one Realtime DB write per character. Refresh at most every 2s instead.
    const now = Date.now();
    if (now - typingHeartbeatRef.current > TYPING_HEARTBEAT_MS) {
      typingHeartbeatRef.current = now;
      updateConversation(selectedConversationId, { [`typing/${user.id}`]: now }).catch(() => {});
      // If this tab dies mid-typing, don't strand the indicator on for everyone.
      clearTypingOnDisconnect(selectedConversationId, user.id);
    }

    typingTimerRef.current = setTimeout(() => {
      typingHeartbeatRef.current = 0;
      updateConversation(selectedConversationId, { [`typing/${user.id}`]: null }).catch(() => {});
    }, 1800);
  };

  const uploadAttachments = async (files: File[], voiceDurationSeconds?: number) => {
    if (!selectedConversation || !user?.id || !files.length) return false;
    const selectedFiles = files.slice(0, 5);
    const invalid = selectedFiles.find((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (invalid) {
      toast({ title: 'Attachment too large', description: `${invalid.name} exceeds the 25 MB limit.`, variant: 'destructive' });
      return false;
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
      return true;
    } catch (error) {
      console.error('Attachment upload failed:', error);
      toast({ title: 'Upload failed', description: 'The attachment could not be sent.', variant: 'destructive' });
      return false;
    } finally {
      setUploadProgress(null);
    }
  };

  // The handlers below are passed to every rendered message row; keeping their
  // identity stable is what lets the memoized rows skip re-rendering.
  const toggleReaction = useCallback(async (message: ChatMessage, emoji: string) => {
    if (!user?.id || !selectedConversationId) return;
    const userId = user.id;
    await transactMessageReactions(selectedConversationId, message.id, (currentReactions) => {
      const reactions = { ...currentReactions };
      const usersForReaction = reactions[emoji] || [];
      reactions[emoji] = usersForReaction.includes(userId)
        ? usersForReaction.filter((id) => id !== userId)
        : [...usersForReaction, userId];
      if (!reactions[emoji].length) delete reactions[emoji];
      return reactions;
    });
  }, [selectedConversationId, user?.id]);

  const toggleStar = useCallback(async (message: ChatMessage) => {
    if (!user?.id || !selectedConversationId) return;
    await transactMessageStars(selectedConversationId, message.id, user.id);
  }, [selectedConversationId, user?.id]);

  const handleReplyToMessage = useCallback((selected: ChatMessage) => {
    setEditingMessage(null);
    setReplyingTo(selected);
  }, []);

  const handleEditMessage = useCallback((selected: ChatMessage) => {
    setReplyingTo(null);
    setEditingMessage(selected);
    setDraft(selected.text);
  }, []);

  const handleReactToMessage = useCallback(
    (selected: ChatMessage, emoji: string) => void toggleReaction(selected, emoji),
    [toggleReaction]
  );

  const handleStarMessage = useCallback(
    (selected: ChatMessage) => void toggleStar(selected),
    [toggleStar]
  );

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
      // Independent writes — dispatch together rather than one round trip per
      // target, which made forwarding to several chats visibly slow.
      const targets = conversationIds
        .map((conversationId) => conversations.find((conversation) => conversation.id === conversationId))
        .filter((target): target is ChatConversation => Boolean(target));
      await Promise.all(
        targets.map((target) =>
          persistMessage(target, {
            text: messageToForward.text,
            type: messageToForward.type,
            attachments: messageToForward.attachments,
            forwardedFrom: { messageId: messageToForward.id, senderName: messageToForward.senderName },
          })
        )
      );
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

  const jumpToMessage = useCallback((messageId: string) => {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

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
              <div className="flex min-w-0 items-center gap-2">
                {showArchived && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-2 h-9 w-9 shrink-0"
                    onClick={() => { setShowArchived(false); setConversationSearch(''); }}
                    aria-label="Back to all conversations"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                )}
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-bold tracking-tight">
                    {showArchived ? 'Archived' : 'Conversations'}
                  </h1>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {showArchived
                      ? 'Kept out of the main list and muted'
                      : 'Direct messages and team groups'}
                  </p>
                </div>
              </div>
              {canSendChat && !showArchived && (
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full"
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
                placeholder={showArchived ? 'Search archived' : 'Search conversations'}
                className="h-9 bg-muted/50 pl-9"
              />
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {isLoadingConversations ? (
              <ConversationListSkeleton />
            ) : (
              <>
                {!showArchived && archivedConversations.length > 0 && !conversationSearch.trim() && (
                  <button
                    type="button"
                    onClick={() => setShowArchived(true)}
                    className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/60"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Archive className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">Archived</p>
                      <p className="text-xs text-muted-foreground">
                        {archivedConversations.length} chat{archivedConversations.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    {archivedUnreadCount > 0 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                        {archivedUnreadCount > 99 ? '99+' : archivedUnreadCount}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                )}
                {filteredConversations.length ? (
                  <div className="py-2">
                    {filteredConversations.map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        currentUser={user}
                        usersById={usersById}
                        selected={conversation.id === selectedConversationId}
                        isArchived={showArchived}
                        onClick={() => setSelectedConversationId(conversation.id)}
                        onToggleArchive={() => void updateArchiveState(conversation, !showArchived)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyConversationList
                    hasSearch={Boolean(conversationSearch.trim())}
                    isArchived={showArchived}
                    onStart={() => setNewConversationOpen(true)}
                  />
                )}
              </>
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
                isArchived={isConversationArchived(selectedConversation, user.id)}
                onToggleArchive={() =>
                  void updateArchiveState(
                    selectedConversation,
                    !isConversationArchived(selectedConversation, user.id)
                  )
                }
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
              <div ref={messageScrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
                <div ref={messageContentRef} className="mx-auto flex min-h-full max-w-3xl flex-col justify-end">
                  {isLoadingMessages ? (
                    <MessageListSkeleton />
                  ) : visibleMessages.length ? (
                    <>
                    {hasMoreHistory && visibleMessages.length >= MESSAGE_PAGE_SIZE && (
                      <div className="mb-3 flex justify-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isLoadingOlder}
                          onClick={() => void handleLoadOlderMessages()}
                        >
                          {isLoadingOlder ? (
                            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Loading…</>
                          ) : (
                            'Load older messages'
                          )}
                        </Button>
                      </div>
                    )}
                    {visibleMessages.map((message, index) => (
                      <ChatMessageItem
                        key={message.id}
                        message={message}
                        previousMessage={visibleMessages[index - 1]}
                        currentUserId={user.id}
                        isGroup={selectedConversation.type === 'group'}
                        usersById={usersById}
                        deliveryStatus={getDeliveryStatus(message)}
                        isSearchMatch={searchMatchIds.has(message.id)}
                        isActiveSearchMatch={activeSearchMatchId === message.id}
                        onReply={handleReplyToMessage}
                        onEdit={handleEditMessage}
                        onDelete={setMessageToDelete}
                        onReact={handleReactToMessage}
                        onStar={handleStarMessage}
                        onForward={setMessageToForward}
                        onJumpToMessage={jumpToMessage}
                      />
                    ))}
                    </>
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
  isArchived,
  onClick,
  onToggleArchive,
}: {
  conversation: ChatConversation;
  currentUser: User;
  usersById: Map<string, User>;
  selected: boolean;
  isArchived: boolean;
  onClick: () => void;
  onToggleArchive: () => void;
}) {
  const title = getConversationTitle(conversation, currentUser.id, usersById);
  const photo = getConversationPhoto(conversation, currentUser.id, usersById);
  const unread = conversation.unreadCounts?.[currentUser.id] || 0;
  const lastMessage = conversation.lastMessageText || 'No messages yet';
  const fromCurrentUser = conversation.lastMessageSenderId === currentUser.id;

  return (
    <div
      className={cn(
        'group relative flex w-full items-center gap-3 pl-4 pr-2 transition-colors hover:bg-muted/60',
        selected && 'bg-primary/8 hover:bg-primary/10'
      )}
    >
      {selected && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />}
      {/* The row is a button plus a sibling control, so the archive action is not
          nested inside the clickable row (which browsers reject). */}
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
      >
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
      <Button
        variant="ghost"
        size="icon"
        // Always reachable by touch; on pointer devices it stays out of the way
        // until the row is hovered or the control itself is focused.
        className="h-8 w-8 shrink-0 text-muted-foreground md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
        onClick={onToggleArchive}
        aria-label={isArchived ? `Unarchive chat with ${title}` : `Archive chat with ${title}`}
        title={isArchived ? 'Unarchive' : 'Archive'}
      >
        {isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      </Button>
    </div>
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
  isArchived,
  onToggleArchive,
}: {
  conversation: ChatConversation;
  currentUser: User;
  usersById: Map<string, User>;
  onBack: () => void;
  typingText: string;
  onSearch: () => void;
  onInfo: () => void;
  onClearChat: () => void;
  isArchived: boolean;
  onToggleArchive: () => void;
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Chat options">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onToggleArchive}>
            {isArchived ? (
              <><ArchiveRestore className="mr-2 h-4 w-4" />Unarchive chat</>
            ) : (
              <><Archive className="mr-2 h-4 w-4" />Archive chat</>
            )}
          </DropdownMenuItem>
          {conversation.type === 'direct' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onClearChat}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Clear chat
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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

function EmptyConversationList({
  hasSearch,
  isArchived,
  onStart,
}: {
  hasSearch: boolean;
  isArchived: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center">
      <div className="rounded-full bg-primary/10 p-4">
        {hasSearch ? (
          <Search className="h-6 w-6 text-primary" />
        ) : isArchived ? (
          <Archive className="h-6 w-6 text-primary" />
        ) : (
          <MessageCircle className="h-6 w-6 text-primary" />
        )}
      </div>
      <p className="mt-4 text-sm font-semibold">
        {hasSearch ? 'No matches found' : isArchived ? 'Nothing archived' : 'No conversations yet'}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {hasSearch
          ? 'Try a different search term.'
          : isArchived
            ? 'Archived chats stay here until you restore them.'
            : 'Start a direct message or create your first group.'}
      </p>
      {!hasSearch && !isArchived && (
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
