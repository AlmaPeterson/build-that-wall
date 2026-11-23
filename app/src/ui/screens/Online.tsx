// Online: quick match, host a private room, join with a code; then the lobby until the host starts.
import { useEffect, useRef, useState } from 'preact/hooks';
import { screen, settings } from '../app-state';
import { Message, Page } from '../account/Page';
import { Button } from '../components/Button';
import { ENDINGS, ENDING_NAMES, MILES_RANGE, MINUTES_RANGE, endingName, updateSettings, usesDeck } from '../menus/prefs';
import { NumberBox } from '../menus/controls';
import { onlineIntent } from '../menus/start';
import { online } from '../online';
import { MAX_SEATS, type LobbyPlayer } from '../online/messages';
import { pendingJoin, shareJoinLink } from '../online/join-link';
import type { BotLevel } from '../online/session';
import type { Ending } from '../../game';
import { services } from '../services';
import { useStore } from '../store';

const BOT_LEVELS: [BotLevel, string][] = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['insane', 'Insane ★'], ['random', 'Random']];

/** Host: change how the game ends, and remember it for next time (the Play menu's More options too). */
function pickEnding(ending: Ending, endingTimes: 1 | 2, numbers: { miles?: number; minutes?: number } = {}): void {
  online.setEnding(ending, endingTimes, numbers);
  updateSettings(s => ({ ...s, game: { ...s.game, ending, endingTimes, ...numbers } }));
}

/** "Exhaust Deck (the deck runs out twice)" and so on. */
function endingText(ending: Ending, times: 1 | 2, numbers: { miles: number; minutes: number }): string {
  if (ending === 5 || ending === 6) return endingName(ending, numbers);
  return ENDING_NAMES[ending] + (usesDeck(ending) ? (times === 2 ? ' (the deck runs out twice)' : ' (the deck runs out once)') : '');
}

/** "host", "(you)", or for a guest whose device they share. */
function whoIs(p: LobbyPlayer, mySeat: number, players: LobbyPlayer[]): string {
  if (p.guest) return p.seat === mySeat ? 'on your device' : 'with ' + (players.find(x => x.seat === p.seat && !x.guest)?.name ?? 'another player');
  return (p.seat === 1 ? 'host' : '') + (p.seat === mySeat ? ' (you)' : '');
}

const ROOM_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Gold: your own room code ("G" + 5 letters), made once and kept with your account. `fresh` makes a new one. */
export function myRoomCode(fresh = false): string {
  const had = services.store.get('myroom');
  if (had && !fresh) return had;
  let code = 'G';
  for (let i = 0; i < 5; i++) code += ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)];
  services.store.set('myroom', code);
  return code;
}

/** Gold: a private room whose code never changes, so friends can join it every week with the same code. */
function MyRoom() {
  const [code, setCode] = useState(() => myRoomCode());
  return (
    <section class="btw-card" aria-labelledby="myroom-h">
      <h2 id="myroom-h">Your own room <span class="btw-gold-star">★</span></h2>
      <p>Your room's code stays the same every time you open it, so your friends can keep it.</p>
      <p class="btw-code" aria-label={'Room code ' + code.split('').join(' ')}>{code}</p>
      <div class="btw-row">
        <Button color="gold" onClick={() => void online.hostRoom(6, code)}>Open my room</Button>
        <Button color="plain" onClick={() => setCode(myRoomCode(true))}>New code</Button>
      </div>
    </section>
  );
}

/** More people playing on this device: they pass it between them on their turns, like Pass'n'Play. */
function DeviceGuests({ guests, full }: { guests: string[]; full: boolean }) {
  const [name, setName] = useState('');
  const add = (e: Event) => {
    e.preventDefault();
    if (online.addGuest(name)) setName('');
  };
  return (
    <div class="online-guests">
      <h3>More people on this device?</h3>
      <p class="btw-muted">Add them here. On their turns you pass this device to them, like Pass'n'Play.</p>
      {guests.length > 0 && (
        <ul class="btw-list">{guests.map((g, i) => (
          <li key={i}><span>{g}</span><Button color="plain" aria-label={'Remove ' + g} onClick={() => online.removeGuest(i)}>Remove</Button></li>
        ))}</ul>
      )}
      <form class="btw-row" onSubmit={add}>
        <input class="btw-input" value={name} maxLength={20} placeholder="Their name" aria-label="Name of another player on this device"
          onInput={e => setName(e.currentTarget.value)} />
        <Button color="plain" type="submit" disabled={full}>Add player</Button>
      </form>
      {full && <p class="btw-muted">The game is full (6 players).</p>}
    </div>
  );
}

/** Copy the room's join link, or share it straight to a friend (phones). */
function JoinLinkButtons({ code }: { code: string }) {
  const [said, setSaid] = useState('');
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const go = async (share: boolean) => {
    const r = await shareJoinLink(code, share);
    setSaid(r === 'copied' ? 'Link copied! Paste it in a message to your friends. Opening it joins this room.'
      : r === 'shared' ? 'Link sent!' : r === 'failed' ? "Couldn't copy the link. Tell your friends the room code instead." : '');
  };
  return (
    <>
      <div class="btw-row">
        <Button color="navy" onClick={() => void go(false)}>Copy join link</Button>
        {canShare && <Button color="plain" onClick={() => void go(true)}>Share…</Button>}
      </div>
      {said && <p class="btw-muted" role="status">{said}</p>}
    </>
  );
}

export function OnlineScreen() {
  const st = useStore(online.state);
  const ui = useStore(settings);
  const player = useStore(services.player);
  const [code, setCode] = useState('');
  const [noRejoin, setNoRejoin] = useState(false);
  const codeBox = useRef<HTMLInputElement>(null);
  useEffect(() => { void services.init(); }, []);
  // The menu's choice (Quick online match, Host a private room, Join with a code): do it straight away
  useEffect(() => {
    // Opened from a join link: join that room
    const linked = pendingJoin.get();
    pendingJoin.set(null);
    if (linked && online.state.get().phase === 'idle') { setCode(linked); void online.join(linked); return; }
    const intent = onlineIntent.get();
    onlineIntent.set(null);
    if (!intent || online.state.get().phase !== 'idle') return;
    if (intent === 'quick') void online.quick();
    else if (intent === 'host') void online.hostRoom();
    else codeBox.current?.focus();
  }, []);

  const back = () => { if (st.phase !== 'playing') online.leave(); screen.set('menu'); };

  return (
    <Page title="Play Online" onBack={back}>
      {st.phase === 'idle' && (
        <>
          {!noRejoin && online.rejoinable() && (
            <section class="btw-card" aria-labelledby="rejoin-h">
              <h2 id="rejoin-h">Your online game</h2>
              <p>A bot has been playing your cards since you left. Go back in and play them yourself.</p>
              <div class="btw-row">
                <Button onClick={() => void online.rejoin()}>Rejoin</Button>
                <Button color="plain" onClick={() => { online.forget(); setNoRejoin(true); }}>No thanks</Button>
              </div>
            </section>
          )}
          <section class="btw-card" aria-labelledby="quick-h">
            <h2 id="quick-h">Quick match</h2>
            <p>Join a game that's waiting for players, or open one for others to join.</p>
            <p class="btw-muted">You'll play as <b>{player.name}</b>. Change it on the home page.</p>
            <div class="btw-row"><Button onClick={() => void online.quick()}>Find a game</Button></div>
          </section>
          {player.gold && <MyRoom />}
          <section class="btw-card" aria-labelledby="host-h">
            <h2 id="host-h">Play with friends</h2>
            <p>Open a private room and tell your friends its code.</p>
            <div class="btw-row"><Button color="navy" onClick={() => void online.hostRoom()}>Open a room</Button></div>
            <div class="btw-row">
              <input ref={codeBox} class="btw-input" placeholder="Room code" value={code} maxLength={8} autoCapitalize="characters"
                onInput={e => setCode((e.target as HTMLInputElement).value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter' && code.trim()) void online.join(code); }} aria-label="Room code" />
              <Button color="navy" disabled={!code.trim()} onClick={() => void online.join(code)}>Join</Button>
            </div>
            <label class="btw-row btw-muted">
              <input type="checkbox" checked={ui.autoJoin} onChange={e => settings.set({ ...ui, autoJoin: (e.target as HTMLInputElement).checked })} />
              Keep trying for a while if the room isn't open yet
            </label>
          </section>
          <Message text={st.error} ok={false} />
        </>
      )}

      {st.phase === 'connecting' && (
        <section class="btw-card">
          <p role="status">{st.status || 'Connecting...'}</p>
          <div class="btw-row"><Button color="plain" onClick={() => online.leave()}>Cancel</Button></div>
        </section>
      )}

      {st.phase === 'lobby' && (
        <section class="btw-card" aria-labelledby="lobby-h">
          <h2 id="lobby-h">{st.role === 'host' ? 'Your room' : 'Waiting room'}</h2>
          {/* Quick-match rooms ("W" + 5) have no code to share; a private code (5 letters) may start with W too */}
          {st.code && !(st.code.length === 6 && st.code.startsWith('W')) && <><p>Room code:</p><p class="btw-code" aria-label={'Room code ' + st.code.split('').join(' ')}>{st.code}</p><JoinLinkButtons code={st.code} /></>}
          <p>Players ({st.players.length}{st.bots ? ' + ' + st.bots + (st.bots === 1 ? ' bot' : ' bots') : ''}):</p>
          <ul class="btw-list">{st.players.map((p, i) => <li key={i}><span>{p.gold && <b class="btw-gold-star" title="Gold member">★ </b>}{p.name}</span><span class="btw-muted">{whoIs(p, st.seat, st.players)}</span></li>)}</ul>
          <DeviceGuests guests={st.guests} full={st.players.length >= MAX_SEATS} />
          {st.role === 'host' ? (
            <>
              <div class="btw-row">
                <span>Bots:</span>
                <Button color="plain" aria-label="Fewer bots" onClick={() => online.setBots(st.bots - 1)}>-</Button>
                <b aria-live="polite">{st.bots}</b>
                <Button color="plain" aria-label="More bots" onClick={() => online.setBots(st.bots + 1)}>+</Button>
              </div>
              {Array.from({ length: st.bots }, (_, k) => (
                <div class="btw-row" key={k}>
                  <label for={`online-bot${k + 1}`}>Bot {k + 1}:</label>
                  <select id={`online-bot${k + 1}`} class="btw-input" value={st.difficulties[k] ?? 'medium'}
                    onChange={e => online.setBotDifficulty(k, e.currentTarget.value as BotLevel)}>
                    {BOT_LEVELS.map(([v, name]) => <option key={v} value={v} disabled={v === 'insane' && !player.gold}>{name}{v === 'insane' && !player.gold ? ' (Gold)' : ''}</option>)}
                  </select>
                </div>
              ))}
              <div class="btw-row">
                <label for="online-ending">The game ends with</label>
                <select id="online-ending" class="btw-input" value={String(st.ending)} onChange={e => pickEnding(Number(e.currentTarget.value) as Ending, st.endingTimes)}>
                  {ENDINGS.map(n => <option key={n} value={String(n)}>{ENDING_NAMES[n]}</option>)}
                </select>
              </div>
              {st.ending === 5 && (
                <div class="btw-row">
                  <label for="online-miles">First to</label>
                  <NumberBox id="online-miles" label="Miles that win" value={st.miles} {...MILES_RANGE} unit="miles"
                    onChange={miles => pickEnding(st.ending, st.endingTimes, { miles })} />
                </div>
              )}
              {st.ending === 6 && (
                <div class="btw-row">
                  <label for="online-minutes">Ends in</label>
                  <NumberBox id="online-minutes" label="Minutes of play" value={st.minutes} {...MINUTES_RANGE} unit="minutes"
                    onChange={minutes => pickEnding(st.ending, st.endingTimes, { minutes })} />
                </div>
              )}
              {usesDeck(st.ending) && (
                <div class="btw-row">
                  <label for="online-times">The deck runs out</label>
                  <select id="online-times" class="btw-input" value={String(st.endingTimes)} onChange={e => pickEnding(st.ending, e.currentTarget.value === '2' ? 2 : 1)}>
                    <option value="1">Once</option>
                    <option value="2">Twice</option>
                  </select>
                </div>
              )}
              <div class="btw-row">
                <Button disabled={st.players.length + st.bots < 2} onClick={() => void online.start()}>Start game</Button>
                <Button color="plain" onClick={() => online.leave()}>Close room</Button>
              </div>
            </>
          ) : (
            <>
              <p>The game ends with: <b>{endingText(st.ending, st.endingTimes, st)}</b></p>
              <p class="btw-muted" role="status">{st.status || 'Waiting for the host to start...'}</p>
              <div class="btw-row"><Button color="plain" onClick={() => online.leave()}>Leave</Button></div>
            </>
          )}
          <Message text={st.error} ok={false} />
        </section>
      )}

      {st.phase === 'playing' && (
        <section class="btw-card">
          <p>Your online game is running.</p>
          <div class="btw-row">
            <Button onClick={() => online.backToGame()}>Back to the game</Button>
            <Button color="plain" onClick={() => online.askLeave()}>Leave the game</Button>
          </div>
        </section>
      )}

      {st.phase === 'ended' && (
        <section class="btw-card">
          <Message text={st.error || 'The online game ended.'} ok={false} />
          <div class="btw-row">
            {online.canRematch() && <Button onClick={() => void online.rematch()}>Rematch</Button>}
            <Button color={online.canRematch() ? 'plain' : undefined} onClick={() => online.leave()}>{online.canRematch() ? 'Leave the room' : 'OK'}</Button>
          </div>
        </section>
      )}
    </Page>
  );
}
