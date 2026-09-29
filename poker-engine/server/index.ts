import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { TableManager, type TableSettings } from './table-manager.js';
import type { Action, Card } from '../src/index.js';

const port = Number(process.env.PORT ?? 3001);
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN?.split(',').map((origin) => origin.trim()) ?? '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 16_384,
});

const tables = new TableManager(
  (code) => {
    for (const socket of io.sockets.adapter.rooms.get(code) ?? []) {
      try { io.to(socket).emit('table:state', tables.viewForSocket(socket)); } catch { /* seat left while broadcasting */ }
    }
  },
  (code, message) => io.to(code).emit('chat:message', message),
);

function respond<T>(socket: Socket, ack: unknown, operation: () => T, event: string): void {
  try {
    const result = operation();
    if (typeof ack === 'function') (ack as (value: unknown) => void)({ ok: true, data: result });
    if (event) socket.emit(event, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed.';
    if (typeof ack === 'function') (ack as (value: unknown) => void)({ ok: false, error: message });
    else socket.emit('request:error', { error: message });
  }
}

function joinRoom(socket: Socket, code: string): void {
  socket.join(code);
  socket.emit('table:state', tables.viewForSocket(socket.id));
}

io.on('connection', (socket) => {
  socket.on('table:create', (payload: { name: string; settings: TableSettings }, ack?: unknown) => respond(socket, ack, () => {
    const result = tables.createTable(socket.id, payload.name, payload.settings);
    joinRoom(socket, result.table.code);
    return result;
  }, 'table:created'));

  socket.on('table:join', (payload: { code: string; name: string }, ack?: unknown) => respond(socket, ack, () => {
    const result = tables.joinTable(socket.id, payload.code, payload.name);
    joinRoom(socket, result.table.code);
    return result;
  }, 'table:joined'));

  socket.on('table:reconnect', (payload: { code: string; playerId: string; reconnectToken: string }, ack?: unknown) => respond(socket, ack, () => {
    const result = tables.reconnect(socket.id, payload.code, payload.playerId, payload.reconnectToken);
    joinRoom(socket, result.table.code);
    return result;
  }, 'table:reconnected'));

  socket.on('table:get', (_payload: unknown, ack?: unknown) => respond(socket, ack, () => tables.viewForSocket(socket.id), ''));
  socket.on('hand:start', (_payload: unknown, ack?: unknown) => respond(socket, ack, () => { tables.startHand(socket.id); return { started: true }; }, ''));
  socket.on('hand:act', (action: Action, ack?: unknown) => respond(socket, ack, () => { tables.act(socket.id, action); return { accepted: true }; }, ''));
  socket.on('hand:discard', (cards: Card[], ack?: unknown) => respond(socket, ack, () => { tables.discard(socket.id, cards); return { accepted: true }; }, ''));

  socket.on('host:settings', (changes: Partial<TableSettings>, ack?: unknown) => respond(socket, ack, () => { tables.updateSettings(socket.id, changes); return { updated: true }; }, ''));
  socket.on('host:kick', (payload: { playerId: string }, ack?: unknown) => respond(socket, ack, () => {
    const targetSocket = tables.kick(socket.id, payload.playerId);
    if (targetSocket) io.sockets.sockets.get(targetSocket)?.leave(tables.viewForSocket(socket.id).code);
    if (targetSocket) io.to(targetSocket).emit('table:kicked', { reason: 'Removed by the host.' });
    return { kicked: payload.playerId };
  }, ''));
  socket.on('host:mute', (payload: { playerId: string; muted: boolean }, ack?: unknown) => respond(socket, ack, () => { tables.setMuted(socket.id, payload.playerId, payload.muted); return { updated: true }; }, ''));
  socket.on('host:pause', (payload: { paused: boolean }, ack?: unknown) => respond(socket, ack, () => { tables.setPaused(socket.id, payload.paused); return { paused: payload.paused }; }, ''));
  socket.on('host:topup', (payload: { playerId: string; amount: number }, ack?: unknown) => respond(socket, ack, () => { tables.topUp(socket.id, payload.playerId, payload.amount); return { updated: true }; }, ''));
  socket.on('host:reset-stacks', (_payload: unknown, ack?: unknown) => respond(socket, ack, () => { tables.resetStacks(socket.id); return { reset: true }; }, ''));
  socket.on('host:bomb-pot', (payload: { ante: number }, ack?: unknown) => respond(socket, ack, () => { tables.triggerBombPot(socket.id, payload.ante); return { scheduled: true }; }, ''));
  socket.on('player:sit-out', (payload: { sittingOut: boolean }, ack?: unknown) => respond(socket, ack, () => { tables.setSittingOut(socket.id, payload.sittingOut); return { updated: true }; }, ''));
  socket.on('table:leave', (_payload: unknown, ack?: unknown) => respond(socket, ack, () => {
    const code = tables.leave(socket.id);
    socket.leave(code);
    return { left: true };
  }, ''));
  socket.on('chat:send', (message: unknown, ack?: unknown) => respond(socket, ack, () => { tables.sendChat(socket.id, message); return { sent: true }; }, ''));

  socket.on('disconnect', () => {
    const code = tables.disconnect(socket.id);
    if (code) socket.leave(code);
  });
});

httpServer.listen(port, () => console.log(`Poker real-time server listening on :${port}`));
