
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useModules } from '@/context/ModuleContext';
import ModuleCard from './ModuleCard';
import { Skeleton } from './ui/skeleton';
import { useAuth } from './auth/AuthProvider';
import type { Module } from '@/lib/types';

// This is the guaranteed unique list of default modules.
const defaultModules: Module[] = [
  { id: '1', title: 'Site Fund Requisition', content: 'Handle site fund requests and approvals.', tags: [], icon: 'Landmark' },
  { id: '2', title: 'Daily Requisition', content: 'Handle daily material and service requests.', tags: [], icon: 'FileText' },
  { id: '3', title: 'Billing Recon', content: 'Reconcile billing statements and payments.', tags: [], icon: 'CreditCard' },
  { id: '4', title: 'Email Management', content: 'Manage email campaigns and templates.', tags: [], icon: 'Mail' },
  { id: '5', title: 'Bank Balance', content: 'View and manage bank balance information.', tags: [], icon: 'Banknote' },
];


export default function ModuleDashboard() {
  const { modules, updateModuleOrder, isLoading, setModules } = useModules();
  const { user } = useAuth();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  // This effect runs once when the component mounts to ensure the module list is clean.
  useEffect(() => {
    if (!isLoading) {
      // Create a map of the default modules for quick lookup.
      const defaultModulesMap = new Map(defaultModules.map(m => [m.id, m]));
      // Create a map of the stored modules, ensuring no duplicates from storage.
      const storedModulesMap = new Map(modules.map(m => [m.id, m]));
  
      // Combine the maps. The stored modules will overwrite defaults if IDs are the same.
      const combinedMap = new Map([...defaultModulesMap, ...storedModulesMap]);
  
      // Re-create the array from the combined map's values.
      const finalModules = Array.from(combinedMap.values());
      
      // Ensure the final order respects the stored order as much as possible, with new modules appended.
      const orderedFinalModules = [
        ...modules.map(m => finalModules.find(fm => fm.id === m.id)).filter(Boolean) as Module[],
        ...defaultModules.filter(dm => !storedModulesMap.has(dm.id))
      ];

      // Clean up any remaining undefined entries or duplicates, just in case.
      const seen = new Set();
      const cleanedModules = orderedFinalModules.filter(el => {
        const duplicate = seen.has(el.id);
        seen.add(el.id);
        return !duplicate;
      });

      // Only update state if the list has changed, to avoid unnecessary re-renders.
      if (JSON.stringify(cleanedModules) !== JSON.stringify(modules)) {
        setModules(cleanedModules);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);


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

    const currentModules = modules;
    const draggedIndex = currentModules.findIndex((m) => m.id === draggedItemId);
    const targetIndex = currentModules.findIndex((m) => m.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newModules = [...currentModules];
    const [draggedItem] = newModules.splice(draggedIndex, 1);
    newModules.splice(targetIndex, 0, draggedItem);
    updateModuleOrder(newModules);
  }, [draggedItemId, modules, updateModuleOrder]);
  
  const handleDragEnd = useCallback(() => {
    setDraggedItemId(null);
  }, []);
  
  const currentModules = modules;

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
