"""Build the card catalogue (app/src/data/cards.json) from assets/project.json.

Usage (from the repo root):  python3 -I tools/export-cards.py [project.json] [assets.json] [cards.json]

Names, deck counts, action costs, help texts, links and packs come from the Stage lists in the
project. Pictures come from app/src/data/assets.json (run tools/export-assets.py first).
What each card does is the table below, written from the blocks; docs/game-rules.md section 9
explains each effect and cites where it lives.
"""
import json
import re
import sys
from collections import Counter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets/project.json'
ASSETS = sys.argv[2] if len(sys.argv) > 2 else 'app/src/data/assets.json'
OUT = sys.argv[3] if len(sys.argv) > 3 else 'app/src/data/cards.json'

WALLS = range(29, 45)
IMMEDIATE = {1, 2, 8, 10, 12, 15, 18, 24}          # Cards > define find red
BLOCKABLE = {1, 2, 5, 6, 8, 9, 15, 16, 17, 24, 49}  # every card fx effect calls "defend" for
HELD = {9, 16, 17, 11, 27}                          # define special run: pay card (KEEP = 1)
OPP = 'chosenOpponent'
WALL_IDS = list(WALLS)

# id -> (structured effects, plain-English effect)
EFFECTS = {
    1: ([{'kind': 'discardFromHand', 'cardIds': [14], 'count': 1, 'who': 'self'}],
        'Play Immediately: discard one Man Hour (none: no effect). Self-Defense can block it.'),
    2: ([{'kind': 'giveBuiltWall', 'from': 'self', 'to': OPP, 'into': 'hand', 'eligible': 'notInSetOrGuarded'}],
        'Play Immediately: give one of your built walls (not in a set of 3, not guarded by a Trump Train) '
        'to an opponent, into their hand. Self-Defense can block it.'),
    3: ([{'kind': 'buildFree', 'max': 2}],
        'Build up to 2 Wall Sections from your hand for free: no action and no Man Hour.'),
    5: ([{'kind': 'choice', 'options': [
            [{'kind': 'stealCards', 'from': OPP, 'cardIds': [26, 25], 'max': 12}],
            [{'kind': 'removeTrainGuard', 'from': 'chosenOpponentSet'}]]}],
        'Choose: take every Trump and Trump Train card from an opponent, or remove a Trump Train from '
        'an opponent\'s wall set. Self-Defense can block it.'),
    6: ([{'kind': 'stealRandom', 'from': OPP, 'count': 2}],
        'Take 2 random cards from an opponent. Self-Defense can block it.'),
    7: ([{'kind': 'takeBuiltWall', 'from': 'opponentWall', 'eligible': 'notInSetOrGuarded', 'counter': 19}],
        'Take one built wall section from an opponent (not from a set of 3 or a guarded pair). '
        'They can pay it off with a Savings card.'),
    8: ([{'kind': 'distributeHand', 'who': 'self', 'cards': 'all', 'includeSelf': True}],
        'Play Immediately: hand out your whole hand around the table; you choose who gets each card. '
        'Self-Defense can block it.'),
    9: ([{'kind': 'limitActions', 'target': OPP, 'actions': 1, 'when': 'nextTurn'}],
        'An opponent gets only 1 action on their next turn. Uses no action. Self-Defense can block it.'),
    10: ([{'kind': 'giveToLowest', 'cardIds': WALL_IDS + [25, 26], 'count': 1}],
         'Play Immediately: every player who is not lowest gives one Wall Section, Trump or Trump Train '
         'to the player(s) with the fewest miles. No effect if everyone is tied. Cannot be blocked.'),
    11: ([{'kind': 'pickFromPiles', 'piles': ['draw', 'discard'], 'count': 4, 'seconds': 30, 'to': 'jail',
           'jailTurnsPerPlayer': 3, 'shuffleDrawAfter': True}],
         'Put up to 4 cards from the draw and discard piles in jail for 3 rounds (30 seconds to pick). '
         'This card goes to jail too.'),
    12: ([{'kind': 'distributeHand', 'who': 'self', 'cards': 'walls', 'includeSelf': True}],
         'Play Immediately: hand out the Wall Sections in your hand around the table. Cannot be blocked.'),
    13: ([{'kind': 'buildFree', 'max': 3}],
         'Build up to 3 Wall Sections from your hand with this card\'s 1 action. No Man Hours needed.'),
    14: ([{'kind': 'buildPayment'}],
         'Discard it to build 1 Wall Section (1 action).'),
    15: ([{'kind': 'everyoneReturnsWall', 'eligible': 'notInSetOrGuarded', 'blockablePerPlayer': True}],
         'Play Immediately: every player pulls one built wall (not in a set of 3, not guarded) back into '
         'their hand. Each player can block it for themselves with Self-Defense.'),
    16: ([{'kind': 'limitActions', 'target': OPP, 'actions': 1, 'when': 'nextTurn'}],
         'An opponent gets only 1 action on their next turn. Self-Defense can block it.'),
    17: ([{'kind': 'skipTurn', 'target': OPP, 'afterDrawing': True}],
         'An opponent draws on their next turn but skips the rest of it. Self-Defense can block it '
         '(when played, and again when their turn starts).'),
    18: ([{'kind': 'distributeHand', 'who': 'mostCards', 'cards': 'all', 'includeSelf': True}],
         'Play Immediately: whoever has the most cards (all tied players) hands them all out around the table. '
         'Cannot be blocked.'),
    19: ([{'kind': 'payDebt'}],
         'Discard it when someone plays Debt on you to keep your wall. Cannot be played by itself.'),
    20: ([{'kind': 'blockAttack'}],
         'Discard it to block an attack on you (not Debt, Stimulus Check, Fake News, Lawfare or Redistribution). '
         'Cannot be played by itself.'),
    21: ([{'kind': 'stealRandom', 'from': OPP, 'count': 3}],
         'Take 3 random cards from an opponent. Uses no action. Self-Defense cannot stop it.'),
    22: ([{'kind': 'pickFromPiles', 'piles': ['draw'], 'count': 3, 'seconds': 30, 'to': 'hand',
           'shuffleDrawAfter': True}],
         'Pick any 3 cards from the draw pile within 30 seconds, then the draw pile is shuffled.'),
    23: ([{'kind': 'buildSets', 'firstSetFree': True, 'extraSetCost': 1}],
         'Build every copy of one matching kind (2 or 3) from your hand. The first set is covered by this '
         'card\'s action; each further set costs 1 action. No Man Hours.'),
    24: ([{'kind': 'distributeHand', 'who': 'self', 'cards': 'traffic', 'cardIds': [14, 19, 25, 26],
           'includeSelf': True}],
         'Play Immediately: hand out your Savings, Trump, Trump Train and Man Hour cards around the table. '
         'Self-Defense can block it.'),
    25: ([{'kind': 'choice', 'options': [
            [{'kind': 'draw', 'count': 3}],
            [{'kind': 'guardPair'}]]}],
         'Draw 3 cards, or protect one of your pairs of walls from Debt (and Riot / Pull Out) until it '
         'becomes a set of 3.'),
    26: ([{'kind': 'draw', 'count': 3}],
         'Discard it to draw 3 cards. Uses 1 action.'),
    27: ([{'kind': 'pickFromPiles', 'piles': ['discard'], 'count': 3, 'seconds': 30, 'to': 'hand',
           'shuffleDrawAfter': False}],
         'Pick any 3 cards from the discard pile within 30 seconds. Uses 1 action.'),
    28: ([{'kind': 'buildFree', 'max': 2}],
         'Build up to 2 Wall Sections from your hand with this card\'s 1 action. No Man Hours needed.'),
    45: ([{'kind': 'reshuffleDiscard'}],
         'Shuffle the whole discard pile back into the draw pile. Uses 1 action.'),
    46: ([{'kind': 'distributeHand', 'who': 'self', 'cards': 'all', 'includeSelf': False}],
         'Hand out every card in your hand to the other players. None go to you. Uses 1 action.'),
    47: ([{'kind': 'everyoneNewHand', 'count': 5}],
         'Every player discards their hand and draws 5 new cards. Uses 1 action.'),
    48: ([{'kind': 'extraActions', 'count': 2}],
         'Gain 2 extra actions this turn. Uses no action.'),
    49: ([{'kind': 'swapHands', 'with': OPP}],
         'Swap your whole hand with a player you choose. Self-Defense can block it.'),
}
WALL_EFFECT = ([{'kind': 'wallSection', 'miles': [3, 8, 16]}],
               'A Wall Section: 1 built = 3 miles, 2 matching = 8, 3 matching (a set) = 16. '
               'Build it with a Man Hour or by discarding 2 other walls (1 action).')


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', str(name).lower()).strip('-')


def category(cid):
    if cid in WALLS:
        return 'wall'
    if cid == 14:
        return 'manhour'
    if cid in (19, 20):
        return 'reaction'
    if cid in IMMEDIATE:
        return 'immediate'
    if cid == 4:
        return 'placeholder'
    return 'action'


def main():
    p = json.load(open(SRC))
    assets = json.load(open(ASSETS))
    stage = next(t for t in p['targets'] if t['isStage'])
    L = {v[0]: v[1] for v in stage['lists'].values()}
    names = L['Card Names']
    deck = Counter(int(x) for x in L['Deck Recipe'])
    costumes = assets['sprites']['Cards']['costumes']
    by_number = {c['number']: (name, c) for name, c in costumes.items()}

    packs = [{'id': pid, 'name': pname} for pid, pname in zip(L['Pack IDs'], L['Pack Names'])]
    pack_copies = Counter()
    for cid, of in zip(L['Pack Card Id'], L['Pack Card Of']):
        pack_copies[(int(cid), L['Pack IDs'][int(of) - 1])] += 1

    def img(list_name, i):
        items = assets['lists'].get(list_name) or []
        return items[i - 1] if i - 1 < len(items) else None

    cards = []
    for i, name in enumerate(names, 1):
        costume_name, costume = by_number[i]
        effects, text = WALL_EFFECT if i in WALLS else EFFECTS.get(i, ([], ''))
        explain = ' '.join(s.strip() for s in (L['Explain A'][i - 1], L['Explain B'][i - 1]) if s.strip())
        in_packs = [{'pack': pid, 'copies': n} for (cid, pid), n in sorted(pack_copies.items()) if cid == i]
        cards.append({
            'id': i,
            'name': name,
            'slug': slug(name),
            'category': category(i),
            'cost': int(L['Card Action Cost'][i - 1]),
            'count': deck.get(i, 0),
            'packs': in_packs,
            'playImmediately': i in IMMEDIATE,
            'blockable': i in BLOCKABLE,
            'heldUntilResolved': i in HELD,
            'help': L['Card Help'][i - 1],
            'explain': explain,
            'effect': text or explain or '(placeholder, not in the deck)',
            'effects': effects,
            'link': L['Card QR Links'][i - 1] or None,
            'image': {
                'costume': costume_name,
                'card': costume['path'],
                'high': img('Card Data URI High', i),
                'thumb': img('Card Thumb', i),
                'mini': img('Card Mini', i),
            },
        })

    out = {
        '_about': 'Generated by tools/export-cards.py from assets/project.json. Do not edit by hand.',
        'deckSize': sum(deck.values()),
        'packs': packs,
        'cards': cards,
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print('%d cards, deck of %d' % (len(cards), out['deckSize']))


main()
