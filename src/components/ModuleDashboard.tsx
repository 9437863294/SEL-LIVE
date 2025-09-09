
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useModules } from '@/context/ModuleContext';
import ModuleCard from './ModuleCard';
import { Skeleton } from './ui/skeleton';
import { useAuth } from './auth/AuthProvider';

const defaultModules = [
  { id: '1', title: 'Site Fund Requisition', content: 'Handle site fund requests and approvals.', tags: [], icon: 'Landmark' },
  { id: '2', title: 'Daily Requisition', content: 'Handle daily material and service requests.', tags: [], icon: 'FileText' },
  { id: '3', title: 'Billing Recon', content: 'Reconcile billing statements and payments.', tags: [], icon: 'CreditCard' },
  { id: '4', title: 'Email Management', content: 'Manage email campaigns and templates.', tags: [], icon: 'Mail' },
  { id: '5', title: 'Bank Balance', content: 'View and manage bank balance information.', tags: [], icon: 'Banknote' },
  { id: '6', title: 'Daily Requisition 2', content: 'This is a new module.', tags: [], icon: 'FileText' },
  { id: '7', title: 'Utility Module', content: 'Contains tools like Text Convert.', tags: [], icon: 'LayoutGrid' },
];

export default function ModuleDashboard() {
  const { modules, updateModuleOrder, isLoading, setModules } = useModules();
  const { user } = useAuth();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  // Set default modules only if no modules exist in storage.
  useEffect(() => {
    if (!isLoading && modules.length === 0) {
      setModules(defaultModules);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, setModules]);

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
