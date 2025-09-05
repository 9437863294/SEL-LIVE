'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useModules } from '@/context/ModuleContext';
import ModuleCard from './ModuleCard';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

export default function ModuleDashboard() {
  const { modules, updateModuleOrder, isLoading } = useModules();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

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

    const draggedIndex = modules.findIndex((m) => m.id === draggedItemId);
    const targetIndex = modules.findIndex((m) => m.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newModules = [...modules];
    const [draggedItem] = newModules.splice(draggedIndex, 1);
    newModules.splice(targetIndex, 0, draggedItem);
    updateModuleOrder(newModules);
  }, [draggedItemId, modules, updateModuleOrder]);
  
  const handleDragEnd = useCallback(() => {
    setDraggedItemId(null);
  }, []);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-lg" />
        ))}
      </div>
    );
  }

  if (modules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 py-20 text-center">
        <h2 className="text-2xl font-semibold mb-2">Your Module Hub is Empty</h2>
        <p className="text-muted-foreground mb-4">Get started by creating your first module.</p>
        <Button asChild>
          <Link href="/create">Create New Module</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" onDragOver={handleDragOver}>
      {modules.map((module) => (
        <ModuleCard
          key={module.id}
          module={module}
          draggable
          onDragStart={(e) => handleDragStart(e, module.id)}
          onDrop={(e) => handleDrop(e, module.id)}
          onDragEnd={handleDragEnd}
          isDragging={draggedItemId === module.id}
        />
      ))}
    </div>
  );
}
