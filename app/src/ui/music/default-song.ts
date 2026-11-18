// The game's own background song: a short, upbeat march made for this game, played by the browser's
// synthesizer (Web Audio), so there's no song file to download. It loops until stopped.

// One step is an eighth note. A note name starts a note, "-" holds the one before, "." is a rest; "|" is a bar line.
const LEAD = `
  E4 G4 C5 .  B4 C5 D5 .  | C5 A4 F4 A4 C5 -  .  .  | D5 B4 G4 B4 D5 C5 B4 G4 | C5 -  G4 E4 C4 -  .  .
  A4 C5 E5 -  D5 C5 A4 .  | F4 A4 C5 F5 E5 D5 C5 A4 | B4 D5 G5 -  F5 D5 B4 G4 | C5 -  E5 -  C5 -  .  .
  G4 -  G4 A4 G4 E4 C4 .  | F4 -  F4 G4 A4 C5 A4 F4 | G4 A4 B4 C5 D5 -  B4 G4 | E5 -  D5 C5 D5 -  G4 .
  C5 -  C5 D5 E5 -  C5 A4 | F5 -  E5 D5 C5 -  A4 F4 | G4 -  B4 D5 G5 -  F5 D5 | C5 -  .  G4 C5 -  .  .
`;
// Chords, one per bar: root, then the bass walks root, fifth, octave, fifth
const CHORDS = 'C F G C Am F G C C F G Em C F G C'.split(' ');

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
    const root = 36 + SEMI[c[0]!]!;   // C2…B2
    return [0, 7, 12, 7].map((up, beat) => ({ step: bar * 8 + beat * 2, length: 2, midi: root + up }));
  });
}

export const SONG_STEPS = CHORDS.length * 8;
const TEMPO = 132;                     // quarter notes a minute
const STEP = 60 / TEMPO / 2;           // seconds per eighth note

type AudioCtx = typeof AudioContext;
const audioContext = (): AudioCtx | undefined =>
  (globalThis as { AudioContext?: AudioCtx; webkitAudioContext?: AudioCtx }).AudioContext
  ?? (globalThis as { webkitAudioContext?: AudioCtx }).webkitAudioContext;

export interface SongPlayer { stop(): void; setVolume(v: number): void }

/** Starts the song at `volume` (0-1). Null when this browser can't make sound. */
export function playDefaultSong(volume: number): SongPlayer | null {
  const Ctx = audioContext();
  if (!Ctx) return null;
  let ctx: AudioContext;
  try { ctx = new Ctx(); } catch { return null; }
  void ctx.resume().catch(() => {});
  const master = ctx.createGain();
  master.gain.value = volume * 0.5;
  master.connect(ctx.destination);

  const lead = leadNotes(), bass = bassNotes();
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
      for (const n of lead) if (n.step === next) tone(n, at, 'square', 0.12);
      for (const n of bass) if (n.step === next) tone(n, at, 'triangle', 0.35);
      if (next % 2 === 0) drum(at, next % 8 === 0);
      if (++next >= SONG_STEPS) { next = 0; loopStart += SONG_STEPS * STEP; }
    }
  };
  schedule();
  const timer = setInterval(schedule, 100);

  return {
    stop() { clearInterval(timer); void ctx.close().catch(() => {}); },
    setVolume(v) { master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.5, ctx.currentTime, 0.05); },
  };
}
