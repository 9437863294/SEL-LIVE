
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Module } from '@/lib/types';
import { useModules } from '@/context/ModuleContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const formSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters long.'),
  content: z.string().min(10, 'Content must be at least 10 characters long.'),
  icon: z.string().min(1, 'Icon name is required.'),
});

interface EditModuleDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  module: Module;
}

export function EditModuleDialog({ isOpen, onOpenChange, module }: EditModuleDialogProps) {
  const { updateModule } = useModules();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      content: '',
      icon: '',
    },
  });
  
  useEffect(() => {
    if (module) {
        form.reset({
            title: module.title,
            content: module.content,
            icon: module.icon,
        });
    }
  }, [module, form, isOpen]);


  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateModule(module.id, { ...module, ...values });
    toast({
      title: 'Module Updated!',
      description: `"${values.title}" has been successfully updated.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Module</DialogTitle>
          <DialogDescription>
            Make changes to your module here. Click save when you're done.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                 <FormField control={form.control} name="title" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="content" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Content</FormLabel>
                      <FormControl><Textarea {...field} rows={5} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="icon" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Icon</FormLabel>
                      <FormControl><Input {...field} placeholder="e.g., Landmark" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button type="submit">Save Changes</Button>
                </DialogFooter>
            </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
