
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc, collection, query, getDocs } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import type { JmcEntry, JmcItem, ActionConfig, Project } from '@/lib/types';
import { Loader2, Upload, File as FileIcon, X, Maximize, Minimize } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from './ui/progress';

interface UpdateCertifiedQtyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  projectSlug: string;
  onSaveSuccess: () => void;
  onAction?: (taskId: string, action: string | ActionConfig, comment: string, updatedItems: JmcItem[]) => Promise<void>;
}

type EditableItem = JmcItem & { __certStr?: string; __error?: string | null };

type CertifiedAttachment = {
  name: string;
  url: string;
  size: number;
  contentType?: string | null;
  uploadedAt: string;
};

const CONCURRENCY = 3;

export function UpdateCertifiedQtyDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  projectSlug,
  onSaveSuccess,
  onAction,
}: UpdateCertifiedQtyDialogProps) {
  const { toast } = useToast();

  const [items, setItems] = useState<EditableItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploaded, setUploaded] = useState<CertifiedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dialogSize, setDialogSize] = useState<'xl' | '2xl' | 'full'>('xl');


  // ---------- project context from slug ----------
  useEffect(() => {
    const fetchProject = async () => {
      if (!projectSlug) return;
      const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
      const slugify = (text: string) =>
        text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Project))
        .find(p => slugify(p.projectName) === projectSlug);

      if (projectData) {
        setCurrentProject(projectData);
      } else {
        toast({ title: 'Error', description: 'Project context not found.', variant: 'destructive' });
      }
    };
    fetchProject();
  }, [projectSlug, toast]);

  // ---------- dialog open: seed items + attachments ----------
  useEffect(() => {
    if (isOpen && jmcEntry) {
      const cloned: EditableItem[] = JSON.parse(JSON.stringify(jmcEntry.items || []));
      cloned.forEach((it) => {
        it.__certStr = it.certifiedQty ?? it.certifiedQty === 0 ? String(it.certifiedQty) : '';
        it.__error = null;
      });
      setItems(cloned);
      setUploaded((jmcEntry as any).certifiedAttachments || []);
      setSelectedFiles([]);
      setUploadProgress({});
      setIsDragging(false);
    }
  }, [isOpen, jmcEntry]);

  const hasErrors = useMemo(() => items.some((it) => it.__error), [items]);

  // ---------- table editing ----------
  const handleCertifiedQtyChange = (index: number, raw: string) => {
    setItems((prev) => {
      const next = [...prev];
      const row = { ...next[index] };

      row.__certStr = raw;

      const parsed = raw.trim() === '' ? NaN : Number(raw);
      const executedQty = Number(row.executedQty) || 0;

      if (raw.trim() === '') {
        row.__error = null;
        row.certifiedQty = 0; // empty -> treat as 0
      } else if (Number.isNaN(parsed)) {
        row.__error = 'Enter a valid number';
      } else if (parsed < 0) {
        row.__error = 'Certified quantity cannot be negative';
        row.certifiedQty = 0;
      } else if (parsed > executedQty) {
        row.__error = `Cannot exceed executed qty (${executedQty})`;
        row.certifiedQty = executedQty;
        row.__certStr = String(executedQty);
      } else {
        row.__error = null;
        row.certifiedQty = parsed;
      }

      next[index] = row;
      return next;
    });
  };

  // ---------- attachments ----------
  const onPickFiles: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setSelectedFiles((prev) => {
      const merged = [...prev, ...files];
      const seen = new Set<string>();
      return merged.filter((f) => (!seen.has(f.name) && seen.add(f.name), true));
    });
  };

  const removeFile = (name: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.name !== name));
    setUploadProgress((prev) => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  };

  const onDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const onDragLeave: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    setSelectedFiles((prev) => {
      const merged = [...prev, ...files];
      const seen = new Set<string>();
      return merged.filter((f) => (!seen.has(f.name) && seen.add(f.name), true));
    });
  };

  async function uploadAllSelectedConcurrent(): Promise<CertifiedAttachment[]> {
    if (!jmcEntry || !currentProject || selectedFiles.length === 0) return [];
    setIsUploading(true);

    const queue = [...selectedFiles];
    const results: CertifiedAttachment[] = [];

    const runOne = () =>
      new Promise<void>((resolve, reject) => {
        if (queue.length === 0) return resolve();
        const file = queue.shift()!;
        const path = `projects/${currentProject.id}/jmcEntries/${jmcEntry.id}/attachments/${Date.now()}-${file.name}`;
        const ref = storageRef(storage, path);
        const task = uploadBytesResumable(ref, file);

        task.on(
          'state_changed',
          (snap) => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            setUploadProgress((prev) => ({ ...prev, [file.name]: pct }));
          },
          (err) => reject(err),
          async () => {
            try {
              const url = await getDownloadURL(task.snapshot.ref);
              results.push({
                name: file.name,
                url,
                size: file.size,
                contentType: file.type || null,
                uploadedAt: new Date().toISOString(),
              });
              resolve();
            } catch (e) {
              reject(e);
            }
          }
        );
      });

    try {
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, queue.length || CONCURRENCY) },
        async () => {
          while (queue.length > 0) await runOne();
        }
      );
      await Promise.all(workers);
      setUploaded((prev) => [...prev, ...results]);
      setSelectedFiles([]);
      setUploadProgress({});
      return results;
    } finally {
      setIsUploading(false);
    }
  }

  // ---------- save ----------
  const handleSave = async () => {
    if (!jmcEntry || !currentProject) return;

    if (hasErrors) {
      toast({
        title: 'Fix validation errors',
        description: 'Please correct the highlighted certified quantities.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    let newAttachments: CertifiedAttachment[] = [];
    try {
      if (selectedFiles.length > 0) {
        newAttachments = await uploadAllSelectedConcurrent();
      }
    } catch (e) {
      console.error('Attachment upload failed:', e);
      toast({ title: 'Upload failed', description: 'One or more files could not be uploaded.', variant: 'destructive' });
      setIsSaving(false);
      return;
    }

    const payloadItems: JmcItem[] = items.map(({ __certStr, __error, ...rest }) => ({
      ...rest,
      certifiedQty:
        rest.certifiedQty === undefined || rest.certifiedQty === null ? 0 : Number(rest.certifiedQty),
    }));

    try {
      const jmcRef = doc(db, 'projects', currentProject.id, 'jmcEntries', jmcEntry.id);
      const mergedAttachments = [...uploaded, ...newAttachments];

      if (onAction) {
        await onAction(jmcEntry.id, 'Verified', 'Verified with edits', payloadItems);
        await updateDoc(jmcRef, { certifiedAttachments: mergedAttachments });
      } else {
        await updateDoc(jmcRef, { items: payloadItems, certifiedAttachments: mergedAttachments });
      }

      toast({ title: 'Success', description: 'Certified quantities and attachments updated.' });
      onOpenChange(false);
      onSaveSuccess();
    } catch (error) {
      console.error('Error updating certified quantities/attachments:', error);
      toast({ title: 'Error', description: 'Failed to update the JMC entry.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const canClose = useCallback(() => !isSaving && !isUploading, [isSaving, isUploading]);
  
  const toggleDialogSize = () => {
    setDialogSize(current => {
      if (current === 'xl') return '2xl';
      if (current === '2xl') return 'full';
      return 'xl';
    });
  };

  const dialogSizeClass =
    dialogSize === 'full' ? 'sm:max-w-[95vw]' :
    dialogSize === '2xl' ? 'sm:max-w-6xl' :
    'sm:max-w-3xl';

  return (
    <Dialog open={isOpen} onOpenChange={(o) => (canClose() ? onOpenChange(o) : undefined)}>
      <DialogContent className={cn("max-h-[90vh] flex flex-col min-h-0", dialogSizeClass)}>
        <DialogHeader>
          <DialogTitle>Update Certified Quantities</DialogTitle>
          <DialogDescription>JMC No: {jmcEntry?.jmcNo}</DialogDescription>
        </DialogHeader>

        {/* Native scroller so sticky header works */}
        <div className="flex-1 min-h-0 overflow-y-auto border rounded-md">
          <div className="overflow-x-auto">
            <Table className="w-full">
              {/* sticky header */}
              <TableHeader className="sticky top-0 z-20 bg-background shadow-sm">
                <TableRow>
                  <TableHead className="sticky top-0 z-20 bg-background text-center">BOQ Sl. No.</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-background">Description</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-background text-right whitespace-nowrap">
                    Executed Qty
                  </TableHead>
                  <TableHead className="sticky top-0 z-20 bg-background whitespace-nowrap">
                    Certified Qty
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={`${item.boqSlNo}-${idx}`}>
                    <TableCell className="text-center font-medium" title={String(item.boqSlNo ?? '')}>
                      {item.boqSlNo ?? '-'}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="line-clamp-3 break-words whitespace-pre-line" title={item.description ?? ''}>
                        {item.description}
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top whitespace-nowrap">
                      {item.executedQty}
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        className="w-full"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min={0}
                        max={Number(item.executedQty) || undefined}
                        value={item.__certStr ?? ''}
                        onChange={(e) => handleCertifiedQtyChange(idx, e.target.value)}
                        aria-invalid={!!item.__error}
                        aria-describedby={item.__error ? `cert-error-${idx}` : undefined}
                      />
                      {item.__error && (
                        <p id={`cert-error-${idx}`} className="text-xs text-destructive mt-1">
                          {item.__error}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Attachments */}
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium">Attachments (optional)</h4>
          <p className="text-xs text-muted-foreground">
            Upload multiple supporting documents (PDFs, images, spreadsheets). They’ll be saved to this JMC.
          </p>

          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              'border rounded-md p-4 text-sm transition-colors',
              isDragging ? 'border-primary bg-primary/5' : 'border-dashed'
            )}
          >
            Drag & drop files here, or choose:
            <div className="mt-2">
              <Input
                type="file"
                multiple
                onChange={onPickFiles}
                disabled={isSaving || isUploading}
                aria-label="Upload attachments"
              />
            </div>
          </div>

          {(selectedFiles.length > 0 || uploaded.length > 0) && (
            <div className="border rounded-md p-3 max-h-48 overflow-y-auto">
              {uploaded.length > 0 && (
                <div className="space-y-1 mb-2">
                  <p className="text-xs font-medium">Already Uploaded:</p>
                  <ul className="space-y-1">
                    {uploaded.map((f) => (
                      <li key={f.url} className="text-xs flex items-center justify-between">
                        <a className="underline truncate" href={f.url} target="_blank" rel="noreferrer">
                          {f.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedFiles.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">To Upload:</p>
                  <ul className="space-y-2">
                    {selectedFiles.map((f) => (
                      <li key={f.name} className="text-sm">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="truncate">{f.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {(f.size / 1024).toFixed(1)} KB
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(f.name)}
                            disabled={isUploading || isSaving}
                          >
                            Remove
                          </Button>
                        </div>
                        {uploadProgress[f.name] != null && (
                          <Progress value={uploadProgress[f.name]} className="h-1 mt-1" />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between w-full">
          <Button variant="outline" size="icon" onClick={toggleDialogSize}>
            {dialogSize === 'full' ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" disabled={isSaving || isUploading}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={handleSave} disabled={isSaving || hasErrors || isUploading}>
              {(isSaving || isUploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {onAction ? 'Upload & Verify' : 'Upload & Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
