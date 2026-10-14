import { useEffect, useRef, useState } from 'react';
import '../../styles/playing.css';
import ConfettiBurst from './ConfettiBurst.jsx';
import PuzzleBoard from './PuzzleBoard.jsx';

const powerCosts = {
  self_protect: 3,
  focus_cracker: 4,
  offensive_attack: 5,
  ultimate_steal: 7,
  reverse: 10,
  self_help: null,
};

const powerUps = [
  { type: 'self_protect', label: 'Self-Protect' },
  { type: 'reverse', label: 'Reverse' },
  { type: 'offensive_attack', label: 'Offensive Attack' },
  { type: 'ultimate_steal', label: 'Ultimate Steal' },
  { type: 'focus_cracker', label: 'Focus Cracker' },
  { type: 'self_help', label: 'Self-Help' },
];

function VoiceControl({ icon, label, muted, interactive, onToggle }) {
  const iconClassName = `voice-icon${muted ? ' is-muted' : ''}`;
  const iconMarkup = <span className={iconClassName} aria-hidden="true">{icon}</span>;

  if (!interactive) {
    return (
      <span className="voice-status" title={label} role="img" aria-label={label}>
        {iconMarkup}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="voice-control"
      title={label}
      aria-label={label}
      aria-pressed={muted}
      onClick={onToggle}
    >
      {iconMarkup}
    </button>
  );
}

export default function PlayingScreen({ gameState, onGameState, onLeaveGame, socket, localPlayerId }) {
  const players = Object.values(gameState?.players ?? {});
  const currentPlayer = players.find((player) => player.id === localPlayerId);
  const targets = players.filter((player) => player.id !== localPlayerId);
  const [showRules, setShowRules] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [notice, setNotice] = useState('');
  const [chatText, setChatText] = useState('');
  const [chatStatus, setChatStatus] = useState('');
  const [confettiSequence, setConfettiSequence] = useState(0);
  const [cooldownClock, setCooldownClock] = useState(Date.now());
  const cooldownUntil = gameState?.triviaCooldownUntil;
  const chatListRef = useRef(null);
  const previousStreaks = useRef(null);

  const [reverseTimeLeft, setReverseTimeLeft] = useState(5);

  useEffect(() => {
    let timer;
    if (gameState?.status === 'REVERSE_PAUSED' && gameState?.pendingAttack?.targetId === localPlayerId) {
      timer = window.setInterval(() => {
        const left = Math.max(0, Math.ceil((gameState.pendingAttack.expiresAt - Date.now()) / 1000));
        setReverseTimeLeft(left);
      }, 100);
    }
    return () => window.clearInterval(timer);
  }, [gameState?.status, gameState?.pendingAttack, localPlayerId]);

  const handleResolveReverse = (useReverse) => {
    if (!socket?.connected || !gameState?.pendingAttack) return;
    socket.emit('resolve_reverse', {
      attackId: gameState.pendingAttack.id,
      useReverse
    }, (result) => {
      if (result?.message) setNotice(result.message);
    });
  };

  useEffect(() => {
    if (!cooldownUntil || cooldownUntil <= cooldownClock) return undefined;
    const timer = window.setTimeout(() => setCooldownClock(Date.now()), Math.min(1000, cooldownUntil - cooldownClock));
    return () => window.clearTimeout(timer);
  }, [cooldownClock, cooldownUntil]);

  useEffect(() => {
    if (chatListRef.current) chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
  }, [gameState?.chatHistory]);

  useEffect(() => {
    if (!gameState?.players) return;
    const nextStreaks = Object.fromEntries(
      Object.values(gameState.players).map((player) => [player.id, player.streak]),
    );
    const streakIncreased = previousStreaks.current && Object.entries(nextStreaks)
      .some(([id, streak]) => streak > (previousStreaks.current[id] ?? 0));

    previousStreaks.current = nextStreaks;
    if (streakIncreased) setConfettiSequence((sequence) => sequence + 1);
  }, [gameState?.players]);

  const handleUsePowerUp = (powerUpType) => {
    if (!socket?.connected) {
      setNotice('Not connected to the game server.');
      return;
    }
    if (powerUpType === 'offensive_attack' && !targetId) {
      setNotice('Choose a target first.');
      return;
    }

    socket.emit('use_powerup', { powerUpType, targetId }, (result) => {
      setNotice(result?.message ?? 'Power-up request failed.');
    });
  };

  const cooldownSeconds = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - cooldownClock) / 1000))
    : 0;

  const requestHelp = () => {
    socket.emit('trigger_help_request', {}, (result) => setNotice(result.message));
  };

  const updateVoiceState = (key, currentValue) => {
    if (!socket?.connected) return;
    socket.emit('update_voice_state', { [key]: !currentValue }, (result) => {
      if (!result.ok) setNotice(result.message);
    });
  };

  const sendChat = (event) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text || !socket?.connected) return;

    socket.emit('send_chat', { text }, (result) => {
      if (result.ok) {
        setChatText('');
        setChatStatus('');
      } else {
        setChatStatus(result.message);
      }
    });
  };

  return (
    <main className="game-container">
      <section className="board-panel" aria-label="Puzzle board">
        <PuzzleBoard gameState={gameState} onGameState={onGameState} socket={socket} localPlayerId={localPlayerId} />
      </section>

      {/* NEW: Floating Rules Button */}
      <button 
        type="button"
        className="rules-toggle-btn glass-panel" 
        onClick={() => setShowRules(true)}
        aria-label="View Game Rules"
        title="Game Rules"
      >
        📖
      </button>

      {/* NEW: Rules Modal */}
      {showRules && (
        <div className="modal-overlay" onClick={() => setShowRules(false)}>
          <section className="modal-content glass-panel rules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lobby-modal-header">
              <h2 style={{ color: 'var(--text-plum)', margin: 0 }}>Game Rules</h2>
              <button type="button" className="close-modal" onClick={() => setShowRules(false)} aria-label="Close rules">
                ×
              </button>
            </div>
            <div className="rules-modal-body">
              <h3>🎯 How to Win</h3>
              <p>The game ends when the puzzle is completely built. The winner is the player with the highest <strong>True Total Score</strong> (Base Score + Attacks Used + Points Stolen).</p>
              
              <h3>🧩 Scoring & Streaks</h3>
              <p>Connect pieces correctly to earn <strong>+1 point</strong> and <strong>+1 streak</strong>. Be careful! Trying to force the wrong pieces together will break your streak back to 0.</p>
              
              <h3>⚡ Power-ups</h3>
              <ul>
                <li><strong>Self-Protect (3 streak):</strong> A passive shield that absorbs one incoming attack.</li>
                <li><strong>Focus Cracker (4 streak):</strong> Violently shakes and blurs all opponents' screens for 15 seconds.</li>
                <li><strong>Offensive Attack (5 streak):</strong> Steals 2 points and breaks 2 connected pieces from a specific target.</li>
                <li><strong>Ultimate Steal (7 streak):</strong> Steals 4 points and breaks 4 pieces from ALL other players at once.</li>
                <li><strong>Reverse (10 streak):</strong> Bounces an incoming attack directly back at the sender!</li>
                <li><strong>Help Me (Trivia):</strong> Answer a trivia question correctly to instantly highlight two connecting puzzle pieces.</li>
              </ul>
            </div>
          </section>
        </div>
      )}

      {confettiSequence > 0 && (
        <ConfettiBurst key={confettiSequence} onComplete={() => setConfettiSequence(0)} />
      )}
      {gameState?.broadcastMessage && (
        <div className={`broadcast-alert alert-${gameState.broadcastMessage.type || 'purchase'}`} role="status" aria-live="polite">
          {gameState.broadcastMessage.type === 'attack' && <span className="alert-icon" aria-hidden="true">☠️</span>}
          {gameState.broadcastMessage.type === 'defense' && <span className="alert-icon" aria-hidden="true">🛡️</span>}
          {gameState.broadcastMessage.type === 'purchase' && <span className="alert-icon" aria-hidden="true">⚡</span>}
          <span className="alert-text">{gameState.broadcastMessage.text || gameState.broadcastMessage}</span>
        </div>
      )}

      {gameState?.status === 'REVERSE_PAUSED' && gameState?.pendingAttack?.targetId === localPlayerId && (
        <div className="modal-overlay">
          <section className="modal-content glass-panel" style={{ textAlign: 'center' }}>
            <h2 style={{ color: 'var(--text-plum)', marginTop: 0 }}>Incoming Attack!</h2>
            <p>
              <strong>{players.find((p) => p.id === gameState.pendingAttack.attackerId)?.name || 'An opponent'}</strong> is targeting you with {powerUps.find((p) => p.type === gameState.pendingAttack.powerUp)?.label}.
            </p>
            <p style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--text-navy)', margin: '16px 0' }}>
              {reverseTimeLeft}s
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button type="button" className="primary-button" onClick={() => handleResolveReverse(true)}>
                Use Reverse
              </button>
              <button type="button" className="secondary-button" onClick={() => handleResolveReverse(false)}>
                Take the Hit
              </button>
            </div>
          </section>
        </div>
      )}

      <aside className="game-sidebar" aria-label="Game controls">
        <section className="scoreboard" aria-label="Live scores" aria-live="polite">
          <h2>Players</h2>
          {players.length > 0 ? (
            <ul>
              {players.map((player) => (
                <li
                  key={player.id}
                  className={[
                    player.isSpeaking ? 'voice-active' : '',
                    player.isShielded ? 'shield-active' : '',
                    player.id === localPlayerId ? 'local-player-highlight' : '', // <-- NEW HIGHLIGHT
                  ].filter(Boolean).join(' ')}
                >
                  <div className="player-nameplate">
                    <div className="player-name-scroll-box">
                      <span className="player-name" title={player.name}> {player.name} </span>
                    </div>
                    <div className="voice-controls" aria-label={`${player.name} voice status`}>
                      <VoiceControl
                        icon="🎙"
                        label={player.isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
                        muted={player.isMicMuted}
                        interactive={player.id === localPlayerId}
                        onToggle={() => updateVoiceState('isMicMuted', player.isMicMuted)}
                      />
                      <VoiceControl
                        icon="🔊"
                        label={player.isSpeakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                        muted={player.isSpeakerMuted}
                        interactive={player.id === localPlayerId}
                        onToggle={() => updateVoiceState('isSpeakerMuted', player.isSpeakerMuted)}
                      />
                    </div>
                  </div>
                  <span className="player-score">{player.score} Pts · 🔥{player.streak} </span>
                </li>
              ))}
            </ul>
          ) : <p>Connecting...</p>}
        </section>
        <section className="power-up-tray" aria-label="Power-ups">
          <h2>Power-ups <span>Streak {currentPlayer?.streak ?? 0}</span></h2>
          {currentPlayer?.inventory?.includes('offensive_attack') && (
            <>
              <label htmlFor="power-target">Target</label>
              <select id="power-target" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">Choose player</option>
                {targets.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
              </select>
            </>
          )}
          <div className="power-up-list">
            {powerUps.map(({ type, label }) => {
              const uses = currentPlayer?.powerUpUses?.[type] ?? 0;
              const isMaxed = uses >= 2;
              const isOwned = currentPlayer?.inventory?.includes(type) ?? false;
              const cost = powerCosts[type];
              const disabled = !socket?.connected
                || !currentPlayer
                || isMaxed
                || (isOwned && type === 'offensive_attack' && (!targetId || targets.length === 0))
                || (!isOwned && (cost === null || currentPlayer.streak < cost))
                || gameState?.status !== 'PLAYING';

              let buttonLabel;
              if (isMaxed) buttonLabel = 'Max Uses Reached';
              else if (isOwned) buttonLabel = `Use ${label}`;
              else if (cost === null) buttonLabel = `Earn ${label}`;
              else buttonLabel = `Add ${label} · ${cost}`;

              return (
                <button
                  key={type}
                  type="button"
                  className="power-up-button"
                  disabled={disabled}
                  onClick={() => {
                    if (isOwned) {
                      handleUsePowerUp(type);
                    } else if (socket?.connected && cost !== null) {
                      socket.emit('purchase_powerup', { playerId: localPlayerId, powerUpType: type }, (result) => {
                        setNotice(result?.message ?? 'Power-up purchase failed.');
                      });
                    } else {
                      setNotice('Earn Self-Help by answering trivia correctly.');
                    }
                  }}
                >
                  {buttonLabel}
                </button>
              );
            })}
          </div>
          {/* Only the host is allowed to reset the board mid-game */}
          {gameState?.hostId === localPlayerId && (
            <button
              type="button"
              className="reset-game-button"
              disabled={!socket?.connected}
              onClick={() => socket.emit('dev_reset_game')}
            >
              Reset Game
            </button>
          )}
          <button
            type="button"
            className="leave-game-button"
            disabled={!socket?.connected}
            onClick={() => {
              socket.emit('leave_game', {}, (result) => {
                if (result?.ok) {
                  socket.disconnect(); // Cut the network cord so we don't receive updates
                  if (onLeaveGame) onLeaveGame(); // Trigger the App.jsx exit screen
                } else {
                  setNotice(result?.message ?? 'Unable to leave the game.');
                }
              });
            }}
          >
            Leave Game
          </button>
          <button
            type="button"
            disabled={!socket?.connected || gameState?.status !== 'PLAYING' || cooldownSeconds > 0}
            onClick={requestHelp}
          >
            {cooldownSeconds > 0 ? `Help Me · ${cooldownSeconds}s` : 'Help Me'}
          </button>
          <p className="power-up-notice" role="status">{notice || 'Spend your streak to activate a power.'}</p>
        </section>
        <section className="chat-widget" aria-label="Text chat">
          <h2>Chat</h2>
          <ol className="chat-messages" ref={chatListRef} aria-live="polite">
            {(gameState?.chatHistory ?? []).map((message) => (
              <li key={message.id}>
                <span className="chat-message-author">{message.playerName}</span>
                <span>{message.text}</span>
              </li>
            ))}
          </ol>
          <form className="chat-form" onSubmit={sendChat}>
            <input
              aria-label="Chat message"
              type="text"
              maxLength={500}
              value={chatText}
              onChange={(event) => setChatText(event.target.value)}
              placeholder="Write a message"
              disabled={!socket?.connected}
            />
            <button type="submit" disabled={!socket?.connected || !chatText.trim()}>Send</button>
          </form>
          <p className="chat-status" role="status">{chatStatus}</p>
        </section>
      </aside>
    </main>
  );
}