import { NextResponse } from 'next/server';
import { FieldValue, type DocumentData, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
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
  type InventoryLocationType,
} from '@/lib/inventory';

export const runtime = 'nodejs';

const db = () => getFirebaseAdminFirestore();
const positive = z.coerce.number().finite().positive();
const nonNegative = z.coerce.number().finite().min(0);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const lineSchema = z.object({
  id: z.string().min(1).optional(),
  itemId: z.string().min(1),
  quantity: positive,
  unitCost: nonNegative.optional(),
  batchNumber: z.string().max(120).optional(),
  serialNumbers: z.array(z.string().min(1).max(120)).max(250).optional(),
  manufactureDate: dateOnly.optional(),
  expiryDate: dateOnly.optional(),
  condition: z.enum(['Good', 'Used but Reusable', 'Damaged', 'Scrap']).optional(),
  remarks: z.string().max(1000).optional(),
  boqItemId: z.string().max(200).optional(),
});

const itemPayloadSchema = z.object({
  id: z.string().optional(),
  itemCode: z.string().trim().min(1).max(80),
  itemName: z.string().trim().min(1).max(240),
  description: z.string().max(2000).optional(),
  category: z.string().max(120).optional(),
  subcategory: z.string().max(120).optional(),
  brand: z.string().max(120).optional(),
  unit: z.string().trim().min(1).max(40),
  secondaryUnit: z.string().max(40).optional(),
  conversionFactor: positive.optional(),
  barcode: z.string().max(120).optional(),
  qrCode: z.string().max(500).optional(),
  partNumber: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  minimumStockLevel: nonNegative.default(0),
  reorderLevel: nonNegative.default(0),
  maximumStockLevel: nonNegative.optional(),
  costRate: nonNegative.default(0),
  lastPurchaseRate: nonNegative.optional(),
  standardRate: nonNegative.optional(),
  preferredSupplierId: z.string().max(200).optional(),
  preferredSupplierName: z.string().max(240).optional(),
  taxCode: z.string().max(80).optional(),
  taxRate: z.coerce.number().finite().min(0).max(100).optional(),
  active: z.boolean().default(true),
  classification: z.enum(['Inventory', 'Non-inventory']).default('Inventory'),
  serialTracking: z.boolean().default(false),
  batchTracking: z.boolean().default(false),
  expiryTracking: z.boolean().default(false),
  attachmentUrl: z.string().url().optional().or(z.literal('')),
  notes: z.string().max(2000).optional(),
  legacyBoqItemId: z.string().max(200).optional(),
  packList: z.array(z.object({
    itemId: z.string().min(1).max(200),
    quantity: positive,
  })).max(100).optional().default([]),
});

const locationTypes: [InventoryLocationType, ...InventoryLocationType[]] = [
  'Central Warehouse',
  'Property Store',
  'Project Store',
  'Transit',
  'Quarantine',
  'Scrap',
];

const locationPayloadSchema = z.object({
  id: z.string().optional(),
  locationCode: z.string().trim().min(1).max(80),
  locationName: z.string().trim().min(1).max(240),
  type: z.enum(locationTypes),
  propertyId: z.string().max(200).optional(),
  propertyName: z.string().max(240).optional(),
  projectId: z.string().max(200).optional(),
  projectName: z.string().max(240).optional(),
  parentLocationId: z.string().max(200).optional(),
  binOrRack: z.string().max(120).optional(),
  address: z.string().max(500).optional(),
  allowedUserIds: z.array(z.string().min(1)).max(500).optional(),
  active: z.boolean().default(true),
}).superRefine((value, context) => {
  if (value.type === 'Project Store' && !value.projectId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['projectId'], message: 'A project store must be linked to a project.' });
  }
});

const movementTypes = [
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
] as const;

const movementSchema = z.object({
  action: z.literal('postMovement'),
  clientRequestId: z.string().min(8).max(200),
  documentType: z.enum(movementTypes),
  transactionDate: dateOnly,
  sourceLocationId: z.string().optional(),
  destinationLocationId: z.string().optional(),
  supplierId: z.string().optional(),
  supplierName: z.string().max(240).optional(),
  departmentId: z.string().optional(),
  departmentName: z.string().max(240).optional(),
  requesterId: z.string().optional(),
  requesterName: z.string().max(240).optional(),
  issuedTo: z.string().max(240).optional(),
  referenceDocument: z.string().max(240).optional(),
  purpose: z.string().max(500).optional(),
  remarks: z.string().max(2000).optional(),
  lines: z.array(lineSchema).min(1).max(50),
}).superRefine((value, context) => {
  if (INBOUND_DOCUMENT_TYPES.includes(value.documentType) && !value.destinationLocationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['destinationLocationId'], message: 'Destination location is required.' });
  }
  if (OUTBOUND_DOCUMENT_TYPES.includes(value.documentType) && !value.sourceLocationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceLocationId'], message: 'Source location is required.' });
  }
});

const transferCreateSchema = z.object({
  action: z.literal('createTransfer'),
  clientRequestId: z.string().min(8).max(200),
  transactionDate: dateOnly,
  sourceLocationId: z.string().min(1),
  destinationLocationId: z.string().min(1),
  requesterId: z.string().optional(),
  requesterName: z.string().max(240).optional(),
  referenceDocument: z.string().max(240).optional(),
  vehicleDetails: z.string().max(500).optional(),
  remarks: z.string().max(2000).optional(),
  lines: z.array(lineSchema).min(1).max(50),
}).refine((value) => value.sourceLocationId !== value.destinationLocationId, {
  path: ['destinationLocationId'],
  message: 'Source and destination locations must be different.',
});

const transferTransitionSchema = z.object({
  action: z.literal('transitionTransfer'),
  clientRequestId: z.string().min(8).max(200),
  documentId: z.string().min(1),
  transition: z.enum(['submit', 'approve', 'dispatch', 'receive', 'cancel']),
  lines: z.array(z.object({
    id: z.string().min(1),
    quantity: nonNegative,
    rejectedQuantity: nonNegative.optional(),
    damagedQuantity: nonNegative.optional(),
  })).max(50).optional(),
  remarks: z.string().max(2000).optional(),
});

const createCountSchema = z.object({
  action: z.literal('createStockCount'),
  clientRequestId: z.string().min(8).max(200),
  locationId: z.string().min(1),
  countDate: dateOnly,
});

const submitCountSchema = z.object({
  action: z.literal('submitStockCount'),
  clientRequestId: z.string().min(8).max(200),
  countId: z.string().min(1),
  lines: z.array(z.object({
    id: z.string().min(1),
    physicalQuantity: nonNegative,
    varianceReason: z.string().max(1000).optional(),
  })).min(1).max(250),
});

const postCountSchema = z.object({
  action: z.literal('postStockCount'),
  clientRequestId: z.string().min(8).max(200),
  countId: z.string().min(1),
});

const buildPackSchema = z.object({
  action: z.literal('buildPack'),
  clientRequestId: z.string().min(8).max(200),
  transactionDate: dateOnly,
  locationId: z.string().min(1),
  mainItemId: z.string().min(1),
  buildQuantity: z.coerce.number().int().positive().max(1000000),
  referenceDocument: z.string().max(240).optional(),
  remarks: z.string().max(2000).optional(),
});

const unbuildPackSchema = z.object({
  action: z.literal('unbuildPack'),
  clientRequestId: z.string().min(8).max(200),
  transactionDate: dateOnly,
  locationId: z.string().min(1),
  mainItemId: z.string().min(1),
  unbuildQuantity: z.coerce.number().int().positive().max(1000000),
  referenceDocument: z.string().max(240).optional(),
  remarks: z.string().max(2000).optional(),
});

const scopeStatusSchema = z.object({
  action: z.literal('setInventoryScopeStatus'),
  scope: z.enum(['Project', 'Property']),
  entityId: z.string().min(1),
  enabled: z.boolean(),
});

const requestSchema = z.union([
  z.object({ action: z.literal('saveItem'), item: itemPayloadSchema }),
  z.object({ action: z.literal('saveLocation'), location: locationPayloadSchema }),
  movementSchema,
  transferCreateSchema,
  transferTransitionSchema,
  createCountSchema,
  submitCountSchema,
  postCountSchema,
  buildPackSchema,
  unbuildPackSchema,
  scopeStatusSchema,
]);

interface RequestContext {
  uid: string;
  userId: string;
  userName: string;
  organizationId: string;
  permissions: Record<string, unknown>;
}

class InventoryApiError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function isFirebaseAdminCredentialError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (
      message.includes('Could not load the default credentials')
      || message.includes('DefaultCredentialsError')
      || message.includes('FIREBASE_PRIVATE_KEY')
    ) {
      return true;
    }
    current = typeof current === 'object' && current !== null && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return false;
}

function firebaseAuthErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { code?: unknown; errorInfo?: { code?: unknown } };
  const code = candidate.errorInfo?.code || candidate.code;
  return typeof code === 'string' && code.startsWith('auth/') ? code : '';
}

const clean = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ''));

const safeKey = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

async function authenticate(request: Request): Promise<RequestContext> {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) throw new InventoryApiError('Authentication required.', 401);

  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  const firestore = db();
  let userSnapshot = await firestore.collection('users').doc(decoded.uid).get();
  if (!userSnapshot.exists && decoded.email) {
    const byEmail = await firestore.collection('users').where('email', '==', decoded.email.toLowerCase()).limit(1).get();
    if (!byEmail.empty) userSnapshot = byEmail.docs[0];
  }
  if (!userSnapshot.exists) throw new InventoryApiError('The signed-in user is not registered.', 403);
  const user = userSnapshot.data() || {};
  if (user.status === 'Inactive') throw new InventoryApiError('This user account is inactive.', 403);

  const roleName = String(user.role || '');
  const roleSnapshot = await firestore.collection('roles').where('name', '==', roleName).limit(1).get();
  const permissions = (roleSnapshot.docs[0]?.data()?.permissions || {}) as Record<string, unknown>;
  return {
    uid: decoded.uid,
    userId: userSnapshot.id,
    userName: String(user.name || decoded.name || decoded.email || 'User'),
    organizationId: String(user.organizationId || 'default'),
    permissions,
  };
}

function permissionList(context: RequestContext, resource: 'Inventory' | 'Settings') {
  const modulePermissions = context.permissions['Store & Stock Management'] as Record<string, unknown> | undefined;
  const nested = modulePermissions?.[resource];
  const direct = context.permissions[`Store & Stock Management.${resource}`];
  return [nested, direct].find(Array.isArray) as string[] | undefined;
}

function hasLegacyTransactionAccess(context: RequestContext) {
  const modulePermissions = context.permissions['Store & Stock Management'] as Record<string, unknown> | undefined;
  const projects = modulePermissions?.Projects;
  const direct = context.permissions['Store & Stock Management.Projects'];
  const list = ([projects, direct].find(Array.isArray) || []) as string[];
  return list.includes('View Transactions');
}

function requirePermission(context: RequestContext, action: string, options?: { settings?: boolean; legacyTransaction?: boolean }) {
  const list = permissionList(context, options?.settings ? 'Settings' : 'Inventory') || [];
  const allowed = list.includes(action)
    || list.includes('Manage All')
    || (action === 'Unbuild Pack' && list.includes('Build Pack'))
    || (options?.settings && list.includes('Edit'))
    || (options?.legacyTransaction && hasLegacyTransactionAccess(context));
  if (!allowed) throw new InventoryApiError(`${action} permission is required.`, 403);
}

function assertLocationAccess(context: RequestContext, location: DocumentData) {
  if (String(location.organizationId || 'default') !== context.organizationId) {
    throw new InventoryApiError('The inventory location is outside your organization.', 403);
  }
  const allowed = Array.isArray(location.allowedUserIds) ? location.allowedUserIds : [];
  if (allowed.length > 0 && !allowed.includes(context.userId)) {
    throw new InventoryApiError(`You do not have access to ${location.locationName || 'this inventory location'}.`, 403);
  }
  if (location.active === false) throw new InventoryApiError('The selected inventory location is inactive.');
}

function itemDocumentId(organizationId: string, itemCode: string) {
  return `${safeKey(organizationId)}__${safeKey(itemCode.toUpperCase())}`;
}

function locationDocumentId(organizationId: string, locationCode: string) {
  return `${safeKey(organizationId)}__${safeKey(locationCode.toUpperCase())}`;
}

async function nextDocumentNumber(
  transaction: Transaction,
  organizationId: string,
  documentType: InventoryDocumentType,
  transactionDate: string,
) {
  const year = transactionDate.slice(0, 4);
  const prefix = DOCUMENT_PREFIX[documentType];
  const sequenceRef = db().collection(INVENTORY_COLLECTIONS.sequences).doc(`${safeKey(organizationId)}_${prefix}_${year}`);
  const sequenceSnapshot = await transaction.get(sequenceRef);
  const next = Number(sequenceSnapshot.data()?.nextNumber || 1);
  transaction.set(sequenceRef, {
    organizationId,
    prefix,
    year,
    nextNumber: next + 1,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return `${prefix}-${year}-${String(next).padStart(5, '0')}`;
}

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
  };
}

function movementCounter(documentType: InventoryDocumentType, inbound: boolean) {
  if (documentType === 'Opening Stock') return 'openingQuantity';
  if (documentType === 'Goods Receipt') return 'quantityReceived';
  if (documentType === 'Store Return') return inbound ? 'quantityReturnedIn' : 'quantityReturnedOut';
  if (documentType === 'Stock Transfer') return inbound ? 'quantityTransferredIn' : 'quantityTransferredOut';
  if (documentType.includes('Adjustment') || ['Damaged Stock', 'Lost Stock', 'Write-Off', 'Physical Count'].includes(documentType)) {
    return inbound ? 'adjustmentIn' : 'adjustmentOut';
  }
  return 'quantityIssued';
}

function validateTracking(item: DocumentData, line: z.infer<typeof lineSchema>) {
  if (item.serialTracking && (line.serialNumbers?.length || 0) !== line.quantity) {
    throw new InventoryApiError(`${item.itemName}: enter one serial number for each unit.`);
  }
  if (item.batchTracking && !line.batchNumber) {
    throw new InventoryApiError(`${item.itemName}: batch/lot number is required.`);
  }
  if (item.expiryTracking && !line.expiryDate) {
    throw new InventoryApiError(`${item.itemName}: expiry date is required.`);
  }
}

function idempotencyRef(context: RequestContext, requestId: string) {
  return db().collection(INVENTORY_COLLECTIONS.idempotency).doc(`${safeKey(context.organizationId)}_${safeKey(requestId)}`);
}

async function saveItem(context: RequestContext, payload: z.infer<typeof itemPayloadSchema>) {
  requirePermission(context, payload.id ? 'Edit Item' : 'Create Item', { settings: true });
  const firestore = db();
  const normalizedCode = payload.itemCode.toUpperCase();
  const targetId = payload.id || itemDocumentId(context.organizationId, normalizedCode);
  const targetRef = firestore.collection(INVENTORY_COLLECTIONS.items).doc(targetId);

  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(targetRef);
    if (!payload.id && existing.exists) throw new InventoryApiError(`Item code ${normalizedCode} already exists.`, 409);
    if (payload.id && !existing.exists) throw new InventoryApiError('Inventory item not found.', 404);
    if (payload.id && existing.data()?.itemCode !== normalizedCode) {
      throw new InventoryApiError('Item code cannot be changed after creation.');
    }
    const packList = payload.packList || [];
    if (payload.classification === 'Non-inventory' && packList.length > 0) {
      throw new InventoryApiError('A non-inventory item cannot have a pack list.');
    }
    if (new Set(packList.map((component) => component.itemId)).size !== packList.length) {
      throw new InventoryApiError('Each sub-item can appear only once in a pack list.');
    }
    if (packList.some((component) => component.itemId === targetId)) {
      throw new InventoryApiError('An item cannot contain itself in its pack list.');
    }
    const componentRefs = packList.map((component) => firestore.collection(INVENTORY_COLLECTIONS.items).doc(component.itemId));
    const componentSnapshots = componentRefs.length ? await transaction.getAll(...componentRefs) : [];
    const normalizedPackList = packList.map((component, index) => {
      const componentSnapshot = componentSnapshots[index];
      if (!componentSnapshot?.exists || componentSnapshot.data()?.active === false) {
        throw new InventoryApiError('One of the selected pack sub-items is missing or inactive.');
      }
      const componentItem = componentSnapshot.data()!;
      if (String(componentItem.organizationId || 'default') !== context.organizationId) {
        throw new InventoryApiError('A pack sub-item is outside your organization.', 403);
      }
      if (componentItem.classification === 'Non-inventory') {
        throw new InventoryApiError(`${componentItem.itemName} is classified as non-inventory.`);
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
      ...payload,
      id: undefined,
      organizationId: context.organizationId,
      itemCode: normalizedCode,
      packList: normalizedPackList,
      updatedBy: context.userId,
      updatedAt: FieldValue.serverTimestamp(),
      ...(!existing.exists ? { createdBy: context.userId, createdAt: FieldValue.serverTimestamp() } : {}),
    }), { merge: true });
  });
  return { id: targetId, itemCode: normalizedCode };
}

async function saveLocation(context: RequestContext, payload: z.infer<typeof locationPayloadSchema>) {
  requirePermission(context, payload.id ? 'Edit Location' : 'Create Location', { settings: true });
  const firestore = db();
  const normalizedCode = payload.locationCode.toUpperCase();
  const targetId = payload.id || locationDocumentId(context.organizationId, normalizedCode);
  const targetRef = firestore.collection(INVENTORY_COLLECTIONS.locations).doc(targetId);

  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(targetRef);
    if (!payload.id && existing.exists) throw new InventoryApiError(`Location code ${normalizedCode} already exists.`, 409);
    if (payload.id && !existing.exists) throw new InventoryApiError('Inventory location not found.', 404);
    if (payload.id && existing.data()?.locationCode !== normalizedCode) {
      throw new InventoryApiError('Location code cannot be changed after creation.');
    }
    transaction.set(targetRef, clean({
      ...payload,
      id: undefined,
      organizationId: context.organizationId,
      locationCode: normalizedCode,
      updatedBy: context.userId,
      updatedAt: FieldValue.serverTimestamp(),
      ...(!existing.exists ? { createdBy: context.userId, createdAt: FieldValue.serverTimestamp() } : {}),
    }), { merge: true });
  });
  return { id: targetId, locationCode: normalizedCode };
}

async function setInventoryScopeStatus(context: RequestContext, payload: z.infer<typeof scopeStatusSchema>) {
  requirePermission(context, payload.scope === 'Project' ? 'Manage Projects' : 'Manage Properties', { settings: true });
  const firestore = db();
  if (payload.scope === 'Project') {
    const projectRef = firestore.collection('projects').doc(payload.entityId);
    await firestore.runTransaction(async (transaction) => {
      const projectSnapshot = await transaction.get(projectRef);
      if (!projectSnapshot.exists) throw new InventoryApiError('Project not found.', 404);
      transaction.update(projectRef, {
        stockManagementRequired: payload.enabled,
        stockManagementUpdatedBy: context.userId,
        stockManagementUpdatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { scope: payload.scope, entityId: payload.entityId, enabled: payload.enabled };
  }

  // The application currently keeps its Property Master records in insuredAssets.
  // Inventory remains separate: the property is only used as the owner of a default
  // Property Store location and no insurance fields participate in stock calculations.
  const propertyRef = firestore.collection('insuredAssets').doc(payload.entityId);
  const locationCode = `PROP-${safeKey(payload.entityId).slice(0, 16).toUpperCase()}`;
  const locationRef = firestore.collection(INVENTORY_COLLECTIONS.locations)
    .doc(locationDocumentId(context.organizationId, locationCode));

  await firestore.runTransaction(async (transaction) => {
    const [propertySnapshot, locationSnapshot] = await Promise.all([
      transaction.get(propertyRef),
      transaction.get(locationRef),
    ]);
    if (!propertySnapshot.exists || propertySnapshot.data()?.type !== 'Property') {
      throw new InventoryApiError('Property not found.', 404);
    }
    if (!payload.enabled && locationSnapshot.exists) {
      const balances = await transaction.get(firestore.collection(INVENTORY_COLLECTIONS.balances)
        .where('organizationId', '==', context.organizationId)
        .where('locationId', '==', locationRef.id));
      const onHand = balances.docs.reduce((sum, balance) => sum + Number(balance.data().onHandQuantity || 0), 0);
      if (Math.abs(onHand) > 0.000001) {
        throw new InventoryApiError('This property still has stock. Transfer or adjust it to zero before disabling inventory.');
      }
    }
    const property = propertySnapshot.data()!;
    transaction.update(propertyRef, {
      inventoryManagementRequired: payload.enabled,
      inventoryManagementUpdatedBy: context.userId,
      inventoryManagementUpdatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(locationRef, {
      organizationId: context.organizationId,
      locationCode,
      locationName: `${property.name || 'Property'} Main Store`,
      type: 'Property Store',
      propertyId: propertySnapshot.id,
      propertyName: property.name || 'Property',
      address: property.location || '',
      active: payload.enabled,
      updatedBy: context.userId,
      updatedAt: FieldValue.serverTimestamp(),
      ...(!locationSnapshot.exists ? { createdBy: context.userId, createdAt: FieldValue.serverTimestamp() } : {}),
    }, { merge: true });
  });
  return { scope: payload.scope, entityId: payload.entityId, locationId: locationRef.id, enabled: payload.enabled };
}

async function postMovement(context: RequestContext, payload: z.infer<typeof movementSchema>) {
  const permission = payload.documentType === 'Goods Receipt'
    ? 'Post Receipt'
    : payload.documentType.includes('Adjustment') || ['Opening Stock', 'Damaged Stock', 'Lost Stock', 'Write-Off'].includes(payload.documentType)
      ? 'Perform Stock Adjustment'
      : 'Post Issue';
  requirePermission(context, permission, { legacyTransaction: true });

  const firestore = db();
  const documentRef = firestore.collection(INVENTORY_COLLECTIONS.documents).doc();
  const requestRef = idempotencyRef(context, payload.clientRequestId);
  const isInbound = INBOUND_DOCUMENT_TYPES.includes(payload.documentType);
  const locationId = isInbound ? payload.destinationLocationId! : payload.sourceLocationId!;
  const locationRef = firestore.collection(INVENTORY_COLLECTIONS.locations).doc(locationId);
  const itemRefs = payload.lines.map((line) => firestore.collection(INVENTORY_COLLECTIONS.items).doc(line.itemId));
  const balanceRefs = payload.lines.map((line) => firestore.collection(INVENTORY_COLLECTIONS.balances).doc(inventoryBalanceId(context.organizationId, locationId, line.itemId)));
  const settingsRef = firestore.collection('storeStockSettings').doc('inventory');

  return firestore.runTransaction(async (transaction) => {
    const [requestSnapshot, locationSnapshot, settingsSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(locationRef),
      transaction.get(settingsRef),
    ]);
    if (requestSnapshot.exists) return { ...requestSnapshot.data(), duplicate: true };
    if (!locationSnapshot.exists) throw new InventoryApiError('Inventory location not found.', 404);
    assertLocationAccess(context, locationSnapshot.data()!);

    const itemSnapshots = await transaction.getAll(...itemRefs);
    const balanceSnapshots = await transaction.getAll(...balanceRefs);
    const documentNumber = await nextDocumentNumber(transaction, context.organizationId, payload.documentType, payload.transactionDate);
    const allowNegative = settingsSnapshot.data()?.allowNegativeInventory === true
      && (permissionList(context, 'Inventory') || []).includes('Allow Negative Inventory');

    const storedLines: InventoryDocumentLine[] = [];
    payload.lines.forEach((line, index) => {
      const itemSnapshot = itemSnapshots[index];
      if (!itemSnapshot.exists || itemSnapshot.data()?.active === false) throw new InventoryApiError('One of the selected inventory items is missing or inactive.');
      const item = itemSnapshot.data()!;
      if (String(item.organizationId || 'default') !== context.organizationId) throw new InventoryApiError('An item is outside your organization.', 403);
      if (item.classification === 'Non-inventory') throw new InventoryApiError(`${item.itemName} is classified as non-inventory.`);
      validateTracking(item, line);

      const balanceSnapshot = balanceSnapshots[index];
      const current = balanceSnapshot.exists ? balanceSnapshot.data()! : emptyBalance(context.organizationId, locationId, line.itemId);
      const currentOnHand = Number(current.onHandQuantity || 0);
      const reserved = Number(current.reservedQuantity || 0);
      const currentAverage = Number(current.averageCost || 0);
      if (!isInbound && !allowNegative && line.quantity > currentOnHand - reserved) {
        throw new InventoryApiError(`${item.itemName}: requested ${line.quantity}, available ${Math.max(0, currentOnHand - reserved)}.`);
      }

      const rate = isInbound
        ? Number(line.unitCost ?? currentAverage ?? item.costRate ?? 0)
        : Number(currentAverage || item.costRate || 0);
      const nextOnHand = currentOnHand + (isInbound ? line.quantity : -line.quantity);
      const nextAverage = isInbound
        ? movingWeightedAverage(currentOnHand, currentAverage, line.quantity, rate)
        : currentAverage;
      const counter = movementCounter(payload.documentType, isInbound);
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
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const lineId = line.id || `L${index + 1}`;
      const storedLine = clean({
        ...line,
        id: lineId,
        itemCode: String(item.itemCode || ''),
        itemName: String(item.itemName || ''),
        description: String(item.description || ''),
        unit: String(item.unit || ''),
        unitCost: rate,
      }) as unknown as InventoryDocumentLine;
      storedLines.push(storedLine);

      transaction.set(firestore.collection(INVENTORY_COLLECTIONS.ledger).doc(`${documentRef.id}_${lineId}`), clean({
        organizationId: context.organizationId,
        transactionDate: payload.transactionDate,
        documentId: documentRef.id,
        documentNumber,
        transactionType: payload.documentType,
        status: 'Posted',
        itemId: line.itemId,
        itemCode: item.itemCode,
        itemName: item.itemName,
        locationId,
        locationName: locationSnapshot.data()!.locationName,
        sourceLocationId: payload.sourceLocationId,
        destinationLocationId: payload.destinationLocationId,
        quantityIn: isInbound ? line.quantity : 0,
        quantityOut: isInbound ? 0 : line.quantity,
        unit: item.unit,
        costRate: rate,
        totalValue: line.quantity * rate,
        balanceAfter: nextOnHand,
        projectId: locationSnapshot.data()!.projectId,
        propertyId: locationSnapshot.data()!.propertyId,
        supplierId: payload.supplierId,
        departmentId: payload.departmentId,
        requesterId: payload.requesterId,
        referenceDocument: payload.referenceDocument,
        remarks: line.remarks || payload.remarks,
        batchNumber: line.batchNumber,
        serialNumbers: line.serialNumbers,
        createdBy: context.userId,
        postedBy: context.userId,
        postingDate: FieldValue.serverTimestamp(),
      }));
    });

    transaction.set(documentRef, clean({
      organizationId: context.organizationId,
      documentNumber,
      documentType: payload.documentType,
      transactionDate: payload.transactionDate,
      status: 'Posted',
      sourceLocationId: payload.sourceLocationId,
      sourceLocationName: !isInbound ? locationSnapshot.data()!.locationName : undefined,
      destinationLocationId: payload.destinationLocationId,
      destinationLocationName: isInbound ? locationSnapshot.data()!.locationName : undefined,
      projectId: locationSnapshot.data()!.projectId,
      projectName: locationSnapshot.data()!.projectName,
      propertyId: locationSnapshot.data()!.propertyId,
      propertyName: locationSnapshot.data()!.propertyName,
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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      postedAt: FieldValue.serverTimestamp(),
    }));
    transaction.set(firestore.collection(INVENTORY_COLLECTIONS.approvals).doc(), {
      organizationId: context.organizationId,
      documentId: documentRef.id,
      documentNumber,
      previousStatus: null,
      newStatus: 'Posted',
      action: 'Created and posted',
      userId: context.userId,
      userName: context.userName,
      createdAt: FieldValue.serverTimestamp(),
    });
    const result = { documentId: documentRef.id, documentNumber, status: 'Posted' };
    transaction.set(requestRef, { ...result, organizationId: context.organizationId, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}

async function buildPack(context: RequestContext, payload: z.infer<typeof buildPackSchema>) {
  requirePermission(context, 'Build Pack');
  const firestore = db();
  const documentRef = firestore.collection(INVENTORY_COLLECTIONS.documents).doc();
  const requestRef = idempotencyRef(context, payload.clientRequestId);
  const locationRef = firestore.collection(INVENTORY_COLLECTIONS.locations).doc(payload.locationId);
  const mainItemRef = firestore.collection(INVENTORY_COLLECTIONS.items).doc(payload.mainItemId);
  const mainBalanceRef = firestore.collection(INVENTORY_COLLECTIONS.balances)
    .doc(inventoryBalanceId(context.organizationId, payload.locationId, payload.mainItemId));

  return firestore.runTransaction(async (transaction) => {
    const [requestSnapshot, locationSnapshot, mainItemSnapshot, mainBalanceSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(locationRef),
      transaction.get(mainItemRef),
      transaction.get(mainBalanceRef),
    ]);
    if (requestSnapshot.exists) return { ...requestSnapshot.data(), duplicate: true };
    if (!locationSnapshot.exists) throw new InventoryApiError('Inventory location not found.', 404);
    assertLocationAccess(context, locationSnapshot.data()!);
    if (!mainItemSnapshot.exists || mainItemSnapshot.data()?.active === false) {
      throw new InventoryApiError('The selected main item is missing or inactive.', 404);
    }

    const mainItem = mainItemSnapshot.data()!;
    if (String(mainItem.organizationId || 'default') !== context.organizationId) {
      throw new InventoryApiError('The main item is outside your organization.', 403);
    }
    if (mainItem.classification === 'Non-inventory') {
      throw new InventoryApiError('The main item is classified as non-inventory.');
    }
    if (mainItem.serialTracking || mainItem.batchTracking || mainItem.expiryTracking) {
      throw new InventoryApiError('Tracked main items require serial/batch capture and cannot currently be built as a pack.');
    }
    const packList = Array.isArray(mainItem.packList) ? mainItem.packList : [];
    if (!packList.length) throw new InventoryApiError('The selected main item does not have a pack list.');
    if (new Set(packList.map((component) => String(component.itemId || ''))).size !== packList.length) {
      throw new InventoryApiError('The main item pack list contains duplicate sub-items.');
    }
    if (packList.some((component) => component.itemId === mainItemSnapshot.id)) {
      throw new InventoryApiError('The main item cannot contain itself as a sub-item.');
    }

    const requirements = packBuildRequirements(packList, payload.buildQuantity);
    const componentItemRefs = requirements.map((component) => firestore.collection(INVENTORY_COLLECTIONS.items).doc(component.itemId));
    const componentBalanceRefs = requirements.map((component) => firestore.collection(INVENTORY_COLLECTIONS.balances)
      .doc(inventoryBalanceId(context.organizationId, payload.locationId, component.itemId)));
    const componentItemSnapshots = await transaction.getAll(...componentItemRefs);
    const componentBalanceSnapshots = await transaction.getAll(...componentBalanceRefs);
    const documentNumber = await nextDocumentNumber(
      transaction,
      context.organizationId,
      'Pack Assembly',
      payload.transactionDate,
    );
    const location = locationSnapshot.data()!;
    const componentLines: InventoryDocumentLine[] = [];
    let totalComponentValue = 0;

    requirements.forEach((requirement, index) => {
      const itemSnapshot = componentItemSnapshots[index];
      if (!itemSnapshot.exists || itemSnapshot.data()?.active === false) {
        throw new InventoryApiError('One of the pack sub-items is missing or inactive.');
      }
      const item = itemSnapshot.data()!;
      if (String(item.organizationId || 'default') !== context.organizationId) {
        throw new InventoryApiError('A pack sub-item is outside your organization.', 403);
      }
      if (item.classification === 'Non-inventory') {
        throw new InventoryApiError(`${item.itemName} is classified as non-inventory.`);
      }
      if (item.serialTracking || item.batchTracking || item.expiryTracking) {
        throw new InventoryApiError(`${item.itemName} uses serial, batch, or expiry tracking and requires tracked assembly input.`);
      }

      const balanceSnapshot = componentBalanceSnapshots[index];
      const current = balanceSnapshot.exists
        ? balanceSnapshot.data()!
        : emptyBalance(context.organizationId, payload.locationId, requirement.itemId);
      const currentOnHand = Number(current.onHandQuantity || 0);
      const reserved = Number(current.reservedQuantity || 0);
      const available = currentOnHand - reserved;
      const requiredQuantity = Number(requirement.requiredQuantity || 0);
      if (requiredQuantity <= 0) throw new InventoryApiError(`${item.itemName} has an invalid pack quantity.`);
      if (requiredQuantity > available) {
        throw new InventoryApiError(`${item.itemName}: required ${requiredQuantity}, available ${Math.max(0, available)}.`);
      }
      const rate = Number(current.averageCost || item.costRate || 0);
      const nextOnHand = currentOnHand - requiredQuantity;
      totalComponentValue += requiredQuantity * rate;
      transaction.set(componentBalanceRefs[index], {
        ...current,
        organizationId: context.organizationId,
        itemId: requirement.itemId,
        locationId: payload.locationId,
        assemblyOut: Number(current.assemblyOut || 0) + requiredQuantity,
        onHandQuantity: nextOnHand,
        availableQuantity: nextOnHand - reserved,
        inventoryValue: nextOnHand * rate,
        version: Number(current.version || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
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
        parentPackItemId: mainItemSnapshot.id,
        parentPackItemCode: String(mainItem.itemCode || ''),
        parentPackItemName: String(mainItem.itemName || ''),
        packQuantity: payload.buildQuantity,
        componentQuantityPerPack: Number(requirement.quantity || 0),
      });
      transaction.set(firestore.collection(INVENTORY_COLLECTIONS.ledger).doc(`${documentRef.id}_${lineId}`), clean({
        organizationId: context.organizationId,
        transactionDate: payload.transactionDate,
        documentId: documentRef.id,
        documentNumber,
        transactionType: 'Pack Assembly',
        status: 'Posted',
        itemId: itemSnapshot.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        locationId: payload.locationId,
        locationName: location.locationName,
        sourceLocationId: payload.locationId,
        quantityIn: 0,
        quantityOut: requiredQuantity,
        unit: item.unit,
        costRate: rate,
        totalValue: requiredQuantity * rate,
        balanceAfter: nextOnHand,
        projectId: location.projectId,
        propertyId: location.propertyId,
        referenceDocument: payload.referenceDocument,
        remarks: payload.remarks || `Used to build ${payload.buildQuantity} ${mainItem.unit || ''} of ${mainItem.itemName}`,
        parentPackItemId: mainItemSnapshot.id,
        packQuantity: payload.buildQuantity,
        createdBy: context.userId,
        postedBy: context.userId,
        postingDate: FieldValue.serverTimestamp(),
      }));
    });

    const currentMainBalance = mainBalanceSnapshot.exists
      ? mainBalanceSnapshot.data()!
      : emptyBalance(context.organizationId, payload.locationId, mainItemSnapshot.id);
    const currentMainOnHand = Number(currentMainBalance.onHandQuantity || 0);
    const currentMainReserved = Number(currentMainBalance.reservedQuantity || 0);
    const currentMainAverage = Number(currentMainBalance.averageCost || mainItem.costRate || 0);
    const buildUnitCost = totalComponentValue / payload.buildQuantity;
    const nextMainOnHand = currentMainOnHand + payload.buildQuantity;
    const nextMainAverage = movingWeightedAverage(
      currentMainOnHand,
      currentMainAverage,
      payload.buildQuantity,
      buildUnitCost,
    );
    transaction.set(mainBalanceRef, {
      ...currentMainBalance,
      organizationId: context.organizationId,
      itemId: mainItemSnapshot.id,
      locationId: payload.locationId,
      assemblyIn: Number(currentMainBalance.assemblyIn || 0) + payload.buildQuantity,
      onHandQuantity: nextMainOnHand,
      availableQuantity: nextMainOnHand - currentMainReserved,
      averageCost: nextMainAverage,
      inventoryValue: nextMainOnHand * nextMainAverage,
      version: Number(currentMainBalance.version || 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const outputLine: InventoryDocumentLine = {
      id: 'OUT',
      itemId: mainItemSnapshot.id,
      itemCode: String(mainItem.itemCode || ''),
      itemName: String(mainItem.itemName || ''),
      description: String(mainItem.description || ''),
      unit: String(mainItem.unit || ''),
      quantity: payload.buildQuantity,
      unitCost: buildUnitCost,
      lineRole: 'Output',
      packQuantity: payload.buildQuantity,
    };
    transaction.set(firestore.collection(INVENTORY_COLLECTIONS.ledger).doc(`${documentRef.id}_OUT`), clean({
      organizationId: context.organizationId,
      transactionDate: payload.transactionDate,
      documentId: documentRef.id,
      documentNumber,
      transactionType: 'Pack Assembly',
      status: 'Posted',
      itemId: mainItemSnapshot.id,
      itemCode: mainItem.itemCode,
      itemName: mainItem.itemName,
      locationId: payload.locationId,
      locationName: location.locationName,
      destinationLocationId: payload.locationId,
      quantityIn: payload.buildQuantity,
      quantityOut: 0,
      unit: mainItem.unit,
      costRate: buildUnitCost,
      totalValue: totalComponentValue,
      balanceAfter: nextMainOnHand,
      projectId: location.projectId,
      propertyId: location.propertyId,
      referenceDocument: payload.referenceDocument,
      remarks: payload.remarks || 'Pack assembly output',
      packQuantity: payload.buildQuantity,
      createdBy: context.userId,
      postedBy: context.userId,
      postingDate: FieldValue.serverTimestamp(),
    }));

    transaction.set(documentRef, clean({
      organizationId: context.organizationId,
      documentNumber,
      documentType: 'Pack Assembly',
      transactionDate: payload.transactionDate,
      status: 'Posted',
      sourceLocationId: payload.locationId,
      sourceLocationName: location.locationName,
      destinationLocationId: payload.locationId,
      destinationLocationName: location.locationName,
      projectId: location.projectId,
      projectName: location.projectName,
      propertyId: location.propertyId,
      propertyName: location.propertyName,
      referenceDocument: payload.referenceDocument,
      remarks: payload.remarks,
      mainItemId: mainItemSnapshot.id,
      mainItemCode: mainItem.itemCode,
      mainItemName: mainItem.itemName,
      buildQuantity: payload.buildQuantity,
      lines: [outputLine, ...componentLines],
      createdBy: context.userId,
      createdByName: context.userName,
      postedBy: context.userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      postedAt: FieldValue.serverTimestamp(),
    }));
    transaction.set(firestore.collection(INVENTORY_COLLECTIONS.approvals).doc(), {
      organizationId: context.organizationId,
      documentId: documentRef.id,
      documentNumber,
      previousStatus: null,
      newStatus: 'Posted',
      action: 'Pack built and posted',
      userId: context.userId,
      userName: context.userName,
      createdAt: FieldValue.serverTimestamp(),
    });
    const result = {
      documentId: documentRef.id,
      documentNumber,
      status: 'Posted',
      buildQuantity: payload.buildQuantity,
      componentCount: componentLines.length,
      unitCost: buildUnitCost,
      totalValue: totalComponentValue,
    };
    transaction.set(requestRef, {
      ...result,
      organizationId: context.organizationId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

async function unbuildPack(context: RequestContext, payload: z.infer<typeof unbuildPackSchema>) {
  requirePermission(context, 'Unbuild Pack');
  const firestore = db();
  const documentRef = firestore.collection(INVENTORY_COLLECTIONS.documents).doc();
  const requestRef = idempotencyRef(context, payload.clientRequestId);
  const locationRef = firestore.collection(INVENTORY_COLLECTIONS.locations).doc(payload.locationId);
  const mainItemRef = firestore.collection(INVENTORY_COLLECTIONS.items).doc(payload.mainItemId);
  const mainBalanceRef = firestore.collection(INVENTORY_COLLECTIONS.balances)
    .doc(inventoryBalanceId(context.organizationId, payload.locationId, payload.mainItemId));

  return firestore.runTransaction(async (transaction) => {
    const [requestSnapshot, locationSnapshot, mainItemSnapshot, mainBalanceSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(locationRef),
      transaction.get(mainItemRef),
      transaction.get(mainBalanceRef),
    ]);
    if (requestSnapshot.exists) return { ...requestSnapshot.data(), duplicate: true };
    if (!locationSnapshot.exists) throw new InventoryApiError('Inventory location not found.', 404);
    assertLocationAccess(context, locationSnapshot.data()!);
    if (!mainItemSnapshot.exists || mainItemSnapshot.data()?.active === false) {
      throw new InventoryApiError('The selected main item is missing or inactive.', 404);
    }

    const location = locationSnapshot.data()!;
    const mainItem = mainItemSnapshot.data()!;
    if (String(mainItem.organizationId || 'default') !== context.organizationId) {
      throw new InventoryApiError('The main item is outside your organization.', 403);
    }
    if (mainItem.classification === 'Non-inventory') {
      throw new InventoryApiError('The main item is classified as non-inventory.');
    }
    if (mainItem.serialTracking || mainItem.batchTracking || mainItem.expiryTracking) {
      throw new InventoryApiError('Tracked main items require serial/batch capture and cannot currently be unbuilt.');
    }
    const packList = Array.isArray(mainItem.packList) ? mainItem.packList : [];
    if (!packList.length) throw new InventoryApiError('The selected main item does not have a pack list.');
    if (new Set(packList.map((component) => String(component.itemId || ''))).size !== packList.length) {
      throw new InventoryApiError('The main item pack list contains duplicate sub-items.');
    }
    if (packList.some((component) => component.itemId === mainItemSnapshot.id)) {
      throw new InventoryApiError('The main item cannot contain itself as a sub-item.');
    }

    const currentMainBalance = mainBalanceSnapshot.exists
      ? mainBalanceSnapshot.data()!
      : emptyBalance(context.organizationId, payload.locationId, payload.mainItemId);
    const currentMainOnHand = Number(currentMainBalance.onHandQuantity || 0);
    const currentMainReserved = Number(currentMainBalance.reservedQuantity || 0);
    if (payload.unbuildQuantity > currentMainOnHand - currentMainReserved) {
      throw new InventoryApiError(
        `${mainItem.itemName}: unbuild ${payload.unbuildQuantity}, available ${Math.max(0, currentMainOnHand - currentMainReserved)}.`,
      );
    }

    const requirements = packBuildRequirements(packList, payload.unbuildQuantity);
    const componentItemRefs = requirements.map((component) => firestore.collection(INVENTORY_COLLECTIONS.items).doc(component.itemId));
    const componentBalanceRefs = requirements.map((component) => firestore.collection(INVENTORY_COLLECTIONS.balances)
      .doc(inventoryBalanceId(context.organizationId, payload.locationId, component.itemId)));
    const componentItemSnapshots = await transaction.getAll(...componentItemRefs);
    const componentBalanceSnapshots = await transaction.getAll(...componentBalanceRefs);
    const documentNumber = await nextDocumentNumber(
      transaction,
      context.organizationId,
      'Pack Disassembly',
      payload.transactionDate,
    );
    const mainUnitCost = Number(currentMainBalance.averageCost || mainItem.costRate || 0);
    const totalRecoveredValue = mainUnitCost * payload.unbuildQuantity;
    const recoveryWeights = requirements.map((requirement, index) => {
      const componentItem = componentItemSnapshots[index].data() || {};
      const componentBalance = componentBalanceSnapshots[index].data() || {};
      const baseRate = Number(componentBalance.averageCost || componentItem.costRate || 0);
      return Number(requirement.requiredQuantity || 0) * baseRate;
    });
    const totalWeight = recoveryWeights.reduce((sum, weight) => sum + weight, 0);
    const totalRecoveredQuantity = requirements.reduce(
      (sum, requirement) => sum + Number(requirement.requiredQuantity || 0),
      0,
    );
    const componentLines: InventoryDocumentLine[] = [];

    requirements.forEach((requirement, index) => {
      const itemSnapshot = componentItemSnapshots[index];
      if (!itemSnapshot.exists || itemSnapshot.data()?.active === false) {
        throw new InventoryApiError('One of the pack sub-items is missing or inactive.');
      }
      const item = itemSnapshot.data()!;
      if (String(item.organizationId || 'default') !== context.organizationId) {
        throw new InventoryApiError('A pack sub-item is outside your organization.', 403);
      }
      if (item.classification === 'Non-inventory') {
        throw new InventoryApiError(`${item.itemName} is classified as non-inventory.`);
      }
      if (item.serialTracking || item.batchTracking || item.expiryTracking) {
        throw new InventoryApiError(`${item.itemName} uses serial, batch, or expiry tracking and requires tracked disassembly input.`);
      }

      const recoveredQuantity = Number(requirement.requiredQuantity || 0);
      if (recoveredQuantity <= 0) throw new InventoryApiError(`${item.itemName} has an invalid pack quantity.`);
      const balanceSnapshot = componentBalanceSnapshots[index];
      const current = balanceSnapshot.exists
        ? balanceSnapshot.data()!
        : emptyBalance(context.organizationId, payload.locationId, requirement.itemId);
      const currentOnHand = Number(current.onHandQuantity || 0);
      const currentReserved = Number(current.reservedQuantity || 0);
      const currentAverage = Number(current.averageCost || item.costRate || 0);
      const recoveredValue = totalWeight > 0
        ? totalRecoveredValue * (recoveryWeights[index] / totalWeight)
        : totalRecoveredQuantity > 0
          ? totalRecoveredValue * (recoveredQuantity / totalRecoveredQuantity)
          : 0;
      const recoveredRate = recoveredQuantity > 0 ? recoveredValue / recoveredQuantity : 0;
      const nextOnHand = currentOnHand + recoveredQuantity;
      const nextAverage = movingWeightedAverage(currentOnHand, currentAverage, recoveredQuantity, recoveredRate);
      transaction.set(componentBalanceRefs[index], {
        ...current,
        organizationId: context.organizationId,
        itemId: requirement.itemId,
        locationId: payload.locationId,
        assemblyIn: Number(current.assemblyIn || 0) + recoveredQuantity,
        onHandQuantity: nextOnHand,
        availableQuantity: nextOnHand - currentReserved,
        averageCost: nextAverage,
        inventoryValue: nextOnHand * nextAverage,
        version: Number(current.version || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const lineId = `R${index + 1}`;
      componentLines.push({
        id: lineId,
        itemId: itemSnapshot.id,
        itemCode: String(item.itemCode || ''),
        itemName: String(item.itemName || ''),
        description: String(item.description || ''),
        unit: String(item.unit || ''),
        quantity: recoveredQuantity,
        unitCost: recoveredRate,
        lineRole: 'Recovered Component',
        parentPackItemId: payload.mainItemId,
        parentPackItemCode: String(mainItem.itemCode || ''),
        parentPackItemName: String(mainItem.itemName || ''),
        packQuantity: payload.unbuildQuantity,
        componentQuantityPerPack: Number(requirement.quantity || 0),
      });
      transaction.set(firestore.collection(INVENTORY_COLLECTIONS.ledger).doc(`${documentRef.id}_${lineId}`), clean({
        organizationId: context.organizationId,
        transactionDate: payload.transactionDate,
        documentId: documentRef.id,
        documentNumber,
        transactionType: 'Pack Disassembly',
        status: 'Posted',
        itemId: itemSnapshot.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        locationId: payload.locationId,
        locationName: location.locationName,
        destinationLocationId: payload.locationId,
        quantityIn: recoveredQuantity,
        quantityOut: 0,
        unit: item.unit,
        costRate: recoveredRate,
        totalValue: recoveredValue,
        balanceAfter: nextOnHand,
        projectId: location.projectId,
        propertyId: location.propertyId,
        referenceDocument: payload.referenceDocument,
        remarks: payload.remarks || `Recovered from ${payload.unbuildQuantity} ${mainItem.unit || ''} of ${mainItem.itemName}`,
        parentPackItemId: payload.mainItemId,
        packQuantity: payload.unbuildQuantity,
        createdBy: context.userId,
        postedBy: context.userId,
        postingDate: FieldValue.serverTimestamp(),
      }));
    });

    const nextMainOnHand = currentMainOnHand - payload.unbuildQuantity;
    transaction.set(mainBalanceRef, {
      ...currentMainBalance,
      organizationId: context.organizationId,
      itemId: payload.mainItemId,
      locationId: payload.locationId,
      assemblyOut: Number(currentMainBalance.assemblyOut || 0) + payload.unbuildQuantity,
      onHandQuantity: nextMainOnHand,
      availableQuantity: nextMainOnHand - currentMainReserved,
      inventoryValue: nextMainOnHand * mainUnitCost,
      version: Number(currentMainBalance.version || 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const mainLine: InventoryDocumentLine = {
      id: 'MAIN',
      itemId: payload.mainItemId,
      itemCode: String(mainItem.itemCode || ''),
      itemName: String(mainItem.itemName || ''),
      description: String(mainItem.description || ''),
      unit: String(mainItem.unit || ''),
      quantity: payload.unbuildQuantity,
      unitCost: mainUnitCost,
      lineRole: 'Disassembled',
      packQuantity: payload.unbuildQuantity,
    };
    transaction.set(firestore.collection(INVENTORY_COLLECTIONS.ledger).doc(`${documentRef.id}_MAIN`), clean({
      organizationId: context.organizationId,
      transactionDate: payload.transactionDate,
      documentId: documentRef.id,
      documentNumber,
      transactionType: 'Pack Disassembly',
      status: 'Posted',
      itemId: payload.mainItemId,
      itemCode: mainItem.itemCode,
      itemName: mainItem.itemName,
      locationId: payload.locationId,
      locationName: location.locationName,
      sourceLocationId: payload.locationId,
      quantityIn: 0,
      quantityOut: payload.unbuildQuantity,
      unit: mainItem.unit,
      costRate: mainUnitCost,
      totalValue: totalRecoveredValue,
      balanceAfter: nextMainOnHand,
      projectId: location.projectId,
      propertyId: location.propertyId,
      referenceDocument: payload.referenceDocument,
      remarks: payload.remarks || 'Pack disassembly input',
      packQuantity: payload.unbuildQuantity,
      createdBy: context.userId,
      postedBy: context.userId,
      postingDate: FieldValue.serverTimestamp(),
    }));

    transaction.set(documentRef, clean({
      organizationId: context.organizationId,
      documentNumber,
      documentType: 'Pack Disassembly',
      transactionDate: payload.transactionDate,
      status: 'Posted',
      sourceLocationId: payload.locationId,
      sourceLocationName: location.locationName,
      destinationLocationId: payload.locationId,
      destinationLocationName: location.locationName,
      projectId: location.projectId,
      projectName: location.projectName,
      propertyId: location.propertyId,
      propertyName: location.propertyName,
      referenceDocument: payload.referenceDocument,
      remarks: payload.remarks,
      mainItemId: payload.mainItemId,
      mainItemCode: mainItem.itemCode,
      mainItemName: mainItem.itemName,
      unbuildQuantity: payload.unbuildQuantity,
      lines: [mainLine, ...componentLines],
      createdBy: context.userId,
      createdByName: context.userName,
      postedBy: context.userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      postedAt: FieldValue.serverTimestamp(),
    }));
    transaction.set(firestore.collection(INVENTORY_COLLECTIONS.approvals).doc(), {
      organizationId: context.organizationId,
      documentId: documentRef.id,
      documentNumber,
      previousStatus: null,
      newStatus: 'Posted',
      action: 'Pack unbuilt and posted',
      userId: context.userId,
      userName: context.userName,
      createdAt: FieldValue.serverTimestamp(),
    });
    const result = {
      documentId: documentRef.id,
      documentNumber,
      status: 'Posted',
      unbuildQuantity: payload.unbuildQuantity,
      componentCount: componentLines.length,
      unitCost: mainUnitCost,
      totalValue: totalRecoveredValue,
    };
    transaction.set(requestRef, {
      ...result,
      organizationId: context.organizationId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

async function createTransfer(context: RequestContext, payload: z.infer<typeof transferCreateSchema>) {
  requirePermission(context, 'Create Transfer', { legacyTransaction: true });
  const firestore = db();
  const documentRef = firestore.collection(INVENTORY_COLLECTIONS.documents).doc();
  const requestRef = idempotencyRef(context, payload.clientRequestId);
  const sourceRef = firestore.collection(INVENTORY_COLLECTIONS.locations).doc(payload.sourceLocationId);
  const destinationRef = firestore.collection(INVENTORY_COLLECTIONS.locations).doc(payload.destinationLocationId);
  const itemRefs = payload.lines.map((line) => firestore.collection(INVENTORY_COLLECTIONS.items).doc(line.itemId));

  return firestore.runTransaction(async (transaction) => {
    const [requestSnapshot, sourceSnapshot, destinationSnapshot] = await Promise.all([
      transaction.get(requestRef), transaction.get(sourceRef), transaction.get(destinationRef),
    ]);
    if (requestSnapshot.exists) return { ...requestSnapshot.data(), duplicate: true };
    if (!sourceSnapshot.exists || !destinationSnapshot.exists) throw new InventoryApiError('Source or destination location was not found.', 404);
    assertLocationAccess(context, sourceSnapshot.data()!);
    assertLocationAccess(context, destinationSnapshot.data()!);
    const itemSnapshots = await transaction.getAll(...itemRefs);
    const documentNumber = await nextDocumentNumber(transaction, context.organizationId, 'Stock Transfer', payload.transactionDate);
    const lines = payload.lines.map((line, index) => {
      const item = itemSnapshots[index].data();
      if (!itemSnapshots[index].exists || item?.active === false) throw new InventoryApiError('One of the selected items is missing or inactive.');
      validateTracking(item!, line);
      return clean({
        ...line,
        id: line.id || `L${index + 1}`,
        itemCode: item!.itemCode,
        itemName: item!.itemName,
        description: item!.description,
        unit: item!.unit,
        requestedQuantity: line.quantity,
        approvedQuantity: 0,
        dispatchedQuantity: 0,
        receivedQuantity: 0,
        rejectedQuantity: 0,
        damagedQuantity: 0,
        outstandingQuantity: 0,
      });
    });
    transaction.set(documentRef, clean({
      organizationId: context.organizationId,
      documentNumber,
      documentType: 'Stock Transfer',
      transactionDate: payload.transactionDate,
      status: 'Draft',
      sourceLocationId: sourceSnapshot.id,
      sourceLocationName: sourceSnapshot.data()!.locationName,
      destinationLocationId: destinationSnapshot.id,
      destinationLocationName: destinationSnapshot.data()!.locationName,
      projectId: destinationSnapshot.data()!.projectId || sourceSnapshot.data()!.projectId,
      projectName: destinationSnapshot.data()!.projectName || sourceSnapshot.data()!.projectName,
      propertyId: destinationSnapshot.data()!.propertyId || sourceSnapshot.data()!.propertyId,
      propertyName: destinationSnapshot.data()!.propertyName || sourceSnapshot.data()!.propertyName,
      requesterId: payload.requesterId || context.userId,
      requesterName: payload.requesterName || context.userName,
      referenceDocument: payload.referenceDocument,
      vehicleDetails: payload.vehicleDetails,
      remarks: payload.remarks,
      lines,
      createdBy: context.userId,
      createdByName: context.userName,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }));
    const result = { documentId: documentRef.id, documentNumber, status: 'Draft' };
    transaction.set(requestRef, { ...result, organizationId: context.organizationId, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}

function transferPermission(transition: z.infer<typeof transferTransitionSchema>['transition']) {
  return ({ submit: 'Create Transfer', approve: 'Approve Transfer', dispatch: 'Dispatch Transfer', receive: 'Receive Transfer', cancel: 'Create Transfer' })[transition];
}

async function transitionTransfer(context: RequestContext, payload: z.infer<typeof transferTransitionSchema>) {
  requirePermission(context, transferPermission(payload.transition), { legacyTransaction: true });
  const firestore = db();
  const documentRef = firestore.collection(INVENTORY_COLLECTIONS.documents).doc(payload.documentId);
  const requestRef = idempotencyRef(context, payload.clientRequestId);

  return firestore.runTransaction(async (transaction) => {
    const [requestSnapshot, documentSnapshot] = await Promise.all([transaction.get(requestRef), transaction.get(documentRef)]);
    if (requestSnapshot.exists) return { ...requestSnapshot.data(), duplicate: true };
    if (!documentSnapshot.exists) throw new InventoryApiError('Stock transfer not found.', 404);
    const document = documentSnapshot.data()!;
    if (document.documentType !== 'Stock Transfer' || String(document.organizationId || 'default') !== context.organizationId) {
      throw new InventoryApiError('Stock transfer not found.', 404);
    }

    const expected: Record<string, string[]> = {
      submit: ['Draft'], approve: ['Submitted'], dispatch: ['Approved'], receive: ['In Transit', 'Partially Received'], cancel: ['Draft', 'Submitted', 'Approved'],
    };
    if (!expected[payload.transition].includes(document.status)) {
      throw new InventoryApiError(`A ${document.status} transfer cannot be ${payload.transition}ed.`);
    }

    const sourceRef = firestore.collection(INVENTORY_COLLECTIONS.locations).doc(document.sourceLocationId);
    const destinationRef = firestore.collection(INVENTORY_COLLECTIONS.locations).doc(document.destinationLocationId);
    const [sourceSnapshot, destinationSnapshot] = await Promise.all([transaction.get(sourceRef), transaction.get(destinationRef)]);
    if (!sourceSnapshot.exists || !destinationSnapshot.exists) throw new InventoryApiError('A transfer location no longer exists.');
    assertLocationAccess(context, sourceSnapshot.data()!);
    assertLocationAccess(context, destinationSnapshot.data()!);

    let nextStatus = document.status;
    let nextLines = (document.lines || []) as InventoryDocumentLine[];
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

    if (payload.transition === 'submit') nextStatus = 'Submitted';
    if (payload.transition === 'approve') {
      nextStatus = 'Approved';
      nextLines = nextLines.map((line) => ({ ...line, approvedQuantity: Number(line.requestedQuantity || line.quantity) }));
      updates.approvedBy = context.userId;
      updates.approvedByName = context.userName;
      updates.approvedAt = FieldValue.serverTimestamp();
    }
    if (payload.transition === 'cancel') {
      nextStatus = 'Cancelled';
      updates.cancelledBy = context.userId;
      updates.cancelledAt = FieldValue.serverTimestamp();
      updates.cancellationRemarks = payload.remarks || '';
    }

    if (payload.transition === 'dispatch' || payload.transition === 'receive') {
      const submittedLines = new Map((payload.lines || []).map((line) => [line.id, line]));
      const locationId = payload.transition === 'dispatch' ? document.sourceLocationId : document.destinationLocationId;
      const balanceRefs = nextLines.map((line) => firestore.collection(INVENTORY_COLLECTIONS.balances).doc(inventoryBalanceId(context.organizationId, locationId, line.itemId)));
      const balanceSnapshots = await transaction.getAll(...balanceRefs);
      const settingsSnapshot = payload.transition === 'dispatch'
        ? await transaction.get(firestore.collection('storeStockSettings').doc('inventory'))
        : null;
      const allowNegative = settingsSnapshot?.data()?.allowNegativeInventory === true
        && (permissionList(context, 'Inventory') || []).includes('Allow Negative Inventory');

      nextLines = nextLines.map((line, index) => {
        const submitted = submittedLines.get(line.id);
        const defaultQuantity = payload.transition === 'dispatch'
          ? Number(line.approvedQuantity || 0)
          : Number(line.dispatchedQuantity || 0) - Number(line.receivedQuantity || 0) - Number(line.rejectedQuantity || 0) - Number(line.damagedQuantity || 0);
        const quantity = Number(submitted?.quantity ?? defaultQuantity);
        const rejected = payload.transition === 'receive' ? Number(submitted?.rejectedQuantity || 0) : 0;
        const damaged = payload.transition === 'receive' ? Number(submitted?.damagedQuantity || 0) : 0;
        if (quantity < 0 || rejected < 0 || damaged < 0) throw new InventoryApiError('Transfer quantities cannot be negative.');

        const maximum = payload.transition === 'dispatch'
          ? Number(line.approvedQuantity || 0) - Number(line.dispatchedQuantity || 0)
          : defaultQuantity;
        if (quantity + rejected + damaged > maximum + 0.000001) {
          throw new InventoryApiError(`${line.itemName}: quantity exceeds the outstanding transfer quantity.`);
        }
        const balanceSnapshot = balanceSnapshots[index];
        const current = balanceSnapshot.exists ? balanceSnapshot.data()! : emptyBalance(context.organizationId, locationId, line.itemId);
        const inbound = payload.transition === 'receive';
        const movementQuantity = inbound ? quantity : quantity;
        const currentOnHand = Number(current.onHandQuantity || 0);
        const reserved = Number(current.reservedQuantity || 0);
        if (!inbound && !allowNegative && movementQuantity > currentOnHand - reserved) {
          throw new InventoryApiError(`${line.itemName}: dispatch ${movementQuantity}, available ${Math.max(0, currentOnHand - reserved)}.`);
        }
        const currentAverage = Number(current.averageCost || line.unitCost || 0);
        const rate = Number(line.unitCost || currentAverage || 0);
        const nextOnHand = currentOnHand + (inbound ? movementQuantity : -movementQuantity);
        const nextAverage = inbound ? movingWeightedAverage(currentOnHand, currentAverage, movementQuantity, rate) : currentAverage;
        const counter = movementCounter('Stock Transfer', inbound);
        transaction.set(balanceRefs[index], {
          ...current,
          organizationId: context.organizationId,
          itemId: line.itemId,
          locationId,
          [counter]: Number(current[counter] || 0) + movementQuantity,
          onHandQuantity: nextOnHand,
          availableQuantity: nextOnHand - reserved,
          averageCost: nextAverage,
          inventoryValue: nextOnHand * nextAverage,
          version: Number(current.version || 0) + 1,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        if (movementQuantity > 0) {
          const suffix = payload.transition === 'dispatch' ? 'dispatch' : `receive_${safeKey(payload.clientRequestId)}`;
          transaction.set(firestore.collection(INVENTORY_COLLECTIONS.ledger).doc(`${documentRef.id}_${line.id}_${suffix}`), clean({
            organizationId: context.organizationId,
            transactionDate: document.transactionDate,
            documentId: documentRef.id,
            documentNumber: document.documentNumber,
            transactionType: 'Stock Transfer',
            status: 'Posted',
            itemId: line.itemId,
            itemCode: line.itemCode,
            itemName: line.itemName,
            locationId,
            locationName: inbound ? destinationSnapshot.data()!.locationName : sourceSnapshot.data()!.locationName,
            sourceLocationId: document.sourceLocationId,
            destinationLocationId: document.destinationLocationId,
            quantityIn: inbound ? movementQuantity : 0,
            quantityOut: inbound ? 0 : movementQuantity,
            unit: line.unit,
            costRate: rate,
            totalValue: movementQuantity * rate,
            balanceAfter: nextOnHand,
            projectId: document.projectId,
            propertyId: document.propertyId,
            requesterId: document.requesterId,
            referenceDocument: document.referenceDocument,
            remarks: payload.remarks || line.remarks || document.remarks,
            batchNumber: line.batchNumber,
            serialNumbers: line.serialNumbers,
            createdBy: document.createdBy,
            approvedBy: document.approvedBy,
            postedBy: context.userId,
            postingDate: FieldValue.serverTimestamp(),
          }));
        }

        if (payload.transition === 'dispatch') {
          const dispatchedQuantity = Number(line.dispatchedQuantity || 0) + quantity;
          return { ...line, dispatchedQuantity, outstandingQuantity: dispatchedQuantity - Number(line.receivedQuantity || 0) - Number(line.rejectedQuantity || 0) - Number(line.damagedQuantity || 0), unitCost: rate };
        }
        const receivedQuantity = Number(line.receivedQuantity || 0) + quantity;
        const rejectedQuantity = Number(line.rejectedQuantity || 0) + rejected;
        const damagedQuantity = Number(line.damagedQuantity || 0) + damaged;
        return {
          ...line,
          receivedQuantity,
          rejectedQuantity,
          damagedQuantity,
          outstandingQuantity: Math.max(0, Number(line.dispatchedQuantity || 0) - receivedQuantity - rejectedQuantity - damagedQuantity),
        };
      });

      if (payload.transition === 'dispatch') {
        nextStatus = 'In Transit';
        updates.dispatchedBy = context.userId;
        updates.dispatchedByName = context.userName;
        updates.dispatchedAt = FieldValue.serverTimestamp();
      } else {
        nextStatus = nextLines.every((line) => Number(line.outstandingQuantity || 0) <= 0.000001) ? 'Received' : 'Partially Received';
        updates.receivedBy = context.userId;
        updates.receivedByName = context.userName;
        updates.lastReceivedAt = FieldValue.serverTimestamp();
        if (nextStatus === 'Received') updates.receivedAt = FieldValue.serverTimestamp();
      }
    }

    transaction.update(documentRef, { ...updates, lines: nextLines, status: nextStatus });
    transaction.set(firestore.collection(INVENTORY_COLLECTIONS.approvals).doc(), clean({
      organizationId: context.organizationId,
      documentId: documentRef.id,
      documentNumber: document.documentNumber,
      previousStatus: document.status,
      newStatus: nextStatus,
      action: payload.transition,
      remarks: payload.remarks,
      userId: context.userId,
      userName: context.userName,
      createdAt: FieldValue.serverTimestamp(),
    }));
    const result = { documentId: documentRef.id, documentNumber: document.documentNumber, status: nextStatus };
    transaction.set(requestRef, { ...result, organizationId: context.organizationId, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}

async function createStockCount(context: RequestContext, payload: z.infer<typeof createCountSchema>) {
  requirePermission(context, 'Perform Stock Count', { legacyTransaction: true });
  const firestore = db();
  const countRef = firestore.collection(INVENTORY_COLLECTIONS.counts).doc();
  const requestRef = idempotencyRef(context, payload.clientRequestId);
  const locationRef = firestore.collection(INVENTORY_COLLECTIONS.locations).doc(payload.locationId);

  return firestore.runTransaction(async (transaction) => {
    const [requestSnapshot, locationSnapshot] = await Promise.all([transaction.get(requestRef), transaction.get(locationRef)]);
    if (requestSnapshot.exists) return { ...requestSnapshot.data(), duplicate: true };
    if (!locationSnapshot.exists) throw new InventoryApiError('Inventory location not found.', 404);
    assertLocationAccess(context, locationSnapshot.data()!);
    const balancesSnapshot = await transaction.get(firestore.collection(INVENTORY_COLLECTIONS.balances)
      .where('organizationId', '==', context.organizationId).where('locationId', '==', payload.locationId));
    const balances = balancesSnapshot.docs.filter((item) => Number(item.data().onHandQuantity || 0) !== 0).slice(0, 250);
    const itemRefs = balances.map((balance) => firestore.collection(INVENTORY_COLLECTIONS.items).doc(balance.data().itemId));
    const itemSnapshots = itemRefs.length ? await transaction.getAll(...itemRefs) : [];
    const countNumber = await nextDocumentNumber(transaction, context.organizationId, 'Physical Count', payload.countDate);
    const lines = balances.map((balance, index) => {
      const item = itemSnapshots[index].data() || {};
      return {
        id: `L${index + 1}`,
        itemId: balance.data().itemId,
        itemCode: item.itemCode || '',
        itemName: item.itemName || balance.data().itemId,
        unit: item.unit || '',
        systemQuantity: Number(balance.data().onHandQuantity || 0),
      };
    });
    transaction.set(countRef, {
      organizationId: context.organizationId,
      countNumber,
      locationId: payload.locationId,
      locationName: locationSnapshot.data()!.locationName,
      countDate: payload.countDate,
      status: 'Draft',
      lines,
      createdBy: context.userId,
      createdByName: context.userName,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = { countId: countRef.id, countNumber, status: 'Draft', lineCount: lines.length };
    transaction.set(requestRef, { ...result, organizationId: context.organizationId, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}

async function submitStockCount(context: RequestContext, payload: z.infer<typeof submitCountSchema>) {
  requirePermission(context, 'Perform Stock Count', { legacyTransaction: true });
  const firestore = db();
  const countRef = firestore.collection(INVENTORY_COLLECTIONS.counts).doc(payload.countId);
  const requestRef = idempotencyRef(context, payload.clientRequestId);
  return firestore.runTransaction(async (transaction) => {
    const [requestSnapshot, countSnapshot] = await Promise.all([transaction.get(requestRef), transaction.get(countRef)]);
    if (requestSnapshot.exists) return { ...requestSnapshot.data(), duplicate: true };
    if (!countSnapshot.exists || String(countSnapshot.data()?.organizationId || 'default') !== context.organizationId) throw new InventoryApiError('Stock count not found.', 404);
    const count = countSnapshot.data()!;
    if (count.status !== 'Draft') throw new InventoryApiError('Only a draft stock count can be submitted.');
    const values = new Map(payload.lines.map((line) => [line.id, line]));
    const lines = (count.lines || []).map((line: DocumentData) => {
      const submitted = values.get(line.id);
      if (!submitted) throw new InventoryApiError(`Physical quantity is missing for ${line.itemName}.`);
      return {
        ...line,
        physicalQuantity: submitted.physicalQuantity,
        variance: submitted.physicalQuantity - Number(line.systemQuantity || 0),
        varianceReason: submitted.varianceReason || '',
      };
    });
    transaction.update(countRef, { lines, status: 'Submitted', submittedBy: context.userId, submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    const result = { countId: countRef.id, countNumber: count.countNumber, status: 'Submitted' };
    transaction.set(requestRef, { ...result, organizationId: context.organizationId, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}

async function postStockCount(context: RequestContext, payload: z.infer<typeof postCountSchema>) {
  requirePermission(context, 'Approve Stock Count');
  const firestore = db();
  const countRef = firestore.collection(INVENTORY_COLLECTIONS.counts).doc(payload.countId);
  const requestRef = idempotencyRef(context, payload.clientRequestId);
  return firestore.runTransaction(async (transaction) => {
    const [requestSnapshot, countSnapshot] = await Promise.all([transaction.get(requestRef), transaction.get(countRef)]);
    if (requestSnapshot.exists) return { ...requestSnapshot.data(), duplicate: true };
    if (!countSnapshot.exists || String(countSnapshot.data()?.organizationId || 'default') !== context.organizationId) throw new InventoryApiError('Stock count not found.', 404);
    const count = countSnapshot.data()!;
    if (count.status !== 'Submitted') throw new InventoryApiError('Only a submitted stock count can be posted.');
    const lines = (count.lines || []) as DocumentData[];
    const changed = lines.filter((line) => Math.abs(Number(line.variance || 0)) > 0.000001);
    const balanceRefs = changed.map((line) => firestore.collection(INVENTORY_COLLECTIONS.balances).doc(inventoryBalanceId(context.organizationId, count.locationId, line.itemId)));
    const balanceSnapshots = balanceRefs.length ? await transaction.getAll(...balanceRefs) : [];
    changed.forEach((line, index) => {
      const balanceSnapshot = balanceSnapshots[index];
      const current = balanceSnapshot.exists ? balanceSnapshot.data()! : emptyBalance(context.organizationId, count.locationId, line.itemId);
      const variance = Number(line.variance || 0);
      const nextOnHand = Number(line.physicalQuantity || 0);
      const reserved = Number(current.reservedQuantity || 0);
      const average = Number(current.averageCost || 0);
      const counter = movementCounter('Physical Count', variance > 0);
      transaction.set(balanceRefs[index], {
        ...current,
        organizationId: context.organizationId,
        locationId: count.locationId,
        itemId: line.itemId,
        [counter]: Number(current[counter] || 0) + Math.abs(variance),
        onHandQuantity: nextOnHand,
        availableQuantity: nextOnHand - reserved,
        inventoryValue: nextOnHand * average,
        version: Number(current.version || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(firestore.collection(INVENTORY_COLLECTIONS.ledger).doc(`${countRef.id}_${line.id}`), {
        organizationId: context.organizationId,
        transactionDate: count.countDate,
        documentId: countRef.id,
        documentNumber: count.countNumber,
        transactionType: 'Physical Count',
        status: 'Posted',
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        locationId: count.locationId,
        locationName: count.locationName,
        quantityIn: variance > 0 ? variance : 0,
        quantityOut: variance < 0 ? Math.abs(variance) : 0,
        unit: line.unit,
        costRate: average,
        totalValue: Math.abs(variance) * average,
        balanceAfter: nextOnHand,
        remarks: line.varianceReason || 'Physical count variance',
        createdBy: count.createdBy,
        approvedBy: context.userId,
        postedBy: context.userId,
        postingDate: FieldValue.serverTimestamp(),
      });
    });
    transaction.update(countRef, {
      status: 'Posted',
      approvedBy: context.userId,
      approvedByName: context.userName,
      postedBy: context.userId,
      postedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = { countId: countRef.id, countNumber: count.countNumber, status: 'Posted', adjustments: changed.length };
    transaction.set(requestRef, { ...result, organizationId: context.organizationId, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}

export async function POST(request: Request) {
  try {
    const context = await authenticate(request);
    const payload = requestSchema.parse(await request.json());
    let result: unknown;
    switch (payload.action) {
      case 'saveItem': result = await saveItem(context, payload.item); break;
      case 'saveLocation': result = await saveLocation(context, payload.location); break;
      case 'postMovement': result = await postMovement(context, payload); break;
      case 'buildPack': result = await buildPack(context, payload); break;
      case 'unbuildPack': result = await unbuildPack(context, payload); break;
      case 'createTransfer': result = await createTransfer(context, payload); break;
      case 'transitionTransfer': result = await transitionTransfer(context, payload); break;
      case 'createStockCount': result = await createStockCount(context, payload); break;
      case 'submitStockCount': result = await submitStockCount(context, payload); break;
      case 'postStockCount': result = await postStockCount(context, payload); break;
      case 'setInventoryScopeStatus': result = await setInventoryScopeStatus(context, payload); break;
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: error.issues[0]?.message || 'Invalid inventory request.', issues: error.issues }, { status: 400 });
    }
    if (error instanceof InventoryApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (firebaseAuthErrorCode(error)) {
      return NextResponse.json({
        ok: false,
        code: 'INVALID_FIREBASE_ID_TOKEN',
        error: 'Your session token is invalid or expired. Please sign in again.',
      }, { status: 401 });
    }
    if (isFirebaseAdminCredentialError(error)) {
      console.error('[inventory-api] Firebase Admin credentials are unavailable.', error);
      return NextResponse.json({
        ok: false,
        code: 'FIREBASE_ADMIN_CREDENTIALS_UNAVAILABLE',
        error: 'Firebase Admin credentials are not configured for this local server.',
      }, { status: 503 });
    }
    console.error('[inventory-api]', error);
    return NextResponse.json({ ok: false, error: 'The inventory transaction could not be completed.' }, { status: 500 });
  }
}
