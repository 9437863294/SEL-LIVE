// Stage 2, Vehicle Management and the driver app: the registers are read by anyone the module's
// shell admits and written by the action each screen checks; drivers who hold nothing work their own
// records through the driver record linked to their `users` document (linkedUserId, or the mobile on
// their users document); Site Account Statement keeps its expenses' fuel logs at `sas-<expenseId>`.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, increment, limit, orderBy, query,
  serverTimestamp, setDoc, startAfter, updateDoc, where,
} from 'firebase/firestore';
import { as, rulesEnv, seed } from './helpers.mjs';

const perms = (userDocId, p = {}) => ({ v: 1, p, active: true, userDocId, roleNames: [], projectIds: [], departmentIds: [] });
const V = (page) => `Vehicle Management.${page}`;
const D = (page) => `Driver Management.${page}`;
const ALL = ['View', 'Add', 'Edit', 'Delete', 'Import', 'Export'];
const REGISTERS = [
  ['vehicleManagementInsurance', 'Insurance Management'],
  ['vehicleManagementPuc', 'PUC Management'],
  ['vehicleManagementFitness', 'Fitness Certificate Management'],
  ['vehicleManagementRoadTax', 'Road Tax Management'],
  ['vehicleManagementPermit', 'Permit Management'],
  ['vehicleManagementDocuments', 'Document Management'],
  ['vehicleManagementMaintenanceLogs', 'Maintenance Management'],
];

let env;
before(async () => {
  env = await rulesEnv();
  const registerDocs = {};
  for (const [name] of REGISTERS) {
    registerDocs[`${name}/r1`] = { vehicleId: 'v1', vehicleNumber: 'KA01', expiryDate: '2026-12-01' };
    registerDocs[`${name}/r9`] = { vehicleId: 'v9', vehicleNumber: 'KA09', expiryDate: '2026-12-01' };
    registerDocs[`${name}/old`] = { vehicleId: 'v1', vehicleNumber: 'KA01', expiryDate: '2025-12-01', renewalStatus: 'Overdue' };
  }
  await seed(env, {
    'userPermissions/fleet': perms('uF', { 'Vehicle Management': ['View Module'] }),
    'userPermissions/reports': perms('uRep', { [V('Reports')]: ['View'] }),
    'userPermissions/vmaster': perms('uVM', { [V('Vehicle Master')]: ALL }),
    'userPermissions/vmasterView': perms('uVV', { [V('Vehicle Master')]: ['View'] }),
    'userPermissions/ins': perms('uI', { [V('Insurance Management')]: ALL }),
    'userPermissions/insAdd': perms('uIA', { [V('Insurance Management')]: ['View', 'Add'] }),
    'userPermissions/insView': perms('uIV', { [V('Insurance Management')]: ['View'] }),
    'userPermissions/puc': perms('uP', { [V('PUC Management')]: ['View', 'Add', 'Edit', 'Delete'] }),
    'userPermissions/fuelMgr': perms('uFM', { [V('Fuel Management')]: ALL }),
    'userPermissions/driverMgr': perms('uDM', { [V('Driver Management')]: ALL }),
    'userPermissions/tripMgr': perms('uTM', { [D('Trip Management')]: ['View'] }),
    'userPermissions/vmTripMgr': perms('uVT', { [V('Trip Management')]: ['View', 'Export'] }),
    'userPermissions/settings': perms('uSet', { [V('Settings')]: ['View', 'Edit'] }),
    'userPermissions/fieldCtl': perms('uFC', { [V('Settings')]: ['View', 'Manage Field Control'] }),
    // Drivers with no permission at all: linked by users id, by mobile, and a legacy vehicle that
    // does not name its driver back.
    'userPermissions/drv': perms('uDrv'),
    'userPermissions/legacyDrv': perms('uDrv'),
    'userPermissions/mob': perms('uMob'),
    'userPermissions/drv3': perms('uDrv3'),
    'userPermissions/noMob': perms('uNoMob'),
    'userPermissions/drvRole': perms('uRole', { [D('Driver Fuel')]: ['View', 'Add'] }),
    'userPermissions/claimant': perms('uC'),
    'userPermissions/claimMgr': perms('uCM', { [D('Employee Trip Log')]: ['View', 'Approve'] }),
    'userPermissions/claimEditor': perms('uCE', { [V('Employee Trip Reimbursement')]: ['Edit'] }),
    'userPermissions/assignee': perms('uA', { 'Vehicle Management': ['View Module'] }),
    'userPermissions/sasUser': perms('uS'),
    'userPermissions/sasAll': perms('uSA', { 'Site Account Statement.All Projects': ['View'] }),
    'userPermissions/stranger': perms('uX', { 'HR & Recruitment': ['View Module'], [V('Driver Mobile')]: ['View'] }),
    'userPermissions/gone': { ...perms('uGone'), active: false },
    // `nodoc` has no permissions document at all.

    'users/uDrv': { name: 'Driver One', mobile: '9876500001' },
    'users/uMob': { name: 'Driver Two', mobile: '+91 98765 00002' },
    'users/uDrv3': { name: 'Driver Three', mobile: '9876500003' },
    'users/uNoMob': { name: 'No Mobile' },
    'users/uRole': { name: 'Coordinator', mobile: '9876500004' },
    'users/uX': { name: 'Stranger', mobile: '9000000000' },
    'users/uC': { name: 'Claimant', mobile: '9000000001' },

    'vehicleManagementVehicles/v1': { vehicleNumber: 'KA01', assignedDriverId: 'd1', assignedProjectId: 'C1', vehicleStatus: 'Active' },
    'vehicleManagementVehicles/v2': { vehicleNumber: 'KA02', assignedDriverId: 'd2', assignedProjectId: 'C1', vehicleStatus: 'Active' },
    'vehicleManagementVehicles/v3': { vehicleNumber: 'KA03', assignedDriverId: '', vehicleStatus: 'Active' },
    'vehicleManagementVehicles/v9': { vehicleNumber: 'KA09', assignedDriverId: 'd9', vehicleStatus: 'Sold' },

    'vehicleManagementDriver/d1': { driverName: 'One', linkedUserId: 'uDrv', mobileNumber: '9876500001', assignedVehicleId: 'v1' },
    'vehicleManagementDriver/d2': { driverName: 'Two', linkedUserId: '', mobileNumber: '9876500002', assignedVehicleId: 'v2' },
    'vehicleManagementDriver/d3': { driverName: 'Three', linkedUserId: 'uDrv3', mobileNumber: '9876500003', assignedVehicleId: 'v3' },
    'vehicleManagementDriver/d4': { driverName: 'Four', linkedUserId: 'uRole', mobileNumber: '9876500004', assignedVehicleId: '' },
    'vehicleManagementDriver/d9': { driverName: 'Nine', linkedUserId: 'uOther', mobileNumber: '9999999999', assignedVehicleId: 'v9' },

    ...registerDocs,

    'vehicleManagementFuelLogs/f1': { vehicleId: 'v1', driverId: 'd1', fuelDate: '2026-10-02', totalAmount: 100, sourceApp: 'Driver Mobile' },
    'vehicleManagementFuelLogs/f9': { vehicleId: 'v9', driverId: 'd9', fuelDate: '2026-10-02', totalAmount: 100 },
    'vehicleManagementFuelLogs/sas-e1': { vehicleId: 'v1', source: 'site-account-statement', sasExpenseId: 'e1', sasProjectId: 'P1', totalAmount: 50 },
    'siteAccountProjects/P1': { assignedPersonId: 'uS' },
    'siteAccountProjects/P2': { assignedPersonId: 'uOther' },
    'siteAccountExpenses/e1': { projectId: 'P1', amount: 50 },
    'siteAccountExpenses/e2': { projectId: 'P2', amount: 50 },
    'siteAccountExpenses/e3': { projectId: 'P1', amount: 70 },

    'vehicleManagementTrips/t1': { driverId: 'd1', linkedUserId: 'uDrv', vehicleId: 'v1', vehicleNumber: 'KA01', tripStatus: 'In Progress', startTimeIso: '2026-10-05T08:00:00.000Z', totalPoints: 1, totalDistanceKm: 0 },
    'vehicleManagementTrips/t9': { driverId: 'd9', linkedUserId: 'uOther', vehicleId: 'v9', tripStatus: 'Completed', startTimeIso: '2026-10-04T08:00:00.000Z', totalPoints: 4, totalDistanceKm: 3 },
    'vehicleManagementTripLocations/l1': { tripId: 't1', driverId: 'd1', lat: 1, lng: 2 },
    'vehicleManagementTripLocations/l9': { tripId: 't9', driverId: 'd9', lat: 1, lng: 2 },

    'vehicleManagementDriverDailyStatus/s1': { driverId: 'd1', vehicleId: 'v1', statusDate: '2026-10-05' },
    'vehicleManagementDriverDailyStatus/s9': { driverId: 'd9', vehicleId: 'v9', statusDate: '2026-10-05' },
    'vehicleManagementDriverAssignments/a1': { vehicleId: 'v1', driverId: 'd1', action: 'Assigned' },

    'vehicleManagementEmployeeTrips/c1': { submittedByUserId: 'uC', approvalStatus: 'Submitted', reimbursementAmount: 10 },
    'vehicleManagementEmployeeTrips/c2': { submittedByUserId: 'uC', approvalStatus: 'Approved', approverRemarks: 'ok', reimbursementAmount: 20 },
    'vehicleManagementEmployeeTrips/c9': { submittedByUserId: 'uOther', approvalStatus: 'Submitted', reimbursementAmount: 30 },

    'vehicleManagementInsuranceWorkflowCases/i1': { insuranceId: 'i1', assigneeIds: ['uA'], status: 'Open' },
    'vehicleManagementInsuranceWorkflowCases/i9': { insuranceId: 'i9', assigneeIds: ['uOther'], status: 'Open' },

    'vehicleManagementSettings/fieldControl': { forms: {} },
    'vehicleManagementSettings/trackingConfig': { driverLocationUpdateIntervalSec: 10 },
    'vehicleManagementSettings/vehicleTypes': { types: ['Truck'] },
    'vehicleManagementSettings/insuranceWorkflowConfig': { steps: [] },
  });
});
after(async () => env?.cleanup());

const clients = new Map();
const db = (uid) => {
  if (!clients.has(uid)) clients.set(uid, as(env, uid));
  return clients.get(uid);
};
const col = (uid, name) => collection(db(uid), name);
const ref = (uid, path) => doc(db(uid), path);
const NOBODY = ['gone', 'nodoc', null];
const FLEET = ['fleet', 'reports', 'vmaster', 'vmasterView', 'ins', 'puc', 'fuelMgr', 'driverMgr', 'vmTripMgr', 'settings'];

/* ── The vehicle list and settings: every signed-in reader the code has ── */

test('vehicles and settings: any signed-in user reads them (driver app, Site Account Statement); nobody signed out', async () => {
  for (const uid of ['drv', 'mob', 'sasUser', 'stranger', 'claimant', 'fleet']) {
    await assertSucceeds(getDocs(col(uid, 'vehicleManagementVehicles')));
    await assertSucceeds(getDocs(query(col(uid, 'vehicleManagementVehicles'), where('assignedProjectId', '==', 'C1'))));
    await assertSucceeds(getDoc(ref(uid, 'vehicleManagementVehicles/v1')));
    for (const id of ['fieldControl', 'trackingConfig', 'vehicleTypes', 'insuranceWorkflowConfig']) {
      await assertSucceeds(getDoc(ref(uid, `vehicleManagementSettings/${id}`)));
    }
  }
  await assertFails(getDocs(col(null, 'vehicleManagementVehicles')));
  await assertFails(getDoc(ref(null, 'vehicleManagementSettings/vehicleTypes')));
});

test('vehicles: Vehicle Master writes; the cascades write only their own fields', async () => {
  // Vehicle Master: duplicate check, add, edit, delete.
  await assertSucceeds(getDocs(query(col('vmaster', 'vehicleManagementVehicles'), where('vehicleNumber', '==', 'KA01'))));
  const created = doc(col('vmaster', 'vehicleManagementVehicles'));
  await assertSucceeds(setDoc(created, { vehicleNumber: 'KA77', vehicleId: 'VEH-1', createdBy: 'uVM' }));
  await assertSucceeds(updateDoc(ref('vmaster', 'vehicleManagementVehicles/v3'), { model: 'X', updatedBy: 'uVM', updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(ref('vmaster', created.path)));
  await assertFails(setDoc(doc(col('vmasterView', 'vehicleManagementVehicles')), { vehicleNumber: 'KA78' }));
  await assertFails(updateDoc(ref('vmasterView', 'vehicleManagementVehicles/v3'), { model: 'Y' }));
  await assertFails(updateDoc(ref('fleet', 'vehicleManagementVehicles/v3'), { model: 'Y' }));

  // compliance-sync: a compliance writer recomputes the cached health, and nothing else.
  const health = { documentHealthStatus: 'Valid', hasExpiredDocuments: false, documentAlertCount: 0 };
  await assertSucceeds(updateDoc(ref('puc', 'vehicleManagementVehicles/v1'), health));
  await assertSucceeds(updateDoc(ref('ins', 'vehicleManagementVehicles/v1'), health));
  await assertFails(updateDoc(ref('puc', 'vehicleManagementVehicles/v1'), { ...health, vehicleStatus: 'Sold' }));
  await assertFails(updateDoc(ref('insView', 'vehicleManagementVehicles/v1'), health));

  // Driver Master assigns and releases a vehicle.
  await assertSucceeds(updateDoc(ref('driverMgr', 'vehicleManagementVehicles/v3'), { assignedDriverId: '', assignedDriverName: '' }));
  await assertFails(updateDoc(ref('driverMgr', 'vehicleManagementVehicles/v3'), { assignedDriverId: 'd3', model: 'Z' }));
  await assertFails(updateDoc(ref('stranger', 'vehicleManagementVehicles/v3'), { assignedDriverId: 'd3' }));
});

test('vehicles: the driver app updates the vehicle its driver drives, and only the tracking fields', async () => {
  const tick = { currentLatitude: 1, currentLongitude: 2, currentLocationAtIso: '2026-10-05T08:00:00Z', currentStatus: 'On Trip', updatedAt: serverTimestamp() };
  // Stamped with the driver record (the new code), and from the deployed code with no stamp.
  await assertSucceeds(updateDoc(ref('drv', 'vehicleManagementVehicles/v1'), { ...tick, updatedByDriverId: 'd1' }));
  await assertSucceeds(updateDoc(ref('drv', 'vehicleManagementVehicles/v1'), tick));
  await assertSucceeds(updateDoc(ref('legacyDrv', 'vehicleManagementVehicles/v1'), { currentStatus: 'In Operation', updatedAt: serverTimestamp(), updatedByDriverId: 'd1' }));
  // Fuel and daily status.
  await assertSucceeds(updateDoc(ref('drv', 'vehicleManagementVehicles/v1'), { currentOdometerKm: 1200, updatedAt: serverTimestamp(), updatedByDriverId: 'd1' }));
  await assertSucceeds(updateDoc(ref('drv', 'vehicleManagementVehicles/v1'), { currentOdometerKm: 1300, vehicleStatus: 'Under Maintenance', updatedAt: serverTimestamp(), updatedByDriverId: 'd1' }));
  // Linked by mobile number only.
  await assertSucceeds(updateDoc(ref('mob', 'vehicleManagementVehicles/v2'), { ...tick, updatedByDriverId: 'd2' }));
  // A legacy vehicle that does not name its driver: the stamp vouches, nothing else does.
  await assertFails(updateDoc(ref('drv3', 'vehicleManagementVehicles/v3'), tick));
  await assertSucceeds(updateDoc(ref('drv3', 'vehicleManagementVehicles/v3'), { ...tick, updatedByDriverId: 'd3' }));
  // Someone else's vehicle, someone else's driver record, or fields the app does not write.
  await assertFails(updateDoc(ref('drv', 'vehicleManagementVehicles/v9'), tick));
  await assertFails(updateDoc(ref('drv', 'vehicleManagementVehicles/v9'), { ...tick, updatedByDriverId: 'd1' }));
  await assertFails(updateDoc(ref('drv', 'vehicleManagementVehicles/v1'), { ...tick, updatedByDriverId: 'd9' }));
  await assertFails(updateDoc(ref('drv', 'vehicleManagementVehicles/v1'), { vehicleNumber: 'X', updatedByDriverId: 'd1' }));
  await assertFails(updateDoc(ref('drv', 'vehicleManagementVehicles/v1'), { vehicleStatus: 'Sold', updatedByDriverId: 'd1' }));
  await assertFails(updateDoc(ref('drv', 'vehicleManagementVehicles/v1'), { assignedDriverId: 'd4', updatedByDriverId: 'd1' }));
  await assertFails(updateDoc(ref('stranger', 'vehicleManagementVehicles/v1'), tick));
  await assertFails(updateDoc(ref('noMob', 'vehicleManagementVehicles/v1'), { ...tick, updatedByDriverId: 'd1' }));
  // A driver-app grant: the vehicle the coordinator picked, assigned or not.
  await assertSucceeds(updateDoc(ref('drvRole', 'vehicleManagementVehicles/v9'), { currentOdometerKm: 5, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(ref('drv', 'vehicleManagementVehicles/v1')));
});

test('settings: field control by Manage Field Control or Edit; the rest by Settings Edit', async () => {
  await assertSucceeds(setDoc(ref('fieldCtl', 'vehicleManagementSettings/fieldControl'), { forms: { a: 1 } }));
  await assertSucceeds(setDoc(ref('settings', 'vehicleManagementSettings/fieldControl'), { forms: { a: 2 } }));
  await assertFails(setDoc(ref('fieldCtl', 'vehicleManagementSettings/trackingConfig'), { driverLocationUpdateIntervalSec: 5 }));
  for (const id of ['trackingConfig', 'vehicleTypes', 'insuranceWorkflowConfig']) {
    await assertSucceeds(setDoc(ref('settings', `vehicleManagementSettings/${id}`), { updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(ref('fleet', `vehicleManagementSettings/${id}`), { x: 1 }, { merge: true }));
  }
  await assertFails(setDoc(ref('drv', 'vehicleManagementSettings/fieldControl'), { forms: {} }));
});

/* ── Driver records ── */

test('drivers: the app finds the caller\'s own record by users id and by mobile, for anyone signed in', async () => {
  // useCurrentDriverProfile, exactly as it queries.
  await assertSucceeds(getDocs(query(col('drv', 'vehicleManagementDriver'), where('linkedUserId', '==', 'uDrv'))));
  await assertSucceeds(getDocs(query(col('drv', 'vehicleManagementDriver'), where('mobileNumber', '==', '9876500001'))));
  // An email-matched legacy account: another auth uid, the same users document.
  await assertSucceeds(getDocs(query(col('legacyDrv', 'vehicleManagementDriver'), where('linkedUserId', '==', 'uDrv'))));
  // Mobile-only link: the raw users mobile, then the candidate formats.
  await assertSucceeds(getDocs(query(col('mob', 'vehicleManagementDriver'), where('linkedUserId', '==', 'uMob'))));
  await assertSucceeds(getDocs(query(col('mob', 'vehicleManagementDriver'), where('mobileNumber', '==', '+91 98765 00002'))));
  const candidates = ['+91 98765 00002', '9876500002', '09876500002', '919876500002', '+919876500002', '+91 9876500002'];
  const found = await assertSucceeds(getDocs(query(col('mob', 'vehicleManagementDriver'), where('mobileNumber', 'in', candidates))));
  if (found.size !== 1 || found.docs[0].id !== 'd2') throw new Error('expected the mobile-linked driver');
  await assertSucceeds(getDoc(ref('mob', 'vehicleManagementDriver/d2')));
  // Everyone else's lookup comes back empty rather than refused: the home dashboard runs it for all.
  await assertSucceeds(getDocs(query(col('stranger', 'vehicleManagementDriver'), where('linkedUserId', '==', 'uX'))));
  await assertSucceeds(getDocs(query(col('stranger', 'vehicleManagementDriver'), where('mobileNumber', '==', '9000000000'))));
  await assertSucceeds(getDocs(query(col('claimant', 'vehicleManagementDriver'), where('mobileNumber', 'in', ['9000000001', '+919000000001']))));

  // Not someone else's record, by either key, or the whole register.
  await assertFails(getDocs(query(col('stranger', 'vehicleManagementDriver'), where('linkedUserId', '==', 'uDrv'))));
  await assertFails(getDocs(query(col('stranger', 'vehicleManagementDriver'), where('mobileNumber', '==', '9876500001'))));
  await assertFails(getDocs(query(col('mob', 'vehicleManagementDriver'), where('mobileNumber', 'in', ['9876500002', '9876500001']))));
  await assertFails(getDoc(ref('drv', 'vehicleManagementDriver/d9')));
  await assertFails(getDocs(col('drv', 'vehicleManagementDriver')));
  // No mobile on the users document: the mobile lookups are refused (the hook carries on without them).
  await assertFails(getDocs(query(col('noMob', 'vehicleManagementDriver'), where('mobileNumber', '==', ''))));
  for (const uid of NOBODY) {
    await assertFails(getDocs(query(col(uid, 'vehicleManagementDriver'), where('linkedUserId', '==', 'uDrv'))));
  }
});

test('drivers: the shell reads the register; Driver Master writes it; Vehicle Master writes the assignment', async () => {
  for (const uid of [...FLEET, 'assignee']) {
    await assertSucceeds(getDocs(col(uid, 'vehicleManagementDriver')));
  }
  await assertSucceeds(getCountFromServer(col('driverMgr', 'vehicleManagementDriver')));
  await assertSucceeds(getDocs(query(col('vmaster', 'vehicleManagementDriver'), where('assignedVehicleId', '==', 'v1'), limit(1))));
  for (const uid of ['tripMgr', 'claimMgr', 'stranger', 'drvRole', ...NOBODY]) {
    await assertFails(getDocs(col(uid, 'vehicleManagementDriver')));
  }

  const created = doc(col('driverMgr', 'vehicleManagementDriver'));
  await assertSucceeds(setDoc(created, { driverName: 'New', mobileNumber: '9000000099', linkedUserId: '' }));
  await assertSucceeds(updateDoc(ref('driverMgr', created.path), { status: 'Inactive' }));
  await assertSucceeds(deleteDoc(ref('driverMgr', created.path)));
  await assertSucceeds(updateDoc(ref('vmaster', 'vehicleManagementDriver/d3'), { assignedVehicleId: 'v3', assignedVehicleNumber: 'KA03', updatedAt: serverTimestamp(), updatedBy: 'uVM', updatedByName: 'X' }));
  await assertFails(updateDoc(ref('vmaster', 'vehicleManagementDriver/d3'), { assignedVehicleId: 'v3', linkedUserId: 'uVM' }));
  // Drivers do not edit their own record — not even to link it.
  await assertFails(updateDoc(ref('drv', 'vehicleManagementDriver/d1'), { driverName: 'Me' }));
  await assertFails(updateDoc(ref('noMob', 'vehicleManagementDriver/d2'), { linkedUserId: 'uNoMob' }));
  await assertFails(setDoc(doc(col('fleet', 'vehicleManagementDriver')), { driverName: 'X' }));
});

test('driver assignments: append-only, written beside an assignment, read in the shell', async () => {
  await assertSucceeds(getDocs(query(col('vmaster', 'vehicleManagementDriverAssignments'), where('vehicleId', '==', 'v1'), limit(1))));
  await assertSucceeds(getDocs(col('fleet', 'vehicleManagementDriverAssignments')));
  await assertFails(getDocs(query(col('drv', 'vehicleManagementDriverAssignments'), where('vehicleId', '==', 'v1'))));
  await assertSucceeds(addDoc(col('vmaster', 'vehicleManagementDriverAssignments'), { vehicleId: 'v3', driverId: 'd3', action: 'Assigned', source: 'Vehicle Master' }));
  await assertSucceeds(addDoc(col('driverMgr', 'vehicleManagementDriverAssignments'), { vehicleId: 'v3', driverId: '', action: 'Unassigned', source: 'Driver Master' }));
  await assertFails(addDoc(col('fleet', 'vehicleManagementDriverAssignments'), { vehicleId: 'v3' }));
  await assertFails(updateDoc(ref('vmaster', 'vehicleManagementDriverAssignments/a1'), { action: 'X' }));
  await assertFails(deleteDoc(ref('vmaster', 'vehicleManagementDriverAssignments/a1')));
});

/* ── The compliance registers ── */

test('registers: the shell reads them whole; a driver reads their own vehicle\'s papers only', async () => {
  for (const [name] of REGISTERS) {
    for (const uid of FLEET) {
      await assertSucceeds(getDocs(col(uid, name)));
    }
    // Vehicle details dialog, compliance-sync, the delete check.
    await assertSucceeds(getDocs(query(col('fleet', name), where('vehicleNumber', '==', 'KA01'))));
    await assertSucceeds(getDocs(query(col('vmaster', name), where('vehicleId', '==', 'v1'), limit(1))));
    // driver-mobile/vehicle-details.
    await assertSucceeds(getDocs(query(col('drv', name), where('vehicleId', '==', 'v1'))));
    await assertSucceeds(getDocs(query(col('mob', name), where('vehicleId', '==', 'v2'))));
    await assertFails(getDocs(query(col('drv', name), where('vehicleId', '==', 'v9'))));
    await assertFails(getDocs(query(col('drv3', name), where('vehicleId', '==', 'v3'))));
    await assertFails(getDocs(col('drv', name)));
    for (const uid of ['tripMgr', 'stranger', 'claimant', 'sasUser', ...NOBODY]) {
      await assertFails(getDocs(col(uid, name)));
      await assertFails(getDocs(query(col(uid, name), where('vehicleId', '==', 'v1'))));
    }
  }
  await assertSucceeds(getDoc(ref('drv', 'vehicleManagementInsurance/r1')));
  await assertFails(getDoc(ref('drv', 'vehicleManagementInsurance/r9')));
  // The overview's month figures.
  await assertSucceeds(getDocs(query(col('fleet', 'vehicleManagementMaintenanceLogs'), where('serviceDate', '>=', '2026-10-01'), where('serviceDate', '<', '2026-11-01'))));
  await assertSucceeds(getDocs(query(col('fleet', 'vehicleManagementMaintenanceLogs'), orderBy('serviceDate', 'desc'))));
});

test('registers: Add/Import creates, Edit edits, Add archives the record it renews, Delete deletes', async () => {
  const insRef = doc(col('ins', 'vehicleManagementInsurance'));
  await assertSucceeds(setDoc(insRef, { vehicleId: 'v1', policyNumber: 'P1' }));
  await assertSucceeds(updateDoc(ref('ins', insRef.path), { policyNumber: 'P2', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('insAdd', 'vehicleManagementInsurance/old'), { renewalStatus: 'Renewed', renewedById: insRef.id, renewedAt: serverTimestamp(), isArchived: true }));
  await assertFails(updateDoc(ref('insAdd', 'vehicleManagementInsurance/old'), { premiumAmount: 1 }));
  // The workflow marks the policy it opened a case for.
  await assertSucceeds(updateDoc(ref('insAdd', 'vehicleManagementInsurance/r1'), { workflowCaseId: 'r1', renewalStatus: 'Workflow Started', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('insView', 'vehicleManagementInsurance/r1'), { workflowCaseId: 'r1' }));
  await assertSucceeds(deleteDoc(ref('ins', insRef.path)));
  await assertFails(deleteDoc(ref('insAdd', 'vehicleManagementInsurance/r9')));
  await assertFails(setDoc(doc(col('insView', 'vehicleManagementInsurance')), { vehicleId: 'v1' }));

  await assertSucceeds(addDoc(col('puc', 'vehicleManagementPuc'), { vehicleId: 'v1', certificateNumber: 'C' }));
  await assertSucceeds(updateDoc(ref('puc', 'vehicleManagementPuc/old'), { renewalStatus: 'Renewed', isArchived: true }));
  await assertFails(addDoc(col('puc', 'vehicleManagementFitness'), { vehicleId: 'v1' }));
  for (const [name] of REGISTERS) {
    await assertFails(addDoc(col('fleet', name), { vehicleId: 'v1' }));
    await assertFails(updateDoc(ref('drv', `${name}/r1`), { vehicleId: 'v1' }));
    await assertFails(deleteDoc(ref('vmaster', `${name}/r1`)));
  }
});

/* ── Fuel ── */

test('fuel: the shell reads the register; a driver reads their own fill-ups and their vehicle\'s', async () => {
  for (const uid of FLEET) await assertSucceeds(getDocs(col(uid, 'vehicleManagementFuelLogs')));
  await assertSucceeds(getDocs(query(col('fuelMgr', 'vehicleManagementFuelLogs'), where('fuelDate', '>=', '2026-10-01'), where('fuelDate', '<', '2026-11-01'))));
  await assertSucceeds(getDocs(query(col('driverMgr', 'vehicleManagementFuelLogs'), where('driverId', '==', 'd1'), limit(1))));
  // driver-mobile hub and fuel page; vehicle details.
  await assertSucceeds(getDocs(query(col('drv', 'vehicleManagementFuelLogs'), where('driverId', '==', 'd1'))));
  await assertSucceeds(getDocs(query(col('drv', 'vehicleManagementFuelLogs'), where('vehicleId', '==', 'v1'))));
  await assertSucceeds(getDocs(query(col('mob', 'vehicleManagementFuelLogs'), where('driverId', '==', 'd2'))));
  await assertFails(getDocs(query(col('drv', 'vehicleManagementFuelLogs'), where('driverId', '==', 'd9'))));
  await assertFails(getDocs(query(col('drv', 'vehicleManagementFuelLogs'), where('vehicleId', '==', 'v9'))));
  await assertFails(getDocs(col('drv', 'vehicleManagementFuelLogs')));
  for (const uid of ['stranger', 'sasUser', ...NOBODY]) await assertFails(getDocs(col(uid, 'vehicleManagementFuelLogs')));
});

test('fuel: drivers file their own; the register writes by action', async () => {
  const entry = { vehicleId: 'v1', fuelDate: '2026-10-05', totalAmount: 900, driverId: 'd1', enteredByUserId: 'uDrv', fuelStatus: 'Submitted', sourceApp: 'Driver Mobile', createdAt: serverTimestamp() };
  await assertSucceeds(addDoc(col('drv', 'vehicleManagementFuelLogs'), entry));
  await assertSucceeds(addDoc(col('mob', 'vehicleManagementFuelLogs'), { ...entry, vehicleId: 'v2', driverId: 'd2', enteredByUserId: 'uMob' }));
  // Own vehicle (no company vehicle) and a coordinator with a driver-app grant.
  await assertSucceeds(addDoc(col('drvRole', 'vehicleManagementFuelLogs'), { ...entry, vehicleId: '', driverId: 'd4', enteredByUserId: 'uRole' }));
  await assertFails(addDoc(col('drv', 'vehicleManagementFuelLogs'), { ...entry, driverId: 'd9' }));
  await assertFails(addDoc(col('drv', 'vehicleManagementFuelLogs'), { ...entry, enteredByUserId: 'uOther' }));
  await assertFails(addDoc(col('drv', 'vehicleManagementFuelLogs'), { ...entry, sourceApp: 'Register' }));
  await assertFails(addDoc(col('stranger', 'vehicleManagementFuelLogs'), { ...entry, enteredByUserId: 'uX' }));
  await assertFails(updateDoc(ref('drv', 'vehicleManagementFuelLogs/f1'), { totalAmount: 1 }));
  await assertFails(deleteDoc(ref('drv', 'vehicleManagementFuelLogs/f1')));

  const logRef = doc(col('fuelMgr', 'vehicleManagementFuelLogs'));
  await assertSucceeds(setDoc(logRef, { vehicleId: 'v1', totalAmount: 5 }));
  await assertSucceeds(updateDoc(ref('fuelMgr', logRef.path), { totalAmount: 6 }));
  await assertSucceeds(deleteDoc(ref('fuelMgr', logRef.path)));
  await assertFails(updateDoc(ref('fleet', 'vehicleManagementFuelLogs/f9'), { totalAmount: 6 }));
});

test('fuel: Site Account Statement keeps its expense\'s log, for whoever may write that expense', async () => {
  const log = (expenseId, projectId, extra = {}) => ({
    vehicleId: 'v1', vehicleNumber: 'KA01', fuelType: 'Diesel', fuelDate: '2026-10-05', totalAmount: 70,
    fuelStatus: 'Submitted', remarks: 'Recorded from Site Account Statement', source: 'site-account-statement',
    sasExpenseId: expenseId, sasProjectId: projectId, sasProjectName: 'P', enteredByUserId: 'uS', enteredByName: 'S',
    updatedAt: serverTimestamp(), ...extra,
  });
  // A site user with no role, the project's recorder: first link, then a re-save.
  await assertSucceeds(setDoc(ref('sasUser', 'vehicleManagementFuelLogs/sas-e3'), log('e3', 'P1', { createdAt: serverTimestamp() }), { merge: true }));
  await assertSucceeds(setDoc(ref('sasUser', 'vehicleManagementFuelLogs/sas-e1'), log('e1', 'P1'), { merge: true }));
  await assertSucceeds(setDoc(ref('sasAll', 'vehicleManagementFuelLogs/sas-e2'), log('e2', 'P2', { createdAt: serverTimestamp() }), { merge: true }));
  // Not another project's expense, not a project the expense is not in, not under another id.
  await assertFails(setDoc(ref('sasUser', 'vehicleManagementFuelLogs/sas-e2'), log('e2', 'P2'), { merge: true }));
  await assertFails(setDoc(ref('sasUser', 'vehicleManagementFuelLogs/sas-e1'), log('e1', 'P2'), { merge: true }));
  await assertFails(setDoc(ref('sasUser', 'vehicleManagementFuelLogs/sas-e9'), log('e3', 'P1'), { merge: true }));
  await assertFails(setDoc(ref('sasUser', 'vehicleManagementFuelLogs/sas-e4'), log('e4', 'P1'), { merge: true }));
  await assertFails(setDoc(ref('sasUser', 'vehicleManagementFuelLogs/f1'), log('e1', 'P1'), { merge: true }));
  await assertFails(setDoc(ref('stranger', 'vehicleManagementFuelLogs/sas-e1'), log('e1', 'P1'), { merge: true }));
  // Removed when the expense goes (already deleted, or never logged).
  await assertSucceeds(deleteDoc(ref('sasUser', 'vehicleManagementFuelLogs/sas-e3')));
  await assertSucceeds(deleteDoc(ref('sasUser', 'vehicleManagementFuelLogs/sas-missing')));
  await assertFails(deleteDoc(ref('stranger', 'vehicleManagementFuelLogs/sas-e1')));
  await assertFails(deleteDoc(ref('sasUser', 'vehicleManagementFuelLogs/sas-e2')));
  await assertFails(deleteDoc(ref('sasUser', 'vehicleManagementFuelLogs/f1')));
  await assertFails(deleteDoc(ref('sasUser', 'vehicleManagementFuelLogs/missing')));
});

/* ── Daily status ── */

test('daily status: filed and read by the driver; read in the shell', async () => {
  await assertSucceeds(getDocs(query(col('drv', 'vehicleManagementDriverDailyStatus'), where('driverId', '==', 'd1'))));
  await assertFails(getDocs(query(col('drv', 'vehicleManagementDriverDailyStatus'), where('driverId', '==', 'd9'))));
  await assertFails(getDocs(col('drv', 'vehicleManagementDriverDailyStatus')));
  await assertSucceeds(getDocs(query(col('driverMgr', 'vehicleManagementDriverDailyStatus'), where('driverId', '==', 'd9'), limit(1))));
  await assertSucceeds(getDocs(query(col('fleet', 'vehicleManagementDriverDailyStatus'), where('vehicleNumber', '==', 'KA01'))));
  await assertFails(getDocs(col('stranger', 'vehicleManagementDriverDailyStatus')));
  const entry = { driverId: 'd1', vehicleId: 'v1', statusDate: '2026-10-06', runningStatus: 'Running', sourceApp: 'Driver Mobile' };
  await assertSucceeds(addDoc(col('drv', 'vehicleManagementDriverDailyStatus'), entry));
  await assertSucceeds(addDoc(col('mob', 'vehicleManagementDriverDailyStatus'), { ...entry, driverId: 'd2', vehicleId: 'v2' }));
  await assertFails(addDoc(col('drv', 'vehicleManagementDriverDailyStatus'), { ...entry, driverId: 'd9' }));
  await assertFails(addDoc(col('fleet', 'vehicleManagementDriverDailyStatus'), entry));
  await assertFails(updateDoc(ref('drv', 'vehicleManagementDriverDailyStatus/s1'), { runningStatus: 'Idle' }));
});

/* ── Trips and their track ── */

test('trips: trip managers read every trip; a driver reads their own, as the pages ask', async () => {
  for (const uid of ['tripMgr', 'vmTripMgr']) {
    await assertSucceeds(getDocs(col(uid, 'vehicleManagementTrips')));
  }
  await assertSucceeds(getDocs(query(col('vmTripMgr', 'vehicleManagementTrips'), where('startTimeIso', '>=', '2026-10-01'), where('startTimeIso', '<', '2026-11-01'))));
  await assertSucceeds(getCountFromServer(query(col('vmTripMgr', 'vehicleManagementTrips'), where('tripStatus', '==', 'In Progress'))));
  await assertSucceeds(getDocs(query(col('vmTripMgr', 'vehicleManagementTrips'), where('vehicleNumber', '==', 'KA01'))));
  // The delete checks.
  await assertSucceeds(getDocs(query(col('vmaster', 'vehicleManagementTrips'), where('vehicleId', '==', 'v1'), limit(1))));
  await assertSucceeds(getDocs(query(col('driverMgr', 'vehicleManagementTrips'), where('driverId', '==', 'd9'), limit(1))));
  // Driver trips page, the hub, and the trip log's pages.
  await assertSucceeds(getDocs(query(col('drv', 'vehicleManagementTrips'), where('driverId', '==', 'd1'))));
  const first = await assertSucceeds(getDocs(query(col('drv', 'vehicleManagementTrips'), where('driverId', '==', 'd1'), orderBy('startTimeIso', 'desc'), limit(30))));
  await assertSucceeds(getDocs(query(col('drv', 'vehicleManagementTrips'), where('driverId', '==', 'd1'), orderBy('startTimeIso', 'desc'), startAfter(first.docs[first.docs.length - 1]), limit(30))));
  await assertFails(getDocs(query(col('drv', 'vehicleManagementTrips'), where('driverId', '==', 'd9'))));
  await assertFails(getDocs(col('drv', 'vehicleManagementTrips')));
  for (const uid of ['fleet', 'reports', 'vmasterView', 'stranger', ...NOBODY]) {
    await assertFails(getDocs(col(uid, 'vehicleManagementTrips')));
  }
});

test('trips: the driver starts, tracks and stops their own; viewing the route corrects its distance', async () => {
  const start = { tripStatus: 'In Progress', driverId: 'd1', driverName: 'One', linkedUserId: 'uDrv', vehicleId: 'v1', startTimeIso: '2026-10-06T08:00:00Z', totalPoints: 0, totalDistanceKm: 0, sourceApp: 'Driver Mobile', createdAt: serverTimestamp() };
  const trip = await assertSucceeds(addDoc(col('drv', 'vehicleManagementTrips'), start));
  await assertSucceeds(addDoc(col('drv', 'vehicleManagementTripLocations'), { tripId: trip.id, driverId: 'd1', vehicleId: 'v1', lat: 1, lng: 2, recordedAtIso: 'x', createdAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('drv', trip.path), { lastLocationLat: 1, lastLocationLng: 2, totalPoints: increment(1), totalDistanceKm: increment(0.2), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('drv', trip.path), { tripStatus: 'Completed', endTimeIso: 'y', endLat: 1, endLng: 2, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('drv', trip.path), { driverId: 'd9' }));
  await assertSucceeds(addDoc(col('mob', 'vehicleManagementTrips'), { ...start, driverId: 'd2', linkedUserId: 'uMob', vehicleId: 'v2' }));
  // Not as someone else, not for someone else's driver record, not on someone else's trip.
  await assertFails(addDoc(col('drv', 'vehicleManagementTrips'), { ...start, driverId: 'd9' }));
  await assertFails(addDoc(col('drv', 'vehicleManagementTrips'), { ...start, linkedUserId: 'uOther' }));
  await assertFails(addDoc(col('drv', 'vehicleManagementTrips'), { ...start, tripStatus: 'Completed' }));
  await assertFails(addDoc(col('stranger', 'vehicleManagementTrips'), { ...start, linkedUserId: 'uX' }));
  await assertFails(updateDoc(ref('drv', 'vehicleManagementTrips/t9'), { totalPoints: 1 }));
  await assertFails(addDoc(col('drv', 'vehicleManagementTripLocations'), { tripId: 't9', driverId: 'd1', lat: 1, lng: 2 }));
  await assertFails(addDoc(col('drv', 'vehicleManagementTripLocations'), { tripId: 't9', driverId: 'd9', lat: 1, lng: 2 }));
  await assertFails(addDoc(col('drv', 'vehicleManagementTripLocations'), { tripId: 'nope', driverId: 'd1', lat: 1, lng: 2 }));
  // Trip Management corrects the distance, and nothing else.
  await assertSucceeds(updateDoc(ref('tripMgr', 'vehicleManagementTrips/t9'), { totalDistanceKm: 3.4, totalPoints: 4, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('tripMgr', 'vehicleManagementTrips/t9'), { tripStatus: 'In Progress' }));
  await assertFails(deleteDoc(ref('tripMgr', 'vehicleManagementTrips/t9')));
});

test('trip track: trip managers and the trip\'s own driver read it; append-only', async () => {
  await assertSucceeds(getDocs(query(col('drv', 'vehicleManagementTripLocations'), where('tripId', '==', 't1'))));
  await assertFails(getDocs(query(col('drv', 'vehicleManagementTripLocations'), where('tripId', '==', 't9'))));
  await assertFails(getDocs(col('drv', 'vehicleManagementTripLocations')));
  await assertSucceeds(getDocs(query(col('tripMgr', 'vehicleManagementTripLocations'), where('tripId', '==', 't9'))));
  await assertSucceeds(getDocs(query(col('vmTripMgr', 'vehicleManagementTripLocations'), where('tripId', '==', 't1'))));
  for (const uid of ['fleet', 'vmaster', 'driverMgr', 'stranger', ...NOBODY]) {
    await assertFails(getDocs(query(col(uid, 'vehicleManagementTripLocations'), where('tripId', '==', 't9'))));
  }
  await assertFails(updateDoc(ref('drv', 'vehicleManagementTripLocations/l1'), { lat: 9 }));
  await assertFails(deleteDoc(ref('tripMgr', 'vehicleManagementTripLocations/l9')));
});

/* ── Employee trip reimbursement ── */

test('employee trips: everyone files and reads their own; approvers read and decide all', async () => {
  await assertSucceeds(getDocs(query(col('claimant', 'vehicleManagementEmployeeTrips'), where('submittedByUserId', '==', 'uC'))));
  await assertFails(getDocs(col('claimant', 'vehicleManagementEmployeeTrips')));
  await assertFails(getDocs(query(col('claimant', 'vehicleManagementEmployeeTrips'), where('submittedByUserId', '==', 'uOther'))));
  for (const uid of ['claimMgr', 'claimEditor', 'driverMgr', 'tripMgr']) {
    await assertSucceeds(getDocs(col(uid, 'vehicleManagementEmployeeTrips')));
  }
  for (const uid of ['fleet', 'vmTripMgr', 'stranger', ...NOBODY]) {
    await assertFails(getDocs(col(uid, 'vehicleManagementEmployeeTrips')));
  }

  const claim = { tripDate: '2026-10-05', reimbursementAmount: 40, approvalStatus: 'Submitted', approverRemarks: '', submittedByUserId: 'uC', submittedByName: 'Claimant' };
  const mine = await assertSucceeds(addDoc(col('claimant', 'vehicleManagementEmployeeTrips'), claim));
  await assertFails(addDoc(col('claimant', 'vehicleManagementEmployeeTrips'), { ...claim, approvalStatus: 'Approved' }));
  await assertFails(addDoc(col('claimant', 'vehicleManagementEmployeeTrips'), { ...claim, submittedByUserId: 'uOther' }));
  await assertSucceeds(updateDoc(ref('claimant', mine.path), { reimbursementAmount: 45, approvalStatus: 'Submitted', approverRemarks: '' }));
  // A claim saved before it had remarks: the self-mode form now sends them blank.
  await assertSucceeds(updateDoc(ref('claimant', 'vehicleManagementEmployeeTrips/c1'), { reimbursementAmount: 12, approvalStatus: 'Submitted', approverRemarks: '' }));
  await assertFails(updateDoc(ref('claimant', mine.path), { approvalStatus: 'Approved' }));
  await assertFails(updateDoc(ref('claimant', mine.path), { approverRemarks: 'fine' }));
  await assertFails(updateDoc(ref('claimant', mine.path), { submittedByUserId: 'uOther' }));
  await assertFails(updateDoc(ref('claimant', 'vehicleManagementEmployeeTrips/c2'), { reimbursementAmount: 99 }));
  await assertFails(updateDoc(ref('claimant', 'vehicleManagementEmployeeTrips/c9'), { reimbursementAmount: 99 }));
  await assertFails(deleteDoc(ref('claimant', mine.path)));

  await assertSucceeds(updateDoc(ref('claimMgr', mine.path), { approvalStatus: 'Approved', approverRemarks: 'ok' }));
  await assertSucceeds(addDoc(col('claimEditor', 'vehicleManagementEmployeeTrips'), { ...claim, submittedByUserId: 'uOther', approvalStatus: 'Approved' }));
  await assertSucceeds(deleteDoc(ref('claimEditor', mine.path)));
});

/* ── The insurance renewal workflow ── */

test('workflow cases: the board reads all; the dashboard reads the caller\'s own; Add/Edit works them', async () => {
  for (const uid of ['ins', 'insAdd', 'insView']) {
    await assertSucceeds(getDocs(col(uid, 'vehicleManagementInsuranceWorkflowCases')));
  }
  await assertSucceeds(getDoc(ref('insAdd', 'vehicleManagementInsuranceWorkflowCases/i9')));
  // work-dashboard-sources.ts: `assigneeIds array-contains me`, limit 100.
  await assertSucceeds(getDocs(query(col('assignee', 'vehicleManagementInsuranceWorkflowCases'), where('assigneeIds', 'array-contains', 'uA'), limit(100))));
  await assertSucceeds(getDocs(query(col('stranger', 'vehicleManagementInsuranceWorkflowCases'), where('assigneeIds', 'array-contains', 'uX'), limit(100))));
  await assertFails(getDocs(query(col('assignee', 'vehicleManagementInsuranceWorkflowCases'), where('assigneeIds', 'array-contains', 'uOther'), limit(100))));
  for (const uid of ['assignee', 'fleet', 'vmaster', 'stranger', ...NOBODY]) {
    await assertFails(getDocs(col(uid, 'vehicleManagementInsuranceWorkflowCases')));
  }

  await assertSucceeds(setDoc(ref('insAdd', 'vehicleManagementInsuranceWorkflowCases/r1'), { insuranceId: 'r1', status: 'Open', assigneeIds: ['uA'], history: [] }));
  await assertSucceeds(updateDoc(ref('ins', 'vehicleManagementInsuranceWorkflowCases/i1'), { status: 'Quotation Requested' }));
  await assertFails(updateDoc(ref('insView', 'vehicleManagementInsuranceWorkflowCases/i1'), { status: 'Closed' }));
  await assertFails(updateDoc(ref('assignee', 'vehicleManagementInsuranceWorkflowCases/i1'), { status: 'Closed' }));
  await assertFails(deleteDoc(ref('ins', 'vehicleManagementInsuranceWorkflowCases/i1')));

  await assertSucceeds(addDoc(col('insAdd', 'vehicleManagementInsuranceWorkflowActivities'), { caseId: 'i1', action: 'Comment', userId: 'uIA', createdAt: serverTimestamp() }));
  await assertFails(addDoc(col('insAdd', 'vehicleManagementInsuranceWorkflowActivities'), { caseId: 'i1', action: 'Comment', userId: 'uOther' }));
  await assertFails(addDoc(col('insView', 'vehicleManagementInsuranceWorkflowActivities'), { caseId: 'i1', userId: 'uIV' }));
  await assertFails(getDocs(col('ins', 'vehicleManagementInsuranceWorkflowActivities')));
});
