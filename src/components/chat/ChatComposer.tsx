'use client';

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Loader2, Mic, Paperclip, SendHorizontal, Smile, Square, X } from 'lucide-react';
import type { ChatMessage } from '@/lib/chat';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const EMOJIS = ['😀', '😂', '😊', '😍', '🥳', '😎', '😢', '😡', '👍', '👏', '🙏', '❤️', '🔥', '✅', '🎉', '💯', '📌', '🤝'];

interface ChatComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  replyingTo: ChatMessage | null;
  editingMessage: ChatMessage | null;
  onCancelContext: () => void;
  onSend: () => Promise<void>;
  onFilesSelected: (files: File[], voiceDurationSeconds?: number) => Promise<void>;
  isSending: boolean;
  uploadProgress: number | null;
}

export function ChatComposer({
  draft,
  onDraftChange,
  replyingTo,
  editingMessage,
  onCancelContext,
  onSend,
  onFilesSelected,
  isSending,
  uploadProgress,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (replyingTo || editingMessage) textareaRef.current?.focus();
  }, [editingMessage, replyingTo]);

  useEffect(() => {
    if (!isRecording) return;
    const interval = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(interval);
  }, [isRecording]);

  useEffect(() => () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (draft.trim()) void onSend();
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length) void onFilesSelected(files);
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Voice recording is not supported on this device.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recordingStartRef.current = Date.now();
      setRecordingSeconds(0);
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        const duration = Math.max(1, Math.round((Date.now() - recordingStartRef.current) / 1000));
        const mimeType = recorder.mimeType || 'audio/webm';
        const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File(chunksRef.current, `voice-note-${Date.now()}.${extension}`, { type: mimeType });
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setIsRecording(false);
        void onFilesSelected([file], duration);
      });
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      toast({
        title: 'Microphone unavailable',
        description: error instanceof Error ? error.message : 'Allow microphone access to record a voice note.',
        variant: 'destructive',
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  };

  const contextMessage = editingMessage || replyingTo;
  return (
    <div className="border-t bg-background/95 px-3 py-3 backdrop-blur sm:px-6 sm:py-4">
      <div className="mx-auto max-w-3xl">
        {contextMessage && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border-l-4 border-primary bg-muted/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-primary">
                {editingMessage ? 'Edit message' : `Replying to ${contextMessage.senderName}`}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {contextMessage.text || contextMessage.attachments?.[0]?.name || 'Attachment'}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancelContext}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {uploadProgress !== null && (
          <div className="mb-2 rounded-xl border bg-muted/50 px-3 py-2">
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Uploading attachment…</span><span>{Math.round(uploadProgress)}%</span>
            </div>
            <Progress value={uploadProgress} className="h-1.5" />
          </div>
        )}

        <div className="flex items-end gap-1 rounded-2xl border bg-muted/30 p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
            onChange={handleFileChange}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending || uploadProgress !== null || Boolean(editingMessage)}
            aria-label="Attach files"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-xl" aria-label="Add emoji">
                <Smile className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="grid w-64 grid-cols-6 gap-1 p-2">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="rounded-md p-1.5 text-xl hover:bg-muted"
                  onClick={() => onDraftChange(`${draft}${emoji}`)}
                >
                  {emoji}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          {isRecording ? (
            <div className="flex min-h-10 flex-1 items-center gap-3 px-2 text-sm">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="font-medium text-red-600">Recording {formatDuration(recordingSeconds)}</span>
              <span className="text-xs text-muted-foreground">Tap stop to send</span>
            </div>
          ) : (
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value.slice(0, 4000))}
              onKeyDown={handleKeyDown}
              placeholder={editingMessage ? 'Edit your message…' : 'Write a message…'}
              rows={1}
              className="max-h-32 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 shadow-none focus-visible:ring-0"
            />
          )}

          {!draft.trim() && !editingMessage ? (
            <Button
              size="icon"
              variant={isRecording ? 'destructive' : 'ghost'}
              className={cn('h-10 w-10 shrink-0 rounded-xl', !isRecording && 'text-primary')}
              disabled={isSending || uploadProgress !== null}
              onClick={() => void (isRecording ? stopRecording() : startRecording())}
              aria-label={isRecording ? 'Stop and send voice note' : 'Record voice note'}
            >
              {isRecording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl"
              disabled={!draft.trim() || isSending || uploadProgress !== null}
              onClick={() => void onSend()}
              aria-label={editingMessage ? 'Save edited message' : 'Send message'}
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
            </Button>
          )}
        </div>
        <p className="mt-1.5 hidden text-right text-[10px] text-muted-foreground sm:block">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
