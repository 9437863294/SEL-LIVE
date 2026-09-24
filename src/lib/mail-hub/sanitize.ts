/**
 * Mail Hub — making received HTML safe to show.
 *
 * Email HTML is written by strangers and rendered inside an application that holds a session for
 * every module in the ERP. It is treated accordingly, in three layers:
 *
 *   1. **Here, on the server**, with an allowlist sanitiser (`sanitize-html`, which parses with
 *      htmlparser2 rather than regular expressions). Scripts, event handlers, forms, frames,
 *      objects, `<base>`, meta refreshes and every URL scheme except http(s)/mailto/tel are removed.
 *      Remote images are **blocked by default** — a remote image is a read receipt the sender did
 *      not ask for — and counted so the reader can choose to load them.
 *   2. **In the browser**, DOMPurify runs over the result again before it is displayed (see
 *      `components/mail-hub/message-body.tsx`), which protects any cached body sanitised by an older
 *      version of this allowlist.
 *   3. **The display surface** is an `<iframe sandbox>` with no `allow-scripts`, carrying a
 *      Content-Security-Policy (`frame.ts`) that forbids everything except inline styles and the
 *      image sources the reader allowed. It keeps `allow-same-origin` only so the ERP can measure
 *      its height; a document that cannot run script has no way to use that origin. Even markup
 *      that got past the first two layers could not run code or make a request of its own.
 *
 * Links are rewritten to the in-app interstitial (`/mail/link`), which shows the real destination
 * before leaving the ERP, and anchors whose visible text is a URL for a *different* host than the
 * one they point to — the classic phishing shape — are marked so the interstitial can warn.
 */

import sanitizeHtml from 'sanitize-html';

export const MAIL_LINK_INTERSTITIAL = '/mail/link';

export interface SanitizeMailOptions {
  /** Load remote (https) images and CSS backgrounds. Off by default. */
  allowRemoteContent?: boolean;
  /** `cid:` → `data:` URI for inline images the server has already fetched and validated. */
  inlineImages?: Record<string, string>;
  /** Rewrite links to the interstitial. On for display; off when quoting into a reply. */
  rewriteLinks?: boolean;
}

export interface SanitizedMail {
  html: string;
  remoteContentBlocked: number;
  suspiciousLinks: number;
}

const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'article', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption',
  'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'ol', 'p', 'pre', 'q', 's', 'section',
  'small', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'wbr',
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  '*': ['style', 'class', 'dir', 'lang', 'title', 'align', 'valign', 'width', 'height', 'bgcolor', 'color'],
  a: ['href', 'name', 'target', 'rel', 'data-host', 'data-original-href'],
  img: ['src', 'alt', 'width', 'height', 'border', 'data-remote-src', 'data-blocked'],
  table: ['border', 'cellpadding', 'cellspacing', 'summary', 'role'],
  td: ['colspan', 'rowspan', 'nowrap', 'headers', 'scope'],
  th: ['colspan', 'rowspan', 'nowrap', 'headers', 'scope'],
  col: ['span'],
  colgroup: ['span'],
  font: ['face', 'size', 'color'],
  ol: ['start', 'type', 'reversed'],
  li: ['value'],
  time: ['datetime'],
  blockquote: ['cite'],
  q: ['cite'],
};

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/** Strip everything from CSS that can load, execute, or escape the message's own box. */
export function cleanCss(css: string, allowRemote: boolean): { css: string; blocked: number } {
  let blocked = 0;
  let out = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]*;?/gi, () => {
      blocked += 1;
      return '';
    })
    .replace(/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding/gi, '')
    .replace(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi, (_whole, _quote, target: string) => {
      const value = target.trim();
      if (SAFE_DATA_IMAGE.test(value)) return `url("${value}")`;
      if (allowRemote && /^https:\/\//i.test(value)) return `url("${value.replace(/["\\]/g, '')}")`;
      blocked += 1;
      return 'none';
    })
    // A fixed-position overlay inside the frame can dress itself up as ERP chrome.
    .replace(/position\s*:\s*fixed/gi, 'position:static');
  out = out.replace(/[<>]/g, '');
  return { css: out, blocked };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The visible text looks like a URL or domain, and it is not the one the link goes to. */
export function linkTextMismatch(text: string, href: string): boolean {
  const visible = text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim().toLowerCase();
  const target = hostOf(href);
  if (!target || !visible) return false;
  const match = visible.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?$/i);
  if (!match) return false;
  const shown = match[1].replace(/^www\./, '');
  return shown !== target && !target.endsWith(`.${shown}`);
}

export function interstitialHref(href: string, suspicious: boolean): string {
  const params = new URLSearchParams({ u: href });
  if (suspicious) params.set('w', 'text-mismatch');
  return `${MAIL_LINK_INTERSTITIAL}?${params.toString()}`;
}

export function sanitizeMailHtml(raw: string | null | undefined, options: SanitizeMailOptions = {}): SanitizedMail {
  const allowRemote = Boolean(options.allowRemoteContent);
  const inline = options.inlineImages ?? {};
  const rewriteLinks = options.rewriteLinks !== false;
  let remoteContentBlocked = 0;

  // `<style>` contents are raw text to the parser and never reach `textFilter`, so they are cleaned
  // before parsing. `cleanCss` strips `<` and `>`, so the cleaned text cannot close the element early.
  const input = (raw ?? '')
    .slice(0, 5_000_000)
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_whole, css: string) => {
      const result = cleanCss(css, allowRemote);
      remoteContentBlocked += result.blocked;
      return `<style>${result.css}</style>`;
    });

  const cleaned = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: false,
    // `<style>` is kept — newsletters are unreadable without it — and its text cleaned below.
    // sanitize-html calls it vulnerable because in a normal page it is; here it renders inside a
    // script-less sandboxed frame whose CSP blocks every load the cleaned CSS could still attempt.
    allowVulnerableTags: true,
    nonTextTags: ['script', 'noscript', 'textarea', 'option', 'title', 'head', 'template', 'iframe', 'object', 'embed', 'svg', 'math'],
    disallowedTagsMode: 'discard',
    transformTags: {
      '*': (tagName, attribs) => {
        const next = { ...attribs };
        if (next.style) {
          const result = cleanCss(next.style, allowRemote);
          remoteContentBlocked += result.blocked;
          next.style = result.css;
        }
        if (next.background) delete next.background;
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        if (next.style) {
          const result = cleanCss(next.style, allowRemote);
          remoteContentBlocked += result.blocked;
          next.style = result.css;
        }
        const src = (next.src ?? '').trim();
        if (/^cid:/i.test(src)) {
          const cid = src.slice(4).replace(/^<|>$/g, '').toLowerCase();
          const data = inline[cid];
          if (data && SAFE_DATA_IMAGE.test(data)) next.src = data;
          else {
            delete next.src;
            next['data-blocked'] = 'inline';
          }
        } else if (/^data:/i.test(src)) {
          if (!SAFE_DATA_IMAGE.test(src)) delete next.src;
        } else if (/^https?:\/\//i.test(src)) {
          if (allowRemote && /^https:\/\//i.test(src)) {
            // kept
          } else {
            remoteContentBlocked += 1;
            next['data-remote-src'] = src.slice(0, 2048);
            next['data-blocked'] = 'remote';
            delete next.src;
          }
        } else {
          delete next.src;
        }
        return { tagName, attribs: next };
      },
      a: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        // A tag-specific transform replaces the `*` one rather than adding to it.
        if (next.style) {
          const result = cleanCss(next.style, allowRemote);
          remoteContentBlocked += result.blocked;
          next.style = result.css;
        }
        const href = (next.href ?? '').trim();
        if (/^https?:\/\//i.test(href)) {
          // Display only: outgoing mail (rewriteLinks off) must not carry ERP bookkeeping attributes.
          if (rewriteLinks) {
            next['data-host'] = hostOf(href) ?? '';
            next['data-original-href'] = href.slice(0, 4096);
            next.href = interstitialHref(href, false);
          }
          next.target = '_blank';
          next.rel = 'noopener noreferrer nofollow';
        } else if (/^(mailto|tel):/i.test(href)) {
          next.target = '_blank';
          next.rel = 'noopener noreferrer';
        } else {
          delete next.href;
        }
        return { tagName, attribs: next };
      },
    },
  });

  // Second pass over well-formed output: mark links whose text names a different host.
  let suspiciousLinks = 0;
  const html = cleaned.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs: string, text: string) => {
    const original = attrs.match(/data-original-href="([^"]*)"/i)?.[1];
    if (!original) return whole;
    const href = original.replace(/&amp;/g, '&');
    if (!linkTextMismatch(text, href)) return whole;
    suspiciousLinks += 1;
    const rewritten = rewriteLinks
      ? attrs.replace(/href="[^"]*"/i, `href="${interstitialHref(href, true).replace(/&/g, '&amp;')}"`)
      : attrs;
    return `<a${rewritten} title="Warning: this link does not go where its text says">${text}</a>`;
  });

  return { html, remoteContentBlocked, suspiciousLinks };
}

export { mailFrameDocument } from './frame.ts';
