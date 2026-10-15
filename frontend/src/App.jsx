import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { supabase } from './supabaseClient.js';
import '../styles/lobby.css';
import AuthScreen from './components/AuthScreen.jsx';
import GameOverScreen from './components/GameOverScreen.jsx';
import LobbyScreen from './components/LobbyScreen.jsx';
import PauseOverlay from './components/PauseOverlay.jsx';
import PlayingScreen from './components/PlayingScreen.jsx';
import useVoiceChat from './hooks/useVoiceChat.jsx'; 

function getPlayerIdentity(session) {
  // 1. If logged in via Supabase, use their DB profile ID and Google Account name
  if (session?.user) {
    return { 
      id: session.user.id, 
      name: session.user.user_metadata?.full_name || `Player ${session.user.id.slice(-4)}`
    };
  }

  // 2. Otherwise, use the legacy guest system
  const storageKey = 'puzzle-party-player-id';
  let playerId = sessionStorage.getItem(storageKey);

  if (!playerId) {
    playerId = crypto.randomUUID();
    sessionStorage.setItem(storageKey, playerId);
  }

  return { id: playerId, name: `Guest ${playerId.slice(-4)}` };
}

export default function App() {
  // --- AUTH STATE ---
  const [session, setSession] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // --- GAME STATE ---
  const [gameState, setGameState] = useState(null);
  const [socket, setSocket] = useState(null);
  const [hasLeftGame, setHasLeftGame] = useState(false);
  const status = gameState?.status ?? 'LOBBY';
  
  const localPlayerId = typeof window === 'undefined' ? null : (session?.user?.id || window.sessionStorage.getItem('puzzle-party-player-id'));
  const localPlayer = gameState?.players?.[localPlayerId];

  // --- 1. SUPABASE AUTH LISTENER ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthChecking(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- 2. SOCKET CONNECTION (Only runs AFTER Auth/Guest is confirmed) ---
  const authId = session?.user?.id; // Extract a stable ID

  useEffect(() => {
    if (!authId && !isGuest) return; 

    // --- NEW: URL-Based Match Provisioning ---
    const searchParams = new URLSearchParams(window.location.search);
    let roomId = searchParams.get('room');
    if (!roomId) {
      // Dynamic room key generation upon host initialization
      roomId = Math.random().toString(36).substring(2, 8); 
      window.history.replaceState(null, '', `?room=${roomId}`);
    }

    const { id: playerId, name } = getPlayerIdentity(session);
    const nextSocket = io(import.meta.env.VITE_SERVER_URL ?? window.location.origin, { autoConnect: true });

    const handleConnect = () => {
      // Parse explicit route metadata to the backend
      nextSocket.emit('join_game', { playerId, name, roomId });
    };

    const handleGameState = (state) => {
      setGameState(state);
    };

    nextSocket.on('connect', handleConnect);
    nextSocket.on('game_state', handleGameState);
    setSocket(nextSocket);

    return () => {
      nextSocket.off('connect', handleConnect);
      nextSocket.off('game_state', handleGameState);
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [authId, isGuest]); // Now it only reconnects if your actual ID changes

  // Initialize Voice Chat globally
  const audioElements = useVoiceChat(
    socket, 
    localPlayer?.id, 
    localPlayer?.isMicMuted ?? false, 
    localPlayer?.isSpeakerMuted ?? false
  );

  // --- RENDERING ROUTER ---
  if (isAuthChecking) {
    return <main className="lobby-screen"><p>Loading...</p></main>;
  }

  // If no session and haven't clicked guest, show Auth Gateway
  if (!session && !isGuest) {
    return <AuthScreen onGuestLogin={() => setIsGuest(true)} />;
  }

  if (hasLeftGame) {
    return (
      <main className="lobby-screen">
        <section className="glass-panel lobby-panel" style={{ textAlign: 'center', padding: '40px' }}>
          <h1 style={{ color: 'var(--text-plum)', margin: '0 0 16px' }}>You left the match.</h1>
          <p>The game is continuing for the remaining players.</p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '32px' }}>
            <button 
              type="button" 
              className="primary-button" 
              onClick={() => window.location.reload()}
            >
              Rejoin Match
            </button>
            <button 
              type="button" 
              className="secondary-button" 
              onClick={() => {
                sessionStorage.removeItem('puzzle-party-player-id');
                window.location.reload();
              }}
            >
              Exit to Lobby
            </button>
          </div>
        </section>
      </main>
    );
  }

  // --- LOBBY PROTECTION LOGIC ---
  const isActivePlayer = localPlayer?.isPlaying;
  const showLobby = status === 'LOBBY' || status === null || !isActivePlayer;

  return (
    <>
      {audioElements}
      {showLobby ? (
        <LobbyScreen gameState={gameState} socket={socket} localPlayerId={localPlayerId} />
      ) : (
        <>
          <PlayingScreen 
            gameState={gameState} 
            onGameState={setGameState} 
            onLeaveGame={() => setHasLeftGame(true)} 
            socket={socket} 
            localPlayerId={localPlayerId}
          />
          {status === 'HELP_PAUSED' && <PauseOverlay gameState={gameState} socket={socket} />}
          {status === 'GAMEOVER' && <GameOverScreen gameState={gameState} socket={socket} localPlayerId={localPlayerId} /> }
        </>
      )}
    </>
  );
}