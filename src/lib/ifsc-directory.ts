/**
 * Bank branch names from an IFSC, for the places greytHR gives only a branch code.
 *
 * greytHR's bank record sends `bankBranch: 207` — an id into a branch master it does not publish
 * (no `lov::` list answers for it; probed 2026-11-12) — alongside `branchCode`, which is the IFSC.
 * An IFSC names exactly one branch, so the name comes from Razorpay's free public IFSC directory,
 * `https://ifsc.razorpay.com/<IFSC>` (RBI's list, republished). Chosen by the user on 2026-11-12.
 *
 * Only the IFSC is sent — never anything about the employee — and only a well-formed one. Each code
 * is asked about once per server process: found names are kept for a month, an unknown code for a
 * day, and a failure for ten minutes, so one bad moment of the directory's does not stick. A lookup
 * that fails costs the branch name, never the record: callers fall back to what greytHR sent.
 *
 * Server code only. Self-contained (no imports) so the tests can run it directly.
 */

export interface IfscBranch {
  ifsc: string;
  bank: string | null;
  branch: string;
  city: string | null;
  state: string | null;
}

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const DIRECTORY_URL = 'https://ifsc.razorpay.com/';

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UNKNOWN_TTL_MS = 24 * 60 * 60 * 1000;
const FAILED_TTL_MS = 10 * 60 * 1000;

/** The IFSC in its canonical form (upper case, trimmed), or null when it is not one. */
export function normaliseIfsc(value: unknown): string | null {
  const code = String(value ?? '').trim().toUpperCase();
  return IFSC_PATTERN.test(code) ? code : null;
}

const field = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
};

/** The directory's answer, or null when it is not a branch record. */
export function parseIfscRecord(ifsc: string, json: unknown): IfscBranch | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const raw = json as Record<string, unknown>;
  const branch = field(raw.BRANCH);
  if (!branch) return null;
  return { ifsc, bank: field(raw.BANK), branch, city: field(raw.CITY) ?? field(raw.DISTRICT), state: field(raw.STATE) };
}

/** "NEO BANKING - JUPITER, ERNAKULAM": the branch, then its city unless the name already says it. */
export function branchLabel(entry: IfscBranch): string {
  const { branch, city } = entry;
  if (!city || branch.toLowerCase().includes(city.toLowerCase())) return branch;
  return `${branch}, ${city}`;
}

type Outcome = { kind: 'found'; value: IfscBranch } | { kind: 'unknown' } | { kind: 'failed' };

export interface IfscDirectoryOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** How many codes are asked about at once — the directory is free; be polite to it. */
  concurrency?: number;
}

export function createIfscDirectory({ fetchImpl = fetch, now = Date.now, timeoutMs = 5000, concurrency = 4 }: IfscDirectoryOptions = {}) {
  const cache = new Map<string, { expires: number; outcome: Outcome }>();
  const inFlight = new Map<string, Promise<Outcome>>();

  async function ask(ifsc: string): Promise<Outcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${DIRECTORY_URL}${ifsc}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (response.status === 404) return { kind: 'unknown' };
      if (!response.ok) return { kind: 'failed' };
      const value = parseIfscRecord(ifsc, await response.json());
      return value ? { kind: 'found', value } : { kind: 'unknown' };
    } catch {
      return { kind: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** One IFSC's branch, or null when it is malformed, unknown, or the directory could not answer. */
  async function lookup(code: unknown): Promise<IfscBranch | null> {
    const ifsc = normaliseIfsc(code);
    if (!ifsc) return null;
    const cached = cache.get(ifsc);
    if (cached && cached.expires > now()) return cached.outcome.kind === 'found' ? cached.outcome.value : null;

    let pending = inFlight.get(ifsc);
    if (!pending) {
      pending = ask(ifsc).then((outcome) => {
        const ttl = outcome.kind === 'found' ? FOUND_TTL_MS : outcome.kind === 'unknown' ? UNKNOWN_TTL_MS : FAILED_TTL_MS;
        cache.set(ifsc, { expires: now() + ttl, outcome });
        inFlight.delete(ifsc);
        return outcome;
      });
      inFlight.set(ifsc, pending);
    }
    const outcome = await pending;
    return outcome.kind === 'found' ? outcome.value : null;
  }

  /**
   * IFSC → branch label for every code given that the directory knows, keyed by the canonical IFSC.
   * Duplicates and malformed codes are dropped first; never throws.
   */
  async function branchNames(codes: Iterable<unknown>): Promise<Record<string, string>> {
    const unique = [...new Set([...codes].map(normaliseIfsc).filter((code): code is string => code !== null))];
    const out: Record<string, string> = {};
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const ifsc = unique[next++];
        const entry = await lookup(ifsc);
        if (entry) out[ifsc] = branchLabel(entry);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
    return out;
  }

  return { lookup, branchNames };
}

const directory = createIfscDirectory();

/** IFSC → branch label, through this process's shared directory and its cache. */
export const lookupBranchNames = (codes: Iterable<unknown>): Promise<Record<string, string>> => directory.branchNames(codes);
