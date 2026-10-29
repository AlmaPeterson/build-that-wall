// An in-memory MQTT-style relay for tests: topics with "+" wildcards, retained messages,
// and delivery on a later microtask like a real network.
import type { Connect, Transport } from './transport';

function matches(filter: string, topic: string): boolean {
  const f = filter.split('/'), t = topic.split('/');
  if (f.length !== t.length) return false;
  return f.every((part, i) => part === '+' || part === t[i]);
}

export class FakeRelay {
  private clients = new Set<FakeTransport>();
  private retained = new Map<string, string>();
  /** Every publish, for assertions. */
  readonly log: { topic: string; payload: string; retain: boolean }[] = [];
  /** Set to false to make connect() fail like an unreachable broker. */
  online = true;

  readonly connect: Connect = async () => {
    if (!this.online) return null;
    const c = new FakeTransport(this);
    this.clients.add(c);
    return c;
  };

  publish(topic: string, payload: string, retain: boolean): void {
    this.log.push({ topic, payload, retain });
    if (retain) { if (payload) this.retained.set(topic, payload); else this.retained.delete(topic); }
    for (const c of this.clients) if (c.wants(topic)) c.deliver(topic, payload);
  }

  subscribed(c: FakeTransport, filter: string): void {
    for (const [topic, payload] of this.retained) if (matches(filter, topic)) c.deliver(topic, payload);
  }

  remove(c: FakeTransport): void {
    this.clients.delete(c);
  }

  /** Drop every connection, as if the network died. */
  dropAll(): void {
    for (const c of [...this.clients]) c.drop();
  }

  /** The connections still open (oldest first). */
  get open(): FakeTransport[] { return [...this.clients]; }

  /** Messages published to a topic, parsed. */
  sent(topic: string): Record<string, unknown>[] {
    return this.log.filter((l) => l.topic === topic && l.payload).map((l) => JSON.parse(l.payload) as Record<string, unknown>);
  }
}

export class FakeTransport implements Transport {
  private filters = new Set<string>();
  private messageHandlers: ((topic: string, payload: string) => void)[] = [];
  private closeHandlers: (() => void)[] = [];
  private ended = false;
  constructor(private readonly relay: FakeRelay) {}

  wants(topic: string): boolean {
    return !this.ended && [...this.filters].some((f) => matches(f, topic));
  }
  deliver(topic: string, payload: string): void {
    queueMicrotask(() => { if (!this.ended) for (const h of this.messageHandlers) h(topic, payload); });
  }
  /** Stop sending and receiving without closing, like a device that lost its signal. */
  silence(): void {
    this.ended = true;
    this.relay.remove(this);
  }
  drop(): void {
    this.ended = true;
    this.relay.remove(this);
    for (const h of this.closeHandlers) h();
  }

  publish(topic: string, payload: string, retain?: boolean): void {
    if (!this.ended) this.relay.publish(topic, payload, !!retain);
  }
  async subscribe(topic: string): Promise<void> {
    this.filters.add(topic);
    this.relay.subscribed(this, topic);
  }
  unsubscribe(topic: string): void {
    this.filters.delete(topic);
  }
  onMessage(handler: (topic: string, payload: string) => void): void {
    this.messageHandlers.push(handler);
  }
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }
  connected(): boolean {
    return !this.ended;
  }
  end(): void {
    this.ended = true;
    this.relay.remove(this);
  }
}
