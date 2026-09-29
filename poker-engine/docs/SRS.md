# Software Requirements Specification
## Private Poker Website (Working title: "Friends Poker")

**Version:** 1.0 (Approved) | **Date:** 29 Sep 2026

---

## 1. Introduction

### 1.1 Purpose
This document specifies the requirements for a private, invite-only online poker website for a group of friends. It exists because PokerNow does not support Pineapple variants, and the group wants its own leaderboard and features.

### 1.2 Scope
A web application where friends create private tables, play several poker variants in real time with play-money chips, and track results on a shared leaderboard. No real money is involved.

### 1.3 Definitions
| Term | Meaning |
|---|---|
| PLO | Pot-Limit Omaha (hi-only) |
| Pineapple | Hold'em where each player is dealt extra hole cards and discards down to 2 |
| Bomb pot | Hand where everyone antes and preflop betting is skipped |
| Double board | Two sets of community cards; pot split between them |
| Scoop | Winning both halves of a double-board pot |
| Host | Player who created the table and controls its settings |

---

## 2. Overall Description

### 2.1 Product perspective
Standalone web app with a React frontend, Node.js backend using WebSockets, and a database for accounts and statistics.

### 2.2 Users
- **Player:** joins tables, plays, views leaderboard.
- **Host:** a player with table controls.
- **Admin (site owner):** manages accounts and can reset the leaderboard.

### 2.3 Constraints and assumptions
- Play money only; no payments, no real-money gambling.
- Small private group (roughly 2 to 9 players per table).
- Runs on free-tier hosting.
- Works in modern browsers on desktop and mobile.

---

## 3. Game Variants (Functional Rules)

### 3.1 Supported variants
| ID | Variant | Hole cards | Hand construction |
|---|---|---|---|
| V1 | Hold'em | 2 | Best 5 of 7 (any combination) |
| V2 | 3-card Texas | 3 | Best 5 of 8 (3 hole + 5 board, any combination) |
| V3 | PLO4 | 4 | Exactly 2 hole + exactly 3 board |
| V4 | PLO5 | 5 | Exactly 2 hole + exactly 3 board |
| V5 | Pineapple 3 | 3 → 2 | Discard to 2, then as Hold'em |
| V6 | Pineapple 4 | 4 → 2 | Discard to 2, then as Hold'em |
| V7 | Pineapple 5 | 5 → 2 | Discard to 2, then as Hold'em |

PLO is **hi-only**. Hi/Lo (Omaha 8) is out of scope.

### 3.2 Betting structures
- PLO variants: pot-limit.
- All other variants: host chooses no-limit or pot-limit.

### 3.3 Pineapple discard schedule
- The host configures, per table, on which streets discards happen (preflop, after flop, after turn, after river).
- The total number of discards must equal (starting cards − 2), so every player holds exactly 2 cards at showdown.
- Discards may be spread over streets, one card at a time. Example for Pineapple 4: discard 1 after the flop, betting, discard 1 after the turn, betting, then the river as normal.
- Example presets: Pineapple 3 discards 1 preflop (classic) or after the flop (crazy).
- All players discard simultaneously and in secret. Each player has a discard timer; on expiry a random card is discarded automatically.
- Discarded cards are never revealed.

### 3.4 Bomb pot
- The host manually triggers a bomb pot for the next hand (no vote or automatic triggers).
- Host sets the ante (for example, a multiple of the big blind). Every seated player antes equally; short stacks go all-in for the ante.
- No preflop betting. Cards are dealt and play begins at the flop.
- Works with every variant; for Pineapple, discards follow the configured schedule from the flop onward.
- Can be combined with double board.

### 3.5 Double board
- Available as a **table setting** (all hands) and as a **per-hand toggle**, for any variant.
- Two independent boards (A and B) are dealt, each with flop, turn, and river. Players use the same hole cards on both.
- Betting occurs once per street across both boards.
- The pot is split in half: the best hand on Board A wins one half, and the best hand on Board B wins the other. Ties split only that half. One player winning both halves is a scoop.
- Odd chips go to the winner closest to the left of the dealer button.

---

## 4. Functional Requirements

### 4.1 Accounts
- FR-1: Users register and log in with username and password (Google login optional).
- FR-2: Each user has a profile with display name and avatar.
- FR-3: Admin can disable accounts and reset the leaderboard.

### 4.2 Tables and lobby
- FR-4: A user can create a private table and receives an invite link or room code.
- FR-5: Only users with the link/code can join; no public lobby.
- FR-6: Host settings: variant, betting structure, blinds, starting stack, seat count, turn timer, discard schedule, double board on/off.
- FR-7: Host can kick or mute players, pause and resume the game, top up or reset chip stacks, and trigger a bomb pot.
- FR-8: Players can sit out, leave, and rejoin a table with their stack preserved.

### 4.3 Game engine
- FR-9: The server shuffles and deals; hole cards are sent only to their owner.
- FR-10: The engine handles dealer button, blinds, betting rounds, raises, all-ins, side pots, showdown, and split pots.
- FR-11: Hand evaluation follows the rules in section 3 for every variant.
- FR-12: A turn timer auto-folds (or auto-checks when possible) on expiry.
- FR-13: If a player disconnects, the game continues under timer rules, and the player can reconnect to the same seat.
- FR-14: Hands are logged for history and statistics.

### 4.4 Chat
- FR-15: Each table has a text chat visible to seated players.

### 4.5 Leaderboard and statistics
- FR-16: All-time and per-session profit/loss ranking.
- FR-17: Per-player stats: hands played, hands won, win rate, biggest pot, best hand.
- FR-18: Filter the leaderboard by variant, and view bomb-pot and double-board results separately.
- FR-19: Hand history per table (replay is a later enhancement).

---

## 5. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Fairness | Cryptographically secure shuffle on the server; clients never receive hidden cards |
| NFR-2 | Performance | Game state updates reach all players in under 500 ms under normal conditions |
| NFR-3 | Reliability | Table state survives a brief server restart or player reconnect |
| NFR-4 | Usability | Responsive layout usable on phone screens |
| NFR-5 | Security | Hashed passwords, HTTPS, validation of every client action on the server |
| NFR-6 | Maintainability | Game engine separated from UI and covered by automated tests |
| NFR-7 | Cost | Runs on free-tier hosting |

---

## 6. System Design Overview

- **Frontend:** React.
- **Backend:** Node.js with Socket.IO (WebSockets).
- **Database:** PostgreSQL (or SQLite to start) for users, hand logs, and statistics.
- **Hosting:** free tier (for example Render/Railway/Fly.io for backend, Vercel for frontend).
- **Modules:** auth, lobby/table manager, game engine (deck, evaluator, betting, pots, variants), leaderboard/stats, chat.

---

## 7. Out of Scope
- Real money, deposits, or withdrawals
- Tournaments
- Bots / AI players
- Hi/Lo (Omaha 8)
- Voice and video (use Discord or a call)
- Bomb-pot vote and automatic triggers

---

## 8. Development Phases
1. **Game engine:** deck, hand evaluator, betting, side pots, all variants, discard schedule, bomb pot, double board, with tests.
2. **Real-time tables and UI:** lobby, invite links, table view, chat.
3. **Accounts and leaderboard:** login, stats, filters.
4. **Polish:** animations, sounds, mobile layout, hand history.

---

## 9. Acceptance Criteria (summary)
- Every variant in section 3.1 is playable with correct hand evaluation.
- Pineapple discard schedules validate and play correctly for 3, 4, and 5 cards.
- Bomb pot and double board work alone and together, with correct pot splitting.
- Leaderboard updates after every hand and filters by variant.
- Friends can join via link and play from a phone.
