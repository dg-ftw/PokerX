# PokerX

Private, invite-only poker website project for play-money games with friends.

## Current status

- **Phase 1 (Complete)**: TypeScript poker engine for Hold'em, 3-Card Texas, PLO4/5, Pineapple 3/4/5 (with customizable discard schedules), Bomb Pots, and Double Board. Fully tested with 55 unit tests + 1,400 randomized fuzz hands.
- **Phase 2 (Complete)**: Real-time Socket.IO server for private tables, invite codes, player-safe state (hole cards hidden), reconnection tokens, turn & discard timers with auto-actions, full host controls (settings, kick, transfer, mute, pause, top-up, reset stacks, bomb pots), and table chat. Tested with 41 unit/integration tests and a 3-client variant simulator.
- **Next**: Phase 3 React lobby and mobile table interface.

## Quick start

Requirements: Node.js 20.19+ and npm.

```powershell
cd poker-engine
npm install

# Run all 96 unit and Socket.IO integration tests
npm test

# Run TypeScript typecheck
npm run typecheck

# Run 1,400-hand engine simulation across all variants
npm run simulate

# Run 3-client Socket.IO terminal simulation (plays all variants end-to-end)
npx tsx scripts/test-clients.ts

# Start the real-time server
npm run server
```

The server listens on port `3001` by default. Set `PORT` to change it, or `CLIENT_ORIGIN` for CORS.

See [poker-engine/server/README.md](poker-engine/server/README.md) for the Socket.IO event reference, [PHASES.md](PHASES.md) for the phase roadmap, and [Poker-Website-SRS.docx](Poker-Website-SRS.docx) for the approved requirements specification.
