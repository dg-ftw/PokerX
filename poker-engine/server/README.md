# Real-time poker server (Phase 2)

The server exposes a Socket.IO API around the Phase 1 `Hand` engine. It is intentionally separate from the future React client. Start it with `npm run server`; it listens on `PORT` (default `3001`). Set `CLIENT_ORIGIN` to a comma-separated allowlist when hosting the client on another origin.

## Connection flow

Every command accepts an optional Socket.IO acknowledgement callback. Success returns `{ ok: true, data }`; errors return `{ ok: false, error }`. Without an acknowledgement, failures are sent as `request:error`.

1. `table:create` `{ name, settings }` creates a private table and seats its host.
2. Share the returned `table.code` (invite code) with friends. `table:join` `{ code, name }` seats a player.
3. The create/join/reconnect response contains `playerId` and `reconnectToken`. Store both locally; use `table:reconnect` `{ code, playerId, reconnectToken }` after reconnecting.
4. The host starts hands with `hand:start`. Players act with `hand:act` (`fold`, `check`, `call`, `raise` with a total `to`, or `allin`) and submit private Pineapple discards with `hand:discard` (array of their own card strings).
5. Listen to `table:state` for player-specific state and `chat:message` for table chat. `table:get` returns the caller's latest state.

State is emitted individually to each connected seat using `Hand.getViewFor(playerId)`. Only the current actor receives `legalActions`. Folded and opponent hole cards remain hidden until showdown. Server hand logs are never sent while a hand is live.

## Socket events

| Event | Payload | Access |
| --- | --- | --- |
| `table:create` | `{ name, settings }` | Any connected client |
| `table:join` | `{ code, name }` | Anyone with the code |
| `table:reconnect` | `{ code, playerId, reconnectToken }` | Matching seat token |
| `table:get` | `{}` | Seated player |
| `hand:start` | `{}` | Host |
| `hand:act` | engine `Action` | Current actor |
| `hand:discard` | `Card[]` | Player with a pending discard |
| `host:settings` | partial table settings | Host, between hands |
| `host:kick` | `{ playerId }` | Host, between hands |
| `host:mute` | `{ playerId, muted }` | Host |
| `host:pause` | `{ paused }` | Host |
| `host:topup` | `{ playerId, amount }` | Host, between hands |
| `host:reset-stacks` | `{}` | Host, between hands |
| `host:bomb-pot` | `{ ante }` | Host; applies to next hand |
| `player:sit-out` | `{ sittingOut }` | Seated player, between hands |
| `table:leave` | `{}` | Seated player, between hands |
| `chat:send` | string, max 300 characters | Seated, unmuted player |

Initial settings: `variant`, `betting`, `smallBlind`, `bigBlind`, `startingStack`, `seatCount` (2–9), `turnTimerSeconds` (5–300), optional `discardSchedule`, and `doubleBoard`.

## Phase 2 limits

Tables, reconnect tokens, chat history, and hand state currently live in process memory. Reconnect works while the server process remains alive; restart persistence belongs to the database phase. Authentication, durable hand logs, and a browser UI are also later phases. Run one server process per deployment until shared storage and cross-process coordination are added.
