/**
 * What an uploaded brand image really is, read from its bytes — never from the file name or the
 * browser-supplied MIME type, both of which the uploader controls.
 *
 * Only PNG, JPEG and WebP are recognised. SVG is deliberately not: it is a document that can carry
 * script and external references, which is exactly what branding must not smuggle onto the sign-in
 * page. Pure, so it is unit-tested with hand-built headers.
 */
import type { BrandAssetKind } from './model.ts';

export type ProbedType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageProbe {
  type: ProbedType;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function probePng(b: Uint8Array): ImageProbe | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || signature.some((byte, i) => b[i] !== byte) || ascii(b, 12, 4) !== 'IHDR') return null;
  return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
}

function probeJpeg(b: Uint8Array): ImageProbe | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { type: 'image/jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7) };
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function probeWebp(b: Uint8Array): ImageProbe | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') return { type: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  if (chunk === 'VP8L') {
    return {
      type: 'image/webp',
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8X') {
    return { type: 'image/webp', width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  return null;
}

export function probeImage(bytes: Uint8Array): ImageProbe | null {
  return probePng(bytes) ?? probeJpeg(bytes) ?? probeWebp(bytes);
}

interface AssetRule {
  label: string;
  types: ProbedType[];
  maxBytes: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  square?: boolean;
  /** Width ÷ height bounds, for logos. */
  minAspect?: number;
  maxAspect?: number;
}

export const ASSET_RULES: Record<BrandAssetKind, AssetRule> = {
  logoLight: { label: 'Logo for light backgrounds', types: ['image/png', 'image/webp', 'image/jpeg'], maxBytes: 1024 * 1024, minWidth: 64, maxWidth: 4096, minHeight: 16, maxHeight: 2048, minAspect: 0.5, maxAspect: 8 },
  logoDark: { label: 'Logo for dark backgrounds', types: ['image/png', 'image/webp', 'image/jpeg'], maxBytes: 1024 * 1024, minWidth: 64, maxWidth: 4096, minHeight: 16, maxHeight: 2048, minAspect: 0.5, maxAspect: 8 },
  favicon: { label: 'Favicon', types: ['image/png'], maxBytes: 256 * 1024, minWidth: 32, maxWidth: 512, minHeight: 32, maxHeight: 512, square: true },
  appIcon: { label: 'App icon', types: ['image/png'], maxBytes: 1024 * 1024, minWidth: 192, maxWidth: 1024, minHeight: 192, maxHeight: 1024, square: true },
};

/** Every reason the image cannot be used as `kind`; empty means it can. */
export function assetProblems(kind: BrandAssetKind, bytes: Uint8Array, probe: ImageProbe | null): string[] {
  const rule = ASSET_RULES[kind];
  const problems: string[] = [];
  if (bytes.length > rule.maxBytes) problems.push(`${rule.label} must be ${Math.round(rule.maxBytes / 1024)} KB or smaller.`);
  if (!probe) {
    problems.push('Only PNG, JPEG or WebP images are accepted.');
    return problems;
  }
  if (!rule.types.includes(probe.type)) problems.push(`${rule.label} must be ${rule.types.map((t) => t.split('/')[1].toUpperCase()).join(' or ')}.`);
  const { width, height } = probe;
  if (width < rule.minWidth || height < rule.minHeight) problems.push(`${rule.label} must be at least ${rule.minWidth}×${rule.minHeight} pixels.`);
  if (width > rule.maxWidth || height > rule.maxHeight) problems.push(`${rule.label} must be at most ${rule.maxWidth}×${rule.maxHeight} pixels.`);
  if (rule.square && width !== height) problems.push(`${rule.label} must be square.`);
  const aspect = width / height;
  if (rule.minAspect && aspect < rule.minAspect) problems.push(`${rule.label} is too tall for its width.`);
  if (rule.maxAspect && aspect > rule.maxAspect) problems.push(`${rule.label} is too wide for its height.`);
  return problems;
}
