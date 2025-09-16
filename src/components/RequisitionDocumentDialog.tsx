
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type { DailyRequisitionEntry, Attachment } from '@/lib/types';
import { Loader2, Upload, Paperclip, Download, Trash2, File as FileIcon, X, Eye } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';

interface RequisitionDocumentDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  requisition: DailyRequisitionEntry | null;
  onUploadComplete: () => void;
  canEdit: boolean;
}

export function RequisitionDocumentDialog({ isOpen, onOpenChange, requisition, onUploadComplete, canEdit }: RequisitionDocumentDialogProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [currentAttachments, setCurrentAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    if (requisition) {
      setCurrentAttachments(requisition.attachments || []);
    }
  }, [requisition]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFilesToUpload(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (!requisition || filesToUpload.length === 0) return;
    setIsUploading(true);

    try {
      const attachmentUrls: Attachment[] = [];
      for (const file of filesToUpload) {
        const storagePath = `daily-requisitions/${requisition.receptionNo}/${file.name}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);
        attachmentUrls.push({ name: file.name, url: downloadURL });
      }

      const reqRef = doc(db, 'dailyRequisitions', requisition.id);
      await updateDoc(reqRef, {
        attachments: arrayUnion(...attachmentUrls),
        documentStatus: 'Uploaded',
        documentStatusUpdatedAt: new Date(),
      });
      
      toast({ title: "Success", description: `${filesToUpload.length} file(s) uploaded successfully.` });
      setFilesToUpload([]);
      setCurrentAttachments(prev => [...prev, ...attachmentUrls]);
    } catch (error) {
      console.error("Upload failed:", error);
      toast({ title: "Upload Failed", description: "Could not upload files.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteAttachment = async (attachmentToDelete: Attachment) => {
    if (!requisition) return;
    
    // Optimistically update UI
    const previousAttachments = [...currentAttachments];
    setCurrentAttachments(prev => prev.filter(att => att.url !== attachmentToDelete.url));

    try {
      const storagePath = `daily-requisitions/${requisition.receptionNo}/${attachmentToDelete.name}`;
      const storageRef = ref(storage, storagePath);
      await deleteObject(storageRef);

      const reqRef = doc(db, 'dailyRequisitions', requisition.id);
      const newAttachments = currentAttachments.filter(att => att.url !== attachmentToDelete.url);
      
      await updateDoc(reqRef, {
        attachments: arrayRemove(attachmentToDelete),
        documentStatus: newAttachments.length > 0 ? 'Uploaded' : 'Pending',
        documentStatusUpdatedAt: new Date(),
      });
      
      toast({ title: "Success", description: "Attachment deleted." });
    } catch (error) {
        console.error("Error deleting attachment:", error);
        // Revert optimistic UI update on failure
        setCurrentAttachments(previousAttachments);
        toast({ title: "Error", description: "Failed to delete attachment.", variant: "destructive" });
    }
  };
  
  const handleClose = () => {
    onUploadComplete(); // Refresh the main list when closing
    onOpenChange(false);
    setFilesToUpload([]);
  };

  if (!requisition) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Documents for {requisition.receptionNo}</DialogTitle>
          <DialogDescription>
            Upload, view, or delete documents related to this requisition entry.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6">
            <div>
                <h3 className="text-sm font-medium mb-2">Existing Documents</h3>
                <ScrollArea className="h-48 border rounded-md p-2">
                    {currentAttachments.length > 0 ? (
                        <div className="space-y-2">
                            {currentAttachments.map((file, index) => (
                                <div key={index} className="flex items-center justify-between p-2 bg-muted rounded-md">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <Paperclip className="h-4 w-4 shrink-0" />
                                        <span className="text-sm font-medium truncate">{file.name}</span>
                                    </div>
                                    <div className="flex items-center shrink-0">
                                        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                            <a href={file.url} target="_blank" rel="noopener noreferrer">
                                                <Eye className="h-4 w-4" />
                                            </a>
                                        </Button>
                                         <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                            <a href={file.url} download={file.name}>
                                                <Download className="h-4 w-4" />
                                            </a>
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteAttachment(file)} disabled={!canEdit}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">No documents found.</p>
                    )}
                </ScrollArea>
            </div>
            {canEdit && (
                <div>
                     <h3 className="text-sm font-medium mb-2">Upload New Documents</h3>
                    <div className="space-y-4">
                        <Input type="file" multiple onChange={handleFileChange} disabled={isUploading}/>
                        {filesToUpload.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-sm font-medium">Selected files:</p>
                                <div className="space-y-1">
                                    {filesToUpload.map((file, i) => (
                                        <div key={i} className="flex items-center gap-2 text-sm p-1 bg-muted/50 rounded-md">
                                            <FileIcon className="h-4 w-4" />
                                            <span className="flex-1 truncate">{file.name}</span>
                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFilesToUpload(filesToUpload.filter((_, index) => index !== i))}>
                                                <X className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <Button onClick={handleUpload} disabled={isUploading || filesToUpload.length === 0} className="w-full">
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                            Upload {filesToUpload.length} file(s)
                        </Button>
                    </div>
                </div>
            )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
