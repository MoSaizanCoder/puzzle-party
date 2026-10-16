import 'dotenv/config';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// --- PHASE 2: DYNAMIC ROUTING MAP ---
const activeMatches = new Map();

function getLightweightState(state) {
  const { pieces, ...lightState } = state;
  return lightState;
}

function createInitialGameState(roomId) {
  return {
    matchId: roomId,
    status: 'LOBBY',
    hostId: null,
    puzzleImageSrc: null,
    players: {},
    pieces: {},
    chatHistory: [],
    broadcastMessage: null,
    boardWidth: 0,
    boardHeight: 0,
    triviaCooldownUntil: null,
    triviaQuestion: null,
    pendingAttack: null,
  };
}

let activeTrivia = null;
let triviaTimeout = null;
let triviaQuestionSequence = 0;
let broadcastTimeout = null;

const powerCosts = { self_protect: 3, focus_cracker: 4, offensive_attack: 5, ultimate_steal: 7, reverse: 10 };
const powerUpNames = { self_protect: 'Self-Protect', reverse: 'Reverse', offensive_attack: 'Offensive Attack', ultimate_steal: 'Ultimate Steal', focus_cracker: 'Focus Cracker', self_help: 'Self-Help' };

// --- ROOM-AWARE HELPER FUNCTIONS ---
function getGameState(socket) { return activeMatches.get(socket.data.roomId); }
function getPlayer(socket) { const state = getGameState(socket); return state ? state.players[socket.data.playerId] : null; }
function broadcastGameState(roomId) { 
  const state = activeMatches.get(roomId); 
  if (state) io.to(roomId).emit('game_state', getLightweightState(state)); 
}

function broadcastAlert(roomId, text, type = 'purchase') {
  const state = activeMatches.get(roomId);
  if (!state) return;
  clearTimeout(broadcastTimeout);
  state.broadcastMessage = { text, type };
  io.to(roomId).emit('game_state', state);
  broadcastTimeout = setTimeout(() => {
    if (state.broadcastMessage?.text !== text) return;
    state.broadcastMessage = null;
    broadcastTimeout = null;
    io.to(roomId).emit('game_state', state);
  }, 4000);
}

function resetGame(roomId) {
  const state = activeMatches.get(roomId);
  if (!state) return;
  clearTimeout(triviaTimeout);
  clearTimeout(broadcastTimeout);
  triviaTimeout = null;
  broadcastTimeout = null;
  activeTrivia = null;
  state.pieces = {}; state.boardWidth = 0; state.boardHeight = 0; state.puzzleImageSrc = null; state.chatHistory = [];
  state.broadcastMessage = null; state.triviaCooldownUntil = null; state.triviaQuestion = null; state.pendingAttack = null;
  for (const player of Object.values(state.players)) {
    player.score = 0; player.streak = 0; player.stats.highestStreak = 0; player.stats.attacksUsed = 0; player.stats.pointsStolen = 0;
    player.isShielded = false; player.isReversing = false; player.inventory = [];
    for (const pType of Object.keys(player.powerUpUses)) player.powerUpUses[pType] = 0;
    player.isReady = false; player.isPlaying = false;
  }
  state.status = 'LOBBY';
  io.to(roomId).emit('force_reset');
  broadcastGameState(roomId);
  updateAndBroadcastPresence();
}

function reassignHostIfNeeded(roomId) {
  const state = activeMatches.get(roomId);
  if (!state) return;
  const remainingPlayers = Object.keys(state.players);
  if (remainingPlayers.length === 0) { state.hostId = null; return; }
  if (!state.hostId || !state.players[state.hostId]) {
    state.hostId = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];
  }
}

function updateAndBroadcastPresence() {
  const presence = {};
  for (const state of activeMatches.values()) {
    const playerCount = Object.keys(state.players).length;
    const isPlaying = state.status !== 'LOBBY';
    
    for (const playerId of Object.keys(state.players)) {
      if (playerCount <= 1) presence[playerId] = 'ONLINE';
      else if (isPlaying) presence[playerId] = 'IN_GAME';
      else presence[playerId] = 'IN_LOBBY';
    }
  }
  io.emit('presence_update', presence);
}

function updatePieceSnapshots(roomId, pieces, includeGroupData = false) {
  const state = activeMatches.get(roomId);
  if (!state || !Array.isArray(pieces)) return [];
  const updatedPieces = [];
  for (const update of pieces) {
    const piece = state.pieces[update?.id];
    if (!piece || !Number.isFinite(update.x) || !Number.isFinite(update.y)) continue;
    piece.x = update.x; piece.y = update.y;
    if (includeGroupData) {
      if (typeof update.groupId === 'string' || update.groupId === null) piece.groupId = update.groupId;
      if (typeof update.isLockedInFrame === 'boolean') {
        piece.isLockedInFrame = update.isLockedInFrame;
        if (!update.isLockedInFrame) piece.placedBy = null;
      }
    }
    updatedPieces.push({ ...piece });
  }
  return updatedPieces;
}

const httpServer = createServer();

// --- GAME LOGIC ---
function scatterPiece(roomId, piece) {
  const state = activeMatches.get(roomId);
  if (!state) return;
  const width = state.boardWidth || 1600; const height = state.boardHeight || 1200;
  const pWidth = piece.shapeData?.cellWidth ?? 80; const pHeight = piece.shapeData?.cellHeight ?? 80;
  const margin = 12; const maxX = Math.max(margin, width - pWidth - margin); const maxY = Math.max(margin, height - pHeight - margin);
  const hBand = Math.max(margin, height * 0.16); const vBand = Math.max(margin, width * 0.16);
  const zones = [
    { minX: margin, maxX, minY: margin, maxY: Math.max(margin, hBand - pHeight) },
    { minX: margin, maxX, minY: Math.min(maxY, height - hBand), maxY },
    { minX: margin, maxX: Math.max(margin, vBand - pWidth), minY: margin, maxY },
    { minX: Math.min(maxX, width - vBand), maxX, minY: margin, maxY },
  ].filter((z) => z.maxX >= z.minX && z.maxY >= z.minY);
  const zone = zones[Math.floor(Math.random() * zones.length)];
  piece.x = zone.minX + Math.random() * (zone.maxX - zone.minX); piece.y = zone.minY + Math.random() * (zone.maxY - zone.minY);
  piece.groupId = null; piece.isLockedInFrame = false; piece.placedBy = null;
}

function stealPlacedPieces(roomId, playerId, amount) {
  const state = activeMatches.get(roomId);
  if (!state) return [];
  const placed = Object.values(state.pieces).filter((p) => p.placedBy === playerId && p.isLockedInFrame);
  for (let i = placed.length - 1; i > 0; i--) {
    const swap = Math.floor(Math.random() * (i + 1));
    [placed[i], placed[swap]] = [placed[swap], placed[i]];
  }
  const stolen = placed.slice(0, amount);
  stolen.forEach(p => scatterPiece(roomId, p));
  return stolen; // <-- Now returning the array
}

function transferAvailablePoints(source, destination, amount) {
  const stolen = Math.min(amount, Math.max(0, source.score));
  source.score -= stolen; destination.score += stolen; destination.stats.pointsStolen += stolen;
  return stolen;
}

function acknowledge(callback, result) { if (typeof callback === 'function') callback(result); }

function createTriviaQuestion(roomId) {
  const state = activeMatches.get(roomId);
  if (!state) return null;
  const players = Object.values(state.players);
  if (players.length === 0) return null;
  const askHigh = Math.random() < 0.5;
  const ranked = [...players].sort((a, b) => askHigh ? b.streak - a.streak : a.score - b.score);
  const correctPlayer = ranked[0];
  const options = ranked.slice(0, 4).map((p) => ({ id: p.id, label: p.name }));
  const seq = ++triviaQuestionSequence;
  while (options.length < 4) options.push({ id: `trivia-decoy-${seq}-${options.length + 1}`, label: `Guest ${options.length + 1}` });
  for (let i = options.length - 1; i > 0; i--) { const swap = Math.floor(Math.random() * (i + 1)); [options[i], options[swap]] = [options[swap], options[i]]; }
  return { id: `trivia-${seq}`, prompt: askHigh ? 'Which player currently has the highest streak?' : 'Which player currently has the lowest score?', options, expiresAt: Date.now() + 30000, correctAnswerId: correctPlayer.id };
}

function resolveTrivia(roomId, player, answerId) {
  const state = activeMatches.get(roomId);
  if (!state || !activeTrivia) return null;
  const correct = Boolean(player && answerId === activeTrivia.correctAnswerId);
  if (correct) player.inventory.push('self_help');
  clearTimeout(triviaTimeout); triviaTimeout = null; activeTrivia = null; state.triviaQuestion = null; state.status = 'PLAYING';
  return correct;
}

function applyOffensiveAttack(roomId, attacker, target) {
  if (target.isReversing) {
    target.isReversing = false; attacker.score -= 2; target.score += 2;
    const stolenPieces = stealPlacedPieces(roomId, attacker.id, 2);
    return { reversed: true, stolenPieces, message: `${target.name} reversed the attack.` };
  }
  if (target.isShielded) { target.isShielded = false; return { message: `${target.name}'s shield blocked the attack.` }; }
  target.score -= 2; attacker.score += 2; attacker.stats.pointsStolen += 2;
  const stolenPieces = stealPlacedPieces(roomId, target.id, 2);
  return { stolenPieces, message: `Attack landed on ${target.name}.` };
}

function applyUltimateSteal(roomId, attacker) {
  const state = activeMatches.get(roomId);
  if (!state) return;
  const others = Object.values(state.players).filter((p) => p.id !== attacker.id);
  const reversingPlayer = others.find((p) => p.isReversing);
  if (reversingPlayer) {
    reversingPlayer.isReversing = false;
    const stolenPoints = transferAvailablePoints(attacker, reversingPlayer, 4);
    const stolenPieces = stealPlacedPieces(roomId, attacker.id, 4);
    return { reversed: true, affectedPlayers: 1, stolenPoints, stolenPieces, message: `${reversingPlayer.name} reversed the Ultimate Steal.` };
  }
  let affectedPlayers = 0; let stolenPoints = 0; let stolenPieces = [];
  for (const p of others) {
    if (p.isShielded) { p.isShielded = false; continue; }
    affectedPlayers += 1; stolenPoints += transferAvailablePoints(p, attacker, 4); 
    stolenPieces.push(...stealPlacedPieces(roomId, p.id, 4));
  }
  return { affectedPlayers, stolenPoints, stolenPieces, message: 'Ultimate Steal resolved.' };
}

function applyFocusCracker(roomId, attacker) {
  const state = activeMatches.get(roomId);
  if (!state) return;
  let shieldChanged = false; let reversed = false;
  for (const p of Object.values(state.players)) {
    if (p.id === attacker.id) continue;
    if (p.isShielded) { p.isShielded = false; shieldChanged = true; continue; }
    if (p.isReversing && !reversed) { p.isReversing = false; io.to(attacker.id).emit('focus_cracker', { durationMs: 15000 }); reversed = true; continue; }
    io.to(p.id).emit('focus_cracker', { durationMs: 15000 });
  }
  return { shieldChanged, reversed };
}

const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' } });

io.on('connection', (socket) => {
  socket.on('join_game', async ({ playerId, name, roomId } = {}) => {
    if (typeof playerId !== 'string' || !roomId) return;

    // --- NEW: MULTI-TAB & DUPLICATE LOGIN PREVENTION ---
    // Check if any active websockets are already using this Player ID
    const existingSockets = await io.in(playerId).fetchSockets();
    if (existingSockets.length > 0) {
      // Forcibly disconnect the old "ghost" sockets so the reload succeeds
      existingSockets.forEach(oldSocket => {
        oldSocket.emit('lobby_error', { message: 'Session refreshed.' });
        oldSocket.disconnect(true);
      });
    }

    socket.data.playerId = playerId;
    socket.data.roomId = roomId;
    socket.join(playerId); // Critical for WebRTC targeted signaling
    socket.join(roomId);   // Critical for Room-based isolation

    if (!activeMatches.has(roomId)) activeMatches.set(roomId, createInitialGameState(roomId));
    const state = activeMatches.get(roomId);

    const currentPlayersCount = Object.keys(state.players).length;
    if (currentPlayersCount >= 4 && !state.players[playerId]) {
      socket.emit('lobby_error', { message: 'Error: Lobby Full' });
      return;
    }

    // --- NEW: FETCH DB STATS, FRIENDS & PROFILE ---
    let dbStats = null;
    let dbFriends = [];
    let dbPendingRequests = [];
    let dbProfile = null;
    
    if (supabase && playerId.length > 20) { 
      let { data: profileData } = await supabase.from('profiles').select('*').eq('id', playerId).single();
      if (!profileData) {
        const { data: newProfile } = await supabase.from('profiles').insert({ id: playerId, display_name: name }).select('*').single();
        profileData = newProfile;
      }
      dbProfile = profileData;

      const { data: statsData } = await supabase.from('stats').select('*').eq('user_id', playerId).single();
      dbStats = statsData;

      // Fetch ALL friendships (Accepted AND Pending Inbound)
      const { data: friendshipsData } = await supabase
        .from('friendships')
        .select('*')
        .or(`user_id_1.eq.${playerId},user_id_2.eq.${playerId}`);

      if (friendshipsData && friendshipsData.length > 0) {
        const uniqueIds = [...new Set(friendshipsData.map(f => f.user_id_1 === playerId ? f.user_id_2 : f.user_id_1))];
        const { data: profiles } = await supabase.from('profiles').select('id, display_name, short_id').in('id', uniqueIds);
        
        if (profiles) {
          const profileMap = Object.fromEntries(profiles.map(p => [p.id, { id: p.id, name: p.display_name, shortId: p.short_id }]));
          
          dbFriends = friendshipsData
            .filter(f => f.status === 'accepted')
            .map(f => profileMap[f.user_id_1 === playerId ? f.user_id_2 : f.user_id_1])
            .filter(Boolean);
            
          dbPendingRequests = friendshipsData
            .filter(f => f.status === 'pending' && f.user_id_2 === playerId) // Only inbound requests
            .map(f => profileMap[f.user_id_1])
            .filter(Boolean);
        }
      }
    }

    const finalName = dbProfile?.display_name || (typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : 'Player');

    state.players[playerId] ??= {
      id: playerId,
      shortId: dbProfile?.short_id || playerId,
      name: finalName,
      isReady: false,
      isPlaying: false,
      friendsList: dbFriends, 
      pendingRequests: dbPendingRequests, // <-- Added pending requests array
      score: 0,
      streak: 0,
      inventory: [],
      powerUpUses: { self_protect: 0, reverse: 0, offensive_attack: 0, ultimate_steal: 0, focus_cracker: 0, self_help: 0 },
      isReversing: false,
      isShielded: false,
      isMicMuted: false,
      isSpeakerMuted: false,
      isSpeaking: false,
      stats: { highestStreak: 0, attacksUsed: 0, pointsStolen: 0 },
      lifetimeStats: dbStats || { games_played: 0, total_wins: 0, highest_streak: 0, attacks_used: 0, points_stolen: 0 }
    };

    if (!state.hostId || !state.players[state.hostId]) state.hostId = playerId;
    io.to(roomId).emit('game_state', getLightweightState(state));
    socket.emit('sync_all_pieces', state.pieces);
    updateAndBroadcastPresence();
  });

  socket.on('disconnect', () => {
    const { playerId, roomId } = socket.data;
    if (!playerId || !roomId) return;
    const state = activeMatches.get(roomId);
    if (!state) return;

    const wasHost = state.hostId === playerId;
    delete state.players[playerId];

    const activePlayers = Object.values(state.players).filter(p => p.isPlaying);
    if (Object.keys(state.players).length === 0) {
      activeMatches.delete(roomId); // Clean up the room when empty
      return;
    } else if (activePlayers.length === 0 && state.status !== 'LOBBY') {
      state.hostId = null;
      resetGame(roomId);
      return;
    }

    if (wasHost || (state.hostId && !state.players[state.hostId])) reassignHostIfNeeded(roomId);
    broadcastGameState(roomId);
    updateAndBroadcastPresence();
  });

  socket.on('webrtc_signal', ({ targetId, signal } = {}) => {
    const player = getPlayer(socket);
    if (!player || !targetId) return;
    io.to(targetId).emit('webrtc_signal', { senderId: player.id, signal });
  });

  socket.on('leave_game', (_payload = {}, callback) => {
    const { playerId, roomId } = socket.data;
    const state = getGameState(socket);
    if (!state || !state.players[playerId]) {
      acknowledge(callback, { ok: false, message: 'You are not in the game.' });
      return;
    }
    const wasHost = state.hostId === playerId;
    delete state.players[playerId];
    socket.data.playerId = null; socket.data.roomId = null;
    socket.leave(roomId); socket.leave(playerId);

    const activePlayers = Object.values(state.players).filter(p => p.isPlaying);
    if (Object.keys(state.players).length === 0) {
      activeMatches.delete(roomId);
    } else if (activePlayers.length === 0 && state.status !== 'LOBBY') {
      state.hostId = null;
      resetGame(roomId);
    } else {
      if (wasHost) reassignHostIfNeeded(roomId);
      broadcastGameState(roomId);
    }
    acknowledge(callback, { ok: true });
    updateAndBroadcastPresence();
  });

  socket.on('send_reminder', ({ targetId }, callback) => {
    const player = getPlayer(socket);
    if (player && targetId) {
      io.to(targetId).emit('reminder_received', { senderId: player.id, senderName: player.name });
      if (typeof callback === 'function') callback({ ok: true });
    }
  });

  socket.on('reply_reminder', ({ targetId, text }) => {
    const player = getPlayer(socket);
    if (player && targetId) {
      io.to(targetId).emit('reminder_reply_received', { senderName: player.name, text });
    }
  });

  socket.on('request_presence', () => {
    updateAndBroadcastPresence();
  });

  socket.on('toggle_ready', (_payload = {}, callback) => {
    const player = getPlayer(socket);
    if (!player) { acknowledge(callback, { ok: false, message: 'Join the game before toggling ready.' }); return; }
    player.isReady = !player.isReady;
    acknowledge(callback, { ok: true, isReady: player.isReady });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('select_image', ({ imageUrl } = {}, callback) => {
    const player = getPlayer(socket); const state = getGameState(socket);
    if (!player || !state) { acknowledge(callback, { ok: false, message: 'Join the lobby before selecting an image.' }); return; }
    if (state.hostId !== player.id) { acknowledge(callback, { ok: false, message: 'Only the host can select an image.' }); return; }
    if (typeof imageUrl !== 'string' || !imageUrl.trim()) { acknowledge(callback, { ok: false, message: 'Choose a valid image URL.' }); return; }
    state.puzzleImageSrc = imageUrl.trim();
    acknowledge(callback, { ok: true, imageUrl: state.puzzleImageSrc });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('start_game', (_payload = {}, callback) => {
    const player = getPlayer(socket); const state = getGameState(socket);
    if (!player || !state) { acknowledge(callback, { ok: false, message: 'Join the lobby before starting the game.' }); return; }
    if (state.hostId !== player.id) { acknowledge(callback, { ok: false, message: 'Only the host can start the game.' }); return; }
    if (!state.puzzleImageSrc) { acknowledge(callback, { ok: false, message: 'Select a puzzle image before starting.' }); return; }
    const otherPlayers = Object.values(state.players).filter((entry) => entry.id !== state.hostId);
    const allReady = otherPlayers.length === 0 || otherPlayers.every((entry) => entry.isReady === true);
    if (!allReady) { acknowledge(callback, { ok: false, message: 'Every non-host player must be ready.' }); return; }
    
    // --- NEW: If starting a fresh game after a Game Over, wipe the old stats and pieces ---
    if (state.status === 'GAMEOVER') {
      state.pieces = {};
      state.chatHistory = [];
      for (const p of Object.values(state.players)) {
        p.score = 0; 
        p.streak = 0; 
        p.stats = { highestStreak: 0, attacksUsed: 0, pointsStolen: 0 };
        p.isShielded = false; 
        p.isReversing = false; 
        p.inventory = [];
        for (const type of Object.keys(p.powerUpUses)) p.powerUpUses[type] = 0;
      }
      io.to(socket.data.roomId).emit('force_reset');
    }
    // --------------------------------------------------------------------------------------

    for (const entry of Object.values(state.players)) { if (entry.id === state.hostId || entry.isReady) entry.isPlaying = true; }
    state.status = 'PLAYING';
    acknowledge(callback, { ok: true, status: state.status });
    broadcastGameState(socket.data.roomId);
    updateAndBroadcastPresence();
  });

  socket.on('send_friend_request', async ({ targetPlayerId } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player || !supabase || player.id.length <= 20) return;
    
    const targetId = targetPlayerId?.trim();
    if (!targetId || targetId === player.id) return;

    // Check if already friends or pending
    const existing = await supabase.from('friendships').select('id').or(`and(user_id_1.eq.${player.id},user_id_2.eq.${targetId}),and(user_id_1.eq.${targetId},user_id_2.eq.${player.id})`).single();
    if (existing.data) {
      acknowledge(callback, { ok: false, message: 'Request already exists or you are already friends.' });
      return;
    }

    const { error } = await supabase.from('friendships').insert({ user_id_1: player.id, user_id_2: targetId, status: 'pending' });
    if (!error) {
      // Instantly alert the target player in their active socket room
      io.to(targetId).emit('friend_request_received', { id: player.id, name: player.name, shortId: player.shortId });
    }
    acknowledge(callback, { ok: !error });
  });

  socket.on('resolve_friend_request', async ({ requesterId, accept } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player || !supabase) return;

    if (accept) {
      await supabase.from('friendships').update({ status: 'accepted' }).match({ user_id_1: requesterId, user_id_2: player.id });
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', requesterId).single();
      if (profile) {
        player.friendsList.push({ id: profile.id, name: profile.display_name, shortId: profile.short_id });
      }
    } else {
      await supabase.from('friendships').delete().match({ user_id_1: requesterId, user_id_2: player.id });
    }

    // Clear from RAM
    player.pendingRequests = (player.pendingRequests || []).filter(req => req.id !== requesterId);
    
    acknowledge(callback, { ok: true });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('remove_friend', async ({ friendId } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player || !supabase || !friendId) return;

    // 1. Delete from Supabase
    await supabase.from('friendships').delete()
      .or(`and(user_id_1.eq.${player.id},user_id_2.eq.${friendId}),and(user_id_1.eq.${friendId},user_id_2.eq.${player.id})`);

    // 2. Remove from active server memory
    player.friendsList = player.friendsList.filter(f => f.id !== friendId);
    
    acknowledge(callback, { ok: true, friendsList: player.friendsList });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('get_friend_stats', async ({ friendId } = {}, callback) => {
    if (!supabase || !friendId) {
      acknowledge(callback, { ok: false, message: 'Invalid request' });
      return;
    }
    
    // Fetch read-only stats for the requested friend
    const { data: stats } = await supabase.from('stats').select('*').eq('user_id', friendId).single();
    acknowledge(callback, { ok: true, stats: stats || { games_played: 0, total_wins: 0, highest_streak: 0, attacks_used: 0, points_stolen: 0 } });
  });

  socket.on('get_leaderboard', async (_payload, callback) => {
    if (!supabase) {
      if (typeof callback === 'function') callback({ ok: false, message: 'Database not configured' });
      return;
    }
    
    try {
      // Fetch top 50 players sorted by total wins
      const { data, error } = await supabase
        .from('stats')
        .select(`
          total_wins,
          highest_streak,
          games_played,
          user_id,
          profiles ( display_name, short_id )
        `)
        .order('total_wins', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Format it cleanly for the frontend
      const leaderboard = data.map((row) => ({
        id: row.user_id,
        name: row.profiles?.display_name || 'Unknown',
        shortId: row.profiles?.short_id || '----',
        wins: row.total_wins || 0,
        streak: row.highest_streak || 0,
        gamesPlayed: row.games_played || 0
      }));

      if (typeof callback === 'function') callback({ ok: true, leaderboard });
    } catch (err) {
      console.error('Leaderboard error:', err);
      if (typeof callback === 'function') callback({ ok: false, message: 'Failed to load leaderboard.' });
    }
  });

  socket.on('send_lobby_invite', async ({ targetPlayerId, roomId, roomName } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player || !targetPlayerId) return;

    const inviterState = getGameState(socket);
    const inviterCount = inviterState ? Object.keys(inviterState.players).length : 1;

    const targetSockets = await io.in(targetPlayerId).fetchSockets();
    const targetSocket = targetSockets[0];
    const targetRoomId = targetSocket?.data?.roomId;
    const targetState = activeMatches.get(targetRoomId);
    const targetCount = targetState ? Object.keys(targetState.players).length : 0;

    if (inviterCount === 1 && targetCount > 1 && targetRoomId) {
      if (typeof callback === 'function') {
        callback({ 
          ok: false, 
          redirectRoomId: targetRoomId, 
          message: `${targetSocket.data.name || 'Friend'} is in a party. Joining their lobby instead!` 
        });
      }
      return;
    }

    io.to(targetPlayerId).emit('lobby_invite_received', {
      senderName: player.name,
      roomId,
      roomName: roomName || `${player.name}'s Game`
    });

    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('delete_account', async (_payload, callback) => {
    const player = getPlayer(socket);
    if (!player || !supabase || player.id.length <= 20) {
      if (typeof callback === 'function') callback({ ok: false, message: 'Only registered accounts can be deleted.' });
      return;
    }

    try {
      await supabase.from('friendships').delete().or(`user_id_1.eq.${player.id},user_id_2.eq.${player.id}`);
      await supabase.from('stats').delete().eq('user_id', player.id);
      await supabase.from('profiles').delete().eq('id', player.id);
      
      await supabase.auth.admin.deleteUser(player.id);
      
      if (typeof callback === 'function') callback({ ok: true });
      socket.disconnect(true);
    } catch (err) {
      console.error('Error deleting account:', err);
      if (typeof callback === 'function') callback({ ok: false, message: 'Failed to delete account.' });
    }
  });

  socket.on('dev_reset_game', () => {
    const player = getPlayer(socket); const state = getGameState(socket);
    if (!player || !state || state.hostId !== player.id) return;
    state.pieces = {}; state.status = 'PLAYING';
    for (const p of Object.values(state.players)) {
      p.score = 0; p.streak = 0; p.isShielded = false; p.isReversing = false; p.inventory = [];
      for (const type of Object.keys(p.powerUpUses)) p.powerUpUses[type] = 0;
    }
    io.to(socket.data.roomId).emit('force_reset');
    broadcastAlert(socket.data.roomId, 'The Host Reset The Game!', 'defense');
    broadcastGameState(socket.data.roomId);
  });

  socket.on('return_to_lobby_individual', () => {
    const player = getPlayer(socket);
    const state = getGameState(socket);
    if (!player || !state) return;

    // This drops the player back to the Lobby screen while keeping them in the party
    player.isPlaying = false;
    player.isReady = false; 

    broadcastGameState(socket.data.roomId);
    updateAndBroadcastPresence();
  });

  socket.on('return_to_lobby', () => {
    const player = getPlayer(socket); const state = getGameState(socket);
    if (!player || !state || state.hostId !== player.id) return;
    resetGame(socket.data.roomId);
  });

  socket.on('initialize_pieces', ({ pieces, boardWidth, boardHeight } = {}) => {
    const state = getGameState(socket);
    if (!state) return;
    if (!getPlayer(socket) || Object.keys(state.pieces).length > 0) { socket.emit('game_state', state); return; }
    if (!Array.isArray(pieces) || pieces.length === 0 || pieces.length > 500 || !Number.isFinite(boardWidth) || !Number.isFinite(boardHeight)) return;
    state.pieces = Object.fromEntries(pieces.filter((piece) => piece && typeof piece.id === 'string' && Number.isFinite(piece.x) && Number.isFinite(piece.y) && Array.isArray(piece.shapeData?.path)).map((piece) => [piece.id, { ...piece, placedBy: null }]));
    state.boardWidth = boardWidth; state.boardHeight = boardHeight;
    io.to(socket.data.roomId).emit('sync_all_pieces', state.pieces);
    broadcastGameState(socket.data.roomId);
  });

  socket.on('piece_moved', ({ pieces } = {}) => {
    if (!getPlayer(socket)) return;
    const updatedPieces = updatePieceSnapshots(socket.data.roomId, pieces);
    if (updatedPieces.length > 0) socket.to(socket.data.roomId).emit('piece_moved', { pieces: updatedPieces });
  });

  socket.on('piece_connected', ({ pieces } = {}) => {
    const player = getPlayer(socket); const state = getGameState(socket);
    if (!player || !state || !Array.isArray(pieces)) return;
    const previousLockState = new Map((pieces ?? []).map((update) => [update.id, state.pieces[update.id]?.isLockedInFrame ?? false]));
    const updatedPieces = updatePieceSnapshots(socket.data.roomId, pieces, true);
    if (updatedPieces.length === 0) return;
    io.to(socket.data.roomId).emit('pieces_updated', updatedPieces);
    
    let newlyLockedCount = 0;
    for (const update of pieces ?? []) {
      const piece = state.pieces[update.id];
      if (piece?.isLockedInFrame && !previousLockState.get(update.id) && !piece.placedBy) { piece.placedBy = player.id; newlyLockedCount++; }
    }
    
    const pointsEarned = newlyLockedCount > 0 ? newlyLockedCount : 1;
    player.score += pointsEarned; player.streak += pointsEarned;
    if (player.streak > player.stats.highestStreak) player.stats.highestStreak = player.streak;
    
    const allPieces = Object.values(state.pieces);
    if (allPieces.length > 0) {
      const referenceGroupId = allPieces[0].groupId;
      const allShareGroup = typeof referenceGroupId === 'string' && referenceGroupId.length > 0 && allPieces.every((piece) => piece.groupId === referenceGroupId);
      const allLocked = allPieces.every((piece) => piece.isLockedInFrame);

      if (allShareGroup || allLocked) {
        state.status = 'GAMEOVER';
        if (supabase) {
          const calculateTotal = (p) => (p.score || 0) + (p.stats.attacksUsed || 0);
          const playersList = Object.values(state.players).filter(p => p.isPlaying);
          const sorted = [...playersList].sort((a, b) => calculateTotal(b) - calculateTotal(a));
          const winnerId = sorted[0]?.id;
          for (const p of playersList) {
            if (p.id.length > 20) {
              const newGamesPlayed = (p.lifetimeStats.games_played || 0) + 1;
              const newTotalWins = (p.lifetimeStats.total_wins || 0) + (p.id === winnerId ? 1 : 0);
              const newHighestStreak = Math.max(p.lifetimeStats.highest_streak || 0, p.stats.highestStreak);
              const newAttacksUsed = (p.lifetimeStats.attacks_used || 0) + p.stats.attacksUsed;
              const newPointsStolen = (p.lifetimeStats.points_stolen || 0) + p.stats.pointsStolen;
              supabase.from('stats').upsert({ user_id: p.id, games_played: newGamesPlayed, total_wins: newTotalWins, highest_streak: newHighestStreak, attacks_used: newAttacksUsed, points_stolen: newPointsStolen }).then(({ error }) => { if (error) console.error(error); });
              p.lifetimeStats = { games_played: newGamesPlayed, total_wins: newTotalWins, highest_streak: newHighestStreak, attacks_used: newAttacksUsed, points_stolen: newPointsStolen };
            }
          }
        }
      }
    }
    broadcastGameState(socket.data.roomId);
  });

  socket.on('send_chat', (payload, callback) => {
    const player = getPlayer(socket); const state = getGameState(socket);
    const text = (typeof payload === 'string' ? payload : payload?.text)?.trim();
    if (!player || !state || typeof text !== 'string' || !text) { acknowledge(callback, { ok: false, message: 'Enter a message before sending.' }); return; }
    const message = { id: randomUUID(), playerId: player.id, playerName: player.name, text: text.slice(0, 500), sentAt: Date.now() };
    state.chatHistory.push(message); state.chatHistory = state.chatHistory.slice(-50);
    acknowledge(callback, { ok: true, messageId: message.id });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('update_voice_state', (updates = {}, callback) => {
    const player = getPlayer(socket);
    if (!player) { acknowledge(callback, { ok: false, message: 'Join the game before changing voice settings.' }); return; }
    const validUpdates = ['isMicMuted', 'isSpeakerMuted', 'isSpeaking'].filter((key) => typeof updates[key] === 'boolean');
    if (validUpdates.length === 0) return;
    for (const key of validUpdates) player[key] = updates[key];
    acknowledge(callback, { ok: true });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('trigger_help_request', (_payload = {}, callback) => {
    const player = getPlayer(socket); const state = getGameState(socket); const now = Date.now();
    if (!player || !state) return;
    if (state.triviaCooldownUntil && state.triviaCooldownUntil > now) { acknowledge(callback, { ok: false, message: 'Help is on cooldown.' }); return; }
    if (state.status !== 'PLAYING' || activeTrivia) { acknowledge(callback, { ok: false, message: 'Help is not available right now.' }); return; }
    const question = createTriviaQuestion(socket.data.roomId);
    if (!question) { acknowledge(callback, { ok: false, message: 'Not enough players.' }); return; }
    activeTrivia = question;
    state.triviaQuestion = { id: question.id, prompt: question.prompt, options: question.options, expiresAt: question.expiresAt };
    state.status = 'HELP_PAUSED'; state.triviaCooldownUntil = question.expiresAt;
    triviaTimeout = setTimeout(() => {
      if (activeTrivia?.id !== question.id) return;
      resolveTrivia(socket.data.roomId, null, null);
      broadcastGameState(socket.data.roomId);
    }, question.expiresAt - now);
    acknowledge(callback, { ok: true, message: 'Trivia paused the game.' });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('submit_trivia_answer', ({ questionId, answerId } = {}, callback) => {
    const player = getPlayer(socket); const state = getGameState(socket);
    if (!player || !state || state.status !== 'HELP_PAUSED' || activeTrivia?.id !== questionId) { acknowledge(callback, { ok: false, message: 'No active question.' }); return; }
    const correct = resolveTrivia(socket.data.roomId, player, answerId);
    acknowledge(callback, { ok: true, correct, message: correct ? 'Correct. You earned Self-Help.' : 'Not quite. The game is resuming.' });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('purchase_powerup', ({ playerId, powerUpType } = {}, callback) => {
    const state = getGameState(socket);
    if (typeof playerId !== 'string' || playerId !== socket.data.playerId || !state) return;
    const player = state.players[playerId];
    if (!player || typeof powerUpType !== 'string' || !Object.hasOwn(powerCosts, powerUpType)) return;
    if ((player.powerUpUses[powerUpType] ?? 0) >= 2) { acknowledge(callback, { ok: false, message: 'Maximum uses reached.' }); return; }
    const cost = powerCosts[powerUpType];
    if (player.streak < cost) { acknowledge(callback, { ok: false, message: `Requires a ${cost} streak.` }); return; }
    player.streak -= cost;
    if (powerUpType === 'self_protect') { player.isShielded = true; player.powerUpUses[powerUpType] += 1; } else { player.inventory.push(powerUpType); }
    acknowledge(callback, { ok: true, message: powerUpType === 'self_protect' ? 'Shield activated.' : `${powerUpNames[powerUpType]} added.` });
    broadcastAlert(socket.data.roomId, `${player.name} Bought ${powerUpNames[powerUpType]}`, 'purchase');
  });

  socket.on('wrong_placement', ({ playerId } = {}) => {
    const state = getGameState(socket);
    if (typeof playerId !== 'string' || playerId !== socket.data.playerId || !state) return;
    const player = state.players[playerId];
    if (!player) return;
    player.streak = 0;
    io.to(socket.data.roomId).emit('game_state', state);
  });

  socket.on('resolve_reverse', ({ attackId, useReverse } = {}, callback) => {
    const player = getPlayer(socket); const state = getGameState(socket);
    if (!player || !state || state.status !== 'REVERSE_PAUSED' || state.pendingAttack?.id !== attackId) return;
    if (state.pendingAttack.targetId !== player.id) return;
    const { attackerId, powerUp } = state.pendingAttack;
    const attacker = state.players[attackerId];
    state.status = 'PLAYING'; state.pendingAttack = null;
    if (useReverse) {
      const reverseIndex = player.inventory.indexOf('reverse');
      if (reverseIndex > -1) { player.inventory.splice(reverseIndex, 1); player.powerUpUses['reverse'] += 1; player.isReversing = true; }
    }
    let result;
    if (powerUp === 'offensive_attack') result = applyOffensiveAttack(socket.data.roomId, attacker, player);
    else if (powerUp === 'ultimate_steal') result = applyUltimateSteal(socket.data.roomId, attacker);
    player.isReversing = false;
    if (result?.message) broadcastAlert(socket.data.roomId, result.message, 'defense');
    if (result?.stolenPieces?.length > 0) io.to(socket.data.roomId).emit('pieces_updated', result.stolenPieces);
    acknowledge(callback, { ok: true, ...result });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('use_powerup', ({ powerUpType, targetId } = {}, callback) => {
    const player = getPlayer(socket); const state = getGameState(socket);
    if (!player || !state || typeof powerUpType !== 'string' || !Object.hasOwn(player.powerUpUses, powerUpType)) return;
    if ((player.powerUpUses[powerUpType] ?? 0) >= 2) return;
    const inventoryIndex = player.inventory.indexOf(powerUpType);
    if (inventoryIndex < 0) return;
    const target = powerUpType === 'offensive_attack' ? state.players[targetId] : null;

    if (powerUpType === 'offensive_attack' || powerUpType === 'ultimate_steal') {
      let interceptTarget = null;
      if (powerUpType === 'offensive_attack') { if (target && target.inventory.includes('reverse')) interceptTarget = target; }
      else if (powerUpType === 'ultimate_steal') interceptTarget = Object.values(state.players).find((p) => p.id !== player.id && p.inventory.includes('reverse'));
      
      if (interceptTarget) {
        const attackId = randomUUID();
        state.pendingAttack = { id: attackId, attackerId: player.id, targetId: interceptTarget.id, powerUp: powerUpType, expiresAt: Date.now() + 5000 };
        state.status = 'REVERSE_PAUSED';
        player.inventory.splice(inventoryIndex, 1); player.powerUpUses[powerUpType] += 1;
        setTimeout(() => {
          if (state.pendingAttack?.id === attackId && state.status === 'REVERSE_PAUSED') {
            state.status = 'PLAYING'; state.pendingAttack = null;
            let timeoutResult;
            if (powerUpType === 'offensive_attack') timeoutResult = applyOffensiveAttack(socket.data.roomId, player, interceptTarget);
            else timeoutResult = applyUltimateSteal(socket.data.roomId, player);
            if (timeoutResult?.message) broadcastAlert(socket.data.roomId, timeoutResult.message);
            if (timeoutResult?.stolenPieces?.length > 0) {
              io.to(socket.data.roomId).emit('pieces_updated', timeoutResult.stolenPieces);
            }
            broadcastGameState(socket.data.roomId);
          }
        }, 5000);
        acknowledge(callback, { ok: true, message: `Attack paused. ${interceptTarget.name} has 5s to react.` });
        broadcastGameState(socket.data.roomId);
        return;
      }
    }

    let result;
    if (powerUpType === 'self_help') {
      const availablePieces = Object.values(state.pieces).filter((piece) => !piece.isLockedInFrame);
      if (availablePieces.length < 2) return;
      let pair = null;
      for (let i = 0; i < availablePieces.length; i++) {
        for (let j = i + 1; j < availablePieces.length; j++) {
          const p1 = availablePieces[i]; const p2 = availablePieces[j];
          const rowDiff = Math.abs(p1.shapeData.gridRow - p2.shapeData.gridRow); const colDiff = Math.abs(p1.shapeData.gridColumn - p2.shapeData.gridColumn);
          if (rowDiff + colDiff === 1) { pair = [p1, p2]; break; }
        }
        if (pair) break;
      }
      if (!pair) pair = [availablePieces[0], availablePieces[1]];
      io.to(player.id).emit('guide_piece_highlight', { pieceIds: [pair[0].id, pair[1].id], durationMs: 5000 });
      result = { ok: true, message: 'Two connecting pieces are highlighted on your board.' };
    } else if (powerUpType === 'reverse') {
      return;
    } else if (powerUpType === 'offensive_attack') {
      result = { ok: true, ...applyOffensiveAttack(socket.data.roomId, player, target) };
    } else if (powerUpType === 'ultimate_steal') {
      result = { ok: true, ...applyUltimateSteal(socket.data.roomId, player) };
    } else if (powerUpType === 'focus_cracker') {
      const focusResult = applyFocusCracker(socket.data.roomId, player);
      result = { ok: true, message: focusResult.reversed ? 'Focus Cracker was reversed.' : 'Focus Cracker sent.' };
    } else {
      player.isShielded = true; result = { ok: true, message: 'Shield activated.' };
    }

    player.inventory.splice(inventoryIndex, 1); player.powerUpUses[powerUpType] += 1;
    if (['offensive_attack', 'ultimate_steal', 'focus_cracker'].includes(powerUpType)) player.stats.attacksUsed += 1;
    if (result?.stolenPieces?.length > 0) io.to(socket.data.roomId).emit('pieces_updated', result.stolenPieces);
    acknowledge(callback, result);
    const alertType = powerUpType === 'self_protect' ? 'defense' : 'attack';
    broadcastAlert(socket.data.roomId, `${player.name} used ${powerUpNames[powerUpType]}!`, alertType);
  });

  socket.on('update_profile_name', async ({ newName } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player || !supabase || player.id.length <= 20) {
      acknowledge(callback, { ok: false, message: 'Only registered accounts can change their name.' });
      return;
    }
    
    const trimmedName = newName?.trim().slice(0, 40);
    if (!trimmedName) return;

    // Check if name is taken by someone else
    const { data: existing } = await supabase.from('profiles').select('id').eq('display_name', trimmedName).neq('id', player.id).single();
    if (existing) {
      acknowledge(callback, { ok: false, message: 'That name is already taken!' });
      return;
    }

    const { error } = await supabase.from('profiles').update({ display_name: trimmedName }).eq('id', player.id);
    if (error) {
      acknowledge(callback, { ok: false, message: 'Error saving name.' });
      return;
    }

    player.name = trimmedName;
    acknowledge(callback, { ok: true, name: trimmedName });
    broadcastGameState(socket.data.roomId);
  });

  socket.on('search_players', async ({ query } = {}, callback) => {
    if (!supabase || typeof query !== 'string' || query.trim().length < 3) {
      acknowledge(callback, { ok: true, results: [] });
      return;
    }
    
    const safeQuery = query.trim();
    // Search by partial display_name OR exact short_id
    const { data } = await supabase.from('profiles')
      .select('id, display_name, short_id')
      .or(`display_name.ilike.%${safeQuery}%,short_id.ilike.${safeQuery}`)
      .limit(10);

    acknowledge(callback, { ok: true, results: data || [] });
  });

});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => { console.log(`Puzzle Party server listening on port ${port}`); });