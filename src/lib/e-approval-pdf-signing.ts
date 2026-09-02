/**
 * Burning a saved signature image into an uploaded PDF attachment.
 *
 * Split in two on purpose. `computeEApprovalSignaturePlacement` is pure geometry — no PDF, no
 * Firestore, no Storage — so where the mark lands for a given page size, position and size is a
 * one-line assertion in a test, not something only checkable by opening a generated PDF by eye.
 * Everything below it is the actual PDF manipulation, done client-side with `pdf-lib` (no server
 * round trip needed: the original PDF is already reachable from the browser via its Storage download
 * URL, and the signed copy never needs to touch a server either).
 *
 * `pdf-lib` is dynamically imported — it is a sizeable, browser-oriented binary-manipulation library
 * with no reason to sit in every page's server bundle, the same reasoning `uploadEApprovalAttachment`
 * already applies to `firebase/storage`.
 *
 * This is a visual mark, not a cryptographic signature: it proves who placed it and when in exactly
 * the sense a pen signature does — by the record, not by mathematics. See docs/e-approval.md for the
 * distinction and what would be involved in the other kind.
 */

/** The nine anchors a mark can be placed at, read as `vertical-horizontal`. */
export const E_APPROVAL_SIGNATURE_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type EApprovalSignaturePosition = (typeof E_APPROVAL_SIGNATURE_POSITIONS)[number];

export interface EApprovalSignaturePlacementInput {
  /** Page dimensions in PDF points (1/72 inch) — what `pdf-lib`'s `page.getSize()` returns. */
  pageWidth: number;
  pageHeight: number;
  /** Natural pixel size of the signature image, so it is placed at its own aspect ratio. */
  imageWidth: number;
  imageHeight: number;
  position: EApprovalSignaturePosition;
  /** Signature width as a percentage of the page width — 22 means "22% of the page wide". */
  widthPct: number;
  /** Fine adjustment in points, applied after the anchor is resolved. Positive x is right, positive y is up. */
  offsetX?: number;
  offsetY?: number;
  /** Distance kept from the page edge for the chosen anchor, in points. */
  margin?: number;
}

export interface EApprovalSignaturePlacement {
  /** Bottom-left origin, points — `pdf-lib`'s coordinate space. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * Where a signature of the given size lands on a page, for one of the nine anchors plus a fine
 * offset. Clamped fully on-page at the end, so a generous offset cannot push the mark off the sheet
 * — the worst a bad offset can do is push the mark up against the opposite edge.
 */
export function computeEApprovalSignaturePlacement(
  input: EApprovalSignaturePlacementInput,
): EApprovalSignaturePlacement {
  const margin = input.margin ?? 24;
  const width = Math.max(1, input.pageWidth * (input.widthPct / 100));
  const aspect = input.imageWidth > 0 ? input.imageHeight / input.imageWidth : 0.4;
  const height = width * aspect;

  const [vertical, horizontal] = input.position.split('-') as ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'];

  let x: number;
  if (horizontal === 'left') x = margin;
  else if (horizontal === 'right') x = input.pageWidth - margin - width;
  else x = (input.pageWidth - width) / 2;

  let y: number;
  if (vertical === 'bottom') y = margin;
  else if (vertical === 'top') y = input.pageHeight - margin - height;
  else y = (input.pageHeight - height) / 2;

  x += input.offsetX ?? 0;
  y += input.offsetY ?? 0;

  return {
    x: clamp(x, 0, Math.max(0, input.pageWidth - width)),
    y: clamp(y, 0, Math.max(0, input.pageHeight - height)),
    width,
    height,
  };
}

/** How many pages a PDF has, for the page picker — the first thing the dialog needs. */
export async function getEApprovalPdfPageCount(pdfBytes: ArrayBuffer | Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  return pdfDoc.getPageCount();
}

export interface EApprovalSignatureStampOptions {
  pageIndex: number;
  position: EApprovalSignaturePosition;
  widthPct: number;
  offsetX?: number;
  offsetY?: number;
}

/**
 * Loads the PDF, embeds the signature PNG onto the chosen page at the computed placement, and
 * returns the new file's bytes. The caller uploads those as a *new* attachment — this function never
 * touches Storage or Firestore, so it stays testable by anyone with `pdf-lib` and no Firebase project.
 */
export async function embedEApprovalSignatureIntoPdf(
  pdfBytes: ArrayBuffer | Uint8Array,
  signaturePngBytes: ArrayBuffer | Uint8Array,
  options: EApprovalSignatureStampOptions,
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const page = pages[options.pageIndex];
  if (!page) {
    throw new Error(
      pages.length === 1
        ? 'This document has only 1 page.'
        : `This document has ${pages.length} pages; page ${options.pageIndex + 1} does not exist.`,
    );
  }

  const signature = await pdfDoc.embedPng(signaturePngBytes);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const placement = computeEApprovalSignaturePlacement({
    pageWidth,
    pageHeight,
    imageWidth: signature.width,
    imageHeight: signature.height,
    position: options.position,
    widthPct: options.widthPct,
    offsetX: options.offsetX,
    offsetY: options.offsetY,
  });
  page.drawImage(signature, placement);

  return pdfDoc.save();
}
