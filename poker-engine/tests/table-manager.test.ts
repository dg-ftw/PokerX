import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TableManager, type TableSettings } from '../server/table-manager.js';
import type { HandState } from '../src/types.js';

const defaultSettings: TableSettings = {
  variant: 'holdem',
  betting: 'nolimit',
  smallBlind: 1,
  bigBlind: 2,
  startingStack: 200,
  seatCount: 9,
  turnTimerSeconds: 30,
  doubleBoard: false,
};

function noop() {}
function createManager() { return new TableManager(noop, noop); }

function setupTable(manager: TableManager, settings: TableSettings = defaultSettings, names = ['Alice', 'Bob', 'Carol']) {
  const host = manager.createTable('s1', names[0], settings);
  const results = [host];
  for (let i = 1; i < names.length; i++) {
    results.push(manager.joinTable(`s${i + 1}`, host.table.code, names[i]));
  }
  return results;
}

describe('table creation and joining', () => {
  test('creating a table returns a 6-char alphanumeric code', () => {
    const mgr = createManager();
    const result = mgr.createTable('s1', 'Alice', defaultSettings);
    assert.ok(result.table.code);
    assert.ok(result.table.code.length === 6);
    assert.match(result.table.code, /^[A-Z2-9]{6}$/);
    assert.ok(result.playerId);
    assert.ok(result.reconnectToken);
  });

  test('joining by code seats the player', () => {
    const mgr = createManager();
    const host = mgr.createTable('s1', 'Alice', defaultSettings);
    const joiner = mgr.joinTable('s2', host.table.code, 'Bob');
    assert.ok(joiner.playerId);
    assert.equal(joiner.table.players.length, 2);
    assert.equal(joiner.table.players[1].name, 'Bob');
  });

  test('full table rejects new players', () => {
    const mgr = createManager();
    const host = mgr.createTable('s1', 'Alice', { ...defaultSettings, seatCount: 2 });
    mgr.joinTable('s2', host.table.code, 'Bob');
    assert.throws(() => mgr.joinTable('s3', host.table.code, 'Carol'), /full/i);
  });

  test('duplicate display name is rejected', () => {
    const mgr = createManager();
    const host = mgr.createTable('s1', 'Alice', defaultSettings);
    assert.throws(() => mgr.joinTable('s2', host.table.code, 'Alice'), /name/i);
  });

  test('invalid table code throws', () => {
    const mgr = createManager();
    assert.throws(() => mgr.joinTable('s1', 'ZZZZZZ', 'Alice'), /not found/i);
  });

  test('a socket cannot join two tables', () => {
    const mgr = createManager();
    mgr.createTable('s1', 'Alice', defaultSettings);
    assert.throws(() => mgr.createTable('s1', 'Bob', defaultSettings), /leave/i);
  });
});

describe('reconnection', () => {
  test('reconnect with valid token restores the seat', () => {
    const mgr = createManager();
    const host = mgr.createTable('s1', 'Alice', defaultSettings);
    mgr.disconnect('s1');
    const reconnected = mgr.reconnect('s1-new', host.table.code, host.playerId, host.reconnectToken);
    assert.equal(reconnected.playerId, host.playerId);
    assert.equal(reconnected.table.players[0].connected, true);
  });

  test('reconnect with bad token fails', () => {
    const mgr = createManager();
    const host = mgr.createTable('s1', 'Alice', defaultSettings);
    mgr.disconnect('s1');
    assert.throws(() => mgr.reconnect('s1-new', host.table.code, host.playerId, 'bad-token'), /invalid/i);
  });
});

describe('private card visibility', () => {
  test('viewForSocket only shows the callers hole cards', () => {
    const updates: string[] = [];
    const mgr = new TableManager((code) => updates.push(code), noop);
    const [host, joiner] = setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.startHand('s1');
    const hostView = mgr.viewForSocket('s1');
    const joinerView = mgr.viewForSocket('s2');
    const hostHole = hostView.hand!.players.find(p => p.id === host.playerId)!.hole;
    const joinerHoleInHostView = hostView.hand!.players.find(p => p.id === joiner.playerId)!.hole;
    assert.ok(hostHole !== null, 'host should see own hole cards');
    assert.equal(joinerHoleInHostView, null, 'host should NOT see joiner hole cards');
    const joinerHole = joinerView.hand!.players.find(p => p.id === joiner.playerId)!.hole;
    const hostHoleInJoinerView = joinerView.hand!.players.find(p => p.id === host.playerId)!.hole;
    assert.ok(joinerHole !== null, 'joiner should see own hole cards');
    assert.equal(hostHoleInJoinerView, null, 'joiner should NOT see host hole cards');
  });
});

describe('playing a complete hand', () => {
  test('two players can play a Hold\'em hand to showdown', () => {
    const mgr = createManager();
    setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.startHand('s1');
    let view = mgr.viewForSocket('s1');
    let safetyCounter = 200;
    while (view.hand && view.hand.phase !== 'complete' && safetyCounter-- > 0) {
      const la = mgr.viewForSocket('s1').legalActions ?? mgr.viewForSocket('s2').legalActions;
      if (la) {
        const socketId = la.playerId === view.players[0].id ? 's1' : 's2';
        mgr.act(socketId, la.canCheck ? { type: 'check' } : { type: 'call' });
      }
      view = mgr.viewForSocket('s1');
    }
    assert.ok(view.hand!.result);
    assert.equal(view.hand!.result!.reason, 'showdown');
  });

  test('three players play Pineapple 4 with discards', () => {
    const mgr = createManager();
    const settings: TableSettings = { ...defaultSettings, variant: 'pineapple4', seatCount: 9 };
    const results = setupTable(mgr, settings, ['A', 'B', 'C']);
    const ids = results.map(r => r.playerId);
    const socketFor = (pid: string) => `s${ids.indexOf(pid) + 1}`;
    mgr.startHand('s1');
    let view = mgr.viewForSocket('s1');
    let safetyCounter = 200;
    while (view.hand && view.hand.phase !== 'complete' && safetyCounter-- > 0) {
      if (view.hand.phase === 'discarding') {
        for (const [pid, count] of Object.entries(view.hand.pendingDiscards)) {
          const pView = mgr.viewForSocket(socketFor(pid));
          const myHole = pView.hand!.players.find(p => p.id === pid)!.hole!;
          mgr.discard(socketFor(pid), myHole.slice(0, count));
        }
      } else if (view.hand.phase === 'betting') {
        const la = view.legalActions ?? mgr.viewForSocket('s2').legalActions ?? mgr.viewForSocket('s3').legalActions;
        if (la) {
          mgr.act(socketFor(la.playerId), la.canCheck ? { type: 'check' } : { type: 'call' });
        }
      }
      view = mgr.viewForSocket('s1');
    }
    assert.ok(view.hand!.result, 'hand should be complete');
  });
});

describe('host controls', () => {
  test('host can change settings between hands', () => {
    const mgr = createManager();
    setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.updateSettings('s1', { bigBlind: 4, smallBlind: 2 });
    const view = mgr.viewForSocket('s1');
    assert.equal(view.settings.bigBlind, 4);
    assert.equal(view.settings.smallBlind, 2);
  });

  test('non-host cannot change settings', () => {
    const mgr = createManager();
    setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    assert.throws(() => mgr.updateSettings('s2', { bigBlind: 10 }), /host/i);
  });

  test('host can kick a player between hands', () => {
    const mgr = createManager();
    const [host, joiner] = setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.kick('s1', joiner.playerId);
    const view = mgr.viewForSocket('s1');
    assert.equal(view.players.length, 1);
  });

  test('host can mute and unmute a player', () => {
    const mgr = createManager();
    const [, joiner] = setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.setMuted('s1', joiner.playerId, true);
    let view = mgr.viewForSocket('s1');
    assert.equal(view.players.find(p => p.id === joiner.playerId)!.muted, true);
    mgr.setMuted('s1', joiner.playerId, false);
    view = mgr.viewForSocket('s1');
    assert.equal(view.players.find(p => p.id === joiner.playerId)!.muted, false);
  });

  test('host can pause and resume', () => {
    const mgr = createManager();
    setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.setPaused('s1', true);
    assert.equal(mgr.viewForSocket('s1').paused, true);
    assert.throws(() => mgr.startHand('s1'), /paused/i);
    mgr.setPaused('s1', false);
    assert.equal(mgr.viewForSocket('s1').paused, false);
  });

  test('host can top up a player', () => {
    const mgr = createManager();
    const [, joiner] = setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.topUp('s1', joiner.playerId, 100);
    const view = mgr.viewForSocket('s1');
    assert.equal(view.players.find(p => p.id === joiner.playerId)!.stack, 300);
  });

  test('host can reset stacks', () => {
    const mgr = createManager();
    const [, joiner] = setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.topUp('s1', joiner.playerId, 100);
    mgr.resetStacks('s1');
    const view = mgr.viewForSocket('s1');
    assert.ok(view.players.every(p => p.stack === 200));
  });

  test('host can schedule a bomb pot', () => {
    const mgr = createManager();
    setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.triggerBombPot('s1', 10);
    assert.equal(mgr.viewForSocket('s1').nextHandBombAnte, 10);
  });
});

describe('player actions', () => {
  test('player can sit out and come back', () => {
    const mgr = createManager();
    setupTable(mgr, defaultSettings, ['Alice', 'Bob', 'Carol']);
    mgr.setSittingOut('s2', true);
    assert.equal(mgr.viewForSocket('s1').players[1].sittingOut, true);
    mgr.setSittingOut('s2', false);
    assert.equal(mgr.viewForSocket('s1').players[1].sittingOut, false);
  });

  test('player can leave the table', () => {
    const mgr = createManager();
    setupTable(mgr, defaultSettings, ['Alice', 'Bob', 'Carol']);
    mgr.leave('s3');
    const view = mgr.viewForSocket('s1');
    assert.equal(view.players.length, 2);
  });
});

describe('chat', () => {
  test('seated player can send a chat message', () => {
    const chats: Array<{ message: string }> = [];
    const mgr = new TableManager(noop, (_code, msg) => chats.push(msg));
    setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.sendChat('s1', 'Hello!');
    assert.equal(chats.length, 1);
    assert.equal(chats[0].message, 'Hello!');
  });

  test('muted player cannot chat', () => {
    const mgr = createManager();
    const [, joiner] = setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.setMuted('s1', joiner.playerId, true);
    assert.throws(() => mgr.sendChat('s2', 'Hello!'), /muted/i);
  });

  test('message is capped at 300 characters', () => {
    const chats: Array<{ message: string }> = [];
    const mgr = new TableManager(noop, (_code, msg) => chats.push(msg));
    setupTable(mgr, defaultSettings, ['Alice', 'Bob']);
    mgr.sendChat('s1', 'x'.repeat(500));
    assert.equal(chats[0].message.length, 300);
  });
});

describe('settings validation', () => {
  test('PLO must be pot-limit', () => {
    const mgr = createManager();
    assert.throws(() => mgr.createTable('s1', 'Alice', { ...defaultSettings, variant: 'plo4', betting: 'nolimit' }), /pot-limit/i);
  });

  test('big blind cannot be less than small blind', () => {
    const mgr = createManager();
    assert.throws(() => mgr.createTable('s1', 'Alice', { ...defaultSettings, smallBlind: 5, bigBlind: 2 }), /blind/i);
  });

  test('seat count must be 2-9', () => {
    const mgr = createManager();
    assert.throws(() => mgr.createTable('s1', 'Alice', { ...defaultSettings, seatCount: 10 }), /seat/i);
    assert.throws(() => mgr.createTable('s1', 'Alice', { ...defaultSettings, seatCount: 1 }), /seat/i);
  });

  test('turn timer must be 5-300 seconds', () => {
    const mgr = createManager();
    assert.throws(() => mgr.createTable('s1', 'Alice', { ...defaultSettings, turnTimerSeconds: 4 }), /timer/i);
    assert.throws(() => mgr.createTable('s1', 'Alice', { ...defaultSettings, turnTimerSeconds: 301 }), /timer/i);
  });
});
