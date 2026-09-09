/**
 * The proposal as rich text — pasted from Word, Excel or Gmail with its formatting and tables intact.
 *
 * ── Why there are two fields, not one ──────────────────────────────────────────────────────────
 *
 * `bodyHtml` holds the formatting; `body` stays the plain-text rendition of it. That is not
 * duplication for its own sake:
 *
 *   - **`body` is a material field.** `eApprovalMaterialFingerprint` hashes it, so a change to it
 *     supersedes every approval already given. If the fingerprint hashed the markup, making one word
 *     bold — or pasting the same sentence back from a different editor, which silently rewrites the
 *     span soup around it — would invalidate three signatures for no change of meaning. Hashing the
 *     *text* means the rule stays "the words changed", which is what the rule was always for.
 *   - Notifications, the reference-number line and anything reading a request on a phone lock screen
 *     want a sentence, not markup.
 *   - A request written before rich text existed has only `body`, and renders exactly as it did.
 *
 * ── Why sanitisation is not optional ───────────────────────────────────────────────────────────
 *
 * Storing HTML that other people's browsers will render is a stored-XSS surface, and this one is
 * unusually attractive: anybody who can raise an approval reaches every approver, verifier and
 * administrator who opens the file. So the HTML is sanitised on the way *in* (paste and save) and
 * again on the way *out* (render) — the second pass is what protects the rows already in Firestore,
 * written before a given version of the allowlist, or by any path that skipped the first.
 *
 * DOMPurify does that work rather than a hand-rolled allowlist. Hand-rolling one is where mXSS lives:
 * namespace confusion, mutation on re-parse, and the long tail of parser quirks that a regex over
 * tag names cannot see. This module is dependency-light by preference, not by principle, and a
 * sanitiser is precisely the wrong place to spend that preference.
 *
 * The functions above the DOMPurify boundary are pure and DOM-free so they can be unit-tested under
 * plain Node — see `tests/e-approval-rich-text.test.mjs`.
 */

/** Tags a proposal may contain. Everything pasted outside this list is unwrapped, not dropped. */
export const E_APPROVAL_RICH_TEXT_TAGS = [
  // text and structure
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins',
  'sub', 'sup', 'small', 'mark', 'blockquote', 'pre', 'code', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // lists
  'ul', 'ol', 'li',
  // tables — the point of the exercise: a pasted Excel range has to survive
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  // links
  'a',
] as const;

/**
 * Attributes a proposal may carry.
 *
 * `style` is allowed deliberately. Without it a pasted table arrives with no borders, widths or
 * alignment and looks nothing like what the requester copied — which defeats the purpose. DOMPurify
 * parses and re-serialises the CSS rather than passing the string through, so the historic
 * style-attribute vectors (`expression()`, `url(javascript:…)`, behaviours) do not survive it.
 */
export const E_APPROVAL_RICH_TEXT_ATTRS = [
  'style', 'colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'href', 'target', 'rel', 'title',
] as const;

/**
 * Cap on the stored markup, in characters.
 *
 * A pasted Word page can carry tens of kilobytes of `mso-` span soup around a paragraph of text, and
 * a Firestore document is capped at roughly 1 MB in total — a proposal that quietly exceeded it would
 * fail the whole write, taking the request with it. 200 KB is far more than any note-sheet needs and
 * still leaves the rest of the document ample room.
 */
export const E_APPROVAL_RICH_TEXT_MAX_LENGTH = 200_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  middot: '·',
  bull: '•',
  deg: '°',
  eacute: 'é',
  rupee: '₹',
};

/** `&amp;` → `&`, `&#8377;` → `₹`. Unknown entities are left as written rather than guessed at. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const codePoint = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * The plain-text rendition of a rich proposal — what goes in `body`.
 *
 * Structure is preserved as whitespace rather than thrown away, because this text is what an
 * approver sees in a notification and what the fingerprint compares: a table flattened into one
 * run-on line would make two genuinely different tables hash alike. Cells become tabs, rows and
 * blocks become newlines, list items keep a bullet.
 *
 * Deliberately regex-based and DOM-free: it runs on the server, in the reducer's path and under
 * `node --test`, none of which have a `document`.
 */
export function eApprovalHtmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let text = String(html);

  // Elements whose content must never surface as text, contents and all.
  text = text.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Cell boundaries become tabs before the tags go, so columns stay distinguishable.
  text = text.replace(/<\/(td|th)>\s*/gi, '\t');
  // Everything that is a line in the rendered document becomes a newline.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|pre|table|caption)>\s*/gi, '\n');
  text = text.replace(/<li\b[^>]*>/gi, '• ');
  text = text.replace(/<hr\s*\/?>/gi, '\n');

  // Any remaining tag contributes nothing to the text.
  text = text.replace(/<[^>]*>/g, '');
  text = decodeEntities(text);

  return text
    .replace(/\r\n?/g, '\n')
    // A trailing tab on the last cell of a row is an artefact of the row's own newline.
    .replace(/\t+\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    // Word and Gmail both emit runs of empty paragraphs; two blank lines is the most any prose needs.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Whether a proposal is effectively blank.
 *
 * `contenteditable` never reports itself as empty — clearing it leaves `<p><br></p>`, `<div><br></div>`
 * or a lone `&nbsp;` behind, all of which are truthy strings. Validation has to ask about the text,
 * not the markup, or Submit stays enabled on an empty proposal.
 */
export function eApprovalHtmlIsEmpty(html: string | null | undefined): boolean {
  return eApprovalHtmlToText(html).replace(/[\s •]/g, '').length === 0;
}

/** Whether the markup is small enough to store — see `E_APPROVAL_RICH_TEXT_MAX_LENGTH`. */
export function eApprovalHtmlWithinLimit(html: string | null | undefined): boolean {
  return String(html ?? '').length <= E_APPROVAL_RICH_TEXT_MAX_LENGTH;
}

/**
 * Wraps plain text as minimal HTML, for editing a proposal written before rich text existed.
 *
 * Escaped first, then split: text that happens to contain `<` or `&` must not become markup on its
 * way into an editor whose output is stored and later rendered. Blank-line-separated blocks become
 * paragraphs and single newlines become `<br>`, which is how the text was being displayed anyway
 * (`whitespace-pre-wrap`), so nothing appears to move when an old draft is opened.
 */
export function plainTextToEApprovalHtml(text: string | null | undefined): string {
  if (!text) return '';
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Sanitises proposal HTML against the allowlist above.
 *
 * Browser-only, and dynamically imported so DOMPurify stays out of every server bundle that merely
 * touches this module for `eApprovalHtmlToText`. Off the browser it returns the *text* rendition
 * rather than the markup: falling back to returning the input unchanged would mean an unsanitised
 * string in the one situation where nothing can sanitise it.
 */
export async function sanitizeEApprovalHtml(html: string | null | undefined): Promise<string> {
  if (!html) return '';
  if (typeof window === 'undefined') return eApprovalHtmlToText(html);

  const { default: DOMPurify } = await import('dompurify');
  return DOMPurify.sanitize(String(html), {
    ALLOWED_TAGS: [...E_APPROVAL_RICH_TEXT_TAGS],
    ALLOWED_ATTR: [...E_APPROVAL_RICH_TEXT_ATTRS],
    // No `data-*`, and no `id`/`class` — pasted Word markup carries hundreds of them and they only
    // ever collide with the app's own styles.
    ALLOW_DATA_ATTR: false,
    // Keep the words when a tag is not allowed; dropping the subtree would silently eat content the
    // requester can see in their clipboard.
    KEEP_CONTENT: true,
    // Anything that can navigate, submit or embed has no business in a note-sheet's body.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#)/i,
  });
}

/**
 * Every link opened from a proposal goes to a new tab without handing it a live `window.opener`.
 *
 * Applied after sanitisation rather than inside it: DOMPurify's job is to decide what may stay, this
 * decides how what stayed behaves. Runs on a string so it works identically on both the write and
 * the render path.
 */
export function hardenEApprovalHtmlLinks(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (whole, attrs: string) => {
    if (!/\bhref=/i.test(attrs)) return whole;
    const withoutOwn = attrs.replace(/\s*\b(target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<a${withoutOwn} target="_blank" rel="noopener noreferrer nofollow">`;
  });
}
