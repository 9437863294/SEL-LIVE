'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { cn } from '@/lib/utils';

/**
 * The bar's element id. The header looks it up to include whatever of the bar is on screen in
 * `--app-header-offset`, so module sidebars fixed beneath the chrome start below it.
 */
export const BREADCRUMBS_BAR_ID = 'app-breadcrumbs';

/**
 * First path segment → the module's name, as the Module Hub and the permission registry
 * (`src/lib/permissions.ts`) call it. Folders missing here fall back to their title-cased name.
 */
export const MODULE_LABELS: Record<string, string> = {
  'bank-balance': 'Bank Balance',
  'bank-guarantee': 'Bank Guarantee Management',
  'billing-recon': 'Billing Recon',
  'chat-system': 'Chat System',
  'daily-requisition': 'Daily Requisition',
  'driver-management': 'Driver Management',
  'e-approval': 'E-Approval',
  employee: 'Employee',
  expenses: 'Expenses',
  'fixed-deposit': 'Fixed Deposit Management',
  hr: 'HR & Recruitment',
  insurance: 'Insurance',
  // The two legacy LC routes only redirect to /letter-of-credit.
  'lc-management': 'Letter of Credit Management',
  'lc-module': 'Letter of Credit Management',
  'letter-of-credit': 'Letter of Credit Management',
  loan: 'Loan',
  mail: 'Mail Hub',
  'my-work': 'My Work',
  'office-hub': 'Office Hub',
  'project-management': 'Project Management',
  'recurring-payments': 'Recurring Payments',
  settings: 'Settings',
  'site-account-statement': 'Site Account Statement',
  'site-fund-request': 'Site Fund Request',
  // The Module Hub's "Site Fund Requisition" card opens this route; the "2" is a URL artefact.
  'site-fund-requisition-2': 'Site Fund Requisition',
  'store-stock-management': 'Store & Stock Management',
  'subcontractors-management': 'Subcontractors Management',
  'tour-travel': 'Tour, Travel & Expense',
  'vehicle-management': 'Vehicle Management',
  'vendor-management': 'Vendor Management',
  'windows-agent': 'Windows Agent',
  // Part of the Windows Agent module, kept at a short top-level URL for phones.
  'work-calls': 'Work Calls',
};

/** Abbreviations the route folders use, which read wrongly title-cased ("Boq", "Grn Entry"). */
const ACRONYMS = new Set(['ai', 'bg', 'boq', 'dp', 'emi', 'fd', 'grn', 'hr', 'jmc', 'lc', 'mdcc', 'mdl', 'mom', 'mvac', 'po', 'puc', 'rfq', 'sla']);

/** Sub-page names that title-casing would get wrong. */
const SEGMENT_LABELS: Record<string, string> = {
  'e-approval': 'E-Approval',
};

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A record id rather than a page name: numbers, UUIDs, Firestore / Auth ids, reference codes. */
export function looksLikeId(segment: string): boolean {
  if (/^\d+$/.test(segment) || UUID.test(segment)) return true;
  // Route folders are lower-case words, so a capital beside a digit is a reference or a generated id.
  if (/[A-Z]/.test(segment) && /\d/.test(segment)) return true;
  // One unbroken run of letters and digits — how Firestore and Auth ids look.
  if (/^[A-Za-z0-9_]{8,}$/.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment)) return true;
  return /^[A-Za-z0-9_]{16,}$/.test(segment) && /[A-Z]/.test(segment) && /[a-z]/.test(segment);
}

export function segmentLabel(segment: string): string {
  if (looksLikeId(segment)) return 'Details';
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  return segment
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

export interface Crumb {
  href: string;
  label: string;
}

/** Home › Module › sub-pages, straight from the path. */
export function buildCrumbs(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ href: '/', label: 'Home' }];
  let href = '';
  pathname
    .split('/')
    .filter(Boolean)
    .forEach((raw, index) => {
      href += `/${raw}`;
      let segment = raw;
      try {
        segment = decodeURIComponent(raw);
      } catch {
        // A malformed escape: label the segment as it appears.
      }
      const label = index === 0 ? MODULE_LABELS[segment] ?? segmentLabel(segment) : segmentLabel(segment);
      crumbs.push({ href, label });
    });
  return crumbs;
}

function Separator() {
  return <ChevronRight aria-hidden className="h-3 w-3 shrink-0 opacity-60" />;
}

const linkClass =
  'block truncate rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The slim "where am I" bar under the header, when the Breadcrumbs layout preference is on.
 *
 * Labels are plain text from the path — never markup. On a phone the crumbs between the module
 * and the current page fold into "…", which expands them in place; every crumb truncates rather
 * than pushing the bar wider than the screen.
 */
export default function Breadcrumbs() {
  const pathname = usePathname() || '/';
  const { effective } = useAppearance();
  // Keyed on the path, so the folded crumbs close again on the next page.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);

  if (!effective.layout.breadcrumbs) return null;
  const crumbs = buildCrumbs(pathname);
  // Home on its own tells nobody anything.
  if (crumbs.length < 2) return null;

  const lastIndex = crumbs.length - 1;
  const expanded = expandedFor === pathname;
  const folds = !expanded && crumbs.length > 3;

  return (
    <nav
      id={BREADCRUMBS_BAR_ID}
      aria-label="Breadcrumb"
      className="w-full border-b bg-background/80 px-3 text-xs text-muted-foreground print:hidden md:px-6"
    >
      {/* -mx-1 px-1: room for the focus ring of the first crumb inside overflow-hidden. */}
      <ol className={cn('-mx-1 flex min-h-8 min-w-0 items-center gap-1 px-1 py-1.5', expanded ? 'flex-wrap' : 'overflow-hidden')}>
        {crumbs.map((crumb, index) => {
          const isLast = index === lastIndex;
          const folded = folds && index > 1 && index < lastIndex;
          return (
            <Fragment key={crumb.href}>
              <li
                className={cn(
                  'flex min-w-0 items-center gap-1',
                  index === 0 && 'shrink-0',
                  isLast && 'min-w-[5rem]',
                  folded && 'hidden sm:flex',
                )}
              >
                {index > 0 && <Separator />}
                {isLast ? (
                  <span aria-current="page" title={crumb.label} className="block truncate font-medium text-foreground">
                    {crumb.label}
                  </span>
                ) : (
                  <Link href={crumb.href} title={crumb.label} className={cn(linkClass, index > 0 && 'max-w-[10rem] md:max-w-[14rem]')}>
                    {crumb.label}
                  </Link>
                )}
              </li>
              {/* Stands in for the folded crumbs on a phone, right after the module. */}
              {folds && index === 1 && (
                <li className="flex shrink-0 items-center gap-1 sm:hidden">
                  <Separator />
                  <button
                    type="button"
                    onClick={() => setExpandedFor(pathname)}
                    aria-label={`Show ${lastIndex - 2} more ${lastIndex - 2 === 1 ? 'level' : 'levels'}`}
                    className="rounded-sm px-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span aria-hidden>…</span>
                  </button>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
