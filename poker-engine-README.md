# Poker Engine (Phase 1)

The rules engine for the private poker site. **No UI, no server**: just a TypeScript library plus tests,
so every rule can be checked before anything else is built on top of it.

Supports: Hold'em, 3-card Texas, PLO4, PLO5 (pot-limit, hi only), Pineapple 3/4/5 with a
configurable discard schedule, host-triggered **bomb pots**, and **double board**.

## Quick start

```bash
npm install
npm test                    # 55 tests, including thousands of random hands
npm run typecheck
npm run simulate            # random hands for every variant (finds bugs)
npm run simulate -- --variant pineapple4 --hands 1 --seed 11 --players 3 --bomb 5 --double --verbose
```

## Using it

```ts
import { Hand } from './src/index.js';

const hand = new Hand(
  { variant: 'pineapple4', smallBlind: 1, bigBlind: 2, doubleBoard: false },
  [{ id: 'amit', stack: 200 }, { id: 'ravi', stack: 200 }, { id: 'sam', stack: 200 }],
  0, // seat index of the dealer button
);

while (!hand.isComplete) {
  if (hand.phase === 'betting') {
    const legal = hand.getLegalActions()!;           // who acts, what is allowed
    hand.act(legal.playerId, legal.canCheck ? { type: 'check' } : { type: 'call' });
  } else {                                            // phase === 'discarding'
    for (const id of Object.keys(hand.getFullState().pendingDiscards)) hand.autoDiscard(id);
  }
}
console.log(hand.getResult());   // payouts, net profit/loss per player (feeds the leaderboard), shown hands
```

Actions: `fold`, `check`, `call`, `raise` (`{ type: 'raise', to: 40 }` means "make my bet 40 in total"; also used to open the betting), `allin`.
Illegal moves throw `HandError` with a message that is safe to show the player.

## Folder map

| File | What it does |
|---|---|
| `src/types.ts` | All shared types + comments explaining each option |
| `src/cards.ts` | Deck, secure shuffle, card parsing (`"As"` = ace of spades) |
| `src/evaluator.ts` | Turns 5 cards into ONE comparable number; best-hand search for Hold'em / Omaha rules |
| `src/variants.ts` | **Table of all variants** and config validation. Add a new variant here |
| `src/pots.ts` | Main pot / side pot maths (pure function) |
| `src/showdown.ts` | Who wins each pot, tie splitting, double-board splitting, odd chips |
| `src/game.ts` | The `Hand` state machine: blinds, betting rounds, discards, streets, payout |
| `tests/` | Unit tests per module + `fuzz.test.ts` (random hands) |
| `scripts/simulate.ts` | Command-line simulator / hand printer |
| `docs/` | The SRS and the phase plan |

## How a hand flows

```
deal -> blinds (or bomb-pot antes)
     -> preflop betting -> discard point "preflop" -> FLOP dealt
     -> discard point "flop"  -> flop betting
     -> TURN dealt  -> discard point "turn"  -> turn betting
     -> RIVER dealt -> discard point "river" -> river betting
     -> showdown -> payout
```

A bomb pot skips preflop betting. Discard points with count 0 are skipped. The hand is always in one of
three phases: `betting` (call `act`), `discarding` (call `discard`), `complete` (read `getResult`).

**Discard schedule** examples (`discardSchedule` option, must total `startingCards - 2`):

| Setup | Schedule |
|---|---|
| Classic Pineapple (3 cards) | `{ preflop: 1 }` = discard after preflop betting, before the flop |
| Crazy Pineapple (3 cards) | `{ flop: 1 }` = discard after the flop is dealt, before flop betting |
| 4 cards, your example | `{ flop: 1, turn: 1 }` |
| 5 cards | `{ preflop: 1, flop: 1, turn: 1 }` |

## Debugging guide

1. **Read the log.** `hand.log` is a step-by-step story of the hand (server side only, it contains hidden cards).
2. **Print the table.** `hand.dump()` shows stacks, bets, cards and whose turn it is.
3. **Chip check.** After every change the engine verifies chips are neither created nor destroyed and throws `BUG: chips not conserved` with the dump + log if not.
4. **Replay any hand.** Every random hand from `npm run simulate` has a seed. A failure prints an exact replay command; rerun it with `--verbose`.
5. **Rig a deck in a test.** `tests/helpers.ts` has `rig(holes, board)` so a test can decide exactly which cards are dealt. Copy an existing test in `tests/game.test.ts`.
6. **Hand comparisons** are plain numbers (`evaluateFive(...).score`). Equal = tie.

## Rules decisions (change here if you disagree)

- No burn cards (online, not needed). Hole cards are dealt one at a time starting left of the button.
- Heads-up: the button is the small blind and acts first preflop.
- Uncalled bets are returned. A short all-in raise does not let players who already acted re-raise.
- Pot-limit max raise-to = current bet + (pot + amount to call).
- Double board: each pot is split in half (odd chip to board A); best hand on each board wins its half; ties split, odd chip to the seat closest left of the button.
- Deck limit: `players x hole cards + 5 x boards <= 52` (for example 9 players of PLO5 fit only on a single board).
- Bomb pot: antes are dead money, betting starts on the flop with the first player left of the button.

## Not in this phase

Tables, timers, sockets, accounts, database, leaderboard, UI. See `docs/PHASES.md`. The engine already
exposes what Phase 2 needs: `getViewFor(playerId)` (hidden-card-safe state), `defaultAction()` and
`autoDiscard()` for timeouts, and `getResult().net` for the leaderboard.
