
'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useModules } from '@/context/ModuleContext';
import ModuleCard from './ModuleCard';
import { Skeleton } from './ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { Module } from '@/lib/types';
import { permissionModules } from '@/lib/types';
import { useAuth } from './auth/AuthProvider';

const moduleIcons: Record<string, string> = {
  'Site Fund Requisition': 'Landmark',
  'Daily Requisition': 'FileText',
  'Billing Recon': 'CreditCard',
  'Bank Balance': 'Banknote',
  'Expenses': 'Receipt',
  'Settings': 'Settings',
  'Chat System': 'MessageSquare',
  'Loan': 'Coins',
  'LC Module': 'BookOpenCheck',
  'Insurance': 'Shield',
  'Store & Stock Management': 'Package',
  'Subcontractors Management': 'Users',
};

const moduleDescriptions: Record<string, string> = {
    'Site Fund Requisition': 'Handle site fund requests and approvals.',
    'Daily Requisition': 'Handle daily material and service requests.',
    'Billing Recon': 'Reconcile billing statements and payments.',
    'Bank Balance': 'View and manage bank balance information.',
    'Expenses': 'Track and manage project expenses.',
    'Settings': 'Manage application-wide settings.',
    'Chat System': 'A real-time messaging system for your team.',
    'Loan': 'Manage and track loan activities.',
    'LC Module': 'Manage Letters of Credit for trade finance.',
    'Insurance': 'Manage insurance policies and claims.',
    'Store & Stock Management': 'Manage inventory and stock levels.',
    'Subcontractors Management': 'Manage subcontractors, work orders, and billing.',
}

export default function ModuleDashboard() {
  const { modules, addModule, updateModule, updateModuleOrder, isLoading } = useModules();
  const { can, isLoading: authLoading } = useAuthorization();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  const allModules = useMemo(() => {
    if (isLoading || authLoading) {
      return [];
    }

    const availableModuleNames = Object.keys(permissionModules).filter(moduleName => {
        return can('View Module', moduleName);
    });

    const defaultModules = availableModuleNames.map((moduleName, index) => ({
      id: moduleName, 
      title: moduleName,
      content: moduleDescriptions[moduleName] || `Manage ${moduleName}.`,
      tags: [] as string[],
      icon: moduleIcons[moduleName] || 'FileText',
    }));

    const savedModules = modules;

    const visibleSavedModules = savedModules.filter(sm => availableModuleNames.includes(sm.title));

    const newModules = defaultModules.filter(
        dm => !visibleSavedModules.some(vsm => vsm.title === dm.title)
    );

    return [...visibleSavedModules, ...newModules];

  }, [modules, isLoading, can, authLoading]);


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
    <div className="flex flex-col gap-8 h-full m-4">
       <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" onDragOver={handleDragOver}>
        {isLoading || authLoading ? (
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
