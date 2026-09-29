import { createDeck, shuffle } from './cards.js';
import { buildPots } from './pots.js';
import { awardPots } from './showdown.js';
import { resolveConfig, type ResolvedConfig } from './variants.js';
import {
  HandError,
  type Action,
  type Card,
  type DiscardPoint,
  type HandConfig,
  type HandResult,
  type HandState,
  type LegalActions,
  type Phase,
  type PlayerSetup,
  type PlayerState,
  type PotResult,
  type ShowdownHand,
  type Street,
} from './types.js';

/** One player's seat at the table for this hand. */
interface Seat {
  id: string;
  name: string;
  startingStack: number;
  stack: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  /** Chips put in during the current betting round. */
  streetBet: number;
  /** Chips put in during the whole hand (blinds, antes and bets). */
  totalBet: number;
  /** Has acted since the last full raise. */
  hasActed: boolean;
  /** A short all-in raise happened after this player acted: they may call or fold, not re-raise. */
  raiseClosed: boolean;
}

const NEXT_STREET: Record<Exclude<Street, 'river'>, Street> = { preflop: 'flop', flop: 'turn', turn: 'river' };

/**
 * One hand of poker, from the deal to the payout.
 *
 * HOW A HAND FLOWS (read this first when debugging):
 *
 *   deal -> [blinds | bomb-pot antes]
 *        -> preflop betting -> discard point "preflop" -> flop dealt
 *        -> discard point "flop"  -> flop betting
 *        -> turn dealt  -> discard point "turn"  -> turn betting
 *        -> river dealt -> discard point "river" -> river betting
 *        -> showdown / payout
 *
 * A bomb pot skips "preflop betting". Discard points with a count of 0 are skipped.
 * The hand always waits in one of three phases:
 *   "betting"    -> call act() for the player returned by currentActorId
 *   "discarding" -> call discard() for every player in getState().pendingDiscards
 *   "complete"   -> read getResult()
 *
 * Every public method that changes the hand ends with checkInvariants(), which throws
 * if chips ever appear or disappear. That catches most engine bugs immediately.
 */
export class Hand {
  readonly config: ResolvedConfig;
  /** Server-side event log. It contains hidden cards: never send it to players. */
  readonly log: string[] = [];

  private seats: Seat[];
  private deck: Card[];
  private boards: Card[][];
  private buttonIndex: number;
  private _phase: Phase = 'betting';
  private _street: Street = 'preflop';
  private currentBet = 0;
  private minRaise: number;
  private actorIndex: number | null = null;
  private pendingDiscards = new Map<string, number>();
  private resume: (() => void) | null = null;
  private result: HandResult | null = null;
  private readonly initialChips: number;

  constructor(config: HandConfig, players: PlayerSetup[], buttonIndex = 0) {
    if (players.length < 2) throw new HandError('A hand needs at least 2 players.');
    if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex >= players.length) {
      throw new HandError(`Button index ${buttonIndex} is outside the table (0..${players.length - 1}).`);
    }
    if (new Set(players.map((p) => p.id)).size !== players.length) throw new HandError('Player ids must be unique.');
    for (const p of players) {
      if (!Number.isInteger(p.stack) || p.stack <= 0) {
        throw new HandError(`Player ${p.id} needs a positive whole-number stack (got ${p.stack}).`);
      }
    }

    this.config = resolveConfig(config, players.length);
    this.buttonIndex = buttonIndex;
    this.minRaise = this.config.bigBlind;
    this.seats = players.map((p) => ({
      id: p.id, name: p.name ?? p.id, startingStack: p.stack, stack: p.stack, hole: [],
      folded: false, allIn: false, streetBet: 0, totalBet: 0, hasActed: false, raiseClosed: false,
    }));
    this.initialChips = players.reduce((sum, p) => sum + p.stack, 0);
    this.deck = this.config.deck ? [...this.config.deck] : shuffle(createDeck(), this.config.rng);
    this.boards = Array.from({ length: this.config.boardCount }, () => [] as Card[]);

    const extras = [
      this.config.betting,
      this.config.bombPotAnte !== null ? `bomb pot ante ${this.config.bombPotAnte}` : `blinds ${this.config.smallBlind}/${this.config.bigBlind}`,
      this.config.boardCount === 2 ? 'double board' : null,
    ].filter(Boolean);
    this.say(`=== New hand: ${this.config.variant.label} (${extras.join(', ')}) ===`);
    this.say(`Players: ${this.seats.map((s, i) => `${s.id}(${s.stack})${i === buttonIndex ? '[BTN]' : ''}`).join(' ')}`);

    this.dealHoleCards();

    if (this.config.bombPotAnte !== null) {
      this.collectAntes(this.config.bombPotAnte);
      // No preflop betting in a bomb pot: go straight to the "preflop" discard point, then the flop.
      this.runDiscardPoint('preflop', () => this.enterStreet('flop'));
    } else {
      const bigBlindIndex = this.postBlinds();
      this.startBetting('preflop', bigBlindIndex);
    }
    this.checkInvariants();
  }

  // ---------------------------------------------------------------------------
  // Read-only information
  // ---------------------------------------------------------------------------

  get phase(): Phase { return this._phase; }
  get street(): Street { return this._street; }
  get isComplete(): boolean { return this._phase === 'complete'; }
  /** The player who must act now (only while phase === "betting"). */
  get currentActorId(): string | null {
    return this._phase === 'betting' && this.actorIndex !== null ? this.seats[this.actorIndex].id : null;
  }
  get pot(): number { return this.totalPot(); }

  getResult(): HandResult | null { return this.result; }

  /** What the current player is allowed to do. Null if nobody needs to act. */
  getLegalActions(): LegalActions | null {
    if (this._phase !== 'betting' || this.actorIndex === null) return null;
    const seat = this.seats[this.actorIndex];
    const toCall = this.currentBet - seat.streetBet;
    const allInTo = seat.streetBet + seat.stack;
    const canRaise = !seat.raiseClosed && allInTo > this.currentBet;

    let minRaiseTo = 0;
    let maxRaiseTo = 0;
    if (canRaise) {
      // Pot-limit: you may raise to (current bet + the pot after you call).
      const potCap = this.config.betting === 'potlimit' ? this.currentBet + this.totalPot() + toCall : allInTo;
      maxRaiseTo = Math.min(allInTo, potCap);
      minRaiseTo = Math.min(this.currentBet + this.minRaise, maxRaiseTo);
    }
    return {
      playerId: seat.id, toCall, callAmount: Math.min(toCall, seat.stack),
      canCheck: toCall === 0, canRaise, minRaiseTo, maxRaiseTo, allInTo,
    };
  }

  /** Full state including everybody's hole cards. SERVER ONLY (tests, logs, debugging). */
  getFullState(): HandState {
    return this.snapshot(() => true);
  }

  /**
   * The state one player is allowed to see. Pass null for a spectator.
   * At a showdown, the cards of players who did not fold are revealed to everybody.
   */
  getViewFor(playerId: string | null): HandState {
    const showdownDone = this.result?.reason === 'showdown';
    return this.snapshot((seat) => seat.id === playerId || (showdownDone && !seat.folded));
  }

  /** Multi-line text picture of the hand: paste this into a bug report. */
  dump(): string {
    const lines = [
      `${this.config.variant.label} | phase=${this._phase} street=${this._street} pot=${this.totalPot()} currentBet=${this.currentBet} minRaise=${this.minRaise}`,
      ...this.boards.map((b, i) => `board ${this.boardLabel(i)}: ${b.join(' ') || '-'}`),
    ];
    this.seats.forEach((s, i) => {
      const flags = [i === this.buttonIndex ? 'BTN' : '', s.folded ? 'folded' : '', s.allIn ? 'all-in' : '', i === this.actorIndex ? '<-- to act' : '']
        .filter(Boolean).join(' ');
      lines.push(`  ${s.id.padEnd(8)} stack=${String(s.stack).padStart(6)} street=${String(s.streetBet).padStart(5)} total=${String(s.totalBet).padStart(5)} hole=[${s.hole.join(' ')}] ${flags}`);
    });
    if (this.pendingDiscards.size) lines.push(`  waiting for discards: ${[...this.pendingDiscards].map(([id, n]) => `${id}x${n}`).join(', ')}`);
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Player input
  // ---------------------------------------------------------------------------

  /** A betting action from the player whose turn it is. Throws HandError if it is illegal. */
  act(playerId: string, action: Action): void {
    if (this._phase !== 'betting' || this.actorIndex === null) {
      throw new HandError(`No betting action is expected right now (phase: ${this._phase}).`);
    }
    const actorIndex = this.actorIndex;
    const seat = this.seats[actorIndex];
    if (seat.id !== playerId) throw new HandError(`It is ${seat.id}'s turn, not ${playerId}'s.`);
    const legal = this.getLegalActions()!;

    switch (action.type) {
      case 'fold':
        seat.folded = true;
        this.say(`${seat.id} folds`);
        break;

      case 'check':
        if (!legal.canCheck) throw new HandError(`${seat.id} cannot check: there is ${legal.toCall} to call.`);
        this.say(`${seat.id} checks`);
        break;

      case 'call':
        if (legal.toCall === 0) throw new HandError(`${seat.id} has nothing to call: check instead.`);
        this.commit(seat, legal.callAmount);
        this.say(`${seat.id} calls ${legal.callAmount}${seat.allIn ? ' (all-in)' : ''}`);
        break;

      case 'raise':
        this.applyRaise(seat, legal, action.to);
        break;

      case 'allin':
        if (legal.allInTo <= this.currentBet) {
          this.commit(seat, legal.callAmount);
          this.say(`${seat.id} calls ${legal.callAmount} (all-in)`);
        } else {
          this.applyRaise(seat, legal, legal.allInTo);
        }
        break;

      default:
        throw new HandError(`Unknown action "${(action as { type: string }).type}".`);
    }

    seat.hasActed = true;
    this.moveToNextActor(actorIndex);
    this.checkInvariants();
  }

  /** Discard the given cards (Pineapple). Throws HandError if the discard is not allowed. */
  discard(playerId: string, cards: Card[]): void {
    if (this._phase !== 'discarding') throw new HandError(`No discards are expected right now (phase: ${this._phase}).`);
    const needed = this.pendingDiscards.get(playerId);
    if (needed === undefined) throw new HandError(`${playerId} has no discard to make.`);
    if (cards.length !== needed) throw new HandError(`${playerId} must discard exactly ${needed} card(s), not ${cards.length}.`);
    if (new Set(cards).size !== cards.length) throw new HandError('Cannot discard the same card twice.');

    const seat = this.seats.find((s) => s.id === playerId)!;
    for (const card of cards) {
      if (!seat.hole.includes(card)) throw new HandError(`${playerId} does not hold ${card}.`);
    }
    seat.hole = seat.hole.filter((c) => !cards.includes(c));
    this.pendingDiscards.delete(playerId);
    this.say(`${playerId} discards ${cards.join(' ')}`);

    if (this.pendingDiscards.size === 0) {
      const next = this.resume!;
      this.resume = null;
      this.say('All discards made');
      next();
    }
    this.checkInvariants();
  }

  /** For turn timers: discard random cards for a player who ran out of time. */
  autoDiscard(playerId: string): void {
    const needed = this.pendingDiscards.get(playerId);
    if (needed === undefined) throw new HandError(`${playerId} has no discard to make.`);
    const seat = this.seats.find((s) => s.id === playerId)!;
    const cards = shuffle(seat.hole, this.config.rng).slice(0, needed);
    this.discard(playerId, cards);
  }

  /** For turn timers: what to do for a player who ran out of time (check if free, otherwise fold). */
  defaultAction(): Action {
    const legal = this.getLegalActions();
    if (!legal) throw new HandError('Nobody needs to act right now.');
    return legal.canCheck ? { type: 'check' } : { type: 'fold' };
  }

  // ---------------------------------------------------------------------------
  // Dealing and setup
  // ---------------------------------------------------------------------------

  private draw(): Card {
    const card = this.deck.shift();
    if (!card) throw new Error('BUG: the deck ran out of cards.');
    return card;
  }

  /** One card at a time, starting with the seat left of the button (like a real table). */
  private dealHoleCards(): void {
    const n = this.seats.length;
    for (let round = 0; round < this.config.variant.startingCards; round++) {
      for (let step = 1; step <= n; step++) {
        this.seats[(this.buttonIndex + step) % n].hole.push(this.draw());
      }
    }
    this.say(`Hole cards dealt (${this.config.variant.startingCards} each)`);
  }

  /** Blinds count as bets. Heads-up, the button is the small blind. Returns the big blind's seat. */
  private postBlinds(): number {
    const n = this.seats.length;
    const smallBlindIndex = n === 2 ? this.buttonIndex : (this.buttonIndex + 1) % n;
    const bigBlindIndex = n === 2 ? (this.buttonIndex + 1) % n : (this.buttonIndex + 2) % n;
    const sb = this.seats[smallBlindIndex];
    const bb = this.seats[bigBlindIndex];
    const sbPaid = this.commit(sb, this.config.smallBlind);
    const bbPaid = this.commit(bb, this.config.bigBlind);
    this.currentBet = Math.max(sbPaid, bbPaid);
    this.say(`${sb.id} posts small blind ${sbPaid}, ${bb.id} posts big blind ${bbPaid}`);
    return bigBlindIndex;
  }

  /** Antes go straight into the pot: they are NOT part of anyone's street bet. */
  private collectAntes(ante: number): void {
    for (const seat of this.seats) {
      const paid = Math.min(ante, seat.stack);
      seat.stack -= paid;
      seat.totalBet += paid;
      if (seat.stack === 0) seat.allIn = true;
    }
    this.say(`Bomb pot! Everyone antes ${ante}. Pot: ${this.totalPot()}`);
  }

  /** Moves chips from a stack into the pot. Never puts in more than the player has. */
  private commit(seat: Seat, amount: number): number {
    const paid = Math.min(amount, seat.stack);
    seat.stack -= paid;
    seat.streetBet += paid;
    seat.totalBet += paid;
    if (seat.stack === 0) seat.allIn = true;
    return paid;
  }

  // ---------------------------------------------------------------------------
  // Streets, discards, betting rounds
  // ---------------------------------------------------------------------------

  /** Deal the cards for a street, then run its discard point, then its betting. */
  private enterStreet(street: Street): void {
    this._street = street;
    const count = street === 'flop' ? 3 : 1;
    for (const board of this.boards) {
      for (let i = 0; i < count; i++) board.push(this.draw());
    }
    this.say(`--- ${street.toUpperCase()} --- ${this.boards.map((b, i) => `${this.boardLabel(i)}${b.join(' ')}`).join('   ')}   (pot ${this.totalPot()})`);
    this.runDiscardPoint(street, () => this.startBetting(street, this.buttonIndex));
  }

  /** If the schedule asks for discards here, pause until everyone has discarded. */
  private runDiscardPoint(point: DiscardPoint, next: () => void): void {
    const count = this.config.discardSchedule[point] ?? 0;
    if (count === 0) {
      next();
      return;
    }
    this._phase = 'discarding';
    this.pendingDiscards = new Map(this.seats.filter((s) => !s.folded).map((s) => [s.id, count]));
    this.resume = next;
    this.say(`Discard point "${point}": each remaining player discards ${count} card(s)`);
  }

  /** Start a betting round. `scanFrom` is the seat BEFORE the first player to act. */
  private startBetting(street: Street, scanFrom: number): void {
    this._street = street;
    this._phase = 'betting';
    this.moveToNextActor(scanFrom);
  }

  private canActCount(): number {
    return this.seats.filter((s) => !s.folded && !s.allIn).length;
  }

  private needsToAct(seat: Seat): boolean {
    if (seat.folded || seat.allIn) return false;
    if (seat.streetBet < this.currentBet) return true; // facing a bet
    // Everybody gets at least one turn (e.g. the big blind's option), unless they're the only one who can act.
    return !seat.hasActed && this.canActCount() >= 2;
  }

  /** Pass the turn clockwise. If nobody needs to act, the betting round is over. */
  private moveToNextActor(fromIndex: number): void {
    if (this.liveSeats().length === 1) {
      this.actorIndex = null;
      this.finishBettingRound();
      return;
    }
    const n = this.seats.length;
    for (let step = 1; step <= n; step++) {
      const index = (fromIndex + step) % n;
      if (this.needsToAct(this.seats[index])) {
        this.actorIndex = index;
        return;
      }
    }
    this.actorIndex = null;
    this.finishBettingRound();
  }

  private finishBettingRound(): void {
    this.refundUncalledBet();
    for (const seat of this.seats) {
      seat.streetBet = 0;
      seat.hasActed = false;
      seat.raiseClosed = false;
    }
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;

    if (this.liveSeats().length === 1) {
      this.finishByFold();
      return;
    }
    const street = this._street;
    if (street === 'river') this.showdown();
    else if (street === 'preflop') this.runDiscardPoint('preflop', () => this.enterStreet('flop'));
    else this.enterStreet(NEXT_STREET[street]);
  }

  /** If one player bet more than anyone could match, give the extra back. */
  private refundUncalledBet(): void {
    const sorted = [...this.seats].sort((a, b) => b.streetBet - a.streetBet);
    const [top, second] = sorted;
    if (top.streetBet > second.streetBet) {
      const excess = top.streetBet - second.streetBet;
      top.streetBet -= excess;
      top.totalBet -= excess;
      top.stack += excess;
      top.allIn = top.stack === 0;
      this.say(`${excess} uncalled chips returned to ${top.id}`);
    }
  }

  private applyRaise(seat: Seat, legal: LegalActions, to: number): void {
    if (!legal.canRaise) {
      throw new HandError(`${seat.id} cannot raise now (either no chips left to raise with, or a short all-in did not reopen the betting).`);
    }
    if (!Number.isInteger(to)) throw new HandError('Raise amount must be a whole number.');
    if (to > legal.maxRaiseTo) {
      const why = this.config.betting === 'potlimit' && legal.maxRaiseTo < legal.allInTo ? 'the pot-limit maximum' : 'all of your chips';
      throw new HandError(`Cannot raise to ${to}: the maximum is ${legal.maxRaiseTo} (${why}).`);
    }
    if (to < legal.minRaiseTo) throw new HandError(`Cannot raise to ${to}: the minimum is ${legal.minRaiseTo}.`);

    const raiseSize = to - this.currentBet;
    const wasBet = this.currentBet === 0;
    this.commit(seat, to - seat.streetBet);
    this.currentBet = to;

    const others = this.seats.filter((s) => s !== seat);
    if (raiseSize >= this.minRaise) {
      // A full raise: everybody may re-raise again, and the next minimum raise grows.
      this.minRaise = raiseSize;
      others.forEach((s) => (s.raiseClosed = false));
    } else {
      // A short all-in: players who already acted may only call or fold.
      others.forEach((s) => { if (s.hasActed) s.raiseClosed = true; });
    }
    seat.raiseClosed = false;
    this.say(`${seat.id} ${wasBet ? 'bets' : 'raises to'} ${to}${seat.allIn ? ' (all-in)' : ''}`);
  }

  // ---------------------------------------------------------------------------
  // Ending the hand
  // ---------------------------------------------------------------------------

  private liveSeats(): Seat[] {
    return this.seats.filter((s) => !s.folded);
  }

  private totalPot(): number {
    return this.seats.reduce((sum, s) => sum + s.totalBet, 0);
  }

  private finishByFold(): void {
    const winner = this.liveSeats()[0];
    const amount = this.totalPot();
    const pots: PotResult[] = [{ amount, eligible: [winner.id], boards: [] }];
    this.say(`Everyone else folded: ${winner.id} wins ${amount}`);
    this.finish('fold', { [winner.id]: amount }, pots, {});
  }

  private showdown(): void {
    this.say('--- SHOWDOWN ---');
    const live = this.liveSeats();
    const pots = buildPots(this.seats.map((s) => ({ id: s.id, totalBet: s.totalBet, folded: s.folded })));
    const holes = Object.fromEntries(live.map((s) => [s.id, s.hole]));
    const n = this.seats.length;
    const orderFromButton = Array.from({ length: n }, (_, i) => this.seats[(this.buttonIndex + 1 + i) % n].id);

    const award = awardPots({ pots, boards: this.boards, holes, rule: this.config.variant.rule, orderFromButton });
    for (const s of live) {
      this.say(`${s.id} shows [${s.hole.join(' ')}]: ${award.hands[s.id].perBoard.map((h) => h.name).join(' | ')}`);
    }
    award.pots.forEach((pot, i) => {
      for (const b of pot.boards) {
        this.say(`Pot ${i + 1} (${pot.amount})${this.boards.length > 1 ? ` board ${String.fromCharCode(65 + b.board)}` : ''}: ${b.amount} to ${b.winners.join(', ')} with ${b.winningHand}`);
      }
    });
    this.finish('showdown', award.payouts, award.pots, award.hands);
  }

  private finish(reason: HandResult['reason'], payouts: Record<string, number>, pots: PotResult[], hands: Record<string, ShowdownHand>): void {
    for (const seat of this.seats) seat.stack += payouts[seat.id] ?? 0;
    this._phase = 'complete';
    this.actorIndex = null;
    this.result = {
      reason,
      payouts: Object.fromEntries(this.seats.map((s) => [s.id, payouts[s.id] ?? 0])),
      net: Object.fromEntries(this.seats.map((s) => [s.id, s.stack - s.startingStack])),
      finalStacks: Object.fromEntries(this.seats.map((s) => [s.id, s.stack])),
      pots,
      hands,
    };
    this.say(`=== Hand complete. Net: ${this.seats.map((s) => `${s.id} ${s.stack - s.startingStack >= 0 ? '+' : ''}${s.stack - s.startingStack}`).join(', ')} ===`);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private say(message: string): void {
    this.log.push(`[${this._street}] ${message}`);
  }

  /** "A: " / "B: " when there are two boards, nothing when there is one. */
  private boardLabel(index: number): string {
    return this.boards.length > 1 ? `${String.fromCharCode(65 + index)}: ` : '';
  }

  private snapshot(canSee: (seat: Seat) => boolean): HandState {
    const players: PlayerState[] = this.seats.map((s) => ({
      id: s.id, name: s.name, stack: s.stack, streetBet: s.streetBet, totalBet: s.totalBet,
      folded: s.folded, allIn: s.allIn, holeCount: s.hole.length, hole: canSee(s) ? [...s.hole] : null,
    }));
    return {
      phase: this._phase,
      street: this._street,
      boards: this.boards.map((b) => [...b]),
      pot: this.totalPot(),
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      toAct: this.currentActorId,
      button: this.seats[this.buttonIndex].id,
      players,
      pendingDiscards: Object.fromEntries(this.pendingDiscards),
      result: this.result,
    };
  }

  /** Chips can never be created or destroyed. If this throws, there is an engine bug. */
  private checkInvariants(): void {
    const inStacks = this.seats.reduce((sum, s) => sum + s.stack, 0);
    const inPot = this._phase === 'complete' ? 0 : this.totalPot();
    if (inStacks + inPot !== this.initialChips) {
      throw new Error(`BUG: chips not conserved (stacks ${inStacks} + pot ${inPot} != ${this.initialChips}).\n${this.dump()}\n${this.log.join('\n')}`);
    }
    for (const s of this.seats) {
      if (s.stack < 0) throw new Error(`BUG: ${s.id} has a negative stack.\n${this.dump()}`);
    }
  }
}
