// Cards the player reads and closes: quick answers to how-to questions, and support for someone in danger
import { answerFor, tidy } from './filter';

export interface PanelItem {
  /** Bold heading for this item (optional) */
  q?: string;
  a: string;
}

// A list of short answers or advice, shown as a card the player closes
export function infoPanel(head: string, title: string, items: PanelItem[], button = 'OK'): Promise<'ok'> {
  if (typeof document === 'undefined') return Promise.resolve('ok');
  return new Promise((res) => {
    const w = document.createElement('div'); w.className = 'btw-zoomable';
    w.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif;touch-action:manipulation';
    w.innerHTML = "<div style='width:min(94vw,560px);max-height:90vh;display:flex;flex-direction:column;border-radius:18px;overflow:hidden;border:4px solid #d8332d;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.5)'>" +
      "<div class='h' style='background:#d8332d;color:#fff;font-weight:900;font-size:18px;letter-spacing:2px;padding:12px;text-align:center'></div>" +
      "<div style='overflow:auto;padding:16px 20px'><div class='t' style='font:900 22px Arial Black,Arial,sans-serif;color:#b3122a;margin-bottom:10px;text-align:center'></div><div class='l'></div></div>" +
      "<div style='text-align:center;padding:0 0 18px'><button style='min-height:48px;min-width:140px;padding:10px 34px;border-radius:12px;border:3px solid #5a1210;background:#d8332d;color:#fff;font:bold 18px Arial;cursor:pointer;touch-action:manipulation'></button></div>" +
      "<div style='background:#1f22f5;height:10px'></div></div>";
    const $ = <T extends HTMLElement>(s: string) => w.querySelector(s) as T;
    $('.h').textContent = head; $('.t').textContent = title; $('button').textContent = button;
    for (const it of items) {
      const p = document.createElement('div');
      p.style.cssText = 'font-size:17px;line-height:1.4;color:#222;margin:0 0 12px;' + (it.q ? '' : 'font-weight:bold');
      if (it.q) { const q = document.createElement('div'); q.style.cssText = 'font-weight:bold;color:#7a1a16;margin-bottom:2px'; q.textContent = it.q; p.appendChild(q); }
      p.appendChild(document.createTextNode(it.a)); $('.l').appendChild(p);
    }
    const fin = () => { w.remove(); res('ok'); };
    $('button').onclick = fin;
    w.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter' || ev.key === 'Escape') fin(); });
    document.body.appendChild(w);
  });
}

/** One answer per different topic, so three questions about winning show one card item. */
export function answerItems(questions: string[]): PanelItem[] {
  const seen = new Set<string>(), items: PanelItem[] = [];
  for (const q of questions) {
    const a = answerFor(q);
    if (seen.has(a)) continue;
    seen.add(a);
    items.push({ q: tidy(q).replace(/\.$/, '?'), a });
  }
  return items;
}

export function showAnswers(questions: string[]): Promise<'ok'> {
  return infoPanel('QUICK ANSWERS', "Here's how that works", answerItems(questions), 'Got it');
}

export function showSupport(): Promise<'ok'> {
  return infoPanel('YOU ARE NOT ALONE', 'Please talk to someone', [
    { a: "Your message was sent to the game's owner." },
    { q: 'If you are thinking about hurting yourself, or someone is hurting you:', a: 'Tell someone you trust right now, like a parent, teacher, school counselor or friend.' },
    { q: 'In the United States:', a: 'Call or text 988 any time, day or night, to talk to someone who can help. It is free and private.' },
    { q: 'Anywhere else:', a: 'Find a free helpline in your country at findahelpline.com.' },
    { q: 'If you are in danger right now:', a: 'Call your local emergency number (911 in the United States).' },
  ], 'OK');
}
