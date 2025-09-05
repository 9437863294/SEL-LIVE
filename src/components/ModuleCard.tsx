
'use client';

import { useModules } from '@/context/ModuleContext';
import type { Module } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { GripVertical, Trash2, Landmark, FileText, LayoutGrid, Banknote } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { cn } from '@/lib/utils';

interface ModuleCardProps extends React.HTMLAttributes<HTMLDivElement> {
    module: Module;
    isDragging?: boolean;
}

const iconMap: { [key: string]: React.ElementType } = {
  'Site Fund Requisition': Landmark,
  'Daily Requisition': FileText,
  'Utility Module': LayoutGrid,
  'Bank Balance': Banknote,
  'Daily Requisition 2': FileText,
};


export default function ModuleCard({ module, isDragging, ...props }: ModuleCardProps) {
  const { deleteModule } = useModules();
  const Icon = iconMap[module.title] || FileText;

  return (
    <Card
      className={cn(
        "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50", 
        isDragging ? 'opacity-30 scale-95 shadow-2xl ring-2 ring-primary' : 'opacity-100 scale-100'
      )}
      {...props}
    >
      <CardHeader className="flex-row items-start gap-4 space-y-0 pb-4">
        <div className="bg-primary/10 p-3 rounded-lg">
           <Icon className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1">
            <CardTitle className="text-lg font-bold">{module.title}</CardTitle>
            <p className="text-sm text-muted-foreground pt-1">{module.content}</p>
        </div>
        <div className="flex items-center -mr-2 -mt-2">
             <div className="cursor-grab p-2 text-muted-foreground touch-none" aria-label="Drag to reorder">
                <GripVertical className="h-5 w-5" />
            </div>
        </div>
      </CardHeader>
    </Card>
  );
}
