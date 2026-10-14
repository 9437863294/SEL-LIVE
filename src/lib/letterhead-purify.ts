'use client';

/**
 * The designed letterhead's HTML, cleaned in the browser with DOMPurify before it is rendered or
 * stored from the designer — the second of two passes (the server's is letterhead-sanitize.ts).
 * Same allow-lists, from company-profile.ts.
 *
 * Its own DOMPurify instance: the hooks below (style filter, image hosts, link hardening) must not
 * leak into E-Approval's or Mail Hub's use of the shared default instance.
 *
 * Synchronous on purpose, so a print page that calls window.print() on load never prints an empty
 * header. Off the browser it returns '' — DOMPurify passes markup through unchanged there.
 */

import DOMPurify, { type DOMPurify as DOMPurifyInstance } from 'dompurify';
import {
  LETTERHEAD_ATTRIBUTES,
  LETTERHEAD_HTML_MAX_LENGTH,
  LETTERHEAD_TAGS,
  filterLetterheadStyle,
  isAllowedLetterheadImage,
  isAllowedLetterheadLink,
} from '@/lib/company-profile';

const BUCKETS = [process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET].filter((b): b is string => !!b);
const ALL_ATTRIBUTES = [...new Set(Object.values(LETTERHEAD_ATTRIBUTES).flat())];

let instance: DOMPurifyInstance | null = null;
let currentLogo: string | null = null;

function purifier(): DOMPurifyInstance | null {
  if (typeof window === 'undefined') return null;
  if (instance) return instance;
  const created = DOMPurify(window);
  if (!created.isSupported) return null;
  created.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.nodeName.toLowerCase();
    const allowed = LETTERHEAD_ATTRIBUTES[tag] ?? [];
    if (data.attrName !== 'style' && !allowed.includes(data.attrName)) {
      data.keepAttr = false;
      return;
    }
    if (data.attrName === 'style') {
      const style = filterLetterheadStyle(data.attrValue);
      if (style) data.attrValue = style;
      else data.keepAttr = false;
    } else if (['width', 'height', 'colspan', 'rowspan'].includes(data.attrName) && !/^\d{1,4}%?$/.test(data.attrValue.trim())) {
      data.keepAttr = false;
    } else if (data.attrName === 'href' && !isAllowedLetterheadLink(data.attrValue)) {
      data.keepAttr = false;
    }
  });
  created.addHook('afterSanitizeAttributes', (node) => {
    const element = node as Element;
    if (element.nodeName === 'IMG' && !isAllowedLetterheadImage(element.getAttribute('src'), { buckets: BUCKETS, logoUrl: currentLogo })) {
      element.remove();
    } else if (element.nodeName === 'A') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  });
  instance = created;
  return created;
}

export function purifyLetterheadHtml(html: string | null | undefined, logoUrl: string | null = null): string {
  if (!html) return '';
  const p = purifier();
  if (!p) return '';
  currentLogo = logoUrl;
  const clean = p.sanitize(String(html), {
    ALLOWED_TAGS: [...LETTERHEAD_TAGS],
    ALLOWED_ATTR: ALL_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ADD_URI_SAFE_ATTR: ALL_ATTRIBUTES.filter((a) => a !== 'href' && a !== 'src'),
    ALLOWED_URI_REGEXP: /^https:\/\//i,
    KEEP_CONTENT: true,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math', 'template'],
  });
  return clean.length <= LETTERHEAD_HTML_MAX_LENGTH ? clean : '';
}
