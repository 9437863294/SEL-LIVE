"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { ref as storageRef, deleteObject } from "firebase/storage";
import { db } from "@/lib/firebase";
import { storage } from "@/lib/firebase-storage";
import type { BoqItem } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_COLLECTION,
  DOCUMENT_LINK_TYPES,
  DOCUMENT_PERMISSION_RESOURCE,
  uploadProjectManagementDocument,
  type DocumentCategory,
  type DocumentLinkType,
  type ProjectManagementDocument,
} from "@/lib/project-management-documents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { BoqItemSelector } from "@/components/billing-recon/BoqItemSelector";
import {
  PM_DIALOG,
  PmDataList,
  PmEmptyState,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import { cn } from "@/lib/utils";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type IndentOption = { id: string; indentNumber: string };

const categoryStyles: Record<DocumentCategory, string> = {
  Drawing: "bg-slate-100 text-slate-700",
  "QC Certificate": "bg-emerald-100 text-emerald-700",
  "Inspection Report": "bg-blue-100 text-blue-700",
  "Dispatch Document": "bg-amber-100 text-amber-700",
  Approval: "bg-violet-100 text-violet-700",
  Other: "bg-muted text-muted-foreground",
};

const formatFileSize = (bytes: number) => {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (value?: { toDate?: () => Date }) => {
  if (!value?.toDate) return "—";
  return value.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const getBoqSlNo = (item: BoqItem) => String(item["BOQ SL No"] ?? item["SL. No."] ?? "");
const getBoqDescription = (item: BoqItem) => String(item["Description"] ?? "");

export default function ProjectDocumentsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", DOCUMENT_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canAdd = can("Add", DOCUMENT_PERMISSION_RESOURCE);
  const canDelete = can("Delete", DOCUMENT_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [documents, setDocuments] = useState<ProjectManagementDocument[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [indents, setIndents] = useState<IndentOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");

  const categoryParam = searchParams?.get("category") ?? "";
  const initialCategory = (DOCUMENT_CATEGORIES as readonly string[]).includes(categoryParam)
    ? (categoryParam as DocumentCategory)
    : "All";
  const [categoryFilter, setCategoryFilter] = useState<DocumentCategory | "All">(initialCategory);
  const [search, setSearch] = useState("");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>("Drawing");
  const [linkType, setLinkType] = useState<DocumentLinkType>("None");
  const [linkedBoqItem, setLinkedBoqItem] = useState<BoqItem | null>(null);
  const [linkedIndentId, setLinkedIndentId] = useState("");
  const [remarks, setRemarks] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) {
        setMapping(null);
        return;
      }
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      setMapping(mappingData);

      const [documentSnapshot, boqSnapshot, indentSnapshot] = await Promise.all([
        getDocs(query(collection(db, DOCUMENT_COLLECTION), where("projectMappingId", "==", mappingId))),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
      ]);

      setDocuments(
        documentSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as ProjectManagementDocument)
          .sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0)),
      );
      setBoqItems(boqSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as BoqItem));
      setIndents(
        indentSnapshot.docs.map((item) => ({
          id: item.id,
          indentNumber: String(item.data().indentNumber ?? item.id),
        })),
      );
    } catch (error) {
      console.error("Failed to load project documents:", error);
      toast({ title: "Unable to load documents", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, toast]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const resetDialog = () => {
    setCategory("Drawing");
    setLinkType("None");
    setLinkedBoqItem(null);
    setLinkedIndentId("");
    setRemarks("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!mapping || !user || !file) {
      toast({ title: "Choose a file to upload", variant: "destructive" });
      return;
    }
    if (linkType === "BOQ Item" && !linkedBoqItem) {
      toast({ title: "Select a BOQ item to link", variant: "destructive" });
      return;
    }
    if (linkType === "Indent" && !linkedIndentId) {
      toast({ title: "Select an indent to link", variant: "destructive" });
      return;
    }

    const linkedId =
      linkType === "BOQ Item" ? (linkedBoqItem?.id ?? "") : linkType === "Indent" ? linkedIndentId : "";
    const linkedLabel =
      linkType === "BOQ Item"
        ? `${getBoqSlNo(linkedBoqItem!)} — ${getBoqDescription(linkedBoqItem!)}`
        : linkType === "Indent"
          ? (indents.find((item) => item.id === linkedIndentId)?.indentNumber ?? "")
          : "";

    setIsUploading(true);
    try {
      await uploadProjectManagementDocument({
        projectMappingId: mapping.id,
        projectManagementProjectName: mapping.projectName,
        globalProjectId: mapping.globalProjectId,
        globalProjectName: mapping.globalProjectName,
        category,
        linkedType: linkType,
        linkedId,
        linkedLabel,
        file,
        remarks,
        uploadedBy: user.id,
        uploadedByName: user.name,
      });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Upload Document",
        details: { project: mapping.projectName, category, fileName: file.name },
      });
      toast({ title: "Document uploaded" });
      setIsDialogOpen(false);
      resetDialog();
      await loadData();
    } catch (error) {
      console.error("Failed to upload document:", error);
      toast({ title: "Unable to upload document", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (documentRecord: ProjectManagementDocument) => {
    setDeletingId(documentRecord.id);
    try {
      try {
        await deleteObject(storageRef(storage, documentRecord.storagePath));
      } catch (storageError) {
        console.warn("Storage object already gone or inaccessible:", storageError);
      }
      await deleteDoc(doc(db, DOCUMENT_COLLECTION, documentRecord.id));
      if (user) {
        void logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          module: "Project Management",
          action: "Delete Document",
          details: { fileName: documentRecord.fileName, category: documentRecord.category },
        });
      }
      toast({ title: "Document deleted" });
      await loadData();
    } catch (error) {
      console.error("Failed to delete document:", error);
      toast({ title: "Unable to delete document", variant: "destructive" });
    } finally {
      setDeletingId("");
    }
  };

  const filteredDocuments = useMemo(() => {
    const term = search.trim().toLowerCase();
    return documents.filter((item) => {
      if (categoryFilter !== "All" && item.category !== categoryFilter) return false;
      if (term && !item.fileName.toLowerCase().includes(term) && !item.linkedLabel?.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [documents, categoryFilter, search]);

  /* The register: a card per file on a phone, the table from `sm`. */
  const columns: PmListColumn<ProjectManagementDocument>[] = [
    {
      header: "File",
      mobile: "title",
      className: "max-w-xs",
      cell: (item) => (
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <a
              href={item.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate font-medium text-indigo-700 hover:underline"
              title={item.fileName}
            >
              {item.fileName}
            </a>
            {item.remarks ? (
              <p className="truncate text-xs text-muted-foreground" title={item.remarks}>
                {item.remarks}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      header: "Category",
      mobile: "aside",
      cell: (item) => (
        <Badge variant="outline" className={categoryStyles[item.category]}>
          {item.category}
        </Badge>
      ),
    },
    {
      header: "Linked To",
      className: "max-w-[200px] truncate",
      cell: (item) => (
        <span title={item.linkedLabel || undefined}>
          {item.linkedType !== "None" ? (
            <span>
              <span className="text-xs text-muted-foreground">{item.linkedType}: </span>
              {item.linkedLabel || "—"}
            </span>
          ) : (
            "—"
          )}
        </span>
      ),
    },
    { header: "Uploaded By", className: "whitespace-nowrap", cell: (item) => item.uploadedByName },
    { header: "Uploaded On", className: "whitespace-nowrap", cell: (item) => formatDate(item.uploadedAt) },
    {
      header: "Size",
      align: "right",
      className: "whitespace-nowrap",
      cell: (item) => formatFileSize(item.fileSize),
    },
    {
      header: "Actions",
      align: "right",
      mobile: "footer",
      className: "w-24",
      cell: (item) => (
        <div className="flex w-full justify-end gap-2 sm:w-auto sm:gap-1">
          {/* Icon-only in the table; labelled on a phone, where the buttons span the card. */}
          <Button variant="ghost" size="icon" className="max-sm:min-h-11 max-sm:flex-1" asChild title="Download">
            <a href={item.fileUrl} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" />
              <span className="ml-2 sm:hidden">Download</span>
            </a>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" disabled={!canDelete} title="Delete">
                <Trash2 className="h-4 w-4 text-destructive" />
                <span className="ml-2 text-destructive sm:hidden">Delete</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &quot;{item.fileName}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. The file will be removed from storage.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deletingId === item.id}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deletingId === item.id}
                  onClick={() => void handleDelete(item)}
                >
                  {deletingId === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ),
    },
  ];

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this module.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!mappingId || !mapping) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>Return to Project Management and choose a project before opening Documents.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="mb-1 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <Link href={`/project-management?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Project Management">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 shadow-sm sm:flex">
            <FolderOpen className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold sm:text-3xl">Documents</h1>
            <p className="mt-0.5 break-words text-sm text-muted-foreground sm:mt-1">
              {documents.length} file{documents.length === 1 ? "" : "s"} for {mapping.projectName}
            </p>
          </div>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetDialog(); }}>
          <DialogTrigger asChild>
            <Button disabled={!canAdd}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Document
            </Button>
          </DialogTrigger>
          <DialogContent className={cn(PM_DIALOG.content, "sm:max-w-xl")}>
            <DialogHeader className={PM_DIALOG.header}>
              <DialogTitle>Upload a Document</DialogTitle>
              <DialogDescription>
                Drawings, QC certificates, inspection reports, and other project files, optionally linked to a
                specific BOQ item or indent.
              </DialogDescription>
            </DialogHeader>
            {/* `content-start`: in the full-height phone sheet a grid would otherwise stretch its
                rows apart to fill the screen. */}
            <div className={cn(PM_DIALOG.body, "grid content-start gap-4 space-y-0 py-4")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={(value: DocumentCategory) => setCategory(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_CATEGORIES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Link to</Label>
                  <Select
                    value={linkType}
                    onValueChange={(value: DocumentLinkType) => {
                      setLinkType(value);
                      setLinkedBoqItem(null);
                      setLinkedIndentId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_LINK_TYPES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {linkType === "BOQ Item" && (
                <div className="space-y-2">
                  <Label>BOQ Item</Label>
                  <BoqItemSelector
                    boqItems={boqItems}
                    selectedSlNo={linkedBoqItem ? getBoqSlNo(linkedBoqItem) : null}
                    onSelect={setLinkedBoqItem}
                    isLoading={false}
                  />
                </div>
              )}

              {linkType === "Indent" && (
                <div className="space-y-2">
                  <Label>Indent</Label>
                  <Select value={linkedIndentId} onValueChange={setLinkedIndentId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an indent..." />
                    </SelectTrigger>
                    <SelectContent>
                      {indents.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.indentNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>File</Label>
                <Input ref={fileInputRef} type="file" />
              </div>

              <div className="space-y-2">
                <Label>Remarks</Label>
                <Textarea
                  placeholder="Optional notes about this document..."
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter className={PM_DIALOG.footer}>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleUpload} disabled={isUploading}>
                {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by file name or link..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={(value: DocumentCategory | "All") => setCategoryFilter(value)}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All categories</SelectItem>
            {DOCUMENT_CATEGORIES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <PmDataList
        rows={filteredDocuments}
        columns={columns}
        empty={
          <PmEmptyState
            icon={FolderOpen}
            title="No documents yet"
            description="Upload drawings, QC certificates, and other project files here."
          />
        }
      />
    </main>
  );
}
