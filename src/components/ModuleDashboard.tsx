
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
  { id: '5', title: 'Bank Balance', content: 'View and manage bank balance information.', tags: [], icon: 'Banknote' },
  { id: '6', title: 'Expenses', content: 'Track and manage project expenses.', tags: [], icon: 'Receipt' },
];


export default function ModuleDashboard() {
  const { modules, updateModuleOrder, isLoading, setModules } = useModules();
  const { user } = useAuth();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  // This effect runs once when the component mounts to ensure the module list is clean.
  useEffect(() => {
    if (!isLoading) {
        // Use a Map to ensure all module IDs are unique.
        const modulesMap = new Map();

        // Add default modules first.
        defaultModules.forEach(module => {
            modulesMap.set(module.id, module);
        });

        // Add stored modules, overwriting defaults if IDs match.
        // This also filters out any old/stale modules that are no longer in the default list
        // unless they were custom-added. The primary goal is to ensure no duplicates from defaults.
        modules.forEach(module => {
            if (module.title !== 'Billing Recon' || module.content !== 'This is a new module.') {
               modulesMap.set(module.id, module);
            }
        });
        
        // Use the order from storage as the base, but ensure all default modules are present.
        const finalModules: Module[] = [];
        const finalModuleIds = new Set<string>();

        // Add modules based on the stored order first
        modules.forEach(storedModule => {
            if (modulesMap.has(storedModule.id)) {
                finalModules.push(modulesMap.get(storedModule.id));
                finalModuleIds.add(storedModule.id);
                modulesMap.delete(storedModule.id); // Remove from map to avoid re-adding
            }
        });

        // Add any remaining modules from the map (these would be new default modules)
        modulesMap.forEach(module => {
            finalModules.push(module);
        });
        
        setModules(finalModules);
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
