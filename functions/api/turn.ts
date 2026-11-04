/**
 * OPTIONAL Cloudflare Pages Function: mints short-lived Cloudflare TURN credentials.
 * Deployed automatically with the site on Cloudflare Pages (free Functions tier:
 * 100k requests/day). The TURN API secret stays server-side; browsers only get
 * credentials that expire.
 *
 * Set in Cloudflare Pages > Settings > Variables and Secrets:
 *   CF_TURN_KEY_ID      (TURN key id from Cloudflare dashboard > Realtime > TURN)
 *   CF_TURN_API_TOKEN   (that key's API token, as a Secret)
 * Then build the site with VITE_TURN_CREDENTIALS_URL=/api/turn
 *
 * Cloudflare TURN includes 1,000 GB/month free (shared with Cloudflare's SFU).
 */
interface Env {
  CF_TURN_KEY_ID?: string;
  CF_TURN_API_TOKEN?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> => {
  if (!env.CF_TURN_KEY_ID || !env.CF_TURN_API_TOKEN) {
    return json({ iceServers: [], error: 'TURN not configured' }, 200);
  }
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 4 * 3600 }),
    },
  );
  if (!res.ok) return json({ iceServers: [], error: `Cloudflare TURN API ${res.status}` }, 502);
  const data = (await res.json()) as { iceServers: RTCIceServer[] };
  return json({ iceServers: data.iceServers });
};
