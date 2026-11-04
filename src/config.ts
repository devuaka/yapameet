/**
 * All service configuration comes from Vite env vars (see .env.example).
 * Nothing here is secret: anything prefixed VITE_ ends up in the browser bundle.
 */
const env = import.meta.env;

const list = (v: string | undefined, fallback: string): string[] =>
  (v && v.trim() ? v : fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const supabaseUrl = (env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

export type SignalingKind = 'supabase' | 'mqtt';

const requested = (env.VITE_SIGNALING as string | undefined)?.trim().toLowerCase();

export const config = {
  signaling: (requested === 'supabase' || requested === 'mqtt'
    ? requested
    : supabaseUrl && supabaseAnonKey
      ? 'supabase'
      : 'mqtt') as SignalingKind,
  supabaseUrl,
  supabaseAnonKey,
  /** Free public MQTT-over-WebSocket brokers. We publish to all of them for redundancy. */
  mqttUrls: list(
    env.VITE_MQTT_URLS,
    'wss://broker.emqx.io:8084/mqtt,wss://broker.hivemq.com:8884/mqtt',
  ),
  stunUrls: list(env.VITE_STUN_URLS, 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478'),
  turnUrls: list(env.VITE_TURN_URLS, ''),
  turnUsername: (env.VITE_TURN_USERNAME as string | undefined) || '',
  turnCredential: (env.VITE_TURN_CREDENTIAL as string | undefined) || '',
  /** GET endpoint returning RTCIceServer[] or { iceServers } (Cloudflare function in /functions, or Metered's API). */
  turnCredentialsUrl: (env.VITE_TURN_CREDENTIALS_URL as string | undefined)?.trim() || '',
  forceRelay: env.VITE_FORCE_RELAY === 'true',
};

let cachedIce: { servers: RTCIceServer[]; at: number } | null = null;

/** STUN + any configured TURN. Fetched credentials are cached for 30 minutes. */
export async function getIceServers(): Promise<RTCIceServer[]> {
  if (cachedIce && Date.now() - cachedIce.at < 30 * 60_000) return cachedIce.servers;
  const servers: RTCIceServer[] = [];
  if (config.stunUrls.length) servers.push({ urls: config.stunUrls });
  if (config.turnUrls.length) {
    servers.push({ urls: config.turnUrls, username: config.turnUsername, credential: config.turnCredential });
  }
  if (config.turnCredentialsUrl) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(config.turnCredentialsUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const fetched: RTCIceServer[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.iceServers)
            ? data.iceServers
            : data?.iceServers
              ? [data.iceServers]
              : [];
        for (const s of fetched) {
          const urls = (Array.isArray(s.urls) ? s.urls : [s.urls])
            // Browsers stall on TURN over port 53; Cloudflare recommends dropping those.
            .filter((u) => !/:53(\?|$)/.test(u));
          if (urls.length) servers.push({ ...s, urls });
        }
      } else {
        console.warn('[yapameet] TURN credentials endpoint returned', res.status);
      }
    } catch (err) {
      console.warn('[yapameet] could not fetch TURN credentials', err);
    }
  }
  cachedIce = { servers, at: Date.now() };
  return servers;
}

export const hasTurn = () => config.turnUrls.length > 0 || !!config.turnCredentialsUrl;
