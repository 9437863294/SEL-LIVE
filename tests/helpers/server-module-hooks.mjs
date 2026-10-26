/**
 * Lets plain Node run the app's server modules (`src/lib/<module>/server/*`) in a test:
 *
 * - `@/…` resolves to `src/…`, and extensionless relative imports find their `.ts`/`.tsx` file.
 * - Framework and infrastructure imports are replaced by stubs that record what they were asked:
 *   `server-only` (nothing), `next/server` (`after` queues its callback on `globalThis.__after`),
 *   Firebase Admin (`globalThis.__db`, a FakeFirestore; Storage `globalThis.__bucket`), notifications
 *   (`globalThis.__notices`), email (`globalThis.__emails`) and the activity log (`globalThis.__logs`).
 *
 * Use with `node --import ./tests/helpers/server-module-hooks.mjs --test …`.
 */

import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const src = path.join(root, 'src');
const fakeFirestore = pathToFileURL(path.join(root, 'tests', 'helpers', 'fake-firestore.mjs')).href;

const STUBS = {
  'server-only': 'export {};',
  'next/server': `
    export function after(task) { (globalThis.__after ??= []).push(task); }
    export const NextResponse = { json: (body, init) => new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { 'content-type': 'application/json' } }) };
  `,
  'firebase-admin/firestore': `export { FieldValue } from ${JSON.stringify(fakeFirestore)};`,
  '@/lib/firebase-admin': `
    export const getFirebaseAdminFirestore = () => globalThis.__db;
    // Storage: an in-memory bucket (globalThis.__bucket.files: path → { bytes, contentType }).
    export const getFirebaseAdminBucket = () => (globalThis.__bucket ??= {
      files: new Map(),
      file(path) {
        const files = this.files;
        return {
          save: async (bytes, options) => { files.set(path, { bytes: Buffer.from(bytes), contentType: options?.contentType ?? null }); },
          download: async () => { const stored = files.get(path); if (!stored) throw new Error('No such object: ' + path); return [stored.bytes]; },
          exists: async () => [files.has(path)],
        };
      },
    });
    export const getFirebaseAdminAuth = () => ({ app: { options: { credential: null } } });
  `,
  '@/lib/mail': `
    export async function sendEmail(options) { (globalThis.__emails ??= []).push(options); return { messageId: 'test' }; }
  `,
  '@/lib/company-profile-server': `
    export async function getCompanyProfile() { return { legalName: 'SEL Test Ltd' }; }
  `,
  '@/lib/notifications-server': `
    export async function dispatchNotificationServer(recipients, payload) { (globalThis.__notices ??= []).push({ ...payload, userIds: recipients.userIds ?? [] }); return (recipients.userIds ?? []).length; }
    export async function dispatchNotificationOnce(recipients, payload, dedupeKey) { const sent = (globalThis.__sentKeys ??= new Set()); if (sent.has(dedupeKey)) return 0; sent.add(dedupeKey); (globalThis.__notices ??= []).push({ ...payload, userIds: recipients.userIds ?? [], dedupeKey }); return (recipients.userIds ?? []).length; }
  `,
  '@/lib/activity-logger-server': `
    export async function logServerActivity(entry) { (globalThis.__logs ??= []).push(entry); }
  `,
  '@/lib/access-control-server': `
    export class AccessDeniedError extends Error { constructor(message, status = 403) { super(message); this.status = status; this.name = 'AccessDeniedError'; } }
    export function accessErrorResponse(error) { return { message: error?.message ?? 'error', status: error?.status ?? 500 }; }
    export async function authenticateAccess() { throw new Error('not used in tests'); }
  `,
};

/** The source file an extensionless import means: `x.ts`, `x.tsx` or `x/index.ts`. */
function findFile(base) {
  return [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUBS, specifier)) return { url: `stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const file = findFile(path.join(src, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:') && !path.extname(specifier)) {
      const file = findFile(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
    return nextLoad(url, context);
  },
});
