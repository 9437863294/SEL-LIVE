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
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { INVENTORY_COLLECTIONS } from '@/lib/inventory';

interface ClientInventoryContext {
  userId: string;
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

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(targetRef);
    if (!item.id && existing.exists()) throw new Error(`Item code ${itemCode} already exists.`);
    if (item.id && !existing.exists()) throw new Error('Inventory item not found.');
    if (item.id && existing.data()?.itemCode !== itemCode) {
      throw new Error('Item code cannot be changed after creation.');
    }
    transaction.set(targetRef, clean({
      ...item,
      id: undefined,
      organizationId: context.organizationId,
      itemCode,
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

export async function runLocalInventorySetupCommand(payload: Record<string, unknown>) {
  const context = await loadContext();
  switch (payload.action) {
    case 'saveLocation':
      return saveLocation(context, payload.location);
    case 'saveItem':
      return saveItem(context, payload.item);
    case 'setInventoryScopeStatus':
      return setInventoryScopeStatus(context, payload);
    default:
      throw new Error('Firebase Admin credentials are required to post inventory transactions locally.');
  }
}
