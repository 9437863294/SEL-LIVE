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
| `billTrackingRetention` | The retention release ledger. "Held" is derived from bill deductions (the certified ones, once a bill is certified). |
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
  - The server works every line out on save (`computeDeductions` in `gst.ts`). Percentage lines
    are rounded to the rupee unless that setting is off.
  - **Issued lines are kept.** An edit that sends the lines back unchanged (remarks and dates aside)
    and changes none of the figures they were worked out on — taxable, GST and its parts, bill date,
    type, the invoice a note is against — keeps them exactly as stored (`keepsIssuedLines`, used by
    the server and previewed by the form). A later change to a head in Settings, or a note added
    since under a note rule, therefore never alters an issued bill behind an unrelated edit.
  - Two lines may not share an id (the API refuses it), and money rounds half a paisa away from
    zero, so a credit note mirrors its invoice to the paisa.
- **Credit notes.**
  - **What needs one.** Only a change of the invoice value: the taxable and the GST on it. A change
    of deductions needs no note. Once the client certifies a bill, its certified deductions apply
    to the bill directly (see *Raised vs certified*).
  - **Linking.** A credit note must name an invoice of the same project; a debit note may. Legacy
    notes whose description says "Against Inv No -…" are linked on import if that invoice exists.
  - **Signs.** A credit note's taxable and GST are zero or below, a debit note's zero or above; the
    server refuses the other sign rather than let a "credit" add to the receivable.
  - **Deleting or moving a bill** is refused while live notes, receipts or retention releases point at
    it; the message says which. Deal with those first.
  - **Invoice page.** It lists the notes against the invoice and shows its net after notes, and
    offers *Raise credit note*.
  - **Receivables.** Each note keeps its own receivable: its gross, less any deduction the client
    makes on the note itself.
  - **Receiving against an invoice with notes.** The client pays the invoice less its credit notes.
    The receipt form adds the open credit notes against an invoice beside it, as negative
    allocations ("set off"), and expects the invoice less those notes. Saving settles the invoice and
    its notes together, and the bank is credited what actually arrived. Only a note's own open
    balance can be set off, and never more of it than the bills it pays (`createCollection`). A debit
    note's open balance is owed on top of the invoice: it is not added for you, but can be added like
    any bill when the client pays it too.
  - **Allocation signs.** Every allocation must move its bill's open balance toward zero: a positive
    amount on an invoice, a negative one on a credit note. The server refuses the other sign, and
    verifying a receipt checks each set-off again against the note's balance at that moment (a
    second draft, or a note corrected since, cannot overshoot it).
  - **Bank Balance.** A verified receipt posts one credit to the chosen account, which must exist.
    An adjustment (no money moved) or a ₹0 receipt posts nothing; a negative receipt posts a
    negative credit.

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

### Raised vs certified

SEL raises a bill; the client then certifies it, often for less or with more deducted. The two
kinds of difference are settled differently:

- **Deductions need no document.** Once the bill is certified, the client's certified deductions
  replace the raised ones in everything the bill is paid against: net receivable, outstanding,
  payment status, the deduction and retention reports, and retention by rate. The client simply
  pays the invoice less what it certified as deducted.
- **The invoice value needs a note.** The taxable, and the GST on it, change only through a credit
  or debit note against the bill. The issued invoice itself is never edited.

1. **Raised.** The bill as issued. Its raised deductions stay on the bill for the comparison; the
   certification never edits them.
2. **Certified.** On the bill: *Actions → Record client certification*, or the *Certification*
   tab. Only once the bill is raised: the client certifies a bill it has been sent, so a draft,
   submitted or approved bill cannot be certified (`certificationNotDue` in `workflow.ts`, checked
   by the server and by every Certify button). A bill returned from Bill Raised or later counts as
   raised, and a certification already on an earlier-stage bill stays correctable and removable. The form starts from every raised figure (taxable, GST components, each deduction).
   Finance changes what the client changed and adds any extra deduction. The GST section works like
   the bill form's (registration, type, rate, CGST / SGST or IGST). The type defaults to the raised
   bill's; a bill imported with one unsplit GST figure starts split by the suggested type, with the
   same total. Stored as `bill.certification` with a revision number; every change is audited.
   Saving applies the certified deductions to the bill at once.
3. **Compared.** Line by line: raised, certified, the client's change and the notes raised against
   the bill.
   - Taxable and GST: *still to adjust* = certified − (raised + notes).
   - Deductions: the change only. The certification has already applied it, so nothing is left to
     adjust.
   - A bill is **matched** when the taxable and the GST still to adjust are both within the amount
     tolerance, whatever happened to its deductions.
4. **Settled.** *Raise credit note* opens the note form already filled with the difference:
   - the taxable and each GST component, and nothing else — no deduction lines;
   - a debit note instead if the client certified more.

   Saving that note makes the bill matched. A credit note's form also has *Match the client
   certification* for any certified invoice.

- **Deductions on a note.** If the client also deducts something on a note itself (TDS on a debit
  note, say), enter it on the note. It counts in the note's own net, like any bill's deductions.
- **Stored totals.** A bill's `totalDeduction`, `netReceivable`, `retentionDeducted` and
  `outstandingAmount` are worked out from its effective deductions: the certified ones once it is
  certified (`effectiveDeductions` in `calculations.ts`). `raisedTotalDeduction` and
  `raisedNetReceivable` keep the raised figures beside them. Bills stored before 2026-10-27 have
  neither. Their stored figures are the raised ones, which is out of date on a bill already
  certified until it is recomputed (see the deployment checklist).

Where it shows:

| Place | What it shows |
|---|---|
| Bill Register | Tabs: *Raised bills*, *Client certified* (including bills awaiting certification) and *Raised vs certified* (certified bills only: the deduction change, the note to raise, and *Raise note* on each bill whose taxable or GST differs) |
| Bill page | *Deductions* tab: on a certified bill, a *Certified · applies* / *As raised* switch, showing the certified lines by default |
| Reports | *Raised vs certified*, per project |
| Dashboard | *Awaiting certification* and *Notes to raise* cards |
| Exceptions | *Certified — credit note pending* |

- **Workflow.** The default is Draft → Submitted → Under verification → Verified → Approved → Bill
  raised → **Certified by client** → Payment follow-up → Reconciliation → Closed. Since 2026-10-28
  the steps are configuration in Settings → **Workflow** (`settings.workflowSteps`, an ordered list;
  rules in `src/lib/bill-tracking/workflow.ts`):
  - **Review steps** (the four defaults before Bill raised, and any added) can be added, renamed,
    removed and moved anywhere between Draft and Closed. Each has a name, button text, a
    description, the permission that moves a bill in (Bills · Edit / Verify / Approve), *locks the
    amounts* (Approved by default; the amounts lock at the first such step, and at Bill raised at
    the latest) and *can be returned for correction*.
  - **Role steps** — Bill raised, Certified by client, Payment follow-up, Reconciliation, Closed —
    can be renamed and moved among the review steps, but not removed; they keep their order among
    themselves and Closed is last. Payment follow-up and Reconciliation can be switched off.
  - A step's id is what a bill stores as `workflowStatus`; the defaults keep their keys, so bills
    stored before need nothing. Settings saved before (flags only, no names) read as overrides on
    the default list. The server refuses a save that breaks these rules (`workflowProblem`) or that
    removes a step bills are still on (or were returned from).
  - A step's permission is any of Bills · Add / Submit / Edit / Verify / Approve / Raise / Certify /
    Edit After Approval / Override Status. **Submit** and **Raise** were added to the registry for
    this (2026-10-28); Submitted and Bill raised still default to Edit, because no role holds the new
    ones until an administrator grants them. Certified by client defaults to Certify.
  - The workflow API takes `{ action: 'advance', to: '<step id>' }`; the old names (`submit`,
    `approve`, `raise`, …) still work for the default steps.
  Per step, as before:
  - **Used or skipped.** Any step but Bill raised, Certified by client and Closed can be switched
    off. A skipped stage gets no button, and a returned bill steps back past it. Up to Bill raised the
    stages are taken strictly in order (2026-10-28): a bill moves only into the next stage in use,
    so it cannot be raised without being submitted, or approved without being verified, while those
    stages are on. After Bill raised the moves stay free (a note is never certified; a paid bill may
    close from any later stage).
  - **Moved here by.** Who moves a bill into the stage:
    - anyone with the role permission (the default);
    - named people;
    - the bill's collection owner, plus optional backups.

    Being named is the authority. A named person needs no role permission and no project grant to
    do that stage, can open the bills it involves, and gets into the module even without a module
    permission. *Only them* stops permission holders doing it.
  - **Notify.** The named people are told when a bill is waiting for them. With nobody named, the
    Verify or Approve role holders are told, as before.
  - **Waiting for.** Shown on each bill. The register's *Waiting for me* filter (also in the
    sidebar for named people) lists the bills whose next stage is yours.
  - Recording the certification is the *Certified by client* stage. It moves a bill at any earlier
    stage to Certified; removing it moves a bill still at Certified back to Bill raised.
  - The amount lock (*Edit After Approval* plus a reason) starts once a bill is approved or raised.
    It covers the taxable, the GST type, total and parts, the SEL registration, the deductions, the
    invoice number, bill date, project, transaction type and the invoice a note is against
    (`PROTECTED_BILL_FIELDS`). They are compared by value (`protectedChanges`, shared by the server
    and the form): money to the paisa, deduction lines by what they deduct — a renamed head or a
    reworded remark is no change. A bill stored without a registration (imported) keeps none on edit
    until someone chooses one.
  - **Returned bills** (`amountsLocked`): a bill returned from the lock step or earlier is unlocked —
    its resubmission goes back before the lock, so the corrected amounts are approved again. One
    returned from a later step stays locked, since resubmitting would land it past the approval.
  - A step switched off gives the people named on it nothing: no access to bills, no way into the
    module.
  - **Closed months** also hold recording or removing a certification, a payment-status override,
    and adding or cancelling a manual retention release, on the bill's (or release's) date.
- **No payment before certification.** Settings → Workflow → *Payment needs client
  certification*. It is on by default for invoices and retention bills. Recording or verifying a
  receipt against an uncertified bill of those types is refused, and the server enforces it.
  - Bills imported from the workbook are left out by default.
  - A *from date* can exempt older manual bills.
  - The bill page swaps *Receive* for *Record certification*, and the receipt form marks such bills
    *Not certified*.
  - Receipts imported from the workbook are not affected.
- **Notes across years.** Notes are loaded from every year, because a note raised next FY still
  adjusts this FY's invoice.
- **Permission.** Recording needs **Bills · Certify**, a new action; no role holds it until it is
  granted.
- **Code.** Logic in `src/lib/bill-tracking/certification.ts`; tests in
  `tests/bill-tracking-certification.test.mjs`.

### Retention by rate

One invoice often deducts retention twice — for example 10% (released on commissioning) and 30%
(released on erection). It may do so under the same head, with a percentage typed by hand, or as a
plain amount. Every retention line is therefore placed in a **slab**: its head plus its rate
(`src/lib/bill-tracking/retention.ts`).

- **Rate.**
  - A line entered as a percentage counts at that percentage, exactly as typed (10, 30, 7.5…).
  - A line entered as an amount, and every line imported from the workbook, is read against the
    bill's taxable, or its gross for a head taken on gross. ₹30,000 on a ₹1,00,000 taxable reads as
    30%.
  - A result within 0.05 of a half-percent snaps to it. Anything else stays a *fixed amount* under
    its head.
  - Only a rate above 0 and up to 100% makes a slab. A typed 0 or negative percentage is an
    adjustment and counts as a fixed amount. A ₹0 line is left out.
- **Certified bills.** Once the client certifies a bill, its certified retention lines count
  instead of the raised ones. They are read against the certified taxable (or gross), so an amount
  line takes its rate from what the client certified.
- **Notes.** A credit or debit note adjusts its invoice's retention, so it lands in the invoice's
  slabs (the certified ones, once the invoice is certified), negative:
  - a line whose own reading is a slab the invoice holds under that head goes there — a note
    reversing just the 30% reads as 30%;
  - otherwise the line is shared over the invoice's slabs of that head, in proportion to what each
    holds. That covers a note reversing 10% and 30% in one line (it reads as 40%) and a note with
    no taxable of its own;
  - a note whose invoice holds nothing under that head is read on its own base.

  The invoice decides this even when it is outside the filters (an earlier year). The slabs always
  add up to the retention reported everywhere else.

  A debit note under a note rule (below) is the exception: it adds retention for the whole value
  rather than adjusting the invoice's. A line it takes of the invoice plus its notes counts at its
  own rate and is never shared over the invoice's; a line typed as an amount is read against the
  same base, so ₹180 on a ₹300 note after a ₹600 invoice reads as 20%, not 60%.
- **Releases.** A release can name the slab it releases (head and rate), and then reduces that
  slab's balance:
  - a release recorded by hand chooses its slab and, optionally, the bill;
  - a retention bill can say which retention it releases (*Releases retention* on the form), and
    receipts on it carry that slab.

  A release that names a slab counts there even when no bill in view holds it — the slab then shows
  as *released only*. Releases that name none count in the project's balance only. The Retention
  page shows them as *not tied to a rate*.
- **Where it shows.**
  - The Retention page's **By rate** tab shows each slab's held, released and balance, a project ×
    rate table and a bill × rate table, with exports.
  - The bill page's Retention tab lists the bill's slabs (a note's, as placed on its invoice).
  - While a retention line is entered, the form says which slab it counts in:
    - the bill form, on a bill the client has not certified yet;
    - the certification form, read against the certified taxable (or gross).

    Two places show no such hint. A note follows its invoice (except a line a note rule takes of
    the invoice plus its notes, which has one). A certified bill's raised lines, edited on the bill
    form, no longer count in the slabs: the certified ones do.

### Note rules: deductions of the invoice plus its notes

Some supply invoices bill part of the value and carry no retention: a SUPPLY-60% or SUPPLY-70%
invoice. A debit note against the invoice then bills the balance, and the client deducts the
retention for the whole on that note: 20% and 10% of the invoice plus the note, not of the note
alone. (A SUPPLY 100% invoice deducts its retention on the invoice itself, as any bill does.)

| Invoice | Debit note | Taken of | 20% | 10% | Left to collect on the note |
|---|---|---|---|---|---|
| SUPPLY-70%, ₹700 | ₹300 | ₹1,000 | ₹200 | ₹100 | ₹0 (*Held as retention*) |
| SUPPLY-60%, ₹600 | ₹300 | ₹900 | ₹180 | ₹90 | ₹30 |

Configured in Settings → **Note rules** (`settings.noteRules`; logic in
`src/lib/bill-tracking/note-rules.ts`). There are none until an administrator adds one. Each rule has:

- **Debit notes against invoices of:** the invoice's sub categories (SUPPLY-60%, SUPPLY-70%…). A
  sub category can be in one active rule only.
- **Taken of the invoice plus its notes:** the deduction heads that follow the rule, usually the
  retention heads. Every other head on the note (TDS on the debit note, say) stays on the note's own
  value.
- **Count these notes in the invoice's certification check:** off by default. The client certifies
  the invoice at its own value, and the debit note bills the balance, so the note is left out of
  raised vs certified (`outsideCertification`, set when the note is saved). Without that, a ₹300
  debit note against a ₹600 invoice certified at ₹600 would ask for a ₹300 credit note. Only a note
  carrying lines taken of the invoice plus its notes is left out: a debit note raised to match the
  client's certification has none, so it counts.
- **Active**, and a name. Every rule needs a name; an active one also needs a sub category and a
  head (a switched-off rule may wait half-made). Two active rules may not share a sub category.
  Sub categories and heads removed from Settings drop out of the rules that named them.

How it works:

- **The base** is the invoice plus every live note against it saved before this one and dated on or
  before it, plus this note. It is taxable, or gross for a head taken on gross. The server stores it
  on each line (`invoiceBase`). A note saved later never moves it, even one dated earlier, so editing
  the note's remarks leaves its deductions alone.
- **Already held.** A % line takes its rate of that base less what the invoice and the earlier notes
  already hold at the same head and rate (`heldBefore`, shown on the form). A second balance note
  therefore holds only what is still due: a ₹600 invoice with ₹200 and then ₹100 notes holds 30% of
  ₹800 = ₹240 on the first and ₹270 − ₹240 = ₹30 on the second — ₹270 in all, as one ₹300 note
  would. A line never goes below nothing.
- **Reversing it.** A credit note that reverses such a note's retention lands in the same rates
  (20%, 10%) on the Retention page, however its lines were typed.
- **Only debit notes** follow a rule; a credit note's deductions reverse its own value.
- **The note form** says which rule applies and what the base is. Each covered line reads
  *20% of ₹900 (INV-1 + its notes, taxable) = ₹180*. *Take of this note only* takes one line of the
  note's own value instead (`ownBase`), and *Take of INV-1 + its notes* puts it back.
- **Retention by rate** counts such lines at their own rate (see above).
- **The invoice page** marks such a note *Outside certification* in its notes list. Its Retention tab
  lists the retention held on its notes and the total with them.
- **Held as retention.** A bill with nothing to collect, nothing received and retention held shows
  *Held as retention* instead of *Received*: the register, the reports and the bill page's payment
  step all use it. The stored status stays `received`.
- **Existing notes.** A rule applies when a debit note's lines are worked out: on a new note, or
  when an edit changes its lines or figures. A note whose lines and figures are left as they were
  keeps its issued deductions, whatever rules were added or switched off since (see *Issued lines
  are kept*).

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
   - Grant `Bills · Certify` to whoever records the client's certification.
5. **Reminders.** Run `scripts/setup-cloud-scheduler.sh` to add the `bill-tracking-reminders` job
   (08:00 IST). The route refuses every call while `CRON_SECRET` is unset.
6. **Migration.**
   1. Fill in Settings → Projects & DGM offices.
   2. Run `npm run bill-tracking:dry-run -- "<path to workbook>"` and check the totals offline.
   3. Import the workbook at `/bill-tracking/import`.
   4. Open the job's Reconciliation and accept the import only when every difference is explained.
7. **Certified bills before 2026-10-27.** Until then the certified deductions did not apply to the
   bill. Bills certified before that date still store totals worked out from the raised deductions
   (net, outstanding, retention, payment status) until each is recomputed.
   1. Dry run: `node --experimental-strip-types scripts/bill-tracking-recompute-totals.mjs`. It
      lists the bills whose totals would change and writes nothing. It reads `.env` like the dev
      server, so it reads whichever database that points at.
   2. Run it again with `--write` to store the new totals. A second dry run should list nothing.
   3. Check the notes raised before then to match a certification. The old suggested note carried
      the client's changed deductions as lines. Those now count twice, on the bill and on the note,
      so edit them off the note.

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
npm run test:bill-tracking       # tests: calculations, ageing, import, reports, GST, categories, certification, workflow, retention by rate, note rules, permissions, reminders
npm run typecheck:bill-tracking
```
