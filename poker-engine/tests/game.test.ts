import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Hand } from '../src/game.js';
import { HandError } from '../src/types.js';
import { cfg, players, play, rig } from './helpers.js';

/** Everybody checks (or calls) until the hand ends. */
function checkDown(hand: Hand): void {
  while (!hand.isComplete) {
    const legal = hand.getLegalActions()!;
    hand.act(legal.playerId, legal.canCheck ? { type: 'check' } : { type: 'call' });
  }
}

const SPLIT_BOARD = '2c 7d 9h Js 3c'; // a dry board: no straights or flushes

describe('blinds, positions and simple endings', () => {
  test('heads-up: button is the small blind and acts first; folding gives the blind away', () => {
    const hand = new Hand(cfg(), players(100, 100), 0);
    assert.equal(hand.currentActorId, 'p0');
    hand.act('p0', { type: 'fold' });
    const result = hand.getResult()!;
    assert.equal(result.reason, 'fold');
    assert.deepEqual(result.net, { p0: -1, p1: 1 });
  });

  test('3 players: blinds are left of the button and the player after the big blind acts first', () => {
    const hand = new Hand(cfg(), players(100, 100, 100), 0);
    const state = hand.getFullState();
    assert.equal(state.players[1].streetBet, 1); // small blind
    assert.equal(state.players[2].streetBet, 2); // big blind
    assert.equal(hand.currentActorId, 'p0');
    assert.equal(hand.getLegalActions()!.toCall, 2);
    assert.equal(state.pot, 3);
  });

  test('the big blind gets an option to raise after everyone calls', () => {
    const hand = new Hand(cfg(), players(100, 100, 100), 0);
    play(hand, [['p0', { type: 'call' }], ['p1', { type: 'call' }]]);
    assert.equal(hand.currentActorId, 'p2');
    assert.equal(hand.getLegalActions()!.canCheck, true);
    hand.act('p2', { type: 'check' });
    assert.equal(hand.street, 'flop');
  });

  test('check-down to showdown pays the best hand', () => {
    const deck = rig(['As Ah', 'Kd Kc'], SPLIT_BOARD);
    const hand = new Hand(cfg({ deck }), players(100, 100), 0);
    checkDown(hand);
    const result = hand.getResult()!;
    assert.equal(result.reason, 'showdown');
    assert.deepEqual(result.net, { p0: 2, p1: -2 });
    assert.equal(result.hands.p0.perBoard[0].name, 'Pair of Aces');
    assert.equal(result.hands.p1.perBoard[0].name, 'Pair of Kings');
  });

  test('a split pot gives each winner half', () => {
    const deck = rig(['As Kd', 'Ah Kc'], SPLIT_BOARD);
    const hand = new Hand(cfg({ deck }), players(100, 100), 0);
    checkDown(hand);
    assert.deepEqual(hand.getResult()!.net, { p0: 0, p1: 0 });
  });

  test('uncalled bets are returned', () => {
    const hand = new Hand(cfg(), players(100, 100), 0);
    play(hand, [['p0', { type: 'raise', to: 10 }], ['p1', { type: 'fold' }]]);
    const result = hand.getResult()!;
    assert.deepEqual(result.net, { p0: 2, p1: -2 });
    assert.deepEqual(result.finalStacks, { p0: 102, p1: 98 });
    assert.ok(hand.log.some((line) => line.includes('uncalled')));
  });
});

describe('betting rules', () => {
  test('acting out of turn or with an illegal action throws HandError', () => {
    const hand = new Hand(cfg(), players(100, 100, 100), 0);
    assert.throws(() => hand.act('p1', { type: 'call' }), /turn/);
    assert.throws(() => hand.act('p0', { type: 'check' }), /cannot check/);
    assert.throws(() => hand.act('p0', { type: 'raise', to: 3 }), (e: unknown) => e instanceof HandError && /minimum is 4/.test(e.message));
    assert.throws(() => hand.discard('p0', ['As']), /No discards/);
  });

  test('minimum raise follows the size of the previous raise', () => {
    const hand = new Hand(cfg(), players(200, 200, 200), 0);
    hand.act('p0', { type: 'raise', to: 4 });
    assert.equal(hand.getLegalActions()!.minRaiseTo, 6); // 4 + raise of 2
    hand.act('p1', { type: 'raise', to: 14 }); // raise of 10
    assert.equal(hand.getLegalActions()!.minRaiseTo, 24); // 14 + the last raise of 10
  });

  test('cannot raise more than your stack', () => {
    const hand = new Hand(cfg(), players(50, 100, 100), 0);
    assert.throws(() => hand.act('p0', { type: 'raise', to: 60 }), /maximum is 50/);
  });

  test('pot-limit caps raises at the size of the pot after calling', () => {
    const hand = new Hand(cfg({ betting: 'potlimit' }), players(1000, 1000, 1000), 0);
    const legal = hand.getLegalActions()!;
    assert.equal(legal.maxRaiseTo, 7); // pot 3 + call 2 = 5, on top of the bet of 2
    assert.throws(() => hand.act('p0', { type: 'raise', to: 8 }), /maximum is 7/);
    hand.act('p0', { type: 'raise', to: 7 });
    // p1 (small blind, 1 in): pot is 10, call costs 6 -> pot after call 16, on top of 7 = 23
    assert.equal(hand.getLegalActions()!.maxRaiseTo, 23);
  });

  test('PLO is always pot-limit', () => {
    assert.equal(new Hand(cfg({ variant: 'plo4' }), players(100, 100), 0).config.betting, 'potlimit');
    assert.throws(() => new Hand(cfg({ variant: 'plo4', betting: 'nolimit' }), players(100, 100)), /always potlimit/);
  });

  test('a short all-in does not reopen the betting for players who already acted', () => {
    // Bomb pot so we control stacks: p2 has only 8 chips left after the ante.
    const hand = new Hand(cfg({ bombPotAnte: 2 }), players(100, 100, 10), 0);
    assert.equal(hand.currentActorId, 'p1');
    hand.act('p1', { type: 'raise', to: 6 }); // opens for 6
    hand.act('p2', { type: 'allin' }); // all-in for 8 total: a raise of only 2 (< 6)
    hand.act('p0', { type: 'call' });
    assert.equal(hand.currentActorId, 'p1'); // p1 must respond to the extra 2...
    assert.equal(hand.getLegalActions()!.canRaise, false); // ...but may not re-raise
    assert.throws(() => hand.act('p1', { type: 'raise', to: 20 }), /cannot raise/);
    hand.act('p1', { type: 'call' });
    assert.equal(hand.street, 'turn');
  });

  test('all-in players side pots: main pot and side pot go to different winners', () => {
    const deck = rig(['Kh Kd', 'Ah Ad', 'Qh Qd'], '2c 3d 7h 9s Jc');
    const hand = new Hand(cfg({ deck }), players(100, 30, 200), 0);
    hand.act('p0', { type: 'allin' });
    hand.act('p1', { type: 'allin' }); // 30 total: an all-in call
    hand.act('p2', { type: 'call' });
    assert.ok(hand.isComplete, 'nobody can bet any more, so the board runs out to showdown');
    const result = hand.getResult()!;
    assert.deepEqual(result.pots.map((p) => [p.amount, p.eligible]), [[90, ['p0', 'p1', 'p2']], [140, ['p0', 'p2']]]);
    assert.deepEqual(result.net, { p0: 40, p1: 60, p2: -100 });
  });

  test('timer helpers: check when free, fold when facing a bet', () => {
    const hand = new Hand(cfg(), players(100, 100), 0);
    assert.deepEqual(hand.defaultAction(), { type: 'fold' }); // small blind faces the big blind
    hand.act('p0', { type: 'call' });
    assert.deepEqual(hand.defaultAction(), { type: 'check' }); // big blind has the option
  });
});

describe('Pineapple discards', () => {
  const holes = ['As Ah Kc 2d', 'Ks Kd 7c 3h'];
  const board = '4c 8d Tc 9h Qs';

  test('4-card pineapple: discard one after the flop, bet, discard one after the turn, bet', () => {
    const hand = new Hand(cfg({ variant: 'pineapple4', deck: rig(holes, board) }), players(100, 100), 0);
    play(hand, [['p0', { type: 'call' }], ['p1', { type: 'check' }]]);

    // Flop is dealt, then everybody discards BEFORE flop betting.
    assert.equal(hand.phase, 'discarding');
    assert.equal(hand.street, 'flop');
    assert.equal(hand.getFullState().boards[0].length, 3);
    assert.deepEqual(hand.getFullState().pendingDiscards, { p0: 1, p1: 1 });
    assert.throws(() => hand.act('p1', { type: 'check' }), /No betting action/);
    assert.throws(() => hand.discard('p0', ['Ks']), /does not hold/);
    assert.throws(() => hand.discard('p0', ['Kc', '2d']), /exactly 1/);

    hand.discard('p0', ['Kc']);
    assert.throws(() => hand.discard('p0', ['2d']), /no discard/);
    hand.discard('p1', ['7c']);
    assert.equal(hand.phase, 'betting');
    assert.equal(hand.currentActorId, 'p1');
    play(hand, [['p1', { type: 'check' }], ['p0', { type: 'check' }]]);

    // Turn is dealt, second discard.
    assert.equal(hand.phase, 'discarding');
    assert.equal(hand.street, 'turn');
    hand.discard('p0', ['2d']);
    hand.discard('p1', ['3h']);
    assert.deepEqual(hand.getFullState().players.map((p) => p.holeCount), [2, 2]);
    checkDown(hand);

    const result = hand.getResult()!;
    assert.deepEqual(result.net, { p0: 2, p1: -2 });
    assert.equal(result.hands.p0.perBoard[0].name, 'Pair of Aces');
    assert.deepEqual(result.hands.p0.hole, ['As', 'Ah']); // discarded cards never reach showdown
  });

  test('classic 3-card pineapple discards after preflop betting, BEFORE the flop is dealt', () => {
    const hand = new Hand(cfg({ variant: 'pineapple3' }), players(100, 100), 0);
    play(hand, [['p0', { type: 'call' }], ['p1', { type: 'check' }]]);
    assert.equal(hand.phase, 'discarding');
    assert.equal(hand.getFullState().boards[0].length, 0);
    hand.autoDiscard('p0');
    hand.autoDiscard('p1');
    assert.equal(hand.phase, 'betting');
    assert.equal(hand.getFullState().boards[0].length, 3);
  });

  test('custom schedule: all 3 discards of a 5-card pineapple on the river', () => {
    const hand = new Hand(cfg({ variant: 'pineapple5', discardSchedule: { river: 3 } }), players(100, 100), 0);
    checkDown2(hand, 'river');
    assert.equal(hand.phase, 'discarding');
    assert.deepEqual(hand.getFullState().pendingDiscards, { p0: 3, p1: 3 });
    hand.autoDiscard('p0');
    hand.autoDiscard('p1');
    checkDown(hand);
    assert.ok(hand.isComplete);
  });

  test('folded players do not have to discard', () => {
    const hand = new Hand(cfg({ variant: 'pineapple3' }), players(100, 100, 100), 0);
    play(hand, [['p0', { type: 'call' }], ['p1', { type: 'fold' }], ['p2', { type: 'check' }]]);
    assert.deepEqual(hand.getFullState().pendingDiscards, { p0: 1, p2: 1 });
  });

  test('bad schedules are rejected with a helpful message', () => {
    assert.throws(() => new Hand(cfg({ variant: 'pineapple4', discardSchedule: { flop: 1 } }), players(100, 100)), /exactly 2 discard/);
    assert.throws(() => new Hand(cfg({ variant: 'holdem', discardSchedule: { flop: 1 } }), players(100, 100)), /exactly 0 discard/);
    assert.throws(() => new Hand(cfg({ variant: 'pineapple3', discardSchedule: { river2: 1 } as never }), players(100, 100)), /Unknown discard point/);
  });
});

/** Check down until the given street has been dealt (and any discards are pending). */
function checkDown2(hand: Hand, untilStreet: string): void {
  while (hand.phase === 'betting' && hand.street !== untilStreet) {
    const legal = hand.getLegalActions()!;
    hand.act(legal.playerId, legal.canCheck ? { type: 'check' } : { type: 'call' });
  }
}

describe('bomb pots', () => {
  test('everyone antes, preflop is skipped, and betting starts on the flop left of the button', () => {
    const hand = new Hand(cfg({ bombPotAnte: 5, deck: rig(['As Ad', 'Ks Kd', 'Qs Qd'], SPLIT_BOARD) }), players(100, 100, 100), 0);
    const state = hand.getFullState();
    assert.equal(state.pot, 15);
    assert.equal(state.street, 'flop');
    assert.equal(state.boards[0].length, 3);
    assert.equal(state.currentBet, 0);
    assert.equal(hand.currentActorId, 'p1');
    checkDown(hand);
    assert.deepEqual(hand.getResult()!.net, { p0: 10, p1: -5, p2: -5 });
  });

  test('a short stack goes all-in for the ante', () => {
    const hand = new Hand(cfg({ bombPotAnte: 5 }), players(100, 100, 3), 0);
    const state = hand.getFullState();
    assert.equal(state.pot, 13);
    assert.equal(state.players[2].allIn, true);
  });

  test('works with pineapple: discards happen on the flop, no preflop discard point is missed', () => {
    const hand = new Hand(cfg({ variant: 'pineapple4', bombPotAnte: 5 }), players(100, 100), 0);
    assert.equal(hand.phase, 'discarding');
    assert.equal(hand.street, 'flop');
  });

  test('bomb pot ante must be a positive whole number', () => {
    assert.throws(() => new Hand(cfg({ bombPotAnte: 0 }), players(100, 100)), /Bomb pot ante/);
  });
});

describe('double board', () => {
  const holes2 = ['As Ad', 'Ks Kd'];

  test('pot is split: one player wins board A, the other wins board B', () => {
    const board = '2c 7d 9h Kh 5c 8d 3s Jc 4d Th'; // flopA flopB turnA turnB riverA riverB
    const hand = new Hand(cfg({ bombPotAnte: 10, doubleBoard: true, deck: rig(holes2, board) }), players(100, 100), 0);
    assert.equal(hand.getFullState().boards.length, 2);
    checkDown(hand);
    const result = hand.getResult()!;
    assert.deepEqual(result.pots[0].boards.map((b) => b.winners), [['p0'], ['p1']]);
    assert.deepEqual(result.net, { p0: 0, p1: 0 });
    assert.equal(result.hands.p1.perBoard[1].name, 'Three of a Kind, Kings');
  });

  test('scoop: winning both boards wins the whole pot', () => {
    const board = '2c 7d 9h 2h 6d Qc 3s 3d 4d Th';
    const hand = new Hand(cfg({ bombPotAnte: 10, doubleBoard: true, deck: rig(holes2, board) }), players(100, 100), 0);
    checkDown(hand);
    assert.deepEqual(hand.getResult()!.net, { p0: 10, p1: -10 });
  });

  test('odd chip goes to board A', () => {
    const board = '2c 7d 9h Kh 5c 8d 3s Jc 4d Th';
    const deck = rig([...holes2, 'Qc Jd'], board);
    const hand = new Hand(cfg({ bombPotAnte: 5, doubleBoard: true, deck }), players(100, 100, 100), 0);
    checkDown(hand);
    // pot 15 -> board A gets 8 (p0 wins), board B gets 7 (p1 wins)
    assert.deepEqual(hand.getResult()!.net, { p0: 3, p1: 2, p2: -5 });
  });

  test('normal (non-bomb) hands can use double board too', () => {
    const board = '2c 7d 9h Kh 5c 8d 3s Jc 4d Th';
    const hand = new Hand(cfg({ doubleBoard: true, deck: rig(holes2, board) }), players(100, 100), 0);
    checkDown(hand);
    assert.deepEqual(hand.getResult()!.net, { p0: 0, p1: 0 });
  });

  test('too many cards for the deck is rejected', () => {
    const nine = players(...Array(9).fill(100));
    assert.throws(() => new Hand(cfg({ variant: 'plo5', doubleBoard: true }), nine), /Not enough cards/);
    assert.doesNotThrow(() => new Hand(cfg({ variant: 'plo5' }), nine)); // single board: 45 + 5 = 50 cards
  });
});

describe('Omaha and 3-card Texas at showdown', () => {
  test('PLO: a player cannot play the board, they must use exactly 2 hole cards', () => {
    // The board is a straight (5-6-7-8-9), but neither player can "play the board" in Omaha.
    const deck = rig(['2c 2d 3h 3s', 'Ah Kd Qc 8s'], '5s 6h 7d 8c 9s');
    const hand = new Hand(cfg({ variant: 'plo4', deck }), players(100, 100), 0);
    checkDown(hand);
    const result = hand.getResult()!;
    assert.equal(result.hands.p0.perBoard[0].name, 'Pair of Threes');
    assert.equal(result.hands.p1.perBoard[0].name, 'Pair of Eights');
    assert.deepEqual(result.net, { p0: -2, p1: 2 });
  });

  test('3-card Texas: uses all 8 cards', () => {
    const deck = rig(['As Ah Ad', 'Ks Kh Kd'], '2c 7d 9h Js 3c');
    const hand = new Hand(cfg({ variant: 'texas3', deck }), players(100, 100), 0);
    checkDown(hand);
    const result = hand.getResult()!;
    assert.equal(result.hands.p0.perBoard[0].name, 'Three of a Kind, Aces');
    assert.deepEqual(result.net, { p0: 2, p1: -2 });
  });
});

describe('what each player is allowed to see', () => {
  test('hole cards of other players are hidden until showdown', () => {
    const hand = new Hand(cfg({ deck: rig(['As Ah', 'Kd Kc'], SPLIT_BOARD) }), players(100, 100), 0);
    const mine = hand.getViewFor('p0');
    assert.deepEqual(mine.players[0].hole, ['As', 'Ah']);
    assert.equal(mine.players[1].hole, null);
    assert.equal(mine.players[1].holeCount, 2);
    assert.equal(hand.getViewFor(null).players[0].hole, null);
    checkDown(hand);
    assert.deepEqual(hand.getViewFor(null).players[1].hole, ['Kd', 'Kc']);
  });

  test('folded hands stay hidden even after the hand ends', () => {
    const hand = new Hand(cfg({ deck: rig(['As Ah', 'Kd Kc'], SPLIT_BOARD) }), players(100, 100), 0);
    hand.act('p0', { type: 'fold' });
    assert.equal(hand.getViewFor(null).players[0].hole, null);
  });
});

describe('config validation', () => {
  test('bad tables and blinds are rejected', () => {
    assert.throws(() => new Hand(cfg(), players(100)), /at least 2/);
    assert.throws(() => new Hand(cfg(), [{ id: 'a', stack: 10 }, { id: 'a', stack: 10 }]), /unique/);
    assert.throws(() => new Hand(cfg(), players(100, 0)), /positive/);
    assert.throws(() => new Hand(cfg({ smallBlind: 5, bigBlind: 2 }), players(100, 100)), /Big blind/);
    assert.throws(() => new Hand(cfg(), players(100, 100), 5), /Button index/);
  });
});
