/**
 * Making a pasted proposal fit the printed approval note.
 *
 * The proposal is rich text, and people paste rate tables and comparative statements straight out of
 * Excel. A twelve-column comparison is wider than A4 whatever you do to the margins, and the browser
 * simply clips it — so the note that gets signed and filed is missing the last four columns, with
 * nothing on the paper to say so. That is the failure this exists to stop.
 *
 * Two levers, applied in that order:
 *
 *   1. **Shrink.** A mild reduction is invisible to the reader and keeps the note portrait, which is
 *      what it is filed as. Preferred whenever it is enough.
 *   2. **Rotate.** Past a point, shrinking stops being "slightly smaller" and becomes "unreadable" —
 *      a rate table at 55% is a table nobody checks figures against. Beyond `MIN_READABLE_SCALE` the
 *      page turns landscape instead, and shrinking resumes from there only if it is still too wide.
 *
 * Pure, so the thresholds are unit-testable and the component only has to apply what this decides.
 * The widths are the printable area of A4 at 96 CSS px/inch, less the margins in `@page`.
 */

/** Millimetres to CSS pixels at the 96dpi the browser lays print out in. */
const MM_TO_PX = 96 / 25.4;

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/**
 * The page margin, in inches — and the single source of truth for it.
 *
 * The approval note emits its own `@page` rule from `E_APPROVAL_PAGE_MARGIN_CSS` rather than
 * inheriting the app-wide one, so this constant is both what the paper gets and what the fit is
 * calculated against. That matters more than it looks: a margin set in CSS and a width assumed here
 * that disagree by a few millimetres produce a note that is scaled to *almost* fit, and the symptom
 * is a last column shaved off the right edge with nothing to explain it.
 */
export const E_APPROVAL_PAGE_MARGIN_IN = 0.5;
export const E_APPROVAL_PAGE_MARGIN_CSS = `${E_APPROVAL_PAGE_MARGIN_IN}in`;

const MARGIN_PX = E_APPROVAL_PAGE_MARGIN_IN * 96;

/**
 * Head-room between the paper and what the content is fitted to.
 *
 * The arithmetic below is exact — measured against a real table in Chrome it lands within 0.3px of
 * the target — and the printed note still lost its right-hand border and the last digit of the last
 * column. The difference is the print pipeline rather than the maths: device-pixel snapping, a
 * collapsed outer border that straddles the table's border box, and the printer driver rounding the
 * margins it was asked for. None of that is visible from the page, so it is absorbed rather than
 * modelled.
 *
 * Deliberately generous and deliberately cheap: 2% of an A4 width is about 4mm, a scale change no
 * reader notices, against a failure mode where a figure silently loses a digit on a document
 * somebody signs. If a sliver is still lost on a particular printer, raise this — it is the one
 * number to turn.
 */
export const PRINT_SAFETY_FRACTION = 0.02;
const PRINT_SAFETY_PX = 2;

const printableWidth = (paperMm: number): number =>
  Math.floor((paperMm * MM_TO_PX - MARGIN_PX * 2) * (1 - PRINT_SAFETY_FRACTION) - PRINT_SAFETY_PX);

export const PORTRAIT_CONTENT_PX = printableWidth(A4_WIDTH_MM);
export const LANDSCAPE_CONTENT_PX = printableWidth(A4_HEIGHT_MM);

/**
 * How small the proposal may be shrunk before rotating the page is the better answer.
 *
 * 0.8 rather than something lower because this is a financial document read off paper: below about
 * four-fifths, an 11px table cell stops being comfortably legible, and a note-sheet whose figures
 * have to be squinted at gets queried rather than signed.
 */
export const MIN_READABLE_SCALE = 0.8;

/** Nothing is shrunk past this even in landscape — beyond it the content is simply too wide. */
export const MIN_SCALE = 0.45;

export type PrintOrientation = 'portrait' | 'landscape';

export interface EApprovalPrintFit {
  orientation: PrintOrientation;
  /** 1 when nothing needs shrinking. Never above 1: a narrow proposal is not blown up. */
  scale: number;
  /** The printable width the decision was made against, for the caller's own layout. */
  contentWidthPx: number;
  /** True when even the floor was not enough and the content will still be clipped. */
  clipped: boolean;
}

export interface EApprovalPrintFitOptions {
  /** Forces an orientation, for the manual override on the print bar. */
  force?: PrintOrientation;
  /** Overridden in tests; defaults to the A4 figures above. */
  portraitPx?: number;
  landscapePx?: number;
  minReadableScale?: number;
  minScale?: number;
}

const clampScale = (scale: number, floor: number): number =>
  Math.min(1, Math.max(floor, Number.isFinite(scale) ? scale : 1));

/**
 * How to print a proposal whose natural width is `naturalWidthPx`.
 *
 * `naturalWidthPx` is what the content wants — the widest of the block's own `scrollWidth` and the
 * `scrollWidth` of any table inside it, measured on screen. Measured rather than assumed because a
 * pasted table carries its own column widths, and the only way to know what it needs is to let it
 * lay out and look.
 */
export function eApprovalPrintFit(
  naturalWidthPx: number,
  options: EApprovalPrintFitOptions = {},
): EApprovalPrintFit {
  const portrait = options.portraitPx ?? PORTRAIT_CONTENT_PX;
  const landscape = options.landscapePx ?? LANDSCAPE_CONTENT_PX;
  const readable = options.minReadableScale ?? MIN_READABLE_SCALE;
  const floor = options.minScale ?? MIN_SCALE;

  const natural = Number.isFinite(naturalWidthPx) && naturalWidthPx > 0 ? naturalWidthPx : 0;

  const fitIn = (width: number): EApprovalPrintFit => {
    const wanted = natural > width ? width / natural : 1;
    const scale = clampScale(wanted, floor);
    return {
      orientation: width === landscape ? 'landscape' : 'portrait',
      scale,
      contentWidthPx: width,
      // Rounded before comparing: a scale of 0.4499999 from floating-point division is the floor,
      // not a hair under it, and reporting that as clipped would put a warning on a note that is fine.
      clipped: Math.round(natural * scale) > width + 1,
    };
  };

  if (options.force) return fitIn(options.force === 'landscape' ? landscape : portrait);

  // Nothing to do, and nothing to explain to the user.
  if (natural <= portrait) return fitIn(portrait);

  // A mild shrink keeps the note portrait, which is how it is filed.
  if (portrait / natural >= readable) return fitIn(portrait);

  return fitIn(landscape);
}

/** "Shrunk to 82% to fit" / "Printed landscape" — what the print bar tells the user it did. */
export function describeEApprovalPrintFit(fit: EApprovalPrintFit): string {
  const percent = Math.round(fit.scale * 100);
  if (fit.clipped) {
    return `Too wide even at ${percent}% on ${fit.orientation} — the proposal will be clipped.`;
  }
  if (fit.orientation === 'landscape' && fit.scale < 1) {
    return `Landscape, scaled to ${percent}% so the proposal fits.`;
  }
  if (fit.orientation === 'landscape') return 'Landscape, so the proposal fits.';
  if (fit.scale < 1) return `Proposal scaled to ${percent}% to fit the page.`;
  return 'Fits the page.';
}
