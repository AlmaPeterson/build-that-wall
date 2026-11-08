import { describe, expect, it, vi } from 'vitest';

// In the browser build mqtt arrives as CommonJS: connect() is only on the default export
const connect = vi.fn((_url: string) => {
  const handlers: Record<string, () => void> = {};
  setTimeout(() => handlers.connect?.(), 0);
  return { on: (ev: string, fn: () => void) => { handlers[ev] = fn; }, end: () => {} };
});
vi.mock('mqtt', () => ({ default: { connect } }));

describe('connectMqtt', () => {
  it('finds connect() on the default export (the browser build), so brokers are really tried', async () => {
    const { connectMqtt } = await import('./mqtt');
    const tr = await connectMqtt(['wss://broker.example/mqtt']);
    expect(connect).toHaveBeenCalledWith('wss://broker.example/mqtt', expect.anything());
    expect(tr).not.toBeNull();
    tr?.end();
  });
});
