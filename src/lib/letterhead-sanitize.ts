/**
 * The designed letterhead's HTML, cleaned on the server with sanitize-html (htmlparser2, not
 * regexes) — on save and on every server read, so emails and print routes never see markup that
 * predates the current allow-list. The browser runs DOMPurify over it again before rendering
 * (letterhead-purify.ts). Both use the allow-lists in company-profile.ts.
 *
 * No `server-only` import so it runs under plain node for tests; nothing in the browser imports it.
 */

import sanitizeHtml from 'sanitize-html';
import {
  LETTERHEAD_ATTRIBUTES,
  LETTERHEAD_HTML_MAX_LENGTH,
  LETTERHEAD_TAGS,
  filterLetterheadStyle,
  isAllowedLetterheadImage,
  isAllowedLetterheadLink,
  type CompanyProfile,
} from './company-profile.ts';

export interface LetterheadSanitizeOptions {
  /** Firebase Storage buckets images may come from; empty allows any Firebase Storage bucket. */
  buckets?: string[];
  logoUrl?: string | null;
}

/** The configured Storage bucket(s), from the same variables firebase-admin reads. */
export function letterheadBuckets(): string[] {
  return [process.env.FIREBASE_STORAGE_BUCKET, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET].filter((b): b is string => !!b);
}

export function sanitizeLetterheadHtml(html: unknown, opts: LetterheadSanitizeOptions = {}): string {
  if (typeof html !== 'string' || !html) return '';
  const allowedAttributes: Record<string, string[]> = {};
  for (const [tag, attrs] of Object.entries(LETTERHEAD_ATTRIBUTES)) allowedAttributes[tag] = [...attrs];
  const clean = sanitizeHtml(html, {
    allowedTags: [...LETTERHEAD_TAGS],
    allowedAttributes,
    allowedSchemes: ['https'],
    allowedSchemesByTag: { img: ['https'], a: ['https'] },
    allowProtocolRelative: false,
    // Script, style, iframes, forms, SVG and the rest are dropped with their content.
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'template'],
    // Our own filter rather than postcss parsing: one allow-list for both sanitisers.
    parseStyleAttributes: false,
    transformTags: {
      '*': (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        if ('style' in next) {
          const style = filterLetterheadStyle(next.style);
          if (style) next.style = style;
          else delete next.style;
        }
        for (const size of ['width', 'height', 'colspan', 'rowspan']) {
          if (size in next && !/^\d{1,4}%?$/.test(next[size].trim())) delete next[size];
        }
        if (tagName === 'a') {
          if (!isAllowedLetterheadLink(next.href)) delete next.href;
          next.target = '_blank';
          next.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: next };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !isAllowedLetterheadImage(frame.attribs.src, opts),
  });
  return clean.length <= LETTERHEAD_HTML_MAX_LENGTH ? clean : '';
}

/** The profile with its designed header and footer cleaned. */
export function sanitizeProfileLetterhead(profile: CompanyProfile, buckets: string[] = letterheadBuckets()): CompanyProfile {
  const lh = profile.design.letterhead;
  const opts = { buckets, logoUrl: profile.logoUrl };
  return {
    ...profile,
    design: {
      ...profile.design,
      letterhead: {
        ...lh,
        custom: { ...lh.custom, headerHtml: sanitizeLetterheadHtml(lh.custom.headerHtml, opts), footerHtml: sanitizeLetterheadHtml(lh.custom.footerHtml, opts) },
      },
    },
  };
}
