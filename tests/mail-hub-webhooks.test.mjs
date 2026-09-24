import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';

import { decodeGmailPush, safeEqual, verifyGoogleOidcToken } from '../src/lib/mail-hub/webhook-auth.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

function token(claims, { key = privateKey, kid = 'test-key', alg = 'RS256' } = {}) {
  const header = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key).toString('base64url')}`;
}

const now = Date.parse('2026-09-24T09:00:00.000Z');
const valid = {
  iss: 'https://accounts.google.com',
  aud: 'https://erp.example.com/api/mail-hub/webhooks/gmail',
  email: 'pubsub-push@project.iam.gserviceaccount.com',
  email_verified: true,
  exp: Math.floor(now / 1000) + 3600,
  iat: Math.floor(now / 1000),
};
const expected = { audience: valid.aud, email: valid.email };
const options = { keys: [jwk], now };

test('a Pub/Sub OIDC token signed by the expected service account is accepted', async () => {
  const result = await verifyGoogleOidcToken(token(valid), expected, options);
  assert.equal(result.ok, true);
});

test('forged, misdirected, impersonating and expired tokens are refused', async () => {
  const cases = [
    ['signed with another key', token(valid, { key: other.privateKey })],
    ['unknown key id', token(valid, { kid: 'nope' })],
    ['wrong algorithm', token(valid, { alg: 'HS256' })],
    ['wrong audience', token({ ...valid, aud: 'https://attacker.example/hook' })],
    ['another service account', token({ ...valid, email: 'attacker@evil.iam.gserviceaccount.com' })],
    ['unverified email', token({ ...valid, email_verified: false })],
    ['wrong issuer', token({ ...valid, iss: 'https://evil.example' })],
    ['expired', token({ ...valid, exp: Math.floor(now / 1000) - 3600 })],
    ['garbage', 'not.a.jwt'],
  ];
  for (const [label, candidate] of cases) {
    const result = await verifyGoogleOidcToken(candidate, expected, options);
    assert.equal(result.ok, false, label);
  }
});

test('a tampered payload with the original signature is refused', async () => {
  const original = token(valid);
  const [header, , signature] = original.split('.');
  const tampered = Buffer.from(JSON.stringify({ ...valid, aud: expected.audience, email: valid.email, exp: valid.exp + 999999 })).toString('base64url');
  const result = await verifyGoogleOidcToken(`${header}.${tampered}.${signature}`, expected, options);
  assert.equal(result.ok, false);
});

test('the Gmail push payload decodes to an address and history id, and junk decodes to nothing', () => {
  const data = Buffer.from(JSON.stringify({ emailAddress: 'Asha@SEL.in', historyId: 12345 })).toString('base64');
  assert.deepEqual(decodeGmailPush({ message: { data } }), { emailAddress: 'asha@sel.in', historyId: '12345' });
  assert.equal(decodeGmailPush({ message: { data: 'not-base64-json' } }), null);
  assert.equal(decodeGmailPush(null), null);
});

test('constant-time comparison of shared tokens', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
