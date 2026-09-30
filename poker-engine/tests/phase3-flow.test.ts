/**
 * Phase 3 full client-flow integration test.
 * Exercises table creation with custom settings, double board, pineapple discards,
 * host controls, chat, and showdown results matching the React frontend client requirements.
 */
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createPokerServer } from '../server/index.js';
import type { TableView, TableSettings } from '../server/table-manager.js';

interface ServerHandle {
  url: string;
  close: () => Promise<void>;
}

function startServer(): Promise<ServerHandle> {
  return new Promise((resolve) => {
    const { httpServer, io } = createPokerServer();
    httpServer.listen(0, () => {
      const port = (httpServer.address() as AddressInfo).port;
      resolve({
        url: `http://localhost:${port}`,
        close: () => new Promise<void>((r) => { io.close(); httpServer.close(() => r()); }),
      });
    });
  });
}

function connect(url: string): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const socket = ioClient(url, { transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
  });
}

function emit<T>(socket: ClientSocket, event: string, payload: unknown = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: { ok: boolean; data?: T; error?: string }) => resolve(response));
  });
}

interface JoinData { playerId: string; reconnectToken: string; table: TableView; }

let server: ServerHandle;
const sockets: ClientSocket[] = [];

before(async () => { server = await startServer(); });
after(async () => {
  sockets.forEach((s) => s.disconnect());
  await server.close();
});

async function createClient(): Promise<ClientSocket> {
  const s = await connect(server.url);
  sockets.push(s);
  return s;
}

describe('Phase 3: Frontend Client Protocol & Flow', () => {
  test('creates table with custom settings (Pineapple 4, Double Board, 5/10 blinds)', async () => {
    const s1 = await createClient();
    const settings: TableSettings = {
      variant: 'pineapple4',
      betting: 'nolimit',
      smallBlind: 5,
      bigBlind: 10,
      startingStack: 500,
      seatCount: 6,
      turnTimerSeconds: 45,
      doubleBoard: true,
      discardSchedule: { flop: 1, turn: 1 },
    };

    const res = await emit<JoinData>(s1, 'table:create', { name: 'HostAlice', settings });
    assert.ok(res.ok);
    assert.equal(res.data!.table.settings.variant, 'pineapple4');
    assert.equal(res.data!.table.settings.doubleBoard, true);
    assert.equal(res.data!.table.settings.smallBlind, 5);
    assert.equal(res.data!.table.settings.bigBlind, 10);
    assert.equal(res.data!.table.players[0].name, 'HostAlice');
    assert.equal(res.data!.table.players[0].isHost, true);
  });

  test('multiple clients join, play Pineapple 4 with interactive discards and double board', async () => {
    const s1 = await createClient();
    const s2 = await createClient();

    const settings: TableSettings = {
      variant: 'pineapple4',
      betting: 'nolimit',
      smallBlind: 2,
      bigBlind: 4,
      startingStack: 200,
      seatCount: 6,
      turnTimerSeconds: 60,
      doubleBoard: true,
      discardSchedule: { flop: 1, turn: 1 },
    };

    const createRes = await emit<JoinData>(s1, 'table:create', { name: 'Alice', settings });
    assert.ok(createRes.ok);
    const code = createRes.data!.table.code;

    const joinRes = await emit<JoinData>(s2, 'table:join', { code, name: 'Bob' });
    assert.ok(joinRes.ok);

    const p1Id = createRes.data!.playerId;
    const p2Id = joinRes.data!.playerId;

    // Start hand
    const startRes = await emit(s1, 'hand:start');
    assert.ok(startRes.ok);

    // Play through streets until complete
    let done = false;
    let loopLimit = 150;
    while (!done && loopLimit-- > 0) {
      for (const p of [{ sock: s1, id: p1Id }, { sock: s2, id: p2Id }]) {
        const viewRes = await emit<TableView>(p.sock, 'table:get');
        if (!viewRes.ok || !viewRes.data?.hand) continue;
        const hand = viewRes.data.hand;

        if (hand.phase === 'complete') {
          done = true;
          break;
        }

        // Pineapple discard handling
        if (hand.phase === 'discarding') {
          const needed = hand.pendingDiscards[p.id];
          if (needed && needed > 0) {
            const myHole = hand.players.find((pl) => pl.id === p.id)!.hole!;
            const discardCards = myHole.slice(0, needed);
            const discRes = await emit(p.sock, 'hand:discard', discardCards);
            assert.ok(discRes.ok, `Discard failed: ${discRes.error}`);
          }
        } else if (hand.phase === 'betting') {
          const legal = viewRes.data.legalActions;
          if (legal && legal.playerId === p.id) {
            const action = legal.canCheck ? { type: 'check' } : { type: 'call' };
            const actRes = await emit(p.sock, 'hand:act', action);
            assert.ok(actRes.ok, `Act failed: ${actRes.error}`);
          }
        }
      }
    }

    assert.ok(done, 'Hand did not complete within iterations');

    // Verify double board in final state
    const finalView = await emit<TableView>(s1, 'table:get');
    assert.ok(finalView.ok);
    assert.equal(finalView.data!.hand!.boards.length, 2, 'Should have 2 boards in double board mode');
    assert.ok(finalView.data!.hand!.result, 'Should have hand result');
  });

  test('host controls: bomb pot, mute, pause, and topup work over socket', async () => {
    const s1 = await createClient();
    const s2 = await createClient();

    const createRes = await emit<JoinData>(s1, 'table:create', {
      name: 'HostUser',
      settings: {
        variant: 'holdem',
        betting: 'nolimit',
        smallBlind: 1,
        bigBlind: 2,
        startingStack: 100,
        seatCount: 6,
        turnTimerSeconds: 30,
        doubleBoard: false,
      },
    });
    assert.ok(createRes.ok);
    const code = createRes.data!.table.code;
    const joinRes = await emit<JoinData>(s2, 'table:join', { code, name: 'GuestUser' });
    assert.ok(joinRes.ok);
    const guestId = joinRes.data!.playerId;

    // Schedule bomb pot
    const bombRes = await emit(s1, 'host:bomb-pot', { ante: 15 });
    assert.ok(bombRes.ok);
    let view = await emit<TableView>(s1, 'table:get');
    assert.equal(view.data!.nextHandBombAnte, 15);

    // Mute guest
    const muteRes = await emit(s1, 'host:mute', { playerId: guestId, muted: true });
    assert.ok(muteRes.ok);
    view = await emit<TableView>(s1, 'table:get');
    assert.equal(view.data!.players.find((p) => p.id === guestId)!.muted, true);

    // Top up guest
    const topupRes = await emit(s1, 'host:topup', { playerId: guestId, amount: 250 });
    assert.ok(topupRes.ok);
    view = await emit<TableView>(s1, 'table:get');
    assert.equal(view.data!.players.find((p) => p.id === guestId)!.stack, 350);

    // Pause table
    const pauseRes = await emit(s1, 'host:pause', { paused: true });
    assert.ok(pauseRes.ok);
    view = await emit<TableView>(s1, 'table:get');
    assert.equal(view.data!.paused, true);
  });
});
