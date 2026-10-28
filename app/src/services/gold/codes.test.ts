import { beforeAll, describe, expect, it } from 'vitest';
import { GOLD_PUBLIC_KEY, verifyGoldCode } from './codes';

const subtle = globalThis.crypto.subtle;
let publicJwk: JsonWebKey;
let privateKey: CryptoKey;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Makes a code the same way the owner's code generator does
async function makeCode(payload: object, key = privateKey) {
  const head = 'BTW1.' + b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(head)));
  return head + '.' + b64url(sig);
}

beforeAll(async () => {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  publicJwk = await subtle.exportKey('jwk', pair.publicKey);
});

describe('verifyGoldCode', () => {
  it('accepts a correctly signed code and returns its payload', async () => {
    const code = await makeCode({ kind: 'gold', exp: 0 });
    const p = await verifyGoldCode(code, publicJwk);
    expect(p).toMatchObject({ kind: 'gold', exp: 0, _code: code });
  });

  it('ignores spaces and line breaks people paste in', async () => {
    const code = await makeCode({ kind: 'pack', packs: ['x'] });
    const p = await verifyGoldCode('  ' + code.slice(0, 20) + '\n ' + code.slice(20) + ' ', publicJwk);
    expect(p?._code).toBe(code);
  });

  it('rejects a changed payload', async () => {
    const code = await makeCode({ kind: 'gold', exp: 100 });
    const [h, , s] = code.split('.');
    const forged = h + '.' + b64url(new TextEncoder().encode('{"kind":"gold","exp":0}')) + '.' + s;
    expect(await verifyGoldCode(forged, publicJwk)).toBeNull();
  });

  it('rejects codes signed with another key', async () => {
    const other = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    expect(await verifyGoldCode(await makeCode({ kind: 'gold' }, other.privateKey), publicJwk)).toBeNull();
  });

  it('rejects junk and the wrong version', async () => {
    expect(await verifyGoldCode('hello', publicJwk)).toBeNull();
    expect(await verifyGoldCode('BTW2.a.b', publicJwk)).toBeNull();
    expect(await verifyGoldCode('BTW1.!!!.???', publicJwk)).toBeNull();
  });

  it('the real public key loads', async () => {
    await expect(subtle.importKey('jwk', GOLD_PUBLIC_KEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])).resolves.toBeTruthy();
  });
});
