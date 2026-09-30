# PokerX

Private, invite-only poker website project for play-money games with friends.

## Current status

- **Phase 1 (Complete)**: TypeScript poker engine for Hold'em, 3-Card Texas, PLO4/5, Pineapple 3/4/5 (with customizable discard schedules), Bomb Pots, and Double Board. Fully verified with 55 unit tests + 1,400 fuzz tests.
- **Phase 2 (Complete)**: Real-time Socket.IO server for private tables, invite codes, player-safe state (hole cards hidden), reconnection tokens, turn & discard timers, full host controls, and table chat. Verified with 41 server integration tests and multi-client simulator.
- **Phase 3 (Complete)**: Full-featured, responsive React frontend. Features include:
  - Table creation modal supporting all 7 poker variants, betting structures (No-Limit, Pot-Limit), customizable blinds, starting stacks, seats (2-9), turn timers, Pineapple discard presets, and Double Board.
  - Interactive oval felt table with dynamic seating (avatars, stacks, street bet chips, dealer button, turn highlights, all-in/folded badges, and showdown card reveals).
  - Single Board and Double Board (`BOARD A` and `BOARD B`) community cards.
  - Full betting controls: Check, Call with amount, Fold, All-in shove, and Raise slider with quick-bet buttons (`Min`, `1/2 Pot`, `3/4 Pot`, `Pot`, `Max`).
  - Interactive Pineapple Discard Selection UI for multi-card discards.
  - Host Controls Modal (Bomb Pot scheduling, Double Board toggle, player moderation: kick/mute/host transfer/top-up, pause/resume, and stack resets).
  - Live table chat, hand history log, and showdown payout banners.
  - Mobile-optimized layout with dedicated tabs (Table, Players, Chat, Log) and touch-friendly controls.
- **Next**: Phase 4: Accounts, database, leaderboard.

## Quick start

Requirements: Node.js 20.19+ and npm.

### 1. Start the Real-Time Server (Terminal 1)

```powershell
cd poker-engine
npm install

# Run all 99 automated tests
npm test

# Start the server on :3001
npm run server
```

### 2. Start the Frontend Client (Terminal 2)

```powershell
cd client
npm install

# Build or run development server
npm run dev
```

Open `http://localhost:5173` in your browser. Create a table with your desired settings or join via invite link/code.

See [poker-engine/server/README.md](poker-engine/server/README.md) for the Socket.IO protocol specification, [PHASES.md](PHASES.md) for the project roadmap, and [Poker-Website-SRS.docx](Poker-Website-SRS.docx) for the approved requirements specification.
