import { bestHand, type HandScore } from './evaluator.js';
import type { Pot } from './pots.js';
import type { BoardAward, Card, HandRule, PotResult, ShowdownHand } from './types.js';

export interface AwardInput {
  pots: Pot[];
  /** One entry per board (two when double board is on). Each has 5 cards. */
  boards: Card[][];
  /** Hole cards of every player still in the hand. */
  holes: Record<string, Card[]>;
  rule: HandRule;
  /** All player ids starting with the seat left of the button. Used to hand out odd chips. */
  orderFromButton: string[];
}

export interface AwardOutput {
  payouts: Record<string, number>;
  pots: PotResult[];
  hands: Record<string, ShowdownHand>;
}

/** Split `amount` across `parts`; the first parts get the odd chips. 15 over 2 -> [8, 7]. */
export function splitEvenly(amount: number, parts: number): number[] {
  const base = Math.floor(amount / parts);
  const extra = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Decide who wins each pot.
 * With two boards, every pot is cut in half (odd chip to board A); the best hand on each
 * board wins that half. Ties split a half, odd chips going to the seat closest left of the button.
 */
export function awardPots(input: AwardInput): AwardOutput {
  const { pots, boards, holes, rule, orderFromButton } = input;
  const contenders = Object.keys(holes);

  // Everyone's best hand on every board.
  const scores: Record<string, HandScore[]> = {};
  const hands: Record<string, ShowdownHand> = {};
  for (const id of contenders) {
    scores[id] = boards.map((board) => bestHand(rule, holes[id], board));
    hands[id] = {
      hole: [...holes[id]],
      perBoard: scores[id].map((s) => ({ name: s.name, cards: s.cards })),
    };
  }

  const payouts: Record<string, number> = Object.fromEntries(contenders.map((id) => [id, 0]));
  const potResults: PotResult[] = [];
  const seatOrder = (id: string) => orderFromButton.indexOf(id);

  for (const pot of pots) {
    const halves = splitEvenly(pot.amount, boards.length);
    const boardAwards: BoardAward[] = halves.map((amount, board) => {
      const best = Math.max(...pot.eligible.map((id) => scores[id][board].score));
      const winners = pot.eligible.filter((id) => scores[id][board].score === best).sort((a, b) => seatOrder(a) - seatOrder(b));
      splitEvenly(amount, winners.length).forEach((share, i) => (payouts[winners[i]] += share));
      return { board, amount, winners, winningHand: scores[winners[0]][board].name };
    });
    potResults.push({ amount: pot.amount, eligible: [...pot.eligible], boards: boardAwards });
  }

  return { payouts, pots: potResults, hands };
}
