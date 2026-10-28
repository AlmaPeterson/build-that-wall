// Miles of Wall and Cards in Hand, top left (Walls Display › define draw board).
import type { GameState } from '../../game';
import { displayName, ranking, sets } from './board-state';

export function Scoreboard({ state }: { state: GameState }) {
  const rows = ranking(state);
  return (
    <>
      <div class="at score score--miles" aria-label="Miles of wall">
        <div class="score__title">Miles of Wall</div>
        {rows.map(r => (
          <div class={`score__row ${r.seat === state.turn ? 'score__row--turn' : ''}`} key={r.seat}
            title={`${sets(state, r.seat)} complete ${sets(state, r.seat) === 1 ? 'set' : 'sets'}`}>
            <span class="score__rank">{r.label}</span>
            <span class="score__name">{displayName(state, r.seat)}</span>
            <span class="score__num">{r.miles}</span>
          </div>
        ))}
      </div>
      <div class="at score score--hand" aria-label="Cards in hand">
        <div class="score__title">Cards in Hand</div>
        {state.seats.map((s, seat) => (
          <div class={`score__row score__row--hand ${seat === state.turn ? 'score__row--turn' : ''}`} key={seat}>
            <span class="score__name">{displayName(state, seat)}</span>
            {s.skipNext && <span class="score__mark" title="Quarantined: skips their next turn">SKIP</span>}
            {!s.skipNext && s.limitNext > 0 && <span class="score__mark" title="Only 1 action next turn">1 ACT</span>}
            <span class="score__num">{s.hand.length}{seat === state.turn ? ' ◀' : ''}</span>
          </div>
        ))}
      </div>
    </>
  );
}
