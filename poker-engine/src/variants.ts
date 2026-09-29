import { parseCard } from './cards.js';
import { secureRng } from './cards.js';
import {
  HandError,
  type BettingStructure,
  type Card,
  type DiscardPoint,
  type DiscardSchedule,
  type HandConfig,
  type HandRule,
  type Rng,
  type VariantId,
} from './types.js';

/** Everything that makes one variant different from another lives in this table. */
export interface VariantDef {
  id: VariantId;
  label: string;
  /** Hole cards dealt to each player. */
  startingCards: number;
  rule: HandRule;
  /** Pineapple variants discard down to 2 cards before showdown. */
  discardsDownTo2: boolean;
  /** Used when the host does not choose a discard schedule. */
  defaultDiscards: DiscardSchedule;
  /** Some variants only allow one betting structure. */
  forcedBetting?: BettingStructure;
}

export const VARIANTS: Record<VariantId, VariantDef> = {
  holdem: {
    id: 'holdem', label: "Texas Hold'em", startingCards: 2, rule: 'any',
    discardsDownTo2: false, defaultDiscards: {},
  },
  texas3: {
    id: 'texas3', label: '3-Card Texas', startingCards: 3, rule: 'any',
    discardsDownTo2: false, defaultDiscards: {},
  },
  plo4: {
    id: 'plo4', label: 'Pot-Limit Omaha (4 cards)', startingCards: 4, rule: 'omaha',
    discardsDownTo2: false, defaultDiscards: {}, forcedBetting: 'potlimit',
  },
  plo5: {
    id: 'plo5', label: 'Pot-Limit Omaha (5 cards)', startingCards: 5, rule: 'omaha',
    discardsDownTo2: false, defaultDiscards: {}, forcedBetting: 'potlimit',
  },
  pineapple3: {
    id: 'pineapple3', label: 'Pineapple (3 cards)', startingCards: 3, rule: 'any',
    discardsDownTo2: true, defaultDiscards: { preflop: 1 },
  },
  pineapple4: {
    id: 'pineapple4', label: 'Pineapple (4 cards)', startingCards: 4, rule: 'any',
    discardsDownTo2: true, defaultDiscards: { flop: 1, turn: 1 },
  },
  pineapple5: {
    id: 'pineapple5', label: 'Pineapple (5 cards)', startingCards: 5, rule: 'any',
    discardsDownTo2: true, defaultDiscards: { preflop: 1, flop: 1, turn: 1 },
  },
};

const DISCARD_POINTS: DiscardPoint[] = ['preflop', 'flop', 'turn', 'river'];

/** A validated config with every default filled in. The Hand class only sees this. */
export interface ResolvedConfig {
  variant: VariantDef;
  smallBlind: number;
  bigBlind: number;
  betting: BettingStructure;
  discardSchedule: DiscardSchedule;
  bombPotAnte: number | null;
  boardCount: 1 | 2;
  rng: Rng;
  deck?: Card[];
}

function requirePositiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new HandError(`${label} must be a positive whole number (got ${String(value)}).`);
  }
  return value;
}

export function resolveConfig(config: HandConfig, playerCount: number): ResolvedConfig {
  const variant = VARIANTS[config.variant];
  if (!variant) throw new HandError(`Unknown variant "${String(config.variant)}".`);

  const smallBlind = requirePositiveInt(config.smallBlind, 'Small blind');
  const bigBlind = requirePositiveInt(config.bigBlind, 'Big blind');
  if (bigBlind < smallBlind) throw new HandError('Big blind cannot be smaller than the small blind.');

  // Betting structure
  const betting = config.betting ?? variant.forcedBetting ?? 'nolimit';
  if (variant.forcedBetting && betting !== variant.forcedBetting) {
    throw new HandError(`${variant.label} is always ${variant.forcedBetting}; cannot use ${betting}.`);
  }

  // Discard schedule
  const requested = config.discardSchedule ?? variant.defaultDiscards;
  const discardSchedule: DiscardSchedule = {};
  let totalDiscards = 0;
  for (const [point, count] of Object.entries(requested)) {
    if (!DISCARD_POINTS.includes(point as DiscardPoint)) {
      throw new HandError(`Unknown discard point "${point}". Use ${DISCARD_POINTS.join(', ')}.`);
    }
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new HandError(`Discard count at "${point}" must be a whole number (got ${String(count)}).`);
    }
    if ((count as number) > 0) discardSchedule[point as DiscardPoint] = count as number;
    totalDiscards += count as number;
  }
  const requiredDiscards = variant.discardsDownTo2 ? variant.startingCards - 2 : 0;
  if (totalDiscards !== requiredDiscards) {
    throw new HandError(
      `${variant.label} needs exactly ${requiredDiscards} discard(s) in total so players end with 2 cards; ` +
        `the schedule has ${totalDiscards}.`,
    );
  }

  // Bomb pot
  const bombPotAnte = config.bombPotAnte === undefined ? null : requirePositiveInt(config.bombPotAnte, 'Bomb pot ante');

  // Do we have enough cards in the deck?
  const boardCount = config.doubleBoard ? 2 : 1;
  const cardsNeeded = playerCount * variant.startingCards + 5 * boardCount;
  const deckSize = config.deck ? config.deck.length : 52;
  if (cardsNeeded > deckSize) {
    throw new HandError(
      `Not enough cards: ${playerCount} players x ${variant.startingCards} hole cards + ` +
        `${5 * boardCount} board cards = ${cardsNeeded}, but the deck has ${deckSize}.`,
    );
  }
  if (config.deck) {
    config.deck.forEach(parseCard); // throws on an invalid card
    if (new Set(config.deck).size !== config.deck.length) throw new HandError('The supplied deck has duplicate cards.');
  }

  return {
    variant, smallBlind, bigBlind, betting, discardSchedule, bombPotAnte,
    boardCount: boardCount as 1 | 2,
    rng: config.rng ?? secureRng,
    deck: config.deck,
  };
}
