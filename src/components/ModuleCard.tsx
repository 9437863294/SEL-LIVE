'use client';

import { useModules } from '@/context/ModuleContext';
import type { Module } from '@/lib/types';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { GripVertical, Trash2 } from 'lucide-react';
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

export default function ModuleCard({ module, isDragging, ...props }: ModuleCardProps) {
  const { deleteModule } = useModules();

  return (
    <Card
      className={cn(
        "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg", 
        isDragging ? 'opacity-30 scale-95 shadow-2xl ring-2 ring-primary' : 'opacity-100 scale-100'
      )}
      {...props}
    >
      <CardHeader className="flex flex-row items-start justify-between pb-4">
        <CardTitle className="text-lg font-semibold flex-1 pr-4">{module.title}</CardTitle>
        <div className="flex items-center -mr-2 -mt-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                  <span className="sr-only">Delete module</span>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the module "{module.title}".
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteModule(module.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <div className="cursor-grab p-2 text-muted-foreground touch-none" aria-label="Drag to reorder">
                <GripVertical className="h-5 w-5" />
            </div>
        </div>
      </CardHeader>
      <CardContent className="flex-grow pb-4">
        <p className="text-sm text-muted-foreground line-clamp-3">{module.content}</p>
      </CardContent>
      <CardFooter>
        <div className="flex flex-wrap gap-1">
          {module.tags.length > 0 ? module.tags.map((tag) => (
            <Badge key={tag} variant="secondary">{tag}</Badge>
          )) : <p className="text-xs text-muted-foreground italic">No tags</p>}
        </div>
      </CardFooter>
    </Card>
  );
}
