import 'server-only';

/**
 * Optional malware scanning of attachments in both directions.
 *
 * `MAIL_HUB_SCAN_URL` points at an HTTP scanner — a ClamAV REST sidecar, or a cloud scanning
 * endpoint — that accepts the raw bytes and answers `{ "clean": true|false, "signature"?: string }`.
 * Without one, files are marked `not-scanned` and the UI says exactly that; the module never claims
 * a scan it did not do. With one, a scanner outage is `unavailable`, which the download route
 * treats as a warning rather than a block (the provider has already scanned inbound mail), and the
 * upload route treats as a block (the ERP is the last hop before the recipient).
 */

import { scannerToken, scannerUrl } from './config';
import type { MailAttachmentMeta } from './model';

export async function scanBytes(content: Uint8Array, filename: string): Promise<{ status: MailAttachmentMeta['scanStatus']; signature: string | null }> {
  const url = scannerUrl();
  if (!url) return { status: 'not-scanned', signature: null };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(filename).slice(0, 200),
        ...(scannerToken() ? { Authorization: `Bearer ${scannerToken()}` } : {}),
      },
      body: Buffer.from(content),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { status: 'unavailable', signature: null };
    const result = (await response.json().catch(() => null)) as { clean?: boolean; signature?: string } | null;
    if (typeof result?.clean !== 'boolean') return { status: 'unavailable', signature: null };
    return { status: result.clean ? 'clean' : 'infected', signature: result.signature ?? null };
  } catch {
    return { status: 'unavailable', signature: null };
  }
}
