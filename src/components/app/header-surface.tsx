'use client';

/**
 * The top bar's designs — Settings › Appearance › Branding › Top bar.
 *
 * One component draws a design for both the real header and the settings preview, so what an
 * administrator picks is what everyone gets. The design is only a backdrop and a few touches (the
 * avatar ring, a lift on hover); the bar's contents are the header's own, and the logo and company
 * name are Classic's in every design.
 *
 * Classic renders a plain element with the caller's classes and nothing else, so a company that
 * never picks a design sees exactly the header it always had.
 */

import { useId, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { HEADER_DESIGNS, HEADER_DESIGN_META, isOneOf, type CompanyBranding, type HeaderDesignId } from '@/lib/appearance/model';
import { cn } from '@/lib/utils';
import styles from './header-surface.module.css';

export type HeaderTone = 'light' | 'dark';

/** A published value from before designs existed (or a stale cache) is Classic. */
export const headerDesignOf = (value: unknown): HeaderDesignId => (isOneOf(HEADER_DESIGNS, value) ? value : 'classic');

/** The surface's tone: an always-dark design stays dark, the rest follow the mode (or a preview's choice). */
export const headerToneOf = (design: HeaderDesignId, mode: HeaderTone, preview?: HeaderTone): HeaderTone =>
  HEADER_DESIGN_META[design].alwaysDark ? 'dark' : preview ?? mode;

/** The SEL logo, shown until the company publishes one of its own. */
export const DEFAULT_LOGO_URL =
  'https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2FSEL%20%20logo2%20.png?alt=media&token=39b0f804-0610-4f3a-b26e-8ce334f94788';

/**
 * The dark-background logo on a dark bar (dark mode, or an always-dark design such as Midnight
 * Current), else the light one, exactly as Classic does. The SEL logo until one is published.
 */
export function headerLogoSrc(design: HeaderDesignId, mode: HeaderTone, branding: Pick<CompanyBranding, 'logoLight' | 'logoDark'>): string {
  const asset = headerToneOf(design, mode) === 'dark' ? branding.logoDark ?? branding.logoLight : branding.logoLight;
  return asset?.url ?? DEFAULT_LOGO_URL;
}

/* ── Power Line's scene, computed once ───────────────────────────────────────────────────────── */

const SCENE_HEIGHT = 68;
const TOWER_SPACING = 240;
/** Enough towers for a 2,600px-wide screen at the bar's height; the rest is cropped. */
const TOWER_XS = Array.from({ length: 14 }, (_, index) => 60 + index * TOWER_SPACING);
const SCENE_WIDTH = TOWER_XS[TOWER_XS.length - 1] + 60;

const towerPath = (x: number) =>
  `M${x - 9} 68 L${x - 3} 14 L${x + 3} 14 L${x + 9} 68 M${x - 6} 44 L${x + 6} 44 M${x - 4.5} 30 L${x + 4.5} 30 ` +
  `M${x - 7} 56 L${x + 5} 44 M${x + 7} 56 L${x - 5} 44 M${x - 14} 18 L${x + 14} 18 M${x - 11} 24 L${x + 11} 24 M${x} 6 L${x} 14`;

/** Three conductors on the cross-arms, each sagging between towers, each with its own pulse. */
const CONDUCTORS = [
  { y: 18, dx: -14, pulse: styles.p1 },
  { y: 24, dx: 11, pulse: styles.p2 },
  { y: 18, dx: 14, pulse: styles.p3 },
].map(({ y, dx, pulse }) => {
  let d = `M${TOWER_XS[0] + dx} ${y}`;
  for (let index = 1; index < TOWER_XS.length; index += 1) {
    const x0 = TOWER_XS[index - 1] + dx;
    const x1 = TOWER_XS[index] + dx;
    d += ` Q${(x0 + x1) / 2} ${y + 18} ${x1} ${y}`;
  }
  return { d, pulse };
});

const TOWERS_D = TOWER_XS.map(towerPath).join(' ');
const SPARKS = TOWER_XS.slice(1, -1).map((x, index) => ({ cx: x - 14, delay: `${index * 0.7}s` }));

function PowerLineScene() {
  return (
    <svg className={styles.scene} viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`} aria-hidden="true" focusable="false">
      <path className={styles.tower} d={TOWERS_D} />
      {CONDUCTORS.map(({ d, pulse }) => (
        <g key={pulse}>
          <path className={styles.wire} d={d} />
          <path className={cn(styles.pulse, pulse)} d={d} />
        </g>
      ))}
      {SPARKS.map(({ cx, delay }) => (
        <circle key={cx} className={styles.spark} cx={cx} cy={18} r={2.2} style={{ animationDelay: delay }} />
      ))}
    </svg>
  );
}

/* ── Brand Waves ─────────────────────────────────────────────────────────────────────────────── */

const WAVES = [
  { className: styles.w1, d: 'M0 44 C 240 24 480 64 720 44 S 1200 24 1440 44 S 1920 64 2160 44 S 2640 24 2880 44 V68 H0Z' },
  { className: styles.w2, d: 'M0 50 C 180 34 540 62 720 50 S 1260 34 1440 50 S 1980 62 2160 50 S 2700 34 2880 50 V68 H0Z' },
  { className: styles.w3, d: 'M0 30 C 300 50 420 14 720 30 S 1140 50 1440 30 S 1860 14 2160 30 S 2580 50 2880 30 V68 H0Z' },
];

function BrandWaves() {
  // The header and the settings preview can be on one page, so the gradient's id must be unique.
  const gradientId = `hdr-wave-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <>
      {WAVES.map(({ className, d }, index) => (
        <svg key={index} className={cn(styles.wave, className)} viewBox="0 0 2880 68" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {index === 0 && (
            <defs>
              <linearGradient id={gradientId} x1="0" x2="1">
                <stop offset="0" stopColor="#14b8a6" />
                <stop offset=".25" stopColor="#7c3aed" />
                <stop offset=".5" stopColor="#db2777" />
                <stop offset=".75" stopColor="#7c3aed" />
                <stop offset="1" stopColor="#14b8a6" />
              </linearGradient>
            </defs>
          )}
          <path fill={`url(#${gradientId})`} d={d} />
        </svg>
      ))}
      <span className={styles.fade} />
    </>
  );
}

function Backdrop({ design }: { design: HeaderDesignId }) {
  switch (design) {
    case 'aurora':
      return (
        <>
          <span className={cn(styles.blob, styles.b1)} />
          <span className={cn(styles.blob, styles.b2)} />
          <span className={cn(styles.blob, styles.b3)} />
          <span className={cn(styles.blob, styles.b4)} />
          <span className={styles.frost} />
          <span className={styles.underline} />
        </>
      );
    case 'power-line':
      return (
        <>
          <PowerLineScene />
          <span className={styles.fade} />
        </>
      );
    case 'midnight-current':
      return (
        <>
          <span className={styles.glow} />
          <span className={styles.grid} />
          <span className={styles.scanTrack}>
            <span className={styles.scan} />
          </span>
          <span className={styles.underline} />
        </>
      );
    case 'brand-waves':
      return <BrandWaves />;
    default:
      return null;
  }
}

/* ── The surface ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The bar's row, drawn in a design. `mode` is the app's light or dark mode; `previewTone` lets the
 * settings preview show the other one. Children are laid out by `className`, as on a plain div.
 */
export function HeaderSurface({
  design,
  mode,
  previewTone,
  className,
  children,
}: {
  design: HeaderDesignId;
  mode: HeaderTone;
  previewTone?: HeaderTone;
  className?: string;
  children: ReactNode;
}) {
  const tone = headerToneOf(design, mode, previewTone);
  const retone = tone !== mode;
  if (design === 'classic' && !retone) return <div className={className}>{children}</div>;

  const animated = HEADER_DESIGN_META[design].animated;
  return (
    <div
      className={styles.surface}
      data-design={design}
      data-tone={tone}
      data-retone={retone ? '' : undefined}
      data-animated={animated ? '' : undefined}
    >
      {design !== 'classic' && (
        <div className={styles.layers} aria-hidden="true">
          <Backdrop design={design} />
        </div>
      )}
      <div className={cn(styles.content, className)}>{children}</div>
    </div>
  );
}

/**
 * The logo, the company name and the tagline, the same in every design: Classic's sizes, with the
 * logo straight on the bar (`headerLogoSrc` picks the one for the bar's tone). `href` is omitted
 * in the preview, which must not navigate.
 */
export function HeaderBrand({
  logoSrc,
  companyName,
  tagline,
  href,
  preload,
}: {
  logoSrc: string;
  companyName: string;
  tagline?: string;
  href?: string;
  preload?: boolean;
}) {
  const logo = (
    <div className="relative h-8 w-24 md:h-10 md:w-28">
      <Image src={logoSrc} alt={`${companyName} logo`} fill sizes="112px" style={{ objectFit: 'contain' }} preload={preload} />
    </div>
  );
  return (
    <div className="flex items-center gap-2 md:gap-4">
      {href ? <Link href={href}>{logo}</Link> : logo}
      <div className="border-l pl-3 md:pl-4">
        {/* Not a heading: each page's own title is its one <h1>. */}
        <p className="hidden text-sm font-semibold text-foreground sm:block md:text-lg">{companyName}</p>
        {tagline ? <p className="hidden truncate text-[11px] font-semibold leading-tight text-muted-foreground md:block">{tagline}</p> : null}
      </div>
    </div>
  );
}

/** The spinning colour ring around the avatar, in every design but Classic. */
export function HeaderAvatarRing({ design, children }: { design: HeaderDesignId; children: ReactNode }) {
  if (design === 'classic') return <>{children}</>;
  return <span className={styles.avatarRing}>{children}</span>;
}
