# Bill Tracking & Collection Management

Client billing, deductions, collections, retention, ageing and outstanding receivables. It replaces
the finance team's `BILL TRACKING-<FY>.xlsx` workbook. The database is the source of truth. Excel
is used only to import, export and migrate.

Route: `/bill-tracking` (Module Hub → Finance & Treasury → Bill Tracking).

## Architecture

| Layer | Where | Notes |
|---|---|---|
| Domain (pure, unit-tested) | `src/lib/bill-tracking/{calculations,money,import,reports,legacy-export,reminders,access,defaults,types,schemas,workbook}.ts` | All money arithmetic is done in integer paise. Signs are never altered. |
| Server services (Admin SDK) | `src/lib/bill-tracking/server/*` | Permission and scope checks, transactions, audit trail. |
| API | `src/app/api/bill-tracking/**` | The only way the browser reaches the data. |
| UI | `src/components/bill-tracking/*`, `src/app/(protected)/bill-tracking/**` | Thin pages. Filters live in the URL, so dashboard links open pre-filtered lists. |

**No client Firestore access.** Every read and write goes through the API. The API resolves the
caller's permissions and project scope, recomputes all derived amounts (gross, net, received,
outstanding, status) inside a transaction, and writes the audit entry in the same commit. Values
the browser sends for derived fields are ignored.

### Collections (Firestore)

| Collection | Contents |
|---|---|
| `billTrackingBills` | One document per bill. Holds embedded deduction lines and a mirror of its receipt allocations. |
| `billTrackingCollections` | One document per bank receipt, with its allocation across bills. |
| `billTrackingRetention` | The retention release ledger. "Held" is derived from bill deductions. |
| `billTrackingFollowUps`, `billTrackingComments`, `billTrackingDocuments` | Records attached to a bill. |
| `billTrackingTargets` | Weekly collection targets. |
| `billTrackingActivity` | The immutable audit trail. |
| `billTrackingImportJobs` | One document per import. The `rows` subcollection keeps each row's original cells. |
| `billTrackingConfig/{org}` | Settings, the masters, project profiles (DGM office, billing client, credit days) and remembered import mappings. |
| `billTrackingCounters`, `billTrackingSavedViews` | Bill numbering counters and saved filter views. |

Attachments and imported workbooks are stored under `bill-tracking/{org}/…` in Storage. They are
written and served only by the API.

### GST, deduction formulas, credit notes

- **GST split.** Each bill has a GST type: CGST + SGST (half the rate each), IGST (the full rate) or
  No GST. It also has a rate and the component amounts; the components decide the total.
  - **Suggested type.** The form compares the SEL registration that raises the bill with the
    client's GSTIN state. The registration comes from the shared attribution chain in Expenses → GST
    registrations. The form shows its reason, and finance can change the type, the rate or any
    component.
  - **Snapshots.** Each bill keeps the registration, its GSTIN and the client's GSTIN as they were
    when the bill was saved.
  - **Legacy bills.** Imported bills keep their single GST figure until someone splits it.
- **Deduction formulas.** In Settings → Deduction types, a percentage deduction is "% of Taxable
  (or Gross), less the deductions ticked under *Less (base)*".
  - Income TDS defaults to (Taxable − Mobilisation Advance) × rate.
  - *GST on it* adds GST at the given % on top of a deduction.
  - The server recomputes every line on save (`computeDeductions` in `gst.ts`). Percentage lines
    are rounded to the rupee unless that setting is off.
- **Credit notes.**
  - **Linking.** A credit note must name an invoice of the same project; a debit note may. Legacy
    notes whose description says "Against Inv No -…" are linked on import if that invoice exists.
  - **Invoice page.** It lists the notes against the invoice and shows its net after notes, and
    offers *Raise credit note*.
  - **Receivables.** Each note keeps its own receivable.

### Bill categories

Categories are configured in Settings → Bill categories.

| | Main category | Sub category |
|---|---|---|
| Examples | Supply, Erection, Civil, F&I, Compensation, Other | The legacy "Type of Bill Status", e.g. `SUPPLY-60%`, `CIVIL-PV` |
| Scope | One list, the same for every project | Belongs to one main category; enabled for **all projects** or a chosen list |
| Reporting | Says which month-wise-summary column (Supply / Erection / Civil / F&I / Other) its taxable value is reported under | — |

- **New bill:** pick the project, then the main category, then a sub category. The list shows only
  sub categories of that main category that are enabled for that project. The server enforces the
  same rule.
- **Duplicate names:** two sub categories under one main category may share a name only if their
  project lists don't overlap.
- **Deleting:** main categories and sub categories can both be deleted. Deleting a main category
  also deletes its sub categories. Bills keep the names they were saved with.
- **Logic:** `src/lib/bill-tracking/categories.ts`.

## Deployment checklist

1. **Firestore rules (console).** Copy the "Bill Tracking & Collection Management" block from
   `firestore.rules` into the console ruleset. The repo file is not deployed. If the console ends
   in a catch-all "signed-in users may read", the module's data is readable by every user until
   you do this. To verify, open Settings → Security & permissions → *Check security rules*.
2. **Storage rules.** Deploy `storage.rules`. It closes `bill-tracking/**` to clients.
3. **Indexes.** Deploy `firestore.indexes.json`. The activity feed needs
   `organizationId ASC, at DESC`.
4. **Permissions.** No role has Bill Tracking permissions until an admin grants them in Settings →
   Access Management → *Bill Tracking*.
   - `All Projects · View` is for HO finance.
   - Site teams get project-scoped grants instead.
   - Keep `Collections · Add` and `Collections · Verify` on different people.
5. **Reminders.** Run `scripts/setup-cloud-scheduler.sh` to add the `bill-tracking-reminders` job
   (08:00 IST). The route refuses every call while `CRON_SECRET` is unset.
6. **Migration.**
   1. Fill in Settings → Projects & DGM offices.
   2. Run `npm run bill-tracking:dry-run -- "<path to workbook>"` and check the totals offline.
   3. Import the workbook at `/bill-tracking/import`.
   4. Open the job's Reconciliation and accept the import only when every difference is explained.

## What the 2026-27 workbook taught the importer

- The data sheet is `Bill Tracking`. Its headings are on row 2, with stray spaces and line breaks
  in them.
- About 1,000 rows are pre-filled with formulas, but only 143 are bills.
  - A row counts as a bill only if finance typed something into it (project, number, date, type
    or a source amount).
  - 18 emptied rows still held cached Net/Shortfall results from an earlier year, worth ₹8.5 lakh
    in total. The importer reports these and ignores them.
- `Net = ROUND(Taxable + GST − Deductions, 0)`. The "Round net to the rupee" setting is on by
  default, so legacy nets reproduce exactly. The 7 rows where someone typed over the formula
  (₹2–4 each) are flagged as net mismatches. The bill keeps the calculated figure.
- Crop-compensation rows enter the compensation as a *negative* "Mob Adv" deduction. Signs are
  preserved, so these rows come out with a positive net.
- STATUS is typed by hand. It disagrees with the receipts on 23 rows; for example, "RECEIVED" is
  used for short-paid bills. These rows are kept as `legacyStatus` and flagged.
- One statement number can carry several bill lines, and bill serials restart for each series.
  Duplicate detection therefore matches on bill type and amounts as well as numbers.
- The month-wise summary's QUERY formulas list `SUPPLY-20%` and `SUPPLY-10%` both as Supply
  billing and as retention bills. Here each bill lands in exactly one column, decided by the Bill
  Type master.
- "PI" rows are those whose `TAXABLE / ADVANCE` value equals the configured PI marker (default
  `PI`). The 2026-27 book has none.

Reconciliation of the 2026-27 book (dry run):

| Measure | Result |
|---|---|
| Taxable, GST, deductions, received | Match to the paisa |
| Net | ₹22 higher in SEL LIVE |
| Outstanding | ₹20 higher in SEL LIVE |

The net and outstanding differences are exactly the 7 flagged rows.

## Tests

```
npm run test:bill-tracking       # 51 tests: calculations, ageing, import, reports, permissions, reminders
npm run typecheck:bill-tracking
```
