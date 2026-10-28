// Getting feedback to the owner: through the owner's Google Apps Script (game-server.gs) when
// "Feedback URL" is set, otherwise through FormSubmit. Players never see an email address.
import { feedbackBody, type FeedbackResult } from './filter';

/** Private FormSubmit code for the owner's inbox (no email address in the game). */
export const FORM_SUBMIT_CODE = '02caa1aacbbb246db4f1305ec7be1fb4';
const FORM_SUBMIT_URL = 'https://formsubmit.co/ajax/' + FORM_SUBMIT_CODE;
/** The owner's script emails attachments up to this size in total; FormSubmit gets links only. */
const SCRIPT_ATTACH_LIMIT = 18 * 1024 * 1024;
const NL = '\n';

type Fetch = typeof fetch;

export const isScriptUrl = (url: string) => /^https:\/\/script\.google\.com\//.test(String(url || ''));

// ---- device details for bug reports, so the owner can reproduce them

export interface GameInfo {
  version?: string;
  running?: boolean;
  /** "Pass'n'Play", "Multiplayer"... */
  mode?: string;
  players?: number;
  bots?: number;
}

export interface DeviceEnv {
  userAgent: string;
  maxTouchPoints: number;
  screen: { width: number; height: number };
  window: { width: number; height: number; devicePixelRatio: number };
  language: string;
}

export function browserEnv(): DeviceEnv {
  return {
    userAgent: navigator.userAgent || '',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    screen: { width: screen.width, height: screen.height },
    window: { width: innerWidth, height: innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
    language: navigator.language || '',
  };
}

export function deviceInfo(game: GameInfo = {}, env: DeviceEnv = browserEnv()): string {
  const ua = env.userAgent;
  const v = (re: RegExp) => (ua.match(re) || [])[1];
  const browser = v(/Edg\/(\d+)/) ? 'Edge ' + v(/Edg\/(\d+)/) : v(/OPR\/(\d+)/) ? 'Opera ' + v(/OPR\/(\d+)/) : v(/Firefox\/(\d+)/) ? 'Firefox ' + v(/Firefox\/(\d+)/) :
    v(/Chrome\/(\d+)/) ? 'Chrome ' + v(/Chrome\/(\d+)/) : v(/Version\/(\d+).*Safari/) ? 'Safari ' + v(/Version\/(\d+).*Safari/) : 'unknown browser';
  const os = /iPad/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' :
    /CrOS/.test(ua) ? 'ChromeOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'unknown system';
  return [
    'Browser: ' + browser + ' on ' + os,
    'Screen: ' + env.screen.width + ' x ' + env.screen.height + ', window ' + env.window.width + ' x ' + env.window.height + ', zoom ' + env.window.devicePixelRatio,
    'Touch screen: ' + (env.maxTouchPoints > 0 ? 'yes' : 'no'),
    'Game version: ' + (game.version || 'unknown'),
    'Game: ' + (game.running ? 'in a game, ' + (game.mode || 'unknown mode') + ', ' + (game.players ?? '') + ' players (' + (game.bots ?? '') + ' bots)' : 'on the menus'),
    'Language: ' + (env.language || 'unknown'),
  ].join(NL);
}

// ---- big files: free public file hosts, tried in order

export async function uploadBig(f: File, fetchFn: Fetch = fetch): Promise<string> {
  const tries = [
    async () => {
      const fd = new FormData(); fd.append('file', f, f.name);
      const r = await fetchFn('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: fd });
      const j = (await r.json()) as { data?: { url?: string } };
      const u = j && j.data && j.data.url;
      return u ? String(u).replace('tmpfiles.org/', 'tmpfiles.org/dl/') : '';
    },
    async () => {
      const fd = new FormData(); fd.append('file', f, f.name);
      const r = await fetchFn('https://file.io/?expires=2w', { method: 'POST', body: fd });
      const j = (await r.json()) as { success?: boolean; link?: string };
      return (j && j.success && j.link) || '';
    },
    async () => {
      const fd = new FormData(); fd.append('reqtype', 'fileupload'); fd.append('fileToUpload', f, f.name);
      const r = await fetchFn('https://catbox.moe/user/api.php', { method: 'POST', body: fd });
      const t = (await r.text()).trim();
      return /^https:/.test(t) ? t : '';
    },
    async () => {
      const fd = new FormData(); fd.append('reqtype', 'fileupload'); fd.append('time', '72h'); fd.append('fileToUpload', f, f.name);
      const r = await fetchFn('https://litterbox.catbox.moe/resources/internals/api.php', { method: 'POST', body: fd });
      const t = (await r.text()).trim();
      return /^https:/.test(t) ? t : '';
    },
  ];
  for (const t of tries) {
    try { const u = await t(); if (u) return u; } catch { /* next host */ }
  }
  return '';
}

export async function fileBase64(f: Blob): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---- sending

/** "sent", "failed" (the service said no) or "offline" (couldn't reach it). */
export type SendStatus = 'sent' | 'failed' | 'offline';

export interface DeliverOptions {
  fb: FeedbackResult;
  files?: File[];
  /** Player name */
  name: string;
  /** Player's email for replies ("" = none) */
  replyTo: string;
  /** "Feedback URL" from game-settings.json: the owner's Apps Script web app, or "" */
  feedbackUrl: string;
  /** Progress for the Send button: "Uploading x.png...", "Sending..." */
  onProgress?: (text: string) => void;
  /** The page the player was on */
  page?: string;
  fetch?: Fetch;
}

/** Sends filtered feedback from the full composer, with attachments. */
export async function deliverFeedback(o: DeliverOptions): Promise<SendStatus> {
  const fb = o.fb, fetchFn = o.fetch ?? fetch, files = o.files ?? [];
  const page = o.page ?? (typeof location !== 'undefined' ? location.href : '');
  let msg = feedbackBody(fb);
  const subj = fb.subject;
  // small files ride along as attachments; bigger ones are uploaded and linked
  const viaScript = isScriptUrl(o.feedbackUrl);
  const cap = viaScript ? SCRIPT_ATTACH_LIMIT : 0;         // FormSubmit does not deliver attachments: links only
  const small: File[] = [], links: string[] = [];
  let used = 0;
  for (const f of [...files].sort((x, y) => x.size - y.size)) {
    if (used + f.size <= cap) { small.push(f); used += f.size; continue; }
    o.onProgress?.('Uploading ' + f.name + '...');
    const url = await uploadBig(f, fetchFn);
    links.push(f.name + ': ' + (url || '(upload failed)'));
  }
  const bigFiles = links.length ? NL + NL + 'Big files:' + NL + links.join(NL) : '';
  msg += bigFiles;
  if (viaScript) {                                          // the owner's Gmail sends it, attachments included
    try {
      const attachments = [];
      for (const f of small) attachments.push({ name: f.name, type: f.type || 'application/octet-stream', data: await fileBase64(f) });
      // The owner's script gets each part separately so it can file them in the right place
      // NOTE: "no-cors" means the reply can't be read, so only a network error falls back to FormSubmit.
      await fetchFn(o.feedbackUrl, {
        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          subject: (fb.urgent ? '' : 'btw-feedback: ') + (subj || 'Build That Wall feedback'),
          message: fb.message + bigFiles, private: fb.private, device: fb.device, urgent: fb.urgent,
          foreign: fb.foreign, translatedFrom: fb.translatedFrom || '', injection: fb.injection,
          player: o.name || 'Player', replyTo: o.replyTo, page, attachments,
        }),
      });
      return 'sent';
    } catch { /* fall back to the form service below */ }
  }
  o.onProgress?.('Sending...');
  const fd = new FormData();
  fd.append('_subject', (fb.urgent ? '' : fb.private.length ? 'btw-feedback PRIVATE: ' : 'btw-feedback: ') + (subj || 'Build That Wall feedback'));
  fd.append('_template', 'table'); fd.append('_captcha', 'false');
  if (o.replyTo) { fd.append('email', o.replyTo); fd.append('_replyto', o.replyTo); }
  fd.append('label', 'btw-feedback'); fd.append('player', o.name || 'Player');
  fd.append('subject', subj || '(none)'); fd.append('message', msg);
  fd.append('page', page); fd.append('when', new Date().toISOString());
  // NOTE: cap is 0 for FormSubmit, so `small` is always empty here unless the script send failed.
  small.forEach((f, i) => fd.append(i ? 'attachment' + (i + 1) : 'attachment', f, f.name));
  return postFormSubmit(fetchFn, { method: 'POST', headers: { Accept: 'application/json' }, body: fd });
}

/** The one-line "send feedback [MSG]" version: no subject or files, always FormSubmit. */
export async function deliverQuickFeedback(fb: FeedbackResult, name: string, email: string, fetchFn: Fetch = fetch, page = typeof location !== 'undefined' ? location.href : ''): Promise<SendStatus> {
  const msg = feedbackBody(fb);
  return postFormSubmit(fetchFn, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      _subject: fb.urgent ? fb.subject : 'btw-feedback: ' + msg.slice(0, 60), _template: 'table', _captcha: 'false', label: 'btw-feedback',
      player: name || 'Player', 'player email': email || '(not given)', feedback: msg.slice(0, 3000),
      page, when: new Date().toISOString(),
    }),
  });
}

async function postFormSubmit(fetchFn: Fetch, init: RequestInit): Promise<SendStatus> {
  try {
    const r = await fetchFn(FORM_SUBMIT_URL, init);
    let j: { success?: unknown } = {};
    try { j = (await r.json()) as { success?: unknown }; } catch { /* not JSON */ }
    return r.ok && String(j.success) === 'true' ? 'sent' : 'failed';
  } catch {
    return 'offline';
  }
}
