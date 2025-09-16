
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, Paperclip, Download, Trash2, Loader2, File, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type { DailyRequisitionEntry, Attachment } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ShieldAlert } from 'lucide-react';

export default function ManageDocumentsPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [requisitions, setRequisitions] = useState<DailyRequisitionEntry[]>([]);
  const [selectedRequisition, setSelectedRequisition] = useState<DailyRequisitionEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  
  const canViewPage = can('View', 'Daily Requisition.Entry Sheet');
  const canUpload = can('Edit', 'Daily Requisition.Entry Sheet');

  const fetchRequisitions = useCallback(async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'dailyRequisitions'));
      const entries = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyRequisitionEntry))
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      setRequisitions(entries);
    } catch (error) {
      console.error("Error fetching requisitions:", error);
      toast({ title: "Error", description: "Failed to load requisition entries.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    if (!isAuthLoading) {
      if (canViewPage) {
        fetchRequisitions();
      } else {
        setIsLoading(false);
      }
    }
  }, [isAuthLoading, canViewPage, fetchRequisitions]);

  const handleSelectRequisition = (id: string) => {
    const selected = requisitions.find(r => r.id === id);
    setSelectedRequisition(selected || null);
    setFilesToUpload([]);
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFilesToUpload(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (!selectedRequisition || filesToUpload.length === 0) return;
    setIsUploading(true);

    try {
      const attachmentUrls: Attachment[] = [];
      for (const file of filesToUpload) {
        const storagePath = `daily-requisitions/${selectedRequisition.receptionNo}/${file.name}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);
        attachmentUrls.push({ name: file.name, url: downloadURL });
      }

      const reqRef = doc(db, 'dailyRequisitions', selectedRequisition.id);
      await updateDoc(reqRef, {
        attachments: arrayUnion(...attachmentUrls)
      });
      
      toast({ title: "Success", description: `${filesToUpload.length} file(s) uploaded successfully.` });
      setFilesToUpload([]);
      // Refresh selected requisition data
      handleSelectRequisition(selectedRequisition.id);
      fetchRequisitions();
    } catch (error) {
      console.error("Upload failed:", error);
      toast({ title: "Upload Failed", description: "Could not upload files.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteAttachment = async (attachment: Attachment) => {
    if (!selectedRequisition) return;
    try {
      // Delete from storage
      const storagePath = `daily-requisitions/${selectedRequisition.receptionNo}/${attachment.name}`;
      const storageRef = ref(storage, storagePath);
      await deleteObject(storageRef);

      // Remove from firestore
      const reqRef = doc(db, 'dailyRequisitions', selectedRequisition.id);
      await updateDoc(reqRef, {
        attachments: arrayRemove(attachment)
      });
      
      toast({ title: "Success", description: "Attachment deleted." });
      handleSelectRequisition(selectedRequisition.id); // Refresh
      fetchRequisitions();
    } catch (error) {
        console.error("Error deleting attachment:", error);
        toast({ title: "Error", description: "Failed to delete attachment.", variant: "destructive" });
    }
  };

  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
    );
  }

  if (!canViewPage) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href="/daily-requisition"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                <h1 className="text-2xl font-bold">Manage Documents</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to manage documents.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/daily-requisition">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Manage Documents</h1>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Select Requisition</CardTitle>
          <CardDescription>Choose a reception entry to manage its documents.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select onValueChange={handleSelectRequisition}>
            <SelectTrigger className="w-full md:w-1/2">
              <SelectValue placeholder="Select a Reception No..." />
            </SelectTrigger>
            <SelectContent>
              {requisitions.map(req => (
                <SelectItem key={req.id} value={req.id}>
                  {req.receptionNo} - {req.partyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedRequisition && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <Card>
                <CardHeader>
                    <CardTitle>Existing Documents</CardTitle>
                    <CardDescription>
                        Currently uploaded files for {selectedRequisition.receptionNo}.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {selectedRequisition.attachments && selectedRequisition.attachments.length > 0 ? (
                        <div className="space-y-2">
                            {selectedRequisition.attachments.map((file, index) => (
                                <div key={index} className="flex items-center justify-between p-2 bg-muted rounded-md">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <Paperclip className="h-4 w-4 shrink-0" />
                                        <span className="text-sm font-medium truncate">{file.name}</span>
                                    </div>
                                    <div className="flex items-center shrink-0">
                                        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                            <a href={file.url} target="_blank" rel="noopener noreferrer">
                                                <Download className="h-4 w-4" />
                                            </a>
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteAttachment(file)} disabled={!canUpload}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">No documents found.</p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Upload New Documents</CardTitle>
                    <CardDescription>Select one or more files to upload for this requisition.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <Input type="file" multiple onChange={handleFileChange} disabled={!canUpload || isUploading}/>
                        {filesToUpload.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-sm font-medium">Selected files:</p>
                                <div className="space-y-1">
                                    {filesToUpload.map((file, i) => (
                                        <div key={i} className="flex items-center gap-2 text-sm p-1 bg-muted/50 rounded-md">
                                            <File className="h-4 w-4" />
                                            <span className="flex-1 truncate">{file.name}</span>
                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFilesToUpload(filesToUpload.filter((_, index) => index !== i))}>
                                                <X className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <Button onClick={handleUpload} disabled={isUploading || filesToUpload.length === 0 || !canUpload} className="w-full">
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                            Upload {filesToUpload.length} file(s)
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
      )}
    </div>
  );
}

