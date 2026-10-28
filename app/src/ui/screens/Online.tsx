// Online: quick match, host a private room, join with a code; then the lobby until the host starts.
import { useEffect, useRef, useState } from 'preact/hooks';
import { screen, settings } from '../app-state';
import { Message, Page } from '../account/Page';
import { Button } from '../components/Button';
import { onlineIntent } from '../menus/start';
import { online } from '../online';
import { services } from '../services';
import { useStore } from '../store';

export function OnlineScreen() {
  const st = useStore(online.state);
  const ui = useStore(settings);
  const player = useStore(services.player);
  const [code, setCode] = useState('');
  const codeBox = useRef<HTMLInputElement>(null);
  useEffect(() => { void services.init(); }, []);
  // The menu's choice (Quick online match, Host a private room, Join with a code): do it straight away
  useEffect(() => {
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
          <section class="btw-card" aria-labelledby="quick-h">
            <h2 id="quick-h">Quick match</h2>
            <p>Join a game that's waiting for players, or open one for others to join.</p>
            <p class="btw-muted">You'll play as <b>{player.name}</b>. Change your name on the Account & Store screen.</p>
            <div class="btw-row"><Button onClick={() => void online.quick()}>Find a game</Button></div>
          </section>
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
          {st.code && !st.code.startsWith('W') && <><p>Room code:</p><p class="btw-code" aria-label={'Room code ' + st.code.split('').join(' ')}>{st.code}</p></>}
          <p>Players ({st.players.length}{st.bots ? ' + ' + st.bots + (st.bots === 1 ? ' bot' : ' bots') : ''}):</p>
          <ul class="btw-list">{st.players.map(p => <li key={p.seat}><span>{p.name}</span><span class="btw-muted">{p.seat === 1 ? 'host' : ''}{p.seat === st.seat ? ' (you)' : ''}</span></li>)}</ul>
          {st.role === 'host' ? (
            <>
              <div class="btw-row">
                <span>Bots:</span>
                <Button color="plain" aria-label="Fewer bots" onClick={() => online.setBots(st.bots - 1)}>-</Button>
                <b aria-live="polite">{st.bots}</b>
                <Button color="plain" aria-label="More bots" onClick={() => online.setBots(st.bots + 1)}>+</Button>
              </div>
              <div class="btw-row">
                <Button disabled={st.players.length + st.bots < 2} onClick={() => void online.start()}>Start game</Button>
                <Button color="plain" onClick={() => online.leave()}>Close room</Button>
              </div>
            </>
          ) : (
            <>
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
            <Button onClick={() => screen.set('game')}>Back to the game</Button>
            <Button color="plain" onClick={() => online.leave()}>Leave the game</Button>
          </div>
        </section>
      )}

      {st.phase === 'ended' && (
        <section class="btw-card">
          <Message text={st.error || 'The online game ended.'} ok={false} />
          <div class="btw-row"><Button onClick={() => online.leave()}>OK</Button></div>
        </section>
      )}
    </Page>
  );
}
