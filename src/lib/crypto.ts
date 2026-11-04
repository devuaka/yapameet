/**
 * Signaling goes through third-party relays (public MQTT brokers or Supabase), so we
 * never send anything readable. Everything is AES-GCM encrypted with a key derived
 * from the meeting code, and the channel name is a hash of the code. The relay sees
 * random-looking topic names and ciphertext; someone without the code can neither
 * read SDP/chat nor inject fake offers.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface RoomKeys {
  key: CryptoKey;
  topic: string;
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function cryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && window.isSecureContext;
}

export async function deriveRoomKeys(code: string): Promise<RoomKeys> {
  const base = await crypto.subtle.importKey('raw', enc.encode(`yapameet:v1:${code}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('yapameet-signaling-salt-v1'), iterations: 150_000, hash: 'SHA-256' },
    base,
    512,
  );
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, topic: toHex(bits.slice(32, 48)) };
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function decryptJson<T>(key: CryptoKey, data: string): Promise<T | null> {
  try {
    const bytes = fromB64(data);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null; // wrong key, tampered, or not ours
  }
}

export function randomId(len = 16): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return toHex(b.buffer).slice(0, len * 2);
}
