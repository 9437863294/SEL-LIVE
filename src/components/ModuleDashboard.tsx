
'use client';

import { useState, useCallback, useMemo } from 'react';
import { useModules } from '@/context/ModuleContext';
import ModuleCard from './ModuleCard';
import { Skeleton } from './ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { Module } from '@/lib/types';
import { Landmark, FileText, CreditCard, Mail, Banknote, Receipt, Settings } from 'lucide-react';

const permissionModules = [
  'Site Fund Requisition', 
  'Daily Requisition', 
  'Billing Recon', 
  'Email Management',
  'Expenses', 
  'Settings'
];

const moduleIcons: Record<string, string> = {
  'Site Fund Requisition': 'Landmark',
  'Daily Requisition': 'FileText',
  'Billing Recon': 'CreditCard',
  'Email Management': 'Mail',
  'Bank Balance': 'Banknote',
  'Expenses': 'Receipt',
  'Settings': 'Settings',
};

const moduleDescriptions: Record<string, string> = {
    'Site Fund Requisition': 'Handle site fund requests and approvals.',
    'Daily Requisition': 'Handle daily material and service requests.',
    'Billing Recon': 'Reconcile billing statements and payments.',
    'Email Management': 'Manage and respond to emails.',
    'Bank Balance': 'View and manage bank balance information.',
    'Expenses': 'Track and manage project expenses.',
    'Settings': 'Manage application-wide settings.',
}

export default function ModuleDashboard() {
  const { modules, updateModuleOrder, isLoading } = useModules();
  const { can } = useAuthorization();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  const allModules = useMemo(() => {
    if (isLoading) {
      return [];
    }

    const availableModules = permissionModules
        .filter(moduleName => can('View Module', moduleName))
        .map((moduleName, index) => ({
            id: String(index + 1),
            title: moduleName,
            content: moduleDescriptions[moduleName] || `Manage ${moduleName}.`,
            tags: [],
            icon: moduleIcons[moduleName] || 'FileText',
        }));

    const savedModulesMap = new Map(modules.map(m => [m.title, m]));
    const orderedModules = modules.map(sm => {
        const foundModule = availableModules.find(am => am.title === sm.title);
        if (foundModule) {
            return {
                ...foundModule,
                ...savedModulesMap.get(sm.title),
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
