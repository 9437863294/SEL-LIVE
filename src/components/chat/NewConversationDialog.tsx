'use client';

import { useMemo, useState } from 'react';
import { Check, MessageCircle, Search, UsersRound } from 'lucide-react';
import type { User } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getInitials } from '@/lib/chat';
import { cn } from '@/lib/utils';

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
  users: User[];
  isCreating: boolean;
  onStartDirect: (user: User) => Promise<void>;
  onCreateGroup: (name: string, memberIds: string[]) => Promise<void>;
}

export function NewConversationDialog({
  open,
  onOpenChange,
  currentUserId,
  users,
  isCreating,
  onStartDirect,
  onCreateGroup,
}: NewConversationDialogProps) {
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const availableUsers = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return users
      .filter((candidate) => candidate.id !== currentUserId && candidate.status !== 'Inactive')
      .filter((candidate) => {
        if (!normalized) return true;
        return `${candidate.name} ${candidate.email} ${candidate.role}`
          .toLowerCase()
          .includes(normalized);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [currentUserId, search, users]);

  const closeAndReset = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setSearch('');
      setGroupName('');
      setSelectedIds([]);
      setMode('direct');
    }
  };

  const toggleMember = (userId: string) => {
    setSelectedIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    );
  };

  const createGroup = async () => {
    if (!groupName.trim() || selectedIds.length < 1) return;
    try {
      await onCreateGroup(groupName.trim(), selectedIds);
      closeAndReset(false);
    } catch {
      // The parent displays the actionable error toast; keep the dialog open so
      // the user's selections are not lost.
    }
  };

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent size="default" className="h-[min(680px,90vh)] max-w-xl p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>Message a colleague directly or bring a team together.</DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as 'direct' | 'group')}
          className="flex min-h-0 flex-1 flex-col px-5 pb-5"
        >
          <TabsList className="mt-4 grid w-full grid-cols-2">
            <TabsTrigger value="direct" className="gap-2">
              <MessageCircle className="h-4 w-4" /> Direct message
            </TabsTrigger>
            <TabsTrigger value="group" className="gap-2">
              <UsersRound className="h-4 w-4" /> Group
            </TabsTrigger>
          </TabsList>

          <TabsContent value="direct" className="mt-4 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <UserSearch value={search} onChange={setSearch} />
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border">
              {availableUsers.length ? (
                availableUsers.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={isCreating}
                    onClick={async () => {
                      try {
                        await onStartDirect(candidate);
                        closeAndReset(false);
                      } catch {
                        // Keep the picker open when creation fails.
                      }
                    }}
                    className="flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 hover:bg-muted/70 disabled:opacity-60"
                  >
                    <UserAvatar user={candidate} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{candidate.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {candidate.role || candidate.email}
                      </p>
                    </div>
                    <MessageCircle className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))
              ) : (
                <EmptyUsers />
              )}
            </div>
          </TabsContent>

          <TabsContent value="group" className="mt-4 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <div className="space-y-2">
              <Label htmlFor="chat-group-name">Group name</Label>
              <Input
                id="chat-group-name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="e.g. Project planning"
                maxLength={80}
              />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Label>Add members</Label>
              <span className="text-xs text-muted-foreground">
                {selectedIds.length} selected
              </span>
            </div>
            <div className="mt-2">
              <UserSearch value={search} onChange={setSearch} />
            </div>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border">
              {availableUsers.length ? (
                availableUsers.map((candidate) => {
                  const selected = selectedIds.includes(candidate.id);
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => toggleMember(candidate.id)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 hover:bg-muted/70',
                        selected && 'bg-primary/5'
                      )}
                    >
                      <Checkbox
                        checked={selected}
                        tabIndex={-1}
                        aria-label={`Add ${candidate.name}`}
                      />
                      <UserAvatar user={candidate} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{candidate.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {candidate.role || candidate.email}
                        </p>
                      </div>
                      {selected && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })
              ) : (
                <EmptyUsers />
              )}
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => closeAndReset(false)}>
                Cancel
              </Button>
              <Button
                onClick={createGroup}
                disabled={isCreating || !groupName.trim() || selectedIds.length < 1}
              >
                {isCreating ? 'Creating…' : 'Create group'}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function UserSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search people…"
        className="pl-9"
      />
    </div>
  );
}

function UserAvatar({ user }: { user: User }) {
  return (
    <Avatar className="h-10 w-10">
      <AvatarImage src={user.photoURL} alt={user.name} />
      <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
    </Avatar>
  );
}

function EmptyUsers() {
  return (
    <div className="flex h-32 flex-col items-center justify-center px-4 text-center">
      <UsersRound className="mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">No people found</p>
      <p className="text-xs text-muted-foreground">Try another name or email.</p>
    </div>
  );
}
