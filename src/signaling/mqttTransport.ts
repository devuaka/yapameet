import type { MqttClient } from 'mqtt';
import { randomId } from '../lib/crypto';
import type { RawTransport, TransportStatus } from './types';

/**
 * Zero-config signaling over free public MQTT brokers (WebSocket). We connect to
 * several brokers at once and publish to all of them; SignalingChannel drops the
 * duplicates. As long as two people share at least one working broker they can
 * find each other. Payloads are encrypted before they get here.
 */
export class MqttTransport implements RawTransport {
  readonly name = 'Public MQTT brokers';
  private clients: MqttClient[] = [];
  private fullTopic = '';
  private closed = false;
  private outbox: string[] = [];

  constructor(private urls: string[]) {}

  async connect(
    topic: string,
    handlers: { onMessage: (data: string) => void; onStatus: (s: TransportStatus, detail?: string) => void },
    willPayload?: string,
  ) {
    const { default: mqtt } = await import('mqtt');
    if (this.closed) return;
    this.fullTopic = `yapameet/v1/${topic}`;
    let everConnected = false;

    const report = () => {
      if (this.closed) return;
      const up = this.clients.filter((c) => c.connected).length;
      if (up > 0) handlers.onStatus('connected', `${up}/${this.clients.length} brokers`);
      else handlers.onStatus(everConnected ? 'reconnecting' : 'connecting');
    };

    this.clients = this.urls.map((url) => {
      const client = mqtt.connect(url, {
        clientId: `yapa_${randomId(8)}`,
        clean: true,
        keepalive: 20,
        connectTimeout: 8000,
        reconnectPeriod: 2500,
        protocolVersion: 4,
        will: willPayload ? { topic: this.fullTopic, payload: willPayload, qos: 0, retain: false } : undefined,
      });
      let failures = 0;
      let thisEverConnected = false;
      client.on('reconnect', () => {
        // Give up on a broker that never worked if another one is carrying the room.
        if (!thisEverConnected && ++failures >= 3 && this.clients.some((c) => c !== client && c.connected)) {
          client.end(true);
          this.clients = this.clients.filter((c) => c !== client);
          report();
        }
      });
      client.on('connect', () => {
        everConnected = true;
        thisEverConnected = true;
        client.subscribe(this.fullTopic, { qos: 0 }, () => this.flush(client));
        report();
      });
      client.on('close', report);
      client.on('offline', report);
      client.on('error', (err) => console.warn('[yapameet] mqtt', url, err.message));
      client.on('message', (_t, payload) => handlers.onMessage(payload.toString()));
      return client;
    });

    report();
    // Fail loudly if no broker answers in time; reconnects keep trying in the background.
    window.setTimeout(() => {
      if (!this.closed && !everConnected) handlers.onStatus('error', 'Could not reach any signaling broker.');
    }, 12000);
  }

  publish(data: string) {
    const live = this.clients.filter((c) => c.connected);
    if (!live.length) {
      // Offline: keep it (chat, state) and send once a broker is back.
      this.outbox.push(data);
      if (this.outbox.length > 200) this.outbox.shift();
      return;
    }
    for (const c of live) c.publish(this.fullTopic, data, { qos: 0 });
  }

  private flush(client: MqttClient) {
    const queued = this.outbox;
    this.outbox = [];
    for (const d of queued) client.publish(this.fullTopic, d, { qos: 0 });
  }

  close() {
    this.closed = true;
    for (const c of this.clients) {
      try {
        c.end(false, {}, () => {});
      } catch {
        /* ignore */
      }
    }
    this.clients = [];
  }
}
