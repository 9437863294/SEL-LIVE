/**
 * Reading an odometer off a photo's OCR text (decision D2: Google Cloud Vision on the server).
 *
 * OCR returns every piece of text in the frame — the trip meter, the clock, the fuel gauge's
 * numbers, a speedometer's scale. The odometer is picked as the number that is plausible for this
 * vehicle: not below its last reading, and not absurdly far above it. The result is only ever a
 * suggestion; the driver confirms or corrects the reading, and the photo is kept.
 */

export interface OcrPick {
  km: number | null;
  candidates: number[];
}

/** Numbers in the text, with thousands separators and spaces between digit groups joined. */
export function numbersIn(text: string): number[] {
  const found = new Set<number>();
  const normalised = text.replace(/(\d)[ ,.'](?=\d{3}\b)/g, '$1');
  for (const match of normalised.matchAll(/\d{3,7}/g)) found.add(Number(match[0]));
  return [...found];
}

export function pickOdometer(text: string, context: { lastKm: number | null; maxJumpKm?: number }): OcrPick {
  const candidates = numbersIn(text);
  const maxJump = context.maxJumpKm ?? 3000;
  const last = context.lastKm;
  const plausible = candidates.filter((value) => (last === null ? value >= 10 : value >= last && value <= last + maxJump));
  if (!plausible.length) return { km: null, candidates };
  // Closest to the last reading when there is one (an odometer moves little between photos),
  // otherwise the longest number in the frame — the odometer has the most digits on the dash.
  const km = last === null ? plausible.sort((a, b) => String(b).length - String(a).length || b - a)[0] : plausible.sort((a, b) => a - b)[0];
  return { km, candidates };
}
