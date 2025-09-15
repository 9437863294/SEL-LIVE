
'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useModules } from '@/context/ModuleContext';
import ModuleCard from './ModuleCard';
import { Skeleton } from './ui/skeleton';
import { useAuth } from './auth/AuthProvider';
import type { Module } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';

// This is the guaranteed unique list of default modules.
const defaultModules: Module[] = [
  { id: '1', title: 'Site Fund Requisition', content: 'Handle site fund requests and approvals.', tags: [], icon: 'Landmark' },
  { id: '2', title: 'Daily Requisition', content: 'Handle daily material and service requests.', tags: [], icon: 'FileText' },
  { id: '3', title: 'Billing Recon', content: 'Reconcile billing statements and payments.', tags: [], icon: 'CreditCard' },
  { id: '4', title: 'Email Management', content: 'Manage and respond to emails.', tags: [], icon: 'Mail' },
  { id: '5', title: 'Bank Balance', content: 'View and manage bank balance information.', tags: [], icon: 'Banknote' },
  { id: '6', title: 'Expenses', content: 'Track and manage project expenses.', tags: [], icon: 'Receipt' },
];


export default function ModuleDashboard() {
  const { modules, updateModuleOrder, isLoading } = useModules();
  const { can } = useAuthorization();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  const allModules = useMemo(() => {
    if (isLoading) {
      return [];
    }
    // Create a map of the modules from local storage for quick lookups.
    const savedModulesMap = new Map(modules.map(m => [m.id, m]));

    // Ensure all default modules are present, using the saved version if it exists.
    const finalModules = defaultModules.map(dm => savedModulesMap.get(dm.id) || dm);
    
    // Add any truly custom modules (not in the default set) that might exist in storage.
    modules.forEach(sm => {
        if (!defaultModules.some(dm => dm.id === sm.id)) {
            finalModules.push(sm);
        }
    });

    return finalModules;
  }, [modules, isLoading]);


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
  
  const currentModules = useMemo(() => {
    if (isLoading) return [];
    return allModules.filter(module => can('View Module', module.title));
  }, [allModules, can, isLoading]);

  return (
    <div className="flex flex-col gap-8 h-full">
       <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" onDragOver={handleDragOver}>
        {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))
        ) : (
          currentModules.map((module) => (
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
