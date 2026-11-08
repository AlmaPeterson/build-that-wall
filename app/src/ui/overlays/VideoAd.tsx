// The video ad that players without Gold see after each game (the old game's btwlinks.videoAd):
// one of the owner's YouTube ads for the card game, in random order (the next one if a video can't
// play), skippable after 10 seconds, with a link to the card game on Amazon. If no video can play at
// all, a plain card-game ad shows instead.
import { useEffect, useRef, useState } from 'preact/hooks';

/** YouTube video ids; `tall` ones are Shorts (9:16). */
export const VIDEO_ADS: readonly { id: string; tall: boolean }[] = [
  { id: 'mXjRVL2FDTY', tall: false }, { id: '_F3-WzySW1I', tall: false }, { id: 'IspFcpG2WNA', tall: false },
  { id: 'U2q_p0s-3Y0', tall: false }, { id: '2JZI4FGjvrc', tall: true },
];
export const SKIP_SECONDS = 10;

interface YTPlayer { destroy(): void; playVideo(): void }
interface YTApi { Player: new (el: HTMLElement, opts: object) => YTPlayer }
declare global { interface Window { YT?: YTApi; onYouTubeIframeAPIReady?: () => void } }

let loading: Promise<YTApi> | null = null;
/** The YouTube player API, loaded once. */
function loadYouTube(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YTApi>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch { /* not ours */ } resolve(window.YT!); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { loading = null; reject(new Error('YouTube did not load')); };
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('YouTube timed out')), 8000);
  });
  return loading;
}

const shuffled = <T,>(list: readonly T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
};

export function VideoAd({ storeUrl, onDone, only }: { storeUrl: string; onDone: () => void; only?: number }) {
  const [left, setLeft] = useState(SKIP_SECONDS);
  const [tall, setTall] = useState(false);
  const [fallback, setFallback] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const finish = () => { if (!done.current) { done.current = true; onDone(); } };

  useEffect(() => {
    const t = setInterval(() => setLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let player: YTPlayer | null = null, stopped = false;
    const order = only !== undefined && VIDEO_ADS[only] ? [VIDEO_ADS[only]!] : shuffled(VIDEO_ADS);
    const next = (yt: YTApi) => {
      try { player?.destroy(); } catch { /* gone */ }
      player = null;
      const ad = order.shift();
      if (stopped) return;
      if (!ad || !holder.current) { setFallback(true); return; }
      setTall(ad.tall);
      holder.current.innerHTML = '<div></div>';
      try {
        player = new yt.Player(holder.current.firstChild as HTMLElement, {
          videoId: ad.id, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
          playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
          events: { onReady: (e: { target: YTPlayer }) => { try { e.target.playVideo(); } catch { /* blocked */ } }, onError: () => next(yt) },
        });
      } catch { next(yt); }
    };
    loadYouTube().then(next, () => { if (!stopped) setFallback(true); });
    return () => { stopped = true; try { player?.destroy(); } catch { /* gone */ } };
  }, [only]);

  return (
    <div class="btw-ad" role="dialog" aria-modal="true" aria-label="Video ad"
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' && left <= 0) finish(); }}>
      <div class={'btw-ad-box' + (tall && !fallback ? ' btw-ad-box--tall' : '')}>
        <div class="btw-ad-head"><span>BUILD THAT WALL</span><span class="btw-ad-label">Ad · Gold members see no ads</span></div>
        <div class="btw-ad-video">
          {fallback
            ? <div class="btw-ad-card"><div class="btw-ad-card-title">BUILD THAT WALL</div>
                <div>The outrageous political card game.<br />Play it for real with friends and family!</div></div>
            : <div class="btw-ad-yt" ref={holder} />}
        </div>
        <div class="btw-ad-row">
          {storeUrl && <a class="btw-ad-buy" href={storeUrl} target="_blank" rel="noopener">Get the card game on Amazon</a>}
          <button type="button" class="btw-ad-skip" disabled={left > 0} onClick={finish}>
            {left > 0 ? 'Skip in ' + left : 'Skip ad'}
          </button>
        </div>
      </div>
    </div>
  );
}
