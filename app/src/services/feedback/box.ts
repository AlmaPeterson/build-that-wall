// The feedback composer: subject, message (no limit), attachments. Gmail-style.
import { filterFeedback, isForeign } from './filter';
import { FeedbackMemory, type KeyValueStore } from './memory';
import { showAnswers, showSupport } from './panels';
import { deliverFeedback, deliverQuickFeedback } from './send';
import { translateOnDevice, type Translation } from './translate';

export type Toast = (text: string, ok: boolean) => void;

export interface FeedbackBoxOptions {
  /** Player name */
  name: string;
  /** Player's email for replies ("" = none): the account's, or the one they gave */
  replyTo: string;
  /** "Feedback URL" from game-settings.json */
  feedbackUrl: string;
  store: KeyValueStore;
  toast: Toast;
  /** Device details for bug reports (see deviceInfo in send.ts) */
  deviceInfo?: () => string;
  translate?: (text: string) => Promise<Translation | null>;
  fetch?: typeof fetch;
}

const STYLE = `.btw-fb-wrap{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif}
.btw-fb{width:min(94vw,620px);max-height:94vh;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.5);border:3px solid #d8332d;background:#fff}
.btw-fb-head{background:#d8332d;color:#fff;font-weight:900;font-size:20px;letter-spacing:1px;padding:10px 16px;display:flex;justify-content:space-between;align-items:center}
.btw-fb-head button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;font-weight:900}
.btw-fb-body{padding:12px 16px;display:flex;flex-direction:column;gap:8px;overflow:auto}
.btw-fb-row{display:flex;align-items:center;gap:8px;border-bottom:1px solid #e5e5e5;padding:4px 0}
.btw-fb-row label{width:92px;color:#666;font-size:14px;font-weight:bold}
.btw-fb-row input{flex:1;border:0;outline:none;font-size:16px;padding:6px 2px}
.btw-fb textarea{min-height:190px;height:34vh;resize:vertical;border:2px solid #eee;border-radius:10px;padding:10px;font:16px/1.4 Arial,Helvetica,sans-serif;outline:none}
.btw-fb textarea:focus{border-color:#d8332d}
.btw-fb-files{display:flex;flex-wrap:wrap;gap:6px}
.btw-fb-chip{display:inline-flex;align-items:center;background:#fdecea;border:1px solid #d8332d;border-radius:18px;padding:2px 2px 2px 12px;font-size:14px;color:#222;font-weight:bold}
.btw-fb-chip b{cursor:pointer;margin-left:4px;color:#b3122a;min-width:36px;min-height:36px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;border-radius:50%}
.btw-fb-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid #eee;background:#fafafa}
.btw-fb-bar .send{background:#d8332d;color:#fff;border:3px solid #5a1210;border-radius:22px;padding:9px 26px;min-height:48px;font-weight:bold;font-size:17px;cursor:pointer}
.btw-fb-bar .attach{background:#fff;color:#7a1a16;border:2px solid #7a1a16;border-radius:22px;padding:7px 16px;min-height:48px;font-weight:bold;font-size:15px;cursor:pointer}
.btw-fb-wrap,.btw-ask-wrap,.btw-fx{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.btw-fb-head button{min-height:44px;min-width:64px}
.btw-fb-note{margin-left:auto;color:#888;font-size:12px}`;

/** Opens the composer. Resolves "ok" when sent (or answered), "cancel" when closed. */
export function openFeedbackBox(o: FeedbackBoxOptions): Promise<'ok' | 'cancel'> {
  if (typeof document === 'undefined') return Promise.resolve('cancel');
  const memory = new FeedbackMemory(o.store);
  const translate = o.translate ?? translateOnDevice;
  return new Promise((res) => {
    if (!document.getElementById('btw-fb-style')) {
      const st = document.createElement('style'); st.id = 'btw-fb-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    const wrap = document.createElement('div'); wrap.className = 'btw-fb-wrap';
    wrap.innerHTML = "<div class='btw-fb'><div class='btw-fb-head'><span>SEND FEEDBACK</span><button class='x' title='Back'>Back</button></div>" +
      "<div class='btw-fb-body'><div class='btw-fb-row'><label>Subject</label><input class='subj' placeholder='What is it about?'></div>" +
      "<textarea class='msg' placeholder='Write as much as you like. Ideas, bugs, anything.'></textarea>" +
      "<div class='btw-fb-files'></div></div>" +
      "<div class='btw-fb-bar'><button class='send'>Send</button><button class='attach'>Attach files</button>" +
      "<input type='file' class='file' multiple style='display:none'><span class='btw-fb-note'>Files of any size are sent as download links</span></div></div>";
    const $ = <T extends HTMLElement>(s: string) => wrap.querySelector(s) as T;
    const sendBtn = $<HTMLButtonElement>('.send'), fileInput = $<HTMLInputElement>('.file');
    const files: File[] = [];
    const drawFiles = () => {
      const box = $('.btw-fb-files'); box.innerHTML = '';
      files.forEach((f, i) => {
        const c = document.createElement('span'); c.className = 'btw-fb-chip';
        c.textContent = f.name + ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)';
        const x = document.createElement('b'); x.textContent = 'x'; x.onclick = () => { files.splice(i, 1); drawFiles(); };
        c.appendChild(x); box.appendChild(c);
      });
    };
    $('.attach').onclick = () => fileInput.click();
    fileInput.onchange = () => {
      for (const f of Array.from(fileInput.files ?? [])) files.push(f);
      fileInput.value = ''; drawFiles();
    };
    let done = false;
    const fin = (v: 'ok' | 'cancel') => { if (done) return; done = true; wrap.remove(); res(v); };
    wrap.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') fin('cancel'); if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) void send(); });
    wrap.addEventListener('keyup', (ev) => ev.stopPropagation());
    $('.x').onclick = () => fin('cancel');
    const reset = () => { sendBtn.disabled = false; sendBtn.textContent = 'Send'; };

    const send = async () => {
      let msg = $<HTMLTextAreaElement>('.msg').value, subj = $<HTMLInputElement>('.subj').value.trim();
      if (!msg.trim() && !files.length) { o.toast('Please write a message first.', false); return; }
      // The exact same text again (pasted or sent twice) is never sent twice
      const rawKey = FeedbackMemory.rawKey(subj, msg);
      if (memory.sentRaw(rawKey)) { fin('ok'); o.toast('Thanks! We already got this message from you.', true); return; }
      sendBtn.disabled = true; sendBtn.textContent = 'Checking...';
      // Other languages: translate on this device when the browser can
      let translatedFrom = '';
      if (isForeign(subj + ' ' + msg)) {
        const tm = await translate(msg), ts = subj ? await translate(subj) : null;
        if (tm) { msg = tm.text; translatedFrom = tm.lang; if (ts) subj = ts.text; }
      }
      const fb = filterFeedback(subj, msg, { seen: memory.seen(), deviceInfo: o.deviceInfo });
      if (translatedFrom) { fb.foreign = true; fb.translatedFrom = translatedFrom; }
      if (!fb.parts.length && !fb.private.length) {
        reset();
        if (fb.questions.length) { fin('ok'); await showAnswers(fb.questions); return; }
        if (fb.dupes) { fin('ok'); o.toast("Thanks! You already sent us that idea, so it's on our list.", true); return; }
        o.toast('Please tell us something to fix or add, like "Add a dark mode" or "The Settings button does nothing".', false);
        return;
      }
      sendBtn.textContent = 'Sending...';
      const status = await deliverFeedback({
        fb, files, name: o.name, replyTo: o.replyTo, feedbackUrl: o.feedbackUrl, fetch: o.fetch,
        onProgress: (text) => { sendBtn.textContent = text; },
      });
      if (status !== 'sent') {
        reset();
        o.toast(status === 'failed' ? 'Sorry, feedback is not working right now. Please try again later.' : 'Sorry, the feedback could not be sent. Check your internet.', false);
        return;
      }
      memory.remember(fb.keys); memory.rememberRaw(rawKey); fin('ok');
      if (fb.urgent) { await showSupport(); return; }
      o.toast('Thank you! Your feedback was sent.', true);
      if (fb.questions.length) await showAnswers(fb.questions);
    };
    sendBtn.onclick = () => void send();
    document.body.appendChild(wrap);
    setTimeout(() => $('.subj').focus(), 30);
  });
}

export interface QuickFeedbackOptions {
  message: string;
  name: string;
  email: string;
  store: KeyValueStore;
  toast: Toast;
  deviceInfo?: () => string;
  fetch?: typeof fetch;
}

/** The one-line "send feedback" version: filter, send, then thank, answer or support the player. */
export async function sendQuickFeedback(o: QuickFeedbackOptions): Promise<void> {
  const memory = new FeedbackMemory(o.store);
  const fb = filterFeedback('', String(o.message || ''), { seen: memory.seen(), deviceInfo: o.deviceInfo });
  // NOTE: an idea this player already sent is dropped without a word here (the composer thanks them).
  if (!fb.parts.length && !fb.private.length) { if (fb.questions.length) await showAnswers(fb.questions); return; }
  const status = await deliverQuickFeedback(fb, o.name, o.email, o.fetch);
  if (status === 'offline') { o.toast('Sorry, the feedback could not be sent. Check your internet.', false); return; }
  const ok = status === 'sent';
  if (ok) memory.remember(fb.keys);
  if (ok && fb.urgent) { await showSupport(); return; }
  o.toast(ok ? 'Thank you! Your feedback was sent.' : 'Sorry, feedback is not working right now. Please try again later.', ok);
  if (ok && fb.questions.length) await showAnswers(fb.questions);
}
