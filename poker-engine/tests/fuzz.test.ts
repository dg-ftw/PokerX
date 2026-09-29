import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hand } from '../src/game.js';
import { VARIANTS } from '../src/variants.js';
import type { VariantId } from '../src/types.js';
import { makeRng } from '../scripts/rng.js';
import { playRandomHand } from '../scripts/randomPlayer.js';

/**
 * Plays thousands of random hands. The engine's own invariant check throws if chips are ever
 * created or destroyed, so "no exception" means the money always adds up.
 */
for (const variant of Object.keys(VARIANTS) as VariantId[]) {
  test(`random hands never break the rules: ${variant}`, () => {
    for (let seed = 1; seed <= 250; seed++) {
      const rng = makeRng(seed * 7919);
      const doubleBoard = rng(3) === 0;
      const maxPlayers = Math.min(9, Math.floor((52 - (doubleBoard ? 10 : 5)) / VARIANTS[variant].startingCards));
      const count = 2 + rng(maxPlayers - 1);
      const stacks = Array.from({ length: count }, () => 5 + rng(200));
      const hand = new Hand(
        {
          variant, smallBlind: 1, bigBlind: 2, doubleBoard, rng,
          bombPotAnte: rng(4) === 0 ? 3 : undefined,
          betting: VARIANTS[variant].forcedBetting ?? (rng(2) ? 'potlimit' : 'nolimit'),
        },
        stacks.map((stack, i) => ({ id: `p${i}`, stack })),
        rng(count),
      );
      playRandomHand(hand, rng);
      const result = hand.getResult()!;
      const netTotal = Object.values(result.net).reduce((a, b) => a + b, 0);
      assert.equal(netTotal, 0, `seed ${seed}: winnings and losses must cancel out`);
      for (const [id, stack] of Object.entries(result.finalStacks)) assert.ok(stack >= 0, `${id} has a negative stack`);
    }
  });
}
