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

  if (!interactive) return <span className="voice-status" title={label} role="img" aria-label={label}>{iconMarkup}</span>;

  return (
    <button type="button" className="voice-control" title={label} aria-label={label} aria-pressed={muted} onClick={onToggle}>
      {iconMarkup}
    </button>
  );
}

export default function LobbyScreen({ gameState, socket, localPlayerId }) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [playerIdCopied, setPlayerIdCopied] = useState(false);

  // --- MENU STATES ---
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('profile'); // 'profile', 'friends', 'stats'

  // --- SEARCH & EDIT STATES ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  const players = useMemo(() => Object.values(gameState?.players ?? {}), [gameState?.players]);
  const localPlayer = players.find((player) => player.id === localPlayerId) ?? null;
  const hostId = gameState?.hostId ?? null;
  const isHost = gameState?.hostId === localPlayerId;
  const nonHostPlayers = players.filter((player) => player.id !== hostId);
  const selectedPuzzleImage = gameState?.puzzleImageSrc ?? null;
  const canStartGame = Boolean(gameState?.puzzleImageSrc) && nonHostPlayers.every((player) => player.isReady === true);

  const fileInputRef = useRef(null);

  // --- SOCKET ACTIONS ---
  const handleToggleReady = () => { if (socket?.connected) socket.emit('toggle_ready'); };
  const handleSelectImage = (imageUrl) => { if (socket?.connected) { socket.emit('select_image', { imageUrl }); setShowImageModal(false); } };
  const handleStartGame = () => { if (socket?.connected && canStartGame) socket.emit('start_game'); };
  const updateVoiceState = (key) => { if (socket?.connected) socket.emit('update_voice_state', { [key]: !(localPlayer?.[key] ?? false) }); };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file || !socket?.connected) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      socket.emit('select_image', { imageUrl: e.target.result });
      setShowImageModal(false);
    };
    reader.readAsDataURL(file);
  };

  const copyCode = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setPlayerIdCopied(true);
      setTimeout(() => setPlayerIdCopied(false), 2000);
    } catch {}
  };

  const handleUpdateName = (e) => {
    e.preventDefault();
    if (!socket?.connected || !editNameValue.trim()) return;
    socket.emit('update_profile_name', { newName: editNameValue }, (result) => {
      if (result.ok) setIsEditingName(false);
      else alert(result.message);
    });
  };

  const handleSearch = (query) => {
    setSearchQuery(query);
    if (query.trim().length < 3) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    socket.emit('search_players', { query }, (result) => {
      setIsSearching(false);
      if (result.ok) setSearchResults(result.results);
    });
  };

  const handleAddFriend = (targetId) => {
    if (!socket?.connected || !targetId) return;
    socket.emit('add_friend', { targetPlayerId: targetId });
    setSearchQuery('');
    setSearchResults([]);
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
                  aria-label="Menu" 
                  title="Menu"
                  onClick={() => setIsMenuOpen(true)}
                >
                  ☰
                </button>
                <VoiceControl icon="🎙" label="Microphone" muted={localPlayer?.isMicMuted ?? false} interactive={true} onToggle={() => updateVoiceState('isMicMuted')} />
                <VoiceControl icon="🔊" label="Speaker" muted={localPlayer?.isSpeakerMuted ?? false} interactive={true} onToggle={() => updateVoiceState('isSpeakerMuted')} />
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
                      <span className={`player-status ${role.toLowerCase()}`}>{role}</span>
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
                  <button type="button" className="secondary-button" onClick={() => setShowImageModal(true)}>Select Image</button>
                  <button type="button" className="primary-button" onClick={handleStartGame} disabled={!canStartGame || !socket?.connected}>Start Game</button>
                </>
              )}
            </div>
          </div>

          <div className="lobby-right-column">
            {selectedPuzzleImage ? (
              <div className="lobby-preview-card">
                <div className="lobby-preview-header">
                  <span className="profile-label">Selected Puzzle</span>
                  <span className="lobby-preview-badge">{isHost ? 'Host pick' : 'Match image'}</span>
                </div>
                <img src={selectedPuzzleImage} alt="Selected puzzle preview" className="lobby-preview-image" />
              </div>
            ) : (
              <div className="lobby-preview-placeholder">
                <span className="preview-placeholder-mark" aria-hidden="true">✦</span>
                <p>Waiting for Host to select a puzzle...</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* --- UNIFIED MENU MODAL --- */}
      {isMenuOpen && (
        <div className="modal-overlay" onClick={() => setIsMenuOpen(false)}>
          <section className="modal-content glass-panel" onClick={(event) => event.stopPropagation()} style={{ padding: '24px 24px 32px' }}>
            <div className="lobby-modal-header" style={{ marginBottom: '16px' }}>
              <h2 id="lobby-modal-title">Game Menu</h2>
              <button type="button" className="close-modal" onClick={() => setIsMenuOpen(false)}>×</button>
            </div>

            {/* TAB NAVIGATION */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid rgba(26, 35, 58, 0.1)', paddingBottom: '16px' }}>
              <button 
                className={activeTab === 'profile' ? 'primary-button' : 'secondary-button'} 
                onClick={() => setActiveTab('profile')} 
                style={{ flex: 1, padding: '8px' }}
              >
                Profile
              </button>
              <button 
                className={activeTab === 'friends' ? 'primary-button' : 'secondary-button'} 
                onClick={() => setActiveTab('friends')} 
                style={{ flex: 1, padding: '8px' }}
              >
                Friends
              </button>
              <button 
                className={activeTab === 'stats' ? 'primary-button' : 'secondary-button'} 
                onClick={() => setActiveTab('stats')} 
                style={{ flex: 1, padding: '8px' }}
              >
                Stats
              </button>
            </div>

            {/* TAB CONTENT */}
            {activeTab === 'profile' && (
              <div className="profile-modal-body">
                <div className="profile-modal-name">
                  <span className="profile-label">Player Name</span>
                  {isEditingName ? (
                    <form onSubmit={handleUpdateName} style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <input 
                        type="text" 
                        value={editNameValue} 
                        onChange={(e) => setEditNameValue(e.target.value)} 
                        maxLength={40}
                        style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #ccc' }}
                        autoFocus
                      />
                      <button type="submit" className="primary-button" style={{ padding: '8px 12px' }}>Save</button>
                      <button type="button" className="secondary-button" style={{ padding: '8px 12px' }} onClick={() => setIsEditingName(false)}>Cancel</button>
                    </form>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3>{localPlayer?.name ?? 'Player'}</h3>
                      {localPlayerId.length > 20 && (
                        <button type="button" className="secondary-button" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => { setEditNameValue(localPlayer?.name || ''); setIsEditingName(true); }}>
                          Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="profile-modal-id">
                  <span className="profile-label">Friend Code</span>
                  <code>{localPlayer?.shortId || localPlayerId}</code>
                  <button type="button" className="copy-id-button" onClick={() => copyCode(localPlayer?.shortId || localPlayerId)}>
                    {playerIdCopied ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
                <button type="button" className="secondary-button" onClick={async () => { await supabase.auth.signOut(); sessionStorage.removeItem('puzzle-party-player-id'); window.location.reload(); }}>
                  Sign Out
                </button>
              </div>
            )}

            {activeTab === 'friends' && (
              <div className="friends-modal-body">
                <div className="friend-form">
                  <label htmlFor="friend-search">Find Friends</label>
                  <div className="friend-input-row">
                    <input
                      id="friend-search"
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                      placeholder="Search by name or 6-digit code..."
                      disabled={!socket?.connected}
                    />
                  </div>
                  
                  {searchQuery.trim().length >= 3 && (
                    <div className="search-results" style={{ marginTop: '12px', background: 'rgba(255,255,255,0.6)', borderRadius: '10px', padding: '12px' }}>
                      <h4 style={{ margin: '0 0 8px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-plum)' }}>
                        {isSearching ? 'Searching...' : 'Results'}
                      </h4>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '8px' }}>
                        {searchResults.length === 0 && !isSearching && <li style={{ fontSize: '0.9rem' }}>No players found.</li>}
                        {searchResults.map(result => {
                          const isAlreadyFriend = localPlayer?.friendsList.includes(result.id);
                          const isSelf = result.id === localPlayerId;
                          return (
                            <li key={result.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.05)' }}>
                              <div>
                                <strong style={{ display: 'block' }}>{result.display_name}</strong>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-plum)' }}>#{result.short_id}</span>
                              </div>
                              <button 
                                type="button" 
                                className={isAlreadyFriend ? "secondary-button" : "primary-button"}
                                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                onClick={() => handleAddFriend(result.id)}
                                disabled={isAlreadyFriend || isSelf}
                              >
                                {isAlreadyFriend ? 'Added' : 'Add'}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="friends-list-section">
                  <h3>Your Friends</h3>
                  {(localPlayer?.friendsList ?? []).length > 0 ? (
                    <ul className="friends-list">
                      {(localPlayer?.friendsList ?? []).map((friendIdEntry) => {
                        const friend = players.find((p) => p.id === friendIdEntry);
                        return (
                          <li key={friendIdEntry}>
                            <span>{friend?.name ?? "Offline Friend"}</span>
                            <span className={`friend-presence${friend ? ' is-online' : ''}`}>
                              {friend ? 'In lobby' : 'Offline'}
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

            {activeTab === 'stats' && (
              <div className="stats-modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                  <span className="profile-label">Games Played</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--text-navy)' }}>
                    {localPlayer?.lifetimeStats?.games_played || 0}
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                  <span className="profile-label">Total Wins</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--shield-green)' }}>
                    {localPlayer?.lifetimeStats?.total_wins || 0}
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                  <span className="profile-label">Highest Streak</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--text-navy)' }}>
                    {localPlayer?.lifetimeStats?.highest_streak || 0}
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                  <span className="profile-label">Attacks Used</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--mute-red)' }}>
                    {localPlayer?.lifetimeStats?.attacks_used || 0}
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)', gridColumn: 'span 2' }}>
                  <span className="profile-label">Points Stolen</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--text-plum)' }}>
                    {localPlayer?.lifetimeStats?.points_stolen || 0}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* --- IMAGE MODAL --- */}
      {showImageModal && isHost && (
        <div className="image-modal-backdrop" onClick={() => setShowImageModal(false)}>
          <div className="image-modal glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="image-modal-header">
              <h2>Choose a Puzzle Image</h2>
              <button type="button" className="close-modal" onClick={() => setShowImageModal(false)}>×</button>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
              <button type="button" className="primary-button" style={{ width: '100%', padding: '12px' }} onClick={() => fileInputRef.current?.click()}>
                📸 Upload Custom Image
              </button>
            </div>
            <div className="image-grid">
              {imageOptions.map((url) => (
                <button key={url} type="button" className="image-card" onClick={() => handleSelectImage(url)}>
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