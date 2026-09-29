import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPots } from '../src/pots.js';
import { awardPots, splitEvenly } from '../src/showdown.js';
import { parseCards } from '../src/cards.js';

test('one pot when everybody put in the same amount', () => {
  const pots = buildPots([
    { id: 'a', totalBet: 50, folded: false },
    { id: 'b', totalBet: 50, folded: false },
    { id: 'c', totalBet: 50, folded: true },
  ]);
  assert.deepEqual(pots, [{ amount: 150, eligible: ['a', 'b'] }]);
});

test('short all-in creates a main pot and a side pot', () => {
  const pots = buildPots([
    { id: 'a', totalBet: 100, folded: false },
    { id: 'b', totalBet: 30, folded: false },
    { id: 'c', totalBet: 100, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 90, eligible: ['a', 'b', 'c'] },
    { amount: 140, eligible: ['a', 'c'] },
  ]);
});

test('money from folded players stays in the pot but they cannot win it', () => {
  const pots = buildPots([
    { id: 'a', totalBet: 100, folded: true },
    { id: 'b', totalBet: 50, folded: false },
    { id: 'c', totalBet: 100, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 150, eligible: ['b', 'c'] },
    { amount: 100, eligible: ['c'] },
  ]);
  assert.equal(pots.reduce((s, p) => s + p.amount, 0), 250);
});

test('splitEvenly hands odd chips to the first parts', () => {
  assert.deepEqual(splitEvenly(15, 2), [8, 7]);
  assert.deepEqual(splitEvenly(10, 3), [4, 3, 3]);
  assert.deepEqual(splitEvenly(9, 1), [9]);
});

test('awardPots: ties split, odd chip goes closest to the left of the button', () => {
  const result = awardPots({
    pots: [{ amount: 101, eligible: ['a', 'b'] }],
    boards: [parseCards('2c 7d 9h Js 3c')],
    holes: { a: parseCards('As Kd'), b: parseCards('Ah Kc') }, // identical hands
    rule: 'any',
    orderFromButton: ['b', 'a'],
  });
  assert.deepEqual(result.payouts, { a: 50, b: 51 });
});
