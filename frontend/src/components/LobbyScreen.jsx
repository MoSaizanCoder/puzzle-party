import { useMemo, useState, useRef, useEffect } from 'react';
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
  return <button type="button" className="voice-control" title={label} aria-label={label} aria-pressed={muted} onClick={onToggle}>{iconMarkup}</button>;
}

export default function LobbyScreen({ gameState, socket, localPlayerId }) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [playerIdCopied, setPlayerIdCopied] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('profile'); 

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  const [viewingFriendStats, setViewingFriendStats] = useState(null);
  
  // --- NEW: INCOMING INVITE STATE ---
  const [incomingInvite, setIncomingInvite] = useState(null);
  const [inviteTimer, setInviteTimer] = useState(0);
  const [inviteCooldowns, setInviteCooldowns] = useState({});

  // --- NEW: GLOBAL PRESENCE STATE ---
  const [globalPresence, setGlobalPresence] = useState({});

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const players = useMemo(() => Object.values(gameState?.players ?? {}), [gameState?.players]);
  const localPlayer = players.find((player) => player.id === localPlayerId) ?? null;
  const hostId = gameState?.hostId ?? null;
  const isHost = gameState?.hostId === localPlayerId;
  const nonHostPlayers = players.filter((player) => player.id !== hostId);
  const selectedPuzzleImage = gameState?.puzzleImageSrc ?? null;
  const canStartGame = Boolean(gameState?.puzzleImageSrc) && nonHostPlayers.every((player) => player.isReady === true);

  const fileInputRef = useRef(null);
  const [localPending, setLocalPending] = useState([]);
  
  // --- NEW: AUTO-DECLINE TIMER ---
  useEffect(() => {
    if (incomingInvite) {
      setInviteTimer(10);
      const timerId = setInterval(() => {
        setInviteTimer((prev) => {
          if (prev <= 1) {
            clearInterval(timerId);
            setIncomingInvite(null); // Auto-decline when it hits 0
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timerId);
    }
  }, [incomingInvite]);

  useEffect(() => { if (localPlayer?.pendingRequests) setLocalPending(localPlayer.pendingRequests); }, [localPlayer?.pendingRequests]);

  useEffect(() => {
    if (!socket) return;
    const handleNewRequest = (requester) => {
      alert(`💌 New friend request from ${requester.name}! Check your Friends tab.`);
      setLocalPending(prev => [...prev, requester]);
    };

    // --- NEW: LISTEN FOR LOBBY INVITES & PRESENCE ---
    const handleLobbyInvite = (inviteData) => setIncomingInvite(inviteData);
    const handlePresence = (presenceMap) => setGlobalPresence(presenceMap);
    const handleReply = ({ senderName, text }) => alert(`💬 ${senderName} says: "${text}"`);

    socket.on('friend_request_received', handleNewRequest);
    socket.on('lobby_invite_received', handleLobbyInvite);
    socket.on('presence_update', handlePresence);
    socket.on('reminder_reply_received', handleReply);

    // Ask the server for the latest statuses immediately
    socket.emit('request_presence');

    return () => {
      socket.off('friend_request_received', handleNewRequest);
      socket.off('lobby_invite_received', handleLobbyInvite);
      socket.off('presence_update', handlePresence);
      socket.off('reminder_reply_received', handleReply);
    };
  }, [socket]);

  const handleToggleReady = () => { if (socket?.connected) socket.emit('toggle_ready'); };
  const handleSelectImage = (imageUrl) => { if (socket?.connected) { socket.emit('select_image', { imageUrl }); setShowImageModal(false); } };
  const handleStartGame = () => { if (socket?.connected && canStartGame) socket.emit('start_game'); };
  const updateVoiceState = (key) => { if (socket?.connected) socket.emit('update_voice_state', { [key]: !(localPlayer?.[key] ?? false) }); };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file || !socket?.connected) return;
    const reader = new FileReader();
    reader.onload = (e) => { socket.emit('select_image', { imageUrl: e.target.result }); setShowImageModal(false); };
    reader.readAsDataURL(file);
  };

  const copyCode = async (text) => {
    try { await navigator.clipboard.writeText(text); setPlayerIdCopied(true); setTimeout(() => setPlayerIdCopied(false), 2000); } catch {}
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
    if (query.trim().length < 3) { setSearchResults([]); return; }
    setIsSearching(true);
    socket.emit('search_players', { query }, (result) => {
      setIsSearching(false);
      if (result.ok) setSearchResults(result.results);
    });
  };

  const handleSendRequest = (targetId) => {
    if (!socket?.connected) return;
    socket.emit('send_friend_request', { targetPlayerId: targetId }, (result) => {
      if (result.ok) alert("Friend request sent!");
      else alert(result.message);
    });
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleResolveRequest = (requesterId, accept) => {
    if (!socket?.connected) return;
    socket.emit('resolve_friend_request', { requesterId, accept });
    setLocalPending(prev => prev.filter(req => req.id !== requesterId));
  };

  const handleRemoveFriend = (friendId) => {
    if (!socket?.connected) return;
    if (window.confirm("Are you sure you want to remove this friend?")) {
      socket.emit('remove_friend', { friendId });
    }
  };

  const handleViewStats = (friendObj) => {
    if (!socket?.connected) return;
    socket.emit('get_friend_stats', { friendId: friendObj.id }, (result) => {
      if (result.ok) {
        setViewingFriendStats({ name: friendObj.name, shortId: friendObj.shortId, stats: result.stats });
      } else {
        alert('Could not load stats for this player.');
      }
    });
  };

  // --- NEW: SEND INVITATION ACTION ---
  const handleSendInvite = (friendObj) => {
    if (!socket?.connected || inviteCooldowns[friendObj.id]) return;
    const urlParams = new URLSearchParams(window.location.search);
    const currentRoomId = urlParams.get('room');
    
    socket.emit('send_lobby_invite', { 
      targetPlayerId: friendObj.id, 
      roomId: currentRoomId,
      roomName: `${localPlayer?.name || 'A player'}'s Lobby`
    }, (res) => {
      if (res?.redirectRoomId) {
        alert(res.message);
        window.location.href = `?room=${res.redirectRoomId}`;
      } else if (res?.ok) {
        // Lock the button for 10 seconds to prevent spam
        setInviteCooldowns(prev => ({ ...prev, [friendObj.id]: true }));
        setTimeout(() => {
          setInviteCooldowns(prev => ({ ...prev, [friendObj.id]: false }));
        }, 10000);
      }
    });
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
                <button type="button" className="lobby-icon-button" aria-label="Menu" title="Menu" onClick={() => setIsMenuOpen(true)}>☰</button>
                <VoiceControl icon="🎙" label="Microphone" muted={localPlayer?.isMicMuted ?? false} interactive={true} onToggle={() => updateVoiceState('isMicMuted')} />
                <VoiceControl icon="🔊" label="Speaker" muted={localPlayer?.isSpeakerMuted ?? false} interactive={true} onToggle={() => updateVoiceState('isSpeakerMuted')} />
              </div>
            </div>

            <div className="roster-section">
              <h3>Players ({players.length})</h3>
              <ul className="player-roster">
                {players.map((player) => {
                  const role = player.id === hostId ? 'Host' : player.isReady ? 'Ready' : 'Waiting';
                  
                  // Check friend eligibility
                  const isSelf = player.id === localPlayerId;
                  const isAlreadyFriend = localPlayer?.friendsList?.some(f => f.id === player.id);
                  const isRegistered = localPlayerId?.length > 20 && player.id.length > 20;
                  const canAddFriend = !isSelf && !isAlreadyFriend && isRegistered;

                  return (
                    <li key={player.id} className={player.id === hostId ? 'host-row' : ''}>
                      <span className="player-name">{player.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {/* --- NEW: QUICK ADD FRIEND BUTTON --- */}
                        {canAddFriend && (
                          <button 
                            type="button" 
                            className="primary-button"
                            style={{ padding: '4px 8px', fontSize: '0.65rem', background: '#d9f0e5' }}
                            onClick={() => handleSendRequest(player.id)}
                            title="Add Friend"
                          >
                            + Add
                          </button>
                        )}
                        <span className={`player-status ${role.toLowerCase()}`}>{role}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="lobby-actions">
              {!isHost && (
                <>
                  <button type="button" className="primary-button" onClick={handleToggleReady} disabled={!socket?.connected}>
                    {localPlayer?.isReady ? 'Mark Unready' : 'Ready'}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => window.location.href = window.location.pathname} style={{ background: '#fee2e2', color: '#991b1b' }}>
                    Leave Party
                  </button>
                </>
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
                <div className="lobby-preview-header"><span className="profile-label">Selected Puzzle</span><span className="lobby-preview-badge">{isHost ? 'Host pick' : 'Match image'}</span></div>
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

      {/* --- NEW: INCOMING INVITE POPUP MODAL --- */}
      {incomingInvite && (
        <div className="modal-overlay" style={{ zIndex: 300 }}>
          <section className="modal-content glass-panel" style={{ textAlign: 'center', padding: '32px' }}>
            <h2 style={{ color: 'var(--text-plum)', marginTop: 0 }}>Game Invite!</h2>
            <p style={{ fontSize: '1.1rem', margin: '16px 0' }}>
              <strong>{incomingInvite.senderName}</strong> has invited you to join their puzzle room.
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-plum)', fontWeight: 'bold' }}>
              Auto-declining in {inviteTimer}s...
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '24px' }}>
              <button 
                type="button" 
                className="primary-button" 
                onClick={() => {
                  window.location.href = `?room=${incomingInvite.roomId}`;
                }}
              >
                Accept & Join
              </button>
              <button 
                type="button" 
                className="secondary-button" 
                onClick={() => setIncomingInvite(null)}
              >
                Decline
              </button>
            </div>
          </section>
        </div>
      )}

      {/* FRIEND STATS MODAL (Read Only) */}
      {viewingFriendStats && (
        <div className="modal-overlay" style={{ zIndex: 200 }} onClick={() => setViewingFriendStats(null)}>
          <section className="modal-content glass-panel" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <div className="lobby-modal-header" style={{ marginBottom: '16px' }}>
              <h2 id="lobby-modal-title" style={{ color: 'var(--text-plum)' }}>{viewingFriendStats.name}'s Stats</h2>
              <button type="button" className="close-modal" onClick={() => setViewingFriendStats(null)}>×</button>
            </div>
            
            <div className="stats-modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                <span className="profile-label">Games Played</span>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-navy)' }}>{viewingFriendStats.stats.games_played || 0}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                <span className="profile-label">Total Wins</span>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--shield-green)' }}>{viewingFriendStats.stats.total_wins || 0}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                <span className="profile-label">Highest Streak</span>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-navy)' }}>{viewingFriendStats.stats.highest_streak || 0}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                <span className="profile-label">Attacks Used</span>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--mute-red)' }}>{viewingFriendStats.stats.attacks_used || 0}</div>
              </div>
            </div>
          </section>
        </div>
      )}

      {isMenuOpen && (
        <div className="modal-overlay" onClick={() => setIsMenuOpen(false)}>
          <section className="modal-content glass-panel" onClick={(event) => event.stopPropagation()} style={{ padding: '24px 24px 32px' }}>
            <div className="lobby-modal-header" style={{ marginBottom: '16px' }}>
              <h2 id="lobby-modal-title">Game Menu</h2>
              <button type="button" className="close-modal" onClick={() => setIsMenuOpen(false)}>×</button>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid rgba(26, 35, 58, 0.1)', paddingBottom: '16px' }}>
              <button className={activeTab === 'profile' ? 'primary-button' : 'secondary-button'} onClick={() => setActiveTab('profile')} style={{ flex: 1, padding: '8px' }}>Profile</button>
              <button className={activeTab === 'friends' ? 'primary-button' : 'secondary-button'} onClick={() => setActiveTab('friends')} style={{ flex: 1, padding: '8px' }}>
                Friends {localPending.length > 0 && <span style={{ background: '#f87171', color: 'white', padding: '2px 6px', borderRadius: '12px', fontSize: '0.7rem', marginLeft: '4px' }}>{localPending.length}</span>}
              </button>
              <button className={activeTab === 'stats' ? 'primary-button' : 'secondary-button'} onClick={() => setActiveTab('stats')} style={{ flex: 1, padding: '8px' }}>Stats</button>
            </div>

            {activeTab === 'profile' && (
              <div className="profile-modal-body">
                <div className="profile-modal-name">
                  <span className="profile-label">Player Name</span>
                  {isEditingName ? (
                    <form onSubmit={handleUpdateName} style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <input type="text" value={editNameValue} onChange={(e) => setEditNameValue(e.target.value)} maxLength={40} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #ccc' }} autoFocus />
                      <button type="submit" className="primary-button" style={{ padding: '8px 12px' }}>Save</button>
                      <button type="button" className="secondary-button" style={{ padding: '8px 12px' }} onClick={() => setIsEditingName(false)}>Cancel</button>
                    </form>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3>{localPlayer?.name ?? 'Player'}</h3>
                      {localPlayerId.length > 20 && <button type="button" className="secondary-button" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => { setEditNameValue(localPlayer?.name || ''); setIsEditingName(true); }}>Edit</button>}
                    </div>
                  )}
                </div>
                <div className="profile-modal-id">
                  <span className="profile-label">Friend Code</span>
                  <code>{localPlayer?.shortId || localPlayerId}</code>
                  <button type="button" className="copy-id-button" onClick={() => copyCode(localPlayer?.shortId || localPlayerId)}>{playerIdCopied ? 'Copied!' : 'Copy Code'}</button>
                </div>
                <button type="button" className="secondary-button" onClick={async () => { await supabase.auth.signOut(); sessionStorage.removeItem('puzzle-party-player-id'); window.location.reload(); }}>Sign Out</button>
                {localPlayerId.length > 20 && (
                  <div style={{ marginTop: '24px', borderTop: '1px solid rgba(26, 35, 58, 0.1)', paddingTop: '16px' }}>
                    <button type="button" className="secondary-button" style={{ background: '#fee2e2', color: '#991b1b', width: '100%' }} onClick={() => setShowDeleteModal(true)}>
                      Permanently Delete Account
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'friends' && (
              <div className="friends-modal-body">
                {localPending.length > 0 && (
                  <div className="pending-requests-section" style={{ marginBottom: '20px' }}>
                    <h3 style={{ marginBottom: '8px', color: 'var(--text-plum)' }}>Pending Requests</h3>
                    <ul className="friends-list">
                      {localPending.map(req => (
                        <li key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.7)', padding: '8px 12px', borderRadius: '8px', border: '2px solid rgba(74, 222, 128, 0.4)' }}>
                          <span>{req.name} <small style={{ color: 'var(--text-plum)' }}>#{req.shortId}</small></span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="primary-button" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => handleResolveRequest(req.id, true)}>Accept</button>
                            <button className="secondary-button" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => handleResolveRequest(req.id, false)}>Decline</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="friend-form">
                  <label htmlFor="friend-search">Find Friends</label>
                  <div className="friend-input-row">
                    <input id="friend-search" type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)} placeholder="Search by name or 6-digit code..." disabled={!socket?.connected} />
                  </div>
                  
                  {searchQuery.trim().length >= 3 && (
                    <div className="search-results" style={{ marginTop: '12px', background: 'rgba(255,255,255,0.6)', borderRadius: '10px', padding: '12px' }}>
                      <h4 style={{ margin: '0 0 8px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-plum)' }}>{isSearching ? 'Searching...' : 'Results'}</h4>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '8px' }}>
                        {searchResults.length === 0 && !isSearching && <li style={{ fontSize: '0.9rem' }}>No players found.</li>}
                        {searchResults.map(result => {
                          const isAlreadyFriend = localPlayer?.friendsList.some(f => f.id === result.id);
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
                                onClick={() => handleSendRequest(result.id)}
                                disabled={isAlreadyFriend || isSelf}
                              >
                                {isAlreadyFriend ? 'Friends' : 'Add'}
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
                      {(localPlayer?.friendsList ?? []).map((friendObj) => {
                        const status = globalPresence[friendObj.id] || 'OFFLINE';
                        const statusColors = { ONLINE: '#28784b', IN_LOBBY: '#0284c7', IN_GAME: '#b45309', OFFLINE: 'var(--text-plum)' };
                        const statusLabels = { ONLINE: 'Online', IN_LOBBY: 'In Lobby', IN_GAME: 'In Game', OFFLINE: 'Offline' };
                        
                        // Restore the variable that checks if this friend is currently in your local room
                        const lobbyPlayer = players.find((p) => p.id === friendObj.id);

                        return (
                          <li key={friendObj.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span>{friendObj.name} <small style={{ color: 'var(--text-plum)', marginLeft: '6px' }}>#{friendObj.shortId}</small></span>
                              <div style={{ fontSize: '0.7rem', marginTop: '2px', color: statusColors[status], fontWeight: 'bold' }}>
                                {statusLabels[status]}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              {status === 'IN_GAME' && (
                                <button type="button" className="secondary-button" style={{ padding: '6px 10px', fontSize: '0.75rem', background: '#fef3c7' }} onClick={() => socket.emit('send_reminder', { targetId: friendObj.id }, () => alert('Reminder sent!'))}>
                                  Remind
                                </button>
                              )}
                              {!lobbyPlayer && status !== 'IN_GAME' && status !== 'OFFLINE' && (
                                <button 
                                  type="button" 
                                  className="primary-button" 
                                  style={{ 
                                    padding: '6px 10px', 
                                    fontSize: '0.75rem', 
                                    background: inviteCooldowns[friendObj.id] ? '#e2e8f0' : '#d9f0e5',
                                    color: inviteCooldowns[friendObj.id] ? '#64748b' : 'var(--text-navy)',
                                    cursor: inviteCooldowns[friendObj.id] ? 'default' : 'pointer'
                                  }} 
                                  onClick={() => handleSendInvite(friendObj)}
                                  disabled={inviteCooldowns[friendObj.id]}
                                >
                                  {inviteCooldowns[friendObj.id] ? 'Sent' : 'Invite'}
                                </button>
                              )}
                              <button type="button" className="secondary-button" style={{ padding: '6px 10px', fontSize: '0.75rem' }} onClick={() => handleViewStats(friendObj)}>Stats</button>
                              <button type="button" className="secondary-button" style={{ padding: '6px 10px', fontSize: '0.75rem', background: '#fee2e2', color: '#991b1b' }} onClick={() => handleRemoveFriend(friendObj.id)}>Remove</button>
                            </div>
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
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--text-navy)' }}>{localPlayer?.lifetimeStats?.games_played || 0}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                  <span className="profile-label">Total Wins</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--shield-green)' }}>{localPlayer?.lifetimeStats?.total_wins || 0}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                  <span className="profile-label">Highest Streak</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--text-navy)' }}>{localPlayer?.lifetimeStats?.highest_streak || 0}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)' }}>
                  <span className="profile-label">Attacks Used</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--mute-red)' }}>{localPlayer?.lifetimeStats?.attacks_used || 0}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.5)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(26,35,58,0.08)', gridColumn: 'span 2' }}>
                  <span className="profile-label">Points Stolen</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--text-plum)' }}>{localPlayer?.lifetimeStats?.points_stolen || 0}</div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      
      {showImageModal && isHost && (
        <div className="image-modal-backdrop" onClick={() => setShowImageModal(false)}>
          <div className="image-modal glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="image-modal-header">
              <h2>Choose a Puzzle Image</h2>
              <button type="button" className="close-modal" onClick={() => setShowImageModal(false)}>×</button>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
              <button type="button" className="primary-button" style={{ width: '100%', padding: '12px' }} onClick={() => fileInputRef.current?.click()}>📸 Upload Custom Image</button>
            </div>
            <div className="image-grid">
              {imageOptions.map((url) => (
                <button key={url} type="button" className="image-card" onClick={() => handleSelectImage(url)}><img src={url} alt="Puzzle option" /></button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay" style={{ zIndex: 400 }}>
          <section className="modal-content glass-panel" style={{ textAlign: 'center', padding: '32px' }}>
            <h2 style={{ color: '#991b1b', marginTop: 0 }}>Delete Account</h2>
            <p>This action is <strong>permanent</strong> and cannot be undone. All your stats, friends, and data will be wiped immediately.</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-plum)', marginBottom: '8px' }}>Type <strong>Delete Account</strong> below to confirm.</p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Delete Account"
              style={{ width: '100%', padding: '10px', marginBottom: '16px', borderRadius: '8px', border: '1px solid rgba(26, 35, 58, 0.2)' }}
            />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                className="primary-button"
                style={{ background: deleteConfirmText === 'Delete Account' ? '#ef4444' : '#ccc', color: '#fff' }}
                disabled={deleteConfirmText !== 'Delete Account' || !socket?.connected}
                onClick={() => {
                  socket.emit('delete_account', {}, async (res) => {
                    if (res.ok) {
                      await supabase.auth.signOut();
                      sessionStorage.removeItem('puzzle-party-player-id');
                      window.location.reload();
                    } else {
                      alert(res.message);
                    }
                  });
                }}
              >
                Confirm Delete
              </button>
              <button type="button" className="secondary-button" onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}