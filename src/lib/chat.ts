import type { Timestamp } from 'firebase/firestore';
import type { User } from '@/lib/types';

export type ConversationType = 'direct' | 'group';
export type ChatMessageType = 'text' | 'system' | 'image' | 'video' | 'audio' | 'file';

export interface ChatAttachment {
  name: string;
  url: string;
  storagePath: string;
  contentType: string;
  size: number;
  kind: 'image' | 'video' | 'audio' | 'file';
  durationSeconds?: number;
}

export interface ChatReplyPreview {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  type: ChatMessageType;
  attachmentName?: string;
}

export interface ChatConversation {
  id: string;
  type: ConversationType;
  name?: string;
  memberIds: string[];
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  lastMessageAt?: Timestamp | null;
  lastMessageText?: string;
  lastMessageId?: string;
  lastMessageSenderId?: string;
  lastMessageSenderName?: string;
  unreadCounts?: Record<string, number>;
  lastReadAt?: Record<string, Timestamp>;
  deliveredAt?: Record<string, Timestamp>;
  typing?: Record<string, number>;
  adminIds?: string[];
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  type: ChatMessageType;
  createdAt?: Timestamp | null;
  clientCreatedAt: number;
  editedAt?: Timestamp | null;
  deletedAt?: Timestamp | null;
  deletedBy?: string;
  replyTo?: ChatReplyPreview;
  attachments?: ChatAttachment[];
  reactions?: Record<string, string[]>;
  starredBy?: string[];
  forwardedFrom?: {
    messageId: string;
    senderName: string;
  };
  pushNotifiedAt?: Timestamp | null;
}

export function createReplyPreview(message: ChatMessage): ChatReplyPreview {
  return {
    messageId: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    text: message.deletedAt ? 'This message was deleted' : message.text.slice(0, 180),
    type: message.type,
    attachmentName: message.attachments?.[0]?.name,
  };
}

export function getAttachmentKind(contentType: string): ChatAttachment['kind'] {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'file';
}

export function getMessagePreview(message: Pick<ChatMessage, 'text' | 'type' | 'deletedAt' | 'attachments'>) {
  if (message.deletedAt) return 'This message was deleted';
  if (message.text.trim()) return message.text.trim();
  const labels: Record<ChatMessageType, string> = {
    text: 'Message',
    system: 'Group update',
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎤 Voice message',
    file: `📎 ${message.attachments?.[0]?.name || 'Document'}`,
  };
  return labels[message.type] || 'Message';
}

export function directConversationId(firstUserId: string, secondUserId: string) {
  return `direct_${[firstUserId, secondUserId].sort().join('_')}`;
}

export function getConversationTitle(
  conversation: ChatConversation,
  currentUserId: string,
  usersById: Map<string, User>
) {
  if (conversation.type === 'group') {
    return conversation.name?.trim() || 'Unnamed group';
  }

  const otherId = conversation.memberIds.find((id) => id !== currentUserId);
  return (otherId && usersById.get(otherId)?.name) || 'Unknown user';
}

export function getConversationPhoto(
  conversation: ChatConversation,
  currentUserId: string,
  usersById: Map<string, User>
) {
  if (conversation.type === 'group') return undefined;
  const otherId = conversation.memberIds.find((id) => id !== currentUserId);
  return otherId ? usersById.get(otherId)?.photoURL : undefined;
}

export function getInitials(name?: string | null) {
  if (!name) return 'U';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function timestampMillis(value?: Timestamp | null) {
  return value?.toMillis?.() || 0;
}

export function formatConversationTime(value?: Timestamp | null) {
  if (!value?.toDate) return '';
  const date = value.toDate();
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
  }).format(date);
}

export function formatMessageTime(value?: Timestamp | null, clientCreatedAt?: number) {
  const date = value?.toDate?.() || (clientCreatedAt ? new Date(clientCreatedAt) : null);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
