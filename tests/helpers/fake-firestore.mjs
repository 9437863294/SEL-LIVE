/**
 * An in-memory stand-in for the slice of the Firebase Admin Firestore API the trip-claims services
 * use: documents, equality / `in` / `array-contains` / `>=` queries, transactions, batches and
 * `FieldValue.arrayUnion`. Enough to run the real server code end to end without touching a database.
 *
 * Transactions buffer their writes and apply them on success, so a rule that throws half-way leaves
 * nothing behind — the property the services rely on. There are no retries or contention.
 */

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
let counter = 0;
const autoId = () => `auto${String(++counter).padStart(4, '0')}`;

export const FieldValue = {
  arrayUnion: (...values) => ({ __op: 'arrayUnion', values }),
  serverTimestamp: () => ({ __op: 'serverTimestamp' }),
};

function assertNoUndefined(value, path) {
  if (value === undefined) throw new Error(`fake-firestore: Cannot use "undefined" as a Firestore value (found in field "${path}")`);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoUndefined(item, `${path}.${index}`));
  else if (value !== null && typeof value === 'object' && !value.__op) for (const [key, item] of Object.entries(value)) assertNoUndefined(item, `${path}.${key}`);
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !value.__op;

function resolveSentinel(current, value) {
  if (value && value.__op === 'arrayUnion') {
    const list = Array.isArray(current) ? [...current] : [];
    for (const item of value.values) if (!list.includes(item)) list.push(item);
    return list;
  }
  if (value && value.__op === 'serverTimestamp') return new Date().toISOString();
  return clone(value);
}

function deepMerge(target, source) {
  const out = { ...(target ?? {}) };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : resolveSentinel(out[key], value);
  }
  return out;
}

class Snapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = data !== undefined;
    this._data = data;
  }
  data() {
    return clone(this._data);
  }
}

class DocRef {
  constructor(db, collection, id) {
    this._db = db;
    this.id = id;
    this.path = `${collection}/${id}`;
  }
  get() {
    return Promise.resolve(new Snapshot(this, clone(this._db._store.get(this.path))));
  }
  set(data, options) {
    this._db._apply({ type: 'set', ref: this, data, options });
    return Promise.resolve();
  }
  update(data) {
    this._db._apply({ type: 'update', ref: this, data });
    return Promise.resolve();
  }
  delete() {
    this._db._apply({ type: 'delete', ref: this });
    return Promise.resolve();
  }
}

const MATCHERS = {
  '==': (field, value) => field === value,
  in: (field, values) => values.includes(field),
  'array-contains': (field, value) => Array.isArray(field) && field.includes(value),
  '>=': (field, value) => field !== undefined && field !== null && field >= value,
};

class Query {
  constructor(db, collection, filters = [], max = Infinity) {
    this._db = db;
    this._collection = collection;
    this._filters = filters;
    this._max = max;
  }
  where(field, op, value) {
    if (!MATCHERS[op]) throw new Error(`fake-firestore: operator ${op} is not supported`);
    return new Query(this._db, this._collection, [...this._filters, { field, op, value }], this._max);
  }
  limit(count) {
    return new Query(this._db, this._collection, this._filters, count);
  }
  /** A field mask in the real SDK; the fake returns whole documents, which is a superset. */
  select() {
    return this;
  }
  get() {
    const prefix = `${this._collection}/`;
    const docs = [];
    for (const [path, data] of this._db._store) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
      if (docs.length >= this._max) break;
      if (this._filters.every(({ field, op, value }) => MATCHERS[op](data[field], value))) {
        docs.push(new Snapshot(new DocRef(this._db, this._collection, path.slice(prefix.length)), clone(data)));
      }
    }
    return Promise.resolve({ docs, empty: docs.length === 0, size: docs.length });
  }
}

class CollectionRef extends Query {
  doc(id) {
    return new DocRef(this._db, this._collection, id ?? autoId());
  }
}

class Transaction {
  constructor(db) {
    this._db = db;
    this._writes = [];
  }
  get(ref) {
    if (this._writes.length) throw new Error('fake-firestore: transaction reads must come before writes');
    return ref.get();
  }
  getAll(...refs) {
    if (this._writes.length) throw new Error('fake-firestore: transaction reads must come before writes');
    return this._db.getAll(...refs);
  }
  set(ref, data, options) {
    this._writes.push({ type: 'set', ref, data, options });
    return this;
  }
  update(ref, data) {
    this._writes.push({ type: 'update', ref, data });
    return this;
  }
  delete(ref) {
    this._writes.push({ type: 'delete', ref });
    return this;
  }
}

export class FakeFirestore {
  constructor() {
    this._store = new Map();
  }
  collection(name) {
    return new CollectionRef(this, name);
  }
  getAll(...refs) {
    return Promise.all(refs.map((ref) => ref.get()));
  }
  async runTransaction(fn) {
    const transaction = new Transaction(this);
    const result = await fn(transaction);
    for (const write of transaction._writes) this._apply(write);
    return result;
  }
  batch() {
    const writes = [];
    return {
      set: (ref, data, options) => writes.push({ type: 'set', ref, data, options }),
      update: (ref, data) => writes.push({ type: 'update', ref, data }),
      delete: (ref) => writes.push({ type: 'delete', ref }),
      commit: async () => writes.forEach((write) => this._apply(write)),
    };
  }
  _apply({ type, ref, data, options }) {
    // Like the real SDK without `ignoreUndefinedProperties` (the app does not set it).
    if (data !== undefined) assertNoUndefined(data, ref.path);
    const current = this._store.get(ref.path);
    if (type === 'delete') this._store.delete(ref.path);
    else if (type === 'set') this._store.set(ref.path, options?.merge ? deepMerge(current, data) : deepMerge(undefined, data));
    else {
      if (current === undefined) throw new Error(`fake-firestore: no document to update at ${ref.path}`);
      const next = { ...current };
      for (const [key, value] of Object.entries(data)) next[key] = resolveSentinel(current[key], value);
      this._store.set(ref.path, next);
    }
  }
  /** Test helper: seed a document. */
  seed(collection, id, data) {
    this._store.set(`${collection}/${id}`, clone(data));
  }
  /** Test helper: read a document's data synchronously. */
  read(collection, id) {
    return clone(this._store.get(`${collection}/${id}`));
  }
}
