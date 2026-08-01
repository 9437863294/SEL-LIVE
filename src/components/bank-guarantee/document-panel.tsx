"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { Archive, FileText, Loader2, Upload } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { BG_COLLECTIONS } from "@/lib/bank-guarantee";
import {
  missingBGDocumentTypes,
  uploadBGDocument,
} from "@/lib/bank-guarantee-documents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DocumentRow = Record<string, any> & { id: string };

export default function BGDocumentPanel({
  requestId,
  bgId,
  documentTypes,
  requiredTypes = [],
  canUpload = true,
  title = "Supporting documents",
  onCompletenessChange,
}: {
  requestId?: string;
  bgId?: string;
  documentTypes: string[];
  requiredTypes?: string[];
  canUpload?: boolean;
  title?: string;
  onCompletenessChange?: (complete: boolean, missing: string[]) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const organizationId = user?.organizationId || "default";
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [documentType, setDocumentType] = useState(
    requiredTypes[0] || documentTypes[0] || "Other supporting document",
  );
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    const key = bgId ? "bgId" : "requestId";
    const value = bgId || requestId;
    if (!value) {
      setRows([]);
      return;
    }
    const snapshot = await getDocs(
      query(collection(db, BG_COLLECTIONS.documents), where(key, "==", value)),
    );
    setRows(
      snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.organizationId === organizationId),
    );
  }, [bgId, organizationId, requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeRows = useMemo(
    () => rows.filter((item) => item.status !== "ARCHIVED"),
    [rows],
  );
  const missing = useMemo(
    () => missingBGDocumentTypes(requiredTypes, activeRows),
    [activeRows, requiredTypes],
  );
  useEffect(() => {
    onCompletenessChange?.(missing.length === 0, missing);
  }, [missing, onCompletenessChange]);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !user || (!requestId && !bgId)) return;
    setWorking(true);
    try {
      for (const file of Array.from(files)) {
        await uploadBGDocument({
          organizationId,
          requestId,
          bgId,
          documentType,
          file,
          uploadedBy: user.id,
          uploadedByName: user.name,
        });
      }
      toast({ title: `${files.length} BG document(s) uploaded` });
      if (inputRef.current) inputRef.current.value = "";
      await load();
    } catch (error) {
      toast({
        title: "Document upload failed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  const archive = async (row: DocumentRow) => {
    if (!user) return;
    await updateDoc(doc(db, BG_COLLECTIONS.documents, row.id), {
      status: "ARCHIVED",
      archivedBy: user.id,
      archivedByName: user.name,
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await load();
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">
            Files are versioned and stored in the organization-scoped BG folder.
          </p>
        </div>
        <Badge variant={missing.length ? "destructive" : "secondary"}>
          {missing.length ? `${missing.length} required missing` : "Complete"}
        </Badge>
      </div>

      {requiredTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {requiredTypes.map((item) => (
            <Badge
              key={item}
              variant={missing.includes(item) ? "outline" : "secondary"}
            >
              {missing.includes(item) ? "Missing: " : "Ready: "}
              {item}
            </Badge>
          ))}
        </div>
      )}

      {canUpload && (
        <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_minmax(260px,2fr)]">
          <div className="space-y-1.5">
            <Label>Document type</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([...requiredTypes, ...documentTypes])).map(
                  (item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Choose file(s)</Label>
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                type="file"
                multiple
                disabled={working}
                onChange={(event) => void upload(event.target.files)}
              />
              <Button variant="outline" size="icon" disabled={working}>
                {working ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="divide-y rounded-md border">
        {activeRows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No documents uploaded yet.
          </p>
        ) : (
          activeRows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-indigo-600" />
                <div className="min-w-0">
                  <a
                    className="block truncate text-sm font-medium text-indigo-700 hover:underline"
                    href={String(row.fileUrl || "#")}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {String(row.fileName || "Document")}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {String(row.documentType || "Other")} · v{Number(row.version || 1)}
                  </p>
                </div>
              </div>
              {canUpload && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void archive(row)}
                >
                  <Archive className="mr-2 h-4 w-4" /> Archive
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
