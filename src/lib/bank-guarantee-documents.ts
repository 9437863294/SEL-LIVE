"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { BG_COLLECTIONS, BG_PERMISSION_MODULE } from "@/lib/bank-guarantee";

export type PendingBGDocument = {
  id: string;
  documentType: string;
  file: File;
};

export type BGDocumentUploadInput = {
  organizationId: string;
  requestId?: string;
  bgId?: string;
  documentType: string;
  file: File;
  uploadedBy: string;
  uploadedByName: string;
  referenceNumber?: string;
  remarks?: string;
};

export const normalizeBGDocumentType = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function missingBGDocumentTypes(
  required: string[],
  available: Array<string | { documentType?: string; status?: string }>,
) {
  const active = new Set(
    available
      .filter(
        (item) =>
          typeof item === "string" ||
          !item.status ||
          String(item.status).toUpperCase() === "ACTIVE",
      )
      .map((item) =>
        normalizeBGDocumentType(
          typeof item === "string" ? item : item.documentType || "",
        ),
      ),
  );
  return required.filter(
    (documentType) => !active.has(normalizeBGDocumentType(documentType)),
  );
}

export async function uploadBGDocument(input: BGDocumentUploadInput) {
  if (!input.requestId && !input.bgId)
    throw new Error("A BG request or issued BG is required for upload.");
  if (!input.documentType.trim())
    throw new Error("Select a document type before uploading.");
  const safeName = input.file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const entityId = input.bgId || input.requestId || "unlinked";
  const folder = normalizeBGDocumentType(input.documentType).replaceAll(" ", "-");
  const path = `organizations/${input.organizationId}/bank-guarantees/${entityId}/${folder}/${Date.now()}-${safeName}`;
  const target = storageRef(storage, path);
  await uploadBytes(target, input.file, {
    contentType: input.file.type || "application/octet-stream",
  });
  const fileUrl = await getDownloadURL(target);
  const created = await addDoc(collection(db, BG_COLLECTIONS.documents), {
    organizationId: input.organizationId,
    module: BG_PERMISSION_MODULE,
    requestId: input.requestId || "",
    bgId: input.bgId || "",
    documentType: input.documentType.trim(),
    fileName: input.file.name,
    fileUrl,
    storagePath: path,
    mimeType: input.file.type || "application/octet-stream",
    fileSize: input.file.size,
    version: 1,
    referenceNumber: input.referenceNumber || "",
    remarks: input.remarks || "",
    status: "ACTIVE",
    uploadedBy: input.uploadedBy,
    uploadedByName: input.uploadedByName,
    uploadedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return created.id;
}

export async function uploadPendingBGDocuments(
  documents: PendingBGDocument[],
  input: Omit<BGDocumentUploadInput, "documentType" | "file">,
) {
  for (const document of documents) {
    await uploadBGDocument({
      ...input,
      documentType: document.documentType,
      file: document.file,
    });
  }
}
