import { randomInt } from 'node:crypto';
import type { Card, Rng } from './types.js';

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'shdc';

/** Cryptographically secure random integer in [0, max). Used for real games. */
export const secureRng: Rng = (max) => randomInt(max);

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANK_CHARS) {
    for (const suit of SUIT_CHARS) deck.push(rank + suit);
  }
  return deck;
}

/** Fisher-Yates shuffle. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng = secureRng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface ParsedCard {
  /** 2..14 (Ace = 14) */
  rank: number;
  suit: string;
}

const parseCache = new Map<Card, ParsedCard>();

export function parseCard(card: Card): ParsedCard {
  const cached = parseCache.get(card);
  if (cached) return cached;
  const rankIndex = card.length === 2 ? RANK_CHARS.indexOf(card[0]) : -1;
  if (rankIndex < 0 || !SUIT_CHARS.includes(card[1])) {
    throw new Error(`Invalid card "${card}". Use rank 23456789TJQKA + suit shdc, e.g. "As".`);
  }
  const parsed = { rank: rankIndex + 2, suit: card[1] };
  parseCache.set(card, parsed);
  return parsed;
}

/** "As Kd 7c" -> ["As", "Kd", "7c"] (validates every card). */
export function parseCards(text: string): Card[] {
  const cards = text.trim() === '' ? [] : text.trim().split(/\s+/);
  cards.forEach(parseCard);
  return cards;
}
