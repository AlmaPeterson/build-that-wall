// Dev-only gallery of every overlay with sample data. Not part of the built game: open it with
// `npm run dev` at /src/ui/overlays/gallery.html?show=<name> (no `show` = a list of links).
import { render } from 'preact';
import { createGame, type Decision, type GameEvent } from '../../game';
import type { Prompt } from '../controller';
import { PromptView } from './Prompt';
import { BigNotice, PassScreen, Recap, TutorialTip, Toasts, WinScreen } from './Screens';
import { recapFor } from './text';
import '../theme.css';
import './overlays.css';

const view = createGame({ players: 3, bots: 1, difficulties: ['hard'], names: ['Ann', 'Ben'], ending: 1, endingTimes: 1,
  actionsPerTurn: 3, cardsPerTurn: 3, packCards: [] }, 1);
view.seats[0]!.hand = [29, 14, 7, 30, 25, 20];
view.seats[1]!.walls = [31, 31, 32];
view.seats[2]!.walls = [33, 34, 34];
view.turn = 0;

const prompt = (decision: Decision): Prompt => ({ decision, answer: (v: unknown) => console.log('answer', v) } as unknown as Prompt);
const ev = (e: Partial<GameEvent> & Pick<GameEvent, 'type'>): GameEvent => ({ text: '', ...e });
const events: GameEvent[] = [
  ev({ type: 'turnEnd', seat: 0 }),
  ev({ type: 'play', seat: 1, card: 7 }),
  ev({ type: 'wallMoved', seat: 0, target: 1, card: 29, text: "Wall Section 1 moved from Ann's walls to Ben's walls." }),
  ev({ type: 'immediate', seat: 2, card: 8 }),
  ev({ type: 'cardMoved', seat: 2, target: 0, card: 14, text: 'Bot Liberty gave a card to Ann.' }),
  ev({ type: 'play', seat: 2, card: 9 }),
  ev({ type: 'limited', seat: 2, target: 0, card: 9, text: 'Ann gets only 1 action next turn.' }),
];

const SHOW: Record<string, () => preact.JSX.Element> = {
  block: () => <PromptView view={view} prompt={prompt({ kind: 'block', seat: 0, attacker: 1, card: 6 })} />,
  savings: () => <PromptView view={view} prompt={prompt({ kind: 'paySavings', seat: 0, attacker: 1 })} />,
  seat: () => <PromptView view={view} prompt={prompt({ kind: 'chooseSeat', seat: 0, card: 17, options: [1, 2], cancellable: true })} />,
  wall: () => <PromptView view={view} prompt={prompt({ kind: 'chooseWall', seat: 0, card: 7, options: [{ seat: 1, kind: 31 }, { seat: 1, kind: 32 }, { seat: 2, kind: 33 }], cancellable: true })} />,
  give: () => <PromptView view={view} prompt={prompt({ kind: 'chooseHandCard', seat: 0, card: 8, purpose: 'give', options: [0, 1, 2, 3, 4, 5], to: 1, optional: false })} />,
  build: () => <PromptView view={view} prompt={prompt({ kind: 'chooseHandCard', seat: 0, card: 3, purpose: 'build', options: [0, 3], optional: true })} />,
  pick: () => <PromptView view={view} prompt={prompt({ kind: 'pickCards', seat: 0, card: 22, pool: [29, 29, 14, 7, 26, 25, 3, 30], max: 3 })} />,
  option: () => <PromptView view={view} prompt={prompt({ kind: 'chooseOption', seat: 0, card: 25, options: ['draw', 'protect'], cancellable: true })} />,
  pass: () => <PassScreen name="Ben" why="Ann played Debt on you. It's your turn." onReady={() => {}} />,
  recap: () => <Recap lines={recapFor(events, 0, view)} myTurn onClose={() => {}} />,
  notice: () => <BigNotice head="FINAL ROUND" title="FINAL ROUND!" sub="Final round! Someone built 3 sets of 3 walls. Everyone else gets one final turn." onClose={() => {}} />,
  win: () => <WinScreen result={{ winners: [1], miles: [19, 27, 11], reason: 'Someone built 3 sets of 3 walls.' }} view={view} onAgain={() => {}} onMenu={() => {}} />,
  toasts: () => <Toasts toasts={[{ id: 1, text: 'PLAY IMMEDIATELY: Ann drew Deep State.', tone: 'alert' }, { id: 2, text: 'Ben blocked Debt with Self-Defense.', tone: 'good' }, { id: 3, text: 'The discard pile was shuffled into the draw pile.', tone: 'info' }]} />,
  tip: () => <TutorialTip best="Build Wall Section 2 with your Man Hour." tips={['Use your Man Hour to build a wall without discarding other walls.', 'Protect a pair with Trump Train so nobody can take it.', 'You have 3 actions left. Use them all before ending your turn.']} onHide={() => {}} />,
};

const show = new URLSearchParams(location.search).get('show') ?? '';
const el = document.getElementById('app')!;
render(SHOW[show]
  ? <div class="btw-overlays">{SHOW[show]!()}</div>
  : <ul>{Object.keys(SHOW).map(k => <li key={k}><a href={'?show=' + k}>{k}</a></li>)}</ul>, el);
