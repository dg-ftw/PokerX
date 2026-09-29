/**
 * Standalone script: launch an ephemeral server and 3 Socket.IO clients,
 * play one complete hand of every variant, then print results.
 *
 * Usage: npx tsx scripts/test-clients.ts
 */
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createPokerServer } from '../server/index.js';
import type { TableView } from '../server/table-manager.js';

const VARIANTS = [
  { variant: 'holdem', betting: 'nolimit', label: "Texas Hold'em" },
  { variant: 'texas3', betting: 'nolimit', label: '3-Card Texas' },
  { variant: 'plo4', betting: 'potlimit', label: 'PLO4' },
  { variant: 'plo5', betting: 'potlimit', label: 'PLO5' },
  { variant: 'pineapple3', betting: 'nolimit', label: 'Pineapple 3' },
  { variant: 'pineapple4', betting: 'nolimit', label: 'Pineapple 4' },
  { variant: 'pineapple5', betting: 'nolimit', label: 'Pineapple 5' },
] as const;

interface JoinData { playerId: string; reconnectToken: string; table: TableView; }

function emit<T>(socket: ClientSocket, event: string, payload: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: { ok: boolean; data?: T; error?: string }) => resolve(response));
  });
}

function connect(url: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

async function playHand(
  url: string,
  variant: string,
  betting: string,
  label: string,
  doubleBoard: boolean,
  bombAnte: number | null,
): Promise<void> {
  const s1 = await connect(url);
  const s2 = await connect(url);
  const s3 = await connect(url);

  const createRes = await emit<JoinData>(s1, 'table:create', {
    name: 'Alice',
    settings: { variant, betting, smallBlind: 1, bigBlind: 2, startingStack: 200, seatCount: 9, turnTimerSeconds: 60, doubleBoard },
  });
  if (!createRes.ok) throw new Error(`Create failed: ${createRes.error}`);
  const code = createRes.data!.table.code;

  const j2 = await emit<JoinData>(s2, 'table:join', { code, name: 'Bob' });
  const j3 = await emit<JoinData>(s3, 'table:join', { code, name: 'Carol' });
  if (!j2.ok || !j3.ok) throw new Error('Join failed');

  if (bombAnte !== null) {
    await emit(s1, 'host:bomb-pot', { ante: bombAnte });
  }

  const players = [
    { socket: s1, id: createRes.data!.playerId, name: 'Alice' },
    { socket: s2, id: j2.data!.playerId, name: 'Bob' },
    { socket: s3, id: j3.data!.playerId, name: 'Carol' },
  ];

  await emit(s1, 'hand:start', {});

  let done = false;
  let iterations = 0;
  while (!done && iterations++ < 300) {
    for (const p of players) {
      const stateRes = await emit<TableView>(p.socket, 'table:get', {});
      if (!stateRes.ok) continue;
      const view = stateRes.data!;
      if (view.hand?.phase === 'complete') { done = true; break; }

      if (view.hand?.phase === 'discarding') {
        const pending = view.hand.pendingDiscards;
        if (pending[p.id]) {
          const myCards = view.hand.players.find(pl => pl.id === p.id)!.hole!;
          await emit(p.socket, 'hand:discard', myCards.slice(0, pending[p.id]));
        }
      } else if (view.legalActions && view.legalActions.playerId === p.id) {
        const action = view.legalActions.canCheck ? { type: 'check' } : { type: 'call' };
        await emit(p.socket, 'hand:act', action);
      }
    }
  }

  if (!done) throw new Error(`Hand did not complete for ${label}`);

  const finalRes = await emit<TableView>(s1, 'table:get', {});
  const result = finalRes.data!.hand!.result!;
  const net = Object.entries(result.net)
    .map(([id, n]) => `${players.find(p => p.id === id)?.name ?? id}: ${n >= 0 ? '+' : ''}${n}`)
    .join(', ');

  const suffix = bombAnte !== null ? ' (bomb pot)' : '';
  const dbSuffix = doubleBoard ? ' [double board]' : '';
  console.log(`  ✔ ${label}${suffix}${dbSuffix} — ${result.reason} | ${net}`);

  s1.disconnect();
  s2.disconnect();
  s3.disconnect();
}

async function main() {
  const { httpServer, io } = createPokerServer();
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;

  console.log(`\nPoker test server running on :${port}`);
  console.log(`Playing one hand of each variant with 3 clients...\n`);

  for (const { variant, betting, label } of VARIANTS) {
    await playHand(url, variant, betting, label, false, null);
  }

  // Bomb pot + double board
  await playHand(url, 'holdem', 'nolimit', "Hold'em", true, 10);
  await playHand(url, 'pineapple4', 'nolimit', 'Pineapple 4', true, 5);

  console.log(`\nAll ${VARIANTS.length + 2} hands completed successfully!\n`);

  io.close();
  httpServer.close();
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
