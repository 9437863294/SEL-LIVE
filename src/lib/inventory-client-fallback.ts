'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
  DOCUMENT_PREFIX,
  INBOUND_DOCUMENT_TYPES,
  INVENTORY_COLLECTIONS,
  OUTBOUND_DOCUMENT_TYPES,
  inventoryBalanceId,
  movingWeightedAverage,
  packBuildRequirements,
  type InventoryDocumentLine,
  type InventoryDocumentType,
  type InventoryPackComponent,
} from '@/lib/inventory';

interface ClientInventoryContext {
  userId: string;
  userName: string;
  organizationId: string;
  permissions: Record<string, unknown>;
}

interface LocationPayload extends Record<string, unknown> {
  id?: string;
  locationCode: string;
  locationName: string;
  type: string;
  projectId?: string;
}

interface ItemPayload extends Record<string, unknown> {
  id?: string;
  itemCode: string;
  itemName: string;
  unit: string;
  packList?: unknown;
}

const safeKey = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

const clean = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ''));

const locationDocumentId = (organizationId: string, locationCode: string) =>
  `${safeKey(organizationId)}__${safeKey(locationCode.toUpperCase())}`;

const itemDocumentId = (organizationId: string, itemCode: string) =>
  `${safeKey(organizationId)}__${safeKey(itemCode.toUpperCase())}`;

async function loadContext(): Promise<ClientInventoryContext> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('Your session has expired. Please sign in again.');

  let userSnapshot = await getDoc(doc(db, 'users', firebaseUser.uid));
  if (!userSnapshot.exists() && firebaseUser.email) {
    const byEmail = await getDocs(query(
      collection(db, 'users'),
      where('email', '==', firebaseUser.email.trim().toLowerCase()),
      limit(1),
    ));
    if (!byEmail.empty) userSnapshot = byEmail.docs[0];
  }
  if (!userSnapshot.exists()) throw new Error('The signed-in user is not registered.');

  const user = userSnapshot.data();
  if (user.status === 'Inactive') throw new Error('This user account is inactive.');
  const roleName = String(user.role || '');
  const roleSnapshot = roleName
    ? await getDocs(query(collection(db, 'roles'), where('name', '==', roleName), limit(1)))
    : null;

  return {
    userId: userSnapshot.id,
    userName: String(user.name || firebaseUser.displayName || firebaseUser.email || 'User'),
    organizationId: String(user.organizationId || 'default'),
    permissions: (roleSnapshot?.docs[0]?.data()?.permissions || {}) as Record<string, unknown>,
  };
}

function permissionList(context: ClientInventoryContext, resource: 'Inventory' | 'Settings') {
  const modulePermissions = context.permissions['Store & Stock Management'] as Record<string, unknown> | undefined;
  const nested = modulePermissions?.[resource];
  const direct = context.permissions[`Store & Stock Management.${resource}`];
  return [nested, direct].find(Array.isArray) as string[] | undefined;
}

function requireSettingsPermission(context: ClientInventoryContext, action: string) {
  const permissions = permissionList(context, 'Settings') || [];
  if (!permissions.includes(action) && !permissions.includes('Manage All') && !permissions.includes('Edit')) {
    throw new Error(`${action} permission is required.`);
  }
}

function hasLegacyTransactionAccess(context: ClientInventoryContext) {
  const modulePermissions = context.permissions['Store & Stock Management'] as Record<string, unknown> | undefined;
  const nested = modulePermissions?.Projects;
  const direct = context.permissions['Store & Stock Management.Projects'];
  const permissions = ([nested, direct].find(Array.isArray) || []) as string[];
  return permissions.includes('View Transactions');
}

function requireInventoryPermission(
  context: ClientInventoryContext,
  action: string,
  options?: { legacyTransaction?: boolean },
) {
  const permissions = permissionList(context, 'Inventory') || [];
  if (
    !permissions.includes(action)
    && !permissions.includes('Manage All')
    && !(options?.legacyTransaction && hasLegacyTransactionAccess(context))
  ) {
    throw new Error(`${action} permission is required.`);
  }
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} data is invalid.`);
  }
  return value as Record<string, unknown>;
}

async function saveLocation(context: ClientInventoryContext, rawLocation: unknown) {
  const location = expectRecord(rawLocation, 'Location') as LocationPayload;
  const locationCode = String(location.locationCode || '').trim().toUpperCase();
  const locationName = String(location.locationName || '').trim();
  if (!locationCode || !locationName) throw new Error('Location code and name are required.');
  if (location.type === 'Project Store' && !location.projectId) {
    throw new Error('A project store must be linked to a project.');
  }

  requireSettingsPermission(context, location.id ? 'Edit Location' : 'Create Location');
  const targetId = location.id || locationDocumentId(context.organizationId, locationCode);
  const targetRef = doc(db, INVENTORY_COLLECTIONS.locations, targetId);

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(targetRef);
    if (!location.id && existing.exists()) throw new Error(`Location code ${locationCode} already exists.`);
    if (location.id && !existing.exists()) throw new Error('Inventory location not found.');
    if (location.id && existing.data()?.locationCode !== locationCode) {
      throw new Error('Location code cannot be changed after creation.');
    }
    transaction.set(targetRef, clean({
      ...location,
      id: undefined,
      organizationId: context.organizationId,
      locationCode,
      updatedBy: context.userId,
      updatedAt: serverTimestamp(),
      ...(!existing.exists() ? { createdBy: context.userId, createdAt: serverTimestamp() } : {}),
    }), { merge: true });
  });
  return { id: targetId, locationCode };
}

async function saveItem(context: ClientInventoryContext, rawItem: unknown) {
  const item = expectRecord(rawItem, 'Item') as ItemPayload;
  const itemCode = String(item.itemCode || '').trim().toUpperCase();
  const itemName = String(item.itemName || '').trim();
  const unit = String(item.unit || '').trim();
  if (!itemCode || !itemName || !unit) throw new Error('Item code, name, and unit are required.');

  requireSettingsPermission(context, item.id ? 'Edit Item' : 'Create Item');
  const targetId = item.id || itemDocumentId(context.organizationId, itemCode);
  const targetRef = doc(db, INVENTORY_COLLECTIONS.items, targetId);
  const rawPackList = item.packList === undefined ? [] : item.packList;
  if (!Array.isArray(rawPackList) || rawPackList.length > 100) throw new Error('The item pack list is invalid.');
  const packList = rawPackList.map((rawComponent, index) => {
    const component = expectRecord(rawComponent, `Pack sub-item ${index + 1}`);
    const itemId = String(component.itemId || '');
    const quantity = Number(component.quantity);
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Pack sub-item ${index + 1} requires an item and positive quantity.`);
    }
    return { itemId, quantity };
  });
  if (item.classification === 'Non-inventory' && packList.length > 0) {
    throw new Error('A non-inventory item cannot have a pack list.');
  }
  if (new Set(packList.map((component) => component.itemId)).size !== packList.length) {
    throw new Error('Each sub-item can appear only once in a pack list.');
  }
  if (packList.some((component) => component.itemId === targetId)) {
    throw new Error('An item cannot contain itself in its pack list.');
  }

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(targetRef);
    if (!item.id && existing.exists()) throw new Error(`Item code ${itemCode} already exists.`);
    if (item.id && !existing.exists()) throw new Error('Inventory item not found.');
    if (item.id && existing.data()?.itemCode !== itemCode) {
      throw new Error('Item code cannot be changed after creation.');
    }
    const componentSnapshots: DocumentSnapshot<DocumentData>[] = [];
    for (const component of packList) {
      componentSnapshots.push(await transaction.get(doc(db, INVENTORY_COLLECTIONS.items, component.itemId)));
    }
    const normalizedPackList = packList.map((component, index) => {
      const componentSnapshot = componentSnapshots[index];
      if (!componentSnapshot?.exists() || componentSnapshot.data()?.active === false) {
        throw new Error('One of the selected pack sub-items is missing or inactive.');
      }
      const componentItem = componentSnapshot.data()!;
      if (String(componentItem.organizationId || 'default') !== context.organizationId) {
        throw new Error('A pack sub-item is outside your organization.');
      }
      if (componentItem.classification === 'Non-inventory') {
        throw new Error(`${componentItem.itemName} is classified as non-inventory.`);
      }
      return {
        itemId: componentSnapshot.id,
        itemCode: String(componentItem.itemCode || ''),
        itemName: String(componentItem.itemName || ''),
        unit: String(componentItem.unit || ''),
        quantity: component.quantity,
      };
    });
    transaction.set(targetRef, clean({
      ...item,
      id: undefined,
      organizationId: context.organizationId,
      itemCode,
      packList: normalizedPackList,
      updatedBy: context.userId,
      updatedAt: serverTimestamp(),
      ...(!existing.exists() ? { createdBy: context.userId, createdAt: serverTimestamp() } : {}),
    }), { merge: true });
  });
  return { id: targetId, itemCode };
}

async function setInventoryScopeStatus(context: ClientInventoryContext, payload: Record<string, unknown>) {
  const scope = payload.scope;
  const entityId = String(payload.entityId || '');
  const enabled = payload.enabled;
  if ((scope !== 'Project' && scope !== 'Property') || !entityId || typeof enabled !== 'boolean') {
    throw new Error('Inventory scope data is invalid.');
  }
  requireSettingsPermission(context, scope === 'Project' ? 'Manage Projects' : 'Manage Properties');

  if (scope === 'Project') {
    const projectRef = doc(db, 'projects', entityId);
    await runTransaction(db, async (transaction) => {
      const project = await transaction.get(projectRef);
      if (!project.exists()) throw new Error('Project not found.');
      transaction.update(projectRef, {
        stockManagementRequired: enabled,
        stockManagementUpdatedBy: context.userId,
        stockManagementUpdatedAt: serverTimestamp(),
      });
    });
    return { scope, entityId, enabled };
  }

  const propertyRef = doc(db, 'insuredAssets', entityId);
  const locationCode = `PROP-${safeKey(entityId).slice(0, 16).toUpperCase()}`;
  const locationRef = doc(
    db,
    INVENTORY_COLLECTIONS.locations,
    locationDocumentId(context.organizationId, locationCode),
  );

  if (!enabled) {
    const balances = await getDocs(query(
      collection(db, INVENTORY_COLLECTIONS.balances),
      where('organizationId', '==', context.organizationId),
      where('locationId', '==', locationRef.id),
    ));
    const onHand = balances.docs.reduce((sum, balance) => sum + Number(balance.data().onHandQuantity || 0), 0);
    if (Math.abs(onHand) > 0.000001) {
      throw new Error('This property still has stock. Transfer or adjust it to zero before disabling inventory.');
    }
  }

  await runTransaction(db, async (transaction) => {
    const [propertySnapshot, locationSnapshot] = await Promise.all([
      transaction.get(propertyRef),
      transaction.get(locationRef),
    ]);
    const property = propertySnapshot.data() as DocumentData | undefined;
    if (!propertySnapshot.exists() || property?.type !== 'Property') throw new Error('Property not found.');
    transaction.update(propertyRef, {
      inventoryManagementRequired: enabled,
      inventoryManagementUpdatedBy: context.userId,
      inventoryManagementUpdatedAt: serverTimestamp(),
    });
    transaction.set(locationRef, {
      organizationId: context.organizationId,
      locationCode,
      locationName: `${property.name || 'Property'} Main Store`,
      type: 'Property Store',
      propertyId: propertySnapshot.id,
      propertyName: property.name || 'Property',
      address: property.location || '',
      active: enabled,
      updatedBy: context.userId,
      updatedAt: serverTimestamp(),
      ...(!locationSnapshot.exists() ? { createdBy: context.userId, createdAt: serverTimestamp() } : {}),
    }, { merge: true });
  });
  return { scope, entityId, locationId: locationRef.id, enabled };
}

const movementTypes: InventoryDocumentType[] = [
  'Opening Stock',
  'Goods Receipt',
  'Goods Issue',
  'Store Return',
  'Project Consumption',
  'Stock Adjustment Increase',
  'Stock Adjustment Decrease',
  'Damaged Stock',
  'Lost Stock',
  'Write-Off',
];

function emptyBalance(organizationId: string, locationId: string, itemId: string) {
  return {
    organizationId,
    locationId,
    itemId,
    openingQuantity: 0,
    quantityReceived: 0,
    quantityIssued: 0,
    quantityTransferredIn: 0,
    quantityTransferredOut: 0,
    quantityReturnedIn: 0,
    quantityReturnedOut: 0,
    adjustmentIn: 0,
    adjustmentOut: 0,
    assemblyIn: 0,
    assemblyOut: 0,
    reservedQuantity: 0,
    onHandQuantity: 0,
    availableQuantity: 0,
    averageCost: 0,
    inventoryValue: 0,
    version: 0,
  } as DocumentData;
}

function movementCounter(documentType: InventoryDocumentType, inbound: boolean) {
  if (documentType === 'Opening Stock') return 'openingQuantity';
  if (documentType === 'Goods Receipt') return 'quantityReceived';
  if (documentType === 'Store Return') return inbound ? 'quantityReturnedIn' : 'quantityReturnedOut';
  if (documentType === 'Stock Transfer') return inbound ? 'quantityTransferredIn' : 'quantityTransferredOut';
  if (
    documentType.includes('Adjustment')
    || ['Damaged Stock', 'Lost Stock', 'Write-Off', 'Physical Count'].includes(documentType)
  ) {
    return inbound ? 'adjustmentIn' : 'adjustmentOut';
  }
  return 'quantityIssued';
}

function assertLocationAccess(context: ClientInventoryContext, location: DocumentData) {
  if (String(location.organizationId || 'default') !== context.organizationId) {
    throw new Error('The inventory location is outside your organization.');
  }
  const allowedUserIds = Array.isArray(location.allowedUserIds) ? location.allowedUserIds : [];
  if (allowedUserIds.length > 0 && !allowedUserIds.includes(context.userId)) {
    throw new Error(`You do not have access to ${location.locationName || 'this inventory location'}.`);
  }
  if (location.active === false) throw new Error('The selected inventory location is inactive.');
}

function validateTracking(item: DocumentData, line: InventoryDocumentLine) {
  if (item.serialTracking && (line.serialNumbers?.length || 0) !== line.quantity) {
    throw new Error(`${item.itemName}: enter one serial number for each unit.`);
  }
  if (item.batchTracking && !line.batchNumber) {
    throw new Error(`${item.itemName}: batch/lot number is required.`);
  }
  if (item.expiryTracking && !line.expiryDate) {
    throw new Error(`${item.itemName}: expiry date is required.`);
  }
}

async function nextDocumentNumber(
  transaction: Transaction,
  organizationId: string,
  documentType: InventoryDocumentType,
  transactionDate: string,
) {
  const year = transactionDate.slice(0, 4);
  const prefix = DOCUMENT_PREFIX[documentType];
  const sequenceRef = doc(
    db,
    INVENTORY_COLLECTIONS.sequences,
    `${safeKey(organizationId)}_${prefix}_${year}`,
  );
  const sequenceSnapshot = await transaction.get(sequenceRef);
  const next = Number(sequenceSnapshot.data()?.nextNumber || 1);
  transaction.set(sequenceRef, {
    organizationId,
    prefix,
    year,
    nextNumber: next + 1,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return `${prefix}-${year}-${String(next).padStart(5, '0')}`;
}

function movementLines(value: unknown): InventoryDocumentLine[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new Error('Add between 1 and 50 movement lines.');
  }
  const lines = value.map((rawLine, index) => {
    const line = expectRecord(rawLine, `Movement line ${index + 1}`);
    const itemId = String(line.itemId || '').trim();
    const quantity = Number(line.quantity);
    const unitCost = line.unitCost === undefined ? undefined : Number(line.unitCost);
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Movement line ${index + 1} requires an item and positive quantity.`);
    }
    if (unitCost !== undefined && (!Number.isFinite(unitCost) || unitCost < 0)) {
      throw new Error(`Movement line ${index + 1} has an invalid unit cost.`);
    }
    return clean({
      ...line,
      id: String(line.id || `L${index + 1}`),
      itemId,
      quantity,
      unitCost,
      serialNumbers: Array.isArray(line.serialNumbers)
        ? line.serialNumbers.map(String).map((serial) => serial.trim()).filter(Boolean)
        : undefined,
    }) as unknown as InventoryDocumentLine;
  });
  if (new Set(lines.map((line) => line.itemId)).size !== lines.length) {
    throw new Error('Each item can appear only once in a movement document.');
  }
  return lines;
}

async function postMovement(context: ClientInventoryContext, payload: Record<string, unknown>) {
  const documentType = String(payload.documentType || '') as InventoryDocumentType;
  const transactionDate = String(payload.transactionDate || '');
  const clientRequestId = String(payload.clientRequestId || '');
  if (!movementTypes.includes(documentType)) throw new Error('Movement type is invalid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) throw new Error('Transaction date is invalid.');
  if (clientRequestId.length < 8 || clientRequestId.length > 200) throw new Error('Movement request ID is invalid.');

  const inbound = INBOUND_DOCUMENT_TYPES.includes(documentType);
  const outbound = OUTBOUND_DOCUMENT_TYPES.includes(documentType);
  const sourceLocationId = String(payload.sourceLocationId || '');
  const destinationLocationId = String(payload.destinationLocationId || '');
  if (inbound && !destinationLocationId) throw new Error('Destination location is required.');
  if (outbound && !sourceLocationId) throw new Error('Source location is required.');
  const locationId = inbound ? destinationLocationId : sourceLocationId;
  const lines = movementLines(payload.lines);
  const permission = documentType === 'Goods Receipt'
    ? 'Post Receipt'
    : documentType.includes('Adjustment')
        || ['Opening Stock', 'Damaged Stock', 'Lost Stock', 'Write-Off'].includes(documentType)
      ? 'Perform Stock Adjustment'
      : 'Post Issue';
  requireInventoryPermission(context, permission, { legacyTransaction: true });

  const documentRef = doc(collection(db, INVENTORY_COLLECTIONS.documents));
  const requestRef = doc(
    db,
    INVENTORY_COLLECTIONS.idempotency,
    `${safeKey(context.organizationId)}_${safeKey(clientRequestId)}`,
  );
  const locationRef = doc(db, INVENTORY_COLLECTIONS.locations, locationId);
  const settingsRef = doc(db, 'storeStockSettings', 'inventory');
  const itemRefs = lines.map((line) => doc(db, INVENTORY_COLLECTIONS.items, line.itemId));
  const balanceRefs = lines.map((line) => doc(
    db,
    INVENTORY_COLLECTIONS.balances,
    inventoryBalanceId(context.organizationId, locationId, line.itemId),
  ));

  return runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists()) return { ...requestSnapshot.data(), duplicate: true };

    const locationSnapshot = await transaction.get(locationRef);
    if (!locationSnapshot.exists()) throw new Error('Inventory location not found.');
    const location = locationSnapshot.data();
    assertLocationAccess(context, location);
    const settingsSnapshot = await transaction.get(settingsRef);

    const itemSnapshots: DocumentSnapshot<DocumentData>[] = [];
    for (const itemRef of itemRefs) itemSnapshots.push(await transaction.get(itemRef));
    const balanceSnapshots: DocumentSnapshot<DocumentData>[] = [];
    for (const balanceRef of balanceRefs) balanceSnapshots.push(await transaction.get(balanceRef));
    const documentNumber = await nextDocumentNumber(
      transaction,
      context.organizationId,
      documentType,
      transactionDate,
    );
    const allowNegative = settingsSnapshot.data()?.allowNegativeInventory === true
      && (permissionList(context, 'Inventory') || []).includes('Allow Negative Inventory');
    const storedLines: InventoryDocumentLine[] = [];

    lines.forEach((line, index) => {
      const itemSnapshot = itemSnapshots[index];
      if (!itemSnapshot.exists() || itemSnapshot.data()?.active === false) {
        throw new Error('One of the selected inventory items is missing or inactive.');
      }
      const item = itemSnapshot.data()!;
      if (String(item.organizationId || 'default') !== context.organizationId) {
        throw new Error('An item is outside your organization.');
      }
      if (item.classification === 'Non-inventory') {
        throw new Error(`${item.itemName} is classified as non-inventory.`);
      }
      validateTracking(item, line);

      const balanceSnapshot = balanceSnapshots[index];
      const current = balanceSnapshot.exists()
        ? balanceSnapshot.data()!
        : emptyBalance(context.organizationId, locationId, line.itemId);
      const currentOnHand = Number(current.onHandQuantity || 0);
      const reserved = Number(current.reservedQuantity || 0);
      const currentAverage = Number(current.averageCost || 0);
      if (!inbound && !allowNegative && line.quantity > currentOnHand - reserved) {
        throw new Error(
          `${item.itemName}: requested ${line.quantity}, available ${Math.max(0, currentOnHand - reserved)}.`,
        );
      }

      const rate = inbound
        ? Number(line.unitCost ?? currentAverage ?? item.costRate ?? 0)
        : Number(currentAverage || item.costRate || 0);
      const nextOnHand = currentOnHand + (inbound ? line.quantity : -line.quantity);
      const nextAverage = inbound
        ? movingWeightedAverage(currentOnHand, currentAverage, line.quantity, rate)
        : currentAverage;
      const counter = movementCounter(documentType, inbound);
      transaction.set(balanceRefs[index], {
        ...current,
        organizationId: context.organizationId,
        itemId: line.itemId,
        locationId,
        [counter]: Number(current[counter] || 0) + line.quantity,
        onHandQuantity: nextOnHand,
        availableQuantity: nextOnHand - reserved,
        averageCost: nextAverage,
        inventoryValue: nextOnHand * nextAverage,
        version: Number(current.version || 0) + 1,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      const storedLine = clean({
        ...line,
        itemCode: String(item.itemCode || ''),
        itemName: String(item.itemName || ''),
        description: String(item.description || ''),
        unit: String(item.unit || ''),
        unitCost: rate,
      }) as unknown as InventoryDocumentLine;
      storedLines.push(storedLine);
      transaction.set(doc(db, INVENTORY_COLLECTIONS.ledger, `${documentRef.id}_${line.id}`), clean({
        organizationId: context.organizationId,
        transactionDate,
        documentId: documentRef.id,
        documentNumber,
        transactionType: documentType,
        status: 'Posted',
        itemId: line.itemId,
        itemCode: item.itemCode,
        itemName: item.itemName,
        locationId,
        locationName: location.locationName,
        sourceLocationId: sourceLocationId || undefined,
        destinationLocationId: destinationLocationId || undefined,
        quantityIn: inbound ? line.quantity : 0,
        quantityOut: inbound ? 0 : line.quantity,
        unit: item.unit,
        costRate: rate,
        totalValue: line.quantity * rate,
        balanceAfter: nextOnHand,
        projectId: location.projectId,
        propertyId: location.propertyId,
        supplierId: payload.supplierId,
        departmentId: payload.departmentId,
        requesterId: payload.requesterId,
        referenceDocument: payload.referenceDocument,
        remarks: line.remarks || payload.remarks,
        batchNumber: line.batchNumber,
        serialNumbers: line.serialNumbers,
        createdBy: context.userId,
        postedBy: context.userId,
        postingDate: serverTimestamp(),
      }));
    });

    transaction.set(documentRef, clean({
      organizationId: context.organizationId,
      documentNumber,
      documentType,
      transactionDate,
      status: 'Posted',
      sourceLocationId: sourceLocationId || undefined,
      sourceLocationName: !inbound ? location.locationName : undefined,
      destinationLocationId: destinationLocationId || undefined,
      destinationLocationName: inbound ? location.locationName : undefined,
      projectId: location.projectId,
      projectName: location.projectName,
      propertyId: location.propertyId,
      propertyName: location.propertyName,
      supplierId: payload.supplierId,
      supplierName: payload.supplierName,
      departmentId: payload.departmentId,
      departmentName: payload.departmentName,
      requesterId: payload.requesterId,
      requesterName: payload.requesterName,
      issuedTo: payload.issuedTo,
      referenceDocument: payload.referenceDocument,
      purpose: payload.purpose,
      remarks: payload.remarks,
      lines: storedLines,
      createdBy: context.userId,
      createdByName: context.userName,
      postedBy: context.userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      postedAt: serverTimestamp(),
    }));
    transaction.set(doc(collection(db, INVENTORY_COLLECTIONS.approvals)), {
      organizationId: context.organizationId,
      documentId: documentRef.id,
      documentNumber,
      previousStatus: null,
      newStatus: 'Posted',
      action: 'Created and posted',
      userId: context.userId,
      userName: context.userName,
      createdAt: serverTimestamp(),
    });
    const result = { documentId: documentRef.id, documentNumber, status: 'Posted' };
    transaction.set(requestRef, {
      ...result,
      organizationId: context.organizationId,
      createdAt: serverTimestamp(),
    });
    return result;
  });
}

async function buildPack(context: ClientInventoryContext, payload: Record<string, unknown>) {
  const clientRequestId = String(payload.clientRequestId || '');
  const transactionDate = String(payload.transactionDate || '');
  const locationId = String(payload.locationId || '');
  const mainItemId = String(payload.mainItemId || '');
  const buildQuantity = Number(payload.buildQuantity);
  if (clientRequestId.length < 8 || clientRequestId.length > 200) throw new Error('Pack build request ID is invalid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) throw new Error('Pack build date is invalid.');
  if (!locationId || !mainItemId) throw new Error('Location and main item are required.');
  if (!Number.isInteger(buildQuantity) || buildQuantity <= 0 || buildQuantity > 1000000) {
    throw new Error('Build quantity must be a positive whole number.');
  }
  requireInventoryPermission(context, 'Build Pack');

  const documentRef = doc(collection(db, INVENTORY_COLLECTIONS.documents));
  const requestRef = doc(
    db,
    INVENTORY_COLLECTIONS.idempotency,
    `${safeKey(context.organizationId)}_${safeKey(clientRequestId)}`,
  );
  const locationRef = doc(db, INVENTORY_COLLECTIONS.locations, locationId);
  const mainItemRef = doc(db, INVENTORY_COLLECTIONS.items, mainItemId);
  const mainBalanceRef = doc(
    db,
    INVENTORY_COLLECTIONS.balances,
    inventoryBalanceId(context.organizationId, locationId, mainItemId),
  );

  return runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists()) return { ...requestSnapshot.data(), duplicate: true };
    const locationSnapshot = await transaction.get(locationRef);
    if (!locationSnapshot.exists()) throw new Error('Inventory location not found.');
    const location = locationSnapshot.data();
    assertLocationAccess(context, location);
    const mainItemSnapshot = await transaction.get(mainItemRef);
    const mainBalanceSnapshot = await transaction.get(mainBalanceRef);
    if (!mainItemSnapshot.exists() || mainItemSnapshot.data()?.active === false) {
      throw new Error('The selected main item is missing or inactive.');
    }
    const mainItem = mainItemSnapshot.data()!;
    if (String(mainItem.organizationId || 'default') !== context.organizationId) {
      throw new Error('The main item is outside your organization.');
    }
    if (mainItem.classification === 'Non-inventory') throw new Error('The main item is classified as non-inventory.');
    if (mainItem.serialTracking || mainItem.batchTracking || mainItem.expiryTracking) {
      throw new Error('Tracked main items require serial/batch capture and cannot currently be built as a pack.');
    }
    const packList = (Array.isArray(mainItem.packList) ? mainItem.packList : []) as InventoryPackComponent[];
    if (!packList.length) throw new Error('The selected main item does not have a pack list.');
    if (new Set(packList.map((component) => String(component.itemId || ''))).size !== packList.length) {
      throw new Error('The main item pack list contains duplicate sub-items.');
    }
    if (packList.some((component) => component.itemId === mainItemId)) {
      throw new Error('The main item cannot contain itself as a sub-item.');
    }

    const requirements = packBuildRequirements(packList, buildQuantity);
    const componentItemSnapshots: DocumentSnapshot<DocumentData>[] = [];
    const componentBalanceSnapshots: DocumentSnapshot<DocumentData>[] = [];
    const componentBalanceRefs = requirements.map((component) => doc(
      db,
      INVENTORY_COLLECTIONS.balances,
      inventoryBalanceId(context.organizationId, locationId, component.itemId),
    ));
    for (const component of requirements) {
      componentItemSnapshots.push(await transaction.get(doc(db, INVENTORY_COLLECTIONS.items, component.itemId)));
    }
    for (const balanceRef of componentBalanceRefs) {
      componentBalanceSnapshots.push(await transaction.get(balanceRef));
    }
    const documentNumber = await nextDocumentNumber(
      transaction,
      context.organizationId,
      'Pack Assembly',
      transactionDate,
    );
    const componentLines: InventoryDocumentLine[] = [];
    let totalComponentValue = 0;

    requirements.forEach((requirement, index) => {
      const itemSnapshot = componentItemSnapshots[index];
      if (!itemSnapshot.exists() || itemSnapshot.data()?.active === false) {
        throw new Error('One of the pack sub-items is missing or inactive.');
      }
      const item = itemSnapshot.data()!;
      if (String(item.organizationId || 'default') !== context.organizationId) {
        throw new Error('A pack sub-item is outside your organization.');
      }
      if (item.classification === 'Non-inventory') throw new Error(`${item.itemName} is classified as non-inventory.`);
      if (item.serialTracking || item.batchTracking || item.expiryTracking) {
        throw new Error(`${item.itemName} uses serial, batch, or expiry tracking and requires tracked assembly input.`);
      }
      const balanceSnapshot = componentBalanceSnapshots[index];
      const current = balanceSnapshot.exists()
        ? balanceSnapshot.data()!
        : emptyBalance(context.organizationId, locationId, requirement.itemId);
      const currentOnHand = Number(current.onHandQuantity || 0);
      const reserved = Number(current.reservedQuantity || 0);
      const available = currentOnHand - reserved;
      const requiredQuantity = Number(requirement.requiredQuantity || 0);
      if (requiredQuantity <= 0) throw new Error(`${item.itemName} has an invalid pack quantity.`);
      if (requiredQuantity > available) {
        throw new Error(`${item.itemName}: required ${requiredQuantity}, available ${Math.max(0, available)}.`);
      }
      const rate = Number(current.averageCost || item.costRate || 0);
      const nextOnHand = currentOnHand - requiredQuantity;
      totalComponentValue += requiredQuantity * rate;
      transaction.set(componentBalanceRefs[index], {
        ...current,
        organizationId: context.organizationId,
        itemId: requirement.itemId,
        locationId,
        assemblyOut: Number(current.assemblyOut || 0) + requiredQuantity,
        onHandQuantity: nextOnHand,
        availableQuantity: nextOnHand - reserved,
        inventoryValue: nextOnHand * rate,
        version: Number(current.version || 0) + 1,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      const lineId = `C${index + 1}`;
      componentLines.push({
        id: lineId,
        itemId: itemSnapshot.id,
        itemCode: String(item.itemCode || ''),
        itemName: String(item.itemName || ''),
        description: String(item.description || ''),
        unit: String(item.unit || ''),
        quantity: requiredQuantity,
        unitCost: rate,
        lineRole: 'Component',
        parentPackItemId: mainItemId,
        parentPackItemCode: String(mainItem.itemCode || ''),
        parentPackItemName: String(mainItem.itemName || ''),
        packQuantity: buildQuantity,
        componentQuantityPerPack: Number(requirement.quantity || 0),
      });
      transaction.set(doc(db, INVENTORY_COLLECTIONS.ledger, `${documentRef.id}_${lineId}`), clean({
        organizationId: context.organizationId,
        transactionDate,
        documentId: documentRef.id,
        documentNumber,
        transactionType: 'Pack Assembly',
        status: 'Posted',
        itemId: itemSnapshot.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        locationId,
        locationName: location.locationName,
        sourceLocationId: locationId,
        quantityIn: 0,
        quantityOut: requiredQuantity,
        unit: item.unit,
        costRate: rate,
        totalValue: requiredQuantity * rate,
        balanceAfter: nextOnHand,
        projectId: location.projectId,
        propertyId: location.propertyId,
        referenceDocument: payload.referenceDocument,
        remarks: payload.remarks || `Used to build ${buildQuantity} ${mainItem.unit || ''} of ${mainItem.itemName}`,
        parentPackItemId: mainItemId,
        packQuantity: buildQuantity,
        createdBy: context.userId,
        postedBy: context.userId,
        postingDate: serverTimestamp(),
      }));
    });

    const currentMainBalance = mainBalanceSnapshot.exists()
      ? mainBalanceSnapshot.data()!
      : emptyBalance(context.organizationId, locationId, mainItemId);
    const currentMainOnHand = Number(currentMainBalance.onHandQuantity || 0);
    const currentMainReserved = Number(currentMainBalance.reservedQuantity || 0);
    const currentMainAverage = Number(currentMainBalance.averageCost || mainItem.costRate || 0);
    const buildUnitCost = totalComponentValue / buildQuantity;
    const nextMainOnHand = currentMainOnHand + buildQuantity;
    const nextMainAverage = movingWeightedAverage(
      currentMainOnHand,
      currentMainAverage,
      buildQuantity,
      buildUnitCost,
    );
    transaction.set(mainBalanceRef, {
      ...currentMainBalance,
      organizationId: context.organizationId,
      itemId: mainItemId,
      locationId,
      assemblyIn: Number(currentMainBalance.assemblyIn || 0) + buildQuantity,
      onHandQuantity: nextMainOnHand,
      availableQuantity: nextMainOnHand - currentMainReserved,
      averageCost: nextMainAverage,
      inventoryValue: nextMainOnHand * nextMainAverage,
      version: Number(currentMainBalance.version || 0) + 1,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    const outputLine: InventoryDocumentLine = {
      id: 'OUT',
      itemId: mainItemId,
      itemCode: String(mainItem.itemCode || ''),
      itemName: String(mainItem.itemName || ''),
      description: String(mainItem.description || ''),
      unit: String(mainItem.unit || ''),
      quantity: buildQuantity,
      unitCost: buildUnitCost,
      lineRole: 'Output',
      packQuantity: buildQuantity,
    };
    transaction.set(doc(db, INVENTORY_COLLECTIONS.ledger, `${documentRef.id}_OUT`), clean({
      organizationId: context.organizationId,
      transactionDate,
      documentId: documentRef.id,
      documentNumber,
      transactionType: 'Pack Assembly',
      status: 'Posted',
      itemId: mainItemId,
      itemCode: mainItem.itemCode,
      itemName: mainItem.itemName,
      locationId,
      locationName: location.locationName,
      destinationLocationId: locationId,
      quantityIn: buildQuantity,
      quantityOut: 0,
      unit: mainItem.unit,
      costRate: buildUnitCost,
      totalValue: totalComponentValue,
      balanceAfter: nextMainOnHand,
      projectId: location.projectId,
      propertyId: location.propertyId,
      referenceDocument: payload.referenceDocument,
      remarks: payload.remarks || 'Pack assembly output',
      packQuantity: buildQuantity,
      createdBy: context.userId,
      postedBy: context.userId,
      postingDate: serverTimestamp(),
    }));
    transaction.set(documentRef, clean({
      organizationId: context.organizationId,
      documentNumber,
      documentType: 'Pack Assembly',
      transactionDate,
      status: 'Posted',
      sourceLocationId: locationId,
      sourceLocationName: location.locationName,
      destinationLocationId: locationId,
      destinationLocationName: location.locationName,
      projectId: location.projectId,
      projectName: location.projectName,
      propertyId: location.propertyId,
      propertyName: location.propertyName,
      referenceDocument: payload.referenceDocument,
      remarks: payload.remarks,
      mainItemId,
      mainItemCode: mainItem.itemCode,
      mainItemName: mainItem.itemName,
      buildQuantity,
      lines: [outputLine, ...componentLines],
      createdBy: context.userId,
      createdByName: context.userName,
      postedBy: context.userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      postedAt: serverTimestamp(),
    }));
    transaction.set(doc(collection(db, INVENTORY_COLLECTIONS.approvals)), {
      organizationId: context.organizationId,
      documentId: documentRef.id,
      documentNumber,
      previousStatus: null,
      newStatus: 'Posted',
      action: 'Pack built and posted',
      userId: context.userId,
      userName: context.userName,
      createdAt: serverTimestamp(),
    });
    const result = {
      documentId: documentRef.id,
      documentNumber,
      status: 'Posted',
      buildQuantity,
      componentCount: componentLines.length,
      unitCost: buildUnitCost,
      totalValue: totalComponentValue,
    };
    transaction.set(requestRef, {
      ...result,
      organizationId: context.organizationId,
      createdAt: serverTimestamp(),
    });
    return result;
  });
}

export async function runLocalInventorySetupCommand(payload: Record<string, unknown>) {
  const context = await loadContext();
  switch (payload.action) {
    case 'saveLocation':
      return saveLocation(context, payload.location);
    case 'saveItem':
      return saveItem(context, payload.item);
    case 'setInventoryScopeStatus':
      return setInventoryScopeStatus(context, payload);
    case 'postMovement':
      return postMovement(context, payload);
    case 'buildPack':
      return buildPack(context, payload);
    default:
      throw new Error('Firebase Admin credentials are required to post inventory transactions locally.');
  }
}
