import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  VARIANT_LABELS,
  type Ack,
  type Card,
  type ChatMessage,
  type DiscardSchedule,
  type JoinData,
  type PlayerView,
  type TableSettings,
  type TableView,
  type VariantId,
} from './types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:3001`;

const defaultSettings: TableSettings = {
  variant: 'holdem',
  betting: 'nolimit',
  smallBlind: 1,
  bigBlind: 2,
  startingStack: 200,
  seatCount: 6,
  turnTimerSeconds: 30,
  doubleBoard: false,
};

const rankNames: Record<string, string> = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
const suitSymbols: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

function emit<T>(socket: Socket, event: string, payload: unknown = {}): Promise<Ack<T>> {
  return new Promise((resolve) => socket.emit(event, payload, (reply: Ack<T>) => resolve(reply)));
}

function money(n: number | undefined): string {
  if (n === undefined || isNaN(n)) return '0';
  return new Intl.NumberFormat('en-US').format(n);
}

function isCardRed(card: string): boolean {
  return card.endsWith('h') || card.endsWith('d');
}

function readInviteCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return (
      url.searchParams.get('table') ||
      url.searchParams.get('code') ||
      url.pathname.split('/').filter(Boolean).at(-1) ||
      ''
    ).toUpperCase();
  } catch {
    return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [table, setTable] = useState<TableView | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [screenError, setScreenError] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Lobby state
  const [name, setName] = useState(() => localStorage.getItem('pokerx-name') || '');
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.search).get('table') || '');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customSettings, setCustomSettings] = useState<TableSettings>(defaultSettings);

  // Game UI state
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [mobileTab, setMobileTab] = useState<'table' | 'chat' | 'players' | 'log'>('table');
  const [unreadChat, setUnreadChat] = useState(0);
  const [raiseTo, setRaiseTo] = useState(4);
  const [selectedDiscards, setSelectedDiscards] = useState<Card[]>([]);
  const [showHostModal, setShowHostModal] = useState(false);
  const [bombAnteInput, setBombAnteInput] = useState(10);
  const [topupAmounts, setTopupAmounts] = useState<Record<string, number>>({});

  const credentialKey = 'pokerx-session';
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  }, []);

  const reportError = useCallback((message: string) => setScreenError(message), []);

  // Connect socket and restore session
  useEffect(() => {
    const s = io(SERVER_URL, { transports: ['websocket', 'polling'] });
    setSocket(s);

    s.on('connect', () => {
      setConnected(true);
      setScreenError('');
      const saved = localStorage.getItem(credentialKey);
      if (saved) {
        try {
          const session = JSON.parse(saved);
          if (session?.code && session?.playerId && session?.reconnectToken) {
            s.emit('table:reconnect', session, (reply: Ack<JoinData>) => {
              if (reply.ok) {
                setPlayerId(reply.data.playerId);
                setTable(reply.data.table);
              } else {
                localStorage.removeItem(credentialKey);
                setTable(null);
                reportError('Your previous session has ended. Create or join a table.');
              }
            });
          }
        } catch {
          localStorage.removeItem(credentialKey);
        }
      }
    });

    s.on('disconnect', () => setConnected(false));
    s.on('table:state', (state: TableView) => {
      setTable(state);
    });
    s.on('chat:message', (message: ChatMessage) => {
      setChat((items) => [...items.slice(-79), message]);
      setUnreadChat((prev) => (mobileTab === 'chat' ? 0 : prev + 1));
    });
    s.on('table:kicked', (payload: { reason?: string }) => {
      localStorage.removeItem(credentialKey);
      setTable(null);
      setPlayerId('');
      reportError(payload?.reason || 'You were removed from the table.');
    });

    return () => {
      s.disconnect();
    };
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, mobileTab]);

  // Adjust raiseTo when legal actions change
  useEffect(() => {
    if (table?.legalActions?.canRaise) {
      setRaiseTo(table.legalActions.minRaiseTo);
    }
    // Reset selected discards when phase changes
    if (table?.hand?.phase !== 'discarding') {
      setSelectedDiscards([]);
    }
  }, [table?.legalActions, table?.hand?.phase]);

  // Actions
  const handleCreateTable = async (settings: TableSettings) => {
    if (!socket || !connected) {
      reportError('Server is currently offline. Please wait or check your connection.');
      return;
    }
    const cleanName = name.trim();
    if (!cleanName) {
      reportError('Enter your name to create a table.');
      return;
    }
    setBusy(true);
    setScreenError('');
    localStorage.setItem('pokerx-name', cleanName);

    const reply = await emit<JoinData>(socket, 'table:create', {
      name: cleanName,
      settings,
    });
    setBusy(false);

    if (!reply.ok) {
      reportError(reply.error);
      return;
    }

    const { table: createdTable, playerId: myId, reconnectToken } = reply.data;
    localStorage.setItem(credentialKey, JSON.stringify({ code: createdTable.code, playerId: myId, reconnectToken }));
    setPlayerId(myId);
    setTable(createdTable);
    setChat([]);
    setShowCreateModal(false);
    history.replaceState(null, '', `/?table=${createdTable.code}`);
  };

  const handleJoinTable = async () => {
    if (!socket || !connected) {
      reportError('Server is currently offline. Please wait or check your connection.');
      return;
    }
    const cleanName = name.trim();
    if (!cleanName) {
      reportError('Enter your name to join a table.');
      return;
    }
    const code = readInviteCode(joinCode);
    if (!code) {
      reportError('Enter a valid 6-character room code or invite link.');
      return;
    }
    setBusy(true);
    setScreenError('');
    localStorage.setItem('pokerx-name', cleanName);

    const reply = await emit<JoinData>(socket, 'table:join', {
      code,
      name: cleanName,
    });
    setBusy(false);

    if (!reply.ok) {
      reportError(reply.error);
      return;
    }

    const { table: joinedTable, playerId: myId, reconnectToken } = reply.data;
    localStorage.setItem(credentialKey, JSON.stringify({ code: joinedTable.code, playerId: myId, reconnectToken }));
    setPlayerId(myId);
    setTable(joinedTable);
    setChat([]);
    history.replaceState(null, '', `/?table=${joinedTable.code}`);
  };

  const doAction = async (event: string, payload: unknown = {}) => {
    if (!socket) return;
    const reply = await emit(socket, event, payload);
    if (!reply.ok) {
      reportError(reply.error);
    } else {
      setScreenError('');
    }
  };

  const leaveTable = async () => {
    if (socket) {
      await emit(socket, 'table:leave');
    }
    localStorage.removeItem(credentialKey);
    setTable(null);
    setPlayerId('');
    setChat([]);
    history.replaceState(null, '', '/');
  };

  const sendChat = async (e: FormEvent) => {
    e.preventDefault();
    const clean = chatText.trim();
    if (!clean || !socket) return;
    const reply = await emit(socket, 'chat:send', clean);
    if (reply.ok) {
      setChatText('');
    } else {
      reportError(reply.error);
    }
  };

  // Discard logic for Pineapple
  const toggleDiscardCard = (card: Card, needed: number) => {
    setSelectedDiscards((current) => {
      if (current.includes(card)) {
        return current.filter((c) => c !== card);
      }
      if (current.length < needed) {
        return [...current, card];
      }
      return current;
    });
  };

  const submitDiscards = async () => {
    if (!socket || selectedDiscards.length === 0) return;
    const reply = await emit(socket, 'hand:discard', selectedDiscards);
    if (reply.ok) {
      setSelectedDiscards([]);
      setScreenError('');
    } else {
      reportError(reply.error);
    }
  };

  // If not in a room, render Lobby
  if (!table) {
    return (
      <LobbyView
        connected={connected}
        busy={busy}
        name={name}
        setName={setName}
        joinCode={joinCode}
        setJoinCode={setJoinCode}
        error={screenError}
        onCreateClick={() => setShowCreateModal(true)}
        onJoin={handleJoinTable}
        showCreateModal={showCreateModal}
        setShowCreateModal={setShowCreateModal}
        customSettings={customSettings}
        setCustomSettings={setCustomSettings}
        onConfirmCreate={handleCreateTable}
      />
    );
  }

  // Seated player data
  const me = table.players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;
  const hand = table.hand;
  const isMyTurn = table.legalActions?.playerId === playerId;
  const legal = table.legalActions;
  const myHandPlayer = hand?.players.find((p) => p.id === playerId);
  const myHole = myHandPlayer?.hole ?? null;
  const neededDiscards = hand?.phase === 'discarding' ? (hand.pendingDiscards[playerId] ?? 0) : 0;

  // Active players count
  const eligiblePlayers = table.players.filter((p) => !p.sittingOut && p.stack > 0);
  const canStartHand = isHost && (!hand || hand.phase === 'complete') && eligiblePlayers.length >= 2 && !table.paused;

  // Seats array matching table.settings.seatCount
  const hasExplicitSeat = table.players.some((p) => p.seatIndex !== undefined && p.seatIndex !== null);
  const seatPositions = Array.from({ length: table.settings.seatCount }, (_, i) => {
    if (hasExplicitSeat) {
      return table.players.find((p) => p.seatIndex === i) ?? null;
    }
    return table.players[i] ?? null;
  });

  // Quick bet calculations
  const calculatePotFraction = (fraction: number): number => {
    if (!legal || !hand) return 0;
    const callCost = legal.toCall;
    const potAfterCall = hand.pot + callCost;
    const raiseSize = Math.round(potAfterCall * fraction);
    const totalTo = hand.currentBet + raiseSize;
    return Math.max(legal.minRaiseTo, Math.min(totalTo, legal.maxRaiseTo));
  };

  return (
    <main className="room-page">
      {toastMessage && <div className="toast-notification">{toastMessage}</div>}

      {/* Header */}
      <header className="room-header">
        <a className="brand brand-small" href="/" onClick={(e) => { e.preventDefault(); void leaveTable(); }}>
          <span className="brand-mark">♠</span>
          <span>poker<span className="brand-accent">x</span></span>
        </a>

        <div className="room-code">
          <span className="live-dot" /> PRIVATE TABLE <strong>{table.code}</strong>
          <span className="variant-tag">{VARIANT_LABELS[table.settings.variant]}</span>
          {table.settings.doubleBoard && <span className="double-board-badge">2 BOARDS</span>}
        </div>

        <div className="header-actions">
          {isHost && (
            <button className="quiet-button host-btn" onClick={() => setShowHostModal(true)}>
              ⚙ <span>Host Controls</span>
            </button>
          )}

          <button
            className="quiet-button invite-button"
            onClick={async () => {
              const url = `${location.origin}/?table=${table.code}`;
              await navigator.clipboard?.writeText(url);
              showToast('Invite link copied to clipboard!');
            }}
          >
            ↗ <span>Copy Invite</span>
          </button>

          <button
            className={`quiet-button ${me?.sittingOut ? 'sitting-out-btn' : ''}`}
            onClick={() => void doAction('player:sit-out', { sittingOut: !me?.sittingOut })}
          >
            {me?.sittingOut ? 'I am Ready' : 'Sit Out'}
          </button>

          <button className="quiet-button leave-button" onClick={() => void leaveTable()}>
            Leave
          </button>
        </div>
      </header>

      {/* Mobile navigation tab buttons */}
      <nav className="mobile-nav">
        <button className={mobileTab === 'table' ? 'active' : ''} onClick={() => setMobileTab('table')}>
          Table
        </button>
        <button className={mobileTab === 'players' ? 'active' : ''} onClick={() => setMobileTab('players')}>
          Players ({table.players.length})
        </button>
        <button className={mobileTab === 'chat' ? 'active' : ''} onClick={() => { setMobileTab('chat'); setUnreadChat(0); }}>
          Chat {unreadChat > 0 && <span className="unread-dot">{unreadChat}</span>}
        </button>
        {table.handLog.length > 0 && (
          <button className={mobileTab === 'log' ? 'active' : ''} onClick={() => setMobileTab('log')}>
            Hand Log
          </button>
        )}
      </nav>

      {/* Main room layout */}
      <div className="room-layout">
        {/* Game Felt & Action Bar Area */}
        <section className={`game-area ${mobileTab !== 'table' ? 'mobile-hidden' : ''}`}>
          {/* Table Meta */}
          <div className="table-meta">
            <div>
              <span className="eyebrow">
                {table.settings.betting === 'potlimit' ? 'POT-LIMIT' : 'NO-LIMIT'} · {table.settings.turnTimerSeconds}S TIMER
              </span>
              <h1>{VARIANT_LABELS[table.settings.variant]}</h1>
            </div>
            <div className="blinds">
              <span>BLINDS</span>
              <strong>${money(table.settings.smallBlind)} <i>/</i> ${money(table.settings.bigBlind)}</strong>
            </div>
          </div>

          {/* Table Stage (Oval Felt) */}
          <div className="table-stage">
            <div className="outer-rail" />
            <div className="felt-table">
              <div className="felt-grain" />

              {/* Center Table Details (Pot, Community Cards, Street) */}
              <div className="table-center">
                {table.nextHandBombAnte !== null && (
                  <div className="bomb-pot-badge">💣 NEXT HAND: BOMB POT (${money(table.nextHandBombAnte)} ANTE)</div>
                )}

                {hand ? (
                  <>
                    <div className="pot-pill">
                      POT <strong>${money(hand.pot)}</strong>
                    </div>

                    {/* Community Cards: Supports Single & Double Board */}
                    <div className="boards-container">
                      {hand.boards.map((boardCards, bIdx) => (
                        <div key={bIdx} className="board-row">
                          {hand.boards.length > 1 && (
                            <span className="board-label">BOARD {String.fromCharCode(65 + bIdx)}</span>
                          )}
                          <div className="community-cards">
                            {boardCards.map((card, cIdx) => (
                              <CardFace key={`${card}-${cIdx}`} card={card} />
                            ))}
                            {Array.from({ length: Math.max(0, 5 - boardCards.length) }, (_, emptyIdx) => (
                              <div key={`empty-${emptyIdx}`} className="playing-card empty-card" />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="street-label">
                      {hand.phase === 'complete' ? 'SHOWDOWN & PAYOUT' : hand.street.toUpperCase()}
                    </div>
                  </>
                ) : (
                  <div className="table-idle-state">
                    <div className="waiting-title">Friends Poker Table</div>
                    <div className="waiting-subtitle">
                      {table.players.length} player{table.players.length === 1 ? '' : 's'} at the table.
                      {eligiblePlayers.length < 2 && ' Waiting for at least 2 players with chips.'}
                    </div>

                    {isHost && (
                      <button
                        className="primary-button start-button"
                        disabled={!canStartHand}
                        onClick={() => void doAction('hand:start')}
                      >
                        {eligiblePlayers.length < 2 ? 'Need 2+ Players to Deal' : 'Deal First Hand'} <span>↗</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Seated Players around Felt */}
              {seatPositions.map((player, idx) => (
                <SeatSpot
                  key={idx}
                  index={idx}
                  count={table.settings.seatCount}
                  player={player}
                  isMe={player?.id === playerId}
                  isTurn={player?.id === hand?.toAct}
                  isButton={player?.id === hand?.button}
                  streetBet={hand?.players.find((p) => p.id === player?.id)?.streetBet}
                  isFolded={hand?.players.find((p) => p.id === player?.id)?.folded}
                  isAllIn={hand?.players.find((p) => p.id === player?.id)?.allIn}
                  revealedHole={hand?.result ? hand.result.hands[player?.id ?? '']?.hole : null}
                  onTakeSeat={() => {
                    if (!player && me && (me.seatIndex === null || me.seatIndex === undefined)) {
                      void doAction('player:take-seat', { seatIndex: idx, stack: table.settings.startingStack });
                    }
                  }}
                />
              ))}
            </div>
          </div>

          {/* Table Footer Meta */}
          <div className="table-footer">
            <span>
              <i className="live-dot" /> {table.players.filter((p) => p.connected).length} Connected
            </span>
            <span>HAND #{table.handNumber}</span>
            <span>CODE: {table.code}</span>
          </div>

          {/* My Hole Cards Bar */}
          {hand && myHole && (
            <div className="my-cards-bar">
              <div>
                <span className="eyebrow">YOUR HAND ({myHole.length} CARDS)</span>
                <div className="hole-cards">
                  {myHole.map((card, idx) => (
                    <CardFace key={`${card}-${idx}`} card={card} />
                  ))}
                </div>
              </div>
              <div className="my-stack">
                <span>YOUR STACK</span>
                <strong>${money(me?.stack ?? 0)}</strong>
              </div>
            </div>
          )}

          {/* Pineapple Discard Selection UI */}
          {hand && hand.phase === 'discarding' && neededDiscards > 0 && myHole && (
            <div className="discard-selection-banner">
              <div className="discard-prompt">
                <h3>Select {neededDiscards} card{neededDiscards > 1 ? 's' : ''} to discard</h3>
                <p>Click your hole cards below to choose which cards to discard down to 2.</p>
              </div>

              <div className="discard-card-picker">
                {myHole.map((card) => {
                  const isSelected = selectedDiscards.includes(card);
                  return (
                    <button
                      key={card}
                      type="button"
                      className={`discard-card-button ${isSelected ? 'selected-for-discard' : ''}`}
                      onClick={() => toggleDiscardCard(card, neededDiscards)}
                    >
                      <CardFace card={card} />
                      {isSelected && <span className="discard-marker">DISCARD</span>}
                    </button>
                  );
                })}
              </div>

              <div className="discard-actions">
                <span className="discard-counter">
                  {selectedDiscards.length} / {neededDiscards} selected
                </span>
                <button
                  className="primary-button"
                  disabled={selectedDiscards.length !== neededDiscards}
                  onClick={() => void submitDiscards()}
                >
                  Confirm Discards <span>✓</span>
                </button>
              </div>
            </div>
          )}

          {/* Betting Action Bar */}
          {hand && (
            <div className="action-bar">
              {isMyTurn && hand.phase === 'betting' && legal ? (
                <div className="action-active-controls">
                  <div className="action-prompt">
                    <span className="turn-pulse-dot" />
                    <strong>Your Turn:</strong>{' '}
                    {legal.canCheck
                      ? 'You can check or bet.'
                      : `Action on you — $${money(legal.callAmount)} to call.`}
                  </div>

                  <div className="action-controls">
                    {/* Fold */}
                    <button className="action-secondary action-fold" onClick={() => void doAction('hand:act', { type: 'fold' })}>
                      Fold
                    </button>

                    {/* Check or Call */}
                    <button
                      className="action-secondary action-call"
                      onClick={() => void doAction('hand:act', { type: legal.canCheck ? 'check' : 'call' })}
                    >
                      {legal.canCheck ? 'Check' : `Call $${money(legal.callAmount)}`}
                    </button>

                    {/* Raise controls */}
                    {legal.canRaise && (
                      <div className="raise-widget">
                        <div className="quick-bets">
                          <button type="button" onClick={() => setRaiseTo(legal.minRaiseTo)}>
                            Min
                          </button>
                          <button type="button" onClick={() => setRaiseTo(calculatePotFraction(0.5))}>
                            1/2 Pot
                          </button>
                          <button type="button" onClick={() => setRaiseTo(calculatePotFraction(0.75))}>
                            3/4 Pot
                          </button>
                          <button type="button" onClick={() => setRaiseTo(calculatePotFraction(1))}>
                            Pot
                          </button>
                          <button type="button" onClick={() => setRaiseTo(legal.maxRaiseTo)}>
                            Max
                          </button>
                        </div>

                        <div className="slider-row">
                          <input
                            type="range"
                            min={legal.minRaiseTo}
                            max={legal.maxRaiseTo}
                            step={table.settings.bigBlind}
                            value={raiseTo}
                            onChange={(e) => setRaiseTo(Number(e.target.value))}
                          />
                          <input
                            type="number"
                            className="raise-number-input"
                            min={legal.minRaiseTo}
                            max={legal.maxRaiseTo}
                            value={raiseTo}
                            onChange={(e) => setRaiseTo(Number(e.target.value))}
                          />
                        </div>

                        <button
                          className="primary-button raise-submit-btn"
                          onClick={() =>
                            void doAction('hand:act', {
                              type: 'raise',
                              to: Math.max(legal.minRaiseTo, Math.min(raiseTo, legal.maxRaiseTo)),
                            })
                          }
                        >
                          Raise to ${money(raiseTo)} <span>↗</span>
                        </button>
                      </div>
                    )}

                    {/* All In Shove */}
                    <button
                      className="all-in-button"
                      onClick={() => void doAction('hand:act', { type: 'allin' })}
                    >
                      All In (${money(legal.allInTo)})
                    </button>
                  </div>
                </div>
              ) : hand.phase === 'complete' ? (
                <div className="hand-complete-bar">
                  <div className="result-headline">
                    <strong>Hand Finished:</strong>{' '}
                    {hand.result?.reason === 'showdown' ? 'Showdown reached' : 'Folded around'}
                  </div>

                  {isHost && (
                    <button
                      className="primary-button"
                      disabled={eligiblePlayers.length < 2}
                      onClick={() => void doAction('hand:start')}
                    >
                      Deal Next Hand <span>↗</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="action-waiting-prompt">
                  {hand.phase === 'discarding'
                    ? 'Pineapple discard phase: Waiting for players to select discards...'
                    : `Waiting for ${table.players.find((p) => p.id === hand.toAct)?.name ?? 'player'} to act...`}
                </div>
              )}
            </div>
          )}

          {/* Showdown Result Summary Modal / Banner */}
          {hand?.phase === 'complete' && hand.result && (
            <div className="showdown-summary-banner">
              <h3>🏆 Showdown Results</h3>
              <div className="showdown-pots-list">
                {hand.result.pots.map((pot, pIdx) => (
                  <div key={pIdx} className="pot-award-row">
                    <strong>Pot {pIdx + 1} (${money(pot.amount)}):</strong>
                    {pot.boards.map((b, bIdx) => (
                      <span key={bIdx} className="board-winner-item">
                        {pot.boards.length > 1 && `[Board ${String.fromCharCode(65 + b.board)}] `}
                        {b.winners.map((wId) => table.players.find((p) => p.id === wId)?.name ?? wId).join(', ')} won ${money(b.amount)} ({b.winningHand})
                      </span>
                    ))}
                  </div>
                ))}
              </div>

              <div className="net-results-row">
                {Object.entries(hand.result.net).map(([pId, profit]) => {
                  const pName = table.players.find((p) => p.id === pId)?.name ?? pId;
                  return (
                    <span key={pId} className={`net-chip ${profit >= 0 ? 'profit' : 'loss'}`}>
                      {pName}: {profit >= 0 ? `+$${money(profit)}` : `-$${money(Math.abs(profit))}`}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Sidebar: Players List & Chat Panel */}
        <aside className="side-panel">
          {/* Players Panel */}
          <section className={`players-card ${mobileTab !== 'players' && mobileTab !== 'table' ? 'mobile-hidden' : ''}`}>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">THE TABLE</span>
                <h2>Players <span>{table.players.length}</span></h2>
              </div>
              <span className="capacity">
                {table.players.length} / {table.settings.seatCount} SEATS
              </span>
            </div>

            <div className="player-list">
              {table.players.map((player) => (
                <div key={player.id} className={`player-row ${player.id === playerId ? 'player-row-me' : ''}`}>
                  <div className="avatar">{player.name.slice(0, 1).toUpperCase()}</div>
                  <div className="player-info">
                    <strong>
                      {player.name}
                      {player.id === playerId && <small> (YOU)</small>}
                      {player.isHost && <span className="host-badge">HOST</span>}
                    </strong>
                    <span>
                      {player.sittingOut ? 'Sitting Out' : player.connected ? 'Active' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="player-chips">
                    <strong>${money(player.stack)}</strong>
                    <span>{player.connected ? 'ONLINE' : 'AWAY'}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Stand up option if seated with seatIndex */}
            {me && me.seatIndex !== null && me.seatIndex !== undefined && (!hand || hand.phase === 'complete') && (
              <div style={{ padding: '8px 14px' }}>
                <button
                  type="button"
                  className="quiet-button"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => void doAction('player:stand-up')}
                >
                  Stand Up
                </button>
              </div>
            )}
          </section>

          {/* Chat Panel */}
          <section className={`room-chat ${mobileTab !== 'chat' && mobileTab !== 'table' ? 'mobile-hidden' : ''}`}>
            <div className="chat-heading">
              <div>
                <span className="eyebrow">TABLE CHAT</span>
                <h2>Messages</h2>
              </div>
              <span className="chat-icon">💬</span>
            </div>

            <div className="chat-messages">
              {chat.length === 0 ? (
                <div className="chat-empty">
                  <span>♧</span>
                  <p>Chat is quiet. Say hello to the table!</p>
                </div>
              ) : (
                chat.map((msg, i) => (
                  <div key={`${msg.at}-${i}`} className="chat-line">
                    <strong>{msg.name}</strong>
                    <span>{msg.message}</span>
                  </div>
                ))
              )}
              <div ref={chatBottomRef} />
            </div>

            <form className="chat-form" onSubmit={sendChat}>
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Say something..."
                maxLength={300}
                disabled={me?.muted}
              />
              <button type="submit" disabled={!chatText.trim() || me?.muted} aria-label="Send message">
                ↗
              </button>
            </form>
            {me?.muted && <div className="muted-notice">You are muted at this table.</div>}
          </section>

          {/* Hand Log Panel (when tab selected) */}
          {mobileTab === 'log' && (
            <section className="hand-log-panel">
              <div className="panel-heading">
                <h2>Hand History</h2>
              </div>
              <div className="hand-log-content">
                {table.handLog.map((line, i) => (
                  <div key={i} className="log-line">{line}</div>
                ))}
              </div>
            </section>
          )}

          {/* Connection Status & Errors */}
          <div className="server-status">
            <span className={connected ? 'live-dot' : 'offline-dot'} />
            {connected ? 'Connected to server' : 'Reconnecting...'}
            {screenError && <span className="inline-error">{screenError}</span>}
          </div>
        </aside>
      </div>

      {/* Host Controls Modal */}
      {showHostModal && isHost && (
        <HostModal
          table={table}
          bombAnteInput={bombAnteInput}
          setBombAnteInput={setBombAnteInput}
          topupAmounts={topupAmounts}
          setTopupAmounts={setTopupAmounts}
          onClose={() => setShowHostModal(false)}
          onAction={doAction}
        />
      )}
    </main>
  );
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------

function CardFace({ card }: { card: Card }) {
  const rank = card[0];
  const suit = card[1];
  return (
    <div className={`playing-card ${isCardRed(card) ? 'red-card' : ''}`}>
      <b>{rankNames[rank] ?? rank}</b>
      <span>{suitSymbols[suit] ?? suit}</span>
    </div>
  );
}

function SeatSpot({
  index,
  count,
  player,
  isMe,
  isTurn,
  isButton,
  streetBet,
  isFolded,
  isAllIn,
  revealedHole,
  onTakeSeat,
}: {
  index: number;
  count: number;
  player: PlayerView | null;
  isMe: boolean;
  isTurn: boolean;
  isButton: boolean;
  streetBet?: number;
  isFolded?: boolean;
  isAllIn?: boolean;
  revealedHole?: Card[] | null;
  onTakeSeat: () => void;
}) {
  const angle = -90 + (index * 360) / count;
  const radius = count <= 4 ? 40 : count <= 6 ? 42 : 44;
  const left = 50 + Math.cos((angle * Math.PI) / 180) * radius;
  const top = 50 + Math.sin((angle * Math.PI) / 180) * (radius * 0.77);

  return (
    <div className={`seat-position seat-${index} ${isTurn ? 'seat-turn-highlight' : ''}`} style={{ left: `${left}%`, top: `${top}%` }}>
      {player ? (
        <div className={`occupied-seat ${isMe ? 'occupied-seat-me' : ''} ${isFolded ? 'seat-folded' : ''}`}>
          <div className="seat-avatar">
            {player.name.slice(0, 1).toUpperCase()}
            {isButton && <span className="dealer-chip-badge" title="Dealer Button">D</span>}
          </div>

          <div className="seat-details">
            <strong>
              {player.name}
              {player.isHost && <small> 👑</small>}
            </strong>
            <span>${money(player.stack)}</span>
            {isAllIn && <span className="badge-allin">ALL IN</span>}
            {isFolded && <span className="badge-folded">FOLDED</span>}
            {player.sittingOut && <span className="badge-sittingout">AWAY</span>}
          </div>

          {/* Chips on felt for current street */}
          {streetBet !== undefined && streetBet > 0 && (
            <div className="seat-street-chips">
              <span className="chip-token">🪙</span> ${money(streetBet)}
            </div>
          )}

          {/* Revealed hole cards at showdown */}
          {revealedHole && revealedHole.length > 0 && (
            <div className="seat-revealed-cards">
              {revealedHole.map((c, i) => (
                <CardFace key={i} card={c} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="open-seat" onClick={onTakeSeat} role="button" tabIndex={0}>
          <span className="seat-plus">+</span>
          <span>Seat {index + 1} Open</span>
        </div>
      )}
    </div>
  );
}

// Host Controls Modal
function HostModal({
  table,
  bombAnteInput,
  setBombAnteInput,
  topupAmounts,
  setTopupAmounts,
  onClose,
  onAction,
}: {
  table: TableView;
  bombAnteInput: number;
  setBombAnteInput: (n: number) => void;
  topupAmounts: Record<string, number>;
  setTopupAmounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  onClose: () => void;
  onAction: (event: string, payload?: unknown) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'game' | 'players' | 'settings'>('game');
  const [sb, setSb] = useState(table.settings.smallBlind);
  const [bb, setBb] = useState(table.settings.bigBlind);
  const [timerSec, setTimerSec] = useState(table.settings.turnTimerSeconds);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="host-modal">
        <div className="modal-header">
          <h2>Host Table Controls</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="host-modal-tabs">
          <button className={activeTab === 'game' ? 'active' : ''} onClick={() => setActiveTab('game')}>
            Game Actions
          </button>
          <button className={activeTab === 'players' ? 'active' : ''} onClick={() => setActiveTab('players')}>
            Manage Players
          </button>
          <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>
            Table Settings
          </button>
        </div>

        <div className="host-modal-body">
          {activeTab === 'game' && (
            <div className="host-tab-content">
              {/* Bomb Pot Trigger */}
              <div className="control-group">
                <h3>💣 Bomb Pot</h3>
                <p>Schedule a Bomb Pot for the next hand where everyone antes and preflop is skipped.</p>
                <div className="inline-action-row">
                  <label>Ante Amount ($):</label>
                  <input
                    type="number"
                    min={1}
                    value={bombAnteInput}
                    onChange={(e) => setBombAnteInput(Number(e.target.value))}
                  />
                  <button
                    className="primary-button"
                    onClick={() => void onAction('host:bomb-pot', { ante: bombAnteInput })}
                  >
                    Schedule Bomb Pot
                  </button>
                </div>
                {table.nextHandBombAnte !== null && (
                  <div className="scheduled-indicator">
                    ✓ Bomb Pot scheduled with ${money(table.nextHandBombAnte)} ante!
                  </div>
                )}
              </div>

              {/* Double Board Toggle */}
              <div className="control-group">
                <h3>Double Board</h3>
                <p>Deal two boards (Board A and Board B) and split the pot between winners of each board.</p>
                <button
                  className="action-secondary"
                  onClick={() => void onAction('host:settings', { doubleBoard: !table.settings.doubleBoard })}
                >
                  {table.settings.doubleBoard ? 'Disable Double Board' : 'Enable Double Board'}
                </button>
              </div>

              {/* Pause / Resume */}
              <div className="control-group">
                <h3>Table Pause</h3>
                <p>Pause gameplay and action timers for breaks.</p>
                <button
                  className="action-secondary"
                  onClick={() => void onAction('host:pause', { paused: !table.paused })}
                >
                  {table.paused ? 'Resume Game ▶' : 'Pause Table ⏸'}
                </button>
              </div>

              {/* Reset All Stacks */}
              <div className="control-group">
                <h3>Reset Chip Stacks</h3>
                <p>Reset every seated player's stack back to the starting stack (${money(table.settings.startingStack)}).</p>
                <button
                  className="action-secondary danger-button"
                  onClick={() => void onAction('host:reset-stacks')}
                >
                  Reset All Stacks
                </button>
              </div>
            </div>
          )}

          {activeTab === 'players' && (
            <div className="host-tab-content">
              <div className="player-manage-list">
                {table.players.map((p) => (
                  <div key={p.id} className="player-manage-row">
                    <div>
                      <strong>{p.name}</strong> {p.isHost && <span className="host-badge">HOST</span>}
                      <div>Stack: ${money(p.stack)}</div>
                    </div>

                    <div className="manage-buttons">
                      {/* Top up stack */}
                      <input
                        type="number"
                        placeholder="Add $"
                        min={1}
                        style={{ width: '70px' }}
                        value={topupAmounts[p.id] || ''}
                        onChange={(e) =>
                          setTopupAmounts({ ...topupAmounts, [p.id]: Number(e.target.value) })
                        }
                      />
                      <button
                        className="quiet-button"
                        onClick={() => {
                          const amt = topupAmounts[p.id];
                          if (amt > 0) {
                            void onAction('host:topup', { playerId: p.id, amount: amt });
                            setTopupAmounts({ ...topupAmounts, [p.id]: 0 });
                          }
                        }}
                      >
                        + Top Up
                      </button>

                      {/* Mute */}
                      <button
                        className="quiet-button"
                        onClick={() => void onAction('host:mute', { playerId: p.id, muted: !p.muted })}
                      >
                        {p.muted ? 'Unmute' : 'Mute'}
                      </button>

                      {/* Transfer Host */}
                      {!p.isHost && (
                        <button
                          className="quiet-button"
                          onClick={() => void onAction('host:transfer', { newHostId: p.id })}
                        >
                          Make Host
                        </button>
                      )}

                      {/* Kick */}
                      {!p.isHost && (
                        <button
                          className="quiet-button danger-button"
                          onClick={() => void onAction('host:kick', { playerId: p.id })}
                        >
                          Kick
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="host-tab-content">
              <div className="control-group">
                <h3>Blinds & Timers</h3>
                <div className="field-grid">
                  <label>
                    Small Blind:
                    <input type="number" min={1} value={sb} onChange={(e) => setSb(Number(e.target.value))} />
                  </label>
                  <label>
                    Big Blind:
                    <input type="number" min={sb} value={bb} onChange={(e) => setBb(Number(e.target.value))} />
                  </label>
                  <label>
                    Turn Timer (seconds):
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={timerSec}
                      onChange={(e) => setTimerSec(Number(e.target.value))}
                    />
                  </label>
                </div>
                <button
                  className="primary-button"
                  style={{ marginTop: '16px' }}
                  onClick={() => void onAction('host:settings', { smallBlind: sb, bigBlind: bb, turnTimerSeconds: timerSec })}
                >
                  Save Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Lobby View & Create Table Modal
// -----------------------------------------------------------------------------

function LobbyView({
  connected,
  busy,
  name,
  setName,
  joinCode,
  setJoinCode,
  error,
  onCreateClick,
  onJoin,
  showCreateModal,
  setShowCreateModal,
  customSettings,
  setCustomSettings,
  onConfirmCreate,
}: {
  connected: boolean;
  busy: boolean;
  name: string;
  setName: (s: string) => void;
  joinCode: string;
  setJoinCode: (s: string) => void;
  error: string;
  onCreateClick: () => void;
  onJoin: () => void;
  showCreateModal: boolean;
  setShowCreateModal: (b: boolean) => void;
  customSettings: TableSettings;
  setCustomSettings: React.Dispatch<React.SetStateAction<TableSettings>>;
  onConfirmCreate: (s: TableSettings) => void;
}) {
  return (
    <main className="lobby-page">
      <div className="lobby-top">
        <a className="brand" href="/">
          <span className="brand-mark">♠</span>
          <span>poker<span className="brand-accent">x</span></span>
        </a>
        <span className="lobby-status">
          <i className={connected ? 'live-dot' : 'offline-dot'} />
          {connected ? 'POKER SERVER ONLINE' : 'CONNECTING TO SERVER...'}
        </span>
      </div>

      <div className="lobby-grid">
        <section className="hero-copy">
          <div className="hero-kicker">
            <span /> PRIVATE POKER NIGHTS
          </div>
          <h1>
            Play poker<br />
            with <em>friends.</em>
          </h1>
          <p>
            Private, invite-only poker tables featuring Pineapple, Omaha, 3-Card Texas,
            Bomb Pots, and Double Boards. No real money—just pure game night fun.
          </p>

          <div className="hero-feature">
            <div className="feature-icon">🍍</div>
            <div>
              <strong>Pineapple & Omaha Variants</strong>
              <span>Classic & Crazy Pineapple (3, 4, 5 cards), PLO4, and PLO5.</span>
            </div>
          </div>

          <div className="hero-feature">
            <div className="feature-icon">💣</div>
            <div>
              <strong>Bomb Pots & Double Board</strong>
              <span>Host-triggered bomb pots and split-pot double boards.</span>
            </div>
          </div>

          <div className="decor-cards">
            <div className="playing-card decor-card decor-one">
              <b>A</b><span>♠</span>
            </div>
            <div className="playing-card decor-card decor-two">
              <b>K</b><span className="red-suit">♥</span>
            </div>
            <div className="sparkle">✳</div>
          </div>
        </section>

        {/* Lobby Entry Card */}
        <section className="entry-card">
          <div className="entry-card-top">
            <span className="eyebrow">JOIN OR CREATE</span>
            <div className="card-decoration">✳</div>
          </div>
          <h2>Pull up a chair.</h2>
          <p className="entry-subtitle">Enter your name to start playing.</p>

          <label className="field-label" htmlFor="player-name">YOUR DISPLAY NAME</label>
          <input
            id="player-name"
            className="text-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ace"
            maxLength={24}
          />

          <button
            className="primary-button create-button"
            onClick={onCreateClick}
            disabled={busy || !connected || !name.trim()}
          >
            Create a Private Table <span>↗</span>
          </button>

          <div className="or-divider">
            <span /> OR JOIN WITH ROOM CODE <span />
          </div>

          <label className="field-label" htmlFor="table-code">ROOM CODE OR INVITE LINK</label>
          <div className="join-field">
            <span>⌁</span>
            <input
              id="table-code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="e.g. ABCDEF or paste link"
              onKeyDown={(e) => { if (e.key === 'Enter') onJoin(); }}
            />
            <button onClick={onJoin} disabled={busy || !connected || !name.trim() || !joinCode.trim()} aria-label="Join table">
              →
            </button>
          </div>

          {error && <p className="form-error">{error}</p>}
        </section>
      </div>

      <footer className="lobby-footer">
        <span>POKERX © 2026</span>
        <span>PRIVATE GAMES FOR FRIENDS</span>
      </footer>

      {/* Table Creation Settings Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowCreateModal(false)}>
          <div className="create-table-modal">
            <div className="modal-header">
              <h2>Configure New Table</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>

            <div className="modal-form-content">
              {/* Variant Selector */}
              <label className="field-label">POKER VARIANT</label>
              <select
                className="select-field"
                value={customSettings.variant}
                onChange={(e) => {
                  const v = e.target.value as VariantId;
                  const forcedPot = v === 'plo4' || v === 'plo5';
                  let discards: DiscardSchedule | undefined = undefined;
                  if (v === 'pineapple3') discards = { preflop: 1 };
                  else if (v === 'pineapple4') discards = { flop: 1, turn: 1 };
                  else if (v === 'pineapple5') discards = { preflop: 1, flop: 1, turn: 1 };

                  setCustomSettings({
                    ...customSettings,
                    variant: v,
                    betting: forcedPot ? 'potlimit' : customSettings.betting,
                    discardSchedule: discards,
                  });
                }}
              >
                <option value="holdem">Texas Hold'em (2 Cards)</option>
                <option value="texas3">3-Card Texas (3 Cards, Best 5 of 8)</option>
                <option value="plo4">Pot-Limit Omaha 4 (4 Cards, 2 Hole + 3 Board)</option>
                <option value="plo5">Pot-Limit Omaha 5 (5 Cards, 2 Hole + 3 Board)</option>
                <option value="pineapple3">Pineapple 3 (3 Cards, Discard 1)</option>
                <option value="pineapple4">Pineapple 4 (4 Cards, Discard 2)</option>
                <option value="pineapple5">Pineapple 5 (5 Cards, Discard 3)</option>
              </select>

              {/* Betting Structure */}
              <label className="field-label">BETTING STRUCTURE</label>
              <select
                className="select-field"
                value={customSettings.betting}
                disabled={customSettings.variant === 'plo4' || customSettings.variant === 'plo5'}
                onChange={(e) => setCustomSettings({ ...customSettings, betting: e.target.value as 'nolimit' | 'potlimit' })}
              >
                <option value="nolimit">No-Limit</option>
                <option value="potlimit">Pot-Limit</option>
              </select>

              {/* Discard Presets for Pineapple */}
              {customSettings.variant.startsWith('pineapple') && (
                <div className="pineapple-schedule-picker">
                  <label className="field-label">DISCARD SCHEDULE</label>
                  {customSettings.variant === 'pineapple3' && (
                    <select
                      className="select-field"
                      value={customSettings.discardSchedule?.preflop ? 'classic' : 'crazy'}
                      onChange={(e) =>
                        setCustomSettings({
                          ...customSettings,
                          discardSchedule: e.target.value === 'classic' ? { preflop: 1 } : { flop: 1 },
                        })
                      }
                    >
                      <option value="classic">Classic (Discard 1 Preflop)</option>
                      <option value="crazy">Crazy (Discard 1 after Flop)</option>
                    </select>
                  )}
                  {customSettings.variant === 'pineapple4' && (
                    <div className="schedule-info">Schedule: Discard 1 on Flop, 1 on Turn (Total 2)</div>
                  )}
                  {customSettings.variant === 'pineapple5' && (
                    <div className="schedule-info">Schedule: Discard 1 Preflop, 1 on Flop, 1 on Turn (Total 3)</div>
                  )}
                </div>
              )}

              {/* Blinds and Stacks */}
              <div className="field-row">
                <div>
                  <label className="field-label">SMALL BLIND ($)</label>
                  <input
                    type="number"
                    className="text-field"
                    min={1}
                    value={customSettings.smallBlind}
                    onChange={(e) =>
                      setCustomSettings({
                        ...customSettings,
                        smallBlind: Number(e.target.value),
                        bigBlind: Math.max(customSettings.bigBlind, Number(e.target.value) * 2),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="field-label">BIG BLIND ($)</label>
                  <input
                    type="number"
                    className="text-field"
                    min={customSettings.smallBlind}
                    value={customSettings.bigBlind}
                    onChange={(e) => setCustomSettings({ ...customSettings, bigBlind: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="field-row">
                <div>
                  <label className="field-label">STARTING STACK ($)</label>
                  <input
                    type="number"
                    className="text-field"
                    min={10}
                    value={customSettings.startingStack}
                    onChange={(e) => setCustomSettings({ ...customSettings, startingStack: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="field-label">SEATS (2-9)</label>
                  <input
                    type="number"
                    className="text-field"
                    min={2}
                    max={9}
                    value={customSettings.seatCount}
                    onChange={(e) => setCustomSettings({ ...customSettings, seatCount: Number(e.target.value) })}
                  />
                </div>
              </div>

              {/* Turn Timer & Double Board */}
              <div className="field-row">
                <div>
                  <label className="field-label">TURN TIMER (SECONDS)</label>
                  <select
                    className="select-field"
                    value={customSettings.turnTimerSeconds}
                    onChange={(e) => setCustomSettings({ ...customSettings, turnTimerSeconds: Number(e.target.value) })}
                  >
                    <option value={15}>15 Seconds (Blitz)</option>
                    <option value={30}>30 Seconds (Standard)</option>
                    <option value={60}>60 Seconds (Relaxed)</option>
                    <option value={120}>120 Seconds (Casual)</option>
                  </select>
                </div>
                <div className="checkbox-field">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={customSettings.doubleBoard}
                      onChange={(e) => setCustomSettings({ ...customSettings, doubleBoard: e.target.checked })}
                    />
                    <span>Double Board (Split Pot)</span>
                  </label>
                </div>
              </div>

              <button
                className="primary-button create-submit-btn"
                onClick={() => onConfirmCreate(customSettings)}
              >
                Launch Table <span>↗</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
