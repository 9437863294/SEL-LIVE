/**
 * Safely maps legacy inventoryLogs balances into Inventory v2 opening stock.
 *
 * Dry run (default): npm run inventory:migrate
 * Apply:             npm run inventory:migrate -- --apply --organization=default
 *
 * The script never edits or deletes inventoryLogs. Each project is protected by an
 * idempotent inventoryMigrations marker and aborts if a target balance already exists.
 */
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { collection, getDocs, getFirestore as getClientFirestore } from 'firebase/firestore';

dotenv.config({ path: '.env', quiet: true });

const apply = process.argv.includes('--apply');
const organizationArg = process.argv.find((value) => value.startsWith('--organization='));
const organizationId = organizationArg?.split('=').slice(1).join('=') || 'default';
const safeKey = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
const encodeId = (...parts) => parts.map((value) => encodeURIComponent(String(value))).join('__');
const shortHash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 12).toUpperCase();

const clientApp = initializeClientApp({
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
}, `inventory-migration-audit-${Date.now()}`);
const clientDb = getClientFirestore(clientApp);

const [projectSnapshot, legacySnapshot] = await Promise.all([
  getDocs(collection(clientDb, 'projects')),
  getDocs(collection(clientDb, 'inventoryLogs')),
]);

const projects = new Map(projectSnapshot.docs.map((document) => [document.id, { id: document.id, ...document.data() }]));
const grouped = new Map();
for (const document of legacySnapshot.docs) {
  const row = document.data();
  const remaining = Number(row.availableQuantity || 0);
  if (!row.projectId || !row.itemId || remaining <= 0) continue;
  if (!grouped.has(row.projectId)) grouped.set(row.projectId, new Map());
  const itemMap = grouped.get(row.projectId);
  const current = itemMap.get(row.itemId) || {
    legacyItemId: row.itemId,
    itemName: row.itemName || row.itemId,
    unit: row.unit || 'Unit',
    quantity: 0,
    value: 0,
    sourceRows: 0,
  };
  current.quantity += remaining;
  current.value += remaining * Number(row.cost || 0);
  current.sourceRows += 1;
  itemMap.set(row.itemId, current);
}

const plan = [];
for (const [projectId, itemMap] of grouped.entries()) {
  const project = projects.get(projectId) || { id: projectId, projectName: projectId, siteCode: projectId.slice(0, 8) };
  const locationCode = `PRJ-${safeKey(project.siteCode || projectId).toUpperCase()}`;
  const locationId = `${safeKey(organizationId)}__${locationCode}`;
  const items = Array.from(itemMap.values()).map((item) => ({
    ...item,
    itemCode: `LEGACY-${shortHash(item.legacyItemId)}`,
    itemId: `${safeKey(organizationId)}__LEGACY-${shortHash(item.legacyItemId)}`,
    averageCost: item.quantity > 0 ? item.value / item.quantity : 0,
  }));
  plan.push({
    projectId,
    projectName: project.projectName || projectId,
    locationId,
    locationCode,
    locationName: `${project.projectName || projectId} Project Store`,
    rows: items.reduce((sum, item) => sum + item.sourceRows, 0),
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalValue: items.reduce((sum, item) => sum + item.value, 0),
    items,
  });
}

console.log(JSON.stringify({
  mode: apply ? 'APPLY' : 'DRY RUN',
  organizationId,
  legacyRows: legacySnapshot.size,
  projectsToMigrate: plan.length,
  itemLocationBalances: plan.reduce((sum, project) => sum + project.items.length, 0),
  totalOpeningQuantity: plan.reduce((sum, project) => sum + project.totalQuantity, 0),
  totalOpeningValue: plan.reduce((sum, project) => sum + project.totalValue, 0),
  projects: plan.map(({ items, ...project }) => ({ ...project, items: items.map(({ legacyItemId, itemCode, itemName, unit, quantity, averageCost, sourceRows }) => ({ legacyItemId, itemCode, itemName, unit, quantity, averageCost, sourceRows })) })),
}, null, 2));

await deleteClientApp(clientApp);

if (!apply) {
  console.log('\nDry run only. Re-run with --apply after reviewing this plan and taking a Firestore backup.');
  process.exit(0);
}

const { applicationDefault, cert, initializeApp: initializeAdminApp } = await import('firebase-admin/app');
const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const credential = privateKey && process.env.FIREBASE_CLIENT_EMAIL
  ? cert({ projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey })
  : applicationDefault();
const adminApp = initializeAdminApp({ credential, projectId }, `inventory-migration-apply-${Date.now()}`);
const adminDb = getFirestore(adminApp);

for (const project of plan) {
  if (project.items.length > 100) throw new Error(`${project.projectName} has ${project.items.length} items; split the migration before applying to stay safely below Firestore transaction limits.`);
  const migrationId = `${safeKey(organizationId)}_${safeKey(project.projectId)}`;
  const migrationRef = adminDb.collection('inventoryMigrations').doc(migrationId);
  const locationRef = adminDb.collection('inventoryLocations').doc(project.locationId);
  const documentRef = adminDb.collection('inventoryDocuments').doc(`legacy_opening_${migrationId}`);

  const result = await adminDb.runTransaction(async (transaction) => {
    const marker = await transaction.get(migrationRef);
    if (marker.exists) return { skipped: true, reason: 'already migrated' };
    const balanceRefs = project.items.map((item) => adminDb.collection('inventoryBalances').doc(encodeId(organizationId, project.locationId, item.itemId)));
    const existingBalances = await transaction.getAll(...balanceRefs);
    if (existingBalances.some((snapshot) => snapshot.exists && Number(snapshot.data()?.onHandQuantity || 0) !== 0)) {
      throw new Error(`${project.projectName}: a target Inventory v2 balance is already non-zero; migration aborted without writes.`);
    }

    transaction.set(locationRef, {
      organizationId,
      locationCode: project.locationCode,
      locationName: project.locationName,
      type: 'Project Store',
      projectId: project.projectId,
      projectName: project.projectName,
      active: true,
      createdBy: 'MIGRATION',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const lines = [];
    project.items.forEach((item, index) => {
      const itemRef = adminDb.collection('inventoryItems').doc(item.itemId);
      const balanceRef = balanceRefs[index];
      const lineId = `L${index + 1}`;
      transaction.set(itemRef, {
        organizationId,
        itemCode: item.itemCode,
        itemName: item.itemName,
        description: `Migrated from legacy BOQ/inventory item ${item.legacyItemId}`,
        unit: item.unit,
        minimumStockLevel: 0,
        reorderLevel: 0,
        costRate: item.averageCost,
        averageCost: item.averageCost,
        active: true,
        classification: 'Inventory',
        serialTracking: false,
        batchTracking: false,
        expiryTracking: false,
        legacyBoqItemId: item.legacyItemId,
        createdBy: 'MIGRATION',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(balanceRef, {
        organizationId,
        itemId: item.itemId,
        locationId: project.locationId,
        openingQuantity: item.quantity,
        quantityReceived: 0,
        quantityIssued: 0,
        quantityTransferredIn: 0,
        quantityTransferredOut: 0,
        quantityReturnedIn: 0,
        quantityReturnedOut: 0,
        adjustmentIn: 0,
        adjustmentOut: 0,
        reservedQuantity: 0,
        onHandQuantity: item.quantity,
        availableQuantity: item.quantity,
        averageCost: item.averageCost,
        inventoryValue: item.value,
        version: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(adminDb.collection('stockLedger').doc(`${documentRef.id}_${lineId}`), {
        organizationId,
        transactionDate: new Date().toISOString().slice(0, 10),
        documentId: documentRef.id,
        documentNumber: `OPN-MIG-${shortHash(project.projectId).slice(0, 8)}`,
        transactionType: 'Opening Stock',
        status: 'Posted',
        itemId: item.itemId,
        itemCode: item.itemCode,
        itemName: item.itemName,
        locationId: project.locationId,
        locationName: project.locationName,
        destinationLocationId: project.locationId,
        quantityIn: item.quantity,
        quantityOut: 0,
        unit: item.unit,
        costRate: item.averageCost,
        totalValue: item.value,
        balanceAfter: item.quantity,
        referenceDocument: `Legacy inventoryLogs (${item.sourceRows} row(s))`,
        remarks: 'Opening balance migrated from existing stock; no historical movements fabricated.',
        createdBy: 'MIGRATION',
        postedBy: 'MIGRATION',
        postingDate: FieldValue.serverTimestamp(),
      });
      lines.push({ id: lineId, itemId: item.itemId, itemCode: item.itemCode, itemName: item.itemName, unit: item.unit, quantity: item.quantity, unitCost: item.averageCost, remarks: `Legacy item ${item.legacyItemId}` });
    });
    transaction.set(documentRef, {
      organizationId,
      documentNumber: `OPN-MIG-${shortHash(project.projectId).slice(0, 8)}`,
      documentType: 'Opening Stock',
      transactionDate: new Date().toISOString().slice(0, 10),
      status: 'Posted',
      destinationLocationId: project.locationId,
      destinationLocationName: project.locationName,
      projectId: project.projectId,
      projectName: project.projectName,
      referenceDocument: 'Legacy inventoryLogs migration',
      remarks: 'Identifiable opening balance; legacy rows preserved unchanged.',
      lines,
      createdBy: 'MIGRATION',
      createdByName: 'Inventory v2 migration',
      postedBy: 'MIGRATION',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      postedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(migrationRef, {
      organizationId,
      source: 'inventoryLogs',
      projectId: project.projectId,
      projectName: project.projectName,
      sourceRows: project.rows,
      itemBalances: project.items.length,
      openingQuantity: project.totalQuantity,
      openingValue: project.totalValue,
      documentId: documentRef.id,
      status: 'Completed',
      appliedAt: FieldValue.serverTimestamp(),
    });
    return { skipped: false, documentId: documentRef.id };
  });
  console.log(`${project.projectName}: ${result.skipped ? `SKIPPED (${result.reason})` : `MIGRATED (${result.documentId})`}`);
}

console.log('Inventory v2 migration completed. Legacy inventoryLogs were not modified.');

