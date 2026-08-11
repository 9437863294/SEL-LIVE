# Store & Stock Management audit and Inventory v2 rollout

Audit date: 2026-08-11

## Scope inspected

- All routes and components below `src/app/(protected)/store-stock-management` and `src/components/store-stock-management`.
- Shared project, user, permission, activity-log, notification, Firebase client/admin, and serial-number infrastructure.
- Firestore indexes and configured Firebase deployment files.
- Read-only live Firestore inspection of the known project, role, unit, and inventory collections.

No production documents were changed during the audit.

## Live data snapshot

| Area | Result |
| --- | ---: |
| Projects | 38 |
| Stock-enabled projects | 1 |
| Project sites | 2 |
| BOQ items | 589 |
| Legacy `inventoryLogs` rows | 10 |
| Legacy transaction types | 10 Goods Receipt; 0 Goods Issue |
| Unique legacy stock items | 4 |
| Projects containing legacy stock | 1 |
| Remaining legacy stock quantity | 117.371 |
| Negative legacy receipt balances | 0 |
| Missing item/project/unit/cost on legacy rows | 0 |

The legacy balance can therefore be migrated without inventing transaction history: preserve the ten rows and create an identifiable opening-stock document for their current remaining balances.

## Findings in the original implementation

1. Inventory was project- and BOQ-first. A normal stock item could not be received unless it existed in project BOQ.
2. There was no Item Master, Inventory Location Master, independent Project Store, central/property warehouse, bin, or item/location balance.
3. `inventoryLogs` mixed receipt lots, remaining balances, issue movements, and the reporting ledger in one collection.
4. Stock issue did use a Firestore transaction and blocked over-issue, but it queried before the transaction and then mutated individual receipt rows. This is fragile under concurrency and does not provide one authoritative item/location balance.
5. A GRN number counter was incremented separately from the batch that saved its receipt lines. A later line/upload failure could consume a number without a document.
6. Goods Receipt lines were immediately usable. There was no Draft/Submitted/Approved/Posted boundary, inspection state, rejection/quarantine, or partial PO receipt model.
7. Posted GRNs could be edited. The edit handler reset `availableQuantity` to the new receipt quantity, which could recreate previously issued stock.
8. Historical transactions could be permanently deleted. The reversal logic attempted to reconstruct stock by parsing descriptions and source GRN strings.
9. Project receipt and consumption were the same project bucket; there was no explicit transfer-to-project versus project-consumption separation.
10. No transfer header/line workflow, partial receipt, in-transit quantity, project return, store return, stock adjustment approval, physical count, reservation, or immutable status history existed.
11. Permissions only covered project screen visibility and module settings. Transaction creation/posting/approval and cost visibility were not granular.
12. Critical writes were performed directly from the browser. New Inventory v2 writes now use a token-authenticated server route, but the legacy application still needs a repository-wide Firestore Security Rules audit before rules can safely be tightened.
13. The repository's baseline TypeScript check had unrelated errors outside this module. The module-specific nullable `useParams` errors were corrected during this work; unrelated baseline errors remain documented in the final verification output.

## Inventory v2 design

Inventory v2 is additive and does not delete legacy data.

The module exposes two independent enablement paths under **Settings → Enable Projects & Properties**:

- **Project BOQ Stock** sets `projects.stockManagementRequired` and controls the existing BOQ-based project workspace.
- **Property Item Inventory** sets `insuredAssets.inventoryManagementRequired` for Property Master records and atomically creates/activates a default `Property Store` inventory location. Disabling is blocked while that location has stock.

| Collection | Purpose |
| --- | --- |
| `inventoryItems` | BOQ-independent Item Master and tracking/cost/reorder configuration |
| `inventoryLocations` | Central, property, project, transit, quarantine, and scrap locations |
| `inventoryBalances` | One concurrency-controlled balance per organization + item + location |
| `inventoryDocuments` | Posted receipts/issues/returns/adjustments and transfer workflow documents |
| `stockLedger` | Immutable quantity/value movements with balance-after auditability |
| `inventoryApprovalHistory` | Status/action history for inventory documents |
| `inventoryStockCounts` | Frozen physical-count sessions and variances |
| `inventoryNumberSequences` | Atomic annual document sequences |
| `inventoryIdempotency` | Duplicate-submit protection for commands |
| `inventoryMigrations` | One idempotent marker per migrated legacy project |

Core rules enforced by the server command route:

- Firebase ID token, registered active user, organization scope, role permission, and allowed-location validation.
- All balance checks and writes execute in a Firestore transaction.
- Default prevention of negative available stock; an organization setting and explicit permission are both required to override it.
- Moving weighted-average cost per item/location.
- Posted movement document, balance, ledger, audit entry, sequence, and idempotency marker commit together or all roll back.
- Transfer dispatch reduces the source; accepted receipt increases the destination. Partial receipt and rejected/damaged quantities remain traceable on the transfer.
- Transfer to a Project Store is stock. Only a separate Project Consumption document consumes it.
- Posted legacy transactions are now read-only in the UI. Corrections use controlled documents.

## Safe migration procedure

1. Take a Firestore export/backup.
2. Run the dry run:

   ```powershell
   npm run inventory:migrate
   ```

3. Reconcile the printed row count, item count, quantity, value, project, and generated location against the live snapshot.
4. Ensure the Inventory v2 target balances for the project are still empty.
5. Apply with server credentials available:

   ```powershell
   npm run inventory:migrate -- --apply --organization=default
   ```

6. Re-run the dry run and reconcile `inventoryBalances`, the `OPN-MIG-*` document, and its `stockLedger` entries.

The apply path is idempotent. It aborts a project if a non-zero target balance already exists, writes an `inventoryMigrations` marker on success, leaves `inventoryLogs` unchanged, and labels the new ledger movement as migrated opening stock.

## Rollout notes

- Deploy the new composite indexes before high-volume use.
- Add the new granular permissions to production role documents. Existing roles with legacy `View Transactions` retain transaction access for backward compatibility during rollout.
- Run the migration only after Item/Location naming has been reviewed by the inventory owner.
- Keep the legacy project workspace available for BOQ, BOM, conversion, and historical lookup until reconciliation is signed off.
- A broader Firestore Security Rules project is still required because this repository does not currently track the production Firestore rules file; deploying guessed global rules could break unrelated modules.
