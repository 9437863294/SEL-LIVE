'use client';

import { useMemo, useState } from 'react';
import { LogOut, Pencil, Search, ShieldCheck, UserMinus, UserPlus, UsersRound } from 'lucide-react';
import type { User } from '@/lib/types';
import type { ChatConversation } from '@/lib/chat';
import { getInitials } from '@/lib/chat';
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

export function GroupInfoDialog({
  open,
  onOpenChange,
  conversation,
  currentUser,
  users,
  eligibleUserIds,
  onRename,
  onAddMembers,
  onRemoveMember,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ChatConversation;
  currentUser: User;
  users: User[];
  eligibleUserIds: ReadonlySet<string>;
  onRename: (name: string) => Promise<void>;
  onAddMembers: (ids: string[]) => Promise<void>;
  onRemoveMember: (id: string) => Promise<void>;
  onLeave: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'details' | 'rename' | 'add'>('details');
  const [name, setName] = useState(conversation.name || '');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const isAdmin = conversation.createdBy === currentUser.id || conversation.adminIds?.includes(currentUser.id);
  const members = conversation.memberIds.map((id) => users.find((user) => user.id === id)).filter(Boolean) as User[];
  const candidates = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return users.filter((user) =>
      user.status !== 'Inactive' &&
      eligibleUserIds.has(user.id) &&
      !conversation.memberIds.includes(user.id) &&
      `${user.name} ${user.email}`.toLowerCase().includes(normalized)
    );
  }, [conversation.memberIds, eligibleUserIds, search, users]);

  const reset = () => {
    setMode('details');
    setName(conversation.name || '');
    setSearch('');
    setSelectedIds([]);
  };

  if (mode === 'rename') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="default" className="max-w-md">
          <DialogHeader><DialogTitle>Rename group</DialogTitle><DialogDescription>Choose a name everyone will recognise.</DialogDescription></DialogHeader>
          <div className="space-y-2 py-4"><Label htmlFor="rename-group">Group name</Label><Input id="rename-group" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode('details')}>Cancel</Button>
            <Button disabled={!name.trim() || busy} onClick={async () => { setBusy(true); await onRename(name.trim()); setBusy(false); setMode('details'); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (mode === 'add') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="default" className="h-[min(620px,90vh)] max-w-lg p-0">
          <DialogHeader className="border-b px-5 py-4 pr-12"><DialogTitle>Add members</DialogTitle><DialogDescription>Select colleagues to add to this group.</DialogDescription></DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people" className="pl-9" /></div>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border">
              {candidates.map((candidate) => {
                const selected = selectedIds.includes(candidate.id);
                return <button key={candidate.id} type="button" onClick={() => setSelectedIds((current) => selected ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])} className="flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-0 hover:bg-muted/60"><Checkbox checked={selected} tabIndex={-1} /><MemberAvatar user={candidate} /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{candidate.name}</span></button>;
              })}
            </div>
            <DialogFooter className="mt-4"><Button variant="outline" onClick={() => setMode('details')}>Cancel</Button><Button disabled={!selectedIds.length || busy} onClick={async () => { setBusy(true); await onAddMembers(selectedIds); setBusy(false); setSelectedIds([]); setMode('details'); }}><UserPlus className="mr-2 h-4 w-4" /> Add</Button></DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { onOpenChange(nextOpen); if (!nextOpen) reset(); }}>
      <DialogContent size="default" className="h-[min(700px,92vh)] max-w-lg p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12"><DialogTitle>Group info</DialogTitle><DialogDescription>Members and conversation settings.</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col items-center border-b px-5 py-6 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white"><UsersRound className="h-9 w-9" /></div>
            <h2 className="mt-3 text-lg font-bold">{conversation.name}</h2>
            <p className="text-xs text-muted-foreground">{members.length} members</p>
            {isAdmin && <Button variant="ghost" size="sm" className="mt-2" onClick={() => setMode('rename')}><Pencil className="mr-2 h-3.5 w-3.5" /> Rename group</Button>}
          </div>
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold">Members</p>{isAdmin && <Button variant="outline" size="sm" onClick={() => setMode('add')}><UserPlus className="mr-2 h-3.5 w-3.5" /> Add</Button>}</div>
            <div className="overflow-hidden rounded-xl border">
              {members.map((member) => {
                const memberIsAdmin = conversation.createdBy === member.id || conversation.adminIds?.includes(member.id);
                return <div key={member.id} className="flex items-center gap-3 border-b px-3 py-3 last:border-0"><MemberAvatar user={member} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{member.id === currentUser.id ? 'You' : member.name}</p><p className="truncate text-xs text-muted-foreground">{member.role || member.email}</p></div>{memberIsAdmin && <span className="flex items-center gap-1 text-[10px] font-semibold text-primary"><ShieldCheck className="h-3 w-3" /> Admin</span>}{isAdmin && member.id !== currentUser.id && !memberIsAdmin && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void onRemoveMember(member.id)}><UserMinus className="h-4 w-4" /></Button>}</div>;
              })}
            </div>
            <Button variant="ghost" className="mt-4 w-full justify-start text-destructive hover:text-destructive" onClick={() => void onLeave()}><LogOut className="mr-2 h-4 w-4" /> Leave group</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MemberAvatar({ user }: { user: User }) {
  return <Avatar className="h-9 w-9"><AvatarImage src={user.photoURL} alt={user.name} /><AvatarFallback>{getInitials(user.name)}</AvatarFallback></Avatar>;
}
