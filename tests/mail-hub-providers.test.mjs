import test from 'node:test';
import assert from 'node:assert/strict';

import { LocalKeyWrapper, openSecret, parseKeyMaterial, sealSecret } from '../src/lib/mail-hub/envelope.ts';
import {
  GMAIL_SCOPES,
  MICROSOFT_BASE_SCOPES,
  buildAuthorizeUrl,
  missingScopes,
  pkceChallenge,
  scopesFor,
  signState,
  verifyStateSignature,
} from '../src/lib/mail-hub/oauth-shared.ts';
import { gmailBodyFromMessage, gmailFolders, gmailHeaderFromMessage, parseHeaderAddresses, reduceGmailHistory } from '../src/lib/mail-hub/providers/gmail-map.ts';
import { graphDeltaChanges } from '../src/lib/mail-hub/providers/graph.ts';
import { compressUids, expandUids, imapMessageId, parseImapMessageId } from '../src/lib/mail-hub/providers/imap.ts';
import { retryAfterMs } from '../src/lib/mail-hub/providers/http.ts';

const key = (byte) => new LocalKeyWrapper(Buffer.alloc(32, byte), `v${byte}`);

/* ── secrets ─────────────────────────────────────────────────────────────────────────────── */

test('sealed credentials open only for the account they were sealed to', async () => {
  const wrapper = key(1);
  const sealed = await sealSecret('{"refreshToken":"1//secret"}', 'acc1', wrapper);
  assert.equal(JSON.stringify(sealed).includes('1//secret'), false, 'nothing readable is stored');
  assert.equal(await openSecret(sealed, 'acc1', [wrapper]), '{"refreshToken":"1//secret"}');
  await assert.rejects(openSecret(sealed, 'acc2', [wrapper]), /integrity/, 'grafting onto another account fails');
  await assert.rejects(openSecret({ ...sealed, cipher: Buffer.from('tampered').toString('base64') }, 'acc1', [wrapper]), /integrity/);
});

test('rotation: a secret sealed under the previous key still opens while the new key is primary', async () => {
  const previous = key(1);
  const current = key(2);
  const sealed = await sealSecret('pw', 'acc1', previous);
  assert.equal(await openSecret(sealed, 'acc1', [current, previous]), 'pw');
  await assert.rejects(openSecret(sealed, 'acc1', [current]), /not configured/);
  assert.equal(parseKeyMaterial('00'.repeat(32))?.length, 32);
  assert.equal(parseKeyMaterial('short'), null);
});

/* ── OAuth ───────────────────────────────────────────────────────────────────────────────── */

test('OAuth state is signed, tamper-evident and carries no user data', () => {
  const state = signState('nonce_abcdefghijklmnop', 'secret');
  assert.equal(verifyStateSignature(state, 'secret'), 'nonce_abcdefghijklmnop');
  assert.equal(verifyStateSignature(state, 'other-secret'), null);
  assert.equal(verifyStateSignature(`${state}x`, 'secret'), null);
  assert.equal(verifyStateSignature('nonce_abcdefghijklmnop', 'secret'), null);
  assert.equal(verifyStateSignature('bad nonce!.sig', 'secret'), null);
});

test('least privilege: shared-mailbox scopes are requested only when needed', () => {
  assert.deepEqual(scopesFor('microsoft', 'personal'), MICROSOFT_BASE_SCOPES);
  assert.ok(scopesFor('microsoft', 'shared').includes('Mail.Send.Shared'));
  assert.ok(scopesFor('microsoft', 'reconnect', ['Mail.ReadWrite.Shared']).includes('Mail.ReadWrite.Shared'), 'reconnect keeps a shared grant');
  assert.ok(!scopesFor('microsoft', 'reconnect', ['Mail.ReadWrite']).includes('Mail.ReadWrite.Shared'));
  assert.ok(!GMAIL_SCOPES.includes('https://mail.google.com/'), 'no full-access Gmail scope');
  assert.deepEqual(missingScopes('microsoft', MICROSOFT_BASE_SCOPES, ['Mail.ReadWrite', 'User.Read']), ['Mail.Send']);
});

test('authorization URLs use PKCE and ask for a refresh token', () => {
  const google = new URL(buildAuthorizeUrl({ provider: 'gmail', clientId: 'c', redirectUri: 'https://erp/cb', scopes: GMAIL_SCOPES, state: 's', codeChallenge: pkceChallenge('v'.repeat(50)) }));
  assert.equal(google.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(google.searchParams.get('access_type'), 'offline');
  assert.equal(google.searchParams.get('prompt'), 'consent');
  const ms = new URL(buildAuthorizeUrl({ provider: 'microsoft', clientId: 'c', redirectUri: 'https://erp/cb', tenant: 'contoso', scopes: MICROSOFT_BASE_SCOPES, state: 's', codeChallenge: 'x' }));
  assert.equal(ms.pathname, '/contoso/oauth2/v2.0/authorize');
  assert.ok(ms.searchParams.get('scope').includes('offline_access'));
});

/* ── Gmail mapping ───────────────────────────────────────────────────────────────────────── */

test('Gmail labels map to roles, hide system noise, and add All Mail', () => {
  const folders = gmailFolders([
    { id: 'INBOX', name: 'INBOX', type: 'system' },
    { id: 'UNREAD', name: 'UNREAD', type: 'system' },
    { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system' },
    { id: 'SENT', name: 'SENT', type: 'system' },
    { id: 'Label_7', name: 'Vendors/Steel', type: 'user' },
  ]);
  assert.deepEqual(folders.map((folder) => [folder.providerFolderId, folder.role]), [['__all__', 'all'], ['INBOX', 'inbox'], ['SENT', 'sent'], ['Label_7', 'custom']]);
});

test('a Gmail metadata message maps to a header, including flags and threading', () => {
  const header = gmailHeaderFromMessage({
    id: 'g1',
    threadId: 'th1',
    labelIds: ['INBOX', 'UNREAD', 'STARRED', 'CATEGORY_UPDATES'],
    snippet: 'Please find &#39;PO&#39; attached',
    internalDate: '1790000000000',
    historyId: '555',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: '"Kumar, Ravi" <Ravi@Vendor.com>' },
        { name: 'To', value: 'asha@sel.in, "Accounts" <accounts@sel.in>' },
        { name: 'Subject', value: 'PO 1042' },
        { name: 'Message-ID', value: '<ABC@vendor.com>' },
        { name: 'References', value: '<root@vendor.com> <ABC@vendor.com>' },
      ],
    },
  });
  assert.deepEqual(header.from, { name: 'Kumar, Ravi', address: 'ravi@vendor.com' });
  assert.equal(header.to.length, 2);
  assert.equal(header.isRead, false);
  assert.equal(header.isFlagged, true);
  assert.equal(header.hasAttachments, true);
  assert.equal(header.internetMessageId, 'abc@vendor.com');
  assert.deepEqual(header.references, ['root@vendor.com', 'abc@vendor.com']);
  assert.deepEqual(header.providerFolderIds.sort(), ['INBOX', '__all__']);
  assert.equal(header.snippet, "Please find 'PO' attached");
  assert.deepEqual(parseHeaderAddresses('a@b.com, "x, y" <c@d.com>, not-an-address').map((entry) => entry.address), ['a@b.com', 'c@d.com']);
});

test('Gmail history reduces to fetch-or-delete, with deletion winning inside a page', () => {
  const { fetch, deleted } = reduceGmailHistory([
    { id: '1', messagesAdded: [{ message: { id: 'a' } }, { message: { id: 'b' } }] },
    { id: '2', labelsAdded: [{ message: { id: 'c' } }], messagesDeleted: [{ message: { id: 'b' } }] },
    { id: '3', labelsRemoved: [{ message: { id: 'b' } }] },
  ]);
  assert.deepEqual(fetch.sort(), ['a', 'c']);
  assert.deepEqual(deleted, ['b']);
});

test('a Gmail full payload yields bodies and attachments with content ids', () => {
  const b64 = (text) => Buffer.from(text).toString('base64url');
  const body = gmailBodyFromMessage(
    {
      id: 'g1',
      threadId: 't',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('plain') } }, { mimeType: 'text/html', body: { data: b64('<p>html</p>') } }] },
          { mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo@x>' }, { name: 'Content-Disposition', value: 'inline' }], body: { attachmentId: 'att1', size: 10 } },
          { mimeType: 'application/pdf', filename: 'po.pdf', body: { attachmentId: 'att2', size: 2048 } },
        ],
      },
    },
    (data) => Buffer.from(data, 'base64url').toString('utf8'),
  );
  assert.equal(body.html, '<p>html</p>');
  assert.equal(body.text, 'plain');
  assert.deepEqual(body.attachments.map((entry) => [entry.filename, entry.inline, entry.contentId]), [['logo.png', true, 'logo@x'], ['po.pdf', false, null]]);
});

/* ── Graph and IMAP ──────────────────────────────────────────────────────────────────────── */

test('a Graph delta removal is folder-scoped (it may be a move), an item is authoritative', () => {
  const changes = graphDeltaChanges(
    [
      { id: 'm1', '@removed': { reason: 'changed' } },
      { id: 'm2', parentFolderId: 'archive', conversationId: 'c1', subject: 'x', receivedDateTime: '2026-09-20T10:00:00Z', isRead: true, flag: { flagStatus: 'flagged' } },
    ],
    'inbox',
  );
  assert.deepEqual(changes[0], { kind: 'remove', stableKey: 'm1', scope: { folder: 'inbox' } });
  assert.equal(changes[1].scope, 'authoritative');
  assert.deepEqual(changes[1].header.providerFolderIds, ['archive']);
  assert.equal(changes[1].header.threadKey, 'c1');
  assert.equal(changes[1].header.isFlagged, true);
});

test('IMAP UID sets compress to ranges and round-trip; location ids round-trip paths', () => {
  const uids = [1, 2, 3, 5, 7, 8, 9, 100];
  const compressed = compressUids([...uids, 3, 2]);
  assert.equal(compressed, '1:3,5,7:9,100');
  assert.deepEqual(expandUids(compressed), uids);
  assert.equal(compressUids([]), '');
  const id = imapMessageId('INBOX/Vendors:Steel', '1700', 42);
  assert.deepEqual(parseImapMessageId(id), { path: 'INBOX/Vendors:Steel', uidValidity: '1700', uid: 42 });
});

test('Retry-After is honoured as seconds or as a date', () => {
  const response = (value) => ({ headers: new Headers(value ? { 'retry-after': value } : {}) });
  assert.equal(retryAfterMs(response('120')), 120_000);
  assert.equal(retryAfterMs(response(null), 5000), 5000);
  assert.ok(retryAfterMs(response(new Date(Date.now() + 90_000).toUTCString())) > 80_000);
});
