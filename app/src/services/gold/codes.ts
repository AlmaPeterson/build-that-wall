// Gold codes: BTW1.<payload>.<signature>, signed with the owner's private key (ECDSA P-256).
// The payload is base64url JSON, for example {kind: "gold", exp: 0} or {kind: "pack", packs: ["x"]}.

export const GOLD_PUBLIC_KEY: JsonWebKey = {
  kty: 'EC', crv: 'P-256',
  x: 'xxDbreA4s1h1lWAeBRrJ-YuX4t8bJHuaOfQ5Ss8w_fI',
  y: 'YPd-uoxy-Inssx_WcttYL3t8OgR0QR_JxFzWWrBizmA',
  ext: true, key_ops: ['verify'],
};

export interface GoldCode {
  kind?: string;          // "gold" or "pack"
  exp?: number;           // seconds since 1970; 0 or missing = never ends
  packs?: string[];
  _code: string;          // the code itself, tidied
  [extra: string]: unknown;
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const b = atob(s);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

// The code's payload if the signature is good, otherwise null
export async function verifyGoldCode(code: string, publicKey: JsonWebKey = GOLD_PUBLIC_KEY,
  subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<GoldCode | null> {
  try {
    code = String(code).trim().replace(/\s+/g, '');
    const parts = code.split('.');
    if (parts.length !== 3 || parts[0] !== 'BTW1') return null;
    const key = await subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlDecode(parts[2]!),
      new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]!)));
    if (!p || typeof p !== 'object') return null;
    p._code = code;
    return p as GoldCode;
  } catch { return null; }
}
