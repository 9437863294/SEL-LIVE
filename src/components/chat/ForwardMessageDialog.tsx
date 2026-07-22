'use client';

import { useMemo, useState } from 'react';
import { Forward, Search } from 'lucide-react';
import type { User } from '@/lib/types';
import type { ChatConversation, ChatMessage } from '@/lib/chat';
import { getConversationTitle, getInitials } from '@/lib/chat';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function ForwardMessageDialog({
  open,
  onOpenChange,
  message,
  conversations,
  currentUserId,
  usersById,
  onForward,
  isForwarding,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: ChatMessage | null;
  conversations: ChatConversation[];
  currentUserId: string;
  usersById: Map<string, User>;
  onForward: (conversationIds: string[]) => Promise<void>;
  isForwarding: boolean;
}) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return conversations.filter((conversation) =>
      getConversationTitle(conversation, currentUserId, usersById).toLowerCase().includes(normalized)
    );
  }, [conversations, currentUserId, search, usersById]);

  const changeOpen = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setSearch('');
      setSelectedIds([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent size="default" className="h-[min(620px,90vh)] max-w-lg p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Forward message</DialogTitle>
          <DialogDescription>Select one or more conversations.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" className="pl-9" />
          </div>
          {message && (
            <div className="mt-3 truncate rounded-lg border-l-4 border-primary bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {message.text || message.attachments?.[0]?.name || 'Attachment'}
            </div>
          )}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border">
            {filtered.map((conversation) => {
              const title = getConversationTitle(conversation, currentUserId, usersById);
              const selected = selectedIds.includes(conversation.id);
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedIds((current) => selected ? current.filter((id) => id !== conversation.id) : [...current, conversation.id])}
                  className="flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-0 hover:bg-muted/60"
                >
                  <Checkbox checked={selected} tabIndex={-1} />
                  <Avatar className="h-9 w-9"><AvatarFallback>{getInitials(title)}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
                </button>
              );
            })}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => changeOpen(false)}>Cancel</Button>
            <Button
              disabled={!selectedIds.length || isForwarding}
              onClick={async () => {
                try {
                  await onForward(selectedIds);
                  changeOpen(false);
                } catch {
                  // The parent reports the error and the selections stay intact.
                }
              }}
            >
              <Forward className="mr-2 h-4 w-4" />
              {isForwarding ? 'Forwarding…' : `Forward${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
