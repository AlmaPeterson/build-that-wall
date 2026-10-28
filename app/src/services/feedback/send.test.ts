import { describe, expect, it, vi } from 'vitest';
import { filterFeedback } from './filter';
import { FeedbackMemory, type KeyValueStore } from './memory';
import { answerItems } from './panels';
import { deliverFeedback, deliverQuickFeedback, deviceInfo, fileBase64, uploadBig, type DeviceEnv } from './send';
import { translateOnDevice } from './translate';

const SCRIPT = 'https://script.google.com/macros/s/abc/exec';
const FORM = 'https://formsubmit.co/ajax/02caa1aacbbb246db4f1305ec7be1fb4';

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const file = (name: string, size: number) => new File([new Uint8Array(size).fill(65)], name, { type: 'text/plain' });

describe('deviceInfo', () => {
  const env = (ua: string, touch = 0): DeviceEnv => ({
    userAgent: ua, maxTouchPoints: touch, screen: { width: 1920, height: 1080 },
    window: { width: 1280, height: 720, devicePixelRatio: 2 }, language: 'en-GB',
  });

  it('describes browser, system, screen and game', () => {
    const s = deviceInfo({ version: '2.1', running: true, mode: "Pass'n'Play", players: 4, bots: 2 },
      env('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'));
    expect(s).toBe([
      'Browser: Chrome 141 on Windows',
      'Screen: 1920 x 1080, window 1280 x 720, zoom 2',
      'Touch screen: no',
      'Game version: 2.1',
      "Game: in a game, Pass'n'Play, 4 players (2 bots)",
      'Language: en-GB',
    ].join('\n'));
  });

  it('spots iPads that pretend to be Macs, and the menus', () => {
    const s = deviceInfo({}, env('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 5));
    expect(s).toContain('Browser: Safari 18 on iPad');
    expect(s).toContain('Touch screen: yes');
    expect(s).toContain('Game version: unknown');
    expect(s).toContain('Game: on the menus');
    expect(deviceInfo({}, env('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'))).toContain('Firefox 140 on Linux');
  });
});

describe('uploadBig', () => {
  it('tries the next host when one fails', async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.includes('tmpfiles')) throw new Error('down');
      if (url.includes('file.io')) return json({ success: false });
      return new Response('https://files.catbox.moe/abc.zip\n');
    });
    expect(await uploadBig(file('big.zip', 10), fn)).toBe('https://files.catbox.moe/abc.zip');
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['tmpfiles.org', 'file.io', 'catbox.moe']);
  });

  it('turns tmpfiles page links into download links', async () => {
    const { fn } = fakeFetch(() => json({ data: { url: 'https://tmpfiles.org/123/a.png' } }));
    expect(await uploadBig(file('a.png', 1), fn)).toBe('https://tmpfiles.org/dl/123/a.png');
  });

  it('gives "" when every host fails', async () => {
    const { fn } = fakeFetch(() => new Response('nope'));
    expect(await uploadBig(file('a.png', 1), fn)).toBe('');
  });
});

describe('deliverFeedback', () => {
  it('sends to the owner script with small files attached', async () => {
    const fb = filterFeedback('Bug', 'the game crashes on my ipad', { deviceInfo: () => 'DEV' });
    const { fn, calls } = fakeFetch(() => new Response(null, { status: 200 }));
    const status = await deliverFeedback({ fb, files: [file('shot.txt', 3)], name: 'Ann', replyTo: 'ann@example.com', feedbackUrl: SCRIPT, page: 'https://game/', fetch: fn });
    expect(status).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(SCRIPT);
    expect(calls[0]!.init.mode).toBe('no-cors');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      subject: 'btw-feedback: The game crashes on my iPad.', message: 'The game crashes on my iPad.', private: [], device: 'DEV', urgent: false,
      player: 'Ann', replyTo: 'ann@example.com', page: 'https://game/',
      attachments: [{ name: 'shot.txt', type: 'text/plain', data: 'QUFB' }],
    });
  });

  it('falls back to FormSubmit when the script cannot be reached; files become links', async () => {
    const fb = filterFeedback('', 'add more cards');
    const progress: string[] = [];
    const { fn, calls } = fakeFetch((url) => {
      if (url === SCRIPT) throw new Error('offline');
      if (url.includes('tmpfiles')) return json({ data: { url: 'https://tmpfiles.org/9/s.txt' } });
      return json({ success: 'true' });
    });
    const status = await deliverFeedback({ fb, files: [file('s.txt', 3)], name: '', replyTo: '', feedbackUrl: SCRIPT, page: 'p', fetch: fn, onProgress: (t) => progress.push(t) });
    expect(status).toBe('sent');
    // NOTE: with the script URL set, the file counts as small, so it was attached rather than linked
    expect(calls.map((c) => c.url)).toEqual([SCRIPT, FORM]);
    const fd = calls[1]!.init.body as FormData;
    expect(fd.get('_subject')).toBe('btw-feedback: Add more cards.');
    expect(fd.get('player')).toBe('Player');
    expect(fd.get('email')).toBeNull();
    expect(fd.get('attachment')).toBeInstanceOf(File);
    expect(progress).toEqual(['Sending...']);
  });

  it('without a script URL, every file is uploaded and linked', async () => {
    const fb = filterFeedback('', 'there is an exploit to get infinite gold');
    const progress: string[] = [];
    const { fn, calls } = fakeFetch((url) => (url.includes('tmpfiles') ? json({ data: { url: 'https://tmpfiles.org/9/v.mp4' } }) : json({ success: true })));
    const status = await deliverFeedback({ fb, files: [file('v.mp4', 5)], name: 'Ann', replyTo: 'ann@example.com', feedbackUrl: '', page: 'p', fetch: fn, onProgress: (t) => progress.push(t) });
    expect(status).toBe('sent');
    const fd = calls.at(-1)!.init.body as FormData;
    expect(fd.get('_subject')).toBe('btw-feedback PRIVATE: Private report');
    expect(fd.get('_replyto')).toBe('ann@example.com');
    expect(String(fd.get('message'))).toBe('PRIVATE (do not share publicly):\n- [cheat or exploit] There is an exploit to get infinite gold.\n\nBig files:\nv.mp4: https://tmpfiles.org/dl/9/v.mp4');
    expect(fd.get('attachment')).toBeNull();
    expect(progress).toEqual(['Uploading v.mp4...', 'Sending...']);
  });

  it('reports a refusal as failed and no network as offline', async () => {
    const fb = filterFeedback('', 'add more cards');
    expect(await deliverFeedback({ fb, name: '', replyTo: '', feedbackUrl: '', page: '', fetch: fakeFetch(() => json({ success: 'false' })).fn })).toBe('failed');
    expect(await deliverFeedback({ fb, name: '', replyTo: '', feedbackUrl: '', page: '', fetch: fakeFetch(() => new Response('<html>', { status: 500 })).fn })).toBe('failed');
    expect(await deliverFeedback({ fb, name: '', replyTo: '', feedbackUrl: '', page: '', fetch: fakeFetch(() => { throw new Error('x'); }).fn })).toBe('offline');
  });

  it('urgent messages keep their own subject', async () => {
    const fb = filterFeedback('', 'I want to kill myself');
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    await deliverFeedback({ fb, name: '', replyTo: '', feedbackUrl: '', page: '', fetch: fn });
    expect((calls[0]!.init.body as FormData).get('_subject')).toBe('URGENT: a player may need help');
  });
});

describe('deliverQuickFeedback', () => {
  it('posts JSON to FormSubmit', async () => {
    const fb = filterFeedback('', 'add more cards');
    const { fn, calls } = fakeFetch(() => json({ success: 'true' }));
    expect(await deliverQuickFeedback(fb, 'Ann', '', fn, 'p')).toBe('sent');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      _subject: 'btw-feedback: Add more cards.', player: 'Ann', 'player email': '(not given)', feedback: 'Add more cards.', page: 'p',
    });
  });
});

describe('FeedbackMemory', () => {
  const store = (): KeyValueStore & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, get: (k) => data[k] ?? null, set: (k, v) => { data[k] = v; } };
  };

  it('remembers the last 300 ideas and the last 50 raw messages', () => {
    const s = store(), m = new FeedbackMemory(s);
    for (let i = 0; i < 310; i++) m.remember([['w' + i]]);
    expect(m.seen()).toHaveLength(300);
    expect(m.seen()[0]).toEqual(['w10']);
    for (let i = 0; i < 60; i++) m.rememberRaw('r' + i);
    expect(m.sentRaw('r59')).toBe(true);
    expect(m.sentRaw('r5')).toBe(false);
    expect(Object.keys(s.data).sort()).toEqual(['fbraw', 'fbsent']);
  });

  it('raw keys ignore case and spacing', () => {
    expect(FeedbackMemory.rawKey(' Hi ', 'Add   MORE\ncards')).toBe('hi add more cards');
  });

  it('survives broken saved data', () => {
    const s = store(); s.data.fbsent = '{oops'; s.data.fbraw = '"x"';
    const m = new FeedbackMemory(s);
    expect(m.seen()).toEqual([]);
    expect(m.sentRaw('x')).toBe(false);
  });
});

describe('answerItems', () => {
  it('one answer per topic, questions tidied', () => {
    const items = answerItems(['how do i win', 'what is the goal', 'how does debt work']);
    expect(items.map((i) => i.q)).toEqual(['How do i win?', 'How does debt work?']);
  });
});

describe('translateOnDevice', () => {
  const api = (lang: string, availability = 'available') => ({
    LanguageDetector: { create: async () => ({ detect: async () => [{ detectedLanguage: lang }] }) },
    Translator: { availability: async () => availability, create: async () => ({ translate: async (t: string) => 'EN:' + t }) },
  });

  it('translates when the browser can', async () => {
    expect(await translateOnDevice('hola', api('es'))).toEqual({ text: 'EN:hola', lang: 'es' });
  });

  it('gives null for English, unknown languages, missing APIs or errors', async () => {
    expect(await translateOnDevice('hi', api('en'))).toBeNull();
    expect(await translateOnDevice('??', api('und'))).toBeNull();
    expect(await translateOnDevice('hola', api('es', 'unavailable'))).toBeNull();
    expect(await translateOnDevice('hola', {})).toBeNull();
    expect(await translateOnDevice('hola', { LanguageDetector: { create: async () => { throw new Error('x'); } }, Translator: api('es').Translator })).toBeNull();
  });

  it('gives up after 10 seconds', async () => {
    vi.useFakeTimers();
    const slow = { ...api('es'), LanguageDetector: { create: () => new Promise<never>(() => {}) } };
    const p = translateOnDevice('hola', slow);
    await vi.advanceTimersByTimeAsync(10001);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });
});

it('fileBase64 encodes bytes', async () => {
  expect(await fileBase64(new Blob(['hello']))).toBe('aGVsbG8=');
});
