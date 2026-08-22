'use client';

import { useMemo, useState } from 'react';
import { AtSign, Loader2, MessageSquare, Pencil, Reply, Undo2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { EApprovalComment } from '@/lib/e-approval';
import {
  addEApprovalComment,
  editEApprovalComment,
  retractEApprovalComment,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import { EApprovalEmptyState } from './shared';
import { formatEApprovalDateTime, type EApprovalDirectory } from './hooks';

const initials = (name: string | undefined) =>
  (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** Turns `@Name` into a resolved user id list, so notification does not re-parse the text later. */
function extractMentions(body: string, directory: EApprovalDirectory): string[] {
  const found = new Set<string>();
  for (const user of directory.users) {
    if (!user.name) continue;
    // Whole-name match: partial matching on a first name would mention the wrong Sarika.
    if (new RegExp(`@${user.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(body)) {
      found.add(user.id);
    }
  }
  return Array.from(found);
}

/**
 * The comment thread of spec section 7.
 *
 * Comments cannot be deleted once posted — an edit appends to the history and the previous text stays
 * on the record, and a retraction strikes the entry through rather than removing it. An approval
 * thread that can be quietly rewritten is not evidence of anything, which is the whole reason the
 * discussion lives on the file instead of in chat.
 */
export function CommentThread({
  approvalId,
  comments,
  serviceActor,
  directory,
  canComment,
  onChanged,
}: {
  approvalId: string;
  comments: EApprovalComment[];
  serviceActor: EApprovalServiceActor | null;
  directory: EApprovalDirectory;
  canComment: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<EApprovalComment | null>(null);
  const [editing, setEditing] = useState<EApprovalComment | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busy, setBusy] = useState(false);

  const threads = useMemo(() => {
    const roots = comments.filter((comment) => !comment.parentCommentId);
    const repliesByParent = new Map<string, EApprovalComment[]>();
    comments
      .filter((comment) => comment.parentCommentId)
      .forEach((comment) => {
        const key = comment.parentCommentId as string;
        repliesByParent.set(key, [...(repliesByParent.get(key) ?? []), comment]);
      });
    return roots.map((root) => ({ root, replies: repliesByParent.get(root.id) ?? [] }));
  }, [comments]);

  const post = async () => {
    if (!serviceActor || !body.trim()) return;
    setBusy(true);
    try {
      await addEApprovalComment(
        approvalId,
        {
          body,
          parentCommentId: replyTo?.id ?? null,
          mentionUserIds: extractMentions(body, directory),
        },
        serviceActor,
      );
      setBody('');
      setReplyTo(null);
      onChanged();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Comment not saved',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!serviceActor || !editing || !editBody.trim()) return;
    setBusy(true);
    try {
      await editEApprovalComment(editing.id, editBody, serviceActor);
      setEditing(null);
      onChanged();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Edit not saved',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  const retract = async (comment: EApprovalComment) => {
    if (!serviceActor) return;
    setBusy(true);
    try {
      await retractEApprovalComment(comment.id, 'Retracted by author', serviceActor);
      onChanged();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Not retracted',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  const renderComment = (comment: EApprovalComment, isReply = false) => {
    const mine = comment.authorId === serviceActor?.userId;
    const edited = (comment.editHistory?.length ?? 0) > 0;
    return (
      <div key={comment.id} className={cn('flex gap-2.5', isReply && 'ml-8 border-l-2 border-muted pl-3')}>
        <Avatar className="mt-0.5 h-7 w-7 shrink-0">
          <AvatarFallback className="bg-sky-100 text-[10px] text-sky-700">
            {initials(comment.authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold">{comment.authorName || 'User'}</span>
            {comment.authorDesignation && (
              <span className="text-[11px] text-muted-foreground">{comment.authorDesignation}</span>
            )}
            <span className="text-[11px] text-muted-foreground">
              {formatEApprovalDateTime(comment.createdAt ? new Date(comment.createdAt.toMillis()).toISOString() : null)}
            </span>
            {comment.stepName && (
              <Badge variant="outline" className="text-[10px]">
                {comment.stepName}
              </Badge>
            )}
            {comment.version != null && (
              <Badge variant="outline" className="text-[10px]">
                v{comment.version}
              </Badge>
            )}
            {edited && (
              <span className="text-[10px] italic text-muted-foreground" title="Edited — previous text is retained">
                edited
              </span>
            )}
          </div>

          {editing?.id === comment.id ? (
            <div className="mt-1 space-y-1.5">
              <Textarea value={editBody} onChange={(event) => setEditBody(event.target.value)} rows={3} className="text-sm" />
              <div className="flex gap-1.5">
                <Button size="sm" className="h-7 text-xs" onClick={() => void saveEdit()} disabled={busy}>
                  Save
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p
              className={cn(
                'mt-0.5 whitespace-pre-wrap break-words text-sm',
                comment.retracted && 'text-muted-foreground line-through',
              )}
            >
              {comment.body}
            </p>
          )}

          {comment.retracted && (
            <p className="mt-0.5 text-[11px] italic text-muted-foreground">
              Retracted{comment.retractedReason ? ` — ${comment.retractedReason}` : ''}
            </p>
          )}

          {(comment.mentionUserIds?.length ?? 0) > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {comment.mentionUserIds?.map((userId) => (
                <Badge key={userId} variant="secondary" className="gap-0.5 text-[10px]">
                  <AtSign className="h-2.5 w-2.5" />
                  {directory.userById.get(userId)?.name || userId}
                </Badge>
              ))}
            </div>
          )}

          {canComment && !comment.retracted && (
            <div className="mt-1 flex flex-wrap gap-1">
              {!isReply && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-1.5 text-[11px]"
                  onClick={() => setReplyTo(comment)}
                >
                  <Reply className="h-3 w-3" /> Reply
                </Button>
              )}
              {mine && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-1.5 text-[11px]"
                    onClick={() => {
                      setEditing(comment);
                      setEditBody(comment.body);
                    }}
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                    onClick={() => void retract(comment)}
                    disabled={busy}
                  >
                    <Undo2 className="h-3 w-3" /> Retract
                  </Button>
                </>
              )}
            </div>
          )}

          {edited && comment.editHistory && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-muted-foreground hover:underline">
                Edit history ({comment.editHistory.length})
              </summary>
              <div className="mt-1 space-y-1 border-l-2 border-dashed border-muted pl-2">
                {comment.editHistory.map((entry, index) => (
                  <p key={index} className="text-[11px] text-muted-foreground">
                    <span className="font-medium">{formatEApprovalDateTime(entry.at)}</span> — “{entry.previousBody}”
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {canComment && (
        <div className="rounded-lg border bg-muted/20 p-2.5">
          {replyTo && (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded bg-background px-2 py-1 text-[11px]">
              <span className="min-w-0 truncate text-muted-foreground">
                Replying to <span className="font-medium">{replyTo.authorName}</span>: “{replyTo.body.slice(0, 60)}”
              </span>
              <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => setReplyTo(null)}>
                Cancel
              </Button>
            </div>
          )}
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            placeholder="Add a comment. Type @ and a full name to notify somebody directly."
            className="text-sm"
          />
          <div className="mt-1.5 flex justify-end">
            <Button size="sm" className="h-8 gap-1.5" onClick={() => void post()} disabled={busy || !body.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
              Comment
            </Button>
          </div>
        </div>
      )}

      {threads.length === 0 ? (
        <EApprovalEmptyState
          icon={MessageSquare}
          title="No comments yet"
          description="Questions, clarifications and observations recorded here stay with the approval permanently."
        />
      ) : (
        <div className="space-y-4">
          {threads.map(({ root, replies }) => (
            <div key={root.id} className="space-y-2">
              {renderComment(root)}
              {replies.map((reply) => renderComment(reply, true))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
