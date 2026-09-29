/**
 * Plays random hands to hunt for engine bugs, and prints hands so you can read them.
 *
 *   npm run simulate                                   # 200 hands of every variant
 *   npm run simulate -- --variant plo4 --hands 1 --seed 7 --verbose
 *   npm run simulate -- --variant pineapple4 --players 5 --double --bomb 10 --hands 1 --verbose
 *
 * Options: --variant <id>  --hands <n>  --players <n>  --seed <n>  --double  --bomb <ante>  --verbose
 * If a hand crashes, the seed is printed: rerun with that seed and --verbose to replay it exactly.
 */
import { Hand } from '../src/game.js';
import { VARIANTS } from '../src/variants.js';
import type { HandConfig, VariantId } from '../src/types.js';
import { makeRng } from './rng.js';
import { playRandomHand } from './randomPlayer.js';

function parseArgs(argv: string[]) {
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++; } else opts[key] = true;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const variants = (opts.variant ? [opts.variant as VariantId] : (Object.keys(VARIANTS) as VariantId[]));
const hands = Number(opts.hands ?? 200);
const baseSeed = Number(opts.seed ?? Date.now() % 1_000_000);
const verbose = opts.verbose === true;
const playersOverride = opts.players ? Number(opts.players) : null;

let failures = 0;
console.log(`Base seed: ${baseSeed}`);

for (const variant of variants) {
  const stats = { hands: 0, showdowns: 0, folds: 0, chipsMoved: 0 };
  const started = Date.now();
  for (let i = 0; i < hands; i++) {
    const seed = baseSeed + i;
    const rng = makeRng(seed);
    const startingCards = VARIANTS[variant].startingCards;
    const doubleBoard = opts.double === true || (opts.double === undefined && rng(4) === 0);
    const maxPlayers = Math.max(2, Math.min(9, Math.floor((52 - 5 * (doubleBoard ? 2 : 1)) / startingCards)));
    const playerCount = playersOverride ?? 2 + rng(maxPlayers - 1);
    const players = Array.from({ length: playerCount }, (_, p) => ({ id: `p${p}`, stack: 20 + rng(300) }));
    const config: HandConfig = {
      variant, smallBlind: 1, bigBlind: 2, doubleBoard, rng,
      bombPotAnte: opts.bomb ? Number(opts.bomb) : (opts.bomb === undefined && rng(5) === 0 ? 4 : undefined),
      betting: variant === 'holdem' || variant.startsWith('pineapple') || variant === 'texas3'
        ? (rng(2) === 0 ? 'nolimit' : 'potlimit') : undefined,
    };

    let hand: Hand | undefined;
    try {
      hand = new Hand(config, players, rng(playerCount));
      playRandomHand(hand, rng);
      const result = hand.getResult()!;
      stats.hands++;
      result.reason === 'showdown' ? stats.showdowns++ : stats.folds++;
      stats.chipsMoved += Object.values(result.net).filter((n) => n > 0).reduce((a, b) => a + b, 0);
      if (verbose) console.log(hand.log.join('\n') + '\n');
    } catch (error) {
      failures++;
      console.error(`\nFAILED: variant=${variant} seed=${seed} players=${playerCount}`);
      console.error(`Replay: npm run simulate -- --variant ${variant} --seed ${seed} --hands 1 --players ${playerCount} --verbose`);
      console.error(error instanceof Error ? error.message : error);
      if (hand) console.error(hand.log.join('\n'));
      if (failures >= 3) process.exit(1);
    }
  }
  const ms = Date.now() - started;
  console.log(`${VARIANTS[variant].label.padEnd(28)} ${stats.hands} hands ok | showdowns ${stats.showdowns}, folds ${stats.folds} | ${ms} ms`);
}
process.exit(failures ? 1 : 0);
