// Draw and discard piles, actions left and the jail (Walls Display › define draw board).
import type { GameState } from '../../game';
import { CARD_BACK_IMAGE, cardImage } from '../assets';
import { cardById } from '../../data/cards';
import { zoomProps } from '../components/zoom';

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
      {state.jail.length > 0 && (
        <div class="at board__jail" title="Freedom of the Press: these cards come back to the discard pile later">
          Jail: {jailed} cards ({Math.max(0, state.jailRelease - state.turnCount)} turns)
        </div>
      )}
      <div class="at piles">
        <div class="piles__labels"><span>Draw</span><span>Discard</span></div>
        <div class="piles__box">
          <div class="piles__slot" aria-label={`Draw pile, ${state.draw.length} cards`}>
            {state.draw.length > 0 && <img src={CARD_BACK_IMAGE()} alt="" />}
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
