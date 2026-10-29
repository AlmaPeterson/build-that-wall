// The words the overlays show, worked out from the game's events. Pure functions, so they're easy to test.
import { cardById, type CardId } from '../../data/cards';
import type { Action, GameEvent, GameState, Seat } from '../../game';

export const cardName = (id: CardId): string => (id === 4 ? 'a card' : cardById(id).name);
export const seatName = (s: Pick<GameState, 'seats'>, seat: Seat): string => s.seats[seat]?.name ?? 'Player ' + (seat + 1);

/** Button text for a chooseOption answer. */
export function optionLabel(option: string): string {
  const known: Record<string, string> = {
    draw: 'Draw 3 cards',
    protect: 'Protect a pair of walls',
    take: 'Take their Trump cards',
    remove: 'Remove a Trump Train',
  };
  return known[option] ?? option.charAt(0).toUpperCase() + option.slice(1);
}

/** The question a prompt asks, in plain words. */
export function promptTitle(kind: string, card: CardId, purpose?: string): string {
  switch (kind) {
    case 'block': return 'Block it with Self-Defense?';
    case 'paySavings': return 'Pay the Debt with Savings?';
    case 'chooseSeat': return 'Who do you want to play ' + cardName(card) + ' on?';
    case 'chooseWall': return card === 7 ? 'Which wall do you want to take?' : card === 25 ? 'Which pair do you want to protect?' : 'Pick a built wall';
    case 'chooseHandCard': return purpose === 'build' ? 'Pick a wall to build for free' : 'Pick a card to give away';
    case 'pickCards': return 'Pick your cards';
    case 'pickHandCards': return card === 23 ? 'Pick the sets to build for free' : 'Pick the walls to build for free';
    default: return cardName(card);
  }
}

/** "Waiting for Ben to decide: block it with Self-Defense?" (another player is answering, on their own device). */
export function waitingText(w: { seat: Seat; kind: string; card?: CardId; purpose?: string }, state: Pick<GameState, 'seats'>): string {
  const who = seatName(state, w.seat);
  switch (w.kind) {
    case 'block': return 'Waiting for ' + who + ' to decide whether to block it with Self-Defense…';
    case 'paySavings': return 'Waiting for ' + who + ' to decide whether to pay the Debt with Savings…';
    case 'chooseSeat': return 'Waiting for ' + who + ' to pick a player' + (w.card ? ' for ' + cardName(w.card) : '') + '…';
    case 'chooseWall': return 'Waiting for ' + who + ' to pick a wall…';
    case 'chooseHandCard': return 'Waiting for ' + who + (w.purpose === 'build' ? ' to pick a wall to build…' : ' to pick a card to give away…');
    case 'pickCards': case 'pickHandCards': return 'Waiting for ' + who + ' to pick their cards…';
    default: return 'Waiting for ' + who + ' to decide' + (w.card ? ' (' + cardName(w.card) + ')' : '') + '…';
  }
}

/** One line of the turn recap: what happened, with the card that caused it and any walls involved. */
export interface RecapLine {
  text: string;
  card?: CardId;          // the card that caused it (picture on the left)
  lost?: CardId[];        // walls or cards the viewer lost
  got?: CardId[];         // walls or cards the viewer got
}

/** Events that happened to `seat`, between the end of its previous turn and now. */
export function eventsSinceLastTurn(events: readonly GameEvent[], seat: Seat): GameEvent[] {
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if ((e.type === 'turnEnd' || e.type === 'gameStart') && (e.seat === seat || e.type === 'gameStart')) { start = i + 1; break; }
  }
  return events.slice(start);
}

/** Does this event change `seat`'s cards, walls or turn? */
function affects(e: GameEvent, seat: Seat): boolean {
  if (e.type === 'limited' || e.type === 'quarantined') return e.target === seat;
  if (e.type === 'skipped') return e.seat === seat;
  if (e.type === 'wallMoved' || e.type === 'cardMoved' || e.type === 'blocked' || e.type === 'savings') return e.target === seat || e.seat === seat;
  return false;
}

/** "While you were away": what other players did to `seat` since its last turn (section 13, `turnRecap`). */
export function recapFor(events: readonly GameEvent[], seat: Seat, state: Pick<GameState, 'seats'>): RecapLine[] {
  const lines: RecapLine[] = [];
  let cause: GameEvent | null = null;
  for (const e of eventsSinceLastTurn(events, seat)) {
    if (e.type === 'play' || e.type === 'immediate') { cause = e; continue; }
    if (e.type === 'turnStart' && e.seat === seat) continue;
    if (!affects(e, seat)) continue;
    const line: RecapLine = { text: personal(e.text, seatName(state, seat)) };
    const c = cause?.card ?? e.card;
    if (c !== undefined) line.card = c;
    if (cause && cause.seat !== seat && cause.type === 'immediate') {
      line.text = seatName(state, cause.seat!) + ' drew ' + cardName(cause.card!) + ', a Play Immediately card. ' + line.text;
    }
    if (e.type === 'wallMoved' && e.card !== undefined) {
      if (e.seat === seat && e.target !== seat) line.lost = [e.card];
      else if (e.target === seat && e.seat !== seat) line.got = [e.card];
    }
    if (e.type === 'cardMoved') {
      if (e.cards?.length) {                         // a steal: `seat` took `cards` from `target`
        if (e.target === seat) line.lost = e.cards;
      } else if (e.card !== undefined && e.card !== 49) {   // handing out: `seat` gave `card` to `target`
        if (e.target === seat && e.seat !== seat) line.got = [e.card];
        else if (e.seat === seat && e.target !== seat) line.lost = [e.card];
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Swap the viewer's own name for "you" so the recap reads naturally. */
export function personal(text: string, name: string): string {
  if (!name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp('^' + esc + "'s\\b", 'g'), 'Your')
    .replace(new RegExp(esc + "'s\\b", 'g'), 'your')
    .replace(new RegExp('^' + esc + '\\b', 'g'), 'You')
    .replace(new RegExp('\\b' + esc + '\\b', 'g'), 'you')
    // "you gets" → "you get" and so on
    .replace(/\b([Yy]ou) (gets|has|is|was|pulls|paid|blocks|skips)\b/g, (_m, y: string, v: string) =>
      y + ' ' + ({ gets: 'get', has: 'have', is: 'are', was: 'were', pulls: 'pull', paid: 'paid', blocks: 'block', skips: 'skip' } as Record<string, string>)[v]);
}

/** Why the device is being passed (`passWhy`): the latest thing done to them, or that it's their turn. */
export function passWhy(events: readonly GameEvent[], seat: Seat, state: Pick<GameState, 'seats' | 'turn'>): string {
  const lines = recapFor(events, seat, state);
  const last = lines.at(-1);
  const turn = state.turn === seat ? "It's your turn." : 'You have a decision to make.';
  return (last ? last.text + ' ' : '') + turn;
}

/** Events worth a short toast while playing. */
export function toastFor(e: GameEvent): { text: string; tone: 'info' | 'alert' | 'good' } | null {
  switch (e.type) {
    case 'immediate': return { text: e.text, tone: 'alert' };
    case 'blocked': return { text: e.text, tone: 'good' };
    case 'savings': return { text: e.text, tone: 'good' };
    case 'reshuffle': case 'exhausted': return { text: e.text, tone: 'info' };
    case 'skipped': case 'limited': case 'quarantined': return { text: e.text, tone: 'alert' };
    case 'trainGuard': case 'trainGuardRemoved': case 'jail': case 'jailRelease': return { text: e.text, tone: 'info' };
    default: return null;
  }
}

/**
 * Someone else's card moved a wall to or from `viewer` (Debt taking it, Afghanistan Pull Out giving one):
 * worth telling them which one, straight away.
 */
export function wallToastFor(e: GameEvent, viewer: Seat): { text: string; tone: 'alert' } | null {
  if (e.type !== 'wallMoved' || e.target !== viewer || e.seat === undefined || e.seat === viewer) return null;
  return { text: e.text, tone: 'alert' };
}

/** The tutorial's BEST MOVE, worded from the Hard bot's choice (`Tip Think`). */
export function bestMoveText(action: Action, state: Pick<GameState, 'seats'>, seat: Seat): string {
  const hand = state.seats[seat]?.hand ?? [];
  if (action.type === 'endTurn') return 'Click End Turn.';
  const card = hand[action.slot];
  if (card === undefined) return 'Click End Turn.';
  if (action.type === 'build') {
    const pay = action.pay === 'free' ? '' : 'manHour' in action.pay ? ' with your Man Hour' : ' by discarding 2 other walls';
    return 'Build ' + cardName(card) + pay + '.';
  }
  return 'Play ' + cardName(card) + '.';
}

/** Situational tips for the tutorial box (section 12, `make tips`). */
export function tipsFor(state: GameState, seat: Seat, actionsLeft: number): string[] {
  const me = state.seats[seat];
  if (!me) return [];
  const hand = me.hand, walls = me.walls;
  const tips: string[] = [];
  const isWall = (c: CardId) => c >= 29 && c <= 44;
  const count = (k: CardId) => walls.filter(w => w === k).length;
  if (hand.some(c => isWall(c) && count(c) === 2)) tips.push('You can finish a set of 3: a set is worth 16 miles and can never be taken.');
  if (hand.includes(14) && hand.some(isWall)) tips.push('Use your Man Hour to build a wall without discarding other walls.');
  else if (hand.filter(isWall).length >= 3) tips.push('No Man Hour? Build a wall by discarding 2 other wall cards.');
  if (hand.some(c => c === 3 || c === 13 || c === 28)) tips.push('Assassin, Legal Immigration and Voting Machine build walls for free.');
  if (hand.includes(25) && [...new Set(walls)].some(k => count(k) === 2)) tips.push('Protect a pair with Trump Train so nobody can take it.');
  if (hand.includes(7)) tips.push('Debt takes a wall from another player. Take it from the leader.');
  if (hand.some(c => c === 9 || c === 16 || c === 17)) tips.push('Slow down the leader with Democrat Border, Puppeteer or Quarantine.');
  if (hand.includes(26)) tips.push('Trump draws 3 more cards.');
  if (hand.some(c => c === 6 || c === 21)) tips.push('Controlled Opposition and Stimulus Check steal cards from another player.');
  if (hand.some(c => c === 19 || c === 20)) tips.push('Keep Savings and Self-Defense: they block attacks on your turn and on others\'.');
  if (actionsLeft > 0) tips.push('You have ' + actionsLeft + (actionsLeft === 1 ? ' action' : ' actions') + ' left. Use them all before ending your turn.');
  tips.push('Aim for matching walls: 1 wall = 3 miles, 2 = 8, 3 = 16.');
  return tips;
}
