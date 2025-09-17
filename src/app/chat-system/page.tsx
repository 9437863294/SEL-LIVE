
'use client';

import { useState } from 'react';
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
import type { User } from '@/lib/types';


export default function ChatSystemPage() {
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  
  const handleSelectUser = (user: User) => {
    console.log("Selected user:", user.name);
    // Here you would implement logic to create or open a chat with the selected user.
    setIsNewChatOpen(false);
  };

  return (
    <>
      <div className="h-[calc(100vh-6rem)] w-full flex flex-col bg-background text-foreground rounded-lg border">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={20} minSize={15} maxSize={25}>
            <div className="p-2 h-full flex flex-col">
                <div className="p-2">
                  <Button className="w-full" onClick={() => setIsNewChatOpen(true)}>
                      <PlusCircle className="mr-2 h-4 w-4" /> New Chat
                  </Button>
                </div>
                <Separator />
              <nav className="flex-1 space-y-1 p-2 overflow-y-auto">
                {/* Placeholder for chat list */}
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-1">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-full" />
                      </div>
                  </div>
                ))}
              </nav>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={80}>
            <div className="flex h-full flex-col items-center justify-center bg-muted/50">
                <MessageSquare className="h-16 w-16 text-muted-foreground" />
                <p className="mt-4 text-lg text-muted-foreground">Select a chat to start messaging</p>
              </div>
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
