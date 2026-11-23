// The game's own background songs, made for this game and played by the browser's synthesizer (Web Audio),
// so there's no song file to download. Each loops until stopped. Pick one in Settings > Music.

// One step is an eighth note. A note name starts a note, "-" holds the one before, "." is a rest; "|" is a bar line.
const LEAD = `
  E4 G4 C5 .  B4 C5 D5 .  | C5 A4 F4 A4 C5 -  .  .  | D5 B4 G4 B4 D5 C5 B4 G4 | C5 -  G4 E4 C4 -  .  .
  A4 C5 E5 -  D5 C5 A4 .  | F4 A4 C5 F5 E5 D5 C5 A4 | B4 D5 G5 -  F5 D5 B4 G4 | C5 -  E5 -  C5 -  .  .
  G4 -  G4 A4 G4 E4 C4 .  | F4 -  F4 G4 A4 C5 A4 F4 | G4 A4 B4 C5 D5 -  B4 G4 | E5 -  D5 C5 D5 -  G4 .
  C5 -  C5 D5 E5 -  C5 A4 | F5 -  E5 D5 C5 -  A4 F4 | G4 -  B4 D5 G5 -  F5 D5 | C5 -  .  G4 C5 -  .  .
`;
// Chords, one per bar: root, then the bass walks root, fifth, octave, fifth
const CHORDS = 'C F G C Am F G C C F G Em C F G C'.split(' ');

export interface Song {
  id: string;
  name: string;
  lead: string;
  chords: string[];
  /** Quarter notes a minute */
  tempo: number;
  /** The lead's sound */
  wave: OscillatorType;
  /** A soft kick drum on the beat */
  drums: boolean;
}

/** Every song that comes with the game; the first is the one that plays unless the player picks another. */
export const SONGS: Song[] = [
  { id: 'march', name: 'Campaign March', lead: LEAD, chords: CHORDS, tempo: 132, wave: 'square', drums: true },
  {
    id: 'anthem', name: 'Liberty Anthem', tempo: 96, wave: 'triangle', drums: false,
    chords: 'F C Dm A# F C F C A# F Gm C Dm A# C F'.split(' '),
    lead: `
  C4 -  F4 -  A4 -  F4 -  | G4 -  E4 -  C4 -  .  .  | D4 -  F4 -  A4 -  D5 -  | C5 -  A#4 - A4 -  G4 -
  A4 -  C5 -  F5 -  C5 -  | E5 -  D5 -  C5 -  G4 -  | A4 -  C5 -  A4 -  F4 -  | G4 -  -  -  .  .  .  .
  A#4 - D5 -  F5 -  D5 -  | C5 -  A4 -  F4 -  A4 -  | G4 -  A#4 - D5 -  A#4 - | C5 -  E5 -  G5 -  .  .
  F5 -  E5 -  D5 -  A4 -  | A#4 - D5 -  F5 -  -  -  | E5 -  D5 -  C5 -  E4 -  | F4 -  -  -  -  -  .  .
`,
  },
  {
    id: 'rag', name: 'Victory Rag', tempo: 150, wave: 'square', drums: true,
    chords: 'C A Dm G C A Dm G F C D G C F G C'.split(' '),
    lead: `
  E5 .  C5 E5 G5 .  E5 C5 | C#5 . E5 .  A4 C#5 E5 . | D5 .  F5 A5 F5 .  D5 .  | B4 D5 G5 -  F5 D5 B4 .
  E5 .  C5 E5 G5 .  C6 .  | A5 G5 E5 C#5 A4 . .  .  | F5 .  E5 D5 A4 .  F4 .  | G4 A4 B4 D5 G5 -  .  .
  A5 .  F5 A5 C6 .  A5 F5 | G5 .  E5 G5 C6 .  G5 E5 | F#5 . D5 F#5 A5 . F#5 D5 | G5 F5 D5 B4 G4 .  .  .
  E5 G5 C6 -  B5 -  A5 -  | A5 -  F5 -  C5 -  A4 -  | B4 D5 G5 -  F5 D5 B4 G4 | C5 -  G4 -  C5 -  .  .
`,
  },
  {
    id: 'debate', name: 'Late Night Debate', tempo: 108, wave: 'sine', drums: true,
    chords: 'Am F C G Am F E E Am Dm G C F Dm E Am'.split(' '),
    lead: `
  A4 -  C5 -  E5 -  D5 C5 | A4 -  -  -  F4 -  .  .  | G4 -  C5 -  E5 -  G5 -  | F5 -  E5 D5 B4 -  .  .
  A4 -  E5 -  A5 -  G5 E5 | F5 -  E5 -  C5 -  A4 -  | G#4 - B4 -  E5 -  D5 -  | B4 -  -  -  .  .  .  .
  C5 -  B4 A4 E5 -  .  .  | F5 -  E5 D5 A4 -  .  .  | D5 -  C5 B4 G4 -  B4 D5 | E5 -  -  -  C5 -  .  .
  A5 -  G5 F5 C5 -  F5 -  | D5 -  F5 -  A5 -  F5 -  | E5 -  G#4 - B4 -  D5 -  | C5 -  B4 -  A4 -  .  .
`,
  },
];

export const songById = (id?: string): Song => SONGS.find(x => x.id === id) ?? SONGS[0]!;

const NOTE = /^([A-G])(#?)(\d)$/;
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const midiOf = (name: string) => { const m = NOTE.exec(name); return m ? 12 * (Number(m[3]) + 1) + SEMI[m[1]!]! + (m[2] ? 1 : 0) : null; };

export interface SongNote { step: number; length: number; midi: number }

/** The lead line as notes (step = eighth note from the start). */
export function leadNotes(text = LEAD): SongNote[] {
  const notes: SongNote[] = [];
  let step = 0;
  for (const tok of text.split(/\s+/).filter(t => t && t !== '|')) {
    if (tok === '-') { const last = notes[notes.length - 1]; if (last && last.step + last.length === step) last.length++; }
    else if (tok !== '.') { const midi = midiOf(tok); if (midi !== null) notes.push({ step, length: 1, midi }); }
    step++;
  }
  return notes;
}

/** Bass notes: four quarter notes a bar. */
export function bassNotes(chords = CHORDS): SongNote[] {
  return chords.flatMap((c, bar) => {
    const root = 36 + SEMI[c[0]!]! + (c[1] === '#' ? 1 : 0);   // C2…B2
    return [0, 7, 12, 7].map((up, beat) => ({ step: bar * 8 + beat * 2, length: 2, midi: root + up }));
  });
}

export const SONG_STEPS = CHORDS.length * 8;

type AudioCtx = typeof AudioContext;
const audioContext = (): AudioCtx | undefined =>
  (globalThis as { AudioContext?: AudioCtx; webkitAudioContext?: AudioCtx }).AudioContext
  ?? (globalThis as { webkitAudioContext?: AudioCtx }).webkitAudioContext;

export interface SongPlayer { stop(): void; setVolume(v: number): void }

/** How many times a song plays through before the next one, when the game's songs play one after another. */
export const SONG_LOOPS = 2;

/**
 * Starts a song (the first one unless another is named) at `volume` (0-1). It loops for ever, or with
 * `onEnd`, plays SONG_LOOPS times and then calls it. Null when this browser can't make sound.
 */
export function playDefaultSong(volume: number, id?: string, onEnd?: () => void): SongPlayer | null {
  const tune = songById(id);
  const STEP = 60 / tune.tempo / 2;    // seconds per eighth note
  const steps = tune.chords.length * 8;
  const Ctx = audioContext();
  if (!Ctx) return null;
  let ctx: AudioContext;
  try { ctx = new Ctx(); } catch { return null; }
  void ctx.resume().catch(() => {});
  const master = ctx.createGain();
  master.gain.value = volume * 0.5;
  master.connect(ctx.destination);

  const lead = leadNotes(tune.lead), bass = bassNotes(tune.chords);
  const tone = (n: SongNote, at: number, type: OscillatorType, level: number) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq(n.midi);
    const end = at + n.length * STEP;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.015);
    g.gain.exponentialRampToValueAtTime(level * 0.6, at + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, end - 0.01);
    o.connect(g).connect(master);
    o.start(at); o.stop(end);
  };
  const drum = (at: number, accent: boolean) => {
    // A soft kick: a quick drop in pitch
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(accent ? 120 : 90, at);
    o.frequency.exponentialRampToValueAtTime(40, at + 0.12);
    g.gain.setValueAtTime(accent ? 0.5 : 0.25, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
    o.connect(g).connect(master);
    o.start(at); o.stop(at + 0.16);
  };

  // Schedule a little ahead of time, a few times a second, so the beat stays steady
  let loopStart = ctx.currentTime + 0.1, next = 0;
  const schedule = () => {
    const until = ctx.currentTime + 0.4;
    while (loopStart + next * STEP < until) {
      const at = loopStart + next * STEP;
      for (const n of lead) if (n.step === next) tone(n, at, tune.wave, tune.wave === 'square' ? 0.12 : 0.3);
      for (const n of bass) if (n.step === next) tone(n, at, 'triangle', 0.35);
      if (tune.drums && next % 2 === 0) drum(at, next % 8 === 0);
      if (++next >= steps) {
        next = 0; loopStart += steps * STEP;
        if (onEnd && ++loops >= SONG_LOOPS) {
          ended = true;
          setTimeout(() => { if (ended && !stopped) onEnd(); }, Math.max(0, (loopStart - ctx.currentTime) * 1000));
          return;
        }
      }
    }
  };
  let loops = 0, ended = false, stopped = false;
  schedule();
  const timer = setInterval(() => { if (!ended) schedule(); }, 100);

  return {
    stop() { stopped = true; clearInterval(timer); void ctx.close().catch(() => {}); },
    setVolume(v) { master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.5, ctx.currentTime, 0.05); },
  };
}
