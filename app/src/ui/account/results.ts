// What to tell the player after a purchase, a sign-in or another account action.
import type { BuyResult } from '../../services/payments';

export interface Said { text: string; ok: boolean }

const SERVER_ERRORS: Record<string, string> = {
  amount: "The price didn't match, so the payment was not taken. Please try again.",
  notpaid: 'PayPal says the payment did not go through. Nothing was charged.',
  used: 'That payment was already used.',
  login: 'Please sign in again, then try once more.',
  order: 'Something went wrong with the payment. Nothing was charged.',
};

/** For a purchase. `what`: "Gold" or "your donation". cancel says nothing. */
export function buyMessage(r: BuyResult, what: 'gold' | 'donate'): Said | null {
  if (r === 'cancel') return null;
  if (r === 'ok') return what === 'gold'
    ? { text: 'Thank you! Gold is unlocked.', ok: true }
    : { text: 'Thank you so much! Your donation helps keep the game going.', ok: true };
  if (r === 'noserver') return {
    text: "PayPal approved your payment, but the game server didn't answer. Please don't pay again: " +
      'check back here in a few minutes. If it went through, it will show up here.',
    ok: false,
  };
  if (r.startsWith('server-')) return { text: SERVER_ERRORS[r.slice(7)] ?? 'The game server could not finish the payment (' + r.slice(7) + '). Nothing was unlocked.', ok: false };
  return { text: 'The payment did not finish. Please try again.', ok: false };
}

export function trialMessage(r: string): Said {
  switch (r) {
    case 'ok': return { text: 'Your 7-day Gold free trial has started. Enjoy!', ok: true };
    case 'used': return { text: 'The free trial was already used on this account.', ok: false };
    case 'signin': return { text: 'Sign in first to start the free trial.', ok: false };
    case 'noserver': return { text: "The game server didn't answer. Please try again later.", ok: false };
    default: return { text: 'The free trial could not start (' + r + ').', ok: false };
  }
}

export function codeMessage(r: 'invalid' | 'expired' | 'pack' | 'ok'): Said {
  switch (r) {
    case 'ok': return { text: 'Gold code accepted. Gold is unlocked.', ok: true };
    case 'pack': return { text: 'Code accepted: the pack is unlocked.', ok: true };
    case 'expired': return { text: 'That code has expired.', ok: false };
    default: return { text: "That code isn't valid. Check it and try again.", ok: false };
  }
}

export function nameMessage(r: string): Said {
  switch (r) {
    case 'ok': case 'local': return { text: 'Name saved.', ok: true };
    case 'taken': return { text: 'Someone already has that name. Try another.', ok: false };
    case 'empty': return { text: 'Type a name first.', ok: false };
    case 'noserver': return { text: "Saved here, but the game server didn't answer.", ok: false };
    default: return { text: 'The name could not be saved (' + r + ').', ok: false };
  }
}
