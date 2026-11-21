// Draw and discard piles, actions left and the jail (Walls Display › define draw board).
import { DEFAULT_MINUTES, type GameState } from '../../game';
import { cardImage } from '../assets';
import { cardBackImage } from '../card-back';
import { cardById } from '../../data/cards';
import { zoomProps } from '../components/zoom';

/** Timed Game: the time left, as counted at the start of this turn. */
export function timeLeft(state: Pick<GameState, 'settings' | 'timeUsed' | 'final'>): string {
  if (state.final) return 'last turns';
  const ms = Math.max(0, (state.settings.minutes ?? DEFAULT_MINUTES) * 60000 - (state.timeUsed ?? 0));
  const min = Math.ceil(ms / 60000);
  return min <= 1 ? 'under 1 min left' : min + ' min left';
}

export function Piles({ state }: { state: GameState }) {
  // Freedom of the Press is stored in jail as a marker, but the player-facing count is the cards it jailed.
  const jailed = state.jail.filter(card => card !== 11).length;
  const top = state.discard.at(-1);
  return (
    <>
      {state.turn >= 0 && !state.over && (
        <div class="at board__actions" aria-live="polite">
          {state.actionsLeft} {state.actionsLeft === 1 ? 'action left' : 'actions left'}
        </div>
      )}
      {/* Ends in __ Minutes: the time left, in the header opposite the Game log */}
      {state.settings.ending === 6 && state.turn >= 0 && !state.over && (
        <div class="at board__clock" aria-live="polite" title="Time left in this game (counted at the start of each turn)">
          <svg class="board__log-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 1.5h8M4 14.5h8M5 1.5v2.5L8 8l-3 4v2.5M11 1.5v2.5L8 8l3 4v2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {timeLeft(state)}
        </div>
      )}
      {state.jail.length > 0 && (
        <div class="at board__jail" title="Freedom of the Press: these cards come back to the discard pile later">
          Jail: {jailed} cards ({Math.max(0, state.jailRelease - state.turnCount)} turns)
        </div>
      )}
      <div class="at piles">
        <div class="piles__labels"><span>Draw</span><span>Discard</span></div>
        <div class="piles__box">
          <div class="piles__slot" aria-label={`Draw pile, ${state.draw.length} cards`}>
            {state.draw.length > 0 && <img src={cardBackImage(state.draw.length)} alt="" />}
            <span class="piles__count">{state.draw.length}</span>
          </div>
          <div class="piles__slot" aria-label={`Discard pile, ${state.discard.length} cards`}>
            {top !== undefined && <img src={cardImage(top, 'thumb')} alt={cardById(top).name} {...zoomProps(top)} />}
            {state.discard.length > 0 && <span class="piles__count">{state.discard.length}</span>}
          </div>
        </div>
      </div>
    </>
  );
}
