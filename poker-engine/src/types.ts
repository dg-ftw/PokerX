/**
 * Shared types for the poker engine.
 *
 * Cards are plain two-character strings so logs and test failures are easy to read:
 *   rank: 2 3 4 5 6 7 8 9 T J Q K A     suit: s h d c
 *   e.g. "As" = ace of spades, "Td" = ten of diamonds
 */
export type Card = string;

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

/**
 * A moment in the hand when players discard cards (Pineapple).
 *  - "preflop": after preflop betting, BEFORE the flop is dealt (classic Pineapple)
 *  - "flop" / "turn" / "river": right after that street's cards are dealt, BEFORE its betting
 */
export type DiscardPoint = Street;

/** e.g. { flop: 1, turn: 1 } = discard one card after the flop, one after the turn. */
export type DiscardSchedule = Partial<Record<DiscardPoint, number>>;

export type VariantId =
  | 'holdem'
  | 'texas3'
  | 'plo4'
  | 'plo5'
  | 'pineapple3'
  | 'pineapple4'
  | 'pineapple5';

export type BettingStructure = 'nolimit' | 'potlimit';

/**
 * How a player builds their 5-card hand:
 *  - "any":   best 5 of (hole cards + board), any combination
 *  - "omaha": exactly 2 hole cards + exactly 3 board cards
 */
export type HandRule = 'any' | 'omaha';

/** Random integer in [0, maxExclusive). Injectable so hands can be replayed from a seed. */
export type Rng = (maxExclusive: number) => number;

export interface HandConfig {
  variant: VariantId;
  smallBlind: number;
  bigBlind: number;
  /** Defaults to no-limit (PLO is always pot-limit). */
  betting?: BettingStructure;
  /** Pineapple only. Defaults per variant. Total discards must equal (starting cards - 2). */
  discardSchedule?: DiscardSchedule;
  /** If set, this hand is a bomb pot: everyone antes this much, no preflop betting. */
  bombPotAnte?: number;
  /** Deal two boards; every pot is split between them. */
  doubleBoard?: boolean;
  /** Random source for shuffling / auto-discards. Pass a seeded one to replay a hand. */
  rng?: Rng;
  /** Tests only: a fixed deck, dealt from the front. */
  deck?: Card[];
}

export interface PlayerSetup {
  id: string;
  name?: string;
  stack: number;
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** "raise to" a total bet size for this street. Also used to open the betting (a bet). */
  | { type: 'raise'; to: number }
  | { type: 'allin' };

export interface LegalActions {
  playerId: string;
  /** Chips needed to match the current bet (may exceed the player's stack). */
  toCall: number;
  /** What a call actually costs (capped at the stack; an all-in call if smaller than toCall). */
  callAmount: number;
  canCheck: boolean;
  canRaise: boolean;
  /** Smallest / largest legal "raise to" totals. 0 when canRaise is false. */
  minRaiseTo: number;
  maxRaiseTo: number;
  /** The total the player would have in this street if they shoved. */
  allInTo: number;
}

export type Phase = 'betting' | 'discarding' | 'complete';

export interface PlayerState {
  id: string;
  name: string;
  stack: number;
  streetBet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  holeCount: number;
  /** null when the viewer is not allowed to see these cards. */
  hole: Card[] | null;
}

export interface BoardAward {
  board: number;
  amount: number;
  winners: string[];
  winningHand: string;
}

export interface PotResult {
  amount: number;
  eligible: string[];
  boards: BoardAward[];
}

export interface ShowdownHand {
  hole: Card[];
  perBoard: { name: string; cards: Card[] }[];
}

export interface HandResult {
  reason: 'fold' | 'showdown';
  /** Chips paid out of the pots to each player. */
  payouts: Record<string, number>;
  /** Profit / loss for the hand (final stack - starting stack). Feed this to the leaderboard. */
  net: Record<string, number>;
  finalStacks: Record<string, number>;
  pots: PotResult[];
  /** Cards shown at showdown (empty if everybody folded). */
  hands: Record<string, ShowdownHand>;
}

export interface HandState {
  phase: Phase;
  street: Street;
  boards: Card[][];
  pot: number;
  currentBet: number;
  minRaise: number;
  toAct: string | null;
  button: string;
  players: PlayerState[];
  /** playerId -> number of cards they still have to discard. */
  pendingDiscards: Record<string, number>;
  result: HandResult | null;
}

/** Thrown for illegal moves (wrong turn, bad raise size...). Safe to show to the player. */
export class HandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandError';
  }
}
