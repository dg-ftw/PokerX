# PokerX Client (Phase 3)

React + TypeScript web client for PokerX. Responsive on desktop and mobile.

## Features

- **Lobby**:
  - Enter display name.
  - Create table with full configuration:
    - 7 Poker Variants: Texas Hold'em, 3-Card Texas, PLO4, PLO5, Pineapple 3, Pineapple 4, Pineapple 5.
    - Betting structure: No-Limit and Pot-Limit (enforces Pot-Limit for PLO).
    - Customizable blinds, starting stacks, seat counts (2-9), and turn timers (15s-120s).
    - Pineapple discard schedules: Classic (preflop) vs Crazy (flop).
    - Double Board toggle (two boards, split pot).
  - Join table via 6-character room code or invite URL (`?table=CODE`).
- **Table View**:
  - Oval green felt table with 2-9 dynamic seats.
  - Seat displays: Avatar, name, stack, street bet tokens, dealer button (`D`), folded/all-in/sitting-out badges, and turn highlight.
  - Community cards for Single Board and Double Board (`BOARD A` and `BOARD B`).
  - Pot counter and current street indicator (`PREFLOP`, `FLOP`, `TURN`, `RIVER`, `SHOWDOWN`).
- **Betting Controls**:
  - Check / Call with exact amount.
  - Fold.
  - Raise slider with direct number input and quick-bet buttons (`Min`, `1/2 Pot`, `3/4 Pot`, `Pot`, `Max`).
  - All-in shove.
- **Pineapple Discard Selector**:
  - Interactive card picker for hole cards during Pineapple discard phases.
  - Discard counter and confirm discard submission.
- **Host Controls**:
  - Trigger Bomb Pot with custom ante.
  - Toggle Double Board for next hand.
  - Adjust blinds and turn timers between hands.
  - Moderation: Kick, Mute/Unmute, Transfer Host, Top-up chips.
  - Table pause/resume and stack resets.
- **Chat & Hand History**:
  - Table chat with 300 character limit.
  - Hand history log.
- **Mobile Optimized**:
  - Dedicated mobile tab navigation (Table, Players, Chat, Log) to maximize felt space on small screens.
  - Touch-friendly 44px+ tap targets.

## Running Locally

Requirements: Node.js 20.19+ and npm.

```powershell
cd client
npm install
npm run dev
```

The client starts on `http://localhost:5173` and connects to the backend server on `http://localhost:3001` by default. To point to another server, create `.env`:

```env
VITE_SERVER_URL=http://localhost:3001
```

## Production Build

```powershell
npm run build
```
