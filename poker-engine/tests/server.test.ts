/**
 * Integration tests for the Socket.IO poker server.
 * Connects real socket.io-client instances to an ephemeral server and plays
 * complete hands across all 7 variants, verifying event flow and card privacy.
 */
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createPokerServer } from '../server/index.js';
import type { TableView } from '../server/table-manager.js';

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
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { transports: ['websocket'], autoConnect: true });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emit<T>(socket: ClientSocket, event: string, payload: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: { ok: boolean; data?: T; error?: string }) => resolve(response));
  });
}

function waitFor<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, (data: T) => resolve(data)));
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

describe('Socket.IO server integration', () => {
  test('3 clients can create, join, and play a full Hold\'em hand', async () => {
    const s1 = await createClient();
    const s2 = await createClient();
    const s3 = await createClient();

    const createRes = await emit<JoinData>(s1, 'table:create', {
      name: 'Alice',
      settings: { variant: 'holdem', betting: 'nolimit', smallBlind: 1, bigBlind: 2, startingStack: 200, seatCount: 9, turnTimerSeconds: 30, doubleBoard: false },
    });
    assert.ok(createRes.ok, `Create failed: ${createRes.error}`);
    const code = createRes.data!.table.code;

    const join2 = await emit<JoinData>(s2, 'table:join', { code, name: 'Bob' });
    assert.ok(join2.ok, `Join failed: ${join2.error}`);
    const join3 = await emit<JoinData>(s3, 'table:join', { code, name: 'Carol' });
    assert.ok(join3.ok, `Join failed: ${join3.error}`);

    const players = [
      { socket: s1, id: createRes.data!.playerId },
      { socket: s2, id: join2.data!.playerId },
      { socket: s3, id: join3.data!.playerId },
    ];

    const startRes = await emit(s1, 'hand:start', {});
    assert.ok(startRes.ok, `Start failed: ${startRes.error}`);

    // Play hand: each client checks/calls when it's their turn
    let done = false;
    let iterations = 0;
    while (!done && iterations++ < 100) {
      for (const p of players) {
        const stateRes = await emit<TableView>(p.socket, 'table:get', {});
        assert.ok(stateRes.ok);
        const view = stateRes.data!;
        if (view.hand?.phase === 'complete') { done = true; break; }
        if (view.legalActions && view.legalActions.playerId === p.id) {
          const action = view.legalActions.canCheck ? { type: 'check' } : { type: 'call' };
          const actRes = await emit(p.socket, 'hand:act', action);
          assert.ok(actRes.ok, `Act failed: ${actRes.error}`);
        }
      }
    }
    assert.ok(done, 'Hand did not complete within 100 iterations');
  });

  test('players only see their own hole cards', async () => {
    const s1 = await createClient();
    const s2 = await createClient();

    const createRes = await emit<JoinData>(s1, 'table:create', {
      name: 'X',
      settings: { variant: 'holdem', betting: 'nolimit', smallBlind: 1, bigBlind: 2, startingStack: 200, seatCount: 9, turnTimerSeconds: 30, doubleBoard: false },
    });
    assert.ok(createRes.ok);
    const code = createRes.data!.table.code;
    const join = await emit<JoinData>(s2, 'table:join', { code, name: 'Y' });
    assert.ok(join.ok);

    await emit(s1, 'hand:start', {});

    const v1 = await emit<TableView>(s1, 'table:get', {});
    const v2 = await emit<TableView>(s2, 'table:get', {});
    assert.ok(v1.ok && v2.ok);

    const s1Hole = v1.data!.hand!.players.find(p => p.id === createRes.data!.playerId)!.hole;
    const s2InS1View = v1.data!.hand!.players.find(p => p.id === join.data!.playerId)!.hole;
    assert.ok(s1Hole !== null, 'player should see own cards');
    assert.equal(s2InS1View, null, 'should not see opponent cards');
  });

  test('chat:send delivers messages to the room', async () => {
    const s1 = await createClient();
    const s2 = await createClient();

    const createRes = await emit<JoinData>(s1, 'table:create', {
      name: 'ChatA',
      settings: { variant: 'holdem', betting: 'nolimit', smallBlind: 1, bigBlind: 2, startingStack: 200, seatCount: 9, turnTimerSeconds: 30, doubleBoard: false },
    });
    assert.ok(createRes.ok);
    const join = await emit<JoinData>(s2, 'table:join', { code: createRes.data!.table.code, name: 'ChatB' });
    assert.ok(join.ok);

    const msgPromise = waitFor<{ message: string }>(s2, 'chat:message');
    await emit(s1, 'chat:send', 'Hello from A!');
    const msg = await msgPromise;
    assert.equal(msg.message, 'Hello from A!');
  });

  test('disconnect and reconnect restores the seat', async () => {
    const s1 = await createClient();
    const s2 = await createClient();

    const createRes = await emit<JoinData>(s1, 'table:create', {
      name: 'ReconA',
      settings: { variant: 'holdem', betting: 'nolimit', smallBlind: 1, bigBlind: 2, startingStack: 200, seatCount: 9, turnTimerSeconds: 30, doubleBoard: false },
    });
    assert.ok(createRes.ok);
    const join = await emit<JoinData>(s2, 'table:join', { code: createRes.data!.table.code, name: 'ReconB' });
    assert.ok(join.ok);

    await emit(s1, 'hand:start', {});

    // Disconnect s2 and reconnect on a new socket
    const playerId = join.data!.playerId;
    const token = join.data!.reconnectToken;
    const tableCode = createRes.data!.table.code;
    s2.disconnect();

    const s2New = await createClient();
    const reconRes = await emit<JoinData>(s2New, 'table:reconnect', { code: tableCode, playerId, reconnectToken: token });
    assert.ok(reconRes.ok, `Reconnect failed: ${reconRes.error}`);
    assert.equal(reconRes.data!.playerId, playerId);
  });

  test('host controls work over sockets', async () => {
    const s1 = await createClient();
    const s2 = await createClient();

    const createRes = await emit<JoinData>(s1, 'table:create', {
      name: 'HostA',
      settings: { variant: 'holdem', betting: 'nolimit', smallBlind: 1, bigBlind: 2, startingStack: 200, seatCount: 9, turnTimerSeconds: 30, doubleBoard: false },
    });
    assert.ok(createRes.ok);
    const join = await emit<JoinData>(s2, 'table:join', { code: createRes.data!.table.code, name: 'HostB' });
    assert.ok(join.ok);

    // Bomb pot
    const bombRes = await emit(s1, 'host:bomb-pot', { ante: 10 });
    assert.ok(bombRes.ok);
    const view = await emit<TableView>(s1, 'table:get', {});
    assert.equal(view.data!.nextHandBombAnte, 10);

    // Settings
    const settingsRes = await emit(s1, 'host:settings', { bigBlind: 4, smallBlind: 2 });
    assert.ok(settingsRes.ok);

    // Mute
    const muteRes = await emit(s1, 'host:mute', { playerId: join.data!.playerId, muted: true });
    assert.ok(muteRes.ok);

    // Pause
    const pauseRes = await emit(s1, 'host:pause', { paused: true });
    assert.ok(pauseRes.ok);

    // Non-host cannot change settings
    const failRes = await emit(s2, 'host:settings', { bigBlind: 100 });
    assert.equal(failRes.ok, false);
  });
});

describe('Socket.IO: all variants complete', { concurrency: false }, () => {
  const variants = [
    { variant: 'holdem', betting: 'nolimit' },
    { variant: 'texas3', betting: 'nolimit' },
    { variant: 'plo4', betting: 'potlimit' },
    { variant: 'plo5', betting: 'potlimit' },
    { variant: 'pineapple3', betting: 'nolimit' },
    { variant: 'pineapple4', betting: 'nolimit' },
    { variant: 'pineapple5', betting: 'nolimit' },
  ] as const;

  for (const { variant, betting } of variants) {
    test(`complete hand: ${variant}`, async () => {
      const s1 = await createClient();
      const s2 = await createClient();
      const s3 = await createClient();

      const createRes = await emit<JoinData>(s1, 'table:create', {
        name: 'P1',
        settings: { variant, betting, smallBlind: 1, bigBlind: 2, startingStack: 200, seatCount: 9, turnTimerSeconds: 60, doubleBoard: false },
      });
      assert.ok(createRes.ok, `Create failed for ${variant}: ${createRes.error}`);
      const code = createRes.data!.table.code;

      const j2 = await emit<JoinData>(s2, 'table:join', { code, name: 'P2' });
      const j3 = await emit<JoinData>(s3, 'table:join', { code, name: 'P3' });
      assert.ok(j2.ok && j3.ok);

      const players = [
        { socket: s1, id: createRes.data!.playerId },
        { socket: s2, id: j2.data!.playerId },
        { socket: s3, id: j3.data!.playerId },
      ];

      await emit(s1, 'hand:start', {});

      let done = false;
      let iterations = 0;
      while (!done && iterations++ < 200) {
        for (const p of players) {
          const stateRes = await emit<TableView>(p.socket, 'table:get', {});
          assert.ok(stateRes.ok);
          const view = stateRes.data!;
          if (view.hand?.phase === 'complete') { done = true; break; }

          if (view.hand?.phase === 'discarding') {
            const pending = view.hand.pendingDiscards;
            if (pending[p.id]) {
              const myCards = view.hand.players.find(pl => pl.id === p.id)!.hole!;
              const discardRes = await emit(p.socket, 'hand:discard', myCards.slice(0, pending[p.id]));
              assert.ok(discardRes.ok, `Discard failed for ${p.id}: ${(discardRes as any).error}`);
            }
          } else if (view.legalActions && view.legalActions.playerId === p.id) {
            const action = view.legalActions.canCheck ? { type: 'check' } : { type: 'call' };
            const actRes = await emit(p.socket, 'hand:act', action);
            assert.ok(actRes.ok, `Act failed: ${(actRes as any).error}`);
          }
        }
      }
      assert.ok(done, `Hand did not complete for ${variant}`);
    });
  }

  test('bomb pot + double board completes', async () => {
    const s1 = await createClient();
    const s2 = await createClient();
    const s3 = await createClient();

    const createRes = await emit<JoinData>(s1, 'table:create', {
      name: 'BP1',
      settings: { variant: 'holdem', betting: 'nolimit', smallBlind: 1, bigBlind: 2, startingStack: 200, seatCount: 9, turnTimerSeconds: 60, doubleBoard: true },
    });
    assert.ok(createRes.ok);
    const code = createRes.data!.table.code;

    const j2 = await emit<JoinData>(s2, 'table:join', { code, name: 'BP2' });
    const j3 = await emit<JoinData>(s3, 'table:join', { code, name: 'BP3' });
    assert.ok(j2.ok && j3.ok);

    // Trigger bomb pot
    const bombRes = await emit(s1, 'host:bomb-pot', { ante: 10 });
    assert.ok(bombRes.ok);

    const players = [
      { socket: s1, id: createRes.data!.playerId },
      { socket: s2, id: j2.data!.playerId },
      { socket: s3, id: j3.data!.playerId },
    ];

    await emit(s1, 'hand:start', {});

    let done = false;
    let iterations = 0;
    while (!done && iterations++ < 200) {
      for (const p of players) {
        const stateRes = await emit<TableView>(p.socket, 'table:get', {});
        assert.ok(stateRes.ok);
        const view = stateRes.data!;
        if (view.hand?.phase === 'complete') { done = true; break; }
        if (view.legalActions && view.legalActions.playerId === p.id) {
          const action = view.legalActions.canCheck ? { type: 'check' } : { type: 'call' };
          await emit(p.socket, 'hand:act', action);
        }
      }
    }
    assert.ok(done, 'Bomb pot + double board hand did not complete');

    // Verify double board result
    const finalRes = await emit<TableView>(s1, 'table:get', {});
    assert.ok(finalRes.ok);
    assert.equal(finalRes.data!.hand!.boards.length, 2);
  });
});
