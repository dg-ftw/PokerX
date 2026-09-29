import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestHand, evaluateFive, Category, combinations } from '../src/evaluator.js';
import { parseCards, createDeck, shuffle } from '../src/cards.js';
import { makeRng } from '../scripts/rng.js';

const five = (text: string) => evaluateFive(parseCards(text));

test('deck has 52 unique cards and shuffle keeps them', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
  const shuffled = shuffle(deck, makeRng(1));
  assert.deepEqual([...shuffled].sort(), [...deck].sort());
  assert.notDeepEqual(shuffled, deck);
});

test('invalid cards are rejected', () => {
  assert.throws(() => parseCards('Ax'), /Invalid card/);
  assert.throws(() => parseCards('1s'), /Invalid card/);
});

test('every category is recognised with a readable name', () => {
  assert.equal(five('As Ks Qs Js Ts').name, 'Royal Flush');
  assert.equal(five('9h 8h 7h 6h 5h').name, 'Straight Flush, Nine high');
  assert.equal(five('7s 7h 7d 7c 2s').name, 'Four of a Kind, Sevens');
  assert.equal(five('Ks Kh Kd 4c 4s').name, 'Full House, Kings full of Fours');
  assert.equal(five('As 9s 7s 4s 2s').name, 'Flush, Ace high');
  assert.equal(five('9s 8h 7d 6c 5s').name, 'Straight, Nine high');
  assert.equal(five('6s 6h 6d Kc 2s').name, 'Three of a Kind, Sixes');
  assert.equal(five('Js Jh 3d 3c 9s').name, 'Two Pair, Jacks and Threes');
  assert.equal(five('Qs Qh 8d 3c 2s').name, 'Pair of Queens');
  assert.equal(five('As Jh 8d 5c 2s').name, 'High Card, Ace');
});

test('categories rank in the right order', () => {
  const ladder = [
    'As Jh 8d 5c 2s', 'Qs Qh 8d 3c 2s', 'Js Jh 3d 3c 9s', '6s 6h 6d Kc 2s', '9s 8h 7d 6c 5s',
    'As 9s 7s 4s 2s', 'Ks Kh Kd 4c 4s', '7s 7h 7d 7c 2s', '9h 8h 7h 6h 5h',
  ].map(five);
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i].score > ladder[i - 1].score, `${ladder[i].name} > ${ladder[i - 1].name}`);
  assert.deepEqual(ladder.map((h) => h.category), Object.values(Category));
});

test('kickers decide between equal categories', () => {
  assert.ok(five('As Ah Kd 5c 2s').score > five('Ad Ac Qd 5h 2c').score); // pair of aces, K vs Q kicker
  assert.ok(five('Ks Kh Kd 4c 4s').score > five('Qs Qh Qd Ac As').score); // full house: trips rank first
  assert.equal(five('As Ah Kd 5c 2s').score, five('Ad Ac Kh 5d 2h').score); // suits never matter
});

test('the wheel (A-2-3-4-5) is the lowest straight; six-high beats it', () => {
  const wheel = five('As 2h 3d 4c 5s');
  assert.equal(wheel.name, 'Straight, Five high');
  assert.ok(five('2s 3h 4d 5c 6s').score > wheel.score);
  assert.ok(wheel.score > five('Ks Kh Kd 4c 2s').score);
  // No wrap-around straights like Q-K-A-2-3.
  assert.notEqual(five('Qs Kh Ad 2c 3s').category, Category.Straight);
});

test('combinations counts', () => {
  assert.equal(combinations([1, 2, 3, 4, 5, 6, 7], 5).length, 21);
  assert.equal(combinations(Array.from({ length: 8 }, (_, i) => i), 5).length, 56);
});

test("Hold'em: best 5 of 7, and playing the board is allowed", () => {
  const hand = bestHand('any', parseCards('As Ah'), parseCards('Ad Kc 2s 7h 9d'));
  assert.equal(hand.name, 'Three of a Kind, Aces');
  const boardPlays = bestHand('any', parseCards('2c 3d'), parseCards('As Ks Qs Js Ts'));
  assert.equal(boardPlays.name, 'Royal Flush');
});

test('3-card Texas: best 5 of the 8 cards (3 hole + 5 board)', () => {
  const hand = bestHand('any', parseCards('As Ah Ad'), parseCards('Ac Kc 2s 7h 9d'));
  assert.equal(hand.name, 'Four of a Kind, Aces');
});

test('Omaha: must use exactly 2 hole cards and 3 board cards', () => {
  // Board has four spades; one spade in hand is NOT a flush in Omaha (needs two hole spades)...
  const noFlush = bestHand('omaha', parseCards('As 2d 3c 4h'), parseCards('Ks Qs Js 9s 2c'));
  assert.notEqual(noFlush.category, Category.Flush);
  // ...but in Hold'em the same cards ARE a flush.
  const holdemFlush = bestHand('any', parseCards('As 2d'), parseCards('Ks Qs Js 9s 2c'));
  assert.equal(holdemFlush.category, Category.Flush);
  // Two hole spades + three board spades is a flush.
  const flush = bestHand('omaha', parseCards('As 2s 3c 4h'), parseCards('Ks Qs Js 9d 2c'));
  assert.equal(flush.name, 'Flush, Ace high');
  // A straight on the board can't be played by 1 hole card + 4 board cards.
  const boardStraight = bestHand('omaha', parseCards('2c 2d Kh Kd'), parseCards('5s 6h 7d 8c 9s'));
  assert.notEqual(boardStraight.category, Category.Straight);
});
