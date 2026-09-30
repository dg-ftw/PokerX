# Real-time poker server (Phase 2)

The server exposes a Socket.IO API around the Phase 1 `Hand` engine. It is intentionally separate from the future React client. Start it with `npm run server`; it listens on `PORT` (default `3001`). Set `CLIENT_ORIGIN` to a comma-separated allowlist when hosting the client on another origin.

## Connection flow

Every command accepts an optional Socket.IO acknowledgement callback. Success returns `{ ok: true, data }`; errors return `{ ok: false, error }`. Without an acknowledgement, failures are sent as `request:error`.

1. `table:create` `{ name, settings, deferSeat: true }` creates a private room without assigning the host a seat. `table:join` `{ code, name, deferSeat: true }` adds a player to the room.
2. Share the returned `table.code` or an invite link containing `?table=CODE` with friends.
3. From inside the room, each player claims a position and chooses their own stack with `player:take-seat` `{ seatIndex, stack, sittingOut? }`. `player:stand-up` releases their seat between hands.
4. The create/join/reconnect response contains `playerId` and `reconnectToken`. Store both locally; use `table:reconnect` `{ code, playerId, reconnectToken }` after reconnecting.
5. The host starts hands with `hand:start`. Players act with `hand:act` (`fold`, `check`, `call`, `raise` with a total `to`, or `allin`) and submit private Pineapple discards with `hand:discard` (array of their own card strings).
6. Listen to `table:state` for player-specific state and `chat:message` for table chat. `table:get` returns the caller's latest state.

For older clients, omitting `deferSeat` keeps the original immediate-seat flow and can use optional legacy `settings.startingStack`. The Phase 3 client always defers seat selection and uses the stack chosen at `player:take-seat`.

State is emitted individually to each connected seat using `Hand.getViewFor(playerId)`. Only the current actor receives `legalActions`. Folded and opponent hole cards remain hidden until showdown. Server hand logs are never sent while a hand is live.

## Socket events

| Event | Payload | Access |
| --- | --- | --- |
| `table:create` | `{ name, settings, deferSeat? }` | Any connected client |
| `table:join` | `{ code, name, deferSeat? }` | Anyone with the code |
| `table:reconnect` | `{ code, playerId, reconnectToken }` | Matching seat token |
| `table:get` | `{}` | Room participant |
| `player:take-seat` | `{ seatIndex, stack, sittingOut? }` | Room participant, between hands |
| `player:stand-up` | `{}` | Seated player, between hands |
| `hand:start` | `{}` | Host |
| `hand:act` | engine `Action` | Current actor |
| `hand:discard` | `Card[]` | Player with a pending discard |
| `host:settings` | partial table settings | Host, between hands |
| `host:kick` | `{ playerId }` | Host, between hands |
| `host:transfer` | `{ newHostId }` | Host |
| `host:mute` | `{ playerId, muted }` | Host |
| `host:pause` | `{ paused }` | Host |
| `host:topup` | `{ playerId, amount }` | Host, between hands |
| `host:reset-stacks` | `{}` | Host, between hands |
| `host:bomb-pot` | `{ ante }` | Host; applies to next hand |
| `player:sit-out` | `{ sittingOut }` | Seated player, between hands |
| `table:leave` | `{}` | Seated player, between hands |
| `chat:send` | string, max 300 characters | Seated, unmuted player |

Initial settings: `variant`, `betting`, `smallBlind`, `bigBlind`, `seatCount` (2–9), `turnTimerSeconds` (5–300), optional `discardSchedule`, and `doubleBoard`. The legacy `startingStack` value is ignored by deferred-seat clients; each player supplies their stack when claiming a seat.

## Phase 2 limits

Tables, reconnect tokens, chat history, and hand state currently live in process memory. Reconnect works while the server process remains alive; restart persistence belongs to the database phase. Authentication, durable hand logs, and a browser UI are also later phases. Run one server process per deployment until shared storage and cross-process coordination are added.
