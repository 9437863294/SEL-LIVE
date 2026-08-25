# greytHR integration

How employee data reaches this application, how designation and project are resolved, how the
refresh is scheduled, and what happens to somebody's login when they leave.

---

## 1. The one thing to understand first

**greytHR's `status` field is employment *type*, not employment *state*.**

Its values come from the tenant's `lov::status` list:

| Code | Label |
| --- | --- |
| 1 | Probation |
| 2 | Confirmed |
| 3 | Contract |
| 4 | Trainee |

None of those says whether the person still works here. That is carried by `leftorg`, `leavingDate`
and the separation record. Conflating the two is how the previous sync came to mark **every employee
in the database `Inactive`** — it compared a number against the string `'Active'`, which is never
true.

So this integration keeps them strictly apart:

- `employmentType` — Probation / Confirmed / Contract / Trainee
- `employmentState` — Active / Notice Period / Relieved / Retired / Settled / Left / Unknown

`Employee.status` (`'Active' | 'Inactive'`) is derived from `employmentState`, and only from that.

---

## 2. What was wrong before

Four defects, all fixed. They are recorded because the old flow file still exists (deprecated) and
because two of them had been silently corrupting data for a long time.

| # | Defect | Consequence |
| --- | --- | --- |
| 1 | `empData.status === 'Active'` against a numeric field | Every employee written `Inactive` |
| 2 | `if (!existingEmployeeIds.has(id))` — insert-only | No promotion, resignation or email change ever propagated |
| 3 | `state=CURRENT` | Resigned employees never fetched, so nobody could be detected as having left |
| 4 | `AuthProvider` never checked `user.status` | A deactivated account kept a working session in the browser |

Plus: `modifiedSince` unused (full refetch every run), `employees` keyed by `employeeId` while
`employeePositions` was keyed by `employeeNo` (so the two never joined), and a **live API credential
hardcoded** as `process.env.GREYTHR_PASSWORD || "<key>"` in four files.

> **The hardcoded credential is in git history.** Removing it from the working tree does not
> un-publish it. Rotate the greytHR API password.

---

## 3. The API

Docs are a published Postman collection at <https://api-docs.greythr.com/>. The page is
JS-rendered; the machine-readable form is
`https://api-docs.greythr.com/api/collections/5089084/TVmV5ZXD?segregateAuth=true&versionTag=latest`
(155 endpoints).

**Auth** — `POST https://{tenant}.greythr.com/uas/v1/oauth2/client-token` with HTTP Basic →
`{access_token, expires_in: 3599}`. Every subsequent call needs **two** headers:

```text
ACCESS-TOKEN: <token>
x-greythr-domain: <tenant>.greythr.com
```

`Authorization: Bearer` — the obvious guess — returns 401 with no useful message.

**Endpoints this integration uses**

| Data | Endpoint | Notes |
| --- | --- | --- |
| Roster | `GET /employee/v2/employees` | `state=ALL`, `modifiedSince=YYYY-MM-DDTHH:mm:ss` |
| **Designation, Department, Location, Project** | `GET /employee/v2/employees/categories?descRequired=true` | `descRequired` is what makes this usable |
| **Resignation / exit** | `GET /employee/v2/employees/separation` | |
| Confirm date, notice period | `GET /employee/v2/employees/work` | |
| Employment-type labels | `POST /hr/v2/lov` body `["lov::status"]` | |

`state` accepts `ALL` / `CURRENT` / `RESIGNED`. Pagination is zero-indexed with a
`{data, pages:{hasNext, totalElements}}` envelope — note the published samples show `?page=1` while
the envelope reports `first: true` for page 0, so paging is driven by `hasNext` from 0.

**No documented rate limit**, so one is assumed: requests are serialised with a short delay and
429/5xx retried with exponential backoff honouring `Retry-After`.

### Designation and project live in categories

Not in `/work` (which is confirmation dates and notice period). Categories are
**effective-dated** — `effectiveFrom` / `effectiveTo` — so an employee promoted in April has *two*
Designation rows and "their designation" means the window containing today. Taking the first row in
the array gives whichever the API happened to return first, which is how a promoted engineer keeps
their old title forever.

This tenant's category list includes its own additions beyond the greytHR built-ins:

```text
Designation  Department  Location  Grade  Company          ← built-in
Project Name  Project Division  Cost Center  COST CENTER CODE  Shift  EMPLOYEE TYPE   ← this tenant
```

`Project Name` and `Project Division` map onto the `projects` collection's own
`projectName` / `projectDivision` fields. Everything matches on the category **description**, never
on the numeric id, so adding or renaming a category in greytHR needs no code change.

### greytHR sends corrupt dates

The API's own published samples contain `"0018-05-31"` and `"0014-02-17"` — two-digit years widened
wrongly upstream. `sanitizeGreytHRDate` treats any year outside 1900–2200 as absent, because
`0014-02-17 <= today` would otherwise relieve a working employee fourteen centuries ago.

---

## 4. Files

| File | Role |
| --- | --- |
| [`src/lib/greythr.ts`](../src/lib/greythr.ts) | All rules. Dependency-free, runs under `node --test`. |
| [`src/lib/greythr-client.ts`](../src/lib/greythr-client.ts) | HTTP: token cache, pagination, backoff. |
| [`src/lib/greythr-sync-service.ts`](../src/lib/greythr-sync-service.ts) | Admin-SDK orchestration and the only Firestore writes. |
| [`src/lib/greythr-sync-client.ts`](../src/lib/greythr-sync-client.ts) | Browser calls into the route. |
| [`src/app/api/greythr/sync/route.ts`](../src/app/api/greythr/sync/route.ts) | Cron tick, manual run, preview, settings. |
| [`src/components/employee/greythr-sync-workspace.tsx`](../src/components/employee/greythr-sync-workspace.tsx) | The console at `/employee/sync`. |
| [`tests/greythr-domain.test.mjs`](../tests/greythr-domain.test.mjs) | 131 tests, including one per fixed bug. |

Same split as `hr-policy.ts` / `hr-requirement-service.ts`: rules unit-testable without an emulator,
persistence boring.

### Collections

| Collection | Written | Shape |
| --- | --- | --- |
| `employees/{greytHR employeeId}` | Yes | Every legacy field, plus the optional block in `types.ts` |
| `employeePositions/{employeeNo}` | Yes | Full effective-dated category history, for the Position Details screen |
| `settings/greythrSync` | Yes | Schedule, exit policy, mapping policy, last-run pointers |
| `greythrSyncRuns/{runId}` | Yes | One record per run, with the changed/flagged rows |
| `users/{uid}` | Only `status` and the deactivation markers, only when the policy says so | |
| `accessGrants/{uid}` | `designations` (union) and a `greytHR` facts block | |

---

## 5. Environment

```text
GREYTHR_USERNAME   required   API user
GREYTHR_PASSWORD   required   API password — a secret, never in source
GREYTHR_DOMAIN     optional   defaults to siddhartha.greythr.com
CRON_SECRET        optional   if set, the cron tick requires Bearer <secret>
```

`greytHRConfig()` **throws** when the first two are missing. It does not fall back to a literal —
that fallback is exactly what put a live key in the repository.

---

## 6. Scheduling — why the frequency lives in Firestore

Vercel crons are static in `vercel.json`, so an administrator's choice of frequency cannot become a
cron expression without a redeploy. Instead:

- `vercel.json` registers `/api/greythr/sync` at `5 * * * *` (hourly)
- every tick calls `isSyncDue(settings.schedule, settings.lastSuccessfulRunAt)`
- a tick that is not due returns `{skipped: true}` in milliseconds, costing one Firestore read

So changing the frequency at `/employee/sync` takes effect immediately. Frequencies: Manual, Hourly,
Every 6 hours, Every 12 hours, Daily (with hour), Weekly (with day and hour).

Daily and weekly additionally hold until their configured hour, so a nightly run does not drift an
hour later each day as each run's own timestamp pushes the next window out. The interval check has a
one-minute tolerance, because a cron that fires at 02:00:03 one day and 01:59:58 the next would
otherwise skip a whole day.

**On Firebase App Hosting** there is no built-in cron — point a Cloud Scheduler job at the same URL
hourly and the behaviour is identical.

### Incremental sync

`modifiedSince` is set to the last **successful** run minus one hour. The overlap is deliberate:
greytHR's `lastModified` is its clock, not ours, and an exact boundary drops anything modified in the
seconds around the previous run. Only a successful run advances the watermark — advancing it on
failure would silently skip everything the failed run should have seen.

Separation, categories and work have no `modifiedSince` parameter, so they are fetched whole and
indexed by employee id. Three full reads of small payloads beat one lookup per employee.

---

## 7. Exit policy — what happens to a login

Set at `/employee/sync` → Schedule.

| Policy | Behaviour |
| --- | --- |
| **Flag for review** (default) | Nothing is changed. Exits appear on the Review tab; you disable the login yourself. |
| **On last working day** | Login disabled once the leaving date has passed. Notice-period employees keep normal access. |
| **On resignation** | Login disabled as soon as a resignation is recorded, before the last working day. |

The default writes nothing, and that is not timidity: the data this integration inherited marked
every employee `Inactive`, and a policy that acted on it automatically would have logged the whole
company out on the first run. Use **Preview** to see exactly what a run would do before enabling
anything.

**Two safety rules apply whatever the policy:**

1. A user who is the **last person able to administer access** is never deactivated automatically —
   they are flagged. Checked with the same `wouldStrandAdministration` the access screens use.
2. The sync only ever reactivates accounts **it** deactivated, tracked by `deactivatedBy:
   'greythr-sync'` on the user document. An account an administrator disabled by hand stays disabled.

It also never deletes an employee. A record missing from a full fetch is flagged, not actioned — a
greytHR permissions change is indistinguishable from a deletion.

### The enforcement point

`AuthProvider` now signs out and blocks any user whose `status` is `Inactive`. **This is a
behavioural change**: before it, a deactivated account kept a working browser session because only
some API routes checked status. Anyone currently marked Inactive will be unable to sign in.

### Employment-state derivation

Order matters — the most specific true statement wins:

```text
finalSettlementDate ≤ today            → Settled
exitDate > today                       → Notice Period   ← outranks leftOrg
leavingDate ≤ today                    → Relieved
retirementDate ≤ today                 → Retired
tentativeLeavingDate ≤ today           → Notice Period   (greytHR calls it tentative; we don't act)
submittedResignation                   → Notice Period
leftOrg with no usable date            → Left
otherwise                              → Active
```

A future-dated exit outranks `leftOrg` because greytHR flips that flag when the resignation is
*recorded*, not when the person leaves — and treating a notice-period engineer as gone is precisely
the failure that would lock a working colleague out.

---

## 8. Designation & project → permissions

The sync records HR facts; **Access Management decides what they are worth.**

1. Sync writes `designation`, `department`, `location`, `projectName`, `projectDivision`, `grade`,
   `costCenter` onto the employee record — always.
2. With *Keep department & designation membership current* on (default), it also records the user's
   designation on `accessGrants/{uid}.designations` using `arrayUnion` — a union, never an
   assignment, so a designation an administrator added by hand is never dropped.
3. The **Designation** and **Department** rules you configure under
   [Access Management → Templates & Rules](../src/components/access-management/templates-and-scopes.tsx)
   then apply automatically.

So you configure once that "Site Engineer" grants tower-progress update rights, and membership stays
current as people are promoted. **The sync never grants a role itself.**

Project-scoped access from `cat::Project Name` is available but **off by default** — it is a
permission grant driven by an external system, so it is opt-in.

### Linking employees to users

Two joins, in order of trust:

1. **An explicit link.** A user created through the greytHR employee picker carries that employee's
   `employeeId` on their own user document. That is a decision an administrator made, so it beats any
   inference.
2. **Email**, case-insensitively and trimmed.

The explicit link exists because email alone is fragile: a person whose work address changes, or who
has none, silently stops matching — and the failure is invisible until their resignation does not
take effect.

A duplicated email, or two accounts claiming one `employeeId`, links to **nobody** rather than
guessing — a wrong match would apply one person's resignation to another person's login. Both are
reported as run warnings.

---

## 8a. Creating a user from a greytHR employee

Both user-creation dialogs — **Access Management → Add user** and **Settings → User Management →
Add User** — default to *From greytHR employee*:

- lists **active employees who do not already have a login**, searchable by name, employee no.,
  email, department, designation or project
- on selection, refetches that one employee **live** from greytHR and prefills name, email, mobile,
  designation, location, department and project
- stores `employeeId` / `employeeNo` on the user document, establishing the explicit link above
- shows every category greytHR holds for them, including ones this app does not name explicitly

*Enter manually* remains for contractors and anyone not in the HR system.

Access Management's drawer additionally prefills department, designation, location and project and
seeds access membership from them; User Management's dialog has no such fields, so it prefills name,
email and mobile and stores the link. Both write the same `employeeId` / `employeeNo`, so an account
created from either screen is linked identically.

**Why list from the mirror but fetch detail live** — the list must answer instantly and keep working
when greytHR is unreachable, and paging ~1,300 employees out of the HR system whenever somebody opens
a drawer would be slow and rude. But a new joiner's greytHR record was probably created this morning,
so the *one* employee actually chosen is refetched live. If that live call fails the picker falls back
to the mirror row with a warning rather than blocking account creation.

The picker also states when the mirror was last synced, and warns when it never has been — because a
picker that presents a stale list as fact sends administrators looking for people who aren't in it.

### A wrinkle worth knowing

The **bulk** categories endpoint honours `descRequired=true` and returns `categoryDesc`/`valueDesc`.
The **single-employee** endpoint does not — `GET /employees/{id}/categories` returns a bare array of
`{category: 6, value: 31}` with numeric ids and no `data` envelope. So the single-employee path
fetches the reference lists and resolves ids through `buildCategoryIdMaps`.

Those same maps are what any **write-back** would need, since
`POST`/`PUT /employees/{id}/categories` takes numeric ids:

```json
{ "list": [{ "category": 6, "value": 31, "effectiveDate": "2026-08-25" }] }
```

`buildCategoryWriteBody` translates `{ Designation: 'Site Engineer' }` into exactly that, reporting
anything it could not resolve rather than writing a partial set and claiming success. **Nothing calls
it yet** — see §12.

> greytHR's own docs are inconsistent here: the captured request bodies use `effectiveDate`, while
> the parameter table on the same page documents `EffectiveFrom`. The bodies came from a working
> request, so `effectiveDate` is what `buildCategoryWriteBody` emits — but verify against your tenant
> before trusting any write.

---

## 9. Testing

```bash
npm run test:greythr        # 131 domain tests
npm run typecheck:greythr
```

Covers one test per fixed bug, employment-state derivation including every boundary, corrupt dates,
effective-dated category resolution, all three exit policies, the last-administrator guard, the
reactivate-only-our-own rule, every scheduling frequency, the cron tolerance, and email linking with
duplicates.

Three typecheck errors exist on `main` unrelated to this work (`bank-guarantee/document-panel.tsx`
×2, `insurance/RenewalDialog.tsx` ×1). ESLint is broken repo-wide; use `tsc` and the node runner.

---

## 10. First run

1. Set `GREYTHR_USERNAME` / `GREYTHR_PASSWORD` as secrets. **Rotate the leaked key first.**
2. Open `/employee/sync` → **Test connection**.
3. **Preview** — writes nothing. Read the Review tab: with the inherited data marking everyone
   `Inactive`, expect a large number of `status` corrections on the first run.
4. **Sync now** once the preview looks right.
5. Leave the exit policy on *Flag for review* for a cycle or two, then tighten it.
6. Enable automatic refresh and pick a frequency.

## 11a. The `/employee` module — what is synced

| Page | Reads | Kept current by | Status |
| --- | --- | --- | --- |
| `/employee` | `settings/greythrSync` | the unified sync | ✅ |
| `/employee/manage` | `employees`, `departments`, `employeePositions` | the unified sync | ✅ but see below |
| `/employee/[employeeId]` | `employees`, `employeeSensitive` | the unified sync | ✅ |
| `/employee/category` | `categories` | the unified sync | ✅ |
| `/employee/position-details` | `employeePositions` | the unified sync | ✅ |
| `/employee/sync` | settings + run history | — | ✅ |
| `/employee/salary` | `employees` where `salaryMonth` | **`sync-salary-flow.ts`, separate and manual** | ⚠️ |

`categories` and `employeePositions` were previously maintained only by their own screens' manual
buttons. Both are now written by every run, so those buttons are redundant rather than required.
Category values are upserted by a deterministic `type_id` document id, not deleted-and-recreated as
the old flow did — that flow emptied the collection first, so anybody reading mid-sync saw nothing.
Stale values are left in place: a value removed in greytHR is still referenced by historical employee
records, and deleting it would turn those into blanks.

### ⚠️ Salary rows live inside the `employees` collection

`sync-salary-flow.ts` writes **one extra document per employee per month** into `employees`:

```text
addDoc(employees, { employeeId: <employee *number*>, salaryMonth: '2026-08-01',
                    grossSalary, netSalary, salaryDetails,
                    department: '', designation: '', email: '', status: 'Active' })
```

Random document id, `employeeId` holding the employee *number* rather than greytHR's numeric id.
At a few months × ~1,300 people that is thousands of documents that look like employees and are not.
Consequences:

- **Employee Management lists them**, with blank department and designation. Pre-existing.
- Headcounts are wrong by roughly the number of months synced.
- A full resync would report every one as "exists here but greytHR did not return it".
- The employee picker would offer them as people to create logins for.

The last two were bugs in this integration and are fixed: `isEmployeeMasterRecord` is the
discriminator (`salaryMonth` present ⇒ salary row), applied in the sync service and in
`/api/greythr/employees`. A run now reports the count as a warning rather than silently working
around it.

**Not fixed: the data model.** Salary belongs in its own collection keyed by
`{employeeId}_{month}`, and moving it is a data migration — which needs a decision about the existing
rows, not a unilateral rewrite. Until then Employee Management still shows them.

Salary is also the one part of the module still on a separate manual flow. Folding it in is
straightforward mechanically, but salary is arguably the most sensitive data in the system, so it
belongs in `employeeSensitive` behind `Employee.Personal Data` rather than merged into the broadly
readable mirror — another decision rather than a mechanical change.

---

## 11b. greytHR module coverage

greytHR publishes 155 endpoints across five modules. What this integration covers:

| greytHR module | Endpoints | Covered |
| --- | --- | --- |
| **Employee** | ~70 | ✅ Roster, work, separation, categories, profile, personal, org tree, qualifications, assets, addresses, statutory, identities, bank/PF, passport/visa |
| **List of Values** | 5 | ✅ Employment types, all category value lists |
| **Leave** | 5 | ⚠️ Balances ✅ · transactions ❌ |
| **Attendance** | 6 | ⚠️ Summary ✅ · muster and swipes ❌ |
| **Payroll** | ~25 | ❌ Salary statement only, via the separate legacy flow |
| **Documents** | 4 | ✅ Proxied on demand — deliberately not synced |
| Employee family | 6 | ❌ bulk fetch needs an undocumented relation-type id |

### What was added and why those two

**Leave balances** (`/leave/v2/employee/years/{year}/balance`) and **attendance summaries**
(`/attendance/v2/employee/insights`) are per-employee *aggregates*: one bounded document each, one
bulk call each per run, and they answer the questions people actually ask — "how much leave is left"
and "how has this person been this month". They appear on the employee profile's **Leave &
attendance** tab.

Stored in their own collections (`employeeLeaveBalance`, `employeeAttendance`), one document per
employee, each recording its own period. Not merged onto `employees`, because both are periodic: a
balance belongs to a year and a summary to a month, and merging would silently overwrite last
month's figures with this month's and leave no way to tell which period a number came from.

Leave types have **no LOV key**, and the bulk endpoint returns `leaveTypeCategory` as a bare id. The
names come from one extra call to the *single-employee* variant, which returns the category as an
object with `description` and `code` — leave types are organisation-wide, so one call names them for
everybody. If that call fails, balances show `Leave type 7` rather than a blank, and the run warns.

### Documents are proxied, not synced

The one module where mirroring is the wrong answer, for three reasons that all point the same way:

1. **No bulk endpoint.** Listing is `GET /emp-docs/{employeeId}` — per employee. A nightly run would
   make ~1,300 calls before downloading anything.
2. **They are files.** Mirroring means copying them into Firebase Storage: a second copy of
   everybody's Aadhaar scan and offer letter, plus a retention policy, plus a deletion story when
   greytHR's copy changes.
3. **Proxying is simply better here.** The list is always current, greytHR stays the only store, and
   access is checked on *every request* rather than once at sync time.

`GET /api/greythr/documents?employeeId=83` returns the category → file tree;
adding `&documentId=…&fileId=…` streams the file itself. Shown on the profile's **Documents** tab,
loaded lazily when the tab is first opened.

Its own permission, `Employee.Documents`, split into `View` and `Download` — an employee's folder can
hold anything from an offer letter to a medical certificate, which is neither the same decision as
seeing their designation nor the same as seeing their PAN *number*; and knowing a document exists is
not the same as taking a copy.

Three safety details in the proxy, since it interpolates caller-supplied ids into an upstream URL and
returns bytes to a browser:

- `isSafeGreytHRId` **rejects** rather than escapes anything outside `[A-Za-z0-9_-]`. A value with a
  slash or a `..` could reshape the greytHR URL and there is no legitimate reason for one.
- `safeDownloadName` strips quotes, semicolons and newlines from the filename — greytHR filenames
  come from whoever uploaded them, and a newline in a `Content-Disposition` header is header
  injection.
- `documentContentType` serves only PDFs and images inline. Anything unrecognised —
  including `.html` — is `application/octet-stream` with `attachment`, because guessing a type is
  how a browser gets talked into rendering something it should have downloaded.

`Cache-Control: private, no-store`: the URL is not a capability, the permission check is.

**Known gap:** greytHR has a `POST /emp-docs/category` to *create* document categories with a name
and code, but publishes nothing to read them back and no LOV key — so a category can only be shown
as `Category 3`. `buildDocumentTree` accepts an optional label map, so naming them is a small change
if you want it.

### What was deliberately left out

- **Attendance muster and swipes** — the daily grid. At ~1,300 employees that is tens of thousands
  of records a month. It belongs in its own module with a retention policy, not appended to the
  employee mirror on a nightly cron.
- **Leave transactions** — the ledger behind the balances. Same reasoning; the balance is the
  answer, the ledger is the audit trail, and they have different lifetimes.
- **Payroll** — ~25 endpoints covering salary revisions, LOP, loans, payslip PDFs and Form 16. Also
  the most sensitive data in the system, and blocked behind the storage decision in §11a (salary rows
  currently live inside `employees`).
- **Family details** — the bulk endpoint needs a relation-type id that greytHR does not document and
  for which no LOV key exists. The single-employee `/families` endpoint needs no parameter, so it is
  buildable per-employee if wanted.

None of these are hard *mechanically*. Each needs a decision about storage, retention or access that
belongs to you rather than to this integration.

---

## 12. Write-back is built but not wired

`buildCategoryWriteBody` and the endpoint shapes for
`POST`/`PUT /employee/v2/employees/{id}/categories` are implemented and tested, but **nothing in the
application calls them**. Pushing a designation or project from this platform into greytHR would make
this app a writer to the HR system of record, which needs a deliberate decision about direction of
authority: today greytHR is the source of truth and this app mirrors it. Two writers and no agreed
winner is how the two systems start disagreeing.

If write-back is wanted, the missing pieces are: which fields may be pushed, who may push them, what
happens when greytHR rejects a value, and whether a push should reopen the previous category window
or supersede it.

---

## 11. Left alone deliberately

- `sync-greythr-flow.ts` is deprecated in place, with its three defects documented in the header, so
  nobody mistakes it for a working fallback. Nothing calls it.
- The Category (`/employee/category`) and Position Details (`/employee/position-details`) screens
  still use their own Genkit flows. They work, and they are now credential-safe. The new sync writes
  `employeePositions` too, so the two converge.
- Those flows still hardcode the tenant domain `siddhartha.greythr.com`. Harmless — it is not a
  secret and appears in every request header — but `GREYTHR_DOMAIN` is the configurable path.
