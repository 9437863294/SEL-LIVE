// Stage 2, Bank Balance and Loan: each collection follows the page permission its screens check
// (`Bank Balance.<Page>`, src/lib/permissions.ts), and Loan any grant in the module, read from
// userPermissions/{authUid}. Query shapes are the screens' own (src/app/(protected)/bank-balance,
// src/components/bank-balance, src/app/(protected)/loan).
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, runTransaction, setDoc, Timestamp,
  updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { as, rulesEnv, seed } from './helpers.mjs';

const BB = 'Bank Balance';
const perms = (userDocId, p = {}) => ({ v: 1, p, active: true, userDocId, roleNames: [], projectIds: [], departmentIds: [] });

const ALL_BB = {
  [BB]: ['View Module'],
  [`${BB}.Accounts`]: ['Add', 'Delete', 'Edit', 'View'],
  [`${BB}.DP Management`]: ['Add', 'Delete', 'View'],
  [`${BB}.Daily Log`]: ['View'],
  [`${BB}.Interest Rate`]: ['Add', 'Delete', 'View'],
  [`${BB}.Monthly Interest`]: ['Edit', 'View'],
  [`${BB}.Payment Entry Settings`]: ['Edit', 'View'],
  [`${BB}.Expenses`]: ['Add', 'Delete', 'View'],
  [`${BB}.Expenses Log`]: ['Add', 'Delete', 'View'],
  [`${BB}.Receipts`]: ['Add', 'Delete', 'View'],
  [`${BB}.Internal Transaction`]: ['Add', 'Delete', 'Edit', 'View'],
  [`${BB}.Reports`]: ['View'],
};

const now = Timestamp.fromDate(new Date('2026-10-01T12:00:00Z'));
const row = (extra) => ({ date: now, accountId: 'A1', description: 'x', amount: 10, createdAt: now, ...extra });

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'userPermissions/admin': perms('uAdmin', ALL_BB),
    'userPermissions/module': perms('uMod', { [BB]: ['View Module'] }),
    // The legacy page names are filed under both names, as the server writes them.
    'userPermissions/payView': perms('uPV', { [`${BB}.Expenses`]: ['View'], [`${BB}.Expenses Log`]: ['View'] }),
    'userPermissions/recView': perms('uRV', { [`${BB}.Receipts`]: ['View'], [`${BB}.Receipts Log`]: ['View'] }),
    'userPermissions/payAdd': perms('uPA', { [`${BB}.Expenses`]: ['Add', 'View'] }),
    // An email-matched legacy account: signs in under another uid, same users document.
    'userPermissions/legacyAuth': perms('uPA', { [`${BB}.Expenses`]: ['Add', 'View'] }),
    'userPermissions/payDel': perms('uPD', { [`${BB}.Expenses`]: ['Delete', 'View'] }),
    'userPermissions/recAdd': perms('uRA', { [`${BB}.Receipts`]: ['Add', 'Delete', 'View'] }),
    'userPermissions/itAdd': perms('uIA', { [`${BB}.Internal Transaction`]: ['Add'] }),
    'userPermissions/itEdit': perms('uIE', { [`${BB}.Internal Transaction`]: ['Edit', 'View'] }),
    'userPermissions/itDel': perms('uID', { [`${BB}.Internal Transaction`]: ['Delete', 'View'] }),
    'userPermissions/accounts': perms('uAcc', { [`${BB}.Accounts`]: ['Add', 'Delete', 'Edit', 'View'] }),
    'userPermissions/dp': perms('uDp', { [`${BB}.DP Management`]: ['Add', 'Delete', 'View'] }),
    'userPermissions/rate': perms('uRate', { [`${BB}.Interest Rate`]: ['Add', 'View'] }),
    'userPermissions/mi': perms('uMi', { [`${BB}.Monthly Interest`]: ['Edit', 'View'] }),
    'userPermissions/miView': perms('uMiV', { [`${BB}.Monthly Interest`]: ['View'] }),
    'userPermissions/dailyLog': perms('uDl', { [`${BB}.Daily Log`]: ['View'] }),
    'userPermissions/reports': perms('uRep', { [`${BB}.Reports`]: ['View'] }),
    'userPermissions/pes': perms('uPes', { [`${BB}.Payment Entry Settings`]: ['Edit', 'View'] }),
    'userPermissions/pesView': perms('uPesV', { [`${BB}.Payment Entry Settings`]: ['View'] }),
    'userPermissions/loanDash': perms('uLd', { 'Loan.Dashboard': ['View'] }),
    'userPermissions/loanModule': perms('uLm', { Loan: ['View Module'] }),
    'userPermissions/loanReports': perms('uLr', { 'Loan.Reports': ['View'] }),
    'userPermissions/fd': perms('uFd', { 'Fixed Deposit Management.FD Register': ['Add', 'View'] }),
    'userPermissions/stranger': perms('uX', { 'Windows Agent.Reports': ['View'] }),
    'userPermissions/gone': { ...perms('uGone'), active: false },
    // `nodoc` has no permissions document at all.

    'bankAccounts/A1': { bankName: 'SBI', shortName: 'SBI CC', accountNumber: '1', accountType: 'Cash Credit', status: 'Active', drawingPower: [], interestRateLog: [] },
    'bankAccounts/A2': { bankName: 'HDFC', shortName: 'HDFC CA', accountNumber: '2', accountType: 'Current Account', status: 'Active', drawingPower: [], interestRateLog: [] },

    'bankExpenses/d1': row({ type: 'Debit', isContra: false, bankPaymentId: 'V1', voucherNo: 'BP/2026-27/0001' }),
    'bankExpenses/d2': row({ type: 'Debit', isContra: false }),
    'bankExpenses/d3': row({ type: 'Debit', isContra: false, bankPaymentId: 'V2' }),
    'bankExpenses/c1': row({ type: 'Credit', isContra: false }),
    'bankExpenses/c2': row({ type: 'Credit', isContra: false, billCollectionId: 'bc1' }),
    'bankExpenses/t1': row({ type: 'Debit', isContra: true, contraId: 'K1' }),
    'bankExpenses/t2': row({ type: 'Credit', isContra: true, contraId: 'K1', accountId: 'A2' }),
    'bankExpenses/t3': row({ type: 'Debit', isContra: true, contraId: 'K2' }),
    'bankExpenses/t4': row({ type: 'Credit', isContra: true, contraId: 'K2', accountId: 'A2' }),

    'bankPayments/V1': { voucherNo: 'BP/2026-27/0001', mode: 'Cheque', accountId: 'A1', instrumentNo: '100', instrumentDate: '2026-10-01', status: 'Issued', lines: [{ lineId: 'L1', expenseId: 'd1', amount: 10 }], total: 10, createdById: 'uPA' },
    'bankPayments/V2': { voucherNo: 'BP/2026-27/0002', mode: 'Cheque', accountId: 'A1', instrumentNo: '101', instrumentDate: '2026-10-01', status: 'Issued', lines: [{ lineId: 'L1', expenseId: 'd3', requisitionId: 'R2', amount: 10 }], total: 10, createdById: 'uPA' },
    'bankPayments/V3': { voucherNo: 'BP/2026-27/0003', mode: 'Cheque', accountId: 'A1', instrumentNo: '102', status: 'Cancelled', lines: [], total: 0 },
    'bankBalanceCounters/paymentVoucher': { fy: '2026-27', next: 4 },
    'bankInstrumentNos/A1_cheque_100': { voucherId: 'V1', voucherNo: 'BP/2026-27/0001', accountId: 'A1', mode: 'Cheque', instrumentNo: '100' },
    'bankInstrumentNos/A1_cheque_101': { voucherId: 'V2', voucherNo: 'BP/2026-27/0002', accountId: 'A1', mode: 'Cheque', instrumentNo: '101' },
    'bankBalanceSettings/paymentEntry': { mandatoryFields: {}, allowDirectPayments: true },
    'paymentMethods/m1': { name: 'NEFT' },
    'monthlyInterest/2026-09': { A1: 1234 },

    // Daily Requisition's own, still on the catch-all: a voucher pays it in the same transaction.
    'dailyRequisitions/R1': { status: 'Received for Payment', netAmount: 100, paidAmount: 0, payments: [] },
    'dailyRequisitions/R2': { status: 'Partially Paid', netAmount: 100, paidAmount: 10, payments: [{ bankPaymentId: 'V2', lineId: 'L1', amount: 10 }] },

    'loans/L1': { accountNo: 'LN1', loanAmount: 1000, totalPaid: 0, status: 'Active', createdAt: now },
    'loans/L1/emis/e1': { emiNo: 1, amount: 100, status: 'Pending' },
    'loans/L1/emis/e2': { emiNo: 2, amount: 100, status: 'Pending' },
  });
});
after(async () => env?.cleanup());

const db = (uid) => as(env, uid);
const OUTSIDERS = ['stranger', 'gone', 'nodoc'];

test('accounts: any signed-in user reads the master (pickers in Loan, FD, BG, LC, Bill Tracking)', async () => {
  for (const uid of ['admin', 'module', 'payView', 'loanDash', 'loanModule', 'fd', 'stranger', 'nodoc']) {
    await assertSucceeds(getDocs(collection(db(uid), 'bankAccounts')));
  }
  await assertSucceeds(getDoc(doc(db('payView'), 'bankAccounts/A1')));
  await assertFails(getDocs(collection(db(null), 'bankAccounts')));
});

test('accounts: Accounts writes the master, DP Management and Interest Rate only their own log', async () => {
  const acc = db('accounts');
  const created = await assertSucceeds(addDoc(collection(acc, 'bankAccounts'), {
    openingBalance: 0, openingUtilization: 0, bankName: 'Axis', shortName: 'AX', accountNumber: '3',
    accountType: 'Current Account', status: 'Active', currentBalance: 0, drawingPower: [], interestRateLog: [],
  }));
  await assertSucceeds(updateDoc(doc(acc, 'bankAccounts/A2'), { branch: 'Main', ifsc: 'HDFC0001', openingBalance: 5 }));
  await assertFails(updateDoc(doc(acc, 'bankAccounts/A1'), { drawingPower: [{ id: 'x', amount: 1 }] }));
  await assertSucceeds(deleteDoc(created));

  await assertSucceeds(updateDoc(doc(db('dp'), 'bankAccounts/A1'), { drawingPower: [{ id: 'd', fromDate: '2026-04-01', toDate: null, amount: 500 }] }));
  await assertFails(updateDoc(doc(db('dp'), 'bankAccounts/A1'), { bankName: 'Hacked' }));
  await assertFails(updateDoc(doc(db('dp'), 'bankAccounts/A1'), { interestRateLog: [{ id: 'r', rate: 1 }], drawingPower: [] }));
  await assertSucceeds(updateDoc(doc(db('rate'), 'bankAccounts/A1'), { interestRateLog: [{ id: 'r', fromDate: '2026-04-01', toDate: null, rate: 9 }] }));
  await assertFails(updateDoc(doc(db('rate'), 'bankAccounts/A1'), { drawingPower: [] }));

  for (const uid of ['module', 'payAdd', 'reports', 'loanDash', 'fd', ...OUTSIDERS]) {
    await assertFails(addDoc(collection(db(uid), 'bankAccounts'), { bankName: 'x' }));
    await assertFails(updateDoc(doc(db(uid), 'bankAccounts/A2'), { status: 'Inactive' }));
    await assertFails(deleteDoc(doc(db(uid), 'bankAccounts/A2')));
  }
});

test('ledger: every balance screen reads it whole; the registers only their own side', async () => {
  // Dashboard, Daily Log, Interest Rate, Monthly Interest, reports, Transfers, New Payment.
  for (const uid of ['admin', 'module', 'dailyLog', 'rate', 'miView', 'reports', 'itAdd', 'itEdit', 'payAdd', 'legacyAuth']) {
    await assertSucceeds(getDocs(collection(db(uid), 'bankExpenses')));
  }
  const payments = (uid) => query(collection(db(uid), 'bankExpenses'), where('type', '==', 'Debit'), where('isContra', '==', false));
  const receipts = (uid) => query(collection(db(uid), 'bankExpenses'), where('type', '==', 'Credit'), where('isContra', '==', false));
  await assertSucceeds(getDocs(payments('payView')));
  await assertSucceeds(getDocs(receipts('recView')));
  await assertSucceeds(getDocs(receipts('recAdd')));
  await assertFails(getDocs(receipts('payView')));
  await assertFails(getDocs(payments('recView')));
  await assertFails(getDocs(collection(db('payView'), 'bankExpenses')));
  await assertFails(getDocs(collection(db('recView'), 'bankExpenses')));
  await assertSucceeds(getDoc(doc(db('payView'), 'bankExpenses/d2')));
  await assertFails(getDoc(doc(db('payView'), 'bankExpenses/c1')));
  await assertFails(getDoc(doc(db('payView'), 'bankExpenses/t1')));

  // Transfers' edit and delete find the legs by contraId.
  await assertSucceeds(getDocs(query(collection(db('itEdit'), 'bankExpenses'), where('contraId', '==', 'K1'))));
  await assertSucceeds(getDocs(query(collection(db('itDel'), 'bankExpenses'), where('contraId', '==', 'K1'))));

  for (const uid of ['accounts', 'dp', 'pes', 'mi', 'loanDash', 'fd', ...OUTSIDERS]) {
    if (uid === 'mi') continue; // Monthly Interest View reads it.
    await assertFails(getDocs(collection(db(uid), 'bankExpenses')));
    await assertFails(getDocs(payments(uid)));
  }
  await assertFails(getDocs(collection(db(null), 'bankExpenses')));
});

test('ledger: receipts, transfers and their removal follow their own pages', async () => {
  // New Receipt: a transaction of Credit rows.
  const rec = db('recAdd');
  await assertSucceeds(runTransaction(rec, async (tx) => {
    tx.set(doc(collection(rec, 'bankExpenses')), row({ type: 'Credit', isContra: false }));
    tx.set(doc(collection(rec, 'bankExpenses')), row({ type: 'Credit', isContra: false, amount: 5 }));
  }));
  await assertFails(addDoc(collection(rec, 'bankExpenses'), row({ type: 'Debit', isContra: false })));
  await assertFails(addDoc(collection(rec, 'bankExpenses'), row({ type: 'Credit', isContra: true, contraId: 'Z' })));
  await assertFails(addDoc(collection(rec, 'bankExpenses'), row({ type: 'Credit', isContra: false, billCollectionId: 'forged' })));
  await assertFails(addDoc(collection(db('admin'), 'bankExpenses'), row({ type: 'Credit', isContra: false, billCollectionId: 'forged' })));
  await assertFails(addDoc(collection(db('admin'), 'bankExpenses'), row({ type: 'Other', isContra: false })));
  await assertFails(addDoc(collection(db('payAdd'), 'bankExpenses'), row({ type: 'Credit', isContra: false })));

  // The Receipts register's delete (a transaction of one delete), Bill Tracking's posted ones included.
  await assertSucceeds(runTransaction(rec, async (tx) => { tx.delete(doc(rec, 'bankExpenses/c1')); }));
  await assertSucceeds(runTransaction(rec, async (tx) => { tx.delete(doc(rec, 'bankExpenses/c2')); }));
  await assertFails(runTransaction(rec, async (tx) => { tx.delete(doc(rec, 'bankExpenses/d2')); }));
  await assertFails(deleteDoc(doc(db('recView'), 'bankExpenses/t1')));
  await assertFails(deleteDoc(doc(db('payDel'), 'bankExpenses/t1')));
  const pd = db('payDel');
  await assertSucceeds(runTransaction(pd, async (tx) => { tx.delete(doc(pd, 'bankExpenses/d2')); }));

  // New Transfer: reads both accounts, then writes the pair.
  const it = db('itAdd');
  await assertSucceeds(runTransaction(it, async (tx) => {
    await tx.get(doc(it, 'bankAccounts/A1'));
    await tx.get(doc(it, 'bankAccounts/A2'));
    tx.set(doc(collection(it, 'bankExpenses')), row({ type: 'Debit', isContra: true, contraId: 'K9' }));
    tx.set(doc(collection(it, 'bankExpenses')), row({ type: 'Credit', isContra: true, contraId: 'K9', accountId: 'A2' }));
  }));
  await assertFails(addDoc(collection(it, 'bankExpenses'), row({ type: 'Debit', isContra: true })));
  await assertFails(addDoc(collection(it, 'bankExpenses'), row({ type: 'Debit', isContra: false })));
  await assertFails(addDoc(collection(db('payAdd'), 'bankExpenses'), row({ type: 'Debit', isContra: true, contraId: 'K8' })));

  // Editing a transfer: the legs found by contraId, deleted and rewritten in one batch.
  const ed = db('itEdit');
  const legs = await getDocs(query(collection(ed, 'bankExpenses'), where('contraId', '==', 'K1')));
  const batch = writeBatch(ed);
  legs.forEach((leg) => batch.delete(leg.ref));
  batch.set(doc(collection(ed, 'bankExpenses')), row({ type: 'Debit', isContra: true, contraId: 'K1', amount: 20 }));
  batch.set(doc(collection(ed, 'bankExpenses')), row({ type: 'Credit', isContra: true, contraId: 'K1', amount: 20, accountId: 'A2' }));
  await assertSucceeds(batch.commit());

  // Deleting one.
  const del = db('itDel');
  const k2 = await getDocs(query(collection(del, 'bankExpenses'), where('contraId', '==', 'K2')));
  const delBatch = writeBatch(del);
  k2.forEach((leg) => delBatch.delete(leg.ref));
  await assertSucceeds(delBatch.commit());
  await assertFails(addDoc(collection(del, 'bankExpenses'), row({ type: 'Debit', isContra: true, contraId: 'K7' })));

  for (const uid of ['module', 'reports', 'accounts', ...OUTSIDERS]) {
    await assertFails(addDoc(collection(db(uid), 'bankExpenses'), row({ type: 'Credit', isContra: false })));
    await assertFails(deleteDoc(doc(db(uid), 'bankExpenses/d1')));
  }
  await assertFails(updateDoc(doc(db('admin'), 'bankExpenses/d1'), { amount: 1 }));
});

test('New Payment: the voucher transaction, as the screen writes it', async () => {
  const issue = (uid, { createdById = 'uPA', next = 5, fy = '2026-27', key = 'A1_cheque_200' } = {}) => {
    const d = db(uid);
    return runTransaction(d, async (tx) => {
      const voucherRef = doc(collection(d, 'bankPayments'));
      await tx.get(voucherRef);
      await tx.get(doc(d, 'bankBalanceCounters/paymentVoucher'));
      await tx.get(doc(d, 'bankInstrumentNos', key));
      const r1 = await tx.get(doc(d, 'dailyRequisitions/R1'));
      const expenseRef = doc(collection(d, 'bankExpenses'));
      tx.set(expenseRef, row({ type: 'Debit', isContra: false, bankPaymentId: voucherRef.id, voucherNo: 'BP/2026-27/0004', requisitionId: 'R1' }));
      tx.set(voucherRef, {
        voucherNo: 'BP/2026-27/0004', mode: 'Cheque', accountId: 'A1', instrumentNo: '200', instrumentDate: '2026-10-01',
        issueDate: '2026-10-01', lines: [{ lineId: 'L1', requisitionId: 'R1', expenseId: expenseRef.id, amount: 10 }],
        total: 10, status: 'Issued', transferCopyUrl: '', remarks: '', createdById, createdByName: 'P', createdAt: now,
      });
      tx.update(doc(d, 'dailyRequisitions/R1'), { paidAmount: 10, status: 'Partially Paid', payments: [...(r1.data()?.payments ?? []), { bankPaymentId: voucherRef.id }], lastPaidAt: now });
      tx.set(doc(d, 'bankInstrumentNos', key), { voucherId: voucherRef.id, voucherNo: 'BP/2026-27/0004', accountId: 'A1', mode: 'Cheque', instrumentNo: '200', createdAt: now });
      tx.set(doc(d, 'bankBalanceCounters/paymentVoucher'), { fy, next });
    });
  };
  await assertFails(issue('payAdd', { createdById: 'someoneElse' }));
  await assertFails(issue('payAdd', { next: 3 }));
  await assertFails(issue('payAdd', { fy: '2025-26', next: 9 }));
  await assertFails(issue('payView'));
  await assertFails(issue('payDel'));
  await assertFails(issue('stranger', { createdById: 'uX' }));
  await assertSucceeds(issue('payAdd'));
  // The same person through an email-matched account, and the next financial year's first voucher.
  await assertSucceeds(issue('legacyAuth', { next: 6, key: 'A1_cheque_201' }));
  await assertSucceeds(issue('payAdd', { fy: '2027-28', next: 2, key: 'A1_cheque_202' }));
  // An instrument number already taken can be read (the screen refuses it) but not re-reserved.
  await assertFails(setDoc(doc(db('payAdd'), 'bankInstrumentNos/A1_cheque_100'), { voucherId: 'Vx' }));

  // Payment Entry settings and modes, read and added to from the form.
  const pa = db('payAdd');
  await assertSucceeds(getDoc(doc(pa, 'bankBalanceSettings/paymentEntry')));
  await assertSucceeds(getDocs(collection(pa, 'paymentMethods')));
  await assertSucceeds(getDocs(collection(pa, 'bankPayments')));
});

test('Cheque Register: clearing (Expenses Add) and cancelling (Expenses Delete), as recorded', async () => {
  const clear = (uid, clearedById) => {
    const d = db(uid);
    return runTransaction(d, async (tx) => {
      const ref = doc(d, 'bankPayments/V1');
      await tx.get(ref);
      await tx.get(doc(d, 'bankExpenses/d1'));
      tx.update(doc(d, 'bankExpenses/d1'), { clearedDate: '2026-10-02' });
      tx.update(ref, { status: 'Cleared', clearedDate: '2026-10-02', clearedById, clearedByName: 'P' });
    });
  };
  await assertFails(clear('payView', 'uPV'));
  await assertFails(clear('payDel', 'uPD'));
  await assertFails(clear('payAdd', 'uAdmin'));
  await assertSucceeds(clear('payAdd', 'uPA'));
  // Once cleared, it is closed to both.
  await assertFails(clear('payAdd', 'uPA'));
  await assertFails(updateDoc(doc(db('payAdd'), 'bankPayments/V2'), { status: 'Cleared', clearedDate: '2026-10-02', clearedById: 'uPA', clearedByName: 'P', total: 0 }));

  const cancel = (uid, closedById, voucher = 'V2', status = 'Cancelled') => {
    const d = db(uid);
    return runTransaction(d, async (tx) => {
      const voucherRef = doc(d, 'bankPayments', voucher);
      await tx.get(voucherRef);
      await tx.get(doc(d, 'dailyRequisitions/R2'));
      const reservation = doc(d, 'bankInstrumentNos/A1_cheque_101');
      await tx.get(reservation);
      tx.delete(doc(d, 'bankExpenses/d3'));
      tx.update(doc(d, 'dailyRequisitions/R2'), { paidAmount: 0, payments: [], status: 'Received for Payment' });
      tx.delete(reservation);
      tx.update(voucherRef, { status, closedReason: 'Wrong payee', closedAt: '2026-10-02', closedAtTs: now, closedById, closedByName: 'D' });
    });
  };
  await assertFails(cancel('payAdd', 'uPA'));
  await assertFails(cancel('payDel', 'uPA'));
  await assertFails(cancel('payDel', 'uPD', 'V3'));
  await assertSucceeds(cancel('payDel', 'uPD'));

  // Who sees the vouchers: the register's own permission, not the module or the reports.
  await assertSucceeds(getDocs(collection(db('payView'), 'bankPayments')));
  await assertSucceeds(getDoc(doc(db('payView'), 'bankPayments/V1')));
  for (const uid of ['module', 'reports', 'recView', 'loanDash', ...OUTSIDERS]) {
    await assertFails(getDocs(collection(db(uid), 'bankPayments')));
    await assertFails(getDoc(doc(db(uid), 'bankPayments/V1')));
    await assertFails(getDoc(doc(db(uid), 'bankInstrumentNos/A1_cheque_100')));
    await assertFails(getDoc(doc(db(uid), 'bankBalanceCounters/paymentVoucher')));
  }
  await assertFails(deleteDoc(doc(db('admin'), 'bankPayments/V1')));
});

test('Payment Entry settings and payment modes', async () => {
  await assertSucceeds(getDoc(doc(db('pesView'), 'bankBalanceSettings/paymentEntry')));
  await assertSucceeds(getDocs(collection(db('pesView'), 'paymentMethods')));
  await assertFails(setDoc(doc(db('pesView'), 'bankBalanceSettings/paymentEntry'), { allowDirectPayments: false }, { merge: true }));
  await assertFails(addDoc(collection(db('pesView'), 'paymentMethods'), { name: 'RTGS' }));
  for (const uid of ['pes', 'payAdd']) {
    await assertSucceeds(setDoc(doc(db(uid), 'bankBalanceSettings/paymentEntry'), { mandatoryFields: { utr: true }, allowDirectPayments: false }, { merge: true }));
    const m = await assertSucceeds(addDoc(collection(db(uid), 'paymentMethods'), { name: 'RTGS' }));
    await assertSucceeds(deleteDoc(m));
  }
  for (const uid of ['module', 'reports', 'payView', ...OUTSIDERS]) {
    await assertFails(getDoc(doc(db(uid), 'bankBalanceSettings/paymentEntry')));
    await assertFails(getDocs(collection(db(uid), 'paymentMethods')));
    await assertFails(addDoc(collection(db(uid), 'paymentMethods'), { name: 'x' }));
  }
});

test('Monthly Interest: entered on its page, read there and by the interest report', async () => {
  await assertSucceeds(getDocs(collection(db('mi'), 'monthlyInterest')));
  await assertSucceeds(setDoc(doc(db('mi'), 'monthlyInterest/2026-10'), { A1: 99 }, { merge: true }));
  await assertSucceeds(setDoc(doc(db('mi'), 'monthlyInterest/2026-09'), { A1: 100 }, { merge: true }));
  await assertSucceeds(getDocs(collection(db('reports'), 'monthlyInterest')));
  await assertSucceeds(getDocs(collection(db('miView'), 'monthlyInterest')));
  await assertFails(setDoc(doc(db('miView'), 'monthlyInterest/2026-09'), { A1: 1 }, { merge: true }));
  await assertFails(setDoc(doc(db('reports'), 'monthlyInterest/2026-09'), { A1: 1 }, { merge: true }));
  for (const uid of ['module', 'payAdd', ...OUTSIDERS]) {
    await assertFails(getDocs(collection(db(uid), 'monthlyInterest')));
  }
  await assertFails(deleteDoc(doc(db('mi'), 'monthlyInterest/2026-09')));
});

test('Loan: any Loan grant reads, any but reports alone writes', async () => {
  for (const uid of ['loanDash', 'loanModule', 'loanReports']) {
    const d = db(uid);
    await assertSucceeds(getDocs(collection(d, 'loans')));
    await assertSucceeds(getDocs(query(collection(d, 'loans'), orderBy('createdAt', 'desc'))));
    await assertSucceeds(getDoc(doc(d, 'loans/L1')));
    await assertSucceeds(getDocs(collection(d, 'loans/L1/emis')));
    await assertSucceeds(getDocs(query(collection(d, 'loans/L1/emis'), orderBy('emiNo', 'asc'))));
  }
  for (const uid of ['admin', 'module', 'fd', ...OUTSIDERS]) {
    await assertFails(getDocs(collection(db(uid), 'loans')));
    await assertFails(getDocs(collection(db(uid), 'loans/L1/emis')));
  }

  // New loan: the loan, then its schedule in a batch.
  const d = db('loanDash');
  const loanRef = await assertSucceeds(addDoc(collection(d, 'loans'), { accountNo: 'LN2', loanAmount: 500, totalPaid: 0, status: 'Active', createdAt: now }));
  const batch = writeBatch(d);
  batch.set(doc(collection(d, 'loans', loanRef.id, 'emis')), { emiNo: 1, amount: 50, status: 'Pending' });
  batch.set(doc(collection(d, 'loans', loanRef.id, 'emis')), { emiNo: 2, amount: 50, status: 'Pending' });
  await assertSucceeds(batch.commit());

  // Recording an EMI (EMI Tracker / loan detail), and the expense request number afterwards.
  const m = db('loanModule');
  await assertSucceeds(runTransaction(m, async (tx) => {
    await tx.get(doc(m, 'loans/L1'));
    await tx.get(doc(m, 'loans/L1/emis/e1'));
    tx.update(doc(m, 'loans/L1/emis/e1'), { status: 'Paid', paidAmount: 100 });
    tx.update(doc(m, 'loans/L1'), { totalPaid: 100 });
  }));
  await assertSucceeds(updateDoc(doc(m, 'loans/L1/emis/e1'), { expenseRequestNo: 'EXP-1' }));

  // Rewriting the schedule, and closing the loan (Manage Loans).
  const old = await getDocs(collection(d, 'loans/L1/emis'));
  const rewrite = writeBatch(d);
  rewrite.update(doc(d, 'loans/L1'), { rate: 9.5 });
  old.forEach((e) => rewrite.delete(e.ref));
  rewrite.set(doc(collection(d, 'loans/L1/emis')), { emiNo: 1, amount: 120, status: 'Pending' });
  await assertSucceeds(rewrite.commit());
  await assertSucceeds(updateDoc(doc(d, 'loans/L1'), { status: 'Closed', endDate: '2026-10-13' }));
  await assertFails(deleteDoc(doc(d, 'loans/L1')));

  const r = db('loanReports');
  await assertFails(addDoc(collection(r, 'loans'), { accountNo: 'x', createdAt: now }));
  await assertFails(updateDoc(doc(r, 'loans/L1'), { status: 'Active' }));
  await assertFails(setDoc(doc(r, 'loans/L1/emis/zz'), { emiNo: 9 }));
  for (const uid of ['admin', 'stranger', 'nodoc']) {
    await assertFails(updateDoc(doc(db(uid), 'loans/L1'), { status: 'Active' }));
  }
});

test('signed out: nothing', async () => {
  const out = db(null);
  for (const c of ['bankExpenses', 'bankPayments', 'paymentMethods', 'monthlyInterest', 'loans']) {
    await assertFails(getDocs(collection(out, c)));
  }
  await assertFails(getDoc(doc(out, 'bankBalanceSettings/paymentEntry')));
  await assertFails(addDoc(collection(out, 'bankExpenses'), row({ type: 'Credit', isContra: false })));
});
