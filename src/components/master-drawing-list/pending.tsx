'use client';

/**
 * Pending Action (`/master-drawing-list/pending`): what is waiting, on whom, and for how long.
 *   - Comments to comply — the client has commented; SEL must revise and resubmit. Longest first.
 *   - Under review — submitted and with the client. Longest first.
 *   - Vendor not finalised — nothing can be drawn yet; by project, then group.
 * Every drawing list the user may view, or one (`?project=`).
 */

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Hourglass, MessageSquare, PackageX, Send } from 'lucide-react';

import { CellLink, DataList, type ListColumn } from '@/components/shared/data-list';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/master-drawing-list/derive';
import type { PendingEntry, PendingLists } from '@/lib/master-drawing-list/register';
import type { MdlItem } from '@/lib/master-drawing-list/types';

import { useMdl, useMdlQuery, type MdlProjectView } from './mdl-client';
import { DateText, MdlEmpty, MdlError, MdlLoading, ProjectSelect } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';
import { itemHref } from './register';

interface PendingData {
  projects: MdlProjectView[];
  lists: PendingLists;
  today: string;
}

const TAB_LIST = 'flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm';
const TAB = 'shrink-0 gap-1.5';

function Count({ value }: { value: number }) {
  return <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold leading-4 text-slate-600">{value.toLocaleString('en-IN')}</span>;
}

function waitingColumns(shortOf: (code: string) => string, since: string): ListColumn<PendingEntry & { id: string }>[] {
  return [
    {
      header: 'Days',
      mobile: 'aside',
      align: 'right',
      className: 'w-20',
      cell: (entry) => <span className={entry.days > 30 ? 'font-semibold tabular-nums text-rose-700' : 'font-semibold tabular-nums text-slate-800'}>{entry.days}</span>,
    },
    {
      header: 'Description',
      mobile: 'title',
      className: 'min-w-[18rem] max-w-[28rem]',
      cell: (entry) => (
        <CellLink href={itemHref(entry.item.id)} className="line-clamp-2 font-medium text-slate-800 hover:underline">
          {entry.item.description}
        </CellLink>
      ),
    },
    { header: 'Project', cell: (entry) => shortOf(entry.item.projectCode) },
    { header: 'Sl. No.', cell: (entry) => `${entry.item.schedule} · ${entry.item.slNo || '—'}` },
    { header: 'Drawing No.', className: 'min-w-[10rem]', cell: (entry) => entry.item.drgNo || '—' },
    { header: 'Revision', cell: (entry) => (entry.item.currentRev === null ? '—' : `R${entry.item.currentRev}`) },
    { header: since, cell: (entry) => <span className="tabular-nums">{formatDate(entry.since)}</span> },
  ];
}

function WaitingList({ entries, shortOf, since, empty }: { entries: PendingEntry[]; shortOf: (code: string) => string; since: string; empty: string }) {
  const rows = entries.map((entry) => ({ ...entry, id: entry.item.id }));
  return <DataList rows={rows} columns={waitingColumns(shortOf, since)} cardHref={(entry) => itemHref(entry.item.id)} dense frameless empty={<MdlEmpty title={empty} />} />;
}

function VendorList({ lists, shortOf }: { lists: PendingLists['vendor']; shortOf: (code: string) => string }) {
  if (!lists.length) return <MdlEmpty title="Every item has its vendor finalised." />;
  const cardColumns: ListColumn<MdlItem>[] = [
    { header: 'Description', mobile: 'title', cell: (item) => <span className="line-clamp-3">{item.description}</span> },
    { header: 'Sl. No.', cell: (item) => `${item.schedule} · ${item.slNo || '—'}` },
    { header: 'Planned submission', cell: (item) => <DateText value={item.plannedSubmission} /> },
  ];
  return (
    <>
      <Table containerClassName="hidden sm:block">
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Sl. No.</TableHead>
            <TableHead className="min-w-[18rem]">Description</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead className="whitespace-nowrap">Planned submission</TableHead>
            <TableHead>Remarks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lists.flatMap((project) => [
            <TableRow key={project.projectCode} className="bg-muted/60 hover:bg-muted/60">
              <TableCell colSpan={5} className="py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">{shortOf(project.projectCode)}</span>
                <span className="ml-2 text-xs text-muted-foreground">{project.count}</span>
              </TableCell>
            </TableRow>,
            ...project.groups.flatMap((group) => [
              <TableRow key={`${project.projectCode}|${group.group ?? ''}`} className="bg-muted/25 hover:bg-muted/25">
                <TableCell colSpan={5} className="py-1.5 pl-6 text-[13px] font-medium text-slate-700">
                  {group.group ?? 'No group'} <span className="ml-1 font-normal text-muted-foreground">{group.items.length}</span>
                </TableCell>
              </TableRow>,
              ...group.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {item.schedule} · {item.slNo || '—'}
                  </TableCell>
                  <TableCell className="max-w-[28rem]">
                    <Link href={itemHref(item.id)} className="line-clamp-2 font-medium text-slate-800 hover:underline">
                      {item.description}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{item.scope}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <DateText value={item.plannedSubmission} />
                  </TableCell>
                  <TableCell className="max-w-[20rem] text-slate-700">{item.remarks || <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              )),
            ]),
          ])}
        </TableBody>
      </Table>
      <div className="divide-y sm:hidden">
        {lists.map((project) => (
          <section key={project.projectCode} className="space-y-2 px-3 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
              {shortOf(project.projectCode)} <span className="ml-1 font-normal normal-case text-muted-foreground">{project.count}</span>
            </h3>
            {project.groups.map((group) => (
              <div key={group.group ?? ''} className="space-y-2">
                <p className="text-[13px] font-medium text-slate-600">{group.group ?? 'No group'}</p>
                <DataList cardsOnly rows={group.items} columns={cardColumns} cardHref={(item) => itemHref(item.id)} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

export default function Pending() {
  const { lookups } = useMdl();
  const router = useRouter();
  const pathname = usePathname() ?? `${MDL_BASE}/pending`;
  const params = useSearchParams();
  const fromUrl = params.get('project');
  const project = fromUrl && lookups?.projects.some((entry) => entry.code === fromUrl) ? fromUrl : null;
  const tab = ['comments', 'review', 'vendor'].includes(params.get('tab') ?? '') ? (params.get('tab') as string) : 'comments';
  const query = useMdlQuery<PendingData>(lookups ? `pending${project ? `?project=${encodeURIComponent(project)}` : ''}` : null);

  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    const text = next.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };

  if (!lookups) return <MdlLoading />;
  const short = new Map(lookups.projects.map((entry) => [entry.code, entry.short]));
  const shortOf = (code: string) => short.get(code) ?? code;
  const lists = query.data?.lists;

  return (
    <>
      <PageHeader
        icon={Hourglass}
        title="Pending Action"
        description="What is waiting, with whom, and for how many days — longest waiting first."
        actions={lookups.projects.length > 1 ? <ProjectSelect projects={lookups.projects} value={project} onChange={(code) => setParam('project', code)} allowAll className="sm:w-56" /> : undefined}
      />
      <MdlError message={query.error} onRetry={query.reload} />
      {!lists ? (
        query.loading ? <MdlLoading /> : null
      ) : (
        <Tabs value={tab} onValueChange={(value) => setParam('tab', value === 'comments' ? null : value)}>
          <TabsList className={TAB_LIST} aria-label="Pending lists">
            <TabsTrigger value="comments" className={TAB}>
              <MessageSquare className="h-4 w-4" aria-hidden="true" /> Comments to comply <Count value={lists.comments.length} />
            </TabsTrigger>
            <TabsTrigger value="review" className={TAB}>
              <Send className="h-4 w-4" aria-hidden="true" /> Under review <Count value={lists.review.length} />
            </TabsTrigger>
            <TabsTrigger value="vendor" className={TAB}>
              <PackageX className="h-4 w-4" aria-hidden="true" /> Vendor not finalised <Count value={lists.vendor.reduce((sum, entry) => sum + entry.count, 0)} />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="comments" className="mt-4">
            <TableCard title="Comments to comply" description="The client has returned comments. Action with SEL: revise and resubmit." count={lists.comments.length} noun="drawing">
              <WaitingList entries={lists.comments} shortOf={shortOf} since="Comments on" empty="No comments are waiting to be complied with." />
            </TableCard>
          </TabsContent>
          <TabsContent value="review" className="mt-4">
            <TableCard title="Under review" description="Submitted and waiting for the client's comments or approval." count={lists.review.length} noun="drawing">
              <WaitingList entries={lists.review} shortOf={shortOf} since="Submitted on" empty="Nothing is waiting with the client." />
            </TableCard>
          </TabsContent>
          <TabsContent value="vendor" className="mt-4">
            <TableCard
              title="Vendor not finalised"
              description="Nothing submitted yet and no vendor finalised. Action with procurement."
              count={lists.vendor.reduce((sum, entry) => sum + entry.count, 0)}
              noun="item"
            >
              <VendorList lists={lists.vendor} shortOf={shortOf} />
            </TableCard>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
