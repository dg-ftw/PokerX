export type VariantId =
  | 'holdem'
  | 'texas3'
  | 'plo4'
  | 'plo5'
  | 'pineapple3'
  | 'pineapple4'
  | 'pineapple5';

export type BettingStructure = 'nolimit' | 'potlimit';

export type DiscardPoint = 'preflop' | 'flop' | 'turn' | 'river';
export type DiscardSchedule = Partial<Record<DiscardPoint, number>>;

export interface TableSettings {
  variant: VariantId;
  betting: BettingStructure;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  seatCount: number;
  turnTimerSeconds: number;
  discardSchedule?: DiscardSchedule;
  doubleBoard: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  stack: number;
  seatIndex?: number | null;
  connected: boolean;
  sittingOut: boolean;
  muted: boolean;
  isHost: boolean;
}

export type Card = string;

export interface PlayerState {
  id: string;
  name: string;
  stack: number;
  streetBet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  holeCount: number;
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
  payouts: Record<string, number>;
  net: Record<string, number>;
  finalStacks: Record<string, number>;
  pots: PotResult[];
  hands: Record<string, ShowdownHand>;
}

export interface LegalActions {
  playerId: string;
  toCall: number;
  callAmount: number;
  canCheck: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  allInTo: number;
}

export interface HandState {
  phase: 'betting' | 'discarding' | 'complete';
  street: 'preflop' | 'flop' | 'turn' | 'river';
  boards: Card[][];
  pot: number;
  currentBet: number;
  minRaise: number;
  toAct: string | null;
  button: string;
  players: PlayerState[];
  pendingDiscards: Record<string, number>;
  result: HandResult | null;
}

export interface TableView {
  code: string;
  hostId: string;
  settings: TableSettings;
  players: PlayerView[];
  hand: HandState | null;
  legalActions: LegalActions | null;
  paused: boolean;
  nextHandBombAnte: number | null;
  handNumber: number;
  handLog: string[];
}

export interface JoinData {
  playerId: string;
  reconnectToken: string;
  table: TableView;
}

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ChatMessage {
  playerId: string;
  name: string;
  message: string;
  at: string;
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }
  | { type: 'allin' };

export const VARIANT_LABELS: Record<VariantId, string> = {
  holdem: "Texas Hold'em",
  texas3: '3-Card Texas',
  plo4: 'Pot-Limit Omaha 4',
  plo5: 'Pot-Limit Omaha 5',
  pineapple3: 'Pineapple (3 Cards)',
  pineapple4: 'Pineapple (4 Cards)',
  pineapple5: 'Pineapple (5 Cards)',
};
