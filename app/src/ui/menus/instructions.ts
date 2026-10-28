// The four "How to Play" pages (the old Panels costumes instr1-instr4), as text so they scale with
// the text size settings. Page 3 is corrected to match the rules (docs/game-rules.md section 5):
// building costs 1 action and a Man Hour or 2 OTHER Wall Section cards (the old page said 3).

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
      'Players: 2 to 6 (3 or 4 is best). Change the number of players in Settings.',
      'Setup: press Start Game. The deck is shuffled and every player is dealt 5 cards. The rest of the deck becomes the Draw pile.',
      'The player to the left of the dealer goes first, then play moves clockwise.',
      "Play Immediately cards have a red title. You must use them right away: at the start of your first turn, or as soon as you draw one. They don't cost an action.",
    ],
  },
  {
    title: 'Taking Your Turn',
    numbered: true,
    points: [
      'Draw 3 cards from the Draw pile. Use any Play Immediately cards you drew.',
      'Take up to 3 actions. You can skip actions if you want. An action is building a wall or playing a card. Most cards cost 1 action, but Play Immediately, Self-Defense, Savings and Wall Section cards do not. Played cards go to the Discard pile unless the card says otherwise. Once a card is played it can\'t be taken back.',
      'Press End Turn when you are done. The next player draws their cards and their row on the Cards in Hand board turns red. When the Draw pile runs out, the Discard pile is shuffled to make a new one.',
    ],
  },
  {
    title: 'Building Walls',
    points: [
      'To build, lay a Wall Section from your hand face up in front of you and pay for it with a Man Hour card, or with 2 other Wall Section cards instead. Building uses 1 action.',
      'Matching sections stack together: 1 section = 3 miles, 2 sections = 8 miles, 3 sections = 16 miles. 3 matching sections make a complete wall set. A complete set can\'t be taken or destroyed.',
      'Voting Machine works as a Man Hour that builds 2 sections with one action.',
    ],
  },
  {
    title: 'Winning & Key Cards',
    points: [
      'The game ends when a player completes 3 wall sets, or (faster game) when the Draw pile runs out. Then everyone else gets one last turn. Most miles wins!',
      'Debt: take a built section from an opponent. They can block it with Savings.',
      'Self-Defense: stops a bad effect aimed at you.',
      'Trump: discard to draw 3 cards. Trump Train: draw 3 cards, or protect a set of 2.',
      "Every other card explains itself. To zoom in on a card, right-click it (on a touch screen, press and hold it). Then press Scan Card's QR Code to open that card's web page.",
    ],
  },
];
