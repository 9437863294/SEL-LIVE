/**
 * A place name short enough for a list: the reverse-geocoded address without the parts nobody
 * reads on a phone.
 *
 * Google returns "7RM5+R46, Gopabandhu Nagar, Bhubaneswar, Odisha 751003, India" — a plus code (for
 * a spot with no street address), the locality, the city, the state with the PIN, the country.
 * A trip list wants "Gopabandhu Nagar, Bhubaneswar". The full address stays on the trip and is
 * shown on its detail page and on hover.
 */

/** A plus code, alone or leading a segment ("7RM5+R46" / "7RM5+R46 Bhubaneswar"). */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3}\s*/i;
/** A segment holding a six-digit PIN ("Odisha 751003"). */
const PIN = /\b\d{6}\b/;
/** A bare door or plot number ("1015/433", "12-B"). */
const HOUSE_NUMBER = /^[\d\s/-]+[A-Z]?$/i;

export function shortPlace(address: string | null | undefined, parts = 2): string {
  const full = String(address ?? '').trim();
  if (!full) return '';
  const segments = full
    .split(',')
    .map((segment) => segment.trim().replace(PLUS_CODE, '').trim())
    .filter((segment) => segment && segment.toLowerCase() !== 'india' && !PIN.test(segment) && !HOUSE_NUMBER.test(segment));
  return segments.length ? segments.slice(0, parts).join(', ') : full;
}
