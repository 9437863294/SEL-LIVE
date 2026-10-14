'use client';

/**
 * The company letterhead and its print companions, drawn from Settings › Company Profile:
 *
 *   <CompanyLetterhead title="Payment Voucher" meta={[{ label: 'Voucher No', value }]} />
 *   <SignatureBlock />            Prepared / Checked / Approved (or the configured captions)
 *   <PrintedOnLine />             "Printed on 14 Oct 2026, 10:42" when the design asks for it
 *   <CompanyFooterLine />         one small address/contact line for a print footer
 *
 * Everything sits in `keep-light` with slate/black text, so the generated dark-mode layer leaves it
 * alone and a print from a dark-themed screen still comes out black on white.
 */

import type { CSSProperties, ReactNode } from 'react';
import { useMemo, useSyncExternalStore } from 'react';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import {
  companyContactLine,
  companyTaxLine,
  formatCompanyAddress,
  letterheadUsesField,
  renderLetterheadTemplate,
  signatureLabelsFor,
  uiText,
  type CompanyProfile,
  type LetterheadContext,
  type LetterheadDivider,
  type LetterheadTitleSize,
} from '@/lib/company-profile';
import { purifyLetterheadHtml } from '@/lib/letterhead-purify';
import { cn } from '@/lib/utils';

const NAME_SIZE: Record<LetterheadTitleSize, string> = { sm: 'text-base', md: 'text-xl', lg: 'text-2xl' };
const COMPACT_NAME_SIZE: Record<LetterheadTitleSize, string> = { sm: 'text-sm', md: 'text-base', lg: 'text-lg' };

const DIVIDER_CLASS: Record<LetterheadDivider, string> = {
  none: '',
  line: 'border-b',
  double: 'border-b-4 border-double',
  bar: 'border-b-4',
};

export interface LetterheadMeta {
  label: string;
  value: string;
}

/**
 * Tailwind's preflight strips list bullets, heading sizes and makes images blocks; the designed
 * HTML is written as in Word, so those come back inside it (screen and print alike).
 */
export const DESIGNED_HTML_CLASS =
  'lh-designed break-words [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_img]:inline-block [&_img]:max-w-full [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:font-semibold [&_a]:underline [&_td]:align-top';

/** The document fields a letterhead fills from its props: title, subtitle, the meta entries (number and date guessed from their labels). */
function contextFrom(title?: string, subtitle?: string, meta?: LetterheadMeta[], extra?: LetterheadContext): LetterheadContext {
  return {
    documentTitle: title,
    documentSubtitle: subtitle,
    documentNumber: meta?.find((entry) => /\b(no\.?|number|ref)\b/i.test(entry.label))?.value,
    date: meta?.find((entry) => /\bdate\b/i.test(entry.label))?.value,
    meta,
    ...extra,
  };
}

/** A designed header or footer, cleaned (DOMPurify) then filled (escaped). Empty during SSR. */
export function DesignedLetterheadHtml({
  html,
  profile,
  context,
  heightMm,
  className,
}: {
  html: string;
  profile: CompanyProfile;
  context: LetterheadContext;
  heightMm?: number | null;
  className?: string;
}) {
  const filled = useMemo(() => renderLetterheadTemplate(purifyLetterheadHtml(html, profile.logoUrl), profile, context), [html, profile, context]);
  return (
    <div
      className={cn(DESIGNED_HTML_CLASS, heightMm && 'overflow-hidden', className)}
      style={heightMm ? { height: `${heightMm}mm` } : undefined}
      // Safe by construction: DOMPurify output against the letterhead allow-list, with every merge field escaped.
      dangerouslySetInnerHTML={{ __html: filled }}
    />
  );
}

function MetaGrid({ meta, compact }: { meta: LetterheadMeta[]; compact: boolean }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2 print:grid-cols-2', compact ? 'mt-1.5 text-xs' : 'mt-3 text-[13px]')}>
      {meta.map((entry, index) => (
        <div key={`${entry.label}-${index}`} className="flex min-w-0 gap-2">
          <dt className="shrink-0 font-semibold">{entry.label}:</dt>
          <dd className="min-w-0 break-words">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Watermark({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden print:fixed">
      <span className="-rotate-[30deg] select-none whitespace-nowrap text-6xl font-black uppercase tracking-widest text-slate-900 opacity-[0.06]">
        {text}
      </span>
    </div>
  );
}

/**
 * The designed header: the custom HTML, then — when the template does not place them itself — the
 * title/subtitle and the meta grid, so documents passing those props never lose them.
 */
function CustomLetterheadHeader({ profile, title, subtitle, meta, compact, className }: {
  profile: CompanyProfile;
  title?: string;
  subtitle?: string;
  meta?: LetterheadMeta[];
  compact: boolean;
  className?: string;
}) {
  const lh = profile.design.letterhead;
  const html = lh.custom.headerHtml;
  const context = useMemo(() => contextFrom(title, subtitle, meta), [title, subtitle, meta]);
  const placesTitle = letterheadUsesField(html, 'documentTitle');
  const placesMeta = letterheadUsesField(html, 'meta');
  return (
    <header className={cn('keep-light relative bg-white text-slate-900 print:text-black', className)}>
      <Watermark text={lh.watermark} />
      <DesignedLetterheadHtml html={html} profile={profile} context={context} heightMm={lh.custom.headerHeightMm} />
      {!placesTitle && (title || subtitle) && (
        <div className={cn('text-center', compact ? 'mt-1.5' : 'mt-3')}>
          {title && <p className={cn('font-bold uppercase tracking-[0.15em]', compact ? 'text-sm' : 'text-base')}>{title}</p>}
          {subtitle && <p className="text-xs text-slate-600">{subtitle}</p>}
        </div>
      )}
      {!placesMeta && meta && meta.length > 0 && <MetaGrid meta={meta} compact={compact} />}
    </header>
  );
}

export function CompanyLetterhead({
  title,
  subtitle,
  meta,
  align,
  compact = false,
  className,
  profile: override,
}: {
  title?: string;
  subtitle?: string;
  meta?: LetterheadMeta[];
  /** Overrides the configured layout; omit to follow Settings › Company Profile. */
  align?: 'left' | 'center';
  compact?: boolean;
  className?: string;
  /** Draw this profile instead of the stored one — the settings screen's live preview. */
  profile?: CompanyProfile;
}) {
  const stored = useCompanyProfile().profile;
  const profile = override ?? stored;
  const lh = profile.design.letterhead;
  if (lh.mode === 'custom') {
    return <CustomLetterheadHeader profile={profile} title={title} subtitle={subtitle} meta={meta} compact={compact} className={className} />;
  }
  const layout = align ?? lh.layout;
  const centered = layout === 'center';
  const accent: CSSProperties = { color: lh.accentColor };
  const tax = companyTaxLine(profile);
  const contact = companyContactLine(profile);
  const logo = lh.showLogo && profile.logoUrl ? profile.logoUrl : null;
  const small = compact ? 'text-[10px] leading-snug' : 'text-[11px] leading-snug';

  const identity = (
    <div className={cn('min-w-0', centered && 'text-center')}>
      {lh.headerNote && <p className={cn(small, 'uppercase tracking-wider text-slate-600')}>{lh.headerNote}</p>}
      <p className={cn('font-extrabold tracking-wide', compact ? COMPACT_NAME_SIZE[lh.titleSize] : NAME_SIZE[lh.titleSize])} style={accent}>
        {profile.legalName}
      </p>
      {profile.tagline && <p className={cn(small, 'font-semibold text-slate-700')}>{profile.tagline}</p>}
    </div>
  );

  const details = (
    <div className={cn('min-w-0 space-y-0.5 text-slate-700', small, centered && 'text-center', layout === 'split' && 'sm:text-right print:text-right')}>
      {lh.showAddress && <p>{formatCompanyAddress(profile, { singleLine: true })}</p>}
      {tax && <p>{tax}</p>}
      {contact && <p className="break-words">{contact}</p>}
    </div>
  );

  const logoImage = logo ? (
    // A Storage download URL of a few kilobytes; next/image would need the bucket allow-listed.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt={profile.shortName} className={cn('w-auto shrink-0 object-contain', compact ? 'h-9' : 'h-12', centered && 'mx-auto')} />
  ) : null;

  return (
    <header className={cn('keep-light relative bg-white text-slate-900 print:text-black', className)}>
      {lh.watermark && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden print:fixed">
          <span className="-rotate-[30deg] select-none whitespace-nowrap text-6xl font-black uppercase tracking-widest text-slate-900 opacity-[0.06]">
            {lh.watermark}
          </span>
        </div>
      )}
      <div className={cn(compact ? 'pb-2' : 'pb-3', DIVIDER_CLASS[lh.divider])} style={{ borderColor: lh.accentColor }}>
        {layout === 'split' ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between print:flex-row print:items-start print:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {logoImage}
              {identity}
            </div>
            {details}
          </div>
        ) : centered ? (
          <div className="space-y-1">
            {logoImage}
            {identity}
            {details}
          </div>
        ) : (
          <div className="flex min-w-0 items-start gap-3">
            {logoImage}
            <div className="min-w-0 space-y-1">
              {identity}
              {details}
            </div>
          </div>
        )}
      </div>

      {(title || subtitle) && (
        <div className={cn('text-center', compact ? 'mt-1.5' : 'mt-3')}>
          {title && <p className={cn('font-bold uppercase tracking-[0.15em]', compact ? 'text-sm' : 'text-base')}>{title}</p>}
          {subtitle && <p className="text-xs text-slate-600">{subtitle}</p>}
        </div>
      )}

      {meta && meta.length > 0 && (
        <dl className={cn('grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2 print:grid-cols-2', compact ? 'mt-1.5 text-xs' : 'mt-3 text-[13px]')}>
          {meta.map((entry, index) => (
            <div key={`${entry.label}-${index}`} className="flex min-w-0 gap-2">
              <dt className="shrink-0 font-semibold">{entry.label}:</dt>
              <dd className="min-w-0 break-words">{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

/** One small line for the foot of a printed page: address, contacts, GSTIN, and the footer note. */
export function CompanyFooterLine({ className, profile: override, context }: { className?: string; profile?: CompanyProfile; context?: LetterheadContext }) {
  const stored = useCompanyProfile().profile;
  const profile = override ?? stored;
  const lh = profile.design.letterhead;
  if (lh.mode === 'custom') {
    return (
      <div className={cn('keep-light bg-white text-slate-900 print:text-black', className)}>
        <DesignedLetterheadHtml html={lh.custom.footerHtml} profile={profile} context={context ?? EMPTY_CONTEXT} heightMm={lh.custom.footerHeightMm} />
      </div>
    );
  }
  const parts = [profile.legalName, lh.showAddress && formatCompanyAddress(profile, { singleLine: true }), companyContactLine(profile), companyTaxLine(profile)].filter(Boolean);
  return (
    <div className={cn('keep-light text-center text-[10px] leading-snug text-slate-600 print:text-black', className)}>
      <p>{parts.join(' · ')}</p>
      {lh.footerNote && <p className="italic">{lh.footerNote}</p>}
    </div>
  );
}

const EMPTY_CONTEXT: LetterheadContext = {};

/**
 * Opt-in: a whole printed document with the letterhead repeated as Settings › Company Profile says.
 *
 *   <LetterheadPage title="Payment Voucher" meta={…}>…the document…</LetterheadPage>
 *
 * Standard mode renders exactly what CompanyLetterhead + content + CompanyFooterLine would. In
 * custom mode the document sits in a one-cell table: a header shown on 'every' page goes in
 * <thead> and a footer in <tfoot>, which Chrome (109 and current), Edge and Firefox repeat on every
 * printed page. A footer with a fixed height is also pinned to the bottom of each sheet in print
 * (position: fixed, with a <tfoot> spacer of the same height so content never runs under it).
 * Footer 'last' and 'first' print after the content: browsers give HTML no way to know which sheet
 * is first or last, so 'first' degrades to 'last' on documents longer than one page.
 *
 * It does not touch any page's print-fit or zoom; a page that scales its content with CSS zoom or
 * a transform should keep using CompanyLetterhead, since a fixed footer inside a transformed
 * ancestor is positioned against that ancestor, not the sheet.
 */
export function LetterheadPage({
  title,
  subtitle,
  meta,
  context: extra,
  children,
  className,
  profile: override,
}: {
  title?: string;
  subtitle?: string;
  meta?: LetterheadMeta[];
  context?: LetterheadContext;
  children: ReactNode;
  className?: string;
  profile?: CompanyProfile;
}) {
  const stored = useCompanyProfile().profile;
  const profile = override ?? stored;
  const lh = profile.design.letterhead;
  const context = useMemo(() => contextFrom(title, subtitle, meta, extra), [title, subtitle, meta, extra]);
  if (lh.mode !== 'custom') {
    return (
      <div className={className}>
        <CompanyLetterhead profile={profile} title={title} subtitle={subtitle} meta={meta} />
        {children}
        <CompanyFooterLine profile={profile} className="mt-6" />
      </div>
    );
  }
  const custom = lh.custom;
  const header = <CompanyLetterhead profile={profile} title={title} subtitle={subtitle} meta={meta} />;
  const footer = <CompanyFooterLine profile={profile} context={context} />;
  const pinFooter = custom.footerOn === 'every' && custom.footerHeightMm;
  const pageLabel = `${uiText(profile.labels, 'page')} `;
  const ofLabel = ` ${uiText(profile.labels, 'of')} `;
  const wantsPageNumbers = letterheadUsesField(custom.footerHtml, 'page') || letterheadUsesField(custom.headerHtml, 'page');
  // @page margin boxes: Chrome 131+ prints them; Chrome 109 (the Win7 PCs) ignores the rule, so the
  // number is simply absent there. JSON.stringify quotes the labels safely for CSS strings.
  const pageCss = [
    custom.marginMm !== null ? `@page { margin: ${custom.marginMm}mm; }` : '',
    wantsPageNumbers ? `@page { @bottom-right { content: ${JSON.stringify(pageLabel)} counter(page) ${JSON.stringify(ofLabel)} counter(pages); font-size: 9px; color: #475569; } }` : '',
  ].filter(Boolean).join('\n');
  return (
    <div className={cn('keep-light bg-white text-slate-900 print:text-black', className)}>
      {pageCss && <style>{`@media print { ${pageCss} }`}</style>}
      <table className="w-full border-collapse">
        {custom.headerOn === 'every' && (
          <thead className="table-header-group">
            <tr><td className="p-0 pb-3">{header}</td></tr>
          </thead>
        )}
        <tbody>
          <tr>
            <td className="p-0 align-top">
              {custom.headerOn === 'first' && <div className="pb-3">{header}</div>}
              {children}
              {custom.footerOn !== 'every' && <div className="pt-6">{footer}</div>}
            </td>
          </tr>
        </tbody>
        {custom.footerOn === 'every' && (
          <tfoot className="table-footer-group">
            <tr>
              <td className="p-0 pt-6">
                {/* With a fixed height: the real footer on screen, a spacer in print (the pinned copy below prints at each sheet's foot). */}
                {pinFooter ? <div className="print:invisible" style={{ height: `${custom.footerHeightMm}mm` }}>{footer}</div> : footer}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      {pinFooter && <div className="hidden print:fixed print:inset-x-0 print:bottom-0 print:block">{footer}</div>}
    </div>
  );
}

/** Signature boxes for the foot of a document: the given captions, else the configured ones. */
export function SignatureBlock({ labels, className, profile: override }: { labels?: string[]; className?: string; profile?: CompanyProfile }) {
  const stored = useCompanyProfile().profile;
  const profile = override ?? stored;
  const captions = labels && labels.length ? labels : signatureLabelsFor(profile);
  return (
    <div
      className={cn(
        'keep-light mt-10 grid grid-cols-1 gap-6 text-xs text-slate-900 print:text-black',
        'sm:grid-cols-[repeat(var(--signature-columns),minmax(0,1fr))] print:grid-cols-[repeat(var(--signature-columns),minmax(0,1fr))]',
        className,
      )}
      style={{ '--signature-columns': Math.max(1, captions.length) } as CSSProperties}
    >
      {captions.map((caption, index) => (
        <div key={`${caption}-${index}`} className="min-w-0 pt-8 text-center">
          <div className="border-t border-slate-500 pt-1 font-semibold">{caption}</div>
        </div>
      ))}
    </div>
  );
}

const formatNow = () =>
  new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
let printTime: string | null = null;
const readPrintTime = () => (printTime ??= formatNow());
/** Re-stamped as the print dialog opens, so a page left open for an hour prints the right time. */
const subscribePrintTime = (notify: () => void) => {
  const onBeforePrint = () => {
    printTime = formatNow();
    notify();
  };
  window.addEventListener('beforeprint', onBeforePrint);
  return () => window.removeEventListener('beforeprint', onBeforePrint);
};

/** "Printed on 14 Oct 2026, 10:42" — only when Settings › Company Profile turns it on. */
export function PrintedOnLine({ className, profile: override }: { className?: string; profile?: CompanyProfile }) {
  const stored = useCompanyProfile().profile;
  const profile = override ?? stored;
  // Null on the server and during hydration (its clock and time zone differ); the browser's time after.
  const now = useSyncExternalStore(subscribePrintTime, readPrintTime, () => null);
  if (!profile.design.print.showPrintedOn || !now) return null;
  return (
    <p className={cn('keep-light text-[10px] text-slate-600 print:text-black', className)}>
      {uiText(profile.labels, 'printedOn')} {now}
    </p>
  );
}
