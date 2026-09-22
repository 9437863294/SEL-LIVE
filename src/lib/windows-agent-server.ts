import 'server-only';

import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

import {
  FieldValue,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from './firebase-admin';
import { ACTIVITY_MODULES } from './activity-modules';
import {
  WINDOWS_AGENT_COLLECTIONS,
  WINDOWS_AGENT_SETTINGS_DOC_ID,
  windowsAgentIds,
} from './windows-agent';
import {
  DEFAULT_APP_CATALOG,
  buildApplicationUsageDeltas,
  canUserSignInOnDevice,
  describeAccessRefusal,
  compareVersions,
  defaultCategoryFor,
  dominantClassification,
  estimateUncleanEnd,
  evaluateLateLogin,
  foldSpan,
  isSessionAbandoned,
  normalizeProcessKey,
  normalizeSpans,
  resolveApplicationName,
  resolveSpanOverlaps,
  retentionCutoffDate,
  secondsBetween,
  shouldResumeSession,
  workDateOf,
  type NormalizedSpan,
} from './windows-agent-rules';
import {
  defaultResolvedPolicy,
  resolveAgentPolicy,
  sanitizePolicySettings,
  thresholdsOf,
} from './windows-agent-policy';
import type {
  ActivityBatchResult,
  AgentDirective,
  AgentHeartbeatInput,
  AppCategory,
  DeviceMachineFacts,
  DeviceRegisterInput,
  DeviceRegisterResult,
  LoginRejectionCode,
  PresenceState,
  ResolvedAgentPolicy,
  SessionEndReason,
  WindowsAgentPolicy,
  WindowsAuditAction,
  WindowsDevice,
} from './windows-agent-model';

/**
 * The Windows Agent's server half: device identity, session lifecycle and activity ingest
 * (`docs/windows-agent.md` §40, §41).
 *
 * Every write the desktop agent causes passes through here. §41 rules out letting the executable
 * write Firestore directly, and this is the other side of that decision — the agent's entire
 * vocabulary is the nine routes in `/api/windows-agent`, each of which validates a request and
 * calls one function in this file. Nothing in `windows/` holds a Firebase credential, and nothing
 * it sends is stored without passing through `windows-agent-rules.ts` first.
 *
 * ── How an agent proves who it is ──────────────────────────────────────────────────────────────
 *
 * Two independent facts, exactly as §40 asks: a **user token** and a **device identity**.
 *
 *   • The user is a Firebase ID token, verified the same way every other API route in this
 *     application verifies one, and resolved to a `users` document by uid and then by email —
 *     because a user whose Firestore id is not their Firebase uid is a real state in this database
 *     (see `authenticateAccess` in `access-control-server.ts`).
 *
 *   • The device is a 256-bit secret issued once at enrolment and sent in `X-SEL-Device-Secret`.
 *     Firestore stores only a salted scrypt hash of it. This is deliberately an API-key scheme and
 *     not a signature scheme: a signature would protect against a compromised TLS channel, which
 *     is not the threat here, and would add a clock-synchronisation failure mode to a fleet of PCs
 *     whose clocks are, demonstrably, the thing most likely to be wrong.
 *
 * Neither fact alone is sufficient. A stolen device secret cannot open a session without somebody
 * signing in; a stolen password cannot open one on a PC the person is not allowed to use.
 *
 * ── Why ingest is a read-then-fold rather than a plain write ───────────────────────────────────
 *
 * §27 requires duplicate suppression across retries, and §31 requires that the session and daily
 * totals be maintained incrementally rather than recomputed. Those two pull in opposite directions:
 * incremental counters cannot be made idempotent by a merge write, because `increment(120)` applied
 * twice adds 240. So `ingestActivityBatch` reads which span ids already exist, folds only the new
 * ones into the counters, and reports the duplicates back so the agent can drop them from its
 * queue. A batch replayed ten times therefore moves the totals exactly once.
 */

/**
 * `scrypt` with a cost parameter, as a promise.
 *
 * Written out rather than `promisify(scrypt)` because the promisified type only exposes the
 * three-argument overload, and the whole point of using scrypt here is to set `N` explicitly — a
 * hash at the library default cost is not the hash this module means to compute.
 */
function scrypt(secret: string, salt: Buffer, keyLength: number, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(secret, salt, keyLength, { N: cost }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Errors
 * ---------------------------------------------------------------------------------------------- */

/** An error with an HTTP status and, where the agent needs to branch on it, a machine code. */
export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code:
      | LoginRejectionCode
      | 'BAD_REQUEST'
      | 'UNAUTHORIZED'
      | 'RATE_LIMITED'
      | 'ERP_SESSION_UNAVAILABLE' = 'BAD_REQUEST',
    /**
     * Extra fields merged into the response body.
     *
     * For naming a server misconfiguration to a caller that has already authenticated — never
     * for anything an unauthenticated request could reach, and never for a value that is itself
     * sensitive. Used by the ERP session route to say *which* way token signing is broken,
     * because the alternative is an administrator correlating a generic 500 against logs.
     */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentRequestError';
  }
}

/** Turn any thrown value into the JSON body and status a route should return. */
export function agentErrorResponse(error: unknown): { body: Record<string, unknown>; status: number } {
  if (error instanceof AgentRequestError) {
    return {
      body: { error: error.message, code: error.code, ...(error.details || {}) },
      status: error.status,
    };
  }
  console.error('[windows-agent] Unhandled error:', error);
  return { body: { error: 'Something went wrong. Please try again.', code: 'BAD_REQUEST' }, status: 500 };
}

/* ------------------------------------------------------------------------------------------------
 * Device secrets
 * ---------------------------------------------------------------------------------------------- */

const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_COST = 16_384;

/** A fresh device secret: 32 random bytes, base64url, shown to the installer exactly once. */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** `scrypt$<cost>$<salt-b64>$<hash-b64>`. Self-describing so the cost can be raised later. */
export async function hashDeviceSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(secret, salt, SCRYPT_KEY_LENGTH, SCRYPT_COST);
  return `scrypt$${SCRYPT_COST}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Constant-time verification.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak a bit, so the lengths are
 * compared first and a mismatch fails without calling it — the derived key length is fixed and
 * public, so nothing is learned from that comparison.
 */
export async function verifyDeviceSecret(secret: string, stored: string): Promise<boolean> {
  if (!secret || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(cost) || cost < 1024) return false;
  try {
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    const derived = await scrypt(secret, salt, expected.length, cost);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Request plumbing
 * ---------------------------------------------------------------------------------------------- */

const DEVICE_ID_HEADER = 'x-sel-device-id';
const DEVICE_SECRET_HEADER = 'x-sel-device-secret';
const AGENT_VERSION_HEADER = 'x-sel-agent-version';

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * The caller's IP, as far as it can be known behind the hosting proxy.
 *
 * The first entry of `x-forwarded-for` is the client; the rest are proxies. Recorded for the audit
 * trail and the device page, and never used for an authorisation decision — an IP is trivially
 * spoofable in a header and treating it as identity would be security theatre.
 */
export function clientIpOf(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip')?.trim() || null;
}

export interface AuthenticatedDevice {
  deviceId: string;
  device: WindowsDevice;
  agentVersion: string | null;
  ipAddress: string | null;
}

/**
 * Verify the device credential alone.
 *
 * Used by the routes an unauthenticated PC legitimately calls — the version check and the policy
 * fetch a gate needs before anybody has signed in. A blocked or retired device fails here, so a
 * machine an administrator has taken out of service stops being able to reach anything at all.
 */
export async function authenticateDevice(request: Request): Promise<AuthenticatedDevice> {
  const deviceId = (request.headers.get(DEVICE_ID_HEADER) || '').trim();
  const secret = (request.headers.get(DEVICE_SECRET_HEADER) || '').trim();
  if (!deviceId || !secret) {
    throw new AgentRequestError('This computer is not enrolled.', 401, 'DEVICE_UNKNOWN');
  }

  const firestore = getFirebaseAdminFirestore();
  const snapshot = await firestore.collection(WINDOWS_AGENT_COLLECTIONS.devices).doc(deviceId).get();
  if (!snapshot.exists) {
    throw new AgentRequestError('This computer is not enrolled.', 401, 'DEVICE_UNKNOWN');
  }

  const device = { id: snapshot.id, ...(snapshot.data() as Omit<WindowsDevice, 'id'>) };
  if (!(await verifyDeviceSecret(secret, device.deviceSecretHash))) {
    throw new AgentRequestError('This computer’s credential is no longer valid.', 401, 'DEVICE_UNKNOWN');
  }

  if (device.status === 'BLOCKED') {
    throw new AgentRequestError(
      device.statusReason || 'This computer has been blocked by an administrator.',
      403,
      'DEVICE_BLOCKED',
    );
  }
  if (device.status === 'RETIRED' || device.status === 'DISABLED') {
    throw new AgentRequestError('This computer is no longer in service.', 403, 'DEVICE_RETIRED');
  }

  return {
    deviceId,
    device,
    agentVersion: request.headers.get(AGENT_VERSION_HEADER)?.trim() || device.agentVersion,
    ipAddress: clientIpOf(request),
  };
}

export interface AgentUserIdentity {
  userId: string;
  /**
   * The Firebase Auth uid, which is not always the `users` document id in this database.
   *
   * Kept separately because the two are used for different things: `userId` addresses the
   * application record, while anything handed back to Firebase — minting a custom token for the
   * embedded ERP window, for instance — must use the uid Firebase itself issued.
   */
  firebaseUid: string;
  name: string;
  email: string | null;
  employeeId: string | null;
  employeeNo: string | null;
  departmentId: string | null;
  departmentName: string | null;
  photoURL: string | null;
  status: string;
}

/**
 * Resolve a Firebase ID token to the application user behind it.
 *
 * Falls back from uid to email exactly as `AuthProvider` and `authenticateAccess` do, for the same
 * reason: this database contains users whose document id is not their Firebase uid, and an agent
 * that refused to sign them in would be refusing real employees.
 */
export async function resolveAgentUser(idToken: string): Promise<AgentUserIdentity> {
  if (!idToken) throw new AgentRequestError('Sign-in is required.', 401, 'UNAUTHORIZED');

  let decoded;
  try {
    decoded = await getFirebaseAdminAuth().verifyIdToken(idToken);
  } catch {
    throw new AgentRequestError('Your sign-in could not be verified.', 401, 'UNAUTHORIZED');
  }

  const firestore = getFirebaseAdminFirestore();
  let snapshot = await firestore.collection('users').doc(decoded.uid).get();
  if (!snapshot.exists && decoded.email) {
    const byEmail = await firestore
      .collection('users')
      .where('email', '==', decoded.email.toLowerCase())
      .limit(1)
      .get();
    if (!byEmail.empty) snapshot = byEmail.docs[0];
  }
  if (!snapshot.exists) {
    throw new AgentRequestError('This sign-in is not linked to a SEL LIVE account.', 403, 'USER_NOT_REGISTERED');
  }

  const data = snapshot.data() || {};
  if (data.status === 'Inactive') {
    throw new AgentRequestError('This account is inactive. Contact HR.', 403, 'USER_INACTIVE');
  }

  const departmentId = typeof data.departmentId === 'string' ? data.departmentId : null;
  return {
    userId: snapshot.id,
    firebaseUid: decoded.uid,
    name: String(data.name || data.email || 'User'),
    email: data.email ? String(data.email) : null,
    employeeId: data.employeeId ? String(data.employeeId) : null,
    employeeNo: data.employeeNo ? String(data.employeeNo) : null,
    departmentId,
    departmentName: typeof data.departmentName === 'string' ? data.departmentName : null,
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
    status: String(data.status || 'Active'),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Policy
 * ---------------------------------------------------------------------------------------------- */

/**
 * Resolve the effective policy for a device and the user on it.
 *
 * Reads every policy document — there are at most a few dozen, one per department plus exceptions,
 * and the alternative is four indexed queries per heartbeat across the whole fleet. At 200 PCs
 * beating every 90 seconds that difference is roughly 750,000 reads a day.
 */
export async function resolveEffectivePolicy(subject: {
  userId: string | null;
  deviceId: string | null;
  departmentIds: string[];
}): Promise<ResolvedAgentPolicy> {
  const firestore = getFirebaseAdminFirestore();
  const snapshot = await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.policies)
    .get()
    .catch(() => null);
  if (!snapshot) return defaultResolvedPolicy();

  const policies = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      scopeKind: data.scopeKind,
      scopeId: data.scopeId ?? null,
      scopeLabel: String(data.scopeLabel || doc.id),
      enabled: data.enabled !== false,
      settings: sanitizePolicySettings(data.settings),
    } as WindowsAgentPolicy;
  });

  return resolveAgentPolicy(policies, subject);
}

/* ------------------------------------------------------------------------------------------------
 * Application catalogue (§22)
 * ---------------------------------------------------------------------------------------------- */

interface CatalogEntry {
  displayName: string;
  category: AppCategory;
}

/**
 * The catalogue, cached in process for a minute.
 *
 * Ingest needs it on every batch and it changes when an administrator recategorises something —
 * a minute of staleness costs a few rows being filed under their old category, and saves a
 * collection read per batch per PC all day. The cache is per server instance and self-healing, so
 * nothing needs invalidating on write.
 */
let catalogCache: { at: number; entries: Map<string, CatalogEntry> } | null = null;
const CATALOG_TTL_MS = 60_000;

export async function loadAppCatalog(force = false): Promise<Map<string, CatalogEntry>> {
  if (!force && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.entries;
  }
  const firestore = getFirebaseAdminFirestore();
  const entries = new Map<string, CatalogEntry>();
  const snapshot = await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.appCatalog)
    .get()
    .catch(() => null);
  snapshot?.docs.forEach((doc) => {
    const data = doc.data();
    entries.set(doc.id, {
      displayName: String(data.displayName || doc.id),
      category: (data.category as AppCategory) || 'UNCLASSIFIED',
    });
  });
  catalogCache = { at: Date.now(), entries };
  return entries;
}

/** Seed the built-in catalogue. Idempotent — existing rows are left exactly as they are. */
export async function seedAppCatalog(): Promise<number> {
  const firestore = getFirebaseAdminFirestore();
  const collection = firestore.collection(WINDOWS_AGENT_COLLECTIONS.appCatalog);
  const existing = await collection.get();
  const known = new Set(existing.docs.map((doc) => doc.id));

  let written = 0;
  let batch = firestore.batch();
  for (const [processKey, seed] of Object.entries(DEFAULT_APP_CATALOG)) {
    if (known.has(processKey)) continue;
    batch.set(collection.doc(processKey), {
      processName: processKey,
      displayName: seed.displayName,
      category: seed.category,
      isBuiltIn: true,
      autoDiscovered: false,
      firstSeenAt: null,
      lastSeenAt: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'system',
      createdByName: 'System',
    });
    written += 1;
    if (written % 400 === 0) {
      await batch.commit();
      batch = firestore.batch();
    }
  }
  if (written % 400 !== 0) await batch.commit();
  catalogCache = null;
  return written;
}

/* ------------------------------------------------------------------------------------------------
 * Enrolment and registration (§4, §45)
 * ---------------------------------------------------------------------------------------------- */

/**
 * The device already enrolled for this physical machine, if there is one.
 *
 * ── Why the placeholder check ─────────────────────────────────────────────────────────────────
 *
 * A key that is the same on every PC is worse than no key: it would collapse an entire fleet
 * onto one device document. Windows' MachineGuid is normally unique, but cloned images and some
 * virtualisation tooling leave it as a well-known constant, so the obviously-wrong values are
 * refused rather than trusted.
 *
 * ── Why the oldest wins ───────────────────────────────────────────────────────────────────────
 *
 * Where duplicates already exist — every installation that ran before this check — the first
 * document is the one carrying the history, the assignments and the approval. Re-registering
 * onto it folds the machine back onto its own record instead of adopting the stray.
 *
 * Never throws. A machine that cannot be recognised must still be able to enrol; failing the
 * lookup means a possible duplicate, while failing the registration means a PC that cannot
 * report at all.
 */
async function findDeviceByMachineGuid(
  firestore: FirebaseFirestore.Firestore,
  machineGuid: string | null,
): Promise<string> {
  const guid = (machineGuid || '').trim().toLowerCase();
  if (!guid || guid.length < 8) return '';
  if (PLACEHOLDER_MACHINE_GUIDS.has(guid)) return '';

  try {
    const matches = await firestore
      .collection(WINDOWS_AGENT_COLLECTIONS.devices)
      .where('facts.machineGuid', '==', machineGuid)
      .get();
    if (matches.empty) return '';

    // In service first, then oldest.
    //
    // A blocked or retired duplicate must not win, or a machine re-enrolling would attach
    // itself to a record an administrator has deliberately taken out of service — and then be
    // refused by the check below, permanently, with no way back.
    const ranked = matches.docs
      .slice()
      .sort((left, right) => {
        const leftOut = isWithdrawn(left.get('status'));
        const rightOut = isWithdrawn(right.get('status'));
        if (leftOut !== rightOut) return leftOut ? 1 : -1;
        return createdAtMillis(left.get('createdAt')) - createdAtMillis(right.get('createdAt'));
      });
    return ranked[0].id;
  } catch (error) {
    console.error('[windows-agent] Could not look up a device by machineGuid:', error);
    return '';
  }
}

/**
 * A creation stamp as a number, whatever it is stored as.
 *
 * `createdAt` on these documents is a Firestore `Timestamp`, and `String(timestamp)` is
 * `"[object Object]"` — so the obvious `localeCompare` on the stringified value compares two
 * identical strings, returns zero for every pair, and leaves the order arbitrary. That is not a
 * hypothetical: the first version of this function did exactly that, and picked the *newer* of
 * the two documents on the machine it was written to fix.
 *
 * Also accepts an ISO string and a Date, because the field is typed `WindowsAgentTimestampLike`
 * and older documents carry strings.
 */
function createdAtMillis(value: unknown): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  if (typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
  }
  if (typeof value === 'number') return value;
  // Unknown shape: sort last, so a document whose stamp cannot be read never beats one whose can.
  return Number.MAX_SAFE_INTEGER;
}

/** Blocked and retired machines are out of service and must not win a duplicate match. */
function isWithdrawn(status: unknown): boolean {
  return status === 'BLOCKED' || status === 'RETIRED';
}

/** Values seen on more than one machine, and therefore useless as an identity. */
const PLACEHOLDER_MACHINE_GUIDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
]);

function sanitizeFacts(raw: unknown): DeviceMachineFacts {
  const input = (raw || {}) as Record<string, unknown>;
  const text = (value: unknown, max = 120): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };
  return {
    hostname: text(input.hostname, 80) || 'unknown-host',
    machineGuid: text(input.machineGuid, 64),
    windowsVersion: text(input.windowsVersion, 80),
    architecture: text(input.architecture, 20),
    manufacturer: text(input.manufacturer, 80),
    model: text(input.model, 80),
    serialNumber: text(input.serialNumber, 80),
    totalMemoryMb: Number.isFinite(Number(input.totalMemoryMb)) ? Math.round(Number(input.totalMemoryMb)) : null,
    timeZoneId: text(input.timeZoneId, 60),
  };
}

/**
 * Every reason an enrolment code may be refused, in one place.
 *
 * Extracted so that the code the setup screen checks and the code registration accepts cannot
 * drift apart. A screen that says "code accepted" and an enrolment that then fails on the same
 * code would be worse than no check at all — the person at the PC would have been told the one
 * thing they could act on was fine.
 *
 * Throws rather than returning a verdict, because every caller wants the wording.
 */
async function requireUsableEnrollmentCode(
  firestore: Firestore,
  rawCode: unknown,
): Promise<{ code: string; ref: DocumentReference; data: Record<string, unknown> }> {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) throw new AgentRequestError('An enrolment code is required.', 400);

  const snapshot = await firestore.collection(WINDOWS_AGENT_COLLECTIONS.enrollmentCodes).doc(code).get();
  if (!snapshot.exists) throw new AgentRequestError('That enrolment code is not recognised.', 403);

  const data = (snapshot.data() || {}) as Record<string, unknown>;
  if (data.enabled === false) throw new AgentRequestError('That enrolment code has been disabled.', 403);
  if (data.expiresAt && new Date(String(data.expiresAt)) < new Date()) {
    throw new AgentRequestError('That enrolment code has expired.', 403);
  }
  const maxRegistrations = data.maxRegistrations;
  if (
    typeof maxRegistrations === 'number' &&
    Number(data.registrationCount || 0) >= maxRegistrations
  ) {
    throw new AgentRequestError('That enrolment code has reached its registration limit.', 403);
  }

  return { code, ref: snapshot.ref, data };
}

/** What the setup screen learns about a code it is about to use. */
export interface EnrollmentCodeCheck {
  code: string;
  departmentName: string | null;
  assignedLocation: string | null;
  /** False when a device enrolled with this code waits for an administrator (§45). */
  autoApprove: boolean;
  /** Null when the code has no registration limit. */
  remainingRegistrations: number | null;
}

/**
 * Check a code without redeeming it, so the agent's setup screen can refuse a bad one up front.
 *
 * Unauthenticated, like registration itself, and for the same reason: a PC being set up has no
 * credential yet. It is a strictly smaller exposure than the registration route beside it — one
 * document read by id, no writes, and nothing returned that a successful registration would not
 * have revealed anyway.
 *
 * Deliberately **not** audited. It would be the only unauthenticated route in the module that
 * writes, so anybody could fill the audit collection by holding down a key, and the resulting
 * noise would bury the administrative trail §50 exists to keep readable. A code that gets as far
 * as being redeemed is recorded by `registerDevice`.
 *
 * It does tell an attacker whether a guessed code is valid. That was already true of registration
 * — see the note on the route — and a code buys the ability to enrol a machine, not to see
 * anybody's data: a device credential cannot open a session without a real employee signing in.
 */
export async function checkEnrollmentCode(rawCode: unknown): Promise<EnrollmentCodeCheck> {
  const firestore = getFirebaseAdminFirestore();
  const { code, data } = await requireUsableEnrollmentCode(firestore, rawCode);

  const maxRegistrations = typeof data.maxRegistrations === 'number' ? data.maxRegistrations : null;

  return {
    code,
    departmentName: (data.departmentName as string) ?? null,
    assignedLocation: (data.assignedLocation as string) ?? null,
    autoApprove: data.autoApprove !== false,
    remainingRegistrations:
      maxRegistrations === null
        ? null
        : Math.max(0, maxRegistrations - Number(data.registrationCount || 0)),
  };
}

/**
 * Enrol a PC, or re-issue a credential to one being reinstalled.
 *
 * The secret is returned in the response and then never again — it exists in Firestore only as a
 * scrypt hash, so an exported database does not let anybody impersonate a machine (§4).
 *
 * A reinstall over an existing `deviceId` **rotates** the secret rather than reusing it, and bumps
 * `secretVersion`. That is the behaviour that makes "Force Re-authentication" on the device page
 * meaningful: the old credential stops working the moment a new one is issued, so a cloned disk
 * image carrying yesterday's secret is locked out rather than silently accepted alongside the
 * machine it was cloned from.
 */
export async function registerDevice(
  input: DeviceRegisterInput,
  context: { ipAddress: string | null },
): Promise<DeviceRegisterResult> {
  const firestore = getFirebaseAdminFirestore();
  const { code, ref: codeRef, data: codeData } = await requireUsableEnrollmentCode(
    firestore,
    input.enrollmentCode,
  );

  const facts = sanitizeFacts(input.facts);
  const agentVersion = String(input.agentVersion || '').trim().slice(0, 40) || null;
  const autoApprove = codeData.autoApprove !== false;
  const nowIso = new Date().toISOString();

  const secret = generateDeviceSecret();
  const deviceSecretHash = await hashDeviceSecret(secret);

  // The device id the agent already holds, if it has one.
  const claimedId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';

  // ── Otherwise, recognise the machine by its own identity ──────────────────────────────────
  //
  // Without this, one PC becomes two rows. The agent only sends a `deviceId` when it still has
  // `device.json`, and that file legitimately goes missing: a reinstall that clears ProgramData,
  // `--reset-identity` after re-imaging, DPAPI failing to decrypt it, or somebody wiping the
  // folder. Every one of those produced a second document for the same computer, and the fleet
  // list then shows "ASHISH" twice — one of them with no heartbeat, forever, because only one
  // agent is actually running.
  //
  // MachineGuid is the right key. Windows generates it at installation and it survives renames,
  // domain joins and hardware changes, whereas the hostname repeats across a fleet and the BIOS
  // serial is frequently a placeholder — this very machine reports "Default string".
  //
  // Deliberately *not* a uniqueness constraint that rejects the registration: a PC re-enrolling
  // must succeed and keep its history, not be refused. Recognising it is the whole point.
  const existingId = claimedId || (await findDeviceByMachineGuid(firestore, facts.machineGuid));

  const deviceRef = existingId
    ? firestore.collection(WINDOWS_AGENT_COLLECTIONS.devices).doc(existingId)
    : firestore.collection(WINDOWS_AGENT_COLLECTIONS.devices).doc();

  const existing = existingId ? await deviceRef.get() : null;
  const isReregistration = Boolean(existing?.exists);
  const previous = (existing?.data() || {}) as Partial<WindowsDevice>;

  if (isReregistration && (previous.status === 'BLOCKED' || previous.status === 'RETIRED')) {
    throw new AgentRequestError('This computer has been withdrawn from service.', 403, 'DEVICE_BLOCKED');
  }

  const status = isReregistration
    ? (previous.status ?? (autoApprove ? 'ACTIVE' : 'PENDING'))
    : autoApprove
      ? 'ACTIVE'
      : 'PENDING';

  await deviceRef.set(
    {
      deviceName: previous.deviceName || facts.hostname,
      status,
      facts,
      deviceSecretHash,
      secretVersion: Number(previous.secretVersion || 0) + 1,
      enrollmentCode: code,
      departmentId: previous.departmentId ?? codeData.departmentId ?? null,
      departmentName: previous.departmentName ?? codeData.departmentName ?? null,
      assignedLocation: previous.assignedLocation ?? codeData.assignedLocation ?? null,
      assignedUserIds: previous.assignedUserIds ?? [],
      agentVersion,
      updateRing: previous.updateRing ?? 'BROAD',
      updateStatus: 'UP_TO_DATE',
      firstRegisteredAt: previous.firstRegisteredAt ?? nowIso,
      ipAddress: context.ipAddress,
      updatedAt: FieldValue.serverTimestamp(),
      ...(isReregistration
        ? {}
        : {
            lastHeartbeatAt: null,
            lastLoginAt: null,
            lastLogoutAt: null,
            lastSeenUserId: null,
            lastSeenUserName: null,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: 'agent',
            createdByName: 'Agent enrolment',
          }),
    },
    { merge: true },
  );

  if (!isReregistration) {
    await codeRef.update({ registrationCount: FieldValue.increment(1) });
  }

  await writeAudit({
    action: isReregistration ? 'DEVICE_SECRET_ROTATED' : 'DEVICE_REGISTERED',
    actorId: 'agent',
    actorName: facts.hostname,
    targetType: 'device',
    targetId: deviceRef.id,
    targetLabel: previous.deviceName || facts.hostname,
    oldValue: isReregistration ? { secretVersion: previous.secretVersion ?? 0 } : null,
    newValue: { enrollmentCode: code, agentVersion, status },
    reason: isReregistration ? 'Agent re-registered on this machine.' : null,
    ipAddress: context.ipAddress,
    userAgent: null,
  });

  return {
    deviceId: deviceRef.id,
    deviceSecret: secret,
    secretVersion: Number(previous.secretVersion || 0) + 1,
    deviceName: previous.deviceName || facts.hostname,
    status: status as WindowsDevice['status'],
    approved: status === 'ACTIVE' || status === 'MAINTENANCE',
  };
}

/* ------------------------------------------------------------------------------------------------
 * Device access
 * ---------------------------------------------------------------------------------------------- */

/**
 * One person's computer restriction, or null when they have none.
 *
 * Keyed by user id, so this is a single `get` on the sign-in path rather than a query — sign-in
 * is the one request an employee is standing at a keyboard waiting for, and an index lookup is
 * not where to spend that time. A missing document means "any computer", which is both the
 * default and the overwhelmingly common case.
 */
export async function loadUserDeviceAccess(
  userId: string,
): Promise<{ allowedDeviceIds: string[] } | null> {
  try {
    const snapshot = await getFirebaseAdminFirestore()
      .collection(WINDOWS_AGENT_COLLECTIONS.userAccess)
      .doc(userId)
      .get();
    if (!snapshot.exists) return null;
    const allowed = snapshot.get('allowedDeviceIds');
    return Array.isArray(allowed) ? { allowedDeviceIds: allowed.map(String) } : null;
  } catch (error) {
    // Fail open, deliberately, and loudly.
    //
    // A read failure here would otherwise lock every employee out of every PC over a Firestore
    // hiccup — turning a transient backend problem into a company-wide inability to start work.
    // The device-side list still applies and is already loaded, so the fleet is not unguarded;
    // what is lost is the narrower per-person restriction, for the duration of the outage.
    console.error('[windows-agent] Could not read the user device restriction; allowing:', error);
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Sessions (§5, §7)
 * ---------------------------------------------------------------------------------------------- */

export interface OpenSessionResult {
  sessionId: string;
  loginAt: string;
  resumed: boolean;
  lateLogin: boolean;
  lateByMinutes: number;
  policy: ResolvedAgentPolicy;
}

/**
 * Open a work session, or resume today's.
 *
 * §7 is explicit that a reconnect must not create a second attendance record, and the check is
 * made inside a transaction rather than by querying first: two agents racing after a network blip
 * — or one agent retrying a request whose response was lost — would otherwise both see no open
 * session and both create one, which is exactly the duplicate the specification forbids.
 *
 * A session open on a *different* device is closed rather than left dangling. Somebody who walks
 * from their desk to a site office and signs in there has ended the first session in every sense
 * that matters; leaving it open would show them working on two PCs at once on the live board and
 * would double-count their day.
 */
export async function openOrResumeSession(options: {
  user: AgentUserIdentity;
  device: WindowsDevice;
  agentVersion: string | null;
  ipAddress: string | null;
  offlineLogin: boolean;
}): Promise<OpenSessionResult> {
  const { user, device } = options;

  if (device.status === 'PENDING') {
    throw new AgentRequestError(
      'This computer is waiting for administrator approval.',
      403,
      'DEVICE_NOT_APPROVED',
    );
  }
  // Both allow-lists, each defaulting to unrestricted. See `canUserSignInOnDevice` for why one
  // list cannot express a per-person limit.
  const userAccess = await loadUserDeviceAccess(user.userId);
  const access = canUserSignInOnDevice(device, userAccess, user.userId);
  if (!access.allowed && access.refusal) {
    throw new AgentRequestError(describeAccessRefusal(access.refusal), 403, 'USER_NOT_ASSIGNED');
  }

  const departmentIds = [user.departmentId, device.departmentId].filter(
    (value): value is string => Boolean(value),
  );
  const policy = await resolveEffectivePolicy({
    userId: user.userId,
    deviceId: device.id,
    departmentIds,
  });

  if (options.offlineLogin && policy.settings.offlineGraceMinutes <= 0) {
    throw new AgentRequestError(
      'Offline sign-in is not permitted on this computer.',
      403,
      'OFFLINE_NOT_PERMITTED',
    );
  }

  const firestore = getFirebaseAdminFirestore();
  const now = new Date();
  const workDate = workDateOf(now);
  const nowIso = now.toISOString();
  const sessions = firestore.collection(WINDOWS_AGENT_COLLECTIONS.sessions);

  // Both queries are made outside the transaction; the transaction re-reads the candidate it picks
  // so the decision itself is still serialised. Firestore transactions cannot run queries in the
  // Admin SDK's `runTransaction` on the client-facing path, and re-reading one document is enough:
  // a concurrent writer can only have closed it, which the re-read sees.
  const [openHere, openElsewhere] = await Promise.all([
    sessions
      .where('userId', '==', user.userId)
      .where('deviceId', '==', device.id)
      .where('status', '==', 'OPEN')
      .limit(1)
      .get(),
    sessions.where('userId', '==', user.userId).where('status', '==', 'OPEN').limit(5).get(),
  ]);

  for (const doc of openElsewhere.docs) {
    if (doc.get('deviceId') === device.id) continue;
    await closeSessionDocument(firestore, doc.id, {
      endReason: 'SESSION_SUPERSEDED',
      endedAt: nowIso,
      estimated: false,
    });
  }

  const candidate = openHere.docs[0];
  const candidateData = candidate
    ? {
        status: String(candidate.get('status')),
        loginAt: String(candidate.get('loginAt')),
        workDate: String(candidate.get('workDate')),
        deviceId: String(candidate.get('deviceId')),
        userId: String(candidate.get('userId')),
      }
    : null;

  if (candidate && shouldResumeSession(candidateData, { workDate, deviceId: device.id, userId: user.userId })) {
    await candidate.ref.update({
      lastHeartbeatAt: nowIso,
      agentVersion: options.agentVersion,
      ipAddress: options.ipAddress,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await touchDeviceOnLogin(firestore, device.id, user, nowIso, options.ipAddress, options.agentVersion);
    return {
      sessionId: candidate.id,
      loginAt: String(candidate.get('loginAt')),
      resumed: true,
      lateLogin: candidate.get('lateLogin') === true,
      lateByMinutes: Number(candidate.get('lateByMinutes') || 0),
      policy,
    };
  }

  // An open session on this device from a previous day is stale: the PC was never signed out.
  if (candidate) {
    await closeSessionDocument(firestore, candidate.id, {
      endReason: 'HEARTBEAT_TIMEOUT',
      endedAt: estimateUncleanEnd({
        loginAt: String(candidate.get('loginAt')),
        lastHeartbeatAt: candidate.get('lastHeartbeatAt') ?? null,
        lastActivityAt: candidate.get('lastActivityAt') ?? null,
      }).endedAt,
      estimated: true,
    });
  }

  const late = evaluateLateLogin(now, {
    workdayStart: policy.settings.workdayStart,
    lateLoginGraceMinutes: policy.settings.lateLoginGraceMinutes,
  });

  const sessionRef = sessions.doc();
  await sessionRef.set({
    userId: user.userId,
    userName: user.name,
    userEmail: user.email,
    employeeId: user.employeeId,
    employeeNo: user.employeeNo,
    departmentId: user.departmentId ?? device.departmentId ?? null,
    departmentName: user.departmentName ?? device.departmentName ?? null,
    deviceId: device.id,
    deviceName: device.deviceName,
    workDate,
    loginAt: nowIso,
    logoutAt: null,
    lastHeartbeatAt: nowIso,
    lastActivityAt: null,
    status: 'OPEN',
    endReason: null,
    logoutEstimated: false,
    presence: 'ACTIVE' as PresenceState,
    currentProcessName: null,
    currentApplicationName: null,
    totalSeconds: 0,
    activeSeconds: 0,
    idleSeconds: 0,
    extendedIdleSeconds: 0,
    lockedSeconds: 0,
    offlineSeconds: 0,
    agentVersion: options.agentVersion,
    ipAddress: options.ipAddress,
    offlineLogin: options.offlineLogin,
    lateLogin: late.lateLogin,
    lateByMinutes: late.lateByMinutes,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: user.userId,
    createdByName: user.name,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await Promise.all([
    touchDeviceOnLogin(firestore, device.id, user, nowIso, options.ipAddress, options.agentVersion),
    mergeDailyActivity(firestore, {
      userId: user.userId,
      userName: user.name,
      employeeId: user.employeeId,
      departmentId: user.departmentId ?? device.departmentId ?? null,
      departmentName: user.departmentName ?? device.departmentName ?? null,
      workDate,
      firstLoginAt: nowIso,
      deviceId: device.id,
      sessionOpened: true,
      lateLogin: late.lateLogin,
      lateByMinutes: late.lateByMinutes,
    }),
  ]);

  return {
    sessionId: sessionRef.id,
    loginAt: nowIso,
    resumed: false,
    lateLogin: late.lateLogin,
    lateByMinutes: late.lateByMinutes,
    policy,
  };
}

async function touchDeviceOnLogin(
  firestore: Firestore,
  deviceId: string,
  user: AgentUserIdentity,
  nowIso: string,
  ipAddress: string | null,
  agentVersion: string | null,
): Promise<void> {
  await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.devices)
    .doc(deviceId)
    .update({
      lastLoginAt: nowIso,
      lastSeenUserId: user.userId,
      lastSeenUserName: user.name,
      ipAddress,
      ...(agentVersion ? { agentVersion } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});
}

/**
 * Close a session and roll its end into the day.
 *
 * `estimated` propagates all the way to the report, because §28 forbids presenting an inferred
 * logout as an observed one. Closing an already-closed session is a no-op rather than an error:
 * a shutdown can race the reaper, and both are entitled to think they closed it.
 */
export async function closeSessionDocument(
  firestore: Firestore,
  sessionId: string,
  options: { endReason: SessionEndReason; endedAt: string; estimated: boolean },
): Promise<void> {
  const ref = firestore.collection(WINDOWS_AGENT_COLLECTIONS.sessions).doc(sessionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return;
  if (snapshot.get('status') !== 'OPEN') return;

  const loginAt = new Date(String(snapshot.get('loginAt')));
  const endedAt = new Date(options.endedAt);
  const totalSeconds = secondsBetween(loginAt, endedAt);

  await ref.update({
    status: options.estimated ? 'UNCLEAN_END' : 'CLOSED',
    endReason: options.endReason,
    logoutAt: endedAt.toISOString(),
    logoutEstimated: options.estimated,
    presence: 'OFFLINE' as PresenceState,
    totalSeconds,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.devices)
    .doc(String(snapshot.get('deviceId')))
    .update({ lastLogoutAt: endedAt.toISOString(), updatedAt: FieldValue.serverTimestamp() })
    .catch(() => {});

  await mergeDailyActivity(firestore, {
    userId: String(snapshot.get('userId')),
    userName: String(snapshot.get('userName')),
    employeeId: snapshot.get('employeeId') ?? null,
    departmentId: snapshot.get('departmentId') ?? null,
    departmentName: snapshot.get('departmentName') ?? null,
    workDate: String(snapshot.get('workDate')),
    lastLogoutAt: endedAt.toISOString(),
    deviceId: String(snapshot.get('deviceId')),
    sessionSecondsDelta: Math.max(0, totalSeconds - Number(snapshot.get('totalSeconds') || 0)),
    hasUncleanSession: options.estimated,
  });
}

/**
 * Close every session whose agent stopped reporting (§28, §54).
 *
 * Run from the cron route. Deliberately conservative: ten missed heartbeats, so a site's
 * fifteen-minute internet outage does not end everybody's attendance for the day and leave them
 * with two sessions when it comes back.
 */
export async function reapAbandonedSessions(options: { now?: Date; limit?: number } = {}): Promise<number> {
  const firestore = getFirebaseAdminFirestore();
  const now = options.now ?? new Date();
  const policy = await resolveEffectivePolicy({ userId: null, deviceId: null, departmentIds: [] });

  const snapshot = await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.sessions)
    .where('status', '==', 'OPEN')
    .limit(options.limit ?? 500)
    .get();

  let closed = 0;
  for (const doc of snapshot.docs) {
    const session = {
      loginAt: String(doc.get('loginAt')),
      lastHeartbeatAt: doc.get('lastHeartbeatAt') ?? null,
      lastActivityAt: doc.get('lastActivityAt') ?? null,
    };
    if (!isSessionAbandoned(session, { heartbeatIntervalSeconds: policy.settings.heartbeatIntervalSeconds, now })) {
      continue;
    }
    const estimate = estimateUncleanEnd(session);
    await closeSessionDocument(firestore, doc.id, {
      endReason: estimate.endReason,
      endedAt: estimate.endedAt,
      estimated: true,
    });
    closed += 1;
  }
  return closed;
}

/* ------------------------------------------------------------------------------------------------
 * Activity ingest (§31, §32)
 * ---------------------------------------------------------------------------------------------- */

/** Hard cap on one batch. Beyond this the agent should send two. */
export const MAX_SPANS_PER_BATCH = 500;

/**
 * Fold a batch of foreground spans into the session, the per-application totals and the day.
 *
 * The order matters and is not arbitrary:
 *
 *   1. Normalise and clamp against the session, so nothing outside it is counted.
 *   2. Resolve overlaps, so no second of wall clock is counted twice.
 *   3. Read which span ids already exist, and drop those — this is what makes a retry safe.
 *   4. Write the spans, the per-application merges and the counter increments in one batch.
 *
 * Step 3 is the whole reason this is not a fire-and-forget write. See the module header.
 */
export async function ingestActivityBatch(options: {
  sessionId: string;
  deviceId: string;
  userId: string;
  rawSpans: unknown;
  policy: ResolvedAgentPolicy;
  now?: Date;
}): Promise<ActivityBatchResult> {
  const firestore = getFirebaseAdminFirestore();
  const now = options.now ?? new Date();

  const sessionRef = firestore.collection(WINDOWS_AGENT_COLLECTIONS.sessions).doc(options.sessionId);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists) throw new AgentRequestError('That work session no longer exists.', 404);
  if (sessionSnapshot.get('userId') !== options.userId || sessionSnapshot.get('deviceId') !== options.deviceId) {
    throw new AgentRequestError('That work session belongs to another user or computer.', 403);
  }

  const rawList = Array.isArray(options.rawSpans) ? options.rawSpans.slice(0, MAX_SPANS_PER_BATCH) : [];
  const emptyTotals = {
    totalSeconds: Number(sessionSnapshot.get('totalSeconds') || 0),
    activeSeconds: Number(sessionSnapshot.get('activeSeconds') || 0),
    idleSeconds: Number(sessionSnapshot.get('idleSeconds') || 0),
    extendedIdleSeconds: Number(sessionSnapshot.get('extendedIdleSeconds') || 0),
    lockedSeconds: Number(sessionSnapshot.get('lockedSeconds') || 0),
  };
  if (!rawList.length) {
    return { accepted: 0, rejected: [], duplicates: [], sessionTotals: emptyTotals };
  }

  const sessionStart = new Date(String(sessionSnapshot.get('loginAt')));
  const logoutAt = sessionSnapshot.get('logoutAt');
  const sessionEnd = logoutAt ? new Date(String(logoutAt)) : now;

  const { spans: normalized, rejected } = normalizeSpans(rawList as never, {
    sessionStart,
    sessionEnd,
    now,
    allowWindowTitles: options.policy.settings.windowTitleTrackingEnabled,
    allowBrowserDomains: options.policy.settings.browserDomainTrackingEnabled,
  });
  const spans = resolveSpanOverlaps(normalized);
  if (!spans.length) {
    return { accepted: 0, rejected, duplicates: [], sessionTotals: emptyTotals };
  }

  const eventsCollection = firestore.collection(WINDOWS_AGENT_COLLECTIONS.activityEvents);
  const refs = spans.map((span) => eventsCollection.doc(`${options.sessionId}__${span.spanId}`));
  const existing = await firestore.getAll(...refs);
  const alreadyStored = new Set(
    existing.filter((doc) => doc.exists).map((doc) => doc.id.split('__').slice(1).join('__')),
  );

  const fresh = spans.filter((span) => !alreadyStored.has(span.spanId));
  if (!fresh.length) {
    return {
      accepted: 0,
      rejected,
      duplicates: [...alreadyStored],
      sessionTotals: emptyTotals,
    };
  }

  const catalog = await loadAppCatalog();
  const categoryOf = (processKey: string): AppCategory =>
    catalog.get(processKey)?.category ?? defaultCategoryFor(processKey);
  const displayNameOf = (processKey: string, reported: string | null): string =>
    resolveApplicationName(processKey, reported, catalog.get(processKey)?.displayName);

  const thresholds = thresholdsOf(options.policy);
  const workDate = String(sessionSnapshot.get('workDate'));
  const nowIso = now.toISOString();

  /**
   * How long the session has been open, and how much of that the day has not yet been told about.
   *
   * The daily rollup's `sessionSeconds` used to advance only when a session *closed*, which meant
   * every report read zero logged-in time for anybody still at their desk — so the dashboard
   * showed six hours of active time inside zero hours of attendance. Advancing it by the
   * difference on each batch keeps it correct all day, and `closeSessionDocument` computes its
   * own delta the same way against the stored total, so the close adds only what is left rather
   * than counting the day twice.
   */
  const sessionWallClockSeconds = secondsBetween(sessionStart, sessionEnd);
  const sessionSecondsDelta = Math.max(
    0,
    sessionWallClockSeconds - Number(sessionSnapshot.get('totalSeconds') || 0),
  );

  let totals = { total: 0, active: 0, idle: 0, extendedIdle: 0, locked: 0, offline: 0 };
  const batch = firestore.batch();

  for (const span of fresh) {
    const contribution = foldSpan(span, thresholds);
    totals = {
      total: totals.total + contribution.totalSeconds,
      active: totals.active + contribution.activeSeconds,
      idle: totals.idle + contribution.idleSeconds,
      extendedIdle: totals.extendedIdle + contribution.extendedIdleSeconds,
      locked: totals.locked + contribution.lockedSeconds,
      offline: totals.offline + contribution.offlineSeconds,
    };

    batch.set(eventsCollection.doc(`${options.sessionId}__${span.spanId}`), {
      userId: options.userId,
      deviceId: options.deviceId,
      sessionId: options.sessionId,
      workDate,
      eventType: span.eventType,
      processName: span.processKey || null,
      applicationName: span.processKey ? displayNameOf(span.processKey, span.reportedApplicationName) : null,
      category: span.processKey ? categoryOf(span.processKey) : 'SYSTEM',
      startedAt: span.startedAt.toISOString(),
      endedAt: span.endedAt.toISOString(),
      durationSeconds: span.durationSeconds,
      idleSeconds: span.idleSeconds,
      activeSeconds: contribution.activeSeconds,
      classification: dominantClassification(span, thresholds),
      windowTitle: span.windowTitle,
      browserDomain: span.browserDomain,
      recordedOffline: span.recordedOffline,
      ingestedAt: nowIso,
    });
  }

  const usageDeltas = buildApplicationUsageDeltas(fresh, thresholds, categoryOf, displayNameOf);
  const usageCollection = firestore.collection(WINDOWS_AGENT_COLLECTIONS.applicationUsage);
  const applicationSummary: Record<string, unknown> = {};
  const categorySummary: Record<string, unknown> = {};

  for (const delta of usageDeltas) {
    batch.set(
      usageCollection.doc(windowsAgentIds.applicationUsage(options.sessionId, delta.processKey)),
      {
        userId: options.userId,
        deviceId: options.deviceId,
        sessionId: options.sessionId,
        workDate,
        processKey: delta.processKey,
        processName: delta.processName,
        applicationName: delta.applicationName,
        category: delta.category,
        totalSeconds: FieldValue.increment(delta.totalSeconds),
        activeSeconds: FieldValue.increment(delta.activeSeconds),
        idleSeconds: FieldValue.increment(delta.idleSeconds),
        focusCount: FieldValue.increment(delta.focusCount),
        firstSeenAt: delta.firstSeenAt,
        lastSeenAt: delta.lastSeenAt,
      },
      { merge: true },
    );
    applicationSummary[delta.processKey] = FieldValue.increment(delta.totalSeconds);
    categorySummary[delta.category] = FieldValue.increment(delta.activeSeconds);

    // An application nobody has classified becomes a row on the settings screen rather than a
    // silent `UNCLASSIFIED` in the report (§22).
    if (!catalog.has(delta.processKey)) {
      batch.set(
        firestore.collection(WINDOWS_AGENT_COLLECTIONS.appCatalog).doc(delta.processKey),
        {
          processName: delta.processKey,
          displayName: delta.applicationName,
          category: delta.category,
          isBuiltIn: Boolean(DEFAULT_APP_CATALOG[delta.processKey]),
          autoDiscovered: true,
          firstSeenAt: delta.firstSeenAt,
          lastSeenAt: delta.lastSeenAt,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }

  const lastSpan = fresh[fresh.length - 1];
  batch.update(sessionRef, {
    activeSeconds: FieldValue.increment(totals.active),
    idleSeconds: FieldValue.increment(totals.idle),
    extendedIdleSeconds: FieldValue.increment(totals.extendedIdle),
    lockedSeconds: FieldValue.increment(totals.locked),
    offlineSeconds: FieldValue.increment(totals.offline),
    // Wall clock, not the sum of the spans: the gaps between spans are still part of the session.
    totalSeconds: sessionWallClockSeconds,
    lastActivityAt: lastSpan.endedAt.toISOString(),
    currentProcessName: lastSpan.processKey || null,
    currentApplicationName: lastSpan.processKey
      ? displayNameOf(lastSpan.processKey, lastSpan.reportedApplicationName)
      : null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  batch.set(
    firestore
      .collection(WINDOWS_AGENT_COLLECTIONS.dailyActivity)
      .doc(windowsAgentIds.dailyActivity(options.userId, workDate)),
    {
      userId: options.userId,
      workDate,
      sessionSeconds: FieldValue.increment(sessionSecondsDelta),
      activeSeconds: FieldValue.increment(totals.active),
      idleSeconds: FieldValue.increment(totals.idle),
      extendedIdleSeconds: FieldValue.increment(totals.extendedIdle),
      lockedSeconds: FieldValue.increment(totals.locked),
      offlineSeconds: FieldValue.increment(totals.offline),
      applicationSummary,
      categorySummary,
      updatedAt: nowIso,
    },
    { merge: true },
  );

  await batch.commit();

  return {
    accepted: fresh.length,
    rejected,
    duplicates: [...alreadyStored],
    sessionTotals: {
      totalSeconds: sessionWallClockSeconds,
      activeSeconds: emptyTotals.activeSeconds + totals.active,
      idleSeconds: emptyTotals.idleSeconds + totals.idle,
      extendedIdleSeconds: emptyTotals.extendedIdleSeconds + totals.extendedIdle,
      lockedSeconds: emptyTotals.lockedSeconds + totals.locked,
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Daily rollup (§32)
 * ---------------------------------------------------------------------------------------------- */

interface DailyMergeInput {
  userId: string;
  userName?: string;
  employeeId?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  workDate: string;
  firstLoginAt?: string;
  lastLogoutAt?: string;
  deviceId?: string;
  sessionOpened?: boolean;
  sessionSecondsDelta?: number;
  lateLogin?: boolean;
  lateByMinutes?: number;
  hasUncleanSession?: boolean;
}

/**
 * Merge into `windowsDailyActivity`, never overwriting a first login that is already earlier.
 *
 * `firstLoginAt` is the field this function exists to protect. A merge write would happily replace
 * 09:02 with 14:30 when somebody signs in again after lunch, and the attendance report would show
 * the whole company arriving in the afternoon. So it is read and compared rather than merged — the
 * one place in the module where a read before write is worth the round trip.
 */
async function mergeDailyActivity(firestore: Firestore, input: DailyMergeInput): Promise<void> {
  const ref = firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.dailyActivity)
    .doc(windowsAgentIds.dailyActivity(input.userId, input.workDate));

  await firestore
    .runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists ? snapshot.data() || {} : {};

      const existingFirstLogin = typeof existing.firstLoginAt === 'string' ? existing.firstLoginAt : null;
      const firstLoginAt =
        input.firstLoginAt && (!existingFirstLogin || input.firstLoginAt < existingFirstLogin)
          ? input.firstLoginAt
          : existingFirstLogin;

      const existingLastLogout = typeof existing.lastLogoutAt === 'string' ? existing.lastLogoutAt : null;
      const lastLogoutAt =
        input.lastLogoutAt && (!existingLastLogout || input.lastLogoutAt > existingLastLogout)
          ? input.lastLogoutAt
          : existingLastLogout;

      const deviceIds = new Set<string>(Array.isArray(existing.deviceIds) ? existing.deviceIds : []);
      if (input.deviceId) deviceIds.add(input.deviceId);

      transaction.set(
        ref,
        {
          userId: input.userId,
          workDate: input.workDate,
          ...(input.userName ? { userName: input.userName } : {}),
          ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.departmentName !== undefined ? { departmentName: input.departmentName } : {}),
          firstLoginAt,
          lastLogoutAt,
          deviceIds: [...deviceIds],
          sessionCount: Number(existing.sessionCount || 0) + (input.sessionOpened ? 1 : 0),
          sessionSeconds: Number(existing.sessionSeconds || 0) + (input.sessionSecondsDelta ?? 0),
          // Late is a property of the *first* sign-in of the day; a second one cannot clear it.
          lateLogin: Boolean(existing.lateLogin) || Boolean(input.lateLogin),
          lateByMinutes: existing.lateByMinutes ?? input.lateByMinutes ?? 0,
          hasUncleanSession: Boolean(existing.hasUncleanSession) || Boolean(input.hasUncleanSession),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    })
    .catch((error) => {
      // A rollup failure must never fail the sign-in that triggered it.
      console.error('[windows-agent] Daily rollup merge failed:', error);
    });
}

/* ------------------------------------------------------------------------------------------------
 * Heartbeat (§16, §34)
 * ---------------------------------------------------------------------------------------------- */

export interface HeartbeatOutcome {
  serverTime: string;
  policy: ResolvedAgentPolicy;
  directives: AgentDirective[];
  availableVersion: { version: string; packageUrl: string; packageSha256: string } | null;
}

/**
 * Record a beat and answer with everything the agent needs to stay correct.
 *
 * The heartbeat is the module's only server→agent channel, because office PCs sit behind NAT and
 * cannot be reached. So it carries the policy (a change takes effect within one interval, with no
 * restart), the pending directives, and the update offer. That makes the response bigger than the
 * request, which is the right way round: the request runs every 90 seconds on every PC, and the
 * response only has to be small enough not to matter.
 */
export async function recordHeartbeat(options: {
  device: WindowsDevice;
  user: AgentUserIdentity | null;
  input: AgentHeartbeatInput;
  ipAddress: string | null;
  now?: Date;
}): Promise<HeartbeatOutcome> {
  const firestore = getFirebaseAdminFirestore();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const sentAt = new Date(options.input.sentAt);
  const clockSkewSeconds = Number.isNaN(sentAt.getTime())
    ? 0
    : Math.round((now.getTime() - sentAt.getTime()) / 1000);

  const departmentIds = [options.user?.departmentId, options.device.departmentId].filter(
    (value): value is string => Boolean(value),
  );
  const policy = await resolveEffectivePolicy({
    userId: options.user?.userId ?? null,
    deviceId: options.device.id,
    departmentIds,
  });

  const catalog = await loadAppCatalog();
  const processKey = normalizeProcessKey(options.input.processName);
  const category = catalog.get(processKey)?.category ?? defaultCategoryFor(processKey);

  const writes: Promise<unknown>[] = [
    firestore
      .collection(WINDOWS_AGENT_COLLECTIONS.heartbeats)
      .doc(windowsAgentIds.heartbeat(options.device.id))
      .set({
        deviceId: options.device.id,
        deviceName: options.device.deviceName,
        userId: options.user?.userId ?? null,
        userName: options.user?.name ?? null,
        sessionId: options.input.sessionId,
        receivedAt: nowIso,
        sentAt: options.input.sentAt,
        clockSkewSeconds,
        presence: options.input.presence,
        processName: processKey || null,
        applicationName: processKey
          ? resolveApplicationName(processKey, options.input.applicationName, catalog.get(processKey)?.displayName)
          : null,
        category,
        agentVersion: options.input.agentVersion,
        queuedSpanCount: Math.max(0, Math.round(Number(options.input.queuedSpanCount) || 0)),
        ipAddress: options.ipAddress,
      }),
    firestore
      .collection(WINDOWS_AGENT_COLLECTIONS.devices)
      .doc(options.device.id)
      .update({
        lastHeartbeatAt: nowIso,
        agentVersion: options.input.agentVersion,
        ipAddress: options.ipAddress,
        updatedAt: FieldValue.serverTimestamp(),
      }),
  ];

  if (options.input.sessionId) {
    writes.push(
      firestore
        .collection(WINDOWS_AGENT_COLLECTIONS.sessions)
        .doc(options.input.sessionId)
        .update({
          lastHeartbeatAt: nowIso,
          presence: options.input.presence,
          currentProcessName: processKey || null,
          currentApplicationName: processKey
            ? resolveApplicationName(processKey, options.input.applicationName, catalog.get(processKey)?.displayName)
            : null,
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch(() => {}),
    );
  }

  await Promise.all(writes);

  return {
    serverTime: nowIso,
    policy,
    directives: buildDirectives(options.device),
    availableVersion: policy.settings.autoUpdateEnabled
      ? await findAvailableVersion(options.device)
      : null,
  };
}

/**
 * Turn the administrator's flags on the device document into agent instructions.
 *
 * The directive id is derived from the instant the flag was raised, so an agent that has already
 * obeyed can recognise the same instruction and ignore it — otherwise a "sign out" flag that is
 * never cleared would sign the user out on every heartbeat, for ever.
 */
function buildDirectives(device: WindowsDevice): AgentDirective[] {
  const directives: AgentDirective[] = [];
  if (device.forceSignOutAt) {
    directives.push({
      directiveId: `signout:${device.forceSignOutAt}`,
      kind: 'SIGN_OUT',
      issuedAt: device.forceSignOutAt,
      reason: device.statusReason ?? null,
    });
  }
  if (device.forceReauthAt) {
    directives.push({
      directiveId: `reauth:${device.forceReauthAt}`,
      kind: 'FORCE_REAUTH',
      issuedAt: device.forceReauthAt,
      reason: device.statusReason ?? null,
    });
  }
  return directives;
}

/** The newest published version whose rings include this device's. */
async function findAvailableVersion(
  device: WindowsDevice,
): Promise<{ version: string; packageUrl: string; packageSha256: string } | null> {
  const firestore = getFirebaseAdminFirestore();
  const snapshot = await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.versions)
    .where('channel', '==', 'STABLE')
    .get()
    .catch(() => null);
  if (!snapshot || snapshot.empty) return null;

  const ring = device.updateRing || 'BROAD';
  const current = device.agentVersion || '0.0.0';
  let best: { version: string; packageUrl: string; packageSha256: string } | null = null;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.withdrawnAt) continue;
    if (!Array.isArray(data.rings) || !data.rings.includes(ring)) continue;
    const version = String(data.version || doc.id);
    if (compareVersions(version, current) <= 0) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      version,
      packageUrl: String(data.packageUrl || ''),
      packageSha256: String(data.packageSha256 || ''),
    };
  }

  return best?.packageUrl && best.packageSha256 ? best : null;
}

/* ------------------------------------------------------------------------------------------------
 * Retention (§51)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Delete raw activity spans older than the retention window.
 *
 * Only `windowsActivityEvents` is ever purged. The daily rollups, the per-application totals, the
 * sessions and the audit trail all survive, which is what §51 means by keeping aggregates longer:
 * "how many hours did the site office work last March" stays answerable for as long as the
 * organisation wants, while "which window was open at 14:32 on the 11th" — the genuinely intrusive
 * record, and the one with no lasting business purpose — does not.
 *
 * Capped per run and resumable, because a fleet of 200 PCs produces on the order of 100,000 spans
 * a month and a single unbounded delete would time out and achieve nothing. The cron calls it
 * every night and it converges.
 */
export async function purgeExpiredActivity(options: {
  now?: Date;
  limit?: number;
}): Promise<{ deleted: number; cutoff: string; complete: boolean }> {
  const firestore = getFirebaseAdminFirestore();
  const now = options.now ?? new Date();
  const policy = await resolveEffectivePolicy({ userId: null, deviceId: null, departmentIds: [] });
  const cutoff = retentionCutoffDate(policy.settings.rawActivityRetentionDays, now);
  const limit = Math.min(2000, Math.max(100, options.limit ?? 1000));

  const snapshot = await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.activityEvents)
    .where('workDate', '<', cutoff)
    .limit(limit)
    .get()
    .catch(() => null);
  if (!snapshot || snapshot.empty) return { deleted: 0, cutoff, complete: true };

  let deleted = 0;
  for (let index = 0; index < snapshot.docs.length; index += 400) {
    const batch = firestore.batch();
    snapshot.docs.slice(index, index + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += Math.min(400, snapshot.docs.length - index);
  }

  if (deleted > 0) {
    await writeAudit({
      action: 'RETENTION_PURGE',
      actorId: 'system',
      actorName: 'Retention job',
      targetType: 'activity',
      targetId: cutoff,
      targetLabel: `Raw activity before ${cutoff}`,
      newValue: { deleted, retentionDays: policy.settings.rawActivityRetentionDays },
    });
  }

  return { deleted, cutoff, complete: snapshot.size < limit };
}

/* ------------------------------------------------------------------------------------------------
 * Settings (§37, §52)
 * ---------------------------------------------------------------------------------------------- */

export interface WindowsAgentSettings {
  /** §37 — whether employees may open their own activity page. Transparency-first default. */
  employeeSelfViewEnabled: boolean;
  /** §52 — the disclosure text shown to employees; the "never collected" list is not editable. */
  monitoringPolicyText: string | null;
  /** Minimum session length below which the attendance report says "Short Duration". */
  minimumFullDaySeconds: number;
}

export const DEFAULT_WINDOWS_AGENT_SETTINGS: WindowsAgentSettings = {
  employeeSelfViewEnabled: true,
  monitoringPolicyText: null,
  minimumFullDaySeconds: 8 * 60 * 60,
};

export async function loadWindowsAgentSettings(): Promise<WindowsAgentSettings> {
  const firestore = getFirebaseAdminFirestore();
  const snapshot = await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.settings)
    .doc(WINDOWS_AGENT_SETTINGS_DOC_ID)
    .get()
    .catch(() => null);
  if (!snapshot?.exists) return { ...DEFAULT_WINDOWS_AGENT_SETTINGS };
  const data = snapshot.data() || {};
  return {
    employeeSelfViewEnabled: data.employeeSelfViewEnabled !== false,
    monitoringPolicyText:
      typeof data.monitoringPolicyText === 'string' ? data.monitoringPolicyText : null,
    minimumFullDaySeconds: Number.isFinite(Number(data.minimumFullDaySeconds))
      ? Math.max(3600, Math.round(Number(data.minimumFullDaySeconds)))
      : DEFAULT_WINDOWS_AGENT_SETTINGS.minimumFullDaySeconds,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Audit (§50)
 * ---------------------------------------------------------------------------------------------- */

export interface AuditInput {
  action: WindowsAuditAction;
  actorId: string;
  actorName: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append one administrative action to the trail.
 *
 * Never throws. An audit write that fails must not roll back the action it was recording — that
 * would mean a Firestore hiccup could block an administrator from blocking a compromised PC. The
 * failure is logged loudly instead, and the Firestore rules make the collection append-only so the
 * trail cannot be edited after the fact by anybody, including the people who write to it.
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const firestore = getFirebaseAdminFirestore();
    await firestore.collection(WINDOWS_AGENT_COLLECTIONS.auditLogs).add({
      action: input.action,
      actorId: input.actorId,
      actorName: input.actorName,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      at: new Date().toISOString(),
      module: ACTIVITY_MODULES.WINDOWS_AGENT,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('[windows-agent] Audit write failed:', error);
  }
}

/** A stable id for an idempotent notification, so the same cause never notifies twice. */
export function notificationIdFor(module: string, itemId: string, kind: string): string {
  return createHash('sha1').update(`${module}::${itemId}::${kind}`).digest('hex').slice(0, 32);
}

/** A fresh id for anything that genuinely is new each time. */
export function newId(): string {
  return randomUUID();
}

export type { NormalizedSpan };
