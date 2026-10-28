// One animator per game controller, shared by the board and the overlays. The controller's bots wait
// for it, so the game never runs ahead of what the board shows.
import { ANIM_FACTOR, settings } from '../app-state';
import { onControllerCreated, type GameController } from '../controller';
import { cards } from '../../data/cards';
import { cardImage } from '../assets';
import { Animator } from './animator';

const animators = new WeakMap<GameController, Animator>();

export function animatorFor(c: GameController): Animator {
  let a = animators.get(c);
  if (!a) {
    preloadCards();
    a = new Animator(c.snapshot, { speed: () => ANIM_FACTOR[settings.get().animSpeed] ?? 1 });
    const anim = a;
    c.setPace(() => anim.whenIdle());
    animators.set(c, a);
  }
  return a;
}

/** Load every card picture once, so a played card shows its face as soon as it flies. */
let preloaded = false;
function preloadCards(): void {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  for (const c of cards) new Image().src = cardImage(c.id, 'thumb');
}

// Every game gets its animator before it starts, so the deal is animated too
onControllerCreated(c => { animatorFor(c); });

export { Animator, planStep, type AnimState, type Flight } from './animator';
export { FlightLayer } from './FlightLayer';
