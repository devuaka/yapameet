import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { RawTransport, TransportStatus } from './types';

/**
 * Signaling over Supabase Realtime Broadcast (free tier). No tables needed:
 * broadcast messages go straight through Supabase's Realtime servers.
 */
export class SupabaseTransport implements RawTransport {
  readonly name = 'Supabase Realtime';
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private closed = false;

  constructor(
    private url: string,
    private anonKey: string,
  ) {}

  async connect(
    topic: string,
    handlers: { onMessage: (data: string) => void; onStatus: (s: TransportStatus, detail?: string) => void },
  ) {
    const { createClient } = await import('@supabase/supabase-js');
    if (this.closed) return;
    this.client = createClient(this.url, this.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 40 } },
    });
    let everConnected = false;
    this.channel = this.client.channel(`yapameet-${topic}`, {
      config: { broadcast: { self: false, ack: false } },
    });
    this.channel.on('broadcast', { event: 's' }, ({ payload }) => {
      if (typeof payload?.d === 'string') handlers.onMessage(payload.d);
    });
    handlers.onStatus('connecting');
    this.channel.subscribe((status, err) => {
      if (this.closed) return;
      if (status === 'SUBSCRIBED') {
        everConnected = true;
        handlers.onStatus('connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        handlers.onStatus(everConnected ? 'reconnecting' : 'error', err?.message || status);
      } else if (status === 'CLOSED') {
        handlers.onStatus('reconnecting');
      }
    });
  }

  publish(data: string) {
    void this.channel?.send({ type: 'broadcast', event: 's', payload: { d: data } });
  }

  close() {
    this.closed = true;
    if (this.channel && this.client) void this.client.removeChannel(this.channel);
    this.channel = null;
    void this.client?.realtime.disconnect();
    this.client = null;
  }
}
