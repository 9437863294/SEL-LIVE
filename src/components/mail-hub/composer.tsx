'use client';

/**
 * The composer: new mail, reply, reply all, forward, and reopening a draft.
 *
 * It keeps the user's body, the signature and the quoted message **apart** and sends the three as
 * separate fields; the server joins them (`assembleOutgoingHtml`). The From list offers only the
 * mailbox's own address and the send-as identities its provider has verified; a shared mailbox's
 * address is offered only inside that mailbox, and only when the membership can send.
 *
 * Drafts autosave a few seconds after typing stops, into the ERP (and, best-effort, the provider's
 * Drafts folder). Nothing is sent except by pressing Send or Schedule.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, Loader2, Paperclip, Send, Trash2, X } from 'lucide-react';

import { EApprovalRichTextEditor } from '@/components/e-approval/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { mailApi, type ComposePayload } from '@/lib/mail-hub/client';
import type { MailAttachmentMeta, MailTemplate } from '@/lib/mail-hub/model';
import { applyTemplate, formatAddress, parseAddressList } from '@/lib/mail-hub/rules';
import { cn } from '@/lib/utils';
import { useMailHub } from './hooks';
import { MailFrame } from './message-body';
import { formatBytes, fromLocalInput, toLocalInput } from './ui';

interface Upload {
  id: string;
  filename: string;
  size: number;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
}

const AUTOSAVE_MS = 4_000;

export function Composer() {
  const { toast } = useToast();
  const { data, composer: request, closeComposer, bump } = useMailHub();
  const [outboundId, setOutboundId] = useState<string | null>(request?.outboundId ?? null);
  const [accountId, setAccountId] = useState<string>('');
  const [fromAddress, setFromAddress] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState(request?.bodyHtml ?? '');
  const [signatureId, setSignatureId] = useState<string | null>(null);
  const [quotedHtml, setQuotedHtml] = useState<string | null>(null);
  const [includeQuote, setIncludeQuote] = useState(true);
  const [forwarded, setForwarded] = useState<MailAttachmentMeta[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [scheduleAt, setScheduleAt] = useState(toLocalInput(new Date(Date.now() + 3_600_000).toISOString()));
  const [busy, setBusy] = useState<'send' | 'schedule' | 'draft' | null>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mode = request?.mode ?? 'new';
  const sourceMessageId = request?.sourceMessageId ?? null;
  const aiAssisted = Boolean(request?.aiAssisted);

  const account = data?.accounts.find((entry) => entry.id === accountId) ?? null;
  const shared = account?.kind === 'shared';
  const sendable = useMemo(() => (data?.accounts ?? []).filter((entry) => entry.kind === 'personal' && entry.access.canSend), [data?.accounts]);
  const fromOptions = useMemo(() => {
    if (!account) return [];
    if (shared) return [{ address: fromAddress, label: `${account.sharedMailboxName ?? account.emailAddress} <${fromAddress}>` }];
    return [
      { address: account.emailAddress, label: account.displayName ? `${account.displayName} <${account.emailAddress}>` : account.emailAddress },
      ...account.identities.filter((identity) => identity.verified).map((identity) => ({ address: identity.address, label: identity.name ? `${identity.name} <${identity.address}>` : identity.address })),
    ];
  }, [account, shared, fromAddress]);

  // ── initialise ──
  useEffect(() => {
    if (!request || !data) return;
    let cancelled = false;
    const init = async () => {
      try {
        if (request.outboundId) {
          const { outbound } = await mailApi.outboundOne(request.outboundId);
          if (cancelled) return;
          setAccountId(outbound.sourceAccountId ?? outbound.accountId);
          setFromAddress(outbound.fromAddress);
          setTo(outbound.to.map(formatAddress).join(', '));
          setCc(outbound.cc.map(formatAddress).join(', '));
          setBcc(outbound.bcc.map(formatAddress).join(', '));
          setShowCc(Boolean(outbound.cc.length || outbound.bcc.length));
          setSubject(outbound.subject);
          setBodyHtml(outbound.composerBodyHtml ?? '');
          setSignatureId(outbound.signatureId);
          setIncludeQuote(outbound.includeQuote);
          setUploads(outbound.attachments.map((entry) => ({ id: entry.uploadId, filename: entry.filename, size: entry.size, status: 'ready' as const })));
          if (outbound.sourceMessageId && outbound.mode !== 'new') {
            const prefill = await mailApi.prefill(outbound.sourceMessageId, outbound.mode as 'reply' | 'replyAll' | 'forward').catch(() => null);
            if (!cancelled && prefill) setQuotedHtml(prefill.quotedHtml);
          }
        } else if (request.mode !== 'new' && request.sourceMessageId) {
          const prefill = await mailApi.prefill(request.sourceMessageId, request.mode);
          if (cancelled) return;
          setAccountId(request.accountId ?? '');
          setFromAddress(prefill.fromAddress);
          setTo(prefill.to.map(formatAddress).join(', '));
          setCc(prefill.cc.map(formatAddress).join(', '));
          setShowCc(prefill.cc.length > 0);
          setSubject(prefill.subject);
          setQuotedHtml(prefill.quotedHtml);
          setForwarded(prefill.forwardableAttachments);
        } else {
          const initial = sendable.find((entry) => entry.id === request.accountId) ?? sendable[0];
          setAccountId(initial?.id ?? '');
          setFromAddress(initial?.emailAddress ?? '');
          if (request.to) setTo(request.to);
          if (request.subject) setSubject(request.subject);
        }
      } catch (error) {
        toast({ variant: 'destructive', title: 'The composer could not open', description: error instanceof Error ? error.message : undefined });
        closeComposer();
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    void init();
    mailApi.templates().then((result) => !cancelled && setTemplates(result.templates)).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default signature for the chosen account, unless the draft already had one.
  useEffect(() => {
    if (!ready || !data || request?.outboundId) return;
    const personal = data.signatures.filter((signature) => signature.scope === 'personal');
    const pick = personal.find((signature) => signature.defaultForAccountId === accountId) ?? personal.find((signature) => signature.defaultForAccountId === '*') ?? null;
    setSignatureId(pick?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, accountId]);

  const signatureHtml = data?.signatures.find((signature) => signature.id === signatureId)?.html ?? null;

  const payload = useCallback((): ComposePayload | null => {
    if (!accountId) return null;
    return {
      outboundId,
      accountId,
      sharedMailboxId: account?.sharedMailboxId ?? null,
      fromAddress,
      to: parseAddressList(to).addresses,
      cc: parseAddressList(cc).addresses,
      bcc: parseAddressList(bcc).addresses,
      subject,
      bodyHtml,
      signatureId,
      includeQuote,
      mode,
      sourceMessageId: sourceMessageId,
      uploadIds: uploads.filter((upload) => upload.status === 'ready').map((upload) => upload.id),
      scheduledAt: null,
      aiAssisted,
    };
  }, [accountId, account?.sharedMailboxId, outboundId, fromAddress, to, cc, bcc, subject, bodyHtml, signatureId, includeQuote, mode, sourceMessageId, uploads, aiAssisted]);

  const invalid = [to, cc, bcc].flatMap((value) => parseAddressList(value).invalid);

  const submit = async (intent: 'draft' | 'send' | 'schedule', quiet = false) => {
    const body = payload();
    if (!body) return;
    if (intent !== 'draft' && invalid.length) {
      toast({ variant: 'destructive', title: 'Check the recipients', description: `Not valid: ${invalid.join(', ')}` });
      return;
    }
    if (uploads.some((upload) => upload.status === 'uploading')) {
      toast({ title: 'Attachments are still uploading' });
      return;
    }
    setBusy(intent);
    try {
      const scheduledAt = intent === 'schedule' ? fromLocalInput(scheduleAt) : null;
      const result = await mailApi.compose({ ...body, scheduledAt, intent });
      setOutboundId(result.outbound.id);
      setDirty(false);
      if (intent === 'draft') {
        setSavedAt(new Date().toISOString());
        if (!quiet) toast({ title: 'Draft saved' });
        return;
      }
      if (result.result?.status === 'failed') {
        toast({ variant: 'destructive', title: 'Not sent', description: result.message });
        return;
      }
      toast({ title: intent === 'schedule' ? 'Scheduled' : result.message });
      bump();
      closeComposer();
    } catch (error) {
      if (!quiet) toast({ variant: 'destructive', title: intent === 'draft' ? 'Draft not saved' : 'Not sent', description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  // Autosave.
  useEffect(() => {
    if (!ready || !dirty || busy) return;
    const timer = setTimeout(() => {
      const hasContent = to.trim() || subject.trim() || bodyHtml.replace(/<[^>]+>/g, '').trim();
      if (hasContent) void submit('draft', true);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dirty, to, cc, bcc, subject, bodyHtml, signatureId, includeQuote, uploads]);

  const touch = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
  };

  const upload = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const temp = `tmp-${Math.random().toString(36).slice(2)}`;
      setUploads((current) => [...current, { id: temp, filename: file.name, size: file.size, status: 'uploading' }]);
      try {
        const { upload: stored } = await mailApi.upload(file);
        setUploads((current) => current.map((entry) => (entry.id === temp ? { id: stored.id, filename: stored.filename, size: stored.size, status: 'ready' } : entry)));
        setDirty(true);
      } catch (error) {
        setUploads((current) => current.map((entry) => (entry.id === temp ? { ...entry, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' } : entry)));
      }
    }
  };

  const insertTemplate = (template: MailTemplate) => {
    const first = parseAddressList(to).addresses[0];
    const html = applyTemplate(template.html, {
      recipientName: first?.name ?? null,
      recipientEmail: first?.address ?? null,
      senderName: data?.user.name ?? null,
      senderEmail: fromAddress,
      subject,
      date: new Date().toLocaleDateString('en-IN', { dateStyle: 'long' }),
    });
    setBodyHtml((current) => `${current}${html}`);
    if (!subject.trim() && template.subject) setSubject(template.subject);
    setDirty(true);
  };

  const close = async () => {
    if (dirty && (to.trim() || subject.trim() || bodyHtml.trim())) await submit('draft', true);
    closeComposer();
  };

  const discard = async () => {
    if (outboundId) await mailApi.discard(outboundId).catch(() => {});
    closeComposer();
  };

  if (!request) return null;
  const title = mode === 'reply' ? 'Reply' : mode === 'replyAll' ? 'Reply all' : mode === 'forward' ? 'Forward' : outboundId ? 'Draft' : 'New message';

  return (
    <Dialog open onOpenChange={(open) => !open && void close()}>
      <DialogContent
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[90vh] sm:max-h-[90vh] sm:w-[min(900px,95vw)] sm:max-w-[900px] sm:rounded-xl"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            void submit('send');
          }
        }}
      >
        <DialogHeader className="border-b px-4 py-2.5 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {aiAssisted ? 'Started from an AI suggestion — read it through before sending. ' : ''}
            {savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'Ctrl+Enter to send'}
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="space-y-1 border-b px-4 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-muted-foreground">From</span>
                {mode === 'new' && !outboundId && !shared ? (
                  <Select
                    value={`${accountId}|${fromAddress}`}
                    onValueChange={(value) => {
                      const [nextAccount, nextFrom] = value.split('|');
                      setAccountId(nextAccount);
                      setFromAddress(nextFrom);
                      setDirty(true);
                    }}
                  >
                    <SelectTrigger className="h-8 flex-1 border-0 px-1 shadow-none focus:ring-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sendable.flatMap((entry) => [
                        <SelectItem key={`${entry.id}|${entry.emailAddress}`} value={`${entry.id}|${entry.emailAddress}`}>{entry.emailAddress}</SelectItem>,
                        ...entry.identities.filter((identity) => identity.verified).map((identity) => (
                          <SelectItem key={`${entry.id}|${identity.address}`} value={`${entry.id}|${identity.address}`}>{identity.name ? `${identity.name} <${identity.address}>` : identity.address} (via {entry.emailAddress})</SelectItem>
                        )),
                      ])}
                    </SelectContent>
                  </Select>
                ) : fromOptions.length > 1 && !shared ? (
                  <Select value={fromAddress} onValueChange={touch(setFromAddress)}>
                    <SelectTrigger className="h-8 flex-1 border-0 px-1 shadow-none focus:ring-0"><SelectValue /></SelectTrigger>
                    <SelectContent>{fromOptions.map((option) => <SelectItem key={option.address} value={option.address}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <span className="truncate px-1">{fromOptions[0]?.label ?? fromAddress}</span>
                )}
              </div>
              {(
                [
                  ['To', to, setTo, true],
                  ['Cc', cc, setCc, showCc],
                  ['Bcc', bcc, setBcc, showCc],
                ] as const
              ).map(([label, value, setter, visible]) =>
                visible ? (
                  <div key={label} className="flex items-center gap-2">
                    <label className="w-14 shrink-0 text-muted-foreground" htmlFor={`compose-${label}`}>{label}</label>
                    <Input
                      id={`compose-${label}`}
                      value={value}
                      onChange={(event) => touch(setter as (v: string) => void)(event.target.value)}
                      className={cn('h-8 border-0 px-1 shadow-none focus-visible:ring-0', parseAddressList(value).invalid.length && 'text-rose-700')}
                      placeholder={label === 'To' ? 'name@example.com, …' : ''}
                      autoFocus={label === 'To' && mode !== 'reply' && mode !== 'replyAll'}
                    />
                    {label === 'To' && !showCc && (
                      <button type="button" className="shrink-0 text-xs text-indigo-700" onClick={() => setShowCc(true)}>Cc/Bcc</button>
                    )}
                  </div>
                ) : null,
              )}
              <div className="flex items-center gap-2">
                <label className="w-14 shrink-0 text-muted-foreground" htmlFor="compose-subject">Subject</label>
                <Input id="compose-subject" value={subject} onChange={(event) => touch(setSubject)(event.target.value)} className="h-8 border-0 px-1 shadow-none focus-visible:ring-0" />
              </div>
            </div>

            <div className="flex-1 px-4 py-3">
              <EApprovalRichTextEditor value={bodyHtml} onChange={touch(setBodyHtml)} placeholder="Write your message…" ariaLabel="Message body" className="min-h-[220px]" />

              {signatureHtml && (
                <div className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs text-slate-500">
                  <p className="mb-1 font-medium">Signature</p>
                  <MailFrame html={signatureHtml} allowRemote />
                </div>
              )}

              {quotedHtml && (
                <details className="mt-2 rounded-md border px-3 py-2 text-xs" open={false}>
                  <summary className="flex cursor-pointer items-center gap-2 text-slate-600">
                    <Checkbox checked={includeQuote} onCheckedChange={(checked) => touch(setIncludeQuote)(Boolean(checked))} onClick={(event) => event.stopPropagation()} aria-label="Include the quoted message" />
                    Include the {mode === 'forward' ? 'forwarded' : 'quoted'} message <ChevronDown className="h-3 w-3" />
                  </summary>
                  <div className="mt-2 opacity-80"><MailFrame html={quotedHtml} allowRemote={false} /></div>
                </details>
              )}

              {(uploads.length > 0 || forwarded.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {forwarded.map((entry) => (
                    <span key={entry.id} className="flex items-center gap-1.5 rounded-lg border bg-slate-50 px-2 py-1 text-xs">
                      <Paperclip className="h-3.5 w-3.5 text-slate-500" /> {entry.filename} <span className="text-muted-foreground">{formatBytes(entry.size)} · forwarded</span>
                    </span>
                  ))}
                  {uploads.map((entry) => (
                    <span key={entry.id} className={cn('flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs', entry.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'bg-white')} title={entry.error}>
                      {entry.status === 'uploading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5 text-slate-500" />}
                      <span className="max-w-[12rem] truncate">{entry.filename}</span>
                      <span className="text-muted-foreground">{entry.status === 'error' ? entry.error : formatBytes(entry.size)}</span>
                      <button type="button" aria-label={`Remove ${entry.filename}`} onClick={() => { setUploads((current) => current.filter((item) => item.id !== entry.id)); setDirty(true); }}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t bg-slate-50/80 px-3 py-2">
          <div className="flex overflow-hidden rounded-md">
            <Button onClick={() => submit('send')} disabled={!ready || Boolean(busy) || !accountId} className="gap-1.5 rounded-r-none">
              {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button disabled={!ready || Boolean(busy)} className="rounded-l-none border-l border-white/30 px-2" aria-label="Schedule send">
                  <CalendarClock className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-2">
                <p className="text-sm font-medium">Schedule send</p>
                <Input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
                <Button className="w-full" onClick={() => submit('schedule')} disabled={Boolean(busy)}>
                  {busy === 'schedule' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Schedule
                </Button>
              </PopoverContent>
            </Popover>
          </div>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { void upload(event.target.files); event.target.value = ''; }} />
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => fileInput.current?.click()} disabled={!ready}>
            <Paperclip className="h-4 w-4" /> Attach
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={!ready}>Signature</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => touch(setSignatureId)(null)}>No signature</DropdownMenuItem>
              <DropdownMenuSeparator />
              {(data?.signatures ?? []).map((signature) => (
                <DropdownMenuItem key={signature.id} onClick={() => touch(setSignatureId)(signature.id)}>
                  {signature.name}{signature.scope === 'department' ? ` · ${signature.departmentName ?? 'department'}` : ''}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {templates.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" disabled={!ready}>Templates</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-80 overflow-y-auto">
                <DropdownMenuLabel>Insert a template</DropdownMenuLabel>
                {templates.map((template) => <DropdownMenuItem key={template.id} onClick={() => insertTemplate(template)}>{template.name}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => submit('draft')} disabled={!ready || Boolean(busy)}>
              {busy === 'draft' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save draft
            </Button>
            <Button variant="ghost" size="icon" aria-label="Discard draft" onClick={discard}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
