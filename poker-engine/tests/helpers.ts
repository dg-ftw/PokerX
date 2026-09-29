import { Hand } from '../src/game.js';
import type { Action, HandConfig, PlayerSetup } from '../src/types.js';

/**
 * Build a fixed deck so a test knows exactly who gets which cards.
 *   holes[i] = hole cards of seat i (space separated)
 *   board    = board cards in the order they are dealt (double board: flopA flopB turnA turnB riverA riverB)
 */
export function rig(holes: string[], board: string, button = 0): string[] {
  const n = holes.length;
  const perSeat = holes.map((h) => h.trim().split(/\s+/));
  const deck: string[] = [];
  for (let card = 0; card < perSeat[0].length; card++) {
    for (let step = 1; step <= n; step++) deck.push(perSeat[(button + step) % n][card]);
  }
  deck.push(...board.trim().split(/\s+/));
  return deck;
}

export function players(...stacks: number[]): PlayerSetup[] {
  return stacks.map((stack, i) => ({ id: `p${i}`, stack }));
}

export const cfg = (extra: Partial<HandConfig> = {}): HandConfig => ({
  variant: 'holdem', smallBlind: 1, bigBlind: 2, ...extra,
});

/** Run a list of [playerId, action] steps in order. */
export function play(hand: Hand, steps: [string, Action][]): void {
  for (const [id, action] of steps) hand.act(id, action);
}

export const check = (hand: Hand, id: string) => hand.act(id, { type: 'check' });
