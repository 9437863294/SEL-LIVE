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
  'sub', 'sup', 'small', 'mark', 'blockquote', 'pre', 'code', 'hr', 'wbr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Presentational elements that carry formatting rather than meaning. They are deprecated HTML and
  // this codebase would never emit them — but Gmail, Outlook and Word all still do, and unwrapping a
  // `<font color="#c00000">` keeps the words while throwing away the fact that they were red.
  'font', 'center', 'big', 'tt',
  // lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // tables — the point of the exercise: a pasted Excel range has to survive
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  // links
  'a', 'abbr',
] as const;

/**
 * Attributes a proposal may carry.
 *
 * `style` is allowed deliberately. Without it a pasted table arrives with no borders, widths or
 * alignment and looks nothing like what the requester copied — which defeats the purpose. DOMPurify
 * does *not* inspect the CSS inside it: `style` is one of its default URI-safe attributes, so the
 * value is passed through verbatim. `normalizeEApprovalPastedStyles` is what re-parses it and drops
 * anything carrying a `url(…)`.
 *
 * The presentational attributes below matter for the same reason, and their absence was the visible
 * half of "the paste lost its colours". Every mail client and every version of Word still expresses
 * table fills as `bgcolor` and table chrome as `border`/`cellpadding`/`cellspacing` rather than as
 * CSS; dropping them left a merged, shaded header row rendering as plain white cells. `start` and
 * `type` are here so a list pasted mid-document keeps its numbering, and `span` so a `<colgroup>`
 * keeps the column widths it was carrying.
 *
 * `class` and `id` remain excluded. Pasted Word markup carries hundreds of them, they collide with
 * the application's own utility classes, and — now that `normalizeEApprovalPastedStyles` resolves a
 * clipboard stylesheet into inline declarations before this runs — nothing is lost by removing them.
 */
export const E_APPROVAL_RICH_TEXT_ATTRS = [
  'style', 'colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'href', 'target', 'rel', 'title',
  'bgcolor', 'border', 'cellpadding', 'cellspacing', 'nowrap', 'span', 'dir', 'start', 'type',
  'color', 'face', 'size',
] as const;

/**
 * Attributes DOMPurify must not judge as though they were URLs.
 *
 * This is not a nicety, it is the other half of why a pasted table arrived stripped. DOMPurify
 * validates *every* attribute value against `ALLOWED_URI_REGEXP` unless the attribute's name is
 * marked URI-safe — and only a fixed default set (`alt`, `class`, `id`, `title`, `style`, …) is.
 * With this module's deliberately narrow `^(?:https?:|mailto:|tel:|#)` that meant `colspan="3"` was
 * measured against a URL pattern, failed it, and was silently removed. So were `rowspan`, `align`,
 * `valign`, `width` and `height` — every presentational attribute the allowlist above claimed to
 * permit, and exactly the ones a merged, aligned, sized table depends on. `bgcolor="#eeeeee"`
 * survived only by accident, because a hex colour happens to begin with `#`.
 *
 * Everything here is a keyword, a number or a colour; none of them can carry a URL. `href` is the
 * one attribute in the list above that genuinely holds one, so it is the one left out — it must keep
 * facing the URI test.
 */
export const E_APPROVAL_RICH_TEXT_URI_SAFE_ATTRS = E_APPROVAL_RICH_TEXT_ATTRS.filter(
  (attribute) => attribute !== 'href',
);

/**
 * Cap on the stored markup, in characters.
 *
 * A pasted Word page can carry tens of kilobytes of `mso-` span soup around a paragraph of text, and
 * a Firestore document is capped at roughly 1 MB in total — a proposal that quietly exceeded it would
 * fail the whole write, taking the request with it. 200 KB is far more than any note-sheet needs and
 * still leaves the rest of the document ample room.
 */
export const E_APPROVAL_RICH_TEXT_MAX_LENGTH = 200_000;

/**
 * A cheap ceiling on *unsanitised* markup, checked before anything is cleaned.
 *
 * The limit above is on what gets stored, and what gets stored is the sanitised markup — but the
 * clipboard's own HTML is far larger than that. Word wraps a one-page table in a stylesheet, a
 * `<o:p>` per paragraph and an `mso-` declaration on every run; ten kilobytes of actual content
 * routinely arrives as several hundred. Judging the raw string against the storage limit therefore
 * refused pastes that would have cleaned down to a fraction of it, which is most of what "it will
 * not keep my formatting" turned out to mean.
 *
 * So the raw string is only checked against this much looser bound — enough to stop a genuinely
 * enormous paste before the work of cleaning it becomes the stall — and the real limit is applied to
 * the cleaned result, which is the thing that actually has to fit in the document.
 */
export const E_APPROVAL_RICH_TEXT_RAW_MAX_LENGTH = E_APPROVAL_RICH_TEXT_MAX_LENGTH * 12;

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

/* ------------------------------------------------------------------------------------------------
 * Clipboard stylesheets
 *
 * Excel, Google Sheets, Word and Google Docs do not put a table's colours on the cells. They emit a
 * `<style>` block — `.xl67 { background:#FFFF00; border-top:1px solid #000; }` — and put
 * `class="xl67"` on each `<td>`. The sanitiser drops both (`<style>` is forbidden outright, `class`
 * is not on the attribute allowlist), so every fill, border and alignment that lived in that block
 * was thrown away, and a shaded, merged, ruled table arrived as a bare grid of text. The merge
 * itself survived — `colspan`/`rowspan` were always allowed — which is why the result read as
 * "the formatting is gone" rather than "the table is gone".
 *
 * Rather than allow `class` through and let pasted class names collide with the application's own
 * styles, the stylesheet is *resolved* first: each rule is matched against the pasted fragment and
 * its declarations are written onto the elements as inline `style`. That is what a mail client does
 * with a pasted document, and it is why a table pasted into Gmail keeps its shading.
 * ---------------------------------------------------------------------------------------------- */

/** `CSSRule.STYLE_RULE`. Read from the numeric constant so no live `CSSRule` global is needed. */
const CSS_STYLE_RULE = 1;

/**
 * A ceiling on how much of a clipboard stylesheet is honoured.
 *
 * Excel writes one rule per distinct cell format, so a large sheet can arrive with thousands. Each
 * one costs a `querySelectorAll` over the pasted fragment, and past a point the formatting being
 * recovered is not worth making the paste itself feel slow.
 */
const MAX_INLINED_RULES = 2000;

/** The rules of a stylesheet, flattened out of any `@media` / `@supports` wrappers. */
function readClipboardStyleRules(css: string): CSSStyleRule[] {
  const collected: CSSStyleRule[] = [];

  const visit = (rules: CSSRuleList) => {
    for (let index = 0; index < rules.length; index += 1) {
      if (collected.length >= MAX_INLINED_RULES) return;
      const rule = rules[index];
      if (rule.type === CSS_STYLE_RULE) collected.push(rule as CSSStyleRule);
      // Word and Outlook both wrap parts of their output in `@media`; the rules inside are ordinary.
      else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    visit(sheet.cssRules);
    return collected;
  } catch {
    // No constructable stylesheet — fall through to parsing it with a real element.
  }

  // `media="not all"` is parsed by the engine but matches nothing, so the page this is attached to
  // for the duration of the read is never actually styled by the clipboard's CSS.
  const element = document.createElement('style');
  element.media = 'not all';
  element.textContent = css;
  document.head.appendChild(element);
  try {
    if (element.sheet) visit(element.sheet.cssRules);
  } catch {
    // Unreadable rules — keep whatever was collected before the failure.
  } finally {
    element.remove();
  }
  return collected;
}

/**
 * A rule's declarations, serialised for an inline `style` attribute.
 *
 * `url(…)` values are dropped. A note-sheet's formatting never needs one, and keeping them would let
 * a pasted document quietly fetch a remote background — a tracking pixel by another name — from
 * every approver's browser. The CSS parser has already discarded Word's `mso-*` properties and
 * anything else it could not understand, so what comes back here is valid, normalised CSS.
 */
function inlineDeclarationsOf(style: CSSStyleDeclaration): string {
  // Snapshot the names first: removing a property renumbers the collection being walked.
  const properties: string[] = [];
  for (let index = 0; index < style.length; index += 1) properties.push(style.item(index));
  for (const property of properties) {
    if (/url\s*\(/i.test(style.getPropertyValue(property))) style.removeProperty(property);
  }
  // `cssText` rather than a property-by-property rebuild, because the engine re-collapses longhands
  // back into the shorthand they came from. Reassembling by hand turned one `background:#FFFF00`
  // into eight `background-*` declarations, seven of them `initial` — which on a sheet with a few
  // hundred formatted cells is the difference between a paste that fits in the document and one
  // that trips the size limit on nothing but its own verbosity.
  return style.cssText.trim().replace(/;$/, '');
}

/**
 * Resolves any `<style>` blocks in a pasted fragment into inline `style` attributes.
 *
 * Declarations are applied in source order and the element's own inline style is appended last, so
 * the ordinary cascade holds: a later rule beats an earlier one, an inline declaration beats both,
 * and an `!important` in the stylesheet still outranks a plain inline declaration. Selector
 * specificity is not modelled — for the single-class selectors these applications emit it never
 * arises, and approximating it would cost more than it could ever recover.
 *
 * Returns the input untouched off the browser, on a fragment with no stylesheet, or if anything
 * about the parse fails: this improves fidelity and must never be able to lose content.
 */
export function normalizeEApprovalPastedStyles(html: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;
  const hasStyleBlock = /<style[\s>]/i.test(html);
  const hasCssUrl = /url\s*\(/i.test(html);
  // Nothing to resolve and nothing to strip — the overwhelmingly common case on the render path,
  // where the stored markup has already been through here once.
  if (!hasStyleBlock && !hasCssUrl) return html;

  let doc: Document;
  try {
    // Inert: a document from `DOMParser` has no browsing context, so nothing here runs or loads.
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return html;
  }

  if (hasStyleBlock) {
    const styleElements = Array.from(doc.querySelectorAll('style'));
    const css = styleElements.map((element) => element.textContent ?? '').join('\n');
    styleElements.forEach((element) => element.remove());

    const ownStyle = new Map<Element, string>();
    const applied = new Map<Element, string[]>();

    for (const rule of readClipboardStyleRules(css)) {
      const declarations = inlineDeclarationsOf(rule.style);
      if (!declarations) continue;
      let matches: Element[];
      try {
        matches = Array.from(doc.querySelectorAll(rule.selectorText));
      } catch {
        // Word emits selectors no engine will match — `@list l0:level1` and friends. Skip them.
        continue;
      }
      for (const element of matches) {
        if (!ownStyle.has(element)) ownStyle.set(element, element.getAttribute('style') ?? '');
        const list = applied.get(element);
        if (list) list.push(declarations);
        else applied.set(element, [declarations]);
      }
    }

    for (const [element, declarations] of applied) {
      const merged = [...declarations, ownStyle.get(element) ?? '']
        .map((part) => part.trim().replace(/;+$/, ''))
        .filter(Boolean)
        .join(';');
      if (merged) element.setAttribute('style', merged);
    }
  }

  /*
   * Inline `style` attributes get the same `url(…)` treatment as the stylesheet did.
   *
   * DOMPurify will not do this: `style` is one of its default URI-safe attributes, so its value is
   * never measured against `ALLOWED_URI_REGEXP` and a pasted `background:url(https://…)` reaches
   * Firestore intact, then fetches from every approver who opens the file. Re-reading the attribute
   * through the element's own `style` object re-parses it with the engine's CSS parser, which is
   * also what discards Word's `mso-*` leftovers.
   */
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>('[style]'))) {
    if (!/url\s*\(/i.test(element.getAttribute('style') ?? '')) continue;
    const cleaned = inlineDeclarationsOf(element.style);
    if (cleaned) element.setAttribute('style', cleaned);
    else element.removeAttribute('style');
  }

  return doc.body.innerHTML;
}

/**
 * Sanitises proposal HTML against the allowlist above.
 *
 * Browser-only, and dynamically imported so DOMPurify stays out of every server bundle that merely
 * touches this module for `eApprovalHtmlToText`. Off the browser it returns the *text* rendition
 * rather than the markup: falling back to returning the input unchanged would mean an unsanitised
 * string in the one situation where nothing can sanitise it.
 *
 * The clipboard's own stylesheet is resolved into inline declarations on the way in — see
 * `normalizeEApprovalPastedStyles`. That happens before sanitisation, never after, so everything it
 * produces is still subject to the allowlist below.
 */
export async function sanitizeEApprovalHtml(html: string | null | undefined): Promise<string> {
  if (!html) return '';
  if (typeof window === 'undefined') return eApprovalHtmlToText(html);

  const { default: DOMPurify } = await import('dompurify');
  return DOMPurify.sanitize(normalizeEApprovalPastedStyles(String(html)), {
    ALLOWED_TAGS: [...E_APPROVAL_RICH_TEXT_TAGS],
    ALLOWED_ATTR: [...E_APPROVAL_RICH_TEXT_ATTRS],
    // No `data-*`, and no `id`/`class` — pasted Word markup carries hundreds of them and they only
    // ever collide with the app's own styles.
    ALLOW_DATA_ATTR: false,
    // Without this, the narrow `ALLOWED_URI_REGEXP` below is applied to every attribute value in the
    // document, not just the ones that hold URLs — see `E_APPROVAL_RICH_TEXT_URI_SAFE_ATTRS`.
    ADD_URI_SAFE_ATTR: [...E_APPROVAL_RICH_TEXT_URI_SAFE_ATTRS],
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
