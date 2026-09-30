import { randomBytes, randomUUID } from 'node:crypto';
import { Hand, resolveConfig, type Action, type Card, type HandConfig, type HandState, type PlayerSetup, type VariantId, type BettingStructure, type DiscardSchedule } from '../src/index.js';

export interface TableSettings {
  variant: VariantId;
  betting: BettingStructure;
  smallBlind: number;
  bigBlind: number;
  /** Legacy setting for older clients. New clients choose a stack when claiming a seat. */
  startingStack?: number;
  seatCount: number;
  turnTimerSeconds: number;
  discardSchedule?: DiscardSchedule;
  doubleBoard: boolean;
}

interface Seat {
  id: string;
  name: string;
  token: string;
  socketId: string | null;
  stack: number;
  initialStack: number;
  seatIndex: number | null;
  sittingOut: boolean;
  muted: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  stack: number;
  seatIndex: number | null;
  connected: boolean;
  sittingOut: boolean;
  muted: boolean;
  isHost: boolean;
}

export interface TableView {
  code: string;
  hostId: string;
  settings: TableSettings;
  players: PlayerView[];
  hand: HandState | null;
  legalActions: ReturnType<Hand['getLegalActions']>;
  paused: boolean;
  nextHandBombAnte: number | null;
  handNumber: number;
  handLog: string[];
}

interface Table {
  code: string;
  hostId: string;
  buttonId: string;
  settings: TableSettings;
  seats: Seat[];
  paused: boolean;
  nextHandBombAnte: number | null;
  handNumber: number;
  hand: Hand | null;
  timer: ReturnType<typeof setTimeout> | null;
  chat: { playerId: string; name: string; message: string; at: string }[];
}

export interface JoinResult { playerId: string; reconnectToken: string; table: TableView; }

export class TableManager {
  private readonly tables = new Map<string, Table>();
  private readonly socketTable = new Map<string, string>();
  private readonly onUpdate: (code: string) => void;
  private readonly onChat: (code: string, message: Table['chat'][number]) => void;

  constructor(onUpdate: (code: string) => void, onChat: (code: string, message: Table['chat'][number]) => void) {
    this.onUpdate = onUpdate;
    this.onChat = onChat;
  }

  createTable(socketId: string, name: string, settings: TableSettings, deferSeat = false): JoinResult {
    this.ensureUnseated(socketId);
    this.validateSettings(settings);
    const code = this.newCode();
    const playerId = randomUUID();
    const initialStack = deferSeat ? 0 : (settings.startingStack ?? 200);
    const seat: Seat = { id: playerId, name: this.cleanName(name), token: randomBytes(32).toString('base64url'), socketId, stack: initialStack, initialStack, seatIndex: deferSeat ? null : 0, sittingOut: deferSeat, muted: false };
    const table: Table = { code, hostId: playerId, buttonId: playerId, settings: structuredClone(settings), seats: [seat], paused: false, nextHandBombAnte: null, handNumber: 0, hand: null, timer: null, chat: [] };
    this.tables.set(code, table);
    this.socketTable.set(socketId, code);
    return { playerId, reconnectToken: seat.token, table: this.view(table, playerId) };
  }

  joinTable(socketId: string, code: string, name: string, deferSeat = false): JoinResult {
    this.ensureUnseated(socketId);
    const table = this.requireTable(code);
    if (table.seats.length >= table.settings.seatCount) throw new Error('This table is full.');
    if (table.seats.some((seat) => seat.name.toLowerCase() === this.cleanName(name).toLowerCase())) throw new Error('That display name is already seated.');
    const playerId = randomUUID();
    const seatIndex = deferSeat ? null : this.nextSeatIndex(table);
    const initialStack = deferSeat ? 0 : (table.settings.startingStack ?? 200);
    const seat: Seat = { id: playerId, name: this.cleanName(name), token: randomBytes(32).toString('base64url'), socketId, stack: initialStack, initialStack, seatIndex, sittingOut: deferSeat, muted: false };
    table.seats.push(seat);
    this.socketTable.set(socketId, code.toUpperCase());
    this.onUpdate(table.code);
    return { playerId, reconnectToken: seat.token, table: this.view(table, playerId) };
  }

  takeSeat(socketId: string, seatIndex: number, stack: number, sittingOut = false): void {
    const { table, seat } = this.requireSocketSeatTuple(socketId);
    if (table.hand && !table.hand.isComplete) throw new Error('Seats can only be changed between hands.');
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= table.settings.seatCount) throw new Error('Choose an available seat.');
    if (!Number.isSafeInteger(stack) || stack <= 0 || stack > 1_000_000_000) throw new Error('Stack must be a positive whole number.');
    const occupied = table.seats.find((entry) => entry.seatIndex === seatIndex && entry.id !== seat.id);
    if (occupied) throw new Error('That seat has already been taken.');
    seat.seatIndex = seatIndex;
    seat.stack = stack;
    seat.initialStack = stack;
    seat.sittingOut = Boolean(sittingOut);
    this.onUpdate(table.code);
  }

  standUp(socketId: string): void {
    const { table, seat } = this.requireSocketSeatTuple(socketId);
    if (table.hand && !table.hand.isComplete) throw new Error('You can stand up after the hand ends.');
    seat.seatIndex = null;
    seat.stack = 0;
    seat.initialStack = 0;
    seat.sittingOut = true;
    this.onUpdate(table.code);
  }

  reconnect(socketId: string, code: string, playerId: string, token: string): JoinResult {
    this.ensureUnseated(socketId);
    const table = this.requireTable(code);
    const seat = this.requireSeat(table, playerId);
    if (seat.token !== token) throw new Error('Reconnect token is invalid.');
    if (seat.socketId) this.socketTable.delete(seat.socketId);
    seat.socketId = socketId;
    this.socketTable.set(socketId, table.code);
    this.onUpdate(table.code);
    return { playerId, reconnectToken: seat.token, table: this.view(table, playerId) };
  }

  disconnect(socketId: string): string | null {
    const code = this.socketTable.get(socketId);
    if (!code) return null;
    this.socketTable.delete(socketId);
    const table = this.tables.get(code);
    const seat = table?.seats.find((entry) => entry.socketId === socketId);
    if (seat) seat.socketId = null;
    if (table && seat) this.onUpdate(table.code);
    return code;
  }

  viewForSocket(socketId: string): TableView {
    const table = this.requireSocketTable(socketId);
    const seat = this.requireSocketSeat(socketId, table);
    return this.view(table, seat.id);
  }

  startHand(socketId: string): void {
    const table = this.requireHostTable(socketId);
    if (table.paused) throw new Error('The table is paused.');
    if (table.hand && !table.hand.isComplete) throw new Error('The current hand is still in progress.');
    const players = table.seats.filter((seat) => !seat.sittingOut && seat.stack > 0);
    if (players.length < 2) throw new Error('At least two active players with chips are required.');
    const config: HandConfig = {
      variant: table.settings.variant, betting: table.settings.betting,
      smallBlind: table.settings.smallBlind, bigBlind: table.settings.bigBlind,
      discardSchedule: table.settings.discardSchedule, doubleBoard: table.settings.doubleBoard,
      ...(table.nextHandBombAnte === null ? {} : { bombPotAnte: table.nextHandBombAnte }),
    };
    table.nextHandBombAnte = null;
    const handPlayers: PlayerSetup[] = players.map((seat) => ({ id: seat.id, name: seat.name, stack: seat.stack }));
    const previousButtonIndex = handPlayers.findIndex((player) => player.id === table.buttonId);
    const hostIndex = handPlayers.findIndex((player) => player.id === table.hostId);
    const buttonIndex = previousButtonIndex < 0 ? Math.max(0, hostIndex) : (previousButtonIndex + 1) % handPlayers.length;
    table.buttonId = handPlayers[buttonIndex].id;
    table.hand = new Hand(config, handPlayers, buttonIndex);
    table.handNumber++;
    this.syncStacks(table);
    this.schedule(table);
    this.onUpdate(table.code);
  }

  act(socketId: string, action: Action): void {
    const { table, seat, hand } = this.requireActiveHand(socketId);
    hand.act(seat.id, action);
    this.afterMutation(table);
  }

  discard(socketId: string, cards: Card[]): void {
    const { table, seat, hand } = this.requireActiveHand(socketId);
    if (!Array.isArray(cards) || cards.length > 5 || cards.some((card) => typeof card !== 'string')) throw new Error('Invalid discard selection.');
    hand.discard(seat.id, cards);
    this.afterMutation(table);
  }

  updateSettings(socketId: string, changes: Partial<TableSettings>): void {
    const table = this.requireHostTable(socketId);
    if (table.hand && !table.hand.isComplete) throw new Error('Settings can only change between hands.');
    const allowed = new Set(['variant', 'betting', 'smallBlind', 'bigBlind', 'seatCount', 'turnTimerSeconds', 'discardSchedule', 'doubleBoard']);
    if (!changes || typeof changes !== 'object' || Object.keys(changes).some((key) => !allowed.has(key))) throw new Error('Settings contain an unsupported field.');
    const updated = { ...table.settings, ...changes };
    this.validateSettings(updated);
    if (updated.seatCount < table.seats.filter((seat) => seat.seatIndex !== null).length) throw new Error('Seat count cannot be lower than the number of seated players.');
    table.settings = updated;
    this.onUpdate(table.code);
  }

  kick(socketId: string, playerId: string): string {
    const table = this.requireHostTable(socketId);
    if (playerId === table.hostId) throw new Error('The host cannot kick themselves.');
    const seat = this.requireSeat(table, playerId);
    if (table.hand && !table.hand.isComplete) throw new Error('Players can only be kicked between hands.');
    if (seat.socketId) this.socketTable.delete(seat.socketId);
    table.seats = table.seats.filter((entry) => entry.id !== playerId);
    this.onUpdate(table.code);
    return seat.socketId ?? '';
  }

  setMuted(socketId: string, playerId: string, muted: boolean): void {
    const table = this.requireHostTable(socketId);
    this.requireSeat(table, playerId).muted = muted;
    this.onUpdate(table.code);
  }

  setPaused(socketId: string, paused: boolean): void {
    const table = this.requireHostTable(socketId);
    table.paused = paused;
    if (paused) this.clearTimer(table); else this.schedule(table);
    this.onUpdate(table.code);
  }

  topUp(socketId: string, playerId: string, amount: number): void {
    const table = this.requireHostTable(socketId);
    if (table.hand && !table.hand.isComplete) throw new Error('Stacks can only be topped up between hands.');
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) throw new Error('Top-up must be a positive whole number.');
    const seat = this.requireSeat(table, playerId);
    seat.stack += amount;
    this.onUpdate(table.code);
  }

  resetStacks(socketId: string): void {
    const table = this.requireHostTable(socketId);
    if (table.hand && !table.hand.isComplete) throw new Error('Stacks can only be reset between hands.');
    table.seats.forEach((seat) => { if (seat.seatIndex !== null) seat.stack = seat.initialStack; });
    this.onUpdate(table.code);
  }

  triggerBombPot(socketId: string, ante: number): void {
    const table = this.requireHostTable(socketId);
    if (!Number.isSafeInteger(ante) || ante <= 0 || ante > 1_000_000_000) throw new Error('Bomb pot ante must be a positive whole number.');
    table.nextHandBombAnte = ante;
    this.onUpdate(table.code);
  }

  setSittingOut(socketId: string, sittingOut: boolean): void {
    const { table, seat } = this.requireSocketSeatTuple(socketId);
    if (table.hand && !table.hand.isComplete) throw new Error('You can sit out between hands.');
    if (seat.seatIndex === null) throw new Error('Choose a seat before changing your away status.');
    seat.sittingOut = sittingOut;
    this.onUpdate(table.code);
  }

  transferHost(socketId: string, newHostId: string): void {
    const table = this.requireHostTable(socketId);
    const newHost = this.requireSeat(table, newHostId);
    table.hostId = newHost.id;
    this.onUpdate(table.code);
  }

  leave(socketId: string): string {
    const { table, seat } = this.requireSocketSeatTuple(socketId);
    if (table.hand && !table.hand.isComplete) throw new Error('You can leave after the hand ends.');
    if (seat.id === table.hostId && table.seats.length > 1) {
      const nextHost = table.seats.find((s) => s.id !== seat.id);
      if (nextHost) table.hostId = nextHost.id;
    }
    table.seats = table.seats.filter((entry) => entry.id !== seat.id);
    this.socketTable.delete(socketId);
    if (!table.seats.length) { this.clearTimer(table); this.tables.delete(table.code); }
    else this.onUpdate(table.code);
    return table.code;
  }

  sendChat(socketId: string, raw: unknown): void {
    const { table, seat } = this.requireSocketSeatTuple(socketId);
    if (seat.muted) throw new Error('You are muted at this table.');
    if (typeof raw !== 'string') throw new Error('Chat message must be text.');
    const message = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 300);
    if (!message) throw new Error('Chat message cannot be empty.');
    const event = { playerId: seat.id, name: seat.name, message, at: new Date().toISOString() };
    table.chat.push(event);
    if (table.chat.length > 100) table.chat.shift();
    this.onChat(table.code, event);
  }

  private afterMutation(table: Table): void {
    this.syncStacks(table);
    this.schedule(table);
    this.onUpdate(table.code);
  }

  private syncStacks(table: Table): void {
    if (!table.hand) return;
    const state = table.hand.getFullState();
    for (const player of state.players) {
      const seat = table.seats.find((entry) => entry.id === player.id);
      if (seat) seat.stack = player.stack;
    }
  }

  private schedule(table: Table): void {
    this.clearTimer(table);
    const hand = table.hand;
    if (!hand || hand.isComplete || table.paused) return;
    const delay = table.settings.turnTimerSeconds * 1000;
    table.timer = setTimeout(() => {
      try {
        if (hand.phase === 'betting') {
          const legal = hand.getLegalActions();
          if (legal) hand.act(legal.playerId, hand.defaultAction());
        } else if (hand.phase === 'discarding') {
          const pending = Object.keys(hand.getFullState().pendingDiscards);
          for (const id of pending) hand.autoDiscard(id);
        }
        this.afterMutation(table);
      } catch { this.schedule(table); }
    }, delay);
    table.timer.unref?.();
  }

  private clearTimer(table: Table): void { if (table.timer) clearTimeout(table.timer); table.timer = null; }

  private view(table: Table, playerId: string): TableView {
    const hand = table.hand;
    const legal = hand?.getLegalActions() ?? null;
    const state = hand ? hand.getViewFor(playerId) : null;
    return {
      code: table.code, hostId: table.hostId, settings: structuredClone(table.settings),
      players: table.seats.map((seat) => ({ id: seat.id, name: seat.name, stack: seat.stack, seatIndex: seat.seatIndex, connected: seat.socketId !== null, sittingOut: seat.sittingOut, muted: seat.muted, isHost: seat.id === table.hostId })),
      hand: state, legalActions: legal?.playerId === playerId ? legal : null, paused: table.paused,
      nextHandBombAnte: table.nextHandBombAnte, handNumber: table.handNumber,
      handLog: hand?.isComplete ? [...hand.log] : [],
    };
  }

  private requireActiveHand(socketId: string): { table: Table; seat: Seat; hand: Hand } {
    const { table, seat } = this.requireSocketSeatTuple(socketId);
    if (table.paused) throw new Error('The table is paused.');
    if (!table.hand || table.hand.isComplete) throw new Error('There is no active hand.');
    return { table, seat, hand: table.hand };
  }

  private requireSocketSeatTuple(socketId: string): { table: Table; seat: Seat } {
    const table = this.requireSocketTable(socketId);
    return { table, seat: this.requireSocketSeat(socketId, table) };
  }

  private requireSocketTable(socketId: string): Table {
    const code = this.socketTable.get(socketId);
    if (!code) throw new Error('Join a table first.');
    return this.requireTable(code);
  }

  private requireSocketSeat(socketId: string, table: Table): Seat {
    const seat = table.seats.find((entry) => entry.socketId === socketId);
    if (!seat) throw new Error('Your seat is no longer connected.');
    return seat;
  }

  private requireHostTable(socketId: string): Table {
    const { table, seat } = this.requireSocketSeatTuple(socketId);
    if (seat.id !== table.hostId) throw new Error('Only the host can do that.');
    return table;
  }

  private requireSeat(table: Table, playerId: string): Seat {
    const seat = table.seats.find((entry) => entry.id === playerId);
    if (!seat) throw new Error('Player is not seated at this table.');
    return seat;
  }

  private requireTable(code: string): Table {
    const table = this.tables.get(code.toUpperCase());
    if (!table) throw new Error('Table code was not found.');
    return table;
  }

  private ensureUnseated(socketId: string): void {
    if (this.socketTable.has(socketId)) throw new Error('Leave your current table before joining another.');
  }

  private nextSeatIndex(table: Table): number | null {
    const occupied = new Set(table.seats.map((seat) => seat.seatIndex).filter((index): index is number => index !== null));
    for (let i = 0; i < table.settings.seatCount; i++) if (!occupied.has(i)) return i;
    return null;
  }

  private cleanName(name: string): string {
    if (typeof name !== 'string') throw new Error('Display name must be text.');
    const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
    if (clean.length < 1) throw new Error('Display name must contain 1 to 24 characters.');
    return clean;
  }

  private validateSettings(settings: TableSettings): void {
    if (!settings || !['holdem', 'texas3', 'plo4', 'plo5', 'pineapple3', 'pineapple4', 'pineapple5'].includes(settings.variant)) throw new Error('Choose a supported poker variant.');
    if (!['nolimit', 'potlimit'].includes(settings.betting)) throw new Error('Choose no-limit or pot-limit betting.');
    for (const [label, value, max] of [['Small blind', settings.smallBlind, 1_000_000], ['Big blind', settings.bigBlind, 1_000_000]] as const) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new Error(`${label} must be a positive whole number.`);
    }
    if (settings.startingStack !== undefined && (!Number.isSafeInteger(settings.startingStack) || settings.startingStack <= 0 || settings.startingStack > 1_000_000_000)) throw new Error('Legacy starting stack must be a positive whole number.');
    if (settings.bigBlind < settings.smallBlind) throw new Error('Big blind cannot be smaller than the small blind.');
    if (!Number.isInteger(settings.seatCount) || settings.seatCount < 2 || settings.seatCount > 9) throw new Error('Seat count must be between 2 and 9.');
    if (!Number.isInteger(settings.turnTimerSeconds) || settings.turnTimerSeconds < 5 || settings.turnTimerSeconds > 300) throw new Error('Turn timer must be between 5 and 300 seconds.');
    if (['plo4', 'plo5'].includes(settings.variant) && settings.betting !== 'potlimit') throw new Error('PLO variants always use pot-limit betting.');
    if (settings.discardSchedule && typeof settings.discardSchedule !== 'object') throw new Error('Discard schedule must be an object.');
    if (typeof settings.doubleBoard !== 'boolean') throw new Error('Double board must be enabled or disabled.');
    // Validate rules now; the real player count and corresponding deck limit are checked when a hand starts.
    resolveConfig({ variant: settings.variant, betting: settings.betting, smallBlind: settings.smallBlind, bigBlind: settings.bigBlind, discardSchedule: settings.discardSchedule, doubleBoard: settings.doubleBoard }, 2);
  }

  private newCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do { code = Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join(''); } while (this.tables.has(code));
    return code;
  }
}
