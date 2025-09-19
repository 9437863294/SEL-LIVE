
'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useModules } from '@/context/ModuleContext';
import ModuleCard from './ModuleCard';
import { Skeleton } from './ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { Module } from '@/lib/types';
import { permissionModules } from '@/lib/types';

const moduleIcons: Record<string, string> = {
  'Site Fund Requisition': 'Landmark',
  'Daily Requisition': 'FileText',
  'Billing Recon': 'CreditCard',
  'Email Management': 'Mail',
  'Bank Balance': 'Banknote',
  'Expenses': 'Receipt',
  'Settings': 'Settings',
  'Chat System': 'MessageSquare',
  'Loan': 'Coins',
};

const moduleDescriptions: Record<string, string> = {
    'Site Fund Requisition': 'Handle site fund requests and approvals.',
    'Daily Requisition': 'Handle daily material and service requests.',
    'Billing Recon': 'Reconcile billing statements and payments.',
    'Email Management': 'Manage and respond to emails.',
    'Bank Balance': 'View and manage bank balance information.',
    'Expenses': 'Track and manage project expenses.',
    'Settings': 'Manage application-wide settings.',
    'Chat System': 'A real-time messaging system for your team.',
    'Loan': 'Manage and track loan activities.',
}

export default function ModuleDashboard() {
  const { modules, addModule, updateModule, updateModuleOrder, isLoading } = useModules();
  const { can } = useAuthorization();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading) {
      const chatModuleContent = `User Profiles

Upload profile picture.

Set username & status (Active/Busy/Offline).

Show last seen & availability.



3. Real-time Messaging

Send & receive text instantly.

Sync messages across devices.



4. One-to-One Chat

Start private conversation with any user.



5. Group Chats

Create groups with multiple members.

Assign Group Admin.

Admin adds/removes members.



6. Message Management

Delete own messages (soft delete).

Block/unblock users.



7. Read Receipts

Show ✔ when delivered.

Show ✔✔ when read.



8. File & Document Sharing

Upload images, docs, media.

Preview inside chat.



9. User Presence

Show Online/Offline.

Display Typing indicator.

Last seen timestamp.





---

🔧 Enhanced Chat Experience

10. Pinned Messages → Pin important messages.


11. Starred/Favorite Messages → Save messages for quick access.


12. Reply & Forward → Quote or forward messages.


13. Reactions/Emojis → Like 👍, ❤️, 😂, etc.


14. Message Search → Search by keywords in chat.




---

🔔 Notifications

15. Push Notifications → Realtime alerts for new messages.


16. Mute Chat/Group → Silence notifications temporarily.




---

👥 User & Group Management

17. Profile Verification → "Verified" badge for trusted users.


18. Group Roles → Admin, Moderator, Member.


19. Broadcast Messaging → One-way announcements.




---

📂 Files & Media

20. Media Gallery → View all shared images/docs in one place.


21. Auto File Compression → Optimize large file uploads.




---

🔒 Security & Privacy

22. End-to-End Encryption → Secure private chats.


23. Message Expiry → Auto-delete messages after X time.


24. Two-Factor Authentication (2FA) → Safer login.




---

📊 Analytics & Insights

25. Chat Statistics → Count of messages, busiest groups.


26. User Activity Dashboard → See engagement levels.`;

      const existingChatModule = modules.find(m => m.title === 'Chat System');

      if (existingChatModule) {
        if (existingChatModule.content !== chatModuleContent) {
          updateModule(existingChatModule.id, {
            ...existingChatModule,
            content: chatModuleContent,
          });
        }
      } else {
        addModule({
          title: 'Chat System',
          content: chatModuleContent,
          tags: ['chat', 'firebase', 'real-time'],
          icon: 'MessageSquare',
        });
      }
    }
  }, [isLoading, modules, addModule, updateModule]);


  const allModules = useMemo(() => {
    if (isLoading) {
      return [];
    }
    
    const availableModules = Object.keys(permissionModules)
        .filter(moduleName => can('View Module', moduleName))
        .map((moduleName, index) => ({
            id: String(index + 1), // Using index for a temporary stable ID
            title: moduleName,
            content: moduleDescriptions[moduleName] || `Manage ${moduleName}.`,
            tags: [],
            icon: moduleIcons[moduleName] || 'FileText',
        }));
    
    const savedChatModule = modules.find(m => m.title === 'Chat System');
    if (savedChatModule && !availableModules.some(m => m.title === 'Chat System')) {
        availableModules.push(savedChatModule);
    }

    const savedModulesMap = new Map(modules.map(m => [m.title, m]));
    
    const orderedModules = modules.map(sm => {
        const foundModule = availableModules.find(am => am.title === sm.title);
        if (foundModule) {
            // Use the saved module data, but ensure it's still available based on permissions
            return {
                ...foundModule, // a copy with default icon/desc if needed
                ...savedModulesMap.get(sm.title), // overlay saved data
            };
        }
        return null;
    }).filter(Boolean) as Module[];

    const newModules = availableModules.filter(
        am => !orderedModules.some(om => om.title === am.title)
    );

    return [...orderedModules, ...newModules];
  }, [modules, isLoading, can]);


  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggedItemId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    if (draggedItemId === null || draggedItemId === targetId) return;

    const currentModules = allModules;
    const draggedIndex = currentModules.findIndex((m) => m.id === draggedItemId);
    const targetIndex = currentModules.findIndex((m) => m.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newModules = [...currentModules];
    const [draggedItem] = newModules.splice(draggedIndex, 1);
    newModules.splice(targetIndex, 0, draggedItem);
    updateModuleOrder(newModules);
  }, [draggedItemId, allModules, updateModuleOrder]);
  
  const handleDragEnd = useCallback(() => {
    setDraggedItemId(null);
  }, []);

  return (
    <div className="flex flex-col gap-8 h-full">
       <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" onDragOver={handleDragOver}>
        {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))
        ) : (
          allModules.map((module) => (
            <ModuleCard
              key={module.id}
              module={module}
              draggable
              onDragStart={(e) => handleDragStart(e, module.id)}
              onDrop={(e) => handleDrop(e, module.id)}
              onDragEnd={handleDragEnd}
              isDragging={draggedItemId === module.id}
            />
          ))
        )}
       </div>
    </div>
  );
}
