# PokerX

Private, invite-only poker website project for play-money games with friends.

## Current status

- Phase 1: TypeScript poker engine for Hold'em, 3-card Texas, PLO4/5, Pineapple 3/4/5, bomb pots, and double board.
- Phase 2: Socket.IO server for private tables, player-safe state, reconnects, action timers, host controls, and chat.
- Next: Phase 3 React lobby and mobile table interface.

## Run the server

Requirements: Node.js and npm.

```powershell
cd poker-engine
npm install
npm run server
```

The server listens on port `3001` by default. Set `PORT` to change it. Set `CLIENT_ORIGIN` to a comma-separated list of allowed frontend origins when the React client is added.

See [poker-engine/server/README.md](poker-engine/server/README.md) for the Socket.IO protocol and [PHASES.md](PHASES.md) for the roadmap. The approved requirements are in [Poker-Website-SRS.docx](Poker-Website-SRS.docx).
