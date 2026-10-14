'use client';

/**
 * The letterhead designer: a Word-like editor for the header and footer HTML, and an A4 preview.
 *
 * Built beside E-Approval's editor (src/components/e-approval/rich-text-editor.tsx) on the same
 * approach — an uncontrolled contenteditable, execCommand for formatting, paste resolved by
 * `normalizeEApprovalPastedStyles` so Word keeps its formatting — but cleaned against the
 * letterhead allow-list (letterhead-purify.ts), with merge fields and page tools on top.
 *
 * Merge fields are stored as plain `{{field}}` text. In the editor each one is a non-editable chip
 * (`data-lh-field`), turned back into `{{field}}` text before the markup is cleaned and reported.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Braces, Columns, Eraser, ImagePlus, Italic, List,
  ListOrdered, Loader2, Minus, Redo2, Rows, Strikethrough, Table as TableIcon, Trash2, Underline, Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { auth } from '@/lib/firebase';
import {
  LETTERHEAD_FIELDS,
  LETTERHEAD_FONTS,
  type CompanyProfile,
  type LetterheadContext,
} from '@/lib/company-profile';
import { normalizeEApprovalPastedStyles } from '@/lib/e-approval-rich-text';
import { purifyLetterheadHtml } from '@/lib/letterhead-purify';
import { CompanyFooterLine, CompanyLetterhead, DESIGNED_HTML_CLASS } from '@/components/shared/company-letterhead';
import { cn } from '@/lib/utils';

const TOOL = 'h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground';
const SELECT = 'h-7 rounded border bg-background px-1 text-xs text-foreground';
const PUBLISH_DEBOUNCE_MS = 250;
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32];
const LINE_SPACINGS = ['1', '1.15', '1.4', '1.5', '2'];

const FIELD_LABEL = new Map(LETTERHEAD_FIELDS.map((field) => [field.name, field.label]));
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CHIP_CLASS = 'mx-px rounded bg-sky-100 px-1 text-sky-800 ring-1 ring-sky-300';

function chipHtml(name: string): string {
  const label = name.startsWith('meta.') ? name.slice(5) : (FIELD_LABEL.get(name) ?? name);
  return `<span contenteditable="false" data-lh-field="${escapeHtml(name)}" class="${CHIP_CLASS}">${escapeHtml(label)}</span>`;
}

/** Clean markup → editor markup: each `{{field}}` in text becomes a chip. */
function toEditorHtml(clean: string): string {
  return clean.replace(/(<[^>]*>)|\{\{\s*([^{}<>]{1,80}?)\s*\}\}/g, (whole, tag: string | undefined, name: string | undefined) => (tag ? tag : chipHtml((name ?? '').trim())));
}

/** Editor (or clipboard) markup → stored form: chips back to `{{field}}` text. */
function chipsToTokens(html: string): string {
  if (!html.includes('data-lh-field')) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const chip of Array.from(doc.querySelectorAll('[data-lh-field]'))) {
    chip.replaceWith(doc.createTextNode(`{{${chip.getAttribute('data-lh-field') ?? ''}}}`));
  }
  return doc.body.innerHTML;
}

async function uploadImage(file: File): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/company-profile/assets', { method: 'POST', body, headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  const data = (await response.json().catch(() => ({}))) as { asset?: { url?: string }; error?: string };
  if (!response.ok || !data.asset?.url) throw new Error(data.error ?? 'The image could not be uploaded.');
  return data.asset.url;
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />;
}

function Tool({ label, onRun, children, disabled }: { label: string; onRun: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={TOOL}
      title={label}
      aria-label={label}
      disabled={disabled}
      // Keep the editor's selection: a click would otherwise move focus to the button first.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      {children}
    </Button>
  );
}

function TablePicker({ onPick, disabled }: { onPick: (rows: number, cols: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className={TOOL} title="Insert table" aria-label="Insert table" disabled={disabled} onMouseDown={(event) => event.preventDefault()}>
          <TableIcon className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="grid grid-cols-8 gap-0.5" onMouseLeave={() => setHover([0, 0])}>
          {Array.from({ length: 64 }, (_, index) => {
            const row = Math.floor(index / 8) + 1;
            const col = (index % 8) + 1;
            const active = row <= hover[0] && col <= hover[1];
            return (
              <button
                key={index}
                type="button"
                aria-label={`${row} × ${col} table`}
                className={cn('h-4 w-4 rounded-sm border', active ? 'border-primary bg-primary/30' : 'border-border bg-background')}
                onMouseEnter={() => setHover([row, col])}
                onFocus={() => setHover([row, col])}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onPick(row, col); setOpen(false); }}
              />
            );
          })}
        </div>
        <p className="mt-1 text-center text-xs text-muted-foreground">{hover[0] ? `${hover[0]} × ${hover[1]}` : 'Rows × columns'}</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One header or footer editor. `value` is clean stored HTML; `onChange` receives clean HTML.
 */
export function LetterheadHtmlEditor({
  value,
  onChange,
  label,
  disabled = false,
  minHeightClass = 'min-h-[120px]',
}: {
  value: string;
  onChange: (html: string) => void;
  label: string;
  disabled?: boolean;
  minHeightClass?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastHtml = useRef<string | null>(null);
  const loadedClean = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Written into the element only when the value changed elsewhere (load, reset) — never while typing.
  useEffect(() => {
    const element = editorRef.current;
    if (!element || value === lastHtml.current) return;
    element.innerHTML = toEditorHtml(purifyLetterheadHtml(value));
    lastHtml.current = value;
    // What reading the untouched editor back gives: the server's and DOMPurify's serialisations
    // differ in trivia (<br /> vs <br>), which must not count as an edit.
    loadedClean.current = purifyLetterheadHtml(chipsToTokens(element.innerHTML));
  }, [value]);

  const publish = useCallback(() => {
    const element = editorRef.current;
    if (!element) return;
    const clean = purifyLetterheadHtml(chipsToTokens(element.innerHTML));
    if (!clean && element.textContent?.trim()) {
      setMessage('Too large to store — remove some content or images.');
      return;
    }
    setMessage(null);
    if (clean === lastHtml.current || clean === loadedClean.current) return;
    loadedClean.current = null;
    lastHtml.current = clean;
    onChange(clean);
  }, [onChange]);

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);
  const publishNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    publishRef.current();
  }, []);
  const publishSoon = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { debounceRef.current = null; publishRef.current(); }, PUBLISH_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => { if (debounceRef.current) { clearTimeout(debounceRef.current); publishRef.current(); } }, []);

  // Remember the caret while focus is in a toolbar select or popover.
  useEffect(() => {
    const onSelection = () => {
      const selection = document.getSelection();
      const element = editorRef.current;
      if (!selection || !selection.rangeCount || !element) return;
      const range = selection.getRangeAt(0);
      if (element.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const restore = () => {
    const element = editorRef.current;
    if (!element) return;
    element.focus();
    const range = savedRange.current;
    if (range && element.contains(range.commonAncestorContainer)) {
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  const exec = (command: string, argument?: string) => {
    restore();
    // Spans with inline styles rather than <font>, which the allow-list would unwrap.
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, argument);
    publishNow();
  };

  /** execCommand only knows sizes 1–7: apply 7, then rewrite those runs to the chosen point size. */
  const setFontSize = (pt: number) => {
    restore();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('fontSize', false, '7');
    const element = editorRef.current;
    element?.querySelectorAll<HTMLElement>('span[style*="xxx-large"], span[style*="-webkit-xxx-large"]').forEach((span) => { span.style.fontSize = `${pt}pt`; });
    element?.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement('span');
      span.style.fontSize = `${pt}pt`;
      span.append(...Array.from(font.childNodes));
      font.replaceWith(span);
    });
    publishNow();
  };

  /** The block elements the selection touches (inside the editor). */
  const selectedBlocks = (): HTMLElement[] => {
    const element = editorRef.current;
    const range = savedRange.current;
    if (!element || !range) return [];
    const blockOf = (node: Node | null): HTMLElement | null => {
      let current: Node | null = node;
      while (current && current !== element) {
        if (current instanceof HTMLElement && /^(P|DIV|LI|H1|H2|H3|H4|TD|TH)$/.test(current.tagName)) return current;
        current = current.parentNode;
      }
      return null;
    };
    const blocks = new Set<HTMLElement>();
    const start = blockOf(range.startContainer);
    const end = blockOf(range.endContainer);
    if (start) blocks.add(start);
    if (end) blocks.add(end);
    element.querySelectorAll<HTMLElement>('p,div,li,h1,h2,h3,h4').forEach((block) => { if (range.intersectsNode(block)) blocks.add(block); });
    return [...blocks];
  };

  const setLineSpacing = (value: string) => {
    restore();
    let blocks = selectedBlocks();
    if (!blocks.length) {
      document.execCommand('formatBlock', false, 'p');
      blocks = selectedBlocks();
    }
    blocks.forEach((block) => { block.style.lineHeight = value; });
    publishNow();
  };

  const insertTable = (rows: number, cols: number) => {
    const cell = 'border:1px solid #94a3b8;padding:4px 6px';
    const width = Math.floor(100 / cols);
    const row = `<tr>${Array.from({ length: cols }, () => `<td width="${width}%" style="${cell}"><br></td>`).join('')}</tr>`;
    exec('insertHTML', `<table width="100%" style="border-collapse:collapse;width:100%"><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`);
  };

  const currentCell = (): HTMLTableCellElement | null => {
    const range = savedRange.current;
    let node: Node | null = range?.startContainer ?? null;
    while (node && node !== editorRef.current) {
      if (node instanceof HTMLTableCellElement) return node;
      node = node.parentNode;
    }
    return null;
  };

  const tableEdit = (action: 'addRow' | 'removeRow' | 'addCol' | 'removeCol') => {
    const cell = currentCell();
    if (!cell) {
      setMessage('Put the cursor in a table cell first.');
      return;
    }
    const row = cell.parentElement as HTMLTableRowElement;
    const table = cell.closest('table');
    if (!table) return;
    const index = cell.cellIndex;
    if (action === 'addRow') {
      const copy = row.cloneNode(true) as HTMLTableRowElement;
      copy.querySelectorAll('td,th').forEach((c) => { c.innerHTML = '<br>'; });
      row.after(copy);
    } else if (action === 'removeRow') {
      if (table.rows.length <= 1) table.remove();
      else row.remove();
    } else {
      for (const r of Array.from(table.rows)) {
        const target = r.cells[Math.min(index, r.cells.length - 1)];
        if (!target) continue;
        if (action === 'addCol') {
          const added = target.cloneNode(false) as HTMLTableCellElement;
          added.innerHTML = '<br>';
          added.removeAttribute('width');
          target.after(added);
        } else if (r.cells.length <= 1) {
          table.remove();
          break;
        } else {
          target.remove();
        }
      }
    }
    setMessage(null);
    publishNow();
  };

  const insertField = (name: string) => {
    if (!name) return;
    exec('insertHTML', `${chipHtml(name)}&nbsp;`);
  };

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      restore();
      document.execCommand('insertHTML', false, `<img src="${escapeHtml(url)}" alt="" style="height:48px;width:auto">`);
      publishNow();
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The image could not be uploaded.');
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const html = event.clipboardData.getData('text/html');
    if (!html) return; // plain text: the browser's own paste
    event.preventDefault();
    // Word's stylesheet resolved into inline styles, then the letterhead allow-list.
    const clean = purifyLetterheadHtml(chipsToTokens(normalizeEApprovalPastedStyles(html)));
    document.execCommand('insertHTML', false, toEditorHtml(clean));
    publishNow();
  };

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-md border border-b-0 bg-muted/40 px-1.5 py-1" role="toolbar" aria-label={`${label} formatting`}>
        <select className={cn(SELECT, 'max-w-[8.5rem]')} aria-label="Font" defaultValue="" disabled={disabled} onChange={(e) => { if (e.target.value) exec('fontName', e.target.value); e.target.value = ''; }}>
          <option value="">Font</option>
          {LETTERHEAD_FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
        </select>
        <select className={SELECT} aria-label="Font size" defaultValue="" disabled={disabled} onChange={(e) => { if (e.target.value) setFontSize(Number(e.target.value)); e.target.value = ''; }}>
          <option value="">Size</option>
          {FONT_SIZES.map((size) => <option key={size} value={size}>{size} pt</option>)}
        </select>
        <Divider />
        <Tool label="Bold" onRun={() => exec('bold')} disabled={disabled}><Bold className="h-3.5 w-3.5" /></Tool>
        <Tool label="Italic" onRun={() => exec('italic')} disabled={disabled}><Italic className="h-3.5 w-3.5" /></Tool>
        <Tool label="Underline" onRun={() => exec('underline')} disabled={disabled}><Underline className="h-3.5 w-3.5" /></Tool>
        <Tool label="Strikethrough" onRun={() => exec('strikeThrough')} disabled={disabled}><Strikethrough className="h-3.5 w-3.5" /></Tool>
        <label className="flex h-7 items-center gap-0.5 px-1 text-[10px] text-muted-foreground" title="Text colour">
          A<input type="color" aria-label="Text colour" className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" disabled={disabled} defaultValue="#0f172a" onChange={(e) => exec('foreColor', e.target.value)} />
        </label>
        <label className="flex h-7 items-center gap-0.5 px-1 text-[10px] text-muted-foreground" title="Highlight">
          Hl<input type="color" aria-label="Highlight colour" className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" disabled={disabled} defaultValue="#fef08a" onChange={(e) => exec('hiliteColor', e.target.value)} />
        </label>
        <Divider />
        <Tool label="Align left" onRun={() => exec('justifyLeft')} disabled={disabled}><AlignLeft className="h-3.5 w-3.5" /></Tool>
        <Tool label="Centre" onRun={() => exec('justifyCenter')} disabled={disabled}><AlignCenter className="h-3.5 w-3.5" /></Tool>
        <Tool label="Align right" onRun={() => exec('justifyRight')} disabled={disabled}><AlignRight className="h-3.5 w-3.5" /></Tool>
        <Tool label="Justify" onRun={() => exec('justifyFull')} disabled={disabled}><AlignJustify className="h-3.5 w-3.5" /></Tool>
        <select className={SELECT} aria-label="Line spacing" defaultValue="" disabled={disabled} onChange={(e) => { if (e.target.value) setLineSpacing(e.target.value); e.target.value = ''; }}>
          <option value="">Spacing</option>
          {LINE_SPACINGS.map((spacing) => <option key={spacing} value={spacing}>{spacing}</option>)}
        </select>
        <Divider />
        <Tool label="Bulleted list" onRun={() => exec('insertUnorderedList')} disabled={disabled}><List className="h-3.5 w-3.5" /></Tool>
        <Tool label="Numbered list" onRun={() => exec('insertOrderedList')} disabled={disabled}><ListOrdered className="h-3.5 w-3.5" /></Tool>
        <TablePicker onPick={insertTable} disabled={disabled} />
        <Tool label="Add row below" onRun={() => tableEdit('addRow')} disabled={disabled}><Rows className="h-3.5 w-3.5" /></Tool>
        <Tool label="Add column right" onRun={() => tableEdit('addCol')} disabled={disabled}><Columns className="h-3.5 w-3.5" /></Tool>
        <Tool label="Delete row" onRun={() => tableEdit('removeRow')} disabled={disabled}><Trash2 className="h-3.5 w-3.5" /></Tool>
        <Tool label="Delete column" onRun={() => tableEdit('removeCol')} disabled={disabled}><span className="text-[10px] font-semibold">−C</span></Tool>
        <Tool label="Horizontal line" onRun={() => exec('insertHTML', '<hr style="border:0;border-top:1px solid #1e293b;margin:4px 0"><p><br></p>')} disabled={disabled}><Minus className="h-3.5 w-3.5" /></Tool>
        <Tool label="Insert image" onRun={() => fileRef.current?.click()} disabled={disabled || uploading}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
        </Tool>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onPickImage(e.target.files?.[0])} />
        <span className="flex items-center gap-0.5">
          <Braces className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <select className={cn(SELECT, 'max-w-[9rem]')} aria-label="Insert field" defaultValue="" disabled={disabled} onChange={(e) => { insertField(e.target.value); e.target.value = ''; }}>
            <option value="">Insert field</option>
            {(['Company', 'Document', 'Page'] as const).map((group) => (
              <optgroup key={group} label={group}>
                {LETTERHEAD_FIELDS.filter((field) => field.group === group).map((field) => <option key={field.name} value={field.name}>{field.label}</option>)}
              </optgroup>
            ))}
          </select>
        </span>
        <Divider />
        <Tool label="Clear formatting" onRun={() => exec('removeFormat')} disabled={disabled}><Eraser className="h-3.5 w-3.5" /></Tool>
        <Tool label="Undo" onRun={() => exec('undo')} disabled={disabled}><Undo2 className="h-3.5 w-3.5" /></Tool>
        <Tool label="Redo" onRun={() => exec('redo')} disabled={disabled}><Redo2 className="h-3.5 w-3.5" /></Tool>
      </div>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        onInput={publishSoon}
        onBlur={publishNow}
        onPaste={handlePaste}
        className={cn(
          'keep-light w-full overflow-x-auto rounded-b-md border bg-white px-4 py-3 text-sm text-slate-900',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          DESIGNED_HTML_CLASS,
          minHeightClass,
        )}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        {message ?? 'Paste from Word keeps its formatting. Fields (blue) are filled in when a document prints.'}
      </p>
    </div>
  );
}

const MM = 96 / 25.4;
const PAGE_WIDTH_PX = 210 * MM;
const SAMPLE_META = [{ label: 'Voucher No', value: 'PV-0142' }, { label: 'Date', value: '14 Oct 2026' }];
const SAMPLE_CONTEXT: LetterheadContext = { documentTitle: 'Payment Voucher', documentNumber: 'PV-0142', date: '14 Oct 2026', printedOn: '14 Oct 2026, 10:42', preparedBy: 'A. Kumar', meta: SAMPLE_META };

/** A true-to-size A4 sheet (scaled to fit) with the header, a sample body and the footer. */
export function LetterheadA4Preview({ profile }: { profile: CompanyProfile }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const element = outerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setScale(Math.min(1, element.clientWidth / PAGE_WIDTH_PX)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const custom = profile.design.letterhead.custom;
  const margin = custom.marginMm ?? 12;
  return (
    <div ref={outerRef} className="min-w-0">
      <div style={{ height: 297 * MM * scale }} className="relative overflow-hidden">
        <div
          className="keep-light absolute left-0 top-0 flex origin-top-left flex-col border border-slate-300 bg-white text-slate-900 shadow-md"
          style={{ width: '210mm', height: '297mm', padding: `${margin}mm`, transform: `scale(${scale})` }}
        >
          <div className="pointer-events-none absolute border border-dashed border-sky-300" style={{ inset: `${margin}mm` }} aria-hidden />
          <CompanyLetterhead profile={profile} title="Payment Voucher" meta={SAMPLE_META} />
          <div className="mt-6 space-y-2 text-[13px] text-slate-700">
            <p>Paid to M/s Example Traders towards supply of 11 kV cable, as per PO-2026-118.</p>
            {[0, 1, 2, 3].map((line) => <div key={line} className="h-3 rounded bg-slate-100" style={{ width: `${92 - line * 9}%` }} />)}
          </div>
          <div className="mt-auto pt-6">
            <CompanyFooterLine profile={profile} context={SAMPLE_CONTEXT} />
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        A4, {margin} mm margins. Header on {custom.headerOn === 'every' ? 'every page' : 'the first page'}; footer on {custom.footerOn === 'every' ? 'every page' : custom.footerOn === 'first' ? 'the first page' : 'the last page'}.
      </p>
    </div>
  );
}
