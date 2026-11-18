// The four "How to Play" pages, as text so they scale with the text size settings. They follow the
// rules as this version plays them (src/game); public/how-to-play.html repeats them (how-to-play.test.ts).

export interface InstructionPage {
  title: string;
  points: string[];
  numbered?: boolean;
}

export const INSTRUCTION_PAGES: InstructionPage[] = [
  {
    title: 'Goal & Setup',
    points: [
      'Goal: have the most miles of wall when the game ends.',
      "Players: 2 to 6 (3 or 4 is best). Play against bots, share one device with friends (Pass'n'Play, with bots too if you like), or play online.",
      'Setup: press Play, choose how to play, then Start. The deck is shuffled and every player is dealt 5 cards. The rest of the deck becomes the Draw pile.',
      'The player to the left of the dealer goes first, then play moves clockwise.',
      "Play Immediately cards have a red title. You must use them right away: at the start of your first turn, or as soon as you draw one. They don't cost an action.",
    ],
  },
  {
    title: 'Taking Your Turn',
    numbered: true,
    points: [
      'Draw 3 cards from the Draw pile. Use any Play Immediately cards you drew.',
      "Take up to 3 actions. You can skip actions if you want. An action is building a wall or playing a card. Most cards cost 1 action; Play Immediately cards, Self-Defense, Savings, Assassin, Democrat Border and Stimulus Check cost none. Played cards go to the Discard pile unless the card says otherwise. Once a card is played it can't be taken back.",
      'Press End Turn when you are done. The next player draws their cards, and the red arrow on the Cards in Hand board moves to them. When the Draw pile runs out, the Discard pile is shuffled to make a new one.',
    ],
  },
  {
    title: 'Building Walls',
    points: [
      'To build, lay a Wall Section from your hand face up in front of you and pay for it with a Man Hour card, or with 2 other Wall Section cards instead. Building uses 1 action.',
      "Matching sections stack together: 1 section = 3 miles, 2 sections = 8 miles, 3 sections = 16 miles. 3 matching sections make a complete wall set. A complete set can't be taken or destroyed.",
      'Some cards build for free: Voting Machine builds up to 2 Wall Sections and Legal Immigration up to 3 (each for 1 action), Assassin builds up to 2 without using an action, and Toilet Paper builds all the matching sections of a kind in your hand.',
    ],
  },
  {
    title: 'Winning & Key Cards',
    points: [
      'You pick how the game ends under More options after pressing Play: 3 Sets of 3 Walls (a player completes 3 wall sets), Exhaust Deck (the Draw pile runs out, once or twice), Whatever Happens First, or Whatever Happens Last.',
      'When the end is reached, everyone else gets one final turn. Most miles wins!',
      'Debt: take a built section from an opponent. They can block it with Savings.',
      'Self-Defense: stops a bad effect aimed at you.',
      "Trump: discard to draw 3 cards. Trump Train: draw 3 cards, or protect a pair (2 matching sections) so it can't be taken.",
      "Every other card explains itself. Tap a card to see it big, and pinch the picture with two fingers (or scroll over it) to zoom in or out. Press Scan QR Code to open that card's web page.",
    ],
  },
];
