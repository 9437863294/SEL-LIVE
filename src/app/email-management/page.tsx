
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
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const folders = [
  { name: 'Inbox', icon: Inbox, count: 12 },
  { name: 'Sent', icon: Send },
  { name: 'Drafts', icon: FileText, count: 2 },
  { name: 'Archive', icon: Archive },
  { name: 'Trash', icon: Trash2 },
];

const emails = [
  {
    id: 1,
    sender: 'Alex Doe',
    initials: 'AD',
    subject: 'Project Alpha Kick-off',
    body: 'Hi team, Just a reminder about the kick-off meeting tomorrow at 10 AM. Please come prepared to discuss the project timeline and initial deliverables. Looking forward to it!',
    date: '2 hours ago',
    read: false,
  },
  {
    id: 2,
    sender: 'Samantha Lee',
    initials: 'SL',
    subject: 'Q3 Report Final Draft',
    body: 'Attached is the final draft of the Q3 report. Please review and provide any feedback by EOD. Thanks!',
    date: 'Yesterday',
    read: true,
  },
  // Add more emails as needed
];

export default function EmailManagementPage() {
  const [selectedFolder, setSelectedFolder] = useState('Inbox');
  const [selectedEmail, setSelectedEmail] = useState(emails[0]);

  return (
    <div className="h-[calc(100vh-6rem)] w-full flex flex-col bg-background text-foreground rounded-lg border">
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={15} minSize={10} maxSize={20}>
          <div className="p-2 h-full flex flex-col">
              <div className="p-2">
                 <Button className="w-full">
                    <PlusCircle className="mr-2 h-4 w-4" /> Compose
                </Button>
              </div>
            <nav className="flex-1 space-y-1 p-2">
              {folders.map((folder) => (
                <Button
                  key={folder.name}
                  variant={selectedFolder === folder.name ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  onClick={() => setSelectedFolder(folder.name)}
                >
                  <folder.icon className="mr-2 h-4 w-4" />
                  <span>{folder.name}</span>
                  {folder.count && (
                    <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {folder.count}
                    </span>
                  )}
                </Button>
              ))}
            </nav>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={30} minSize={20}>
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <h2 className="text-xl font-bold">{selectedFolder}</h2>
              <div className="relative mt-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search..." className="pl-8" />
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto">
              {emails.map((email) => (
                <li
                  key={email.id}
                  className={cn(
                    'cursor-pointer border-b p-4 hover:bg-muted/50',
                    selectedEmail?.id === email.id && 'bg-muted'
                  )}
                  onClick={() => setSelectedEmail(email)}
                >
                  <div className="flex justify-between items-start">
                    <p className={cn("font-semibold", !email.read && 'text-primary')}>{email.sender}</p>
                    <p className="text-xs text-muted-foreground">{email.date}</p>
                  </div>
                  <p className={cn("text-sm", !email.read && 'font-bold')}>{email.subject}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {email.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={55}>
          {selectedEmail ? (
            <div className="flex flex-col h-full p-6">
              <div className="border-b pb-4 mb-4">
                <h3 className="text-2xl font-bold">{selectedEmail.subject}</h3>
                <div className="flex items-center gap-4 mt-2">
                  <Avatar>
                    <AvatarImage />
                    <AvatarFallback>{selectedEmail.initials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{selectedEmail.sender}</p>
                    <p className="text-sm text-muted-foreground">to: me@example.com</p>
                  </div>
                  <p className="ml-auto text-sm text-muted-foreground">{selectedEmail.date}</p>
                </div>
              </div>
              <div className="flex-1 prose prose-sm max-w-none">
                <p>{selectedEmail.body}</p>
              </div>
              <Separator className="my-4" />
              <div className="flex gap-2">
                <Button variant="outline">Reply</Button>
                <Button variant="outline">Forward</Button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <p>Select an email to read</p>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
