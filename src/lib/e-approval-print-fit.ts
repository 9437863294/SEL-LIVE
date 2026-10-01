/**
 * Making a pasted proposal fit the printed approval note.
 *
 * The proposal is rich text, and people paste rate tables and comparative statements straight out of
 * Excel. A twelve-column comparison is wider than A4 whatever you do to the margins, and the browser
 * simply clips it — so the note that gets signed and filed is missing the last four columns, with
 * nothing on the paper to say so. That is the failure this exists to stop.
 *
 * **Shrinking is the only automatic lever, and it fits portrait.** Rotating used to be automatic,
 * and it is the reason a note came off the printer missing its entire amount column: `@page { size:
 * A4 landscape }` is a *request*. The print dialog's own orientation control can override it, and
 * when it does, a block laid out for the 1003px landscape width lands on a 681px portrait page and
 * the browser simply clips the difference — 322px of it, measured. There is no API that tells the
 * page which way the paper actually came out, so the fit cannot depend on being obeyed: it targets
 * the narrower of the two, and then fits on either.
 *
 * Landscape is still available, as the explicit choice on the print bar. `suggestLandscape` says
 * when it is worth offering, so a rate table that portrait can only manage at 60% is a decision the
 * user is invited to make rather than one taken behind their back.
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
 * How small the proposal may be shrunk before landscape is worth offering to the user.
 *
 * 0.8 rather than something lower because this is a financial document read off paper: below about
 * four-fifths, an 11px table cell stops being comfortably legible, and a note-sheet whose figures
 * have to be squinted at gets queried rather than signed. Below this the fit still prints — it just
 * raises `suggestLandscape` so the print bar can say there is a better option.
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
  /**
   * True when portrait can only manage this proposal below `MIN_READABLE_SCALE`, so rotating is
   * worth offering. Never set when the caller already forced an orientation — the decision is made.
   */
  suggestLandscape: boolean;
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

  const fitIn = (width: number, suggestLandscape: boolean): EApprovalPrintFit => {
    const wanted = natural > width ? width / natural : 1;
    const scale = clampScale(wanted, floor);
    return {
      orientation: width === landscape ? 'landscape' : 'portrait',
      scale,
      contentWidthPx: width,
      // Rounded before comparing: a scale of 0.4499999 from floating-point division is the floor,
      // not a hair under it, and reporting that as clipped would put a warning on a note that is fine.
      clipped: Math.round(natural * scale) > width + 1,
      suggestLandscape,
    };
  };

  if (options.force) return fitIn(options.force === 'landscape' ? landscape : portrait, false);

  // Portrait, always — see the note at the top of this file. Shrinking is safe on either paper;
  // rotating is safe only if the print dialog agrees to it, and it need not.
  return fitIn(portrait, natural > portrait && portrait / natural < readable);
}

/**
 * The gutter the sheet leaves at its right-hand edge in print — **as a percentage**.
 *
 * The unit is the whole point, and getting it wrong costs a usable note either way.
 *
 * The sheet is a block that fills its layout viewport, and that viewport is *not* reliably the
 * paper's width: "Fit to printable area" in the print dialog lays the page out wider and then scales
 * the whole thing down to fit. So the mapping from layout pixels to paper is some unknown factor —
 * which means a physical cap like `calc(210mm - 1in)` is wrong. Tried, and measured: the sheet is
 * capped at 684 layout px, the page is then scaled by ~0.48, and the note prints at 329px on a 698px
 * page — a third of the sheet used, the rest blank. A millimetre is not a millimetre once the page
 * is being scaled.
 *
 * A percentage is right in both modes, because 100% of the layout viewport *is* the printable width
 * by definition, whatever the scale factor between them. So the sheet keeps its full width and full
 * text size, and gives up only this much at the right edge.
 *
 * Why give up anything: with the sheet flush to both edges, right-aligned content sits exactly on
 * the boundary and the print pipeline shaves it. The symptom is small and easy to miss — a note came
 * back reading "Please chec" and "recorded electronically abov", one or two characters short, on a
 * document somebody signs. `PRINT_SAFETY_FRACTION` of the page is about 4mm and ~14px of headroom at
 * A4, against losing the end of a sentence.
 *
 * Paired with `margin-left: 0`: the sheet is flush left and gives its slack to the right, where the
 * shave happens. Centring it would halve the allowance for no gain.
 */
export const E_APPROVAL_PRINT_GUTTER_CSS = `${(PRINT_SAFETY_FRACTION * 100).toFixed(1)}%`;

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
  if (fit.suggestLandscape) {
    return `Proposal scaled to ${percent}% to fit — landscape would print it larger.`;
  }
  if (fit.scale < 1) return `Proposal scaled to ${percent}% to fit the page.`;
  return 'Fits the page.';
}
