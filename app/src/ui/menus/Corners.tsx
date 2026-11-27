// The home page's corners: the version badge (left) opens the version history; full screen and the bell (right); the bell shows
// notifications: new versions, new expansion packs, holiday sales on Gold and, for the owner, players' feedback.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Notice } from '../../services/notices/notices';
import { Button } from '../components/Button';
import { FullscreenButton } from '../components/FullscreenButton';
import { Modal } from '../components/Modal';
import { loadInbox, markRead, notices, showNotices, unreadIn, VERSIONS } from '../notifications';
import { useStore } from '../store';
import './corners.css';

const when = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const ICONS: Record<Notice['kind'], string> = { feature: '✨', pack: '🃏', sale: '🏷️', feedback: '✉️' };

function Item({ n, unread }: { n: Notice; unread: boolean }) {
  const [open, setOpen] = useState(false);
  const long = n.kind === 'feedback' && (n.text.length > 160 || !!n.device || !!n.files?.length);
  return (
    <li class={'bell__item' + (unread ? ' bell__item--new' : '') + ' bell__item--' + n.kind}>
      <span class="bell__icon" aria-hidden="true">{ICONS[n.kind]}</span>
      <div class="bell__body">
        <div class="bell__title">{n.title}{unread && <span class="bell__dot" aria-label="new" />}</div>
        <div class="bell__text">{long && !open ? n.text.slice(0, 160) + '…' : n.text}</div>
        {n.lines && <ul class="bell__lines">{n.lines.map(l => <li key={l}>{l}</li>)}</ul>}
        {n.kind === 'feedback' && open && (
          <>
            {n.device && <pre class="bell__device">{n.device}</pre>}
            {n.files?.map(f => <a key={f.url} href={f.url} target="_blank" rel="noopener">📎 {f.name}</a>)}
          </>
        )}
        <div class="bell__meta">
          {when(n.at)}
          {long && <button type="button" class="bell__more" onClick={() => setOpen(!open)}>{open ? 'Less' : 'More'}</button>}
          {n.replyTo && <a href={'mailto:' + n.replyTo + '?subject=' + encodeURIComponent('Re: your Build That Wall feedback')}>Reply</a>}
        </div>
      </div>
    </li>
  );
}

export function Bell() {
  const { list, unread, owner } = useStore(notices);
  const [open, setOpen] = useState(false);
  const [shownUnread, setShownUnread] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { showNotices(); void loadInbox(); }, []);
  // Close on Escape or a tap outside; what was seen counts as read once the list closes
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const tap = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) close(); };
    addEventListener('keydown', key); addEventListener('pointerdown', tap);
    return () => { removeEventListener('keydown', key); removeEventListener('pointerdown', tap); };
  }, [open]);
  function toggle() {
    if (open) { close(); return; }
    setShownUnread(new Set(unreadIn(list)));
    setOpen(true);
    void loadInbox();
  }
  function close() {
    setOpen(false);
    const seen = [...shownUnread].filter(id => !id.startsWith('fb:'));   // feedback is marked read by hand
    if (seen.length) markRead(seen);
  }
  const fbUnread = list.filter(n => n.kind === 'feedback' && !n.read).map(n => n.id);
  return (
    <div class="corner corner--right" ref={box}>
      <FullscreenButton class="bell corner__fullscreen" />
      <button type="button" class="bell" aria-label={'Notifications' + (unread ? ', ' + unread + ' new' : '')} aria-expanded={open} onClick={toggle}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a6 6 0 0 0-6 6v3.6L4.3 15A1 1 0 0 0 5.2 16.5h13.6a1 1 0 0 0 .9-1.5L18 11.6V8a6 6 0 0 0-6-6zm0 20a3 3 0 0 0 3-3H9a3 3 0 0 0 3 3z" /></svg>
        {unread > 0 && <span class="bell__count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div class="bell__panel" role="dialog" aria-label="Notifications">
          <div class="bell__head">
            <b>Notifications</b>
            {owner && fbUnread.length > 0 && <button type="button" class="bell__more" onClick={() => markRead(fbUnread)}>Mark feedback read</button>}
          </div>
          {list.length === 0 ? <p class="bell__empty">Nothing new right now.</p> : (
            <ul class="bell__list">{list.map(n => <Item key={n.id} n={n} unread={shownUnread.has(n.id) || (n.kind === 'feedback' && !n.read)} />)}</ul>
          )}
          {owner && <p class="bell__note">You're signed in as the owner, so players' feedback shows here instead of in your email.</p>}
        </div>
      )}
    </div>
  );
}

/** The version badge, and the history of every version since the game was first published. */
export function VersionBadge() {
  const [open, setOpen] = useState(false);
  const latest = VERSIONS[0];
  if (!latest) return null;
  return (
    <div class="corner corner--left">
      <button type="button" class="version" aria-label={'Version ' + latest.version + ': version history'} onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z" /></svg>
        <span>v{latest.version}</span>
      </button>
      {open && (
        <Modal title="Version history" onClose={() => setOpen(false)}>
          <div class="history">
            <p class="btw-muted">Every update since the game was first published, newest first.</p>
            <ol class="history__list">
              {VERSIONS.map(v => (
                <li key={v.version}>
                  <div class="history__head"><b>Version {v.version}</b> <span class="btw-muted">{v.date ? when(new Date(v.date + 'T00:00:00').getTime()) : 'Made in Scratch'}</span></div>
                  <ul>{v.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </li>
              ))}
            </ol>
            <div class="play__buttons"><Button color="plain" onClick={() => setOpen(false)}>Close</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
