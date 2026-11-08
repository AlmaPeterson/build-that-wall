// ---- online transport: public MQTT relay over secure WebSocket
import type { Transport } from './transport';

/** Free public brokers, tried in order. */
export const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];

export class MqttLoadError extends Error {}

// The MQTT library is only downloaded when someone goes online
type MqttModule = typeof import('mqtt');
let loading: Promise<MqttModule> | null = null;
function loadMqtt(): Promise<MqttModule> {
  // In the browser build mqtt is CommonJS: connect() is on the default export, not on the module itself
  if (!loading) loading = import('mqtt')
    .then((m) => {
      const d = (m as unknown as { default?: MqttModule }).default;
      return d?.connect ? d : m;
    })
    .catch((e) => { loading = null; throw new MqttLoadError(String(e)); });
  return loading;
}

/**
 * Connects to the first broker that answers. Resolves null if none did.
 * Rejects with MqttLoadError if the library couldn't be loaded.
 */
export async function connectMqtt(brokers: string[] = BROKERS): Promise<Transport | null> {
  const mqtt = await loadMqtt();
  for (const url of brokers) {
    const client = await new Promise<import('mqtt').MqttClient | null>((res) => {
      let done = false;
      let cl: import('mqtt').MqttClient;
      try {
        cl = mqtt.connect(url, {
          clientId: 'btw_' + Math.random().toString(36).slice(2, 12),
          // keepalive: a page in the background runs its timers about once a minute, so its pings come late;
          // 30 s made the relay cut off a host whose tab was in the background (joiners then found no room)
          clean: true, connectTimeout: 7000, reconnectPeriod: 0, keepalive: 120,
        });
      } catch {
        res(null);
        return;
      }
      const fin = (ok: boolean) => {
        if (done) return;
        done = true;
        if (!ok) try { cl.end(true); } catch { /* already closed */ }
        res(ok ? cl : null);
      };
      cl.on('connect', () => fin(true));
      cl.on('error', () => fin(false));
      setTimeout(() => fin(false), 8000);
    });
    if (client) return wrap(client);
  }
  return null;
}

function wrap(cl: import('mqtt').MqttClient): Transport {
  let ended = false;
  const decoder = new TextDecoder();
  return {
    publish(topic, payload, retain) {
      try { cl.publish(topic, payload, { qos: 0, retain: !!retain }); } catch { /* offline: dropped */ }
    },
    subscribe(topic) {
      return new Promise((res) => {
        try { cl.subscribe(topic, { qos: 0 }, () => res()); } catch { res(); }
      });
    },
    unsubscribe(topic) {
      try { cl.unsubscribe(topic); } catch { /* offline */ }
    },
    onMessage(handler) {
      cl.on('message', (topic, payload) => {
        try { handler(topic, typeof payload === 'string' ? payload : decoder.decode(payload)); } catch { /* bad message */ }
      });
    },
    onClose(handler) {
      cl.on('close', () => { if (!ended) handler(); });
    },
    connected() {
      return !ended && cl.connected;
    },
    end() {
      ended = true;
      try { cl.end(true); } catch { /* already closed */ }
    },
  };
}
