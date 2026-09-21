/**
 * The Admin SDK half of work calls (§S).
 *
 * Mirrors the pattern the Windows Agent routes already use: the pure rules live in
 * `work-calls-model.ts`, everything that touches Firestore lives here, and the routes are thin.
 *
 * ── Why the client never writes these documents directly ───────────────────────────────────────
 *
 * A call record is a claim about how somebody spent nineteen minutes, and the resolution engine
 * turns it into reported work time. Letting the phone write it would mean letting the phone
 * decide its own duration, and the four-hour ceiling and the confirmation rules would be
 * advisory. They are enforced here instead, where they cannot be skipped.
 */

import { getFirebaseAdminFirestore } from './firebase-admin';
import { workDateOf } from './windows-agent-rules.ts';
import {
  MAX_CALL_SECONDS,
  WORK_CALL_COLLECTIONS,
  WORK_CONTACT_TYPES,
  type WorkCall,
  type WorkCallState,
  type WorkContact,
  type WorkContactType,
  isDialableMobile,
  normalizeMobile,
  resolveCallDuration,
} from './work-calls-model.ts';

export class WorkCallError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'WorkCallError';
  }
}

/* ------------------------------------------------------------------------------------------------
 * Directory
 * ---------------------------------------------------------------------------------------------- */

export interface ContactSearchOptions {
  query?: string;
  contactType?: string;
  projectId?: string;
  limit?: number;
}

/**
 * Search the directory.
 *
 * Filtered in memory after one indexed read rather than with a Firestore query per field.
 * A work directory is hundreds of rows, not hundreds of thousands, and the alternative is a
 * composite index per combination of name, company, type and project — or a search service —
 * for a list that fits comfortably in a single read.
 */
export async function searchContacts(options: ContactSearchOptions = {}): Promise<WorkContact[]> {
  const firestore = getFirebaseAdminFirestore();
  const snapshot = await firestore
    .collection(WORK_CALL_COLLECTIONS.contacts)
    .where('active', '==', true)
    .limit(2000)
    .get();

  const needle = (options.query || '').trim().toLowerCase();
  const digits = needle ? normalizeMobile(needle) : '';

  const matches = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<WorkContact, 'id'>) }))
    .filter((contact) => {
      if (options.contactType && contact.contactType !== options.contactType) return false;
      if (options.projectId && contact.projectId !== options.projectId) return false;
      if (!needle) return true;

      // A number typed into the same box as a name should find the contact, because that is
      // what somebody holding a scrap of paper actually does.
      if (digits.length >= 4 && (contact.mobileNormalized || '').includes(digits)) return true;

      return (
        contact.name.toLowerCase().includes(needle) ||
        (contact.company || '').toLowerCase().includes(needle) ||
        (contact.designation || '').toLowerCase().includes(needle)
      );
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return matches.slice(0, Math.min(Math.max(options.limit ?? 50, 1), 200));
}

export interface ContactInput {
  name?: unknown;
  company?: unknown;
  designation?: unknown;
  mobile?: unknown;
  email?: unknown;
  projectId?: unknown;
  siteId?: unknown;
  department?: unknown;
  contactType?: unknown;
  userId?: unknown;
}

/**
 * Create or update a contact.
 *
 * Refuses a second contact with the same number unless it is the one being edited — see
 * `mobileNormalized` on the model for why three spellings of one site manager is the normal
 * failure rather than an unlikely one.
 */
export async function upsertContact(
  input: ContactInput,
  actor: { userId: string; userName: string },
  contactId?: string,
): Promise<WorkContact> {
  const firestore = getFirebaseAdminFirestore();

  const name = text(input.name, 120);
  if (!name) throw new WorkCallError('A contact needs a name.');

  const mobile = text(input.mobile, 40);
  if (!mobile || !isDialableMobile(mobile)) {
    throw new WorkCallError('That does not look like a number the phone could dial.');
  }

  const contactType = (WORK_CONTACT_TYPES as readonly string[]).includes(String(input.contactType))
    ? (input.contactType as WorkContactType)
    : 'OTHER';

  const mobileNormalized = normalizeMobile(mobile);

  const duplicates = await firestore
    .collection(WORK_CALL_COLLECTIONS.contacts)
    .where('mobileNormalized', '==', mobileNormalized)
    .limit(5)
    .get();
  const clash = duplicates.docs.find((doc) => doc.id !== contactId);
  if (clash) {
    throw new WorkCallError(
      'That number is already in the directory as "' + String(clash.get('name')) + '".',
      409,
    );
  }

  const now = new Date().toISOString();
  const document = {
    name,
    company: text(input.company, 120),
    designation: text(input.designation, 120),
    mobile,
    mobileNormalized,
    email: text(input.email, 160),
    projectId: text(input.projectId, 60),
    siteId: text(input.siteId, 60),
    department: text(input.department, 80),
    contactType,
    userId: text(input.userId, 60),
    active: true,
    updatedAt: now,
    updatedBy: actor.userId,
  };

  const ref = contactId
    ? firestore.collection(WORK_CALL_COLLECTIONS.contacts).doc(contactId)
    : firestore.collection(WORK_CALL_COLLECTIONS.contacts).doc();

  if (contactId) {
    await ref.set(document, { merge: true });
  } else {
    await ref.set({ ...document, createdAt: now, createdBy: actor.userId });
  }

  return { id: ref.id, ...document } as WorkContact;
}

/* ------------------------------------------------------------------------------------------------
 * Calls
 * ---------------------------------------------------------------------------------------------- */

export interface StartCallInput {
  contactId?: unknown;
  /** For a number dialled without a directory entry. */
  contactName?: unknown;
  mobile?: unknown;
  projectId?: unknown;
  projectName?: unknown;
  siteId?: unknown;
  purpose?: unknown;
  deviceInfo?: unknown;
}

/**
 * Record that a number was handed to the dialer.
 *
 * `DIALLED` is the only state this can honestly create. The server stamps the time rather than
 * trusting the phone's clock: a handset with a wrong clock would otherwise place a call in
 * yesterday's timeline, or in next week's.
 */
export async function startCall(
  input: StartCallInput,
  actor: { userId: string; employeeId: string | null },
): Promise<WorkCall> {
  const firestore = getFirebaseAdminFirestore();

  let contact: WorkContact | null = null;
  const contactId = text(input.contactId, 60);
  if (contactId) {
    const snapshot = await firestore.collection(WORK_CALL_COLLECTIONS.contacts).doc(contactId).get();
    if (!snapshot.exists) throw new WorkCallError('That contact no longer exists.', 404);
    contact = { id: snapshot.id, ...(snapshot.data() as Omit<WorkContact, 'id'>) };
  }

  const contactName = contact ? contact.name : text(input.contactName, 120);
  if (!contactName) throw new WorkCallError('A call needs a contact or a name.');

  const dialledAtInstant = new Date();
  const now = dialledAtInstant.toISOString();
  const document = {
    userId: actor.userId,
    employeeId: actor.employeeId,

    contactId: contact ? contact.id : null,
    contactName,
    contactCompany: contact ? contact.company : null,
    contactType: (contact ? contact.contactType : 'OTHER') as WorkContactType,

    projectId: contact?.projectId ?? text(input.projectId, 60),
    projectName: text(input.projectName, 120),
    siteId: contact?.siteId ?? text(input.siteId, 60),
    purpose: text(input.purpose, 200),

    state: 'DIALLED' as WorkCallState,
    dialledAt: now,
    // The partition key every daily report reads, in the office timezone rather than UTC.
    workDate: workDateOf(dialledAtInstant),
    endedAt: null,
    durationSeconds: null,
    durationSource: null,

    deviceInfo: text(input.deviceInfo, 120),
    createdAt: now,
    updatedAt: now,
  };

  const ref = await firestore.collection(WORK_CALL_COLLECTIONS.calls).add(document);
  return { id: ref.id, ...document } as WorkCall;
}

export interface EndCallInput {
  callId?: unknown;
  /** Supplied when the employee types a duration instead of relying on when they came back. */
  durationSeconds?: unknown;
  /** The employee saying the call did not happen. */
  cancelled?: unknown;
  purpose?: unknown;
}

/**
 * Confirm or cancel a dialled call.
 *
 * The rules in `resolveCallDuration` decide the outcome, so the ceiling and the minimum cannot
 * be bypassed by a client sending whatever it likes. A call the rules refuse is stored as
 * `NOT_CONFIRMED` with the reason, which is visible in the report rather than silently absent.
 */
export async function endCall(
  input: EndCallInput,
  actor: { userId: string },
): Promise<WorkCall> {
  const firestore = getFirebaseAdminFirestore();

  const callId = text(input.callId, 60);
  if (!callId) throw new WorkCallError('Which call?');

  const ref = firestore.collection(WORK_CALL_COLLECTIONS.calls).doc(callId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new WorkCallError('That call was not found.', 404);

  const existing = { id: snapshot.id, ...(snapshot.data() as Omit<WorkCall, 'id'>) };

  // Somebody else's call is none of this caller's business, even with a valid token.
  if (existing.userId !== actor.userId) {
    throw new WorkCallError('That call belongs to somebody else.', 403);
  }
  if (existing.state !== 'DIALLED') {
    // Already settled. Returned rather than refused: a phone that retries a confirmation after
    // a dropped connection should not get an error for succeeding twice.
    return existing;
  }

  const now = new Date().toISOString();

  if (input.cancelled === true) {
    const cancelled = { state: 'CANCELLED' as WorkCallState, endedAt: now, durationSeconds: null, durationSource: null, updatedAt: now };
    await ref.set(cancelled, { merge: true });
    return { ...existing, ...cancelled };
  }

  const explicit = Number(input.durationSeconds);
  const outcome = resolveCallDuration(
    existing.dialledAt,
    now,
    Number.isFinite(explicit) ? explicit : null,
  );

  const update = {
    state: outcome.state,
    endedAt: now,
    durationSeconds: outcome.seconds,
    durationSource: (Number.isFinite(explicit) ? 'MANUAL' : 'RETURN_TO_APP') as WorkCall['durationSource'],
    unconfirmedReason: outcome.reason,
    purpose: text(input.purpose, 200) ?? existing.purpose,
    updatedAt: now,
  };

  await ref.set(update, { merge: true });
  return { ...existing, ...update } as WorkCall;
}

/**
 * One person's calls for one office-local day, for the timeline and §AL's report.
 *
 * Matches on the stamped `workDate` rather than a UTC range over `dialledAt` — see the field's
 * note on the model for the five and a half hours where those two answers differ.
 */
export async function callsForDay(userId: string, workDate: string): Promise<WorkCall[]> {
  const firestore = getFirebaseAdminFirestore();

  const snapshot = await firestore
    .collection(WORK_CALL_COLLECTIONS.calls)
    .where('userId', '==', userId)
    .where('workDate', '==', workDate)
    .orderBy('dialledAt')
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<WorkCall, 'id'>) }));
}

/** Anything the phone sends is a string of unknown length until proven otherwise. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export { MAX_CALL_SECONDS };
