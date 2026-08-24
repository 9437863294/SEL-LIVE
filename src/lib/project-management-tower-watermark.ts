/**
 * Report-photograph watermarking (§20).
 *
 * The caption is composed here and rendered two ways, deliberately:
 *
 *  - **On screen and on paper** it is an HTML overlay on the image (see TowerReportPhoto). Nothing is
 *    re-encoded, so the stored photograph stays byte-identical to what the site uploaded — which is
 *    what makes it evidence — and the caption can never go stale against a corrected tower number or
 *    activity. It prints as part of the report.
 *
 *  - **As a standalone file** the caption is burnt into a copy via canvas, for when a photograph has
 *    to leave the system on its own: attached to an email, pasted into a client's own template, filed
 *    against a claim. There the overlay would be lost, so it has to be in the pixels.
 *
 * Burning the watermark at upload time was the other option and was rejected: it destroys the
 * original, and a watermark is only as trustworthy as the metadata it was rendered from at the moment
 * it was baked.
 */

import {
  TOWER_ACTIVITY_DEFINITIONS,
  formatGps,
  type TowerActivity,
  type TowerGpsFix,
} from "@/lib/project-management-tower-progress";

export interface WatermarkContext {
  organisation: string;
  projectName: string;
  towerNo: string;
  activity: TowerActivity;
  progressDate: string;
  gps?: TowerGpsFix | null;
  uploadedByName?: string;
  verified?: boolean;
}

/**
 * The caption lines, in reading order. Organisation first because a photograph that escapes into a
 * client's deck should still say who produced it; GPS and date last because those are the two facts a
 * dispute turns on.
 */
export function watermarkLines(context: WatermarkContext): string[] {
  const lines = [
    context.organisation.toUpperCase(),
    context.projectName ? `Project: ${context.projectName}` : "",
    `Tower: ${context.towerNo}`,
    `Activity: ${TOWER_ACTIVITY_DEFINITIONS[context.activity].label}`,
    `Date: ${formatWatermarkDate(context.progressDate, context.gps?.capturedAt)}`,
    context.gps ? `GPS: ${formatGps(context.gps)}` : "GPS: not recorded",
  ];
  if (context.uploadedByName) lines.push(`Uploaded by: ${context.uploadedByName}`);
  if (context.verified) lines.push("Verified");
  return lines.filter(Boolean);
}

/** `24-Aug-2026 11:32 AM` when the device supplied a fix time, otherwise just the progress date. */
function formatWatermarkDate(progressDate: string, capturedAt?: string): string {
  const date = progressDate ? new Date(`${progressDate}T00:00:00`) : null;
  const datePart =
    date && !Number.isNaN(date.getTime())
      ? date
          .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
          .replace(/ /g, "-")
      : progressDate || "—";
  if (!capturedAt) return datePart;
  const captured = new Date(capturedAt);
  if (Number.isNaN(captured.getTime())) return datePart;
  return `${datePart} ${captured.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Filename for a downloaded watermarked copy, safe on every filesystem. */
export function watermarkFileName(context: WatermarkContext): string {
  return `${context.towerNo}-${context.activity}-${context.progressDate}`
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .toLowerCase()
    .concat(".jpg");
}

/**
 * Draws the photograph with its caption burnt in and returns a JPEG blob.
 *
 * The download URL is fetched rather than assigned to `img.src` directly: a canvas that has drawn a
 * cross-origin image without CORS is tainted, and `toBlob` on a tainted canvas throws. Firebase
 * Storage serves download URLs with permissive CORS, so fetching to a blob URL first keeps the canvas
 * clean. Caller handles failure — a watermark that cannot be produced must not look like a success.
 */
export async function renderWatermarkedPhoto(
  imageUrl: string,
  context: WatermarkContext,
): Promise<Blob> {
  const response = await fetch(imageUrl, { mode: "cors" });
  if (!response.ok) throw new Error(`Could not read the photograph (${response.status}).`);
  const objectUrl = URL.createObjectURL(await response.blob());

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The photograph could not be decoded."));
      element.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not open a drawing canvas.");
    ctx.drawImage(image, 0, 0);

    // Type scales with the photograph so a 12MP site photo and a 640px thumbnail both come out
    // legible; a fixed pixel size would be unreadable on one and cover the subject on the other.
    const lines = watermarkLines(context);
    const fontSize = Math.max(12, Math.round(canvas.width / 52));
    const lineHeight = Math.round(fontSize * 1.35);
    const padding = Math.round(fontSize * 0.7);
    const blockHeight = lineHeight * lines.length + padding * 2;

    ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
    const widest = lines.reduce((width, line) => Math.max(width, ctx.measureText(line).width), 0);
    const blockWidth = Math.min(canvas.width, widest + padding * 2);

    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    ctx.fillRect(0, canvas.height - blockHeight, blockWidth, blockHeight);

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
      ctx.fillText(line, padding, canvas.height - blockHeight + padding + index * lineHeight);
    });

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("The watermarked image could not be encoded."))),
        "image/jpeg",
        0.9,
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Renders and downloads a watermarked copy. */
export async function downloadWatermarkedPhoto(
  imageUrl: string,
  context: WatermarkContext,
): Promise<void> {
  const blob = await renderWatermarkedPhoto(imageUrl, context);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = watermarkFileName(context);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
