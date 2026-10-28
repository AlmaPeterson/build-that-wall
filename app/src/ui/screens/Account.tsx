// Account & Store: sign in (optional), your name, Gold, donations, backups, feedback.
import { useEffect, useState } from 'preact/hooks';
import { cleanName } from '../../services/online';
import { deviceInfo, openFeedbackBox } from '../../services/feedback';
import { userEmail } from '../../services/account';
import { screen } from '../app-state';
import { Message, Page } from '../account/Page';
import { buyMessage, codeMessage, nameMessage, trialMessage, type Said } from '../account/results';
import { Button } from '../components/Button';
import { services, type GoldItem } from '../services';
import { useStore } from '../store';

const money = (n: number, cur: string) => n.toFixed(2) + ' ' + cur;

export function AccountScreen() {
  const player = useStore(services.player);
  const config = useStore(services.config);
  const [said, setSaid] = useState<Record<string, Said | null>>({});
  const [busy, setBusy] = useState(false);
  const say = (area: string, s: Said | null) => setSaid(o => ({ ...o, [area]: s }));
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  useEffect(() => { void services.init(); }, []);

  return (
    <Page title="Account & Store">
      <AccountCard player={player} googleReady={!!config.googleClientId} busy={busy} run={run} said={said.account ?? null} say={s => say('account', s)} />

      <section class="btw-card" aria-labelledby="gold-h">
        <h2 id="gold-h">Gold Membership</h2>
        <p>{player.gold ? <span class="btw-gold">{player.goldInfo || 'Gold is active'}</span> : 'Gold unlocks every extra and supports the game.'}</p>
        {!player.signedIn && <p class="btw-muted">Sign in first: Gold belongs to your account, so it follows you to every device.</p>}
        <div class="btw-row">
          {(['lifetime', 'year', 'month'] as GoldItem[]).map(item => (
            <Button key={item} color="gold" disabled={busy || !player.signedIn} onClick={() => run(async () => {
              say('gold', buyMessage(await services.buyGold(item), 'gold'));
            })}>
              {item === 'lifetime' ? 'Lifetime' : item === 'year' ? '1 year' : '30 days'}: {money(item === 'lifetime' ? config.goldPriceLifetime : item === 'year' ? config.goldPriceYear : config.goldPriceMonth, config.currency)}
            </Button>
          ))}
        </div>
        <div class="btw-row">
          {!player.gold && <Button color="plain" disabled={busy || !player.signedIn} onClick={() => run(async () => {
            say('gold', trialMessage(await services.gold.startTrialAny(services.server())));
            services.refresh();
          })}>Try Gold free for 7 days</Button>}
          {player.renews && <Button color="plain" disabled={busy} onClick={() => run(async () => {
            const r = await services.purchases.endPayment(services.server());
            say('gold', r === 'ok' ? { text: 'Your plan will not renew. Gold stays until it ends.', ok: true }
              : r === 'paypal' ? { text: 'Stop the payment on the PayPal page that just opened.', ok: true }
              : { text: 'Could not stop the plan (' + r + '). Please try again.', ok: false });
            services.refresh();
          })}>End payment</Button>}
        </div>
        <GoldCode busy={busy} run={run} say={s => say('gold', s)} />
        <Message text={said.gold?.text ?? ''} ok={!!said.gold?.ok} />
      </section>

      <Donate busy={busy} run={run} currency={config.currency} said={said.donate ?? null} say={s => say('donate', s)} />

      <section class="btw-card" aria-labelledby="more-h">
        <h2 id="more-h">More</h2>
        <div class="btw-row">
          <Button color="navy" onClick={() => screen.set('leaderboard')}>Leaderboard</Button>
          <Button color="navy" onClick={() => void openFeedbackBox({
            name: player.name, replyTo: userEmail(services.store), feedbackUrl: config.feedbackUrl,
            store: { get: k => services.store.get(k) || null, set: (k, v) => services.store.set(k, v) },
            toast: services.toast, deviceInfo: () => deviceInfo({}),
          })}>Send feedback</Button>
        </div>
      </section>

      <SavesCard busy={busy} run={run} player={player} said={said.saves ?? null} say={s => say('saves', s)} />
    </Page>
  );
}

type Run = (fn: () => Promise<void>) => Promise<void>;
type PlayerInfo = ReturnType<typeof services.player.get>;

function AccountCard({ player, googleReady, busy, run, said, say }: { player: PlayerInfo; googleReady: boolean; busy: boolean; run: Run; said: Said | null; say: (s: Said | null) => void }) {
  const [name, setName] = useState(player.name);
  useEffect(() => setName(player.name), [player.name]);
  return (
    <section class="btw-card" aria-labelledby="acct-h">
      <h2 id="acct-h">Your account</h2>
      {player.signedIn
        ? <p>Signed in as <b>{player.name}</b>{player.maskedEmail && <span class="btw-muted"> ({player.maskedEmail})</span>}</p>
        : <p>You're playing as a guest. Everything works without an account; sign in to keep Gold, purchases and your saves on every device.</p>}
      <div class="btw-row">
        {player.signedIn
          ? <Button color="plain" disabled={busy} onClick={() => { services.signOut(); say({ text: 'Signed out. Your saves stay on this device for next time.', ok: true }); }}>Sign out</Button>
          : <Button color="red" disabled={busy} onClick={() => run(async () => {
              const r = await services.signIn();
              say(r === 'nosetup' ? { text: googleReady ? "Couldn't reach Google. Check your internet and try again." : "Sign-in isn't set up for this copy of the game yet.", ok: false }
                : r ? { text: 'Welcome, ' + r + '!', ok: true } : null);
            })}>Sign in with Google</Button>}
      </div>
      <label class="btw-row">
        <span>Your name</span>
        <input class="btw-input" value={name} maxLength={20} onInput={e => setName((e.target as HTMLInputElement).value)} aria-label="Your name" />
        <Button color="plain" disabled={busy} onClick={() => run(async () => {
          const clean = cleanName(name);
          if (!clean) { say(nameMessage('empty')); return; }
          const r = player.verified ? await services.account.claimName(services.server(), clean) : 'local';
          if (r === 'ok' || r === 'local' || r === 'noserver') services.store.set('name', clean);
          say(nameMessage(r));
          services.refresh();
        })}>Save name</Button>
      </label>
      <Message text={said?.text ?? ''} ok={!!said?.ok} />
    </section>
  );
}

function GoldCode({ busy, run, say }: { busy: boolean; run: Run; say: (s: Said) => void }) {
  const [code, setCode] = useState('');
  return (
    <div class="btw-row">
      <input class="btw-input" placeholder="Gold code (BTW1...)" value={code} onInput={e => setCode((e.target as HTMLInputElement).value)} aria-label="Gold code" />
      <Button color="plain" disabled={busy || !code.trim()} onClick={() => run(async () => {
        say(codeMessage(await services.gold.enter(code.trim())));
        setCode('');
        services.refresh();
      })}>Use code</Button>
    </div>
  );
}

function Donate({ busy, run, currency, said, say }: { busy: boolean; run: Run; currency: string; said: Said | null; say: (s: Said | null) => void }) {
  const [amount, setAmount] = useState('5');
  const give = (n: number) => run(async () => { say(buyMessage(await services.donate(n), 'donate')); });
  return (
    <section class="btw-card" aria-labelledby="donate-h">
      <h2 id="donate-h">Donate</h2>
      <p>Like the game? A donation helps keep it free and growing.</p>
      <div class="btw-row">
        {[1, 5, 10].map(n => <Button key={n} color="navy" disabled={busy} onClick={() => give(n)}>{money(n, currency)}</Button>)}
        <input class="btw-input" type="number" min="1" step="1" value={amount} onInput={e => setAmount((e.target as HTMLInputElement).value)} aria-label="Other amount" />
        <Button color="navy" disabled={busy || !(+amount >= 1)} onClick={() => give(Math.round(+amount * 100) / 100)}>Give</Button>
      </div>
      <Message text={said?.text ?? ''} ok={!!said?.ok} />
    </section>
  );
}

function SavesCard({ busy, run, player, said, say }: { busy: boolean; run: Run; player: PlayerInfo; said: Said | null; say: (s: Said | null) => void }) {
  const [backup, setBackup] = useState('');
  const [restore, setRestore] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <section class="btw-card" aria-labelledby="saves-h">
      <h2 id="saves-h">Saves</h2>
      <p class="btw-muted">Back up everything saved on this device, and paste it on another device (or after clearing your browser) to bring it back.</p>
      <div class="btw-row">
        <Button color="plain" onClick={() => {
          const code = services.store.exportBackup() ?? '';
          setBackup(code);
          try { void navigator.clipboard?.writeText(code); say({ text: 'Backup copied! Paste it somewhere safe.', ok: true }); } catch { say({ text: 'Copy the backup below and keep it somewhere safe.', ok: true }); }
        }}>Make a backup</Button>
      </div>
      {backup && <textarea class="btw-input" readOnly value={backup} aria-label="Your backup" onFocus={e => (e.target as HTMLTextAreaElement).select()} />}
      <textarea class="btw-input" placeholder="Paste a backup (BTWSAVE1...)" value={restore} onInput={e => setRestore((e.target as HTMLTextAreaElement).value)} aria-label="Backup to restore" />
      <div class="btw-row">
        <Button color="plain" disabled={!restore.trim()} onClick={() => {
          const r = services.store.importBackup(restore);
          if (r === 'ok') { say({ text: 'Backup restored. Reloading...', ok: true }); setTimeout(() => location.reload(), 800); }
          else say({ text: "That isn't a backup from this game.", ok: false });
        }}>Restore backup</Button>
        <Button color="plain" disabled={busy} onClick={() => {
          services.account.clearLocal(); services.refresh();
          say({ text: "This device's saves are cleared.", ok: true });
        }}>Clear this device</Button>
        {player.signedIn && !confirmDelete && <Button color="red" onClick={() => setConfirmDelete(true)}>Delete account</Button>}
      </div>
      {confirmDelete && (
        <div class="btw-row">
          <span>Delete your account and its saves for good? Gold and purchases on it are lost.</span>
          <Button color="red" disabled={busy} onClick={() => run(async () => {
            const r = await services.account.delete(services.server());
            setConfirmDelete(false); services.refresh();
            say(r === 'ok' || r === 'local' ? { text: 'Your account was deleted.', ok: true } : { text: 'Deleted here, but the game server did not answer (' + r + ').', ok: false });
          })}>Yes, delete it</Button>
          <Button color="plain" onClick={() => setConfirmDelete(false)}>Keep it</Button>
        </div>
      )}
      <Message text={said?.text ?? ''} ok={!!said?.ok} />
    </section>
  );
}
