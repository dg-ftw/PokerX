/**
 * Side-pot construction. Pure function: no game state, so it is easy to test.
 *
 * Example: A puts in 100, B all-in for 30, C puts in 100.
 *   main pot : 30 x 3 = 90   (A, B, C can win it)
 *   side pot : 70 x 2 = 140  (only A and C can win it)
 */
export interface PotContribution {
  id: string;
  /** Everything this player put in during the whole hand. */
  totalBet: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Players who can win this pot (not folded, and paid into this layer). */
  eligible: string[];
}

const sameMembers = (a: string[], b: string[]) => [...a].sort().join('|') === [...b].sort().join('|');

export function buildPots(players: readonly PotContribution[]): Pot[] {
  const levels = [...new Set(players.filter((p) => p.totalBet > 0).map((p) => p.totalBet))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;
  let carry = 0;

  for (const level of levels) {
    // Each player pays the slice between the previous level and this one (up to what they put in).
    let amount = carry;
    carry = 0;
    for (const p of players) amount += Math.min(p.totalBet, level) - Math.min(p.totalBet, previous);
    previous = level;

    const eligible = players.filter((p) => !p.folded && p.totalBet >= level).map((p) => p.id);
    if (eligible.length === 0) {
      // Only folded players paid this slice: hand it to the neighbouring pot.
      if (pots.length > 0) pots[pots.length - 1].amount += amount;
      else carry = amount;
      continue;
    }
    const last = pots[pots.length - 1];
    if (last && sameMembers(last.eligible, eligible)) last.amount += amount;
    else pots.push({ amount, eligible });
  }
  return pots;
}
