# Poker Website: Build Phases

Each phase is self-contained. Finish one, commit it, then start the next. Put `poker-srs.md` in the repo as `docs/SRS.md` and give it to any tool or chat you continue in.

**Suggested repo layout**
```
poker/
  docs/SRS.md
  server/        (Node.js, Socket.IO, game engine)
    src/engine/  (deck, evaluator, betting, pots, variants)
    tests/
  client/        (React)
```

---

## Phase 1: Game engine (no UI)
**Goal:** a tested library that can play any hand from start to finish.

Tasks
1. Deck and secure shuffle
2. Hand evaluator (5-card ranking), plus best-of-N for Hold'em (5 of 7) and 3-card Texas (5 of 8)
3. Omaha evaluator: exactly 2 hole + 3 board (PLO4, PLO5)
4. Betting rounds: blinds, button, no-limit and pot-limit raises, all-in, side pots
5. Pineapple discard schedule with validation (total discards = start cards - 2)
6. Bomb pot (ante, skip preflop) and double board (two boards, half-pot split, odd chip rule)
7. Unit tests for each variant, side pots, and split pots

**Done when:** a script can simulate thousands of random hands per variant with no errors, and tests pass.

---

## Phase 2: Real-time server
**Goal:** players can connect and play through sockets (test with a simple client).

Tasks
1. Socket.IO server, table manager, invite codes
2. Send each player only their own hole cards
3. Turn timer, auto-fold, auto-discard
4. Disconnect and reconnect to the same seat
5. Host controls: settings, kick, mute, pause, top-up, trigger bomb pot
6. Table chat

**Done when:** 3+ terminal or test clients can play a full hand of each variant.

---

## Phase 3: Frontend (React)
**Goal:** a usable, mobile-friendly table.

Tasks
1. Landing page, create table, join by link or code
2. Table view: seats, cards, pot, board(s), action buttons, bet slider
3. Discard selection UI for pineapple
4. Host settings panel and bomb pot / double board toggles
5. Chat panel, timers, basic animations

**Done when:** friends can play a full session from their phones.

---

## Phase 4: Accounts, database, leaderboard
**Goal:** persistent users and stats.

Tasks
1. Register and login (hashed passwords)
2. Database: users, hands, results
3. Log every hand
4. Leaderboard: profit/loss, hands played, win rate, biggest pot, best hand
5. Filters: by variant, bomb pots, double board
6. Admin: disable accounts, reset leaderboard

**Done when:** stats update after each hand and survive a server restart.

---

## Phase 5: Deploy and polish
Tasks
1. Deploy backend and frontend on free tiers, use HTTPS
2. Sounds, animations, hand history view
3. Optional: hand replays, more avatars

---

## Prompt to paste when continuing elsewhere
> I'm building a private poker website. The attached SRS is the source of truth. Phases 1 to N-1 are done and committed. Please implement Phase N from PHASES.md, write tests first where possible, and keep the game engine separate from the UI.
