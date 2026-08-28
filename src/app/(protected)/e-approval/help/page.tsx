'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronRight,
  Download,
  FilePlus2,
  Inbox,
  Info,
  Printer,
  Search,
  Settings,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import {
  E_APPROVAL_MANUAL,
  E_APPROVAL_MANUAL_META,
  MANUAL_AUDIENCE_LABEL,
  type ManualAudience,
  type ManualBlock,
  type ManualPart,
  type ManualSection,
} from '@/lib/e-approval-manual';
import { PageHeader } from '@/components/e-approval/page-header';

/**
 * The in-app handbook (spec section 33).
 *
 * Renders `e-approval-manual.ts` — the same array `scripts/build-e-approval-manual.mjs` renders into
 * the Word file. Deliberately one source: a tutorial page that is maintained separately from the
 * distributed manual is two documents that disagree by the second release, and the person reading
 * the wrong one has no way to know which it is.
 *
 * Three things a help page usually gets wrong and this one tries not to:
 *
 *   - It filters by *who you are*, not by feature area. An approver looking for "what does Return
 *     do" should not have to scroll past matrix configuration to reach it.
 *   - It searches the body text, not just the headings, because people search for the word they saw
 *     on a button — "supersede", "recall" — and not for the section it lives under.
 *   - It states the gaps. Section 3.10 lists what is not built, so nobody spends an afternoon
 *     hunting the Branch filter.
 */

const MANUAL_DOWNLOAD = '/docs/E-Approval-Manual.docx';

type AudienceFilter = ManualAudience | 'all';

const AUDIENCE_FILTERS: Array<{ key: AudienceFilter; label: string; hint: string }> = [
  { key: 'all', label: 'Everything', hint: 'The complete handbook' },
  { key: 'everyone', label: 'Getting started', hint: 'Raising and tracking approvals' },
  { key: 'approver', label: 'For approvers', hint: 'Acting on what reaches you' },
  { key: 'administrator', label: 'For administrators', hint: 'Configuring the module' },
];

const QUICK_LINKS: Array<{
  href: string;
  label: string;
  description: string;
  icon: typeof FilePlus2;
  tone: string;
  section: string;
}> = [
  {
    href: `${E_APPROVAL_BASE_PATH}/create`,
    label: 'Raise an approval',
    description: 'Subject, proposal, first approver. Three fields is enough.',
    icon: FilePlus2,
    tone: 'text-emerald-600 bg-emerald-100',
    section: 'raising',
  },
  {
    href: `${E_APPROVAL_BASE_PATH}/inbox`,
    label: 'Act on your inbox',
    description: 'Approve, verify, return, forward — and what each one does.',
    icon: Inbox,
    tone: 'text-indigo-600 bg-indigo-100',
    section: 'actions',
  },
  {
    href: `${E_APPROVAL_BASE_PATH}/settings`,
    label: 'Set the module up',
    description: 'Types, workflows, matrix, routing, policies — in that order.',
    icon: Settings,
    tone: 'text-slate-600 bg-slate-200',
    section: 'setup-order',
  },
];

/** Matches a section against a search term across its title, summary and every block of body text. */
function sectionMatches(section: ManualSection, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    section.title,
    section.summary,
    section.route ?? '',
    ...section.blocks.flatMap((block) => [
      block.text ?? '',
      ...(block.items ?? []),
      ...(block.headers ?? []),
      ...(block.rows ?? []).flat(),
    ]),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

function BlockView({ block }: { block: ManualBlock }) {
  switch (block.kind) {
    case 'paragraph':
      return <p className="text-sm leading-relaxed text-slate-700">{block.text}</p>;

    case 'note':
      return (
        <div className="flex gap-2.5 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <p className="text-sm leading-relaxed text-sky-900">{block.text}</p>
        </div>
      );

    case 'warning':
      return (
        <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm leading-relaxed text-amber-900">{block.text}</p>
        </div>
      );

    case 'steps':
      return (
        <ol className="space-y-2">
          {(block.items ?? []).map((item, index) => (
            <li key={item} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                {index + 1}
              </span>
              <span className="text-sm leading-relaxed text-slate-700">{item}</span>
            </li>
          ))}
        </ol>
      );

    case 'bullets':
      return (
        <ul className="space-y-1.5">
          {(block.items ?? []).map((item) => (
            <li key={item} className="flex gap-2.5">
              <CheckCircle2 className="mt-[3px] h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="text-sm leading-relaxed text-slate-700">{item}</span>
            </li>
          ))}
        </ul>
      );

    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                {(block.headers ?? []).map((header, index) => (
                  <TableHead key={`${header}-${index}`} className="h-9 whitespace-nowrap text-[11px] uppercase tracking-wide">
                    {header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(block.rows ?? []).map((row) => (
                <TableRow key={row.join('|')}>
                  {row.map((cell, index) => (
                    <TableCell
                      key={`${cell}-${index}`}
                      className={cn(
                        'py-2 align-top text-sm leading-relaxed',
                        index === 0 && 'font-medium text-slate-900',
                      )}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );

    default:
      return null;
  }
}

function SectionView({ section }: { section: ManualSection }) {
  return (
    <section id={section.id} className="scroll-mt-20 rounded-xl border bg-background shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 border-b px-3.5 py-3 sm:px-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">
            <span className="mr-2 font-mono text-xs text-muted-foreground">{section.number}</span>
            {section.title}
          </h3>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{section.summary}</p>
        </div>
        {section.route && (
          <Badge variant="outline" className="shrink-0 font-mono text-[10px] font-normal text-muted-foreground">
            {section.route}
          </Badge>
        )}
      </div>
      <div className="space-y-3 px-3.5 py-3.5 sm:px-4">
        {section.blocks.map((block, index) => (
          <BlockView key={`${section.id}-${index}`} block={block} />
        ))}
      </div>
    </section>
  );
}

export default function EApprovalHelpPage() {
  const [audience, setAudience] = useState<AudienceFilter>('all');
  const [search, setSearch] = useState('');

  const needle = search.trim().toLowerCase();

  /**
   * The appendix is kept regardless of audience — an approver searching for what "Superseded" means
   * should not be told there are no results because the glossary is filed under "everyone".
   */
  const parts = useMemo<ManualPart[]>(() => {
    return E_APPROVAL_MANUAL.map((part) => ({
      ...part,
      sections: part.sections.filter((section) => {
        const audienceOk =
          audience === 'all' || part.id === 'appendix' || section.audience === audience;
        return audienceOk && sectionMatches(section, needle);
      }),
    })).filter((part) => part.sections.length > 0);
  }, [audience, needle]);

  const matchCount = parts.reduce((total, part) => total + part.sections.length, 0);

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Guide"
        description="How to raise, approve and administer electronic note-sheets. The same handbook as the Word manual — this page and that file are generated from one source."
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
              <a href={MANUAL_DOWNLOAD} download>
                <Download className="h-3.5 w-3.5" /> Word manual
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => window.print()}
            >
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </>
        }
        meta={[
          { label: 'Version', value: E_APPROVAL_MANUAL_META.version },
          { label: 'Sections', value: E_APPROVAL_MANUAL.reduce((n, part) => n + part.sections.length, 0) },
        ]}
      />

      {/* Three doors in, for the three things people arrive here wanting to do. */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        {QUICK_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <div
              key={link.href}
              className="flex min-w-0 flex-col gap-2 rounded-xl border bg-background p-3 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', link.tone)}>
                  <Icon className="h-4 w-4" />
                </span>
                <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{link.label}</p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{link.description}</p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                  <a href={`#${link.section}`}>
                    Read <ChevronRight className="ml-0.5 h-3 w-3" />
                  </a>
                </Button>
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground">
                  <Link href={link.href}>Open the screen</Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter by who you are, and search the body text — see the note at the top of this file. */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-b bg-background/95 px-1 py-2 backdrop-blur print:hidden">
        <div className="flex min-w-0 flex-wrap gap-1">
          {AUDIENCE_FILTERS.map((filter) => (
            <Button
              key={filter.key}
              size="sm"
              variant={audience === filter.key ? 'default' : 'outline'}
              className="h-8 px-2.5 text-xs"
              title={filter.hint}
              onClick={() => setAudience(filter.key)}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        <div className="relative min-w-0 flex-1 sm:max-w-xs sm:ml-auto">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search the handbook…"
            className="h-8 pl-7 pr-7 text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {needle && (
        <p className="text-xs text-muted-foreground">
          {matchCount === 0
            ? 'Nothing in the handbook matches that.'
            : `${matchCount} section${matchCount === 1 ? '' : 's'} mention “${search.trim()}”.`}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
        {/* Contents. Hidden on small screens, where the parts themselves are the navigation. */}
        <nav className="hidden lg:block print:hidden">
          <div className="sticky top-14 space-y-3">
            {parts.map((part) => (
              <div key={part.id}>
                <p className="pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {part.title.replace(/^Part \d+ · /, '')}
                </p>
                <ul className="space-y-0.5">
                  {part.sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="block truncate rounded px-1.5 py-1 text-xs text-slate-600 transition-colors hover:bg-muted hover:text-slate-900"
                        title={section.title}
                      >
                        <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">{section.number}</span>
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-5">
          {parts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-12 text-center">
              <BookOpen className="h-9 w-9 text-muted-foreground/35" />
              <p className="text-sm font-medium">No matching sections</p>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                Try a different word, or switch the filter back to Everything — the section you want may be
                written for a different audience.
              </p>
            </div>
          ) : (
            parts.map((part) => (
              <div key={part.id} id={part.id} className="scroll-mt-20 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Sparkles className="h-4 w-4 text-slate-400" />
                  <h2 className="text-base font-semibold tracking-tight text-slate-900">{part.title}</h2>
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    {MANUAL_AUDIENCE_LABEL[part.audience]}
                  </Badge>
                </div>
                <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{part.intro}</p>
                {part.sections.map((section) => (
                  <SectionView key={section.id} section={section} />
                ))}
              </div>
            ))
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-3.5 py-3">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
              Something here disagrees with what the screen does? The screen is right — tell your administrator so
              the handbook can be corrected. It is one file, so the fix reaches this page and the Word manual
              together.
            </p>
            <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs">
              <a href={MANUAL_DOWNLOAD} download>
                <Download className="h-3 w-3" /> Download
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
