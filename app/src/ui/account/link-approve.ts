// The website's half of Google sign-in for itch.io (services/account/link.ts): opened with "?link=<id>", it asks
// the player to sign in (with Google, or any other way) and to say Yes, then tells the game server to hand the
// itch.io copy a sign-in for this account.
import { isError } from '../../services/account/api';
import { linkCode, linkIdIn } from '../../services/account/link';
import { services } from '../services';

/** Opened from the itch.io copy: take "?link=" out of the address and return the id, or null. */
export function takeLinkParam(): string | null {
  if (typeof location === 'undefined') return null;
  const id = linkIdIn(location.search);
  if (!id) return null;
  const url = new URL(location.href);
  url.searchParams.delete('link');
  try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch { /* fine */ }
  return id;
}

/** The box that asks "Sign in on itch.io?" and does it. */
export function showLinkApprove(id: string): void {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text = '') => {
    const e = document.createElement(tag); e.style.cssText = css; if (text) e.textContent = text; return e;
  };
  const wrap = el('div', 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;');
  const box = el('div', 'background:#fff;color:#222;padding:22px 26px;border-radius:12px;font:15px Arial;text-align:center;width:340px;max-width:calc(100vw - 32px);box-sizing:border-box;');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Sign in on itch.io');
  const title = el('div', 'font-weight:bold;color:#b3122a;font-size:18px;margin-bottom:10px', 'Sign in on itch.io');
  const text = el('p', 'margin:0 0 8px;line-height:1.4', 'Build That Wall on itch.io asked to sign in with your account. Check that the game on itch.io shows this code:');
  const code = el('div', 'font:bold 30px Arial;letter-spacing:6px;color:#1f22f5;margin:6px 0 10px', linkCode(id));
  const warn = el('p', 'margin:0 0 12px;font-size:13px;color:#555;line-height:1.4', 'Only press Yes if you pressed Sign in with Google in Build That Wall yourself, just now, and the codes match.');
  const msg = el('p', 'margin:6px 0;color:#b3122a;font-size:14px;min-height:0');
  msg.setAttribute('role', 'alert');
  const btn = 'display:block;width:100%;padding:10px 12px;margin:6px 0;border-radius:6px;font:bold 15px Arial;cursor:pointer;';
  const yes = el('button', btn + 'background:#b3122a;color:#fff;border:1px solid #b3122a', 'Yes, sign in on itch.io');
  const no = el('button', btn + 'background:#fff;color:#222;border:1px solid #aaa', 'No');
  const close = () => wrap.remove();
  no.onclick = close;
  yes.onclick = async () => {
    yes.disabled = true; msg.textContent = '';
    try {
      await services.init();
      if (!services.player.get().verified || services.player.get().expired) {
        wrap.style.display = 'none';                       // the sign-in box goes on top
        await services.signIn();
        wrap.style.display = 'flex';
      }
      const p = services.player.get();
      if (!p.verified || p.expired) { msg.textContent = 'Sign in first, then press Yes again.'; return; }
      const r = await services.api.call(services.server(), '/link/approve', { link: id });
      if (!r || isError(r)) { msg.textContent = "That didn't work. Go back to itch.io and press Sign in with Google again."; return; }
      title.textContent = 'Done!';
      text.textContent = 'Go back to the itch.io tab: you’re signed in there as ' + p.name + '. You can close this tab.';
      code.remove(); warn.remove(); yes.remove();
      no.textContent = 'Close';
    } finally { yes.disabled = false; }
  };
  box.append(title, text, code, warn, msg, yes, no);
  wrap.append(box);
  document.body.append(wrap);
}
