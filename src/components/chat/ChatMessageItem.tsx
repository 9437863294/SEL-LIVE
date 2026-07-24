'use client';

import {
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  FileText,
  Forward,
  MessageSquareReply,
  Pencil,
  SmilePlus,
  Star,
  Trash2,
} from 'lucide-react';
import type { User } from '@/lib/types';
import type { ChatMessage } from '@/lib/chat';
import { formatMessageTime, getInitials } from '@/lib/chat';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export type MessageDeliveryStatus = 'sent' | 'delivered' | 'read';

interface ChatMessageItemProps {
  message: ChatMessage;
  previousMessage?: ChatMessage;
  currentUserId: string;
  isGroup: boolean;
  usersById: Map<string, User>;
  deliveryStatus: MessageDeliveryStatus;
  isSearchMatch?: boolean;
  isActiveSearchMatch?: boolean;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onStar: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onJumpToMessage: (messageId: string) => void;
}

export function ChatMessageItem({
  message,
  previousMessage,
  currentUserId,
  isGroup,
  usersById,
  deliveryStatus,
  isSearchMatch,
  isActiveSearchMatch,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onStar,
  onForward,
  onJumpToMessage,
}: ChatMessageItemProps) {
  const isMine = message.senderId === currentUserId;
  const showDate = getMessageDayKey(message) !== getMessageDayKey(previousMessage);

  if (message.type === 'system') {
    return (
      <>
        {showDate && <DateDivider message={message} />}
        <div id={`message-${message.id}`} className="my-3 flex justify-center">
          <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
            {message.text}
          </span>
        </div>
      </>
    );
  }

  const sender = usersById.get(message.senderId);
  const isStarred = message.starredBy?.includes(currentUserId) || false;
  const reactions = Object.entries(message.reactions || {}).filter(([, userIds]) => userIds.length > 0);

  return (
    <>
      {showDate && <DateDivider message={message} />}
      <div
        id={`message-${message.id}`}
        className={cn(
          'group/message mb-2 flex scroll-mt-24 items-end gap-2 rounded-xl transition-colors',
          isMine ? 'justify-end' : 'justify-start',
          isSearchMatch && 'bg-amber-100/60 dark:bg-amber-900/20',
          isActiveSearchMatch && 'ring-2 ring-amber-400'
        )}
      >
        {!isMine && isGroup && (
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarImage src={sender?.photoURL} alt={message.senderName} />
            <AvatarFallback className="text-[9px]">{getInitials(message.senderName)}</AvatarFallback>
          </Avatar>
        )}
        <div className="relative max-w-[88%] sm:max-w-[74%]">
          <div
            className={cn(
              'relative rounded-2xl px-3.5 py-2 shadow-sm',
              isMine
                ? 'rounded-br-md bg-primary text-primary-foreground'
                : 'rounded-bl-md border bg-background text-foreground',
              message.deletedAt && 'italic opacity-75'
            )}
          >
            {!message.deletedAt && (
              <MessageMenu
                isMine={isMine}
                isStarred={isStarred}
                onReply={() => onReply(message)}
                onEdit={() => onEdit(message)}
                onDelete={() => onDelete(message)}
                onReact={(emoji) => onReact(message, emoji)}
                onStar={() => onStar(message)}
                onForward={() => onForward(message)}
              />
            )}

            {!isMine && isGroup && (
              <p className="mb-0.5 pr-7 text-[11px] font-bold text-primary">{message.senderName}</p>
            )}
            {message.forwardedFrom && !message.deletedAt && (
              <p className={cn('mb-1 flex items-center gap-1 text-[10px] italic', isMine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                <Forward className="h-3 w-3" /> Forwarded
              </p>
            )}
            {message.replyTo && !message.deletedAt && (
              <button
                type="button"
                onClick={() => onJumpToMessage(message.replyTo!.messageId)}
                className={cn(
                  'mb-2 block w-full rounded-lg border-l-4 p-2 text-left',
                  isMine ? 'border-primary-foreground/70 bg-black/10' : 'border-primary bg-muted/70'
                )}
              >
                <span className={cn('block truncate text-[11px] font-bold', isMine ? 'text-primary-foreground' : 'text-primary')}>
                  {message.replyTo.senderId === currentUserId ? 'You' : message.replyTo.senderName}
                </span>
                <span className={cn('block truncate text-xs', isMine ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                  {message.replyTo.text || message.replyTo.attachmentName || 'Attachment'}
                </span>
              </button>
            )}

            {message.deletedAt ? (
              <p className="flex items-center gap-2 pr-4 text-sm">
                <Trash2 className="h-3.5 w-3.5" /> This message was deleted
              </p>
            ) : (
              <>
                {message.attachments?.map((attachment, index) => (
                  <AttachmentView
                    key={`${attachment.storagePath}-${index}`}
                    attachment={attachment}
                    isMine={isMine}
                  />
                ))}
                {message.text && (
                  <p className="whitespace-pre-wrap break-words pr-5 text-sm leading-relaxed">{message.text}</p>
                )}
              </>
            )}

            <div className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', isMine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
              {isStarred && <Star className="h-2.5 w-2.5 fill-current" />}
              {message.editedAt && !message.deletedAt && <span>edited</span>}
              <span>{formatMessageTime(message.createdAt, message.clientCreatedAt)}</span>
              {isMine && <DeliveryIcon status={deliveryStatus} />}
            </div>
          </div>

          {reactions.length > 0 && (
            <div className={cn('-mt-1 flex flex-wrap gap-1', isMine ? 'justify-end pr-2' : 'justify-start pl-2')}>
              {reactions.map(([emoji, userIds]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(message, emoji)}
                  className={cn(
                    'rounded-full border bg-background px-1.5 py-0.5 text-[11px] shadow-sm hover:bg-muted',
                    userIds.includes(currentUserId) && 'border-primary bg-primary/10'
                  )}
                  title={`${userIds.length} reaction${userIds.length === 1 ? '' : 's'}`}
                >
                  {emoji} {userIds.length}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MessageMenu({
  isMine,
  isStarred,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onStar,
  onForward,
}: {
  isMine: boolean;
  isStarred: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onStar: () => void;
  onForward: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'absolute right-1 top-1 z-10 h-6 w-6 rounded-full opacity-70 sm:opacity-0 sm:group-hover/message:opacity-100',
            isMine ? 'hover:bg-black/10 hover:text-primary-foreground' : 'hover:bg-muted'
          )}
          aria-label="Message actions"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isMine ? 'end' : 'start'} className="w-48">
        <DropdownMenuLabel className="flex justify-between gap-1 px-1 py-1">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(emoji)}
              className="rounded p-1 text-lg hover:bg-muted"
            >
              {emoji}
            </button>
          ))}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReply}>
          <MessageSquareReply className="mr-2 h-4 w-4" /> Reply
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onForward}>
          <Forward className="mr-2 h-4 w-4" /> Forward
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onStar}>
          <Star className={cn('mr-2 h-4 w-4', isStarred && 'fill-current text-amber-500')} />
          {isStarred ? 'Unstar' : 'Star'}
        </DropdownMenuItem>
        {isMine && (
          <>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </>
        )}
        {!isMine && (
          <DropdownMenuItem onSelect={() => onReact('👍')}>
            <SmilePlus className="mr-2 h-4 w-4" /> React
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AttachmentView({
  attachment,
  isMine,
}: {
  attachment: NonNullable<ChatMessage['attachments']>[number];
  isMine: boolean;
}) {
  if (attachment.kind === 'image') {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt={attachment.name} className="max-h-80 w-full min-w-44 object-cover" loading="lazy" />
      </a>
    );
  }
  if (attachment.kind === 'video') {
    return <video src={attachment.url} controls preload="metadata" className="mb-2 max-h-80 w-full min-w-52 rounded-xl" />;
  }
  if (attachment.kind === 'audio') {
    return <audio src={attachment.url} controls preload="metadata" className="mb-1 h-10 max-w-full" />;
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'mb-2 flex min-w-52 items-center gap-3 rounded-xl border p-3',
        isMine ? 'border-primary-foreground/20 bg-black/10' : 'bg-muted/60'
      )}
    >
      <FileText className="h-7 w-7 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{attachment.name}</p>
        <p className="text-[10px] opacity-70">{formatFileSize(attachment.size)}</p>
      </div>
      <Download className="h-4 w-4 shrink-0" />
    </a>
  );
}

function DeliveryIcon({ status }: { status: MessageDeliveryStatus }) {
  if (status === 'sent') return <Check className="h-3.5 w-3.5" aria-label="Sent" />;
  return (
    <CheckCheck
      className={cn('h-3.5 w-3.5', status === 'read' && 'text-cyan-300')}
      aria-label={status === 'read' ? 'Read' : 'Delivered'}
    />
  );
}

function DateDivider({ message }: { message: ChatMessage }) {
  const date = new Date(message.createdAt || message.clientCreatedAt);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  let label = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(date);
  if (date.toDateString() === today.toDateString()) label = 'Today';
  if (date.toDateString() === yesterday.toDateString()) label = 'Yesterday';

  return (
    <div className="my-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-border/70" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  );
}

function getMessageDayKey(message?: ChatMessage) {
  if (!message) return '';
  const date = new Date(message.createdAt || message.clientCreatedAt);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
