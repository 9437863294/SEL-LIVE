import 'server-only';

/**
 * The greytHR HTTP client — everything that talks to the API, and nothing that decides anything.
 *
 * Rules live in `greythr.ts`; Firestore lives in `greythr-sync-service.ts`. This file's whole job is
 * to turn "give me every employee modified since Tuesday" into paginated, authenticated, retried
 * HTTP and hand back typed rows.
 *
 * ── Four things about this API that shape the client ────────────────────────────────────────────
 *
 *   1. **The token lasts an hour and the sync takes minutes.** `expires_in` is 3599, so a run that
 *      pages through 1,300 employees across four endpoints must not fetch a token per request. The
 *      token is cached at module scope with a safety margin, which on a warm serverless instance
 *      also spares the next run the round trip.
 *
 *   2. **Two headers, not a bearer.** greytHR wants `ACCESS-TOKEN: <token>` plus
 *      `x-greythr-domain: <tenant>.greythr.com`. Sending `Authorization: Bearer` — the obvious
 *      guess — returns 401 with no useful message.
 *
 *   3. **No documented rate limit.** So one is assumed. Requests are serialised per endpoint with a
 *      small delay, and 429/5xx are retried with exponential backoff honouring `Retry-After`. An
 *      integration that hammers an HR system until it blocks the tenant is worse than a slow one.
 *
 *   4. **Pagination is zero-indexed here and one-indexed in the docs.** The published samples show
 *      `?page=1`, but the response envelope reports `first: true` for page 0. Paging is driven by
 *      `pages.hasNext` from 0 rather than by trusting either, with a hard page cap so a malformed
 *      envelope cannot spin forever.
 */

import {
  GREYTHR_ADDRESS_TYPES,
  GREYTHR_CATEGORY_LOV_KEYS,
  GREYTHR_IDENTITY_CODES,
  GREYTHR_LOV_KEYS,
  isGreytHRTimestamp,
  type GreytHRAttendanceInsightRow,
  type GreytHRAddressRow,
  type GreytHRAddressType,
  type GreytHRAssetRow,
  type GreytHRBankRow,
  type GreytHRCategoryEntry,
  type GreytHRCategoryRow,
  type GreytHRDocumentCategoryRow,
  type GreytHREmployeeRow,
  type GreytHRIdentityCode,
  type GreytHRIdentityRow,
  type GreytHRLeaveBalanceDetail,
  type GreytHRLeaveBalanceRow,
  type GreytHRLovResponse,
  type GreytHROrgTreeRow,
  type GreytHRPagedResponse,
  type GreytHRPersonalRow,
  type GreytHRPfRow,
  type GreytHRProfileRow,
  type GreytHRQualificationRow,
  type GreytHRSeparationRow,
  type GreytHRStatutoryRow,
  type GreytHRTravelDocRow,
  type GreytHRWorkRow,
} from './greythr';

/* ------------------------------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------------------------------- */

/** The tenant host. Not a secret — it appears in every request header and in the login URL. */
const DEFAULT_DOMAIN = 'siddhartha.greythr.com';

const API_BASE = 'https://api.greythr.com';

export class GreytHRError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'GreytHRError';
  }
}

export interface GreytHRConfig {
  domain: string;
  username: string;
  password: string;
}

/**
 * Read credentials from the environment.
 *
 * Throws rather than falling back to a literal. The previous flows carried
 * `process.env.GREYTHR_PASSWORD || "<a real API key>"`, which meant the key was committed to the
 * repository and a missing environment variable failed silently into using it. A thrown error at
 * startup is the behaviour that gets the variable configured.
 */
export function greytHRConfig(): GreytHRConfig {
  const username = process.env.GREYTHR_USERNAME?.trim();
  const password = process.env.GREYTHR_PASSWORD?.trim();
  const domain = process.env.GREYTHR_DOMAIN?.trim() || DEFAULT_DOMAIN;

  if (!username || !password) {
    throw new GreytHRError(
      'GREYTHR_USERNAME and GREYTHR_PASSWORD must be configured. Set them as secrets — never in source.',
    );
  }
  return { domain, username, password };
}

/** Whether the integration is configured at all, for the settings screen to report. */
export const isGreytHRConfigured = (): boolean =>
  Boolean(process.env.GREYTHR_USERNAME?.trim() && process.env.GREYTHR_PASSWORD?.trim());

/* ------------------------------------------------------------------------------------------------
 * Token
 * ---------------------------------------------------------------------------------------------- */

interface CachedToken {
  token: string;
  /** Epoch ms after which the token must not be reused. */
  expiresAt: number;
  domain: string;
}

let cachedToken: CachedToken | null = null;
let inFlightToken: Promise<string> | null = null;

/** Refresh this long before the stated expiry, so a long page never dies mid-run. */
const TOKEN_SAFETY_MARGIN_MS = 120_000;

/**
 * A valid access token, cached.
 *
 * Concurrent callers share one in-flight request: a run that starts four endpoint fetches at once
 * would otherwise mint four tokens, and some tenants rate-limit the token endpoint hardest of all.
 */
export async function getGreytHRToken(config = greytHRConfig()): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.domain === config.domain && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }
  if (inFlightToken) return inFlightToken;

  inFlightToken = (async () => {
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const url = `https://${config.domain}/uas/v1/oauth2/client-token`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GreytHRError(
        `greytHR authentication failed (${response.status}). Check GREYTHR_USERNAME / GREYTHR_PASSWORD. ${body.slice(0, 300)}`,
        response.status,
        'client-token',
      );
    }

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new GreytHRError('greytHR returned no access_token.', response.status, 'client-token');
    }

    const lifetimeMs = (typeof json.expires_in === 'number' ? json.expires_in : 3599) * 1000;
    cachedToken = {
      token: json.access_token,
      expiresAt: Date.now() + Math.max(lifetimeMs - TOKEN_SAFETY_MARGIN_MS, 30_000),
      domain: config.domain,
    };
    return json.access_token;
  })();

  try {
    return await inFlightToken;
  } finally {
    inFlightToken = null;
  }
}

/** Drop the cached token. Used when a 401 suggests it was revoked mid-run. */
export const invalidateGreytHRToken = (): void => {
  cachedToken = null;
};

/* ------------------------------------------------------------------------------------------------
 * Request plumbing
 * ---------------------------------------------------------------------------------------------- */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Politeness delay between sequential page requests. */
const INTER_REQUEST_DELAY_MS = 120;
const MAX_ATTEMPTS = 4;
/** Hard ceiling on pages, so a malformed `hasNext` cannot loop forever. */
const MAX_PAGES = 200;

interface RequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  config?: GreytHRConfig;
  /** Endpoint label for error messages. */
  label?: string;
}

/**
 * One authenticated request, with retries.
 *
 * Retries 429 and 5xx with exponential backoff, honouring `Retry-After` when the server sends it. A
 * 401 refreshes the token once and retries — tokens do get revoked mid-run when an administrator
 * regenerates credentials, and failing the whole sync for that is avoidable.
 *
 * 4xx other than 401/429 is not retried: a 403 or a 404 will still be a 403 or a 404 in two seconds.
 */
async function greytHRRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const config = options.config ?? greytHRConfig();
  const label = options.label ?? path;

  const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const token = await getGreytHRToken(config);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: options.method ?? 'GET',
        headers: {
          'ACCESS-TOKEN': token,
          'x-greythr-domain': config.domain,
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      // Network-level failure: worth retrying, a transient DNS or socket error is common enough.
      lastError = error;
      if (attempt === MAX_ATTEMPTS) {
        throw new GreytHRError(
          `greytHR request to ${label} failed: ${error instanceof Error ? error.message : 'network error'}`,
          undefined,
          label,
        );
      }
      await sleep(2 ** attempt * 250);
      continue;
    }

    if (response.ok) return (await response.json()) as T;

    if (response.status === 401 && attempt < MAX_ATTEMPTS) {
      invalidateGreytHRToken();
      await sleep(250);
      continue;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      await sleep(Math.min(waitMs, 30_000));
      continue;
    }

    const body = await response.text().catch(() => '');
    throw new GreytHRError(
      `greytHR ${label} returned ${response.status}. ${body.slice(0, 300)}`,
      response.status,
      label,
    );
  }

  throw new GreytHRError(
    `greytHR ${label} failed after ${MAX_ATTEMPTS} attempts. ${lastError instanceof Error ? lastError.message : ''}`,
    undefined,
    label,
  );
}

/**
 * Walk every page of a paginated endpoint.
 *
 * Driven by `pages.hasNext` from page 0. A page that comes back empty also stops the walk — some
 * endpoints report `hasNext: true` on the final page, and trusting the flag alone would spin until
 * the page cap.
 */
async function fetchAllPages<T>(
  path: string,
  options: RequestOptions & { size?: number } = {},
): Promise<{ rows: T[]; pages: number }> {
  const size = options.size ?? 500;
  const rows: T[] = [];
  let page = 0;

  while (page < MAX_PAGES) {
    const json = await greytHRRequest<GreytHRPagedResponse<T>>(path, {
      ...options,
      query: { ...options.query, page, size },
    });

    const batch = Array.isArray(json?.data) ? json.data : [];
    rows.push(...batch);

    const hasNext = json?.pages?.hasNext === true;
    if (!hasNext || batch.length === 0) return { rows, pages: page + 1 };

    page += 1;
    await sleep(INTER_REQUEST_DELAY_MS);
  }

  // Reaching the cap is a bug or a very large tenant; returning what we have beats throwing away a
  // run's worth of work, and the caller records it as a warning.
  return { rows, pages: page };
}

/* ------------------------------------------------------------------------------------------------
 * Endpoints
 * ---------------------------------------------------------------------------------------------- */

export type EmployeeState = 'ALL' | 'CURRENT' | 'RESIGNED';

export interface FetchEmployeesOptions {
  /**
   * `ALL` by default, and that matters: the previous sync used `CURRENT`, which excludes resigned
   * employees — so nobody could ever be detected as having left.
   */
  state?: EmployeeState;
  /**
   * `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ssZ`. Incremental sync.
   *
   * Build it with `modifiedSinceFor`. The trailing `Z` is required and milliseconds are rejected —
   * greytHR answers anything else with a 400 and no indication of which parameter it disliked.
   */
  modifiedSince?: string | null;
  size?: number;
  config?: GreytHRConfig;
}

export async function fetchEmployees(
  options: FetchEmployeesOptions = {},
): Promise<{ rows: GreytHREmployeeRow[]; pages: number }> {
  /**
   * Checked here rather than trusted, because the failure is expensive to read.
   *
   * greytHR's 400 names neither the parameter nor the value, so a malformed timestamp presents as
   * "greytHR employees returned 400" and could as easily be a credential or a scope problem. And the
   * *silent* alternative — dropping a bad value and carrying on — would quietly turn every
   * incremental run into a full resync, which is slow rather than visibly broken.
   */
  if (options.modifiedSince && !isGreytHRTimestamp(options.modifiedSince)) {
    throw new Error(
      `modifiedSince "${options.modifiedSince}" is not a format greytHR accepts. ` +
        'Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ — note the required trailing Z and no milliseconds.',
    );
  }

  return fetchAllPages<GreytHREmployeeRow>('/employee/v2/employees', {
    label: 'employees',
    size: options.size,
    config: options.config,
    query: {
      state: options.state ?? 'ALL',
      modifiedSince: options.modifiedSince ?? undefined,
    },
  });
}

export async function fetchSeparations(
  options: { size?: number; config?: GreytHRConfig } = {},
): Promise<{ rows: GreytHRSeparationRow[]; pages: number }> {
  return fetchAllPages<GreytHRSeparationRow>('/employee/v2/employees/separation', {
    label: 'separation',
    size: options.size,
    config: options.config,
  });
}

/**
 * Every employee's category assignments.
 *
 * `descRequired=true` is what makes this useful: without it the response carries only numeric
 * `category`/`value` ids that would have to be resolved against the LOV endpoint. With it, each row
 * carries `categoryDesc` and `valueDesc` — so designation, department and project arrive as names
 * and the tenant is free to rename or add categories without this code changing.
 */
export async function fetchEmployeeCategories(
  options: { size?: number; config?: GreytHRConfig } = {},
): Promise<{ rows: GreytHRCategoryRow[]; pages: number }> {
  return fetchAllPages<GreytHRCategoryRow>('/employee/v2/employees/categories', {
    label: 'categories',
    size: options.size,
    config: options.config,
    query: { descRequired: 'true' },
  });
}

export async function fetchEmployeeWork(
  options: { size?: number; config?: GreytHRConfig } = {},
): Promise<{ rows: GreytHRWorkRow[]; pages: number }> {
  return fetchAllPages<GreytHRWorkRow>('/employee/v2/employees/work', {
    label: 'work',
    size: options.size,
    config: options.config,
  });
}

/**
 * List-of-values lookup.
 *
 * `POST` with a JSON array of keys — `lov::status` for employment types, `cat::Designation` and
 * friends for category values. Returns `{ "lov::status": [[2, "Confirmed"], …] }`.
 */
export async function fetchLov(
  keys: string[],
  options: { config?: GreytHRConfig } = {},
): Promise<GreytHRLovResponse> {
  if (!keys.length) return {};
  return greytHRRequest<GreytHRLovResponse>('/hr/v2/lov', {
    method: 'POST',
    body: keys,
    label: 'lov',
    config: options.config,
  });
}

/** The LOV keys this integration needs: employment types plus every category list. */
export async function fetchReferenceData(
  options: { config?: GreytHRConfig } = {},
): Promise<GreytHRLovResponse> {
  return fetchLov([...GREYTHR_LOV_KEYS, ...GREYTHR_CATEGORY_LOV_KEYS], options);
}

/* ------------------------------------------------------------------------------------------------
 * Detail groups
 * ---------------------------------------------------------------------------------------------- */

/**
 * The bulk detail endpoints, one fetcher each.
 *
 * All follow the same paginated `{data, pages}` envelope as the core endpoints, so `fetchAllPages`
 * does the work. The parameterised ones — addresses by type, identities by code — are fanned out
 * over their documented value lists, because greytHR offers no "all types" variant.
 */

export const fetchEmployeeProfiles = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHRProfileRow>('/employee/v2/employees/profile', {
    label: 'profile',
    ...options,
  });

export const fetchEmployeePersonal = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHRPersonalRow>('/employee/v2/employees/personal', {
    label: 'personal',
    ...options,
  });

export const fetchEmployeeOrgTree = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHROrgTreeRow>('/employee/v2/employees/org-tree', {
    label: 'org-tree',
    ...options,
  });

export const fetchEmployeeQualifications = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHRQualificationRow>('/employee/v2/employees/qualifications', {
    label: 'qualifications',
    ...options,
  });

export const fetchEmployeeAssets = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHRAssetRow>('/employee/v2/employees/assets', {
    label: 'assets',
    ...options,
  });

export const fetchEmployeeStatutory = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHRStatutoryRow>('/employee/v2/employees/statutory/india', {
    label: 'statutory',
    ...options,
  });

export const fetchEmployeeBank = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHRBankRow>('/employee/v2/employees/bank', {
    label: 'bank',
    ...options,
  });

export const fetchEmployeePf = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHRPfRow>('/employee/v2/employees/pf', { label: 'pf', ...options });

export const fetchEmployeePassports = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHRTravelDocRow>('/employee/v2/employees/passport', {
    label: 'passport',
    ...options,
  });

export const fetchEmployeeVisas = (options: { size?: number; config?: GreytHRConfig } = {}) =>
  fetchAllPages<GreytHRTravelDocRow>('/employee/v2/employees/visa', { label: 'visa', ...options });

/**
 * Addresses, fanned out over the five documented types.
 *
 * A failing type is skipped rather than failing the group: a tenant that has never used
 * `spouseaddress` may well 404 on it, and losing the present address over that would be perverse.
 */
export async function fetchEmployeeAddresses(
  options: { size?: number; config?: GreytHRConfig } = {},
): Promise<{ byType: Partial<Record<GreytHRAddressType, GreytHRAddressRow[]>>; failed: string[] }> {
  const byType: Partial<Record<GreytHRAddressType, GreytHRAddressRow[]>> = {};
  const failed: string[] = [];

  for (const type of GREYTHR_ADDRESS_TYPES) {
    try {
      const { rows } = await fetchAllPages<GreytHRAddressRow>(
        `/employee/v2/employees/addresses/${type}`,
        { label: `addresses/${type}`, ...options },
      );
      byType[type] = rows;
    } catch {
      failed.push(type);
    }
  }

  return { byType, failed };
}

/** Identities, fanned out over the ten documented codes. Same per-code tolerance. */
export async function fetchEmployeeIdentities(
  options: { size?: number; config?: GreytHRConfig; codes?: readonly GreytHRIdentityCode[] } = {},
): Promise<{ byCode: Partial<Record<GreytHRIdentityCode, GreytHRIdentityRow[]>>; failed: string[] }> {
  const byCode: Partial<Record<GreytHRIdentityCode, GreytHRIdentityRow[]>> = {};
  const failed: string[] = [];

  for (const code of options.codes ?? GREYTHR_IDENTITY_CODES) {
    try {
      const { rows } = await fetchAllPages<GreytHRIdentityRow>(
        `/employee/v2/employees/identities/${code}`,
        { label: `identities/${code}`, size: options.size, config: options.config },
      );
      byCode[code] = rows;
    } catch {
      failed.push(code);
    }
  }

  return { byCode, failed };
}

/* ------------------------------------------------------------------------------------------------
 * Documents
 * ---------------------------------------------------------------------------------------------- */

/**
 * One employee's document categories, documents and files.
 *
 * `categoryId` omitted deliberately — it is optional upstream, and omitting it returns every
 * category the employee has. Since greytHR publishes no way to *list* document categories, asking
 * for all of them is the only way to discover which exist.
 *
 * Returns a bare array, not the `{data, pages}` envelope the employee endpoints use.
 */
export async function fetchEmployeeDocuments(
  employeeId: string | number,
  options: { config?: GreytHRConfig; categoryId?: string | number } = {},
): Promise<GreytHRDocumentCategoryRow[]> {
  const id = String(employeeId);
  const path = options.categoryId
    ? `/employee/v2/emp-docs/${encodeURIComponent(id)}/${encodeURIComponent(String(options.categoryId))}`
    : `/employee/v2/emp-docs/${encodeURIComponent(id)}`;

  const json = await greytHRRequest<GreytHRDocumentCategoryRow[] | { data?: GreytHRDocumentCategoryRow[] }>(
    path,
    { label: `documents ${id}`, config: options.config },
  );
  if (Array.isArray(json)) return json;
  return Array.isArray(json?.data) ? json.data : [];
}

/**
 * One document file, as bytes.
 *
 * Deliberately not routed through `greytHRRequest`, which parses JSON. The retry and token handling
 * are repeated here in a smaller form because a binary body cannot be re-read after a failed parse,
 * and conflating the two would mean either JSON callers get an ArrayBuffer or this one gets a
 * `SyntaxError` on a perfectly good PDF.
 */
export async function fetchEmployeeDocumentFile(
  employeeId: string,
  documentId: string,
  fileId: string,
  options: { config?: GreytHRConfig } = {},
): Promise<{ bytes: ArrayBuffer; upstreamContentType: string | null }> {
  const config = options.config ?? greytHRConfig();
  const url =
    `${API_BASE}/employee/v2/emp-docs/${encodeURIComponent(employeeId)}` +
    `/${encodeURIComponent(documentId)}/${encodeURIComponent(fileId)}`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const token = await getGreytHRToken(config);
    const response = await fetch(url, {
      headers: { 'ACCESS-TOKEN': token, 'x-greythr-domain': config.domain },
    });

    if (response.ok) {
      return {
        bytes: await response.arrayBuffer(),
        upstreamContentType: response.headers.get('content-type'),
      };
    }

    if (response.status === 401 && attempt < 3) {
      invalidateGreytHRToken();
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await sleep(2 ** attempt * 400);
      continue;
    }

    throw new GreytHRError(
      `greytHR document download returned ${response.status}.`,
      response.status,
      'document download',
    );
  }

  throw new GreytHRError('greytHR document download failed after 3 attempts.', undefined, 'document download');
}

/* ------------------------------------------------------------------------------------------------
 * Leave and attendance
 * ---------------------------------------------------------------------------------------------- */

/** Every employee's leave balance for one year. */
export const fetchLeaveBalances = (
  year: string,
  options: { size?: number; config?: GreytHRConfig } = {},
) =>
  fetchAllPages<GreytHRLeaveBalanceRow>(
    `/leave/v2/employee/years/${encodeURIComponent(year)}/balance`,
    { label: `leave balance ${year}`, ...options },
  );

/**
 * One employee's detailed balance, fetched purely to learn the leave-type names.
 *
 * The bulk endpoint returns `leaveTypeCategory` as a bare id and there is no LOV key for leave
 * types, so without this a report reads "leave type 3: 5 days". Leave types are organisation-wide,
 * so one call for any employee yields the dictionary for everybody.
 */
export const fetchLeaveTypeDictionary = (
  employeeId: string | number,
  year: string,
  options: { config?: GreytHRConfig } = {},
) =>
  greytHRRequest<GreytHRLeaveBalanceDetail>(
    `/leave/v2/employee/${encodeURIComponent(String(employeeId))}/years/${encodeURIComponent(year)}/balance`,
    { label: 'leave type dictionary', config: options.config },
  );

/**
 * Every employee's aggregate attendance over a date range.
 *
 * `start` and `end` are the same date grammar as `modifiedSince`, so they get the same check. These
 * two come from `currentAttendancePeriod`, which produces plain `YYYY-MM-DD` and is therefore already
 * valid — the guard is here so that stays true if a caller ever passes a computed instant instead.
 */
export const fetchAttendanceInsights = (
  start: string,
  end: string,
  options: { size?: number; config?: GreytHRConfig } = {},
) => {
  for (const [name, value] of [['start', start], ['end', end]] as const) {
    if (!isGreytHRTimestamp(value)) {
      throw new Error(
        `Attendance ${name} date "${value}" is not a format greytHR accepts. ` +
          'Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ.',
      );
    }
  }

  return fetchAllPages<GreytHRAttendanceInsightRow>('/attendance/v2/employee/insights', {
    label: 'attendance insights',
    query: { start, end },
    ...options,
  });
};

/* ------------------------------------------------------------------------------------------------
 * Single employee
 * ---------------------------------------------------------------------------------------------- */

export interface SingleEmployeeSnapshot {
  employee: GreytHREmployeeRow | null;
  separation: GreytHRSeparationRow | null;
  work: GreytHRWorkRow | null;
  /** Raw category entries. May carry numeric ids only — see the note below. */
  categories: GreytHRCategoryEntry[];
  /** Reference lists, fetched only when the category response lacks descriptions. */
  reference: GreytHRLovResponse | null;
}

/**
 * Everything greytHR knows about one employee, live.
 *
 * The awkward part: the *bulk* categories endpoint honours `descRequired=true` and returns
 * `categoryDesc`/`valueDesc`, but the single-employee endpoint returns a bare array of
 * `{category: 6, value: 31}` with no descriptions and no `data` envelope. So this asks for
 * descriptions anyway — harmless if ignored — and falls back to fetching the reference lists when
 * they do not arrive, which `normalizeCategories` can then resolve against.
 *
 * Used when an administrator picks an employee while creating a user, so the prefilled designation
 * and project are what greytHR says right now rather than whatever the last sync captured.
 */
export async function fetchSingleEmployee(
  employeeId: string | number,
  options: { config?: GreytHRConfig } = {},
): Promise<SingleEmployeeSnapshot> {
  const id = String(employeeId);
  const config = options.config ?? greytHRConfig();

  const settle = async <T>(promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch {
      // A missing separation or work record is normal for a current employee; a failure on one
      // supplementary endpoint must not lose the employee itself.
      return null;
    }
  };

  const [employee, separation, work, categoriesRaw] = await Promise.all([
    settle(
      greytHRRequest<GreytHREmployeeRow>(`/employee/v2/employees/${encodeURIComponent(id)}`, {
        label: `employee ${id}`,
        config,
      }),
    ),
    settle(
      greytHRRequest<GreytHRSeparationRow>(`/employee/v2/employees/${encodeURIComponent(id)}/separation`, {
        label: `separation ${id}`,
        config,
      }),
    ),
    settle(
      greytHRRequest<GreytHRWorkRow>(`/employee/v2/employees/${encodeURIComponent(id)}/work`, {
        label: `work ${id}`,
        config,
      }),
    ),
    settle(
      greytHRRequest<GreytHRCategoryEntry[] | GreytHRPagedResponse<GreytHRCategoryEntry>>(
        `/employee/v2/employees/${encodeURIComponent(id)}/categories`,
        { label: `categories ${id}`, config, query: { descRequired: 'true' } },
      ),
    ),
  ]);

  // The endpoint returns a bare array; tolerate an envelope in case that ever changes.
  const categories = Array.isArray(categoriesRaw)
    ? categoriesRaw
    : Array.isArray(categoriesRaw?.data)
      ? categoriesRaw.data
      : [];

  const hasDescriptions = categories.some((entry) => entry.categoryDesc || entry.valueDesc);
  const reference = hasDescriptions || categories.length === 0 ? null : await settle(fetchReferenceData({ config }));

  return { employee, separation, work, categories, reference };
}

/**
 * A cheap authenticated call, for the settings screen's "Test connection" button.
 *
 * Asks for one employee rather than a dedicated health endpoint (there isn't one), so a success
 * proves the credentials, the domain header and read permission all work.
 */
export async function testGreytHRConnection(): Promise<{
  ok: boolean;
  message: string;
  totalEmployees?: number;
}> {
  try {
    const config = greytHRConfig();
    const json = await greytHRRequest<GreytHRPagedResponse<GreytHREmployeeRow>>('/employee/v2/employees', {
      label: 'employees',
      config,
      query: { page: 0, size: 1, state: 'ALL' },
    });
    return {
      ok: true,
      message: `Connected to ${config.domain}.`,
      totalEmployees: json?.pages?.totalElements ?? undefined,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Connection failed.',
    };
  }
}
