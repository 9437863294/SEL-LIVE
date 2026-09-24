'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

import { Conversation } from '@/components/mail-hub/conversation';
import { ThreadList } from '@/components/mail-hub/thread-list';
import { EmptyState, ErrorNotice, PageHeader, Spinner } from '@/components/mail-hub/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { mailApi, type ThreadSummary } from '@/lib/mail-hub/client';
import { cn } from '@/lib/utils';

/**
 * Search every mailbox you can read. Local search covers subjects, senders, recipients and
 * snippets; "Search message text" also asks each provider to search full bodies.
 */
export default function MailSearchPage() {
  const router = useRouter();
  const pathname = usePathname() ?? '/mail/search';
  const params = useSearchParams();
  const [query, setQuery] = useState(params?.get('q') ?? '');
  const [deep, setDeep] = useState(params?.get('scope') === 'provider');
  const [results, setResults] = useState<ThreadSummary[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = params?.get('thread') ?? null;

  const run = async (text = query, scope = deep) => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const result = await mailApi.search({ q: text.trim(), scope: scope ? 'provider' : 'local' });
      setResults(result.threads);
      setNotes(result.notes);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (params?.get('q')) void run(params.get('q') ?? '', params.get('scope') === 'provider');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    router.replace(`${pathname}?q=${encodeURIComponent(query)}${deep ? '&scope=provider' : ''}`, { scroll: false });
    void run();
  };

  return (
    <div className="space-y-3">
      <PageHeader title="Search" description="Try: invoice from:vendor.com has:attachment after:2026-01-01" />
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mail" className="bg-white sm:max-w-xl" aria-label="Search mail" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <Switch checked={deep} onCheckedChange={setDeep} /> Search message text
        </label>
        <Button type="submit" disabled={loading}><Search className="mr-2 h-4 w-4" /> Search</Button>
      </form>
      {notes.map((note) => <p key={note} className="text-xs text-amber-700">{note}</p>)}
      {error && <ErrorNotice message={error} />}
      <div className="grid min-h-[60vh] grid-cols-1 overflow-hidden rounded-xl border bg-white lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <div className={cn('max-h-[calc(100vh-16rem)] overflow-y-auto border-r', selected && 'hidden lg:block')}>
          {loading && <div className="px-3"><Spinner label="Searching…" /></div>}
          {!loading && results?.length === 0 && <div className="p-6"><EmptyState title="No matches" body={deep ? undefined : 'Turn on “Search message text” to search full bodies as well.'} /></div>}
          {!loading && results && (
            <ThreadList
              threads={results}
              selectedId={selected}
              onSelect={(thread) => router.replace(`${pathname}?q=${encodeURIComponent(query)}${deep ? '&scope=provider' : ''}&thread=${thread.id}`, { scroll: false })}
            />
          )}
        </div>
        <div className={cn('max-h-[calc(100vh-14rem)] overflow-y-auto', !selected && 'hidden lg:block')}>
          {selected ? (
            <Conversation key={selected} threadId={selected} onBack={() => router.replace(`${pathname}?q=${encodeURIComponent(query)}`)} onChanged={() => {}} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">Results open here.</div>
          )}
        </div>
      </div>
    </div>
  );
}
