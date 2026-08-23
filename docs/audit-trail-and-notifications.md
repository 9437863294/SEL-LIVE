# Audit trail and notifications

How every module records **who added a record**, **who last changed it**, **what they
changed**, and how it reaches people through the notification bell.

Three separate concerns, three shared modules. Use them rather than hand-rolling the
fields — the drift they replace is described at the bottom.

---

## 1. Who created / who updated a record

Stamp the record itself, so the answer travels with the data and survives log
retention.

**Client (forms, pages, components):**

```ts
import { actorFromUser, withCreateAudit, withUpdateAudit } from '@/lib/audit-fields';
import { useAuth } from '@/components/auth/AuthProvider';

const { user } = useAuth();
const actor = useMemo(() => actorFromUser(user), [user]);

await addDoc(collection(db, 'vehicles'), { ...values, ...withCreateAudit(actor) });
await updateDoc(doc(db, 'vehicles', id), { ...changes, ...withUpdateAudit(actor) });
```

**Server (API routes, admin-SDK services):**

```ts
import { withCreateAuditServer, withUpdateAuditServer, SYSTEM_ACTOR } from '@/lib/audit-fields-server';

await db.collection('vehicles').add({ ...values, ...withCreateAuditServer(actor) });
```

Use `SYSTEM_ACTOR` when no human triggered the write (cron, webhook). It records
"System" rather than leaving the author blank, so "nobody did this" and "we failed to
record who did this" stay distinguishable.

### The fields

| Field | Written by | Meaning |
| --- | --- | --- |
| `createdBy` / `createdByName` / `createdAt` | `withCreateAudit` | Who first saved it |
| `updatedBy` / `updatedByName` / `updatedAt` | both helpers | Who last changed it |
| `deletedBy` / `deletedByName` / `deletedAt` / `isDeleted` | `withSoftDeleteAudit` | Soft delete |

`withCreateAudit` mirrors the created stamps into the updated ones. A fresh record
therefore has both populated, and **an absent `updatedBy` does not mean "never
edited"** — it means the record predates stamping. To tell a fresh record from an
edited one, use the read helpers rather than checking for the field:

```ts
import { formatCreatedBy, formatUpdatedBy, hasBeenEdited } from '@/lib/audit-fields';

<p>Created: {formatCreatedBy(record)}</p>
{formatUpdatedBy(record) && <p>Updated: {formatUpdatedBy(record)}</p>}
```

`formatUpdatedBy` returns `null` for an unedited record, so the row can be omitted
instead of duplicating the created line.

---

## 2. Activity log — what happened, across every module

Stamps say who owns a record *now*. The activity log says what was done to it and by
whom, including deletes, and is what `/settings/audit-logs` reads.

**Client:**

```ts
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { diffFields } from '@/lib/activity-logger';

const { log } = useActivityLogger(ACTIVITY_MODULES.VEHICLE_MANAGEMENT);

const changes = diffFields(existingRecord, formValues);   // before the write
await log('Edit Vehicle', { changes }, { recordId: id, recordRef: vehicleNumber });
```

**Server:**

```ts
import { logServerActivity, SYSTEM_LOG_ACTOR, requestProvenance } from '@/lib/activity-logger-server';

await logServerActivity({
  ...SYSTEM_LOG_ACTOR,
  module: ACTIVITY_MODULES.FIXED_DEPOSIT,
  action: 'Daily Controls Run',
  source: 'cron',
  details: { depositsChecked, statusesUpdated },
});
```

`requestProvenance(request)` pulls IP and user-agent off an incoming request so an
API-route row carries the same provenance a browser-written one does.

### Rules

- **Always pass `module` from `ACTIVITY_MODULES`.** A bare string literal that
  differs by a character files the action under a module of its own, which is how
  `insurance` and `Insurance` ended up as two entries in the filter.
- **`module` is where the log row files, not a payload field.** Anything else goes in
  `details`.
- **Pass `recordId` / `recordRef`.** They are indexed, so a reviewer can pull every
  action against one record instead of string-matching free-form details.
- **On delete, log the record's identifying fields.** The row is about to be the only
  surviving trace; an ID that no longer resolves is not enough.
- **Use `diffFields(before, after)` for edits** so the log says *what* changed. It
  skips the audit stamps (which change on every write) and treats `null`/`undefined`/
  `''` as equivalent, so a field going from unset to empty is not reported as an edit.
  Pass only the fields the form owns — diffing a whole Firestore document against form
  values flags every field the form does not manage.

---

## 3. Notifications

One collection, `userNotifications`; one reader, the bell in `components/app/Header`.

```ts
import { dispatchNotification } from '@/lib/notifications';          // client
import { dispatchNotificationServer } from '@/lib/notifications-server'; // server

await dispatchNotification(
  { userIds: [ownerId], roles: ['Finance Manager'] },
  {
    type: 'approval_required',
    module: ACTIVITY_MODULES.EXPENSES,
    severity: 'WARNING',
    title: 'Expense awaiting approval',
    body: `${expenseRef} · ₹${amount}`,
    itemId: expenseId,
    link: `/expenses/${expenseId}`,
  },
);
```

- **Roles are resolved to users at write time** and one document is written per
  recipient. That keeps the read side a single indexed `userId == me` query, which is
  what makes the bell cheap enough to hold open on every page. Inactive users are
  skipped.
- **Do not filter by `type` anywhere on the read path.** The bell used to carry a
  hardcoded type allowlist, which meant a module only reached it by editing
  `Header.tsx`. Any producer now shows up without touching that file.
- **Scheduled jobs must use `dispatchNotificationOnce(recipients, payload, dedupeKey)`.**
  It writes a deterministic document ID via `create()`, so a re-run is a no-op. Plain
  `set()` would overwrite the stored document and reset `read` to false, resurrecting
  alerts the recipient had already cleared. Build the key from the record and the
  milestone (and the date only if you want a daily repeat), never from the run time.
- **Dispatch never throws.** A notification that cannot be written must not roll back
  the action that triggered it — check the return value (recipients reached) if the
  caller cares.

### Push (mobile + web)

Every dispatched notification is also delivered as a push — Android, iOS and the
browser. Producers do not opt in; `dispatchNotification` and
`dispatchNotificationServer` handle it.

```text
                       ┌─ browser ─┐
dispatchNotification ──┤           ├─→ POST /api/notifications/push ─┐
        (client)       └───────────┘        (IDs only, see below)    │
                                                                     ├─→ sendPushToUsers
dispatchNotificationServer ──────────────────────────────────────────┘      (FCM sendEach)
        (API routes, cron)
```

- **The client cannot reach FCM** (that needs admin credentials), so it writes the
  notification documents and posts their **IDs** to `/api/notifications/push`. The
  route reads the payload back out of Firestore. It deliberately does not accept a
  title, body and recipient list — an endpoint that did would let any signed-in user
  push arbitrary text to anyone in the organisation.
- **Tokens live in `users/{userId}/pushDevices/{sha256(token)}`** with
  `{token, platform, enabled, chatEnabled}`, shared by all three platforms.
- **Delivery never blocks the caller.** Both the route and `sendPushToUsers` swallow
  failures; a push that does not land is a degraded delivery, not a failed save.
- **Dead tokens are pruned** when FCM reports them unregistered, so per-alert cost
  does not grow with uninstalls.
- **Scheduled jobs push only newly-created notifications.** `dispatchNotificationOnce`
  tracks which recipients' documents it actually created and pushes to those only —
  otherwise a daily sweep would re-alert everyone on every pass.
- **`collapseKey`** replaces rather than stacks a device notification (Android `tag`,
  APNs `threadId`, web `tag`), so repeated alerts about one record don't bury the rest.

#### Configuration this depends on

| Platform | Requirement | If missing |
| --- | --- | --- |
| Web | `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (Firebase Console → Project settings → Cloud Messaging → Web Push certificates) | Registration is skipped with a console warning; web push stays off |
| Web | `public/firebase-messaging-sw.js` served at that exact path | FCM cannot register a background handler |
| iOS | APNs auth key uploaded to Firebase | FCM rejects the send and the token is pruned as invalid |
| Android | Already configured | — |

The service worker duplicates the Firebase config from `src/lib/firebase.ts` because
a worker runs outside the bundler and cannot import app modules. Those values are
public client identifiers, not secrets — but keep the two in step.

#### Android channels

Two, so a user can silence one without losing the other:
`sel_chat_messages` (chat) and `sel_module_alerts` (approvals, escalations, reminders).

#### `chatEnabled`

Device registration used to be gated on Chat System permission, and actively
*unregistered* the device when the user lacked it — so a user without chat access had
no token and could receive nothing from any module. Registration is now
unconditional; the permission travels on the device record as `chatEnabled`, and
`api/chat/notify` skips devices where it is `false`. Absent means an older
registration, which only ever existed for a chat-permitted user.

### Role-targeted notifications

The bank-guarantee and letter-of-credit services raise alerts from inside a Firestore
transaction, where roles cannot be resolved (a transaction's reads must all precede
its writes). Those write a single document carrying `targetRoles` and no `userId`;
the bell picks them up via `fetchRoleTargetedNotifications`. Prefer `dispatchNotification`
anywhere you are not inside a transaction.

### Reading

`normalizeNotification(id, data)` maps any stored shape to one type. Three producers
historically disagreed — `body` vs `message`, `link` vs `pageUrl`, `read: false` vs
`status: 'UNREAD'` vs `status: 'ACTIVE'` — so read paths must go through it rather
than touching fields directly.

---

## Indexes

Filtering and delivery both depend on composite indexes declared in
`firestore.indexes.json`. After changing a query, deploy them:

```sh
firebase deploy --only firestore:indexes
```

A missing index surfaces as `failed-precondition`. Every listener here reports that
case explicitly — do not swallow it. The bell's listener previously used an empty
error callback, so a missing index was indistinguishable from having no notifications,
and the feature was silently dead.

---

## What this replaced

Worth knowing, because the old shapes are still in the database:

- **Audit stamps** existed in six modules and were absent from the rest. The naming was
  already consistent (`createdBy`/`createdByName`/…), so the helpers adopt it — the
  fields are unchanged, only the coverage and the call-site ergonomics.
- **The activity log could not run server-side at all.** `activity-logger.ts` imports
  the browser Firebase SDK, so 216 service-layer writes and 23 API routes left no
  trace. `activity-logger-server.ts` closes that.
- **Notifications had three incompatible schemas** in one collection, and the bell
  read one of them behind a three-type allowlist. Fixed-deposit maturity alerts and
  every bank-guarantee alert were written and shown to nobody.
- **Push existed only for chat, only on Android.** The web app had no service worker
  and never imported `firebase/messaging`; the iOS app registered nothing because the
  platform check was `!== 'android'`. Every other module's alerts stopped at the bell.

### Still outstanding

- `auditLogs` (top-level, written by the BG/FD/LC services) and the per-record
  `auditLogs` subcollections (recurring payments) are **not** surfaced in
  `/settings/audit-logs` — only their own module's detail pages read them. A reviewer
  looking at the central viewer sees none of it.
- Audit stamps and activity logging still need rolling out across the remaining
  modules. Per-module coverage can be checked with:

  ```sh
  grep -rc "withCreateAudit\|withUpdateAudit" "src/app/(protected)/<module>"
  ```
