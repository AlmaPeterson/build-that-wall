# Build That Wall: game rules (porting spec)

This is what the PenguinMod version actually does, read from the blocks
(`docs/project-dump/`, made by `tools/dump-project.py`). Phase 1 implements and tests the
TypeScript game from this document, so it describes the code's behaviour, including its
quirks. Where the code looks like a bug, that is called out under **Bug?** so we can decide
whether to copy it or fix it. Where the code is ambiguous, it says **Unclear:**.

Citations look like `Cards › define fx effect` (sprite › script or custom block). Card numbers
are the card ids used everywhere in the blocks (see `app/src/data/cards.json`).

## Contents

1. Data model
2. Setup and settings
3. Deck and dealing
4. Turn flow
5. Actions: building walls
6. Actions: playing cards
7. Play Immediately cards
8. Blocking: Self-Defense and Savings
9. Every card
10. Scoring and how the game ends
11. Bots
12. Tutorial and tips
13. Pass'n'Play and online play
14. Gold, sign-in, packs and other gated features
15. Bugs, dead code and contradictions found

---

## 1. Data model

All state is global (Stage variables and lists). The port should turn this into one
serialisable game state.

| Blocks | Meaning |
|---|---|
| `Hand P1` … `Hand P6` | Each seat's hand: a list of card ids. Order matters (slot numbers). |
| `Cards in Draw` | Draw pile. **The top card is the last item.** Cards are drawn from the end. |
| `Cards in Discard` | Discard pile, in the order cards were discarded. |
| `All Walls` | Every built wall section as `seat * 100 + cardId` (for example `329` = seat 3, Wall Section 1). One entry per built section, so a pair is two equal entries. |
| `Train Guards` | Wall sets protected by a Trump Train, as `seat * 100 + cardId`. The Trump Train card is "held" here (not in any pile). |
| `Jail` | Cards jailed by Freedom of the Press (including the Freedom of the Press card itself). |
| `Jail Release` | `Turn Count` value at which the jail empties. |
| `Skip Next[seat]` | 1 = this seat is Quarantined for its next turn. `Skip By[seat]` = who played it. |
| `Limit Next[seat]` | Card id (9 or 16) that limits this seat to 1 action next turn; 0 = none. The card is held here. |
| `Left Seats[seat]` | 1 = this (online) player left the game. |
| `Turn` | Seat whose turn it is (1-based). 0 = no turn yet. |
| `Actions Left`, `Actions Per Turn` (3) | Actions remaining this turn. |
| `Cards Per Turn` (3) | Cards drawn at the start of each turn. |
| `Turn Count` | Turns started this game (every seat's turn counts). |
| `Game Players`, `Game AI` | Seats in this game, and how many are bots. **Bots are always the last seats**: seat `s` is a bot when `s > Game Players - Game AI`. |
| `Exhaust Count`, `Exhaust Pending`, `Exhaust Flag`, `Final Round`, `Final Stop`, `Final Kind`, `Final Reason`, `Final Done`, `Deck Done`, `Game Over` | End-of-game bookkeeping (section 10). |

Card id groups used throughout:

- **Wall Sections**: 29–44 (16 kinds, "Wall Section 1" … "Wall Section 16"). Tested as `id > 28 and id < 45`.
- **Man Hour**: 14. **Debt**: 7. **Savings**: 19. **Self Defense**: 20. **Trump**: 26. **Trump Train**: 25.
- **Play Immediately** ("red") cards: 1, 2, 8, 10, 12, 15, 18, 24 (`Cards › define find red`).
- **Expansion pack cards**: 45–49 (not in the base deck; see section 14).
- Card 4 is a placeholder ("a card", no image text, not in the deck).

## 2. Setup and settings

Settings live on the Settings panel (`Panels › btn Settings`, `Buttons`). They are saved to
preferences while no game is running (`Panels › when green flag clicked`, the `prefSet` loop)
and loaded at boot and after an account load (`Panels › Account Load Done`).

| Setting | Values | Default | Effect |
|---|---|---|---|
| Game Mode | `Pass'n'Play`, `Multiplayer` | Pass'n'Play | Pass'n'Play: everyone on one device. Multiplayer: shows the online/bots menu at start (section 13). Locked into `Locked Game Mode` when a game starts. |
| Players | 2–6 | 6 | Number of seats. `New Game` resets anything outside 2–6 to 6. |
| AI Players | 0 … Players | 0 | Number of bots (always the last seats). Clamped to ≤ Players (`Buttons › when I start as a clone` forever loop). If AI Players = Players, the game is "watch mode" (bots only). |
| AI Difficulty 1–6 | Easy, Medium, Hard, Random | list starts `[Easy ×5]`, then `Medium` is appended up to 6 items, so bot 6 defaults to Medium | Per bot (bot *k* is seat `Game Players - Game AI + k`). Random is resolved at game start: Easy 1/3, Medium 1/3, Hard 1/3 (`Cards › New Game`). |
| Ending | 1 "3 Sets of 3 Walls", 2 "Exhaust Deck", 3 "Whatever Happens First", 4 "Whatever Happens Last" | 1 | How the game ends (section 10). |
| Ending Times | 1, 2 | 1 | How many times the draw pile must run out (Endings 2–4). Hidden when Ending = 1. |
| Sound Effects | 0/1 | 1 | Card and click sounds. |
| Music Mode | Cycle All, Play One | Cycle All | Background music playlist (YouTube links or uploaded files). |
| Auto Join | 0/1 | 0 | When joining an online room by code, retry up to 20 times, 2 s apart, while the host opens it. |
| Tutorial (per seat) | on/off | off | `Tutor Seats[seat]`. Only seat 1's value is saved to preferences. |

Changing a setting while a game is running sets `Settings Changed` (a notice is shown); the
running game is not affected except through the variables it reads live.

Starting a game (`Panels › btn Start End` → `Cards › Start Request`):

- **Pass'n'Play**: if `AI Players ≥ Players` → watch mode. Otherwise → `New Game`.
- **Multiplayer**: a menu offers quick online match, host a private room, join with a code,
  "play on this device against bots" (sets `AI Players = Players - 1`), or watch bots.

`Cards › New Game`:

1. Clear piles and hands. Build the draw pile by inserting each id of `Deck Recipe`, then each
   id of `Active Pack Cards`, at a uniformly random position (insertion shuffle).
2. `Game Players = Players`; `Game AI = min(AI Players, Players)`; in watch mode `Game AI = Game Players`.
3. Reset per-seat lists (`Seat Walls`, colours, `Left Seats`, `Skip Next`, `Limit Next`,
   `Skip By` = 1, `Jail`, `Train Guards`), end-of-game flags, `Turn Count = 0`.
4. Resolve each bot's difficulty into `AI Levels`.
5. Names: bot seats become "Bot *k*"; human seats keep a custom name, else "Player *k*".
   Displayed bot names come from `Bot Names` (Freedom, Maverick, Liberty, Eagle, Patriot, Senator)
   unless renamed.
6. Deal (section 3), then `Turn = 1` and `Start Turn`.

## 3. Deck and dealing

Base deck: 107 cards (`Stage › list Deck Recipe`):

| Cards | Copies |
|---|---|
| Wall Section 1–16 (29–44) | 3 each = 48 |
| Man Hour (14) | 16 |
| Debt (7) | 7 |
| Self Defense (20) | 5 |
| Trump (26) | 4 |
| Savings (19), Trump Train (25) | 3 each |
| Every other card (1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 21, 22, 23, 24, 27, 28) | 1 each = 21 |

Dealing (`Cards › New Game`): 5 rounds; in each round seats 1 … Game Players each take the top
card (last item) of the draw pile. If the pile empties during the deal, `Exhaust Pending += 1`
and `Exhaust Flag = 1`. Play Immediately cards dealt here are **not** played until that seat's
first turn.

Drawing (`Cards › define draw cards`, `Start Turn`): for each card, if the draw pile is empty and
the discard pile isn't, the **whole discard pile is shuffled into the draw pile** first; then the
top card is taken. If both are empty, nothing is drawn. After drawing, `fix pack draws` runs
(section 14).

`define shuffle draw` re-shuffles the draw pile by random insertion.

## 4. Turn flow

`Cards › Start Turn` for seat `Turn`:

1. `Actions Left = Actions Per Turn` (3). `Turn Count += 1`.
2. **Jail release**: if the jail is not empty and `Turn Count ≥ Jail Release`, every jailed card
   goes to the discard pile.
3. **1-action limit**: if `Limit Next[Turn] > 0`, that card (9 or 16) goes to the discard pile,
   `Limit Next[Turn] = 0`, and `Actions Left = 1`.
4. **Draw** `Cards Per Turn` (3) cards (section 3). Track exhaustion: if the draw pile becomes
   empty after a draw, `Exhaust Pending += 1`, `Exhaust Flag = 1`.
5. `fix pack draws` for this seat.
6. Human whose hand is on screen: show the turn recap ("what happened to you since your last
   turn", `btwlinks.turnRecap`) and the "it is your turn" banner.
7. `check exhaust`, then `win check` (section 10). Stop if the game is over.
8. `resolve immediates` (section 7).
9. **Quarantine**: if `Skip Next[Turn] = 1`: clear it; the target may block with Self-Defense
   (attacker = `Skip By[Turn]`); the Quarantine card (17) goes to the discard pile **either way**.
   If not blocked, the turn ends now (`Next Turn`).
10. If the seat is a bot → `AI Turn` (section 11). Otherwise wait for the human.

During a turn the player may, any number of times while they have the actions:
build a wall (section 5), play a card (section 6), or end the turn.

**End Turn** (`Alerts and Buttons › btn End Turn`): allowed when not dealing, a turn is running,
no bot is busy, the current seat is human and no effect is in progress (`FX Busy = 0`). Actions
do not have to be used up. Online, ending someone else's turn asks for confirmation and sends
`endturn` to them (they see "Another player ended your turn").

**Next Turn** (`Panels › Next Turn`):

1. If a final round is running and the next seat would be `Final Stop`, the final round is over:
   `Final Done = 1` (and `Deck Done = 1` if it was a deck final round), then `win check`.
2. Next seat = `Turn + 1` (wrapping), skipping seats in `Left Seats`.
3. Pass'n'Play with 2+ humans and a human next seat: show the pass-the-device screen first.
   Otherwise go straight to `Start Turn`. Bot turns show no hand (`View Player = 0`).

## 5. Actions: building walls

A Wall Section (29–44) is built from the hand into `All Walls` as `seat*100 + id`
(`Cards › define do build`). Normal building costs **1 action** and needs a "payment":

- **discard 1 Man Hour** (14), or
- **discard 2 other Wall Section cards** (any kinds, different slots from the one being built).

Ways to start a build (all end in `do build`):

- Click a Wall Section in hand → **Use Man Hour** (needs a Man Hour in hand) or **Pick Walls**
  (pick 2 other wall cards; needs ≥ 2 other wall cards) (`Alerts and Buttons › Play Popup`).
- Click a Man Hour → **Use On Wall**: pick 1 Wall Section to build with it.
- **Build Wall** button → menu of every option for the hand (`Cards › Build Menu`,
  `define build options`): for each distinct wall kind in hand (max 8 entries) "using your Man Hour"
  if a Man Hour is held, and "by discarding 2 other walls" if the hand holds ≥ 3 wall cards; plus
  Assassin / Legal Immigration / Voting Machine / Toilet Paper if held, affordable and playable.

`do build` checks the card is still in that slot, the card is a Wall Section, and
`Actions Left > 0` (unless the build is free). Payment cards go to the discard pile; the built
card does not. Then `Actions Left -= 1` (0 if free) and `train check` runs (section 9, Trump Train).

Built walls stay in front of the player. They can later be taken by Debt, given away by
Afghanistan Pull Out, or pulled back into the hand by Mostly Peaceful Riot, except walls in a
complete set of 3 and sets protected by a Trump Train.

## 6. Actions: playing cards

Clicking a non-wall card shows the play popup with **Play (N actions)** when it is the player's
turn and `Card Action Cost ≤ Actions Left` (`Buttons` show rules, `Alerts and Buttons › Play Popup`).
Savings and Self-Defense show an info box instead (they can't be played on their own).

Action cost (`Stage › list Card Action Cost`): cost 1 for cards 5, 6, 7, 11, 13, 14, 16, 17, 22, 23,
25, 26, 27, 28, 45, 46, 47, 49; cost 0 for everything else (including all Wall Sections, Assassin,
Democrat Border, Stimulus Check, Double Time and the Play Immediately cards).

What happens on **Play**:

- Debt (7) → `Debt Start` (section 9).
- Trump Train (25) → `Train Start`. Trump (26) → `Trump Start`.
- The cards 1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 21, 22, 23, 24, 27, 28, 45–49 →
  `Special Start` → `define special run`.
- Anything else → `Play Card` (discard it and pay its cost, no effect). In practice nothing in
  the deck reaches this path.

`define special run`:

1. `fx check`: if the card can't be played now, a human gets "Can't play X" with the reason
   and nothing is spent. Reasons (`define fx check`):
   - 3, 13, 28: no Wall Section in hand.
   - 23: no 2 matching Wall Sections in hand.
   - 5 (bots only): no opponent holds a Trump/Trump Train and no opponent set has a Train Guard.
   - 6, 21: no opponent has any cards.
   - 22: draw pile empty. 27 and 45: discard pile empty. 11: draw and discard both empty.
   - 19, 20: "only used to block".
   - 46: fewer than 2 cards in hand, **or the player is a bot** (bots can never play it).
2. `pay card`: remove the card from the hand, pay its cost. The card goes to the discard pile,
   **except** 9, 16, 17, 11, 27, which are held (they go to the discard pile later, see each card).
3. `fx effect` (the card's effect, section 9), then `train check`, `device back`,
   `resolve immediates`, `win check`.

## 7. Play Immediately cards

Cards 1, 2, 8, 10, 12, 15, 18, 24 must be played as soon as they are in the current player's hand
(`Cards › define resolve immediates`). It runs at the start of the turn (after drawing) and after
every special card, Trump, Trump Train draw, build and bot action (`Resolve Now`). It repeats up
to 20 times: take the **first** red card in the hand, discard it, announce
"PLAY IMMEDIATELY: X", run its effect with `FX Player = Turn`, then `train check`.

Only the **current player's** hand is checked. A red card handed to another player waits until
their next `resolve immediates` (normally the start of their turn).

## 8. Blocking: Self-Defense and Savings

**Self-Defense** (`Cards › define defend`): when an attack targets seat `T`, if `T` holds a
Self-Defense (20) they may block:

- Human (Pass'n'Play, or online on their own device): asked "Use your Self-Defense card to block it?"
  (pass-the-device screen first in Pass'n'Play). Online, a remote human is asked through `netAsk`.
- Bot: Easy blocks with probability 1/2, Medium and Hard always block.

A block discards the Self-Defense and cancels the effect for that target. Attacks that can be
blocked: 1, 2, 5, 6, 8, 9, 15 (per player), 16, 17 (twice, see Quarantine), 24, 49. Not blockable:
7 (Debt, uses Savings instead), 10, 12, 18, 21, 45–48.

Note that for the Play Immediately cards 1, 2, 8, 24 the "target" is the player who drew the card,
so Self-Defense blocks your own bad card.

**Savings** (`Cards › Debt Resolve`): see Debt below.

## 9. Every card

Effects are in `Cards › define fx effect` unless noted. "Opponent" = any other seat. Bot targeting
rules are in section 11.

### Base deck

| # | Card | Cost | Copies | Effect |
|---|---|---|---|---|
| 1 | Abduction | 0 | 1 | **Play Immediately.** If the drawer holds a Man Hour, they may block with Self-Defense; otherwise they discard one Man Hour. No Man Hour: no effect. |
| 2 | Afghanistan Pull Out | 0 | 1 | **Play Immediately.** If the drawer has an eligible built wall (not in a set of 3, not Train-guarded), they may block with Self-Defense; otherwise they choose one such wall section and choose an opponent; the section goes **into that opponent's hand**. |
| 3 | Assassin | 0 | 1 | Build up to 2 Wall Sections from the hand **free** (no action, no payment), one at a time; may stop after the first (`define build free`). Needs a wall in hand. |
| 5 | Chinese Spy Balloon | 1 | 1 | Choose: **take** (pick an opponent; they may block; take all their Trump (26) cards, then Trump Train (25) cards, up to 12) or, if any opponent set has a Train Guard, **remove a Trump Train** (pick a guarded opponent set; the owner may block; the guard is removed and that Trump Train goes to the discard pile). |
| 6 | Controlled Opposition | 1 | 1 | Pick an opponent with cards; they may block; take 2 random cards from their hand. |
| 7 | Debt | 1 | 7 | See **Debt** below. |
| 8 | Deep State | 0 | 1 | **Play Immediately.** The drawer may block; otherwise they hand out their **whole hand** around the table (`distribute … all`). |
| 9 | Democrat Border | 0 | 1 | Pick an opponent; they may block (card discarded). Otherwise the card is held in `Limit Next[target]`: on their next turn they get only 1 action (then the card is discarded). If they already had a limit card, the old one is discarded and replaced. |
| 10 | Fake News | 0 | 1 | **Play Immediately.** Not blockable. If everyone has the same miles: no effect. Otherwise every player not tied for fewest miles who holds a Wall Section, Trump or Trump Train gives one such card (their choice; bots give their least valuable) to a lowest-miles player; with several lowest players they receive in rotation. |
| 11 | Freedom of the Press | 1 | 1 | Pick up to 4 cards from the draw and discard piles together (30-second timer). They and the Freedom of the Press card go to **jail**; `Jail Release = Turn Count + 3 × Game Players` (about 3 rounds). The draw pile is then shuffled. When released, all jailed cards go to the discard pile. |
| 12 | Lawfare | 0 | 1 | **Play Immediately.** Not blockable. The drawer hands out the Wall Sections in their hand around the table. |
| 13 | Legal Immigration | 1 | 1 | Build up to 3 Wall Sections free (the card itself costs the 1 action). |
| 14 | Man Hour | 1 | 16 | Payment for a build (section 5). Clicking it offers **Use On Wall**. |
| 15 | Mostly Peaceful Riot | 0 | 1 | **Play Immediately.** Every player (in seat order) who has an eligible built wall may block; otherwise they pick one eligible built wall section and it goes back into **their own hand**. Bots pick their weakest (fewest copies). |
| 16 | Puppeteer | 1 | 1 | Same as Democrat Border (target gets 1 action next turn), but costs 1 action. |
| 17 | Quarantine | 1 | 1 | Pick an opponent; they may block (card discarded). Otherwise `Skip Next[target] = 1`: at their next turn they draw (and resolve immediates) but then **may block again**, and if not blocked skip the rest of the turn. The card is discarded at that point either way. If they were already quarantined, this card is just discarded. |
| 18 | Redistribution | 0 | 1 | **Play Immediately.** Not blockable. Every player tied for the most cards in hand (if > 0) hands out their whole hand around the table, in seat order. |
| 19 | Savings | 0 | 3 | Only used to stop a Debt (see Debt). Can't be played. |
| 20 | Self Defense | 0 | 5 | Only used to block (section 8). Can't be played. |
| 21 | Stimulus Check | 0 | 1 | Pick an opponent with cards; **not blockable**; take 3 random cards from their hand. |
| 22 | Supreme Court Nominee | 1 | 1 | Pick up to 3 cards from the draw pile into your hand (30-second timer); then the draw pile is shuffled. |
| 23 | Toilet Paper | 1 | 1 | Needs 2+ matching Wall Sections in hand. Build a set: choose a kind with 2+ copies in hand and build **every copy of it in hand** (up to 3) free. The first set is covered by the card's 1 action; each further set costs 1 more action; the player may stop after any set. Bots build the first kind in id order and continue while they have actions. |
| 24 | Trafficking | 0 | 1 | **Play Immediately.** The drawer may block; otherwise they hand out their Savings, Trump, Trump Train and Man Hour cards around the table. |
| 25 | Trump Train | 1 | 3 | See **Trump Train** below. |
| 26 | Trump | 1 | 4 | Discard it and draw 3 cards (`Cards › Trump Start`). Then `Resolve Now`. |
| 27 | Vote Recount | 1 | 1 | Pick up to 3 cards from the discard pile into your hand (30-second timer). Then the Vote Recount card goes to the discard pile. |
| 28 | Voting Machine | 1 | 1 | Build up to 2 Wall Sections free (the card itself costs the 1 action). |
| 29–44 | Wall Section 1–16 | 0 | 3 each | Built into walls (section 5). Scoring in section 10. |

**Debt** (`Cards › Debt Start`, `Debt Resolve`, `define debt targets`):

1. Targets: every opponent built wall `v` (a seat+kind) where that seat has **fewer than 3** of that
   kind and `v` is not Train-guarded. None → "No wall to take", nothing spent.
2. The player clicks a target wall. Then the Debt card is discarded and 1 action spent
   (`define debt pay`; requires `Actions Left > 0`).
3. If the target holds a Savings (19): a human is asked "Use your Savings card to pay the debt?";
   a bot uses it except Easy bots, which skip it with probability 1/2. Paying discards one Savings
   and the wall stays.
4. Otherwise one copy of that wall moves to the Debt player's walls (`seat*100 + kind` changes
   owner), then `train check`.

**Trump Train** (`Cards › Train Start`):

- **Draw**: discard the Trump Train, pay 1 action, draw 3 cards, `Resolve Now`.
- **Protect**: only if the player has an unguarded pair (exactly 2 of a kind) built
  (`define train sets`). Click the pair; pay 1 action; the card is held in `Train Guards` instead of
  being discarded. A guarded pair can't be targeted by Debt, Afghanistan Pull Out or Mostly
  Peaceful Riot.
- `define train check` (after every build, Debt, Afghanistan, effect): any guard whose set now has
  3+ walls is removed and its Trump Train goes to the discard pile.

**Handing out cards** (`Cards › define distribute`), used by 8, 12, 18, 24, 46: starting with the
next seat after the giver and going round (including the giver, unless "no self" for card 46), the
giver gives one qualifying card per seat until they have none left. A card "given" to yourself is
set aside and returned to your hand at the end. Humans choose each card; bots choose with
`ai give slot` (keep the most valuable for themselves, give the least valuable to others: walls 5,
Man Hour 4, cards 25/26/19/20/28/3/13 → 3, Debt 2, anything else 1). Kinds: `all` (any card),
`walls` (29–44), `traffic` (14, 19, 25, 26).

**Picking from piles** (11, 22, 27; `define pool pick`): the pile is shown grouped by card kind
with counts; the player clicks cards until they have N or the timer (30 s) runs out, or presses
Done. Picks are removed from the pile (for 11, from the discard pile if that kind is there, else the
draw pile). Bots pick the N most valuable by the same value scale.

### Expansion pack cards (not in the base deck)

| # | Card | Cost | Effect |
|---|---|---|---|
| 45 | Reshuffle | 1 | Whole discard pile goes into the draw pile, then shuffle. |
| 46 | Give It All Away | 1 | Hand out the whole hand to the other players (none to yourself). Bots never play it. |
| 47 | Fresh Start | 1 | Every player still in the game (including the player) discards their hand and draws 5. |
| 48 | Double Time | 0 | +2 actions this turn. |
| 49 | Hand Swap | 1 | Pick an opponent; they may block; swap whole hands. |

Pack definitions (`Stage › Pack IDs/Names/Card Id/Card Of`): `test_small` "Test pack (5 cards)" =
45, 46, 47, 48, 49; `test_full` "Test pack (10 cards)" = two of each. See section 14 for why they
never appear.

## 10. Scoring and how the game ends

**Miles** (`Cards › define calc miles`; same formula in `Walls Display`): for each seat and each
wall kind, by how many sections of that kind the seat has built:

| Sections of one kind | Miles |
|---|---|
| 1 | 3 |
| 2 | 8 |
| 3 or more | 16 |

A seat's miles = the sum over its 16 kinds. A **set** = a kind with 3+ sections (`define sets of`).
(Only 3 copies of each kind exist, so 3 is the maximum.)

**Draw pile running out** (`define check exhaust`, run at turn start and after `Resolve Now`):
each time the draw pile becomes empty `Exhaust Pending` goes up by one. Each pending exhaustion
increments `Exhaust Count`. If Ending is 2, 3 or 4, the deck isn't done yet and no final round is
running: when `Exhaust Count ≥ Ending Times` → start a **deck final round** ("The last card was
drawn! Everyone else gets one final turn."); otherwise announce "The draw pile ran out (n of m
times). The discard pile is shuffled in." With Ending = 1 the deck just keeps reshuffling.

**Win check** (`define win check`), after every build, Debt, effect and turn start, while the game
is running:

- `maxSets` = most sets any seat has.
- End condition met if:
  - Ending 1 or 3 and `maxSets ≥ 3` → reason "Someone built 3 sets of 3 walls."
  - Ending 2 or 3 and `Deck Done` → "The deck ran out and the final turns are done."
  - Ending 4 and `Deck Done` and `maxSets ≥ 3` → "Both the deck and 3 sets are done."
- If a final round just finished (`Final Done`): end the game if it was a sets final round or an
  end condition is met now. (With Ending 4, a finished deck final round without 3 sets lets play
  continue until someone has 3 sets, which then starts a sets final round.)
- Else, if an end condition is met and no final round is running: start a **sets final round**
  ("Final round! … Everyone else gets one final turn.").

**Final round**: `Final Stop = Turn` (the seat that triggered it). Play continues; when the next
seat would be `Final Stop`, the round is over (`Panels › Next Turn`). So every other seat gets one
more turn; the triggering seat does not.

**Game over** (`define game over`): the winner is whoever has the most miles; ties share the win
("It's a tie: A & B"). The win screen shows each seat's miles. Then stats are recorded (section 14),
non-Gold players see a video ad, and the game ends.

Other ways a game ends: everyone else leaves an online game ("Everyone else left the game."), the
host leaves, or a player presses End Game.

## 11. Bots

`Cards › AI Turn` loop, while the bot has actions, the game runs and it is still its turn:
wait for popups to close; in watch mode wait 1.1 s; `ai think`; `ai act`; run the chosen special
or Debt; `Resolve Now` (immediates, exhaust, win check). The loop ends when the bot chooses "stop",
then `Next Turn`.

`define ai think` (difficulty from `AI Levels`; the tutorial uses it with Hard):

1. **Hard only**: `lead` = opponent with the highest `Miles + aiRate(name, miles) / 3`;
   `threat` = highest `aiRate(name, debt)` among human opponents (section 11, learning).
2. Count own built walls per kind, and wall cards in hand.
3. **Train defence (Hard)**: if holding a Trump Train, `threat > 0.2`, and owning an unguarded pair,
   `train = 1` (prefer protecting it).
4. **Build** candidate: for each wall card in hand, gain by own built count of that kind:
   0 → 3, 1 → 5, 2 → 8, 3 → 0. Easy: with probability 1/2 the gain is random 1–8. Medium: with
   probability 1/5 random 1–8. Hard: count 2 → 20, count 1 → 6 (+2 if `threat > 0.4`).
   Only possible with a Man Hour or ≥ 3 wall cards in hand. Highest gain wins (first on ties).
5. Choose **build** if there is a candidate with gain > 0, actions remain, not (Hard with
   `train = 1` and gain < 20), and not (Easy and a 1-in-4 roll). Pay with a Man Hour if held,
   else the first two other wall cards.
6. Else **Debt** (Medium/Hard only, not when `train = 1`): if holding Debt and targets exist, pick
   the target with the best gain for the bot (same 3/5/8 by its own count of that kind; Hard +4 if
   the target belongs to `lead`).
7. Else (Medium/Hard only) **play a card**: candidates are 3, 5, 6, 9, 11, 13, 16, 17, 21, 22, 23,
   25, 26, 27, 28, 45–49 that are affordable and pass `fx check`. Medium plays the first candidate
   in hand order. Hard uses this priority: 25, 3, 13, 28, 23, 21, 6, 5, 16, 17, 9, 26, 22, 27, 11,
   47, 45, 48, 49. Trump/Trump Train are "play" (Trump Train protects the first unguarded pair if
   any, except Easy 1/2 of the time, else draws 3); the rest go through `special run`.
8. Else **stop**.

So Easy bots only ever build walls (they never play Debt or action cards; they still resolve
Play Immediately cards and block with Self-Defense/Savings half the time).

Bot targeting (`define ai target`): Democrat Border, Puppeteer, Quarantine → the opponent with the
most miles (`leader`). Controlled Opposition, Stimulus Check, Hand Swap → the opponent with the most
cards in hand (`cards`). Spy Balloon "take" → the opponent with the most Trump/Trump Train cards
(`trump`). Afghanistan Pull Out → give the weakest wall (fewest copies) to the opponent with the
fewest miles (`lowest`). Spy Balloon choice: remove a train if any guard exists and (no opponent
has a Trump or a 1/2 roll), else take. Free builds (3, 13, 28): build the wall card worth most
(by own count: 0 → 3, 1 → 5, 2 → 8). Toilet Paper: first kind with a pair.

**Learning** (`btwlinks.aiLearn` / `aiRate`, stored per human name in this browser under `aimem`):

- `aiLearn(name, "game", miles)` for each human at game end (unless Test Mode): games += 1,
  miles += miles.
- `aiLearn(name, "debt")` whenever a human plays Debt; `aiLearn(name, "attack")` when a human
  plays 5, 6, 9, 16, 17, 21 or 49.
- `aiRate(name, "miles")` = average miles per game (rounded); `aiRate(name, "debt")` = debts per
  game (2 decimals). `attack` is recorded but never read.

## 12. Tutorial and tips

- The **Tutorial** button toggles `Tutor Seats[View Player]` during a game and opens guide page 6;
  outside a game it opens the illustrated guide (`btwlinks.guide`, page 1) (`Cards › btn Tutorial`).
- With the tutorial on, the board shows a "TUTORIAL TIP" box (`Walls Display › define make tips`):
  **BEST MOVE** from `Tip Think` (runs `ai think` as a Hard bot for the human and words the result:
  build X, play Debt on Y, play card Z, or "Click End Turn"), plus a list of situational tips (finish
  a set, use your Man Hour, discard 2 walls, play free builders, protect a pair with Trump Train,
  Debt the leader, slow the leader, play Trump, steal cards, keep Savings/Self-Defense, use all 3
  actions, aim for matching walls).
- With the tutorial on, **double-clicking** a hand card (two clicks on the same slot within 0.4 s)
  explains it (`Explain A` / `Explain B` texts) instead of opening the play popup.
- The How to Play panel has 4 pages (`Panels › btn Instructions`, costumes `instr1`–`instr4`).
- Right-click (or long press) on a card zooms in (`Alerts and Buttons › define Zoom in on card`);
  the zoom can be dragged and scaled; it links to the card's page (`Card QR Links`).

## 13. Pass'n'Play and online play

**Pass'n'Play** with 2+ humans: whenever a different human must act (their turn, a Self-Defense or
Savings decision, choosing cards to give, Fake News, Riot), a full-screen "Pass the device to X"
screen appears with why (`define device to`, `btwlinks.passScreen`, `passWhy`). After the
interruption, the device goes back to the current player (`define device back`). With 1 human,
no pass screens.

**Online** (`Cards › Start Request`, `define online lobby`, BTW Links extension):

- Quick match, host a private room (code), or join with a code. 2–6 players; the host presses Start
  (it starts by itself at 6). Online games have no bots (`AI Players = 0`). Late joiners when full
  or playing become spectators (see the table, no hands).
- State sync: whoever owns the current turn (the host owns bot seats and seats of players who
  left) sends the **whole state** (every hand, piles, walls, turn variables) to everyone when it
  changes; receivers apply it and start their turn when it becomes theirs (`_snapshot`, `_apply`,
  `_tick`).
- Remote decisions (Self-Defense, Savings) are sent as `ask` / `answer` messages (`netAsk`).
- A player who leaves: their hand goes to the discard pile, their seat is skipped, and if fewer
  than 2 humans remain the game ends (`Cards › Player Left`).

## 14. Gold, sign-in, packs and other gated features

- **Sign-in required**: every main button except Account & Store, Instructions and Tutorial
  (so Start, End Turn, Build Wall, Settings…) asks for a Google sign-in first unless `Test Mode = 1`
  (`Buttons › when this sprite clicked`, `Cards › Need Sign In`). "Signed in" = a verified Google
  user or a saved Google name.
- **Gold** (trial 7 days, monthly or yearly subscription; `btwlinks.goldActive`) unlocks:
  coloured star, name colour and name background on the table; the holiday card back (and a holiday
  banner) near holidays (New Year 28 Dec–2 Jan, Christmas 1–27 Dec, Valentine's 7–14 Feb,
  St. Patrick's 10–17 Mar, Independence Day 28 Jun–5 Jul, Halloween 17–31 Oct, Thanksgiving
  20–30 Nov); confetti on a win; the leaderboards menu; **no video ad after each game**.
  Gold has no effect on the rules.
- **Stats** (per browser, synced to the account): games, wins (a human seat tied for the most
  miles, > 0), best miles, walls built; local and online leaderboards (most miles, win % with 5+
  games, games, wins, walls, money spent) (`Cards › Record Result`, `define record result`).
- **Expansion packs** are switched off: `define choose packs` empties `Active Pack Cards` and stops
  immediately, and the Pack Store shows "COMING SOON". If pack cards ever enter the deck, a seat
  that doesn't own a pack swaps any pack card it draws for the nearest non-pack card below the top of
  the draw pile, putting the pack card at the bottom (`define fix pack draws`).
- **Donations**: Donate button → choose 1/3/5/10/20 or another amount → PayPal.
- **Owner tools** (search and delete accounts) and **ad preview** exist but aren't reachable from
  any menu.

## 15. Bugs, dead code and contradictions found

Decide for each whether the port copies it or fixes it.

1. **Bug? Debt learning is counted many times.** `Cards › Debt Resolve` calls `aiLearn(…, debt)`
   before the "is this a clone" check, so the original sprite and every card clone (14 deck clones +
   one per hand card on screen) each record the debt. Hard bots' `threat` is inflated a lot.
2. **Bug? "Attack" learning uses the previous card.** `define special run` records
   `aiLearn(…, attack)` using `FX Player`/`FX Card` *before* setting them to the current play, so it
   records whoever played the previous effect. (Harmless today because `attack` is never read.)
3. **Bug? Quarantine can be blocked twice.** It's checked against Self-Defense when played and again
   at the start of the victim's turn (`Cards › Start Turn`).
4. **Bug? Easy bot Debt targeting is dead code.** `ai think` only considers Debt when the bot is
   *not* Easy, then has an Easy-only random-target branch inside.
5. **Bug? Hard bots read display data.** `ai think` uses the `[Miles]` list that `Walls Display`
   only recomputes when the board is redrawn (not while popups are open), instead of `calc miles`.
6. **Bug? Pick-from-pile ignores pack cards.** `define pool types` only groups card ids 1–44, so
   pack cards (45–49) in the piles can't be picked by Supreme Court Nominee, Vote Recount or
   Freedom of the Press.
7. **Bug? Handing out cards ignores seats that left.** `define distribute` cycles over every seat,
   including `Left Seats`.
8. **Bug? Pass-the-device skips no seats.** `Panels › Pass Device` uses `Turn + 1` without skipping
   left seats (only matters if Pass'n'Play ever has left seats, which it can't today).
9. **Contradiction: Chinese Spy Balloon for humans** can always be played (even when useless);
   `fx check`'s "no opponent has a Trump" rule applies to bots only. The human "take" list shows
   every opponent, not only those with Trumps.
10. **Contradiction: Toilet Paper's text** ("1 action per set") vs code: the first set is included in
    the card's own action, further sets cost 1 each.
11. **Contradiction: instructions page 3** says build by discarding "3 Wall Section cards"; the code
    discards 2 *other* wall cards (3 including the one built).
12. **Dead code (unreachable menu entries)** in `Cards › btn Get Gold`: `life` (Lifetime Gold is
    never offered, although the server and settings support it), `code` (enter a Gold code),
    `tour_old_unused` (tournaments: best of 3/5/7). Popups still say "try a tournament".
    `btn Use a no Action Card` (Account & Store): `owner`, `adpreview`, `donatebtn` and the
    `if 1 = 0` Donate entry are never offered.
13. **Dead code: expansion packs** (`define choose packs` stops on its second block), `Pack Prices`,
    `Pack Sizes` unused.
14. **Dead broadcast**: `No Wall Msg` is never sent (`Panels`).
15. **Unused variables/lists**: 19 variables and 5 lists marked `(UNUSED)` in
    `docs/project-dump/_globals.txt` (for example `CFG Free Online Players`, `Color Names/Hex/Need`).
16. **Online play sends every hand to every player** (whole-state snapshots), so a modified client
    could see other hands.

### Unclear

- **Decided:** Card 4 ("a card") is the card back, not a playable card (the catalogue's `placeholder`).
- **Unclear:** `Card Help` gives short texts only for some cards; `Explain A/B` is the full text.
  Which one the new UI should use where (help vs. explain) is a UI decision.
- **Decided:** Expansion packs aren't built yet; `test_small` / `test_full` are test data. Keep the pack plumbing, ship no pack cards.
- **Decided:** Easy bots build when they can; when they can't, they play a card or Debt (new behaviour, see REFACTOR_PLAN decisions).
- **Decided:** In `define distribute` cards go clockwise, starting with the next seat.
- **Decided:** `Ending Times = 2` with Ending 4: the deck final round starting after the second run-out
  without 3 sets is intended; everyone else gets one more turn.
