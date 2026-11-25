// Play: first how you want to play (bots, Pass'n'Play, online or just watching bots), then only what that way
// needs (how many bots and how hard, how many people and their names). Online goes to the Online screen (find a game, open
// a room, or join with a code). What was picked is kept in the settings, so next time it's already chosen.
import { useState } from 'preact/hooks';
import { DEFAULT_MINUTES, MILES_TO_WIN, type Ending } from '../../game';
import { screen, settings, type UiSettings } from '../app-state';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { useStore } from '../store';
import { services } from '../services';
import { Choice, NumberBox, Row, Stepper } from './controls';
import { PlayerNames } from './PlayerNames';
import { BOT_NAME_MAX, ENDINGS, ENDING_NAMES, MILES_RANGE, MINUTES_RANGE, endingName, usesDeck, MAX_PLAYERS, MIN_PLAYERS, updateSettings, type BotLevel } from './prefs';
import { startPassNPlay, startVsBots, startWatch } from './start';

type Step = 'mode' | 'bots' | 'watch' | 'pass' | 'names';

const LEVELS: { value: BotLevel; name: string }[] = [
  { value: 'easy', name: 'Easy' }, { value: 'medium', name: 'Medium' }, { value: 'hard', name: 'Hard' }, { value: 'insane', name: 'Extra Hard ★' }, { value: 'random', name: 'Random' },
];

/** The levels, with Extra Hard only for Gold members. */
function levels(gold: boolean) {
  return LEVELS.map(l => (l.value === 'insane' && !gold ? { ...l, disabled: true, title: 'Extra Hard bots are for Gold members' } : l));
}

const setGame = (patch: Partial<UiSettings['game']>) => updateSettings(s => ({ ...s, game: { ...s.game, ...patch } }));

/** The level every bot playing has, or null if they differ. */
export function sharedLevel(levels: BotLevel[], bots: number): BotLevel | null {
  const used = levels.slice(0, Math.max(1, bots));
  return used.every(l => l === used[0]) ? used[0] ?? 'easy' : null;
}

/** How hard the bots are: one choice for all of them, or each one separately. */
function BotLevels({ g }: { g: UiSettings['game'] }) {
  const gold = useStore(services.player).gold;
  const shared = sharedLevel(g.difficulties, g.bots);
  const [each, setEach] = useState(shared === null);
  if (g.bots === 0) return null;
  return (
    <div class="play__levels">
      {!each || g.bots === 1 ? (
        <>
          <div class="play__label">{g.bots === 1 ? 'How hard is the bot?' : 'How hard are the bots?'}</div>
          <Choice label="Bot difficulty" value={shared} options={levels(gold)}
            onChange={level => setGame({ difficulties: Array.from({ length: MAX_PLAYERS }, () => level) })} />
          {g.bots > 1 && <button type="button" class="play__link" onClick={() => setEach(true)}>Set each bot separately</button>}
        </>
      ) : (
        <>
          {Array.from({ length: g.bots }, (_, k) => (
            <Row key={k} label={`Bot ${k + 1}`} id={`play-ai${k + 1}`}>
              <select id={`play-ai${k + 1}`} value={g.difficulties[k] ?? 'easy'}
                onChange={e => setGame({ difficulties: g.difficulties.map((d, j) => (j === k ? e.currentTarget.value as BotLevel : d)) })}>
                {levels(gold).map(l => <option key={l.value} value={l.value} disabled={'disabled' in l && l.disabled}>{l.name}</option>)}
              </select>
            </Row>
          ))}
          <button type="button" class="play__link" onClick={() => {
            setEach(false);
            const first = g.difficulties[0] ?? 'easy';
            setGame({ difficulties: Array.from({ length: MAX_PLAYERS }, () => first) });
          }}>Same for every bot</button>
        </>
      )}
    </div>
  );
}

/** Give the bots names of your own ("Bot " goes in front). Empty boxes keep the usual names. */
export function BotNames({ bots }: { bots: number }) {
  const names = useStore(settings).botNames;
  const [open, setOpen] = useState(() => names.slice(0, bots).some(n => n.trim()));
  if (bots === 0) return null;
  if (!open) return <button type="button" class="play__link" onClick={() => setOpen(true)}>Name the bots</button>;
  const setName = (k: number, v: string) => updateSettings(s => ({ ...s, botNames: Array.from({ length: MAX_PLAYERS }, (_, j) => (j === k ? v : s.botNames[j] ?? '')) }));
  return (
    <div class="play__botnames">
      <div class="play__label">Bot names <span class="btw-muted">(empty = the usual name)</span></div>
      {Array.from({ length: bots }, (_, k) => (
        <label class="names__row" key={k}>
          <span class="names__label">Bot {k + 1}</span>
          <input type="text" maxLength={BOT_NAME_MAX} autoCapitalize="none" spellcheck={false} value={names[k] ?? ''} placeholder={'Bot ' + (k + 1) + "'s name"} autoComplete="off"
            onInput={e => setName(k, e.currentTarget.value)} />
        </label>
      ))}
    </div>
  );
}

/** How the game ends: hidden behind "More options", since most players never change it. */
function MoreOptions({ g }: { g: UiSettings['game'] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" class="play__link play__more" onClick={() => setOpen(true)}>
        <span class="play__more-link">More options</span> <span class="play__more-now">(game ends: {endingName(g.ending, g)})</span>
      </button>
    );
  }
  return (
    <div class="play__options">
      <Row label="The game ends with" id="play-ending">
        <select id="play-ending" value={String(g.ending)} onChange={e => setGame({ ending: Number(e.currentTarget.value) as Ending })}>
          {ENDINGS.map(n => <option key={n} value={String(n)}>{ENDING_NAMES[n]}</option>)}
        </select>
      </Row>
      {g.ending === 5 && (
        <Row label="First to" id="play-miles">
          <NumberBox id="play-miles" label="Miles that win" value={g.miles ?? MILES_TO_WIN} {...MILES_RANGE} unit="miles"
            onChange={miles => setGame({ miles })} />
        </Row>
      )}
      {g.ending === 6 && (
        <Row label="Ends in" id="play-minutes">
          <NumberBox id="play-minutes" label="Minutes of play" value={g.minutes ?? DEFAULT_MINUTES} {...MINUTES_RANGE} unit="minutes"
            onChange={minutes => setGame({ minutes })} />
        </Row>
      )}
      {usesDeck(g.ending) && (
        <Row label="The deck runs out" id="play-times">
          <select id="play-times" value={String(g.endingTimes)} onChange={e => setGame({ endingTimes: e.currentTarget.value === '2' ? 2 : 1 })}>
            <option value="1">Once</option>
            <option value="2">Twice</option>
          </select>
        </Row>
      )}
    </div>
  );
}

export function PlayMenu({ onClose }: { onClose: () => void }) {
  const g = useStore(settings).game;
  const [step, setStep] = useState<Step>('mode');

  if (step === 'names') return <PlayerNames onStart={() => { onClose(); startPassNPlay(); }} onClose={() => setStep('pass')} />;

  if (step === 'mode') {
    const pickBots = () => {
      // You and 1-5 bots
      const bots = Math.min(MAX_PLAYERS - 1, Math.max(1, g.bots || g.players - 1));
      setGame({ players: bots + 1, bots });
      setStep('bots');
    };
    const pickPass = () => {
      // 2-6 people, and maybe bots too
      const people = Math.max(2, g.players - g.bots);
      setGame({ players: Math.min(MAX_PLAYERS, people + g.bots), bots: Math.min(g.bots, MAX_PLAYERS - people) });
      setStep('pass');
    };
    const pickWatch = () => {
      // 2-6 bots and nobody else
      const bots = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, g.players));
      setGame({ players: bots, bots });
      setStep('watch');
    };
    return (
      <Modal title="How do you want to play?" onClose={onClose}>
        <div class="menu-list play">
          <Button onClick={pickBots}>Play with bots</Button>
          <Button onClick={pickPass}>Pass'n'Play</Button>
          <Button onClick={() => { onClose(); screen.set('online'); }}>Play online</Button>
          <p class="play__about">Pass'n'Play: friends take turns on this device.</p>
          <div class="play__buttons">
            <Button color="plain" onClick={onClose}>Cancel</Button>
            <button type="button" class="play__link" onClick={pickWatch}>Just watch bots play</button>
          </div>
        </div>
      </Modal>
    );
  }

  if (step === 'bots') {
    return (
      <Modal title="Play with bots" onClose={onClose}>
        <div class="play settings">
          <Row label="How many bots?">
            <Stepper label="Bots" value={g.bots} min={1} max={MAX_PLAYERS - 1} onChange={bots => setGame({ players: bots + 1, bots })} />
          </Row>
          <BotLevels g={g} />
          <BotNames bots={g.bots} />
          <MoreOptions g={g} />
          <div class="play__buttons">
            <Button color="plain" onClick={() => setStep('mode')}>Back</Button>
            <Button onClick={() => { onClose(); startVsBots(); }}>Start</Button>
          </div>
        </div>
      </Modal>
    );
  }

  if (step === 'watch') {
    return (
      <Modal title="Watch bots play" onClose={onClose}>
        <div class="play settings">
          <Row label="How many bots?">
            <Stepper label="Bots" value={g.bots} min={MIN_PLAYERS} max={MAX_PLAYERS} onChange={bots => setGame({ players: bots, bots })} />
          </Row>
          <BotLevels g={g} />
          <BotNames bots={g.bots} />
          <MoreOptions g={g} />
          <div class="play__buttons">
            <Button color="plain" onClick={() => setStep('mode')}>Back</Button>
            <Button onClick={() => { onClose(); startWatch(); }}>Start</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Pass'n'Play
  const people = g.players - g.bots;
  return (
    <Modal title="Pass'n'Play" onClose={onClose}>
      <div class="play settings">
        <Row label="How many people?">
          <Stepper label="People" value={people} min={MIN_PLAYERS} max={MAX_PLAYERS}
            onChange={n => { const bots = Math.min(g.bots, MAX_PLAYERS - n); setGame({ players: n + bots, bots }); }} />
        </Row>
        <Row label="Bots too?">
          <Stepper label="Bots" value={g.bots} min={0} max={MAX_PLAYERS - people} onChange={bots => setGame({ players: people + bots, bots })} />
        </Row>
        <BotLevels g={g} />
        <BotNames bots={g.bots} />
        <MoreOptions g={g} />
        <div class="play__buttons">
          <Button color="plain" onClick={() => setStep('mode')}>Back</Button>
          <Button onClick={() => setStep('names')}>Next</Button>
        </div>
      </div>
    </Modal>
  );
}
