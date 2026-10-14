import { useMemo, useState, useRef } from 'react';
import { supabase } from '../supabaseClient.js';
import '../../styles/lobby.css';

const imageOptions = [
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80',
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

export default function LobbyScreen({ gameState, socket, localPlayerId }) {
  const [friendId, setFriendId] = useState('');
  const [showImageModal, setShowImageModal] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [playerIdCopied, setPlayerIdCopied] = useState(false);
  const players = useMemo(() => Object.values(gameState?.players ?? {}), [gameState?.players]);
  const localPlayer = players.find((player) => player.id === localPlayerId) ?? null;
  const hostId = gameState?.hostId ?? null;
  const isHost = gameState?.hostId === localPlayerId;
  const nonHostPlayers = players.filter((player) => player.id !== hostId);
  const selectedPuzzleImage = gameState?.puzzleImageSrc ?? null;
  const canStartGame = Boolean(gameState?.puzzleImageSrc)
    && nonHostPlayers.every((player) => player.isReady === true);

  const handleToggleReady = () => {
    if (!socket?.connected) return;
    socket.emit('toggle_ready');
  };

  const handleAddFriend = (event) => {
    event.preventDefault();
    if (!socket?.connected || !friendId.trim()) return;
    socket.emit('add_friend', { targetPlayerId: friendId.trim() });
    setFriendId('');
  };

  const handleSelectImage = (imageUrl) => {
    if (!socket?.connected) return;
    socket.emit('select_image', { imageUrl });
    setShowImageModal(false);
  };

  const handleStartGame = () => {
    if (!socket?.connected || !canStartGame) return;
    socket.emit('start_game');
  };

  const updateVoiceState = (key) => {
    if (!socket?.connected) return;
    const currentValue = localPlayer?.[key] ?? false;
    socket.emit('update_voice_state', { [key]: !currentValue });
  };

  const copyPlayerId = async () => {
    try {
      await navigator.clipboard.writeText(localPlayerId);
      setPlayerIdCopied(true);
    } catch {
      setPlayerIdCopied(false);
    }
  };

  const fileInputRef = useRef(null);

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file || !socket?.connected) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64Url = e.target.result;
      socket.emit('select_image', { imageUrl: base64Url });
      setShowImageModal(false);
    };
    reader.readAsDataURL(file);
  };

  return (
    <main className="lobby-screen">
      <section className="glass-panel lobby-panel" aria-labelledby="lobby-title">
        <div className="lobby-columns">
          <div className="lobby-left-column">
            <div className="lobby-header">
              <div>
                <p className="eyebrow">Lobby</p>
                <h1 id="lobby-title">Puzzle Party</h1>
              </div>
              <div className="lobby-header-icons">
                <button
                  type="button"
                  className="lobby-icon-button"
                  aria-label="Open profile"
                  title="Profile"
                  onClick={() => setActiveModal('profile')}
                >
                  👤
                </button>
                <button
                  type="button"
                  className="lobby-icon-button"
                  aria-label="Open friends"
                  title="Friends"
                  onClick={() => setActiveModal('friends')}
                >
                  👥
                </button>
                <VoiceControl
                  icon="🎙"
                  label={localPlayer?.isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
                  muted={localPlayer?.isMicMuted ?? false}
                  interactive={true}
                  onToggle={() => updateVoiceState('isMicMuted')}
                />
                <VoiceControl
                  icon="🔊"
                  label={localPlayer?.isSpeakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                  muted={localPlayer?.isSpeakerMuted ?? false}
                  interactive={true}
                  onToggle={() => updateVoiceState('isSpeakerMuted')}
                />
              </div>
            </div>

            <div className="roster-section">
              <h3>Players ({players.length})</h3>
              <ul className="player-roster">
                {players.map((player) => {
                  const role = player.id === hostId ? 'Host' : player.isReady ? 'Ready' : 'Waiting';
                  return (
                    <li key={player.id} className={player.id === hostId ? 'host-row' : ''}>
                      <span className="player-name">{player.name}</span>
                      <span className={`player-status ${role.toLowerCase()}`}>
                        {role}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="lobby-actions">
              {!isHost && (
                <button type="button" className="primary-button" onClick={handleToggleReady} disabled={!socket?.connected}>
                  {localPlayer?.isReady ? 'Mark Unready' : 'Ready'}
                </button>
              )}

              {isHost && (
                <>
                  <button type="button" className="secondary-button" onClick={() => setShowImageModal(true)}>
                    Select Image
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleStartGame}
                    disabled={!canStartGame || !socket?.connected}
                  >
                    Start Game
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="lobby-right-column">
            {selectedPuzzleImage ? (
              <div className="lobby-preview-card" aria-label="Selected puzzle preview">
                <div className="lobby-preview-header">
                  <span className="profile-label">Selected Puzzle</span>
                  <span className="lobby-preview-badge">{isHost ? 'Host pick' : 'Match image'}</span>
                </div>
                <img src={selectedPuzzleImage} alt="Selected puzzle preview" className="lobby-preview-image" />
              </div>
            ) : (
              <div className="lobby-preview-placeholder" role="status">
                <span className="preview-placeholder-mark" aria-hidden="true">✦</span>
                <p>Waiting for Host to select a puzzle...</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {activeModal && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <section
            className="modal-content glass-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lobby-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="lobby-modal-header">
              <h2 id="lobby-modal-title">{activeModal === 'profile' ? 'Your Profile' : 'Friends'}</h2>
              <button
                type="button"
                className="close-modal"
                onClick={() => setActiveModal(null)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>

            {activeModal === 'profile' ? (
              <div className="profile-modal-body">
                <div className="profile-modal-name">
                  <span className="profile-label">Player</span>
                  <h3>{localPlayer?.name ?? 'Player'}</h3>
                </div>
                <div className="profile-modal-id">
                  <span className="profile-label">Player ID</span>
                  <code>{localPlayerId}</code>
                  <button type="button" className="copy-id-button" onClick={copyPlayerId}>
                    {playerIdCopied ? 'Copied' : 'Copy ID'}
                  </button>
                </div>
                <button 
                  type="button" 
                  className="secondary-button"
                  onClick={async () => {
                    await supabase.auth.signOut(); // Clears Supabase session
                    sessionStorage.removeItem('puzzle-party-player-id'); // Clears Guest session
                    window.location.reload(); // Refreshes back to Auth screen
                  }}
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="friends-modal-body">
                <form className="friend-form" onSubmit={handleAddFriend}>
                  <label htmlFor="friend-id">Add Friend</label>
                  <div className="friend-input-row">
                    <input
                      id="friend-id"
                      type="text"
                      value={friendId}
                      onChange={(event) => setFriendId(event.target.value)}
                      placeholder="Enter player ID"
                      disabled={!socket?.connected}
                    />
                    <button type="submit" disabled={!socket?.connected || !friendId.trim()}>
                      Add
                    </button>
                  </div>
                </form>
                <div className="friends-list-section">
                  <h3>Added Friends</h3>
                  {(localPlayer?.friendsList ?? []).length > 0 ? (
                    <ul className="friends-list">
                      {(localPlayer?.friendsList ?? []).map((friendIdEntry) => {
                        const friend = players.find((player) => player.id === friendIdEntry);
                        return (
                          <li key={friendIdEntry}>
                            <span>{friend?.name ?? friendIdEntry}</span>
                            <span className={`friend-presence${friend ? ' is-online' : ''}`}>
                              {friend ? 'In lobby' : 'Added'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="friends-empty-state">No friends added yet.</p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {showImageModal && isHost && (
        <div className="image-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="image-modal-title">
          <div className="image-modal glass-panel">
            <div className="image-modal-header">
              <h2 id="image-modal-title">Choose a Puzzle Image</h2>
              <button type="button" className="close-modal" onClick={() => setShowImageModal(false)} aria-label="Close image picker">
                ×
              </button>
            </div>
            
            {/* NEW CUSTOM UPLOAD BUTTON */}
            <div style={{ marginBottom: '16px' }}>
              <input 
                type="file" 
                accept="image/*" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                onChange={handleFileUpload} 
              />
              <button 
                type="button" 
                className="primary-button" 
                style={{ width: '100%', padding: '12px', fontSize: '1rem' }} 
                onClick={() => fileInputRef.current?.click()}
              >
                📸 Upload Custom Image
              </button>
            </div>

            <div className="image-grid">
              {imageOptions.map((url) => (
                <button
                  key={url}
                  type="button"
                  className="image-card"
                  onClick={() => handleSelectImage(url)}
                  aria-label="Select puzzle image"
                >
                  <img src={url} alt="Puzzle art option" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}