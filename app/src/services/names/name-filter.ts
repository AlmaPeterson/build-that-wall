// Player names everyone else sees (online, on the leaderboard, in Pass'n'Play) may not be slurs, swear words or
// other rude words. Catches the usual tricks: n1gg3r, F.U.C.K, BigNigga, sh!t. game-server.gs has the same check
// (nameOk_), so a name can't get onto the world leaderboard by skipping the game's own check.
import { isHate } from '../feedback/filter';

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };

// Never part of a decent name, even inside another word ("BigNigga", "Bullshit")
const INSIDE = atob('bmlnZyBmdWNrIGN1bnQgZmFnZ290IGZhZ290IGhpdGxlciBuYXppIHdob3JlIHJldGFyZCBwdXNzeSBwZW5pcyB2YWdpbmEgcG9ybiByYXBpc3Qga2trIGppenogd2Fua2VyIHR3YXQgYml0Y2ggc2hpdCBzbHV0IGRpbGRvIG1vbGVzdCBwZWRvcGhpbGU=').split(' ');
// ...and these even when split up with spaces or dots ("n i g g", "F.U.C.K")
const SPREAD = ['nigg', 'fuck', 'cunt', 'faggot', 'hitler'];
// Rude only as a whole word ("Dick" is, "Dickens" isn't)
const WORDS = new Set(['ass', 'asses', 'asshole', 'arse', 'dick', 'dickhead', 'cock', 'prick', 'bastard', 'wtf', 'stfu', 'gtfo', 'fag', 'fags',
  'sex', 'sexy', 'nude', 'boobs', 'tits', 'cum', 'anus', 'rape', 'kys', 'fck', 'fk', 'fuk']);

/** Lower case, look-alike numbers and symbols turned into letters, long repeats cut to two ("niiiigger"). */
function unleet(text: string): string {
  return Array.from(String(text).toLowerCase()).map(c => LEET[c] ?? c).join('').replace(/(.)\1{2,}/g, '$1$1');
}

/** True when a name is fine to show to other players. */
export function nameIsOk(name: string): boolean {
  const raw = String(name || '');
  if (/1488|\b88\b/.test(raw)) return false;
  // "BigNigga" → "Big Nigga": words inside a run-together name
  const spaced = raw.replace(/([a-z])([A-Z])/g, '$1 $2');
  const plain = unleet(spaced);
  if (isHate(raw) || isHate(plain)) return false;
  const words = plain.split(/[^a-z]+/).filter(Boolean);
  if (words.some(w => WORDS.has(w) || INSIDE.some(bad => w.includes(bad)))) return false;
  const joined = plain.replace(/[^a-z]+/g, '');
  if (SPREAD.some(bad => joined.includes(bad)) || INSIDE.some(bad => joined === bad)) return false;
  return true;
}
