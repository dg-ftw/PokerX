import type { Hand } from '../src/game.js';
import type { Action, Rng } from '../src/types.js';

/** Plays a whole hand by picking random legal moves. Used by the simulator and the fuzz test. */
export function playRandomHand(hand: Hand, rng: Rng): void {
  for (let steps = 0; !hand.isComplete; steps++) {
    if (steps > 500) throw new Error(`Hand did not finish after 500 steps.\n${hand.dump()}`);

    if (hand.phase === 'discarding') {
      for (const id of Object.keys(hand.getFullState().pendingDiscards)) hand.autoDiscard(id);
      continue;
    }

    const legal = hand.getLegalActions()!;
    const roll = rng(100);
    let action: Action;
    if (roll < 10) action = { type: 'fold' };
    else if (roll < 15 && legal.canRaise) action = { type: 'allin' };
    else if (roll < 35 && legal.canRaise) {
      const span = legal.maxRaiseTo - legal.minRaiseTo;
      action = { type: 'raise', to: legal.minRaiseTo + rng(span + 1) };
    } else action = legal.canCheck ? { type: 'check' } : { type: 'call' };

    // A pot-limit table may reject "allin" when it is above the cap: fall back to the max legal raise.
    try {
      hand.act(legal.playerId, action);
    } catch (error) {
      if (action.type === 'allin' && legal.canRaise) hand.act(legal.playerId, { type: 'raise', to: legal.maxRaiseTo });
      else throw error;
    }
  }
}
