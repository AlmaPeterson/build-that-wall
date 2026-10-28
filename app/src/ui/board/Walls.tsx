// Built walls: the viewer's under the scoreboard, everyone else's in rows on the right
// (Walls Display › when green flag clicked). One small card per kind, with a ×2 / ×3 badge.
import { cardById } from '../../data/cards';
import type { GameState, Seat } from '../../game';
import { cardImage } from '../assets';
import { zoomProps } from '../components/zoom';
import { displayName, isGuarded, TRUMP_TRAIN, wallKinds } from './board-state';

const u = (n: number) => `calc(var(--u) * ${n})`;

function WallCards({ state, seat, w, h, step, maxWidth }: { state: GameState; seat: Seat; w: number; h: number; step: number; maxWidth: number }) {
  const kinds = wallKinds(state, seat);
  // Squeeze the cards together when they don't fit, as the old game did
  const gap = kinds.length > 1 && step * (kinds.length - 1) > maxWidth ? maxWidth / (kinds.length - 1) : step;
  return (
    <>
      {kinds.map((k, i) => {
        const name = cardById(k.kind).name;
        const guarded = isGuarded(state, seat, k.kind);
        return (
          <div class="wall" key={k.kind} {...zoomProps(k.kind)} style={{ left: u(i * gap), top: 0, width: u(w), height: u(h), cursor: 'zoom-in' }}
            title={`${name} ×${k.count}${k.count >= 3 ? ' (complete set)' : ''}${guarded ? ' (protected by a Trump Train)' : ''}. Tap to see it full size.`}>
            <img src={cardImage(k.kind, 'mini')} alt={`${name}, ${k.count} built`} />
            {k.count > 1 && <span class={`wall__badge ${k.count >= 3 ? 'wall__badge--set' : ''}`}>×{Math.min(k.count, 3)}</span>}
            {guarded && <img class="wall__guard" src={cardImage(TRUMP_TRAIN, 'mini')} alt="Trump Train guard" {...zoomProps(TRUMP_TRAIN)} />}
          </div>
        );
      })}
    </>
  );
}

/** The viewer's own walls. */
export function MyWalls({ state, seat }: { state: GameState; seat: Seat }) {
  if (!state.seats[seat]?.walls.length) {
    return <div class="at walls-none" style={{ left: u(21), top: u(181), width: u(150), height: u(20) }}>No walls built yet</div>;
  }
  return (
    <div class="at walls-mine" aria-label="Your walls">
      <WallCards state={state} seat={seat} w={24} h={34} step={27} maxWidth={162} />
    </div>
  );
}

/** Everyone else's walls, one row each, with their P1-P6 tag. */
export function OtherWalls({ state, viewer }: { state: GameState; viewer: Seat }) {
  const others = state.seats.map((_, seat) => seat).filter(seat => seat !== viewer);
  return (
    <>
      {others.map((seat, row) => (
        <div class="at walls-row" key={seat} style={{ top: u(95 + row * 22) }} aria-label={`${displayName(state, seat)}'s walls`}>
          <span class={`walls-row__tag ${seat === state.turn ? 'walls-row__tag--turn' : ''}`} title={displayName(state, seat)}>P{seat + 1}</span>
          {state.seats[seat]!.walls.length
            ? <div style={{ position: 'absolute', left: u(30), top: u(0.5), height: u(21) }}>
                <WallCards state={state} seat={seat} w={15} h={21} step={17} maxWidth={120} />
              </div>
            : <span class="walls-row__none">no walls yet</span>}
        </div>
      ))}
    </>
  );
}
