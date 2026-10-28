# Refactor plan: Build That Wall → TypeScript

## Why

The game today is a PenguinMod (Scratch fork) project packaged into a web page:

| File | Size | What it is |
|---|---|---|
| `script.js` | 6.4 MB | PenguinMod/Scratch runtime + libraries (minified vendor code) |
| `index.html` | 1.9 MB | Packager page; our custom JS and 8 extensions are base64-embedded on one line |
| `assets/project.json` | 8.9 MB | The game: 14,131 Scratch blocks in 11 sprites, 213 global variables, 95 lists, 3 comments |
| `assets/*` | 733 files | Costumes and sounds, named by hash |
| `game-server.gs` | ~560 lines | Google Apps Script backend (accounts, PayPal, leaderboard, feedback) |

Problems: ~16 MB downloaded before the game starts, blocks can't be diffed, searched,
reviewed or tested, and the hand-written JS is only reachable by base64-decoding `index.html`.

**Decision:** rewrite the game in **TypeScript**, rendered with **HTML/CSS + SVG**
(cards and UI are already SVGs, the game is turn-based, and text-size settings are
natural in CSS), built with **Vite**, tested with **Vitest**.

The current PenguinMod game stays live at the repo root until the new one reaches parity.
The new game lives in `app/`.

## Branching

Work happens on `game-refactor`. Each piece of work gets a sub-branch named
`game-refactor-<topic>` (git can't nest `game-refactor/…` under an existing branch),
which is merged back into `game-refactor` with `--no-ff`.

## Bugs fixed before the refactor (done)

- **Lifetime Gold charged but never unlocked**: server had no `gold:lifetime` price and
  checked the amount *after* capturing payment. Fixed in `game-server.gs`.
- **Error toasts shown as gold success messages**: `_toast` was defined twice in BTW Links.
  Renamed the trial one to `_goldToast`.

## What carries over

- **BTW Links extension** (~2,600 lines of hand-written JS): accounts, Google sign-in,
  Gold codes, PayPal, trial, saves, online play (MQTT), feedback filter, leaderboard,
  music, UI panels (pass/win screens, guide, feedback box, text sizes, turn recap).
- **`game-server.gs`** — unchanged API, so the new client talks to the same server.
- **All images and sounds.**
- **`game-settings.json`** format.

What must be **re-implemented** from blocks: card rules and effects, turn flow, dealing,
bots (incl. "hard bots learn"), walls/miles scoring, hand/scrollbar, menus, settings,
tutorial, animations.

## Phases

### Phase 0 — Foundations (done)
1. **Scaffold** `app/`: Vite + TypeScript (strict) + Vitest, folder layout, npm scripts.
2. **Port the services** out of BTW Links into typed, Scratch-free modules with tests:
   - `services/storage`, `services/account` (Google sign-in, server API, saves, sync),
     `services/gold` (signed codes, trial, entitlements), `services/payments` (PayPal)
   - `services/online` (MQTT transport, rooms, host/join), `services/feedback` (filter + send)
   - Drop the dead PeerJS transport (`_loadPeer`, `_old*` methods) and duplicate methods.
3. **Make the blocks readable**: a `tools/dump-project` script that turns `project.json`
   into readable text (one file per sprite, scripts and custom blocks as indented pseudo-code),
   so rules can be ported without opening the editor.
4. **Write down the rules**: `docs/game-rules.md` (turn flow, win conditions, every card's
   effect, bot behaviour) and `app/src/data/cards.json` (the card catalogue), taken from the dump.
5. **Assets with names**: map hashed asset files to readable names (from costume/sound names).

### Phase 1 — Game core (pure logic, no UI) (done)
- `game/state.ts` (one serialisable game state), `game/rules.ts`, `game/cards/*`,
  `game/bots/*`, driven by actions (`playCard`, `buildWall`, `endTurn`…).
- Unit tests for every card effect and win condition, written from `docs/game-rules.md`.
- One serialisable state makes online sync simple: the host sends state/actions over MQTT.

### Phase 2 — UI (screens done; parity testing next)
- Screens: menu, game board, hand, walls display, panels, pass screen, win screen, settings,
  tutorial, store. Port the existing DOM panels from BTW Links.
- Match the 640×360 layout first; responsive improvements after parity.

### Phase 2b — Follow every action (animations) (done)
Owner's request (2026-10-28): every move must be easy to follow, bots' turns included. Nothing
should just appear or disappear; every card visibly travels from where it was to where it goes.

What the player must see:
- **Playing a card:** the card leaves the player's hand (the bot's hidden hand too), turns face up so
  everyone can read it, pauses large in the middle with a caption ("Bot 2 plays Debt on Player 1"),
  then flies to where it goes: the discard pile, or the **target player** for Debt and every other
  card played on someone (their wall row / scoreboard row lights up).
- **Building a wall:** the wall card flies into its exact spot in that player's built section.
  The payment is shown too: the Man Hour (or the two walls paid) flies to the discard pile.
- **Everything else that moves a card:** draws (card back flies from the draw pile to the hand; it is
  only face up for the player who drew it), blocks (the blocking card flies in and the blocked card
  goes to the discard), walls taken or knocked down, cards stolen or swapped between players,
  jail / quarantine / train guard markers, reshuffling the discard into the draw pile.
- A short **action log** on the board (last few lines, tap to see the whole game) so a missed move
  can be read back.

How to build it:
1. **Engine events say where things go.** `GameEvent` gets `from`/`to` places
   (`hand` + slot, `wall` + seat + position, `discard`, `draw`, `seat` for cards played on a player)
   and the payment cards for `build`. Engine tests check every card effect emits them.
2. **Controller keeps a queue.** After each event it stores the event with the redacted view as it is
   *after* that event. The board steps through the queue: animate the move, then show that view.
   The engine waits for the queue to drain before the next bot action (this replaces the fixed
   0.6 s bot pause), so the state on screen never jumps ahead of the animation.
3. **One flying-card layer on the board.** Hand slots, wall spots, piles and seats carry
   `data-place` attributes; the layer measures start and end and moves a card image between them
   with the Web Animations API (no library). Face-down for cards the viewer may not see.
4. **Human moves animate the same way** (from the tapped hand slot), and online clients animate from
   the events they receive, so every device sees the same thing.
5. **Settings → Animation speed:** Slow / Normal / Fast / Off. Tapping the board skips the current
   animation. `prefers-reduced-motion` starts at Off (cards fade into place instead).
6. **Tests:** queue order and waiting with fake timers (happy-dom can't measure positions);
   a headless-browser screenshot run of `?demo=watch` to check by eye.

### Phase 3 — Parity and switch-over
- Side-by-side play-testing against the PenguinMod version, checklist in `docs/parity.md`.
- Switch GitHub Pages to the new build; keep the old build at `/classic/` for a while.

### Phase 4 — Server tidy-up
- Split `game-server.gs` into files (`config`, `sheets`, `feedback`, `accounts`, `paypal`),
  manage it with `clasp`, merge duplicate sheet setup, one source of truth for prices,
  narrow the script lock so slow feedback calls don't block saves.

## Phase 0 results

- `app/src/services/`: storage, account, gold, payments, leaderboard, config (83 tests);
  online (MQTT rooms, typed protocol) and feedback (filter, send, box) (71 tests). PeerJS dropped.
- `tools/dump-project.py` → `docs/project-dump/`; `docs/game-rules.md`; `app/src/data/cards.json` (49 cards);
  `tools/export-assets.py` → `app/public/assets/` (896 files) + `app/src/data/assets.json`.
- Old behaviour kept as-is is marked `// NOTE:` in the code; bugs found in the blocks are in
  `docs/game-rules.md` section 15.

## Phase 2 results

- Preact screens in `app/src/ui/`: `controller.ts` (runs a game for the screens), `board/` (in-game screen),
  `overlays/` (every decision prompt, pass screen, recap, win screen, tips), `menus/` + `screens/`
  (menu, settings with the old pref keys, instructions/guide), `services.ts` + `account/` + `online/`
  (Account & Store, leaderboards, feedback, sound and music, online host/client games).
- Pass'n'Play hands the device to whoever must decide (e.g. Self-Defense mid-turn) and back again;
  other players' hands and drawn cards are never on screen. Online, each player only receives their own hand.
- Bots pause 0.6 s per action (1.1 s in watch mode). Local bots use the saved bot memory.
- `?demo`, `?demo=watch`, `?demo=<seed>` start a game straight away (dev helper).
- Build: ~90 KB gzipped JS + a 90 KB gzipped MQTT chunk loaded only for online play (old game: ~16 MB).

## Phase 2b results

- `app/src/ui/anim/`: `moves.ts` compares what the viewer saw before and after each event and lists the
  cards that moved (hidden cards stay face down), `animator.ts` queues the steps and plans each one,
  `layout.ts` says where every place is on the stage, `FlightLayer.tsx` flies the cards (Web Animations API).
- Comparing views instead of adding from/to to every event: every card effect is covered without touching
  it, and online clients animate the same way from the snapshots they receive.
- Played cards stop in the middle face up with a caption; cards played on someone go to that player first
  (their row lights up). The 'play' event now names the target ("played Debt on Bot Freedom").
- Bots wait until the board has shown their last move, then pause 0.35 s (0.7 s watching).
  The board can't be used, and prompts don't appear, until it has caught up.
- Settings → Card animations: Slow / Normal / Fast / Off (Off by default with reduced motion). Tap to skip a step.
- The log line top left opens the whole game's log.

Not done yet: video ads for non-Gold players, owner tools UI, online spectators, confetti; online play not yet tried against the real MQTT broker.

## Phase 1 results

- `app/src/game/`: `types.ts` + `contracts.ts` (shared), `engine/` (setup, turns, building, playing,
  endings, `viewFor` for online), `effects/` (every card), `bots/` (Easy/Medium/Hard, learning),
  `local.ts` (`createLocalGame` wires them together).
- Async engine: whenever a rule needs a choice it asks that seat's `Decider` (UI, bot or online room).
- Seeded random numbers live in the state: the same seed replays the same game.
- `simulate.test.ts` plays 96 bots-only games across player counts and endings: every game finishes
  and no card ever appears or disappears. Over 200 sample games: ~40 turns, every card gets played.

## Decisions (owner, 2026-10-27)

1. **Easy bots** build a wall whenever they can; when they can't build, they play an action card or
   Debt instead of passing (old game: they pass).
2. **Card 4** ("a card") is the card back, not a playable card.
3. **Handing out cards** goes clockwise, starting with the next seat.
4. **Expansion packs** aren't built yet: keep the pack plumbing, ship no pack cards.
5. **Endings**: when the draw pile runs out (the last allowed time with Ending Times = 2), everyone
   else gets one more turn, as the old game does. Ending 4 + Ending Times 2 starting the deck final
   round without 3 sets is intended.
6. **Fix all the block bugs** in the port: double Quarantine block, Debt learning over-count, stale
   `attack` learning, Easy Debt dead branch, Hard bots reading stale miles, pack cards missing from the
   pile picker, cards dealt to seats that left, hands sent to every online player, Toilet Paper/instructions
   text vs code (make the text match the code unless the owner says otherwise).
7. **Guest play**: no sign-in needed to play. Sign-in stays for things tied to an account
   (Gold, purchases, cloud saves, online leaderboard).
8. **Payments**: the server captures PayPal orders after checking the price, not the browser.

## Known issues to keep in mind

- `game-settings.json` mentions `OWNER_GUIDE.md`, which doesn't exist.
- `doPost` holds one global lock (up to 30 s) around every request, including Claude calls.
- 19 unused variables and 5 unused lists in the project — don't port them.
