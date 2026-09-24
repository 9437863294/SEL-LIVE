# Mail Hub

Every ERP user can connect their own mailboxes — Google Workspace/Gmail, Microsoft 365/Outlook, or
the company IMAP/SMTP server behind Roundcube — and read, write and organise mail inside the ERP,
linking conversations to projects, vendors, POs, invoices, approvals and tasks. Teams work shared
mailboxes with assignment, deadlines, internal notes, routing rules and reports.

The pages live under `/mail` (`src/app/(protected)/mail`), the API under `/api/mail-hub`, the logic
under `src/lib/mail-hub`, and the tests under `tests/mail-hub-*.test.mjs`. The manual test plan is
[`mail-hub-test-checklist.md`](mail-hub-test-checklist.md); every environment variable is in
[`mail-hub.env.example`](mail-hub.env.example).

---

## 1. Access model

These rules are the reason the module is shaped as it is. They are implemented in one pure file,
`src/lib/mail-hub/permissions.ts`, and pinned by `tests/mail-hub-permissions.test.mjs`.

1. **A personal mailbox belongs to the user who connected it.** Nobody else can read it — not a
   colleague, not a manager, not an administrator holding every permission in the ERP. There is no
   "view all" for mail and no override. `decideMailboxAccess` answers "no" for a non-owner before it
   looks at any permission.
2. **A shared mailbox needs two independent yeses**, both checked on every request:
   - **ERP**: the `Mail Hub › Shared Mail › Read` permission *and* a membership row for that
     mailbox (added by an administrator);
   - **Provider**: evidence from Google, Microsoft or the IMAP server that the member's *own*
     account has been granted the mailbox. The member verifies this with their own connected
     account; the worker re-checks it every 12 hours, and a grant older than 72 hours stops working.
3. **Sending as a shared mailbox always goes through the member's own provider login**, so the
   provider enforces send-as itself (Gmail send-as aliases, Exchange SendAs/SendOnBehalf, SMTP
   sender restrictions). The shared mailbox's syncing credentials never send for a member. A From
   address the provider has not verified is refused by the ERP before the provider sees it.
4. **Administering Mail Hub is not reading mail.** `Settings › Administer` manages shared mailboxes,
   memberships, mail servers and retention. The audit trail shown to administrators covers shared
   mailboxes and configuration — never the subject lines of someone's personal mail.

### Permissions (`src/lib/permissions.ts` › "Mail Hub")

| Node | Allows |
|---|---|
| `Accounts › Connect` | Connect your own mailboxes. Reading your own mail needs nothing more. |
| `Compose › Send` | Send mail at all. |
| `Shared Mail › Read` | Read shared mailboxes you are a verified member of. |
| `Shared Mail › Assign` | Assign shared conversations to others; change their status and deadline. |
| `Shared Mail › Send` | Send from shared mailboxes whose membership allows it. |
| `Templates › View / Manage` | Use / create department and organisation templates and department signatures. |
| `Reports › View` | Shared-mailbox workload reports (counts and times only). |
| `Settings › Administer` | Shared mailboxes, members, IMAP/SMTP servers, providers, retention. |
| `AI › Use` | Offer AI suggestions (each user must still opt in). |
| `Audit › View` | The shared-mailbox and configuration audit trail. |

Nobody holds any of these on day one; grant them in Access Management.

Membership roles: **reader** (read only), **responder** (reply, notes, take and work
assignments, modify the mailbox), **manager** (also edits routing rules, with `Assign`).

---

## 2. Architecture

```
 Browser (/mail/*)                         Server (/api/mail-hub/*, Node runtime)
 ────────────────                          ─────────────────────────────────────────────────────
 client.ts ── Bearer ID token ──►  route.ts → server.ts: mailContext → requireMailbox(decideMailboxAccess)
   (no provider tokens,                        │
    no Firestore reads)                        ├─ mailbox-service  (list, thread, body, attachment, actions, search)
                                               ├─ compose-service  (drafts, send, schedule, uploads)
                                               ├─ workflow-service (links, notes, assignments, follow-ups,
                                               │                    templates, signatures, rules, shared admin,
                                               │                    reports, audit, reminder sweep)
                                               ├─ accounts-service (OAuth/IMAP connect, watch, disconnect, purge)
                                               └─ ai-service       (opt-in suggestions)
                                                        │
             provider adapters (providers/*.ts) ◄───────┤  one interface: gmail.ts · graph.ts · imap.ts
             sync-engine.ts · send-engine.ts · jobs.ts   ├─ pure engines, storage injected (store.ts)
             secrets.ts + envelope.ts (KMS / Secret Mgr) ┘
 Scheduler ── every minute ──► /api/mail-hub/worker ── sweeps + drains mailHubJobs
 Gmail Pub/Sub ──► /webhooks/gmail ─┐
 Graph         ──► /webhooks/graph ─┴─► enqueue `sync:<accountId>` (deduplicated)
```

**Common model vs provider identity.** `model.ts` is the only vocabulary above the adapters.
Provider identifiers survive only in fields named for them (`providerMessageId`,
`providerFolderId`, `providerThreadId`) and as opaque cursor strings. Capabilities
(`labels`, `archive`, `move`, `permanentDelete`, `drafts`, `serverSearch`, `sendAs`, attachment
limit…) come from the adapter, and the UI shows actions from them rather than from the provider
name.

| Provider | Identity | Threads | Change detection |
|---|---|---|---|
| Gmail | message id | Gmail thread id | `users.watch` → Pub/Sub push; `history.list` from the stored history id |
| Microsoft Graph | **immutable** id (`Prefer: IdType="ImmutableId"`) — survives moves | `conversationId` | `/subscriptions` change + lifecycle notifications; per-folder `delta` |
| IMAP | `folder:UIDVALIDITY:UID` | References root / In-Reply-To | STATUS pre-check, CONDSTORE `CHANGEDSINCE`, UID-set diff; polled every 5 minutes |

Every account also gets a slow **safety-net poll** (30 minutes when push is healthy), so a lost
notification costs latency, never mail.

### Code map

| File | Role |
|---|---|
| `model.ts` | Types, collections, defaults (pure) |
| `permissions.ts` | Capabilities and `decideMailboxAccess` (pure) |
| `rules.ts` | Addresses, reply recipients, quoting, threading keys, search, attachment policy, deadlines, routing, reports, recovery advice, backoff (pure) |
| `sanitize.ts`, `frame.ts` | Received-HTML allowlist, link hardening, the display frame's CSP |
| `compose.ts` | Compose-request whitelist and outgoing-content assembly (pure) |
| `mime.ts` | RFC 5322 building (nodemailer MailComposer), Bcc stripping, envelope |
| `sync-engine.ts` | The sync loop (pure, store + adapter injected) |
| `send-engine.ts` | Exactly-once sending (pure, store + adapter injected) |
| `jobs.ts` | Queue transitions and the worker loop (pure) |
| `envelope.ts` / `secrets.ts` | Envelope encryption / KMS + Secret Manager key store |
| `oauth-shared.ts` / `oauth.ts` | PKCE, signed single-use state, scopes / exchange, refresh, revoke |
| `providers/*` | `types.ts` contract, `http.ts` error mapping, `gmail(-map).ts`, `graph.ts`, `imap.ts`, `mime-parse.ts` |
| `store.ts` | Firestore implementations of the engine interfaces |
| `server.ts` | Request context, `requireMailbox`, provider factory, audit |
| `*-service.ts`, `worker.ts`, `webhook-auth.ts`, `route.ts`, `client.ts` | As named |

---

## 3. Data model

All collections are **server-only** — `firestore.rules` denies every client read and write, and
the Admin SDK is the only accessor. (The ownership and dual-grant rules cannot be expressed in
Firestore rules, and an approximation would be worse than a wall.)

| Collection | Key | Holds |
|---|---|---|
| `mailHubAccounts` | `ma_<hash(owner,provider,address,kind)>` | Owner, provider, kind (personal/shared), address, login identity, status + reason, capabilities, verified send-as identities, sync state (phase, listing position, generation, failures, back-off, pending refetches), watch state |
| `mailHubCredentials` | account id | **Sealed** refresh token or password (AES-256-GCM, per-secret data key wrapped by KMS / Secret Manager key, bound to the account id) |
| `mailHubOAuthStates` | nonce | Single-use OAuth state: user, purpose, PKCE verifier, 10-minute expiry |
| `mailHubFolders` | `<acct>__f<hash>` | Provider folder/label id, role, counts, IMAP UIDVALIDITY/MODSEQ |
| `mailHubMessages` | `<acct>__m<hash(providerId)>` | Headers, snippet, flags, folder ids, view keys, search tokens, attachment metadata, sync generation, soft delete |
| `mailHubBodies` | message id | Sanitised body cache with `expiresAt` |
| `mailHubThreads` | `<acct>__t<hash(threadKey)>` | Aggregates (participants, counts, first inbound/response, awaiting reply), view keys, **assignment** (assignee, status, due), link/note counts |
| `mailHubSyncCursors` | `<acct>__c<scope>` | Gmail history id / Graph delta link / IMAP UID-set + MODSEQ, per scope |
| `mailHubSharedMailboxes` | auto | Name, address, syncing account, department, default response hours, active |
| `mailHubMailboxMembers` | `<mailbox>__<user>` | Role, may-send, the member's own account, **provider grant** (read/send status, method, checked at) |
| `mailHubLinks` | `<thread>__<type>__<hash>` | Thread ↔ ERP record, record path/label, subject/sender/date **snapshot** |
| `mailHubNotes` | auto | Internal notes (plain text, mentions) — never sent |
| `mailHubFollowUps` | auto | Owner, due, priority, reminder offsets, status, optional Office Hub task id |
| `mailHubTemplates` / `mailHubSignatures` | auto | Personal / department / global content |
| `mailHubRoutingRules` | auto | Shared-mailbox conditions → assignee + deadline |
| `mailHubUserSettings` | user id | Reminders, trusted image domains, shortcuts, **AI opt-in** |
| `mailHubSettings/global` | — | IMAP/SMTP presets, enabled providers, sync window, retention, attachment limit |
| `mailHubOutbound` | auto | Drafts, scheduled and sent messages: parts, recipients, **fixed Message-ID**, status, attempts, lease |
| `mailHubUploads` | auto | Compose attachments in Storage (`mail-hub/uploads/...`), scan status, expiry |
| `mailHubAuditEvents` | auto / deterministic | Append-only audit trail |
| `mailHubJobs` | `k_<dedupeKey>` or auto | Queue: type, payload, status, runAt, attempts, lease, rerun |

**View keys.** Firestore allows one `array-contains-any` per query, so every message/thread carries
`a:<acct>:r:<role>` and `a:<acct>:f:<folder>` keys; the unified inbox is one query across accounts.
Gmail "archive" is computed as *in All Mail and not in the inbox*.

Composite indexes are in `firestore.indexes.json`.

---

## 4. Sync, jobs and failure handling

`runMailSync` (`sync-engine.ts`) is one run for one account:

1. Refresh folders.
2. **Initial or recovery listing** — captures change cursors *before* listing (so mail arriving
   during a long first sync is not lost), walks the sync window page by page, saving its position
   after every page.
3. **Retry** messages whose metadata fetch failed earlier (`pendingRefetch`).
4. **Incremental** changes per cursor; the cursor is saved *after* the page it covers is applied.
5. For shared mailboxes, new inbound mail is **routed** (first matching rule → assignee + deadline,
   else the mailbox's default deadline); a closed conversation that receives a reply reopens.

| Situation | What happens |
|---|---|
| Duplicate / out-of-order notifications | Enqueue collapses on `sync:<accountId>`; a notification during a run sets `rerun`; applying a change is idempotent |
| Crash between apply and cursor save | The page is replayed on the next run; nothing is skipped or doubled |
| Run exceeds its 45 s budget | Returns `continue`; resumes from the saved page without spending an attempt |
| Expired cursor (Gmail 404 history, Graph 410, IMAP UIDVALIDITY change) | Recovery listing with a new generation; messages in the window not seen again are tombstoned |
| Moved message | Graph: folder-scoped removal + authoritative arrival, either order; IMAP: removal + arrival in the same thread |
| Rate limit (429 / Gmail 403 quota) | Keeps what was applied; retries after `Retry-After`; not counted as a failure |
| Provider down / network | Exponential backoff with jitter; after 3 failures the account shows *Provider problem* with the next retry time |
| Grant revoked / password changed | Account → *Reconnect needed*; the owner is notified once; syncing stops until reconnected |
| Disconnect during a sync | The account is re-read before every page; the run stops writing; purge runs twice (now and +10 min) |

**Jobs** (`mailHubJobs`, drained by `/api/mail-hub/worker` every minute): `sync`, `watch.renew`,
`send.outbound`, `account.purge`, `grants.verify`, `notify.sweep`, `retention.sweep`. Leases
expire and are reclaimed; real errors retry with backoff up to 8 attempts, then the job is
dead-lettered (`status: dead`, counted by `npm run migrate:mail-hub -- --check`).

---

## 5. Sending

- **Exactly once.** Each outbound message gets its Message-ID when it is created. Claiming it for
  sending is a transaction; any attempt after the first first asks the provider whether that
  Message-ID is already in Sent — if so it records success instead of sending. A crash after the
  provider accepted a message therefore never produces a second email.
- **Scheduled** messages are jobs whose `runAt` is the scheduled time, with a sweep that catches any
  missed; cancelling is a compare-and-set that fails honestly once sending has begun.
  **Authorization is re-checked at send time** — a member removed on Monday does not send on Friday.
- **Notes cannot be sent.** Notes are their own collection and API; `normalizeComposeRequest`
  copies only message fields out of the request (`tests/mail-hub-send.test.mjs` sends a request
  full of note and ERP fields and asserts none reach the message); quoting is built from the
  message body only.
- **Audit.** Shared-mailbox sends are audited before the provider is called and again with the
  outcome; failures notify the sender.
- **AI never sends.** Suggestions open in the composer for editing; the message records
  `aiAssisted`.

---

## 6. Security

| Concern | Control |
|---|---|
| Provider tokens / passwords | Server-only (`server-only` imports); sealed with envelope encryption in `mailHubCredentials`; key in Cloud KMS or Secret Manager, never Firestore; no plaintext fallback; access tokens only in memory |
| Least privilege | Gmail `gmail.modify` (no permanent delete, no IMAP); Graph `Mail.ReadWrite` + `Mail.Send`, `.Shared` scopes only for shared-mailbox flows; granted scopes checked at connect |
| OAuth | PKCE; state = HMAC-signed nonce naming a single-use server record; permissions re-evaluated at completion; redirects only to local `/mail` paths |
| SSRF via IMAP host | Hosts come only from administrator presets; TLS required with certificate verification |
| Received HTML | Server allowlist (`sanitize-html`) → DOMPurify in the browser → iframe `sandbox` without `allow-scripts`, under a CSP with no script source |
| Tracking / remote content | Remote images and CSS URLs blocked by default; loaded per message on request, or for domains the user trusts |
| Malicious links | All links go through `/mail/link` (real host, heuristics, optional Safe Browsing); text/destination mismatches are flagged |
| Attachments | Blocked executable/macro/disk-image types, RTL-override names, size limits, optional scanning both ways, re-validated after download, `nosniff`, no inline HTML/SVG |
| Uploads | Storage path `mail-hub/**` denied to every client (and excluded from the catch-all rule) |
| Webhooks | Gmail: Pub/Sub OIDC JWT verified (signature, issuer, audience, service account) or shared token; Graph: HMAC `clientState`, constant-time compare; neither trusts notification content |
| Worker | Refuses to run without `CRON_SECRET` |
| Existence leaks | A mailbox you cannot read answers 404, not 403 |

---

## 7. Retention and deletion

| Data | Kept |
|---|---|
| Headers, snippets, search tokens | While the account is connected (sync window, default 90 days, plus anything since) |
| Message bodies | Only once opened; cached sanitised for `bodyCacheDays` (default 14), then deleted. "Load images" views are never cached |
| Received attachments | Never stored — fetched from the provider on each download |
| Compose uploads | Deleted right after a successful send; abandoned ones after `uploadRetentionDays` (default 7) |
| OAuth states | 10 minutes |
| On **disconnect** | Watch stopped, grant revoked (Google), credential deleted, then folders, messages, bodies, cursors, drafts/scheduled messages and their uploads purged. **Kept:** record links (with snapshot), follow-ups, audit events, and for shared mailboxes the thread assignments (content fields cleared). Personal-mailbox notes are deleted |
| Audit events | Never deleted by the module |

---

## 8. Provider setup

### Google Workspace / Gmail

1. Google Cloud console → **APIs & Services** → enable the **Gmail API** (and **Cloud Pub/Sub** for push).
2. **OAuth consent screen**: add the scope `https://www.googleapis.com/auth/gmail.modify`.
   For a Workspace-internal app no verification is needed; an external app using this restricted
   scope needs Google's verification.
3. **Credentials** → the OAuth client (Office Hub's can be reused) → add the redirect URI
   `https://<your-domain>/api/mail-hub/oauth/gmail/callback`. Set `MAIL_HUB_GOOGLE_CLIENT_ID/SECRET`
   (or rely on `GOOGLE_OAUTH_CLIENT_ID/SECRET`).
4. **Push (recommended)**:
   ```bash
   gcloud pubsub topics create mail-hub-gmail
   gcloud pubsub topics add-iam-policy-binding mail-hub-gmail \
     --member=serviceAccount:gmail-api-push@system.gserviceaccount.com --role=roles/pubsub.publisher
   gcloud iam service-accounts create mail-hub-push
   gcloud pubsub subscriptions create mail-hub-gmail-push --topic=mail-hub-gmail \
     --push-endpoint=https://<your-domain>/api/mail-hub/webhooks/gmail \
     --push-auth-service-account=mail-hub-push@<project>.iam.gserviceaccount.com \
     --push-auth-token-audience=https://<your-domain>/api/mail-hub/webhooks/gmail
   ```
   Set `MAIL_HUB_GMAIL_PUBSUB_TOPIC=projects/<project>/topics/mail-hub-gmail` and
   `MAIL_HUB_GMAIL_PUSH_SERVICE_ACCOUNT=mail-hub-push@<project>.iam.gserviceaccount.com`.
   Watches last seven days and are renewed daily by the worker.
5. **Shared Gmail mailboxes**: connect the shared mailbox *itself* (Accounts › Connect a shared
   mailbox — sign in as it). Members prove their grant through **send-as**: in the Admin console /
   Gmail settings, grant each member the shared address as a verified *Send mail as* alias. Gmail
   exposes no API by which a member's token can prove delegated read access, so send-as is the
   evidence used; the permissions page names the method.

### Microsoft 365 / Outlook

1. Entra ID → **App registrations** → New. Supported account types: your organisation only (set
   `MAIL_HUB_MICROSOFT_TENANT` to the tenant id) or any organisation (`organizations`).
2. **Redirect URI (Web)**: `https://<your-domain>/api/mail-hub/oauth/microsoft/callback`.
3. **Certificates & secrets** → new client secret → `MAIL_HUB_MICROSOFT_CLIENT_SECRET`; the
   Application (client) id → `MAIL_HUB_MICROSOFT_CLIENT_ID`.
4. **API permissions** (Microsoft Graph, **delegated**): `offline_access`, `openid`, `email`,
   `profile`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`, and for shared mailboxes
   `Mail.ReadWrite.Shared`, `Mail.Send.Shared`. Grant admin consent if users may not consent
   themselves.
5. **Shared mailboxes**: in Exchange, give the syncing account *Full Access*, and each member
   *Full Access* plus *Send As* (or *Send on Behalf*):
   ```powershell
   Add-MailboxPermission -Identity accounts@company.com -User ravi@company.com -AccessRights FullAccess -AutoMapping $false
   Add-RecipientPermission -Identity accounts@company.com -Trustee ravi@company.com -AccessRights SendAs
   ```
   Members then press *Grant delegated access* / *Verify my access* on Mail Hub › Shared mailboxes.
6. Change notifications need the public https URL; they are created automatically and renewed
   before their six-day expiry. Revocation: Microsoft offers no per-app token revocation short of
   signing the user out everywhere, so disconnect deletes the ERP's tokens and subscription and
   points the user to `myapps.microsoft.com` to remove consent.

### Company mailbox (IMAP/SMTP — Roundcube's server)

1. Mail Hub › Permissions & sharing › Connection settings → **Add a server**: IMAP host/port
   (993 TLS or 143 STARTTLS), SMTP host/port (465 TLS or 587 STARTTLS), login style, allowed
   domains. Or set `MAIL_HUB_IMAP_DEFAULT_*` and run `npm run migrate:mail-hub`.
2. Tick **SMTP rejects unauthorised senders** only if the server really enforces it (Postfix
   `smtpd_sender_login_maps` + `reject_sender_login_mismatch`). Without it, shared-mailbox sending
   over SMTP cannot be verified and stays off.
3. Untick **File a copy in Sent** if the server files submitted mail itself.
4. **Shared mailboxes**: connect with the shared mailbox's own login (Accounts › Connect a shared
   mailbox). For members, configure a shared namespace (Dovecot ACL plugin / `namespace shared`)
   and grant each member's login access; the member's own connected account then sees the folder,
   which is how the grant is verified.

---

## 9. Deployment checklist

1. Set the environment (see `mail-hub.env.example`): a key store (`MAIL_HUB_KMS_KEY_NAME` or
   `MAIL_HUB_TOKEN_KEY` from Secret Manager), `MAIL_HUB_STATE_SECRET`, `CRON_SECRET`, and the
   providers you use. Do not declare `secret:` references in `apphosting.yaml` for secrets that do
   not exist yet — that fails the whole deployment (see the Office Hub note there).
2. **Firestore rules** — this project keeps its live rules in the console. Copy the *Mail Hub*
   block from `firestore.rules` into the console ruleset **before** anyone connects a mailbox,
   then run *Check security rules* on Mail Hub › Permissions & sharing › Connection settings: every
   collection must report *Denied*.
3. `firebase deploy --only firestore:indexes,storage` (indexes and the Storage rule for
   `mail-hub/**`).
4. `npm run migrate:mail-hub` (idempotent; `--dry-run` / `--check` available).
5. `./scripts/setup-cloud-scheduler.sh` — creates the every-minute `mail-hub-worker` job (with the
   other scheduled routes).
6. Grant the Mail Hub permissions in Access Management.
7. Walk through [`mail-hub-test-checklist.md`](mail-hub-test-checklist.md).

---

## 10. Operations

| Symptom | Where to look / what to do |
|---|---|
| Account shows *Reconnect needed* | The owner (or an admin for a shared connection) presses Reconnect. Caused by revoked consent, password change, or a missing scope |
| *Provider problem* with a retry time | Transient; the worker retries. *Retry now* clears the back-off. Repeated for hours → provider status page |
| Mail missing | Accounts › *Rebuild* runs a recovery listing (new generation, tombstones what vanished) |
| Member cannot open a shared mailbox | Permissions & sharing › member row shows the provider grant status and detail; *Re-check* |
| Scheduled mail did not go | Drafts shows it as *Not sent* with the reason; check `mailHubJobs` for `dead` jobs |
| Rotating the local key | `scripts/mail-hub-rotate-keys.mjs` (header explains the three steps). KMS keys rotate in KMS |
| Push not arriving | Accounts shows *polling*; the safety-net poll keeps mail flowing. Check the Pub/Sub subscription / Graph URL is public https |

---

## 11. Tests

`npm run test:mail-hub` (76 tests) and `npm run typecheck:mail-hub`.

- `mail-hub-sync.test.mjs` — the **real sync engine** against scripted Gmail- and Graph-shaped
  fake providers: resumable initial sync, mail arriving mid-listing, duplicate notifications and
  replayed pages, expired cursors and tombstoning, moves in both orders, rate limits, partial
  failures, provider outages and recovery, revoked grants, disconnection mid-run, shared-mailbox
  routing and reopening.
- `mail-hub-send.test.mjs` — exactly-once across a crash after provider acceptance, concurrent
  claims, transient vs permanent failures, scheduled/cancelled/unauthorised-at-send-time, the
  compose whitelist (notes cannot leak), reply-all recipients, quoting, and MIME/Bcc handling.
- `mail-hub-jobs.test.mjs` — dedupe, rerun, lease reclaim, continue vs retry, dead-lettering.
- `mail-hub-permissions.test.mjs` — personal isolation (including a full administrator), the dual
  shared-mailbox check, stale grants, send conditions, From validation, template scopes.
- `mail-hub-sanitize.test.mjs`, `mail-hub-providers.test.mjs`, `mail-hub-rules.test.mjs`,
  `mail-hub-webhooks.test.mjs` — sanitiser, envelope encryption and account binding, OAuth state
  and scopes, provider mappings, rules, and Pub/Sub OIDC verification with real RS256 signatures.

## 12. Known limitations

- Graph `sendMail` with a MIME body is capped at 4 MB per request, so Microsoft attachments are
  limited to ~3 MB per message (upload sessions are not implemented).
- IMAP has no push in a serverless deployment; it is polled every 5 minutes (sooner after any action).
- Local search covers headers and snippets; full-text search is delegated to the provider
  ("Search message text").
- Gmail shared-mailbox membership is evidenced by send-as, not by a read-delegation API (none exists
  for a member's own token).
- Record search for linking is a bounded scan (400 recent documents per type) filtered in memory.
