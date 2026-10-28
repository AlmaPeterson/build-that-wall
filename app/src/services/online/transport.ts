// A publish/subscribe connection. The real one is MQTT (mqtt.ts); tests use an in-memory fake.
export interface Transport {
  /** Fire and forget (QoS 0). An empty payload with retain clears a retained message. */
  publish(topic: string, payload: string, retain?: boolean): void;
  /** Resolves once the relay has confirmed (or failed: it never rejects). */
  subscribe(topic: string): Promise<void>;
  unsubscribe(topic: string): void;
  onMessage(handler: (topic: string, payload: string) => void): void;
  /** Called when the connection drops (not after end()). */
  onClose(handler: () => void): void;
  end(): void;
}

/** Opens a connection, or null if no relay could be reached. */
export type Connect = () => Promise<Transport | null>;
