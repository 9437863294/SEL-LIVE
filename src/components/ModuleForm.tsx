
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useModules } from '@/context/ModuleContext';
import { suggestModuleTags, validateModuleContent, ValidateModuleContentOutput } from '@/ai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Wand2, ShieldCheck, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const formSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters long.'),
  content: z.string().min(10, 'Content must be at least 10 characters long.'),
  icon: z.string().min(1, 'Icon name is required.'),
  tags: z.array(z.string()).default([]),
});

export default function ModuleForm() {
  const router = useRouter();
  const { toast } = useToast();
  const { modules, addModule } = useModules();
  
  const [isSuggestingTags, setIsSuggestingTags] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidateModuleContentOutput | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', content: '', icon: 'FileText', tags: [] },
  });
  
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "tags"
  });

  const handleSuggestTags = useCallback(async () => {
    const { title, content } = form.getValues();
    if (!title || !content) {
      toast({
        title: 'Title and content needed',
        description: 'Please fill in the title and content before suggesting tags.',
        variant: 'destructive',
      });
      return;
    }
    setIsSuggestingTags(true);
    setSuggestedTags([]);
    try {
      const result = await suggestModuleTags({ title, content });
      setSuggestedTags(result.tags);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to suggest tags.', variant: 'destructive' });
    } finally {
      setIsSuggestingTags(false);
    }
  }, [form, toast]);

  const handleValidateContent = useCallback(async () => {
    const { title: newModuleTitle, content: newModuleContent } = form.getValues();
    if (!newModuleTitle || !newModuleContent) {
      toast({
        title: 'Title and content needed',
        description: 'Please fill in the title and content before validating.',
        variant: 'destructive',
      });
      return;
    }
    setIsValidating(true);
    setValidationResult(null);
    try {
      const existingModules = modules.map(m => ({ title: m.title, content: m.content }));
      const result = await validateModuleContent({ newModuleTitle, newModuleContent, existingModules });
      setValidationResult(result);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to validate content.', variant: 'destructive' });
    } finally {
      setIsValidating(false);
    }
  }, [form, modules, toast]);

  const toggleTag = useCallback((tag: string) => {
    const currentTags = form.getValues('tags');
    const tagIndex = currentTags.indexOf(tag);
    if (tagIndex > -1) {
      remove(tagIndex);
    } else {
      append(tag);
    }
  }, [form, append, remove]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    addModule(values);
    toast({
      title: 'Module Created!',
      description: `"${values.title}" has been added to your hub.`,
    });
    router.push('/');
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Module Details</CardTitle>
                <CardDescription>Provide the core information for your module.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="title" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl><Input placeholder="e.g., Introduction to Photosynthesis" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="content" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Content</FormLabel>
                      <FormControl><Textarea placeholder="Start writing your module content here..." {...field} rows={10} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField control={form.control} name="icon" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Icon Name</FormLabel>
                      <FormControl><Input placeholder="e.g., Landmark" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                  <CardTitle>Topic Tags</CardTitle>
                  <CardDescription>Categorize your module with tags. Add your own or use AI to suggest some.</CardDescription>
              </CardHeader>
              <CardContent>
                  <div className="flex flex-wrap gap-2 mb-4 min-h-[24px]">
                      {fields.map((field, index) => (
                          <Badge key={field.id} variant="secondary" className="flex items-center gap-1">
                              {field.value}
                              <button type="button" onClick={() => remove(index)} className="rounded-full outline-none ring-offset-background focus:ring-1 focus:ring-ring">
                                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground"/>
                              </button>
                          </Badge>
                      ))}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleSuggestTags} disabled={isSuggestingTags}>
                      {isSuggestingTags ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                      Suggest Tags with AI
                  </Button>
                  {suggestedTags.length > 0 && (
                      <div className="mt-4 space-y-2">
                          <p className="text-sm font-medium text-muted-foreground">AI Suggestions (click to add):</p>
                          <div className="flex flex-wrap gap-2">
                              {suggestedTags.map(tag => (
                                <Badge key={tag} variant={fields.some(f => f.value === tag) ? 'default' : 'outline'} className="cursor-pointer" onClick={() => toggleTag(tag)}>
                                    {tag}
                                </Badge>
                              ))}
                          </div>
                      </div>
                  )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 lg:sticky lg:top-24">
            <Card>
              <CardHeader>
                <CardTitle>AI Validation</CardTitle>
                <CardDescription>Check for consistency with existing modules.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" variant="secondary" className="w-full" onClick={handleValidateContent} disabled={isValidating}>
                    {isValidating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                    Validate Content
                </Button>
                {validationResult && (
                    <Alert variant={validationResult.isValid ? 'default' : 'destructive'} className="mt-4">
                        <ShieldCheck className="h-4 w-4" />
                        <AlertTitle>{validationResult.isValid ? 'Validation Passed' : 'Validation Concerns'}</AlertTitle>
                        <AlertDescription>{validationResult.feedback}</AlertDescription>
                    </Alert>
                )}
              </CardContent>
            </Card>
            
            <Button type="submit" size="lg" className="w-full">Create Module</Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
