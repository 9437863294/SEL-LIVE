
'use client';

import { useModules } from '@/context/ModuleContext';
import type { Module } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { GripVertical, Trash2, Landmark, FileText, LayoutGrid, Banknote, Edit } from 'lucide-react';
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
import { useState } from 'react';
import { EditModuleDialog } from './EditModuleDialog';


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
  const [isEditOpen, setIsEditOpen] = useState(false);

  return (
    <>
    <Card
      className={cn(
        "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50", 
        isDragging ? 'opacity-30 scale-95 shadow-2xl ring-2 ring-primary' : 'opacity-100 scale-100'
      )}
      {...props}
    >
      <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
        <div className="bg-primary/10 p-2 rounded-lg">
           <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
            <CardTitle className="text-base font-bold">{module.title}</CardTitle>
            <p className="text-sm text-muted-foreground pt-1 line-clamp-2">{module.content}</p>
        </div>
        <div className="flex items-center -mr-2 -mt-2 self-start">
             <div className="cursor-grab p-2 text-muted-foreground touch-none" aria-label="Drag to reorder">
                <GripVertical className="h-5 w-5" />
            </div>
        </div>
      </CardHeader>
      <CardContent className="mt-auto flex justify-end gap-1 p-2 border-t">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsEditOpen(true)}>
            <Edit className="h-4 w-4" />
            <span className="sr-only">Edit</span>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the
                "{module.title}" module.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteModule(module.id)}>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
    <EditModuleDialog isOpen={isEditOpen} onOpenChange={setIsEditOpen} module={module} />
    </>
  );
}
