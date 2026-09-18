'use client';

/**
 * Meeting notes with auto-save (§20).
 *
 * ── Why a `contentEditable` surface and not a rich-text library ──────────────────────────────────
 *
 * §20 asks for headings, bullets, numbered lists, checklists, mentions and attachments. A full
 * editor framework (ProseMirror, Slate, Lexical) would give more than that and cost 100–300 KB on a
 * route that is opened while a meeting is starting. `document.execCommand` is formally deprecated
 * but is implemented in every browser this application supports, needs no dependency, and produces
 * exactly the small HTML subset the minutes and the plain-text mirror expect. When this application
 * adopts an editor framework elsewhere, this component is the one place to swap.
 *
 * The output is sanitised with DOMPurify — already a dependency here — on the way *in* to the
 * editor and on the way *out* to Firestore, because notes are rendered back into the minutes and
 * into the published MOM, which several other people read.
 *
 * ── Auto-save ───────────────────────────────────────────────────────────────────────────────────
 *
 * Debounced at three seconds and again on blur, with the last-saved time shown. Notes are typed
 * during a meeting, which is exactly when nobody will remember to press Save, and exactly when a
 * laptop lid gets closed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  CheckSquare,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Save,
  Underline,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { htmlToPlainText, type OfficeHubMeetingNotes } from '@/lib/office-hub';
import { saveMeetingNotes } from '@/lib/office-hub-service';
import { useOfficeHub } from './hooks';

const AUTO_SAVE_MS = 3000;

/** The tags and attributes the notes are allowed to contain. */
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'h2', 'h3',
    'ul', 'ol', 'li', 'blockquote', 'div', 'span', 'a', 'code', 'pre',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'data-mention-id'],
  // Prevents `javascript:` and `data:` URLs in a pasted link.
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
} as const;

async function sanitize(html: string): Promise<string> {
  // Imported on demand: DOMPurify is only needed on the screens that actually edit or render notes.
  const DOMPurify = (await import('dompurify')).default;
  // `String(...)` because DOMPurify's types return `TrustedHTML` when Trusted Types are available.
  // The value is a string at runtime either way, and everything downstream — the plain-text mirror,
  // the MOM builder, the export — needs a string.
  return String(DOMPurify.sanitize(html, SANITIZE_CONFIG as never));
}

export function MeetingNotesEditor({
  meetingId,
  meetingTitle,
  notes,
  canEdit,
}: {
  meetingId: string;
  meetingTitle: string;
  notes: OfficeHubMeetingNotes | null;
  canEdit: boolean;
}) {
  const { actor, settings } = useOfficeHub();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  /** The HTML last written, so an incoming snapshot of our own save does not reset the caret. */
  const lastSavedHtmlRef = useRef<string>('');

  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [safeInitial, setSafeInitial] = useState<string | null>(null);

  const incoming = notes?.html ?? '';

  useEffect(() => {
    let cancelled = false;
    void sanitize(incoming).then((clean) => {
      if (!cancelled) setSafeInitial(clean);
    });
    return () => {
      cancelled = true;
    };
  }, [incoming]);

  /**
   * Seed the editor, but never while the user is mid-edit.
   *
   * `contentEditable` is uncontrolled by necessity — writing to `innerHTML` on every render would
   * destroy the caret position on every keystroke. So the DOM is seeded once, and re-seeded only
   * when a *different* body arrives from the server than the one we last sent, which is how a
   * co-author's change appears without eating what you are typing.
   */
  useEffect(() => {
    const element = editorRef.current;
    if (!element || safeInitial == null) return;
    if (dirtyRef.current) return;
    if (safeInitial === lastSavedHtmlRef.current) return;
    if (element.innerHTML === safeInitial) return;
    element.innerHTML = safeInitial;
  }, [safeInitial]);

  const persist = useCallback(
    async (html: string) => {
      if (!actor) return;
      setStatus('saving');
      try {
        const clean = await sanitize(html);
        await saveMeetingNotes(actor, meetingId, clean, {
          notifyMentions: true,
          meetingTitle,
          settings,
        });
        lastSavedHtmlRef.current = clean;
        dirtyRef.current = false;
        setSavedAt(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
        setStatus('saved');
      } catch (error) {
        console.error('[office-hub] Auto-save failed', error);
        // Left dirty on purpose, so the next keystroke or the Save button retries rather than the
        // work being silently abandoned.
        setStatus('error');
      }
    },
    [actor, meetingId, meetingTitle, settings],
  );

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setStatus('idle');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const html = editorRef.current?.innerHTML ?? '';
      void persist(html);
    }, AUTO_SAVE_MS);
  }, [persist]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  /**
   * Flush on unmount and on tab hide.
   *
   * Navigating away from a live meeting to raise a task is the single most common way to lose the
   * last few seconds of notes, and the debounce guarantees there are always a few seconds to lose.
   */
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current) return;
      const html = editorRef.current?.innerHTML ?? '';
      void persist(html);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [persist]);

  const exec = (command: string, value?: string) => {
    if (!canEdit) return;
    editorRef.current?.focus();
    // Deprecated but universally implemented; see the note at the top of this file.
    document.execCommand(command, false, value);
    scheduleSave();
  };

  const insertChecklistItem = () => {
    if (!canEdit) return;
    // A checklist is an unordered list whose items start with a box character. Plain, portable, and
    // it survives the round trip into the printed minutes, which a custom element would not.
    exec('insertUnorderedList');
    document.execCommand('insertText', false, '☐ ');
    scheduleSave();
  };

  const wordCount = useMemo(() => {
    const text = htmlToPlainText(notes?.html ?? '');
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
  }, [notes?.html]);

  if (!canEdit) {
    return (
      <div className="space-y-2">
        {notes?.html ? (
          <div
            className="prose prose-sm max-w-none rounded-lg border bg-white p-3 text-slate-800 prose-headings:text-slate-800"
            // Sanitised on write and again on read, because a stored note predates any given
            // version of the sanitiser configuration.
            dangerouslySetInnerHTML={{ __html: safeInitial ?? '' }}
          />
        ) : (
          <p className="rounded-lg border border-dashed bg-white/60 p-6 text-center text-sm text-muted-foreground">
            No discussion notes have been recorded for this meeting.
          </p>
        )}
        {notes?.lastSavedByName && (
          <p className="text-[11px] text-muted-foreground">
            Last updated by {notes.lastSavedByName}
            {wordCount ? ` · ${wordCount} words` : ''}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-slate-50 p-1" role="toolbar" aria-label="Formatting">
        <ToolbarButton label="Bold" icon={Bold} onClick={() => exec('bold')} />
        <ToolbarButton label="Italic" icon={Italic} onClick={() => exec('italic')} />
        <ToolbarButton label="Underline" icon={Underline} onClick={() => exec('underline')} />
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <ToolbarButton label="Heading" icon={Heading2} onClick={() => exec('formatBlock', '<h3>')} />
        <ToolbarButton label="Bulleted list" icon={List} onClick={() => exec('insertUnorderedList')} />
        <ToolbarButton label="Numbered list" icon={ListOrdered} onClick={() => exec('insertOrderedList')} />
        <ToolbarButton label="Checklist item" icon={CheckSquare} onClick={insertChecklistItem} />

        <span className="ml-auto flex items-center gap-2 px-1.5">
          <span className="text-[11px] text-muted-foreground" aria-live="polite">
            {status === 'saving'
              ? 'Saving…'
              : status === 'error'
                ? 'Not saved — will retry'
                : savedAt
                  ? `Saved ${savedAt}`
                  : notes?.lastSavedByName
                    ? `Last saved by ${notes.lastSavedByName}`
                    : 'Not saved yet'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() => void persist(editorRef.current?.innerHTML ?? '')}
          >
            {status === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save now
          </Button>
        </span>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Meeting notes"
        onInput={scheduleSave}
        onBlur={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          if (dirtyRef.current) void persist(editorRef.current?.innerHTML ?? '');
        }}
        onPaste={(event) => {
          // Paste as plain text: a paste out of Word brings a kilobyte of inline styles per
          // paragraph, and the sanitiser would strip most of it anyway — leaving the user with
          // mangled formatting rather than clean text.
          event.preventDefault();
          const text = event.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          scheduleSave();
        }}
        className={cn(
          'prose prose-sm max-w-none min-h-[14rem] rounded-lg border bg-white p-3 text-slate-800',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
          'prose-headings:text-slate-800 prose-headings:text-base',
        )}
      />

      <p className="text-[11px] text-muted-foreground">
        Notes save automatically. Type <code className="rounded bg-slate-100 px-1">@</code> and a
        name in a task comment to notify somebody; meeting notes are visible to every participant.
      </p>
    </div>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
