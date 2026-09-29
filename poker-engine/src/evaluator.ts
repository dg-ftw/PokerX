import { parseCard } from './cards.js';
import type { Card, HandRule } from './types.js';

/**
 * Hand evaluation.
 *
 * Every 5-card hand gets ONE number ("score"). A bigger score always means a better hand,
 * and equal scores mean a tie. This makes comparing hands trivial: just compare numbers.
 *
 * score = category, then up to 5 tie-break ranks, each packed in base 15.
 */

export const Category = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8,
} as const;

export interface HandScore {
  score: number;
  category: number;
  /** Human readable, e.g. "Full House, Kings full of Fours". */
  name: string;
  /** The five cards that make the hand. */
  cards: Card[];
}

const RANK_NAMES: Record<number, string> = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
const plural = (rank: number) => (rank === 6 ? 'Sixes' : `${RANK_NAMES[rank]}s`);

function encode(category: number, tiebreak: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (tiebreak[i] ?? 0);
  return score;
}

/** Returns the high card of a straight, or 0 if the (descending, distinct) ranks are not one. */
function straightHigh(ranksDesc: number[]): number {
  if (new Set(ranksDesc).size !== 5) return 0;
  if (ranksDesc[0] - ranksDesc[4] === 4) return ranksDesc[0];
  // The wheel: A-5-4-3-2 counts as a five-high straight.
  if (ranksDesc.join(',') === '14,5,4,3,2') return 5;
  return 0;
}

function describe(category: number, tiebreak: number[]): string {
  switch (category) {
    case Category.StraightFlush:
      return tiebreak[0] === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[tiebreak[0]]} high`;
    case Category.FourOfAKind:
      return `Four of a Kind, ${plural(tiebreak[0])}`;
    case Category.FullHouse:
      return `Full House, ${plural(tiebreak[0])} full of ${plural(tiebreak[1])}`;
    case Category.Flush:
      return `Flush, ${RANK_NAMES[tiebreak[0]]} high`;
    case Category.Straight:
      return `Straight, ${RANK_NAMES[tiebreak[0]]} high`;
    case Category.ThreeOfAKind:
      return `Three of a Kind, ${plural(tiebreak[0])}`;
    case Category.TwoPair:
      return `Two Pair, ${plural(tiebreak[0])} and ${plural(tiebreak[1])}`;
    case Category.Pair:
      return `Pair of ${plural(tiebreak[0])}`;
    default:
      return `High Card, ${RANK_NAMES[tiebreak[0]]}`;
  }
}

/** Evaluate exactly five cards. */
export function evaluateFive(cards: readonly Card[]): HandScore {
  if (cards.length !== 5) throw new Error(`evaluateFive needs 5 cards, got ${cards.length}`);
  const parsed = cards.map(parseCard);
  const ranksDesc = parsed.map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = parsed.every((c) => c.suit === parsed[0].suit);
  const high = straightHigh(ranksDesc);

  // Group equal ranks: biggest group first, then highest rank first.
  const counts = new Map<number, number>();
  for (const r of ranksDesc) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  const shape = groups.map((g) => g.count).join('');
  const groupRanks = groups.map((g) => g.rank);

  let category: number;
  let tiebreak: number[];
  if (high && isFlush) [category, tiebreak] = [Category.StraightFlush, [high]];
  else if (shape === '41') [category, tiebreak] = [Category.FourOfAKind, groupRanks];
  else if (shape === '32') [category, tiebreak] = [Category.FullHouse, groupRanks];
  else if (isFlush) [category, tiebreak] = [Category.Flush, ranksDesc];
  else if (high) [category, tiebreak] = [Category.Straight, [high]];
  else if (shape === '311') [category, tiebreak] = [Category.ThreeOfAKind, groupRanks];
  else if (shape === '221') [category, tiebreak] = [Category.TwoPair, groupRanks];
  else if (shape === '2111') [category, tiebreak] = [Category.Pair, groupRanks];
  else [category, tiebreak] = [Category.HighCard, ranksDesc];

  return {
    score: encode(category, tiebreak),
    category,
    name: describe(category, tiebreak),
    cards: [...cards],
  };
}

/** All ways to choose k items (order ignored). */
export function combinations<T>(items: readonly T[], k: number): T[][] {
  const result: T[][] = [];
  const pick: T[] = [];
  const go = (start: number) => {
    if (pick.length === k) {
      result.push([...pick]);
      return;
    }
    for (let i = start; i <= items.length - (k - pick.length); i++) {
      pick.push(items[i]);
      go(i + 1);
      pick.pop();
    }
  };
  go(0);
  return result;
}

/**
 * Best 5-card hand a player can make.
 *  - rule "any":   any 5 of hole + board       (Hold'em, 3-card Texas, Pineapple after discards)
 *  - rule "omaha": exactly 2 hole + 3 board    (PLO)
 */
export function bestHand(rule: HandRule, hole: readonly Card[], board: readonly Card[]): HandScore {
  let candidates: Card[][];
  if (rule === 'omaha') {
    if (hole.length < 2 || board.length < 3) {
      throw new Error(`Omaha needs 2+ hole cards and 3+ board cards (got ${hole.length} and ${board.length})`);
    }
    const boardTriples = combinations(board, 3);
    candidates = combinations(hole, 2).flatMap((pair) => boardTriples.map((triple) => [...pair, ...triple]));
  } else {
    if (hole.length + board.length < 5) {
      throw new Error(`Need at least 5 cards to make a hand (got ${hole.length + board.length})`);
    }
    candidates = combinations([...hole, ...board], 5);
  }

  let best: HandScore | null = null;
  for (const five of candidates) {
    const scored = evaluateFive(five);
    if (!best || scored.score > best.score) best = scored;
  }
  return best!;
}
