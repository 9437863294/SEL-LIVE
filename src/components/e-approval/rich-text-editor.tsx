'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold,
  Eraser,
  Italic,
  Link2,
  List,
  ListOrdered,
  Table as TableIcon,
  Underline,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  eApprovalHtmlWithinLimit,
  hardenEApprovalHtmlLinks,
  sanitizeEApprovalHtml,
  E_APPROVAL_RICH_TEXT_MAX_LENGTH,
  E_APPROVAL_RICH_TEXT_RAW_MAX_LENGTH,
} from '@/lib/e-approval-rich-text';

/**
 * The proposal editor — a mail-compose body, not a plain textarea.
 *
 * The reason this exists is paste fidelity. A note-sheet's proposal is routinely assembled in Word or
 * Excel first: a comparative statement of three vendors, a rate table, a numbered justification. As a
 * textarea, pasting that produced a wall of tab-separated text an approver had to squint at, so
 * people attached the spreadsheet instead and left the proposal saying "please see attached" — which
 * is exactly the note-sheet the module exists to replace.
 *
 * ── The uncontrolled-on-purpose bit ───────────────────────────────────────────────────────────
 *
 * A `contenteditable` cannot be driven like a React input. Writing `innerHTML` on every keystroke
 * destroys and rebuilds the DOM the caret lives in, so the caret jumps to the start on every
 * character. So the element owns its own content, `onChange` reports outward, and `innerHTML` is
 * written back only when the incoming value differs from what is already rendered — which happens
 * on first mount and when a draft loads, and not while typing.
 *
 * ── execCommand ───────────────────────────────────────────────────────────────────────────────
 *
 * The toolbar uses `document.execCommand`, which is deprecated and has no replacement that does not
 * involve adopting a full editor framework (ProseMirror, Lexical) and its dependency tree. It is
 * still implemented in every current browser, and every browser's own `contenteditable` paste path
 * depends on the same machinery. The trade is deliberate: bold/italic/lists via a deprecated API
 * against several hundred kilobytes of editor framework for a field most people will paste into.
 * If it is ever removed, the paste path — the part that actually matters here — is unaffected.
 */

const TOOLBAR_BUTTON = 'h-7 w-7 p-0 text-muted-foreground hover:text-foreground';

/**
 * How long typing has to pause before the proposal is sanitised and reported upward.
 *
 * Publishing on every `input` event meant that each keystroke serialised the whole editor to a
 * string, ran DOMPurify over it — which parses the markup into a document and walks every node — and
 * pushed a new value into React, which then re-derived the plain text with ten regex passes and
 * rebuilt the draft object. On a proposal with a pasted Excel table that is tens of milliseconds of
 * work per character, and it is why typing into a long proposal fell behind the keyboard.
 *
 * 200ms is below the threshold at which a pause reads as lag, and every path where the value is
 * actually *needed* — blur, paste, a toolbar command, unmount — flushes immediately rather than
 * waiting for it, so nothing can be saved a few characters behind what is on screen.
 */
const PUBLISH_DEBOUNCE_MS = 200;

export function EApprovalRichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel = 'Proposal',
}: {
  /** Sanitised HTML. */
  value: string;
  /** Receives sanitised, link-hardened HTML. */
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  /** What we last wrote into or read out of the element, so the effect below can tell "changed elsewhere" from "the user is typing". */
  const lastHtml = useRef<string>('');
  /** The markup we last sanitised, so an unchanged document is never sanitised twice. */
  const lastRaw = useRef<string>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tooLong, setTooLong] = useState(false);

  useEffect(() => {
    const element = editorRef.current;
    if (!element) return;
    if (value === lastHtml.current) return;
    element.innerHTML = value ?? '';
    lastHtml.current = value ?? '';
    lastRaw.current = element.innerHTML;
  }, [value]);

  /** Reads the element's own content back out, sanitises it, and reports it. */
  const publish = useCallback(async () => {
    const element = editorRef.current;
    if (!element) return;
    const raw = element.innerHTML;
    // A blur straight after the debounce has already fired — the ordinary "type, then click away"
    // sequence — would otherwise sanitise an identical document a second time for nothing.
    if (raw === lastRaw.current) return;
    lastRaw.current = raw;
    // The storage limit is judged on the *cleaned* markup below, not on this; all that is checked
    // here is that the document has not grown so large that cleaning it would itself be the stall.
    if (raw.length > E_APPROVAL_RICH_TEXT_RAW_MAX_LENGTH) {
      setTooLong(true);
      return;
    }
    const clean = hardenEApprovalHtmlLinks(await sanitizeEApprovalHtml(raw));
    if (!eApprovalHtmlWithinLimit(clean)) {
      setTooLong(true);
      return;
    }
    setTooLong(false);
    lastHtml.current = clean;
    onChange(clean);
  }, [onChange]);

  /**
   * The latest `publish`, reachable from a timer.
   *
   * A debounce scheduled under one render must not call that render's closure once `onChange` has
   * changed identity — it would report the proposal to a stale handler.
   */
  const publishRef = useRef(publish);
  useEffect(() => {
    publishRef.current = publish;
  }, [publish]);

  /** Cancels any pending debounce and publishes now. Every path but typing uses this. */
  const publishNow = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void publishRef.current();
  }, []);

  /** Typing: coalesce a burst of keystrokes into one sanitise-and-report. */
  const publishSoon = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void publishRef.current();
    }, PUBLISH_DEBOUNCE_MS);
  }, []);

  // Flushed rather than dropped: a proposal typed and then navigated away from without blurring
  // would otherwise lose whatever was written since the last debounce fired.
  useEffect(
    () => () => {
      if (!debounceRef.current) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      void publishRef.current();
    },
    [],
  );

  /**
   * Paste, sanitised, with the formatting kept.
   *
   * The browser's own paste would insert the clipboard's HTML unfiltered — every `<o:p>`, every
   * `mso-` style, every `class="MsoNormal"`, and anything a hostile clipboard cared to include. So
   * the default is prevented and the sanitised HTML inserted instead. `insertHTML` keeps the caret
   * and the undo stack, which building the node by hand does not.
   *
   * A plain-text clipboard still goes in as text; `Shift`-paste is the browser's own path to that and
   * is left alone deliberately, since people use it to strip formatting on purpose.
   */
  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLDivElement>) => {
      const html = event.clipboardData.getData('text/html');
      if (!html) return; // plain text — let the browser handle it
      event.preventDefault();
      // Measured after cleaning, not before. Word's clipboard HTML for a single table runs to
      // hundreds of kilobytes of `mso-` declarations that the sanitiser removes entirely, so judging
      // the raw string against the storage limit rejected pastes that comfortably fit once cleaned.
      if (html.length > E_APPROVAL_RICH_TEXT_RAW_MAX_LENGTH) {
        setTooLong(true);
        return;
      }
      const clean = hardenEApprovalHtmlLinks(await sanitizeEApprovalHtml(html));
      if (!eApprovalHtmlWithinLimit(clean)) {
        setTooLong(true);
        return;
      }
      setTooLong(false);
      document.execCommand('insertHTML', false, clean);
      publishNow();
    },
    [publishNow],
  );

  const exec = (command: string, argument?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, argument);
    publishNow();
  };

  const insertLink = () => {
    const href = window.prompt('Link address');
    if (!href) return;
    // Matches the sanitiser's own URI allowlist, so nothing is inserted that would be stripped a
    // moment later — a link that silently vanishes on save reads as data loss.
    if (!/^(https?:|mailto:|tel:)/i.test(href)) {
      window.alert('Only http, https, mailto and tel links can be added.');
      return;
    }
    exec('createLink', href);
  };

  const insertTable = () => {
    const columns = Number(window.prompt('Columns', '3'));
    const rows = Number(window.prompt('Rows (not counting the header)', '3'));
    if (!Number.isFinite(columns) || !Number.isFinite(rows) || columns < 1 || rows < 1) return;
    if (columns > 12 || rows > 60) {
      window.alert('Up to 12 columns and 60 rows. Paste a larger table from Excel instead.');
      return;
    }
    // Inline styles rather than classes: this markup is stored and later rendered inside a
    // sanitiser that strips `class`, so anything the borders depend on has to travel with it.
    const cell = 'border:1px solid #cbd5e1;padding:6px 8px;';
    const header = `<tr>${Array.from({ length: columns }, (_, index) => `<th style="${cell}background:#f1f5f9;text-align:left;">Column ${index + 1}</th>`).join('')}</tr>`;
    const body = Array.from(
      { length: rows },
      () => `<tr>${Array.from({ length: columns }, () => `<td style="${cell}">&nbsp;</td>`).join('')}</tr>`,
    ).join('');
    exec(
      'insertHTML',
      `<table style="border-collapse:collapse;width:100%;"><tbody>${header}${body}</tbody></table><p><br></p>`,
    );
  };

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-md border border-b-0 bg-muted/40 px-1.5 py-1">
        <Button type="button" size="sm" variant="ghost" className={TOOLBAR_BUTTON} onClick={() => exec('bold')} aria-label="Bold" title="Bold">
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={TOOLBAR_BUTTON} onClick={() => exec('italic')} aria-label="Italic" title="Italic">
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={TOOLBAR_BUTTON} onClick={() => exec('underline')} aria-label="Underline" title="Underline">
          <Underline className="h-3.5 w-3.5" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button type="button" size="sm" variant="ghost" className={TOOLBAR_BUTTON} onClick={() => exec('insertUnorderedList')} aria-label="Bulleted list" title="Bulleted list">
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={TOOLBAR_BUTTON} onClick={() => exec('insertOrderedList')} aria-label="Numbered list" title="Numbered list">
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button type="button" size="sm" variant="ghost" className={TOOLBAR_BUTTON} onClick={insertTable} aria-label="Insert table" title="Insert table">
          <TableIcon className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={TOOLBAR_BUTTON} onClick={insertLink} aria-label="Insert link" title="Insert link">
          <Link2 className="h-3.5 w-3.5" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={TOOLBAR_BUTTON}
          onClick={() => exec('removeFormat')}
          aria-label="Clear formatting"
          title="Clear formatting"
        >
          <Eraser className="h-3.5 w-3.5" />
        </Button>
        <span className="ml-auto pr-1 text-[10px] text-muted-foreground">Paste from Word or Excel keeps its formatting</span>
      </div>

      {/*
        `ea-rich-text` carries the typography and table borders for both this editor and the
        read-only renderer, defined once in globals.css — the proposal has to look the same being
        written as it does being approved.
      */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onInput={publishSoon}
        onBlur={publishNow}
        onPaste={(event) => void handlePaste(event)}
        className={cn(
          'ea-rich-text min-h-[240px] w-full overflow-x-auto rounded-b-md border bg-background px-3 py-2.5 text-sm leading-relaxed',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          'empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
        )}
      />

      {tooLong && (
        <p className="mt-1 text-xs font-medium text-amber-700">
          Still too large once the formatting was tidied up ({Math.round(E_APPROVAL_RICH_TEXT_MAX_LENGTH / 1000)} KB
          is the limit). Paste it in parts, or attach the document instead and summarise it here.
        </p>
      )}
    </div>
  );
}

/**
 * A stored proposal, rendered.
 *
 * Sanitised again here rather than trusted from Firestore: the row may predate the current allowlist,
 * or have been written by a path that skipped the editor. Until the sanitiser has run, nothing is
 * rendered at all — showing the raw markup for one frame is the whole vulnerability.
 */
export function EApprovalRichText({ html, className }: { html: string; className?: string }) {
  const [clean, setClean] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sanitizeEApprovalHtml(html).then((result) => {
      if (!cancelled) setClean(hardenEApprovalHtmlLinks(result));
    });
    return () => {
      cancelled = true;
    };
  }, [html]);

  if (clean === null) {
    return <div className={cn('h-16 animate-pulse rounded bg-muted/40', className)} aria-hidden />;
  }
  return (
    <div
      className={cn('ea-rich-text overflow-x-auto text-sm leading-relaxed', className)}
      // Safe by construction: `clean` is DOMPurify output against the allowlist in
      // `e-approval-rich-text.ts`, never the stored string.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
