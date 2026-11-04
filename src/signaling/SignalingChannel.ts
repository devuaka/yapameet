import { config } from '../config';
import { decryptJson, deriveRoomKeys, encryptJson, randomId, type RoomKeys } from '../lib/crypto';
import { MqttTransport } from './mqttTransport';
import { SupabaseTransport } from './supabaseTransport';
import type { Envelope, RawTransport, SignalMessage, TransportStatus } from './types';

export function createTransport(): RawTransport {
  return config.signaling === 'supabase'
    ? new SupabaseTransport(config.supabaseUrl, config.supabaseAnonKey)
    : new MqttTransport(config.mqttUrls);
}

/**
 * Encrypted, addressed, de-duplicated messaging for one meeting room on top of any
 * RawTransport. This is the signaling layer WebRTC needs: SDP offers/answers, ICE
 * candidates, presence and chat all flow through here.
 */
export class SignalingChannel {
  status: TransportStatus = 'connecting';
  statusDetail = '';
  private keys: RoomKeys | null = null;
  private transport: RawTransport;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private closed = false;

  onMessage: (from: string, msg: SignalMessage) => void = () => {};
  onStatus: (s: TransportStatus, detail: string) => void = () => {};

  constructor(
    private code: string,
    private selfId: string,
  ) {
    this.transport = createTransport();
  }

  get transportName() {
    return this.transport.name;
  }

  async open() {
    this.keys = await deriveRoomKeys(this.code);
    if (this.closed) return;
    // Broker-delivered "bye" if our connection dies without a goodbye (MQTT last will).
    const will = await this.seal({ t: 'bye', will: true });
    await this.transport.connect(
      this.keys.topic,
      {
        onMessage: (d) => void this.receive(d),
        onStatus: (s, detail) => {
          this.status = s;
          this.statusDetail = detail || '';
          this.onStatus(s, this.statusDetail);
        },
      },
      will,
    );
  }

  private async seal(msg: SignalMessage, to?: string): Promise<string> {
    const env: Envelope = { v: 1, mid: randomId(8), from: this.selfId, to, msg };
    return encryptJson(this.keys!.key, env);
  }

  async send(msg: SignalMessage, to?: string) {
    if (!this.keys || this.closed) return;
    this.transport.publish(await this.seal(msg, to));
  }

  private async receive(data: string) {
    if (!this.keys || this.closed) return;
    const env = await decryptJson<Envelope>(this.keys.key, data);
    if (!env || env.v !== 1 || !env.msg || typeof env.from !== 'string') return;
    if (env.from === this.selfId) return;
    if (env.to && env.to !== this.selfId) return;
    if (this.seen.has(env.mid)) return;
    this.seen.add(env.mid);
    this.seenOrder.push(env.mid);
    if (this.seenOrder.length > 2000) this.seen.delete(this.seenOrder.shift()!);
    this.onMessage(env.from, env.msg);
  }

  close() {
    this.closed = true;
    this.transport.close();
  }
}
