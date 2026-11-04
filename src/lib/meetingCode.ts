// No l/o so codes are easy to read aloud and type. 24^10 ~ 6.3e13 combinations.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz';

export function generateMeetingCode(): string {
  const bytes = new Uint8Array(10);
  const out: string[] = [];
  while (out.length < 10) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      // Rejection sampling to avoid modulo bias (240 = 24 * 10).
      if (b < 240 && out.length < 10) out.push(ALPHABET[b % 24]);
    }
  }
  const s = out.join('');
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
}

/**
 * Accepts a bare code, a code with spaces/caps, or a full meeting link, and returns
 * a normalized code, or null if it can't be a valid code. Custom codes like
 * "team-standup" are allowed (3 to 40 chars of a-z, 0-9 and dashes).
 */
export function parseMeetingInput(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  const m = s.match(/\/meeting\/([^/?#\s]+)/i);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  // Re-dash a pasted 10-letter generated code without dashes.
  if (/^[a-z]{10}$/.test(s) && [...s].every((c) => ALPHABET.includes(c))) {
    s = `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
  }
  if (s.length < 3 || s.length > 40) return null;
  return s;
}

export const isStrongCode = (code: string) => /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code);

export function meetingUrl(code: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}/meeting/${code}`;
}
