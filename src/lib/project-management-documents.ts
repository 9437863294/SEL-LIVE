"use client";

import type { Timestamp } from "firebase/firestore";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

/**
 * The document vault — the blueprint's D3 principle ("documents are first-class objects, not
 * loose attachments"). A single flat collection rather than nesting under BOQ items/indents/etc.
 * so one query can build a per-project vault view; `linkedType`/`linkedId`/`linkedLabel` are what
 * tie a file back to a specific BOQ item or indent when the uploader chooses to link it.
 */
export const DOCUMENT_COLLECTION = "projectManagementDocuments";
export const DOCUMENT_PERMISSION_RESOURCE = "Project Management.Documents";

export const DOCUMENT_CATEGORIES = [
  "Drawing",
  "QC Certificate",
  "Inspection Report",
  "Dispatch Document",
  "Approval",
  "Other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_LINK_TYPES = ["None", "BOQ Item", "Indent"] as const;

export type DocumentLinkType = (typeof DOCUMENT_LINK_TYPES)[number];

export interface ProjectManagementDocument {
  id: string;
  projectMappingId: string;
  projectManagementProjectName: string;
  globalProjectId: string;
  globalProjectName: string;
  category: DocumentCategory;
  linkedType: DocumentLinkType;
  linkedId: string;
  linkedLabel: string;
  fileName: string;
  fileUrl: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  remarks?: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt?: Timestamp;
}

export type DocumentUploadInput = {
  projectMappingId: string;
  projectManagementProjectName: string;
  globalProjectId: string;
  globalProjectName: string;
  category: DocumentCategory;
  linkedType: DocumentLinkType;
  linkedId: string;
  linkedLabel: string;
  file: File;
  remarks: string;
  uploadedBy: string;
  uploadedByName: string;
};

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export async function uploadProjectManagementDocument(input: DocumentUploadInput) {
  const safeName = input.file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `project-management/documents/${input.globalProjectId}/${slugify(input.category)}/${Date.now()}-${safeName}`;
  const target = storageRef(storage, path);
  await uploadBytes(target, input.file, { contentType: input.file.type || "application/octet-stream" });
  const fileUrl = await getDownloadURL(target);

  const created = await addDoc(collection(db, DOCUMENT_COLLECTION), {
    projectMappingId: input.projectMappingId,
    projectManagementProjectName: input.projectManagementProjectName,
    globalProjectId: input.globalProjectId,
    globalProjectName: input.globalProjectName,
    category: input.category,
    linkedType: input.linkedType,
    linkedId: input.linkedId,
    linkedLabel: input.linkedLabel,
    fileName: input.file.name,
    fileUrl,
    storagePath: path,
    mimeType: input.file.type || "application/octet-stream",
    fileSize: input.file.size,
    remarks: input.remarks.trim(),
    uploadedBy: input.uploadedBy,
    uploadedByName: input.uploadedByName,
    uploadedAt: serverTimestamp(),
  });
  return { id: created.id, fileUrl, fileName: input.file.name };
}
