import 'dotenv/config';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase using the secure Service Role Key
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY 
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY) 
  : null;

const gameState = {
  matchId: 'puzzle-party-local',
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

let activeTrivia = null;
let triviaTimeout = null;
let triviaQuestionSequence = 0;
let broadcastTimeout = null;

const powerCosts = {
  self_protect: 3,
  focus_cracker: 4,
  offensive_attack: 5,
  ultimate_steal: 7,
  reverse: 10,
};

const powerUpNames = {
  self_protect: 'Self-Protect',
  reverse: 'Reverse',
  offensive_attack: 'Offensive Attack',
  ultimate_steal: 'Ultimate Steal',
  focus_cracker: 'Focus Cracker',
  self_help: 'Self-Help',
};

function broadcastGameState() {
  io.emit('game_state', gameState);
}

function broadcastAlert(text, type = 'purchase') {
  clearTimeout(broadcastTimeout);
  gameState.broadcastMessage = { text, type };
  io.emit('game_state', gameState);
  broadcastTimeout = setTimeout(() => {
    if (gameState.broadcastMessage?.text !== text) return;
    gameState.broadcastMessage = null;
    broadcastTimeout = null;
    io.emit('game_state', gameState);
  }, 4000); // Increased slightly for the new dramatic animation
}

function resetGame() {
  clearTimeout(triviaTimeout);
  clearTimeout(broadcastTimeout);
  triviaTimeout = null;
  broadcastTimeout = null;
  activeTrivia = null;
  gameState.pieces = {};
  gameState.boardWidth = 0;
  gameState.boardHeight = 0;
  gameState.puzzleImageSrc = null;
  gameState.chatHistory = [];
  gameState.broadcastMessage = null;
  gameState.triviaCooldownUntil = null;
  gameState.triviaQuestion = null;
  gameState.pendingAttack = null;
  for (const player of Object.values(gameState.players)) {
    player.score = 0;
    player.streak = 0;
    player.stats.highestStreak = 0;
    player.stats.attacksUsed = 0;
    player.stats.pointsStolen = 0;
    player.isShielded = false;
    player.isReversing = false;
    player.inventory = [];
    for (const powerUpType of Object.keys(player.powerUpUses)) {
      player.powerUpUses[powerUpType] = 0;
    }
    player.isReady = false;
    player.isPlaying = false;
  }
  gameState.status = 'LOBBY';
  io.emit('force_reset');
  broadcastGameState();
}

function getPlayer(socket) {
  return gameState.players[socket.data.playerId];
}

function reassignHostIfNeeded() {
  const remainingPlayers = Object.keys(gameState.players);
  if (remainingPlayers.length === 0) {
    gameState.hostId = null;
    return;
  }

  if (!gameState.hostId || !gameState.players[gameState.hostId]) {
    gameState.hostId = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];
  }
}

function updatePieceSnapshots(pieces, includeGroupData = false) {
  if (!Array.isArray(pieces)) return [];

  const updatedPieces = [];
  for (const update of pieces) {
    const piece = gameState.pieces[update?.id];
    if (!piece || !Number.isFinite(update.x) || !Number.isFinite(update.y)) continue;

    piece.x = update.x;
    piece.y = update.y;
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
function scatterPiece(piece) {
  const width = gameState.boardWidth || 1280;
  const height = gameState.boardHeight || 800;
  const pieceWidth = piece.shapeData?.cellWidth ?? 80;
  const pieceHeight = piece.shapeData?.cellHeight ?? 80;
  const margin = 12;
  const maxX = Math.max(margin, width - pieceWidth - margin);
  const maxY = Math.max(margin, height - pieceHeight - margin);
  const horizontalBand = Math.max(margin, height * 0.16);
  const verticalBand = Math.max(margin, width * 0.16);
  const zones = [
    { minX: margin, maxX, minY: margin, maxY: Math.max(margin, horizontalBand - pieceHeight) },
    { minX: margin, maxX, minY: Math.min(maxY, height - horizontalBand), maxY },
    { minX: margin, maxX: Math.max(margin, verticalBand - pieceWidth), minY: margin, maxY },
    { minX: Math.min(maxX, width - verticalBand), maxX, minY: margin, maxY },
  ].filter((zone) => zone.maxX >= zone.minX && zone.maxY >= zone.minY);
  const zone = zones[Math.floor(Math.random() * zones.length)];
  const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);

  piece.x = randomBetween(zone.minX, zone.maxX);
  piece.y = randomBetween(zone.minY, zone.maxY);
  piece.groupId = null;
  piece.isLockedInFrame = false;
  piece.placedBy = null;
}

function stealPlacedPieces(playerId, amount) {
  const placedPieces = Object.values(gameState.pieces)
    .filter((piece) => piece.placedBy === playerId && piece.isLockedInFrame);

  for (let index = placedPieces.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [placedPieces[index], placedPieces[swapIndex]] = [placedPieces[swapIndex], placedPieces[index]];
  }

  const stolenPieces = placedPieces.slice(0, amount);
  stolenPieces.forEach(scatterPiece);
  return stolenPieces.length;
}

function transferAvailablePoints(source, destination, amount) {
  const stolenPoints = Math.min(amount, Math.max(0, source.score));
  source.score -= stolenPoints;
  destination.score += stolenPoints;
  destination.stats.pointsStolen += stolenPoints;
  return stolenPoints;
}

function acknowledge(callback, result) {
  if (typeof callback === 'function') callback(result);
}

function createTriviaQuestion() {
  const players = Object.values(gameState.players);
  if (players.length === 0) return null;

  const askHighestStreak = Math.random() < 0.5;
  const rankedPlayers = [...players].sort((first, second) => askHighestStreak
    ? second.streak - first.streak
    : first.score - second.score);
  const correctPlayer = rankedPlayers[0];
  const options = rankedPlayers.slice(0, 4).map((player) => ({
    id: player.id,
    label: player.name,
  }));
  const sequence = ++triviaQuestionSequence;

  while (options.length < 4) {
    const optionNumber = options.length + 1;
    options.push({
      id: `trivia-decoy-${sequence}-${optionNumber}`,
      label: `Guest ${optionNumber}`,
    });
  }

  for (let index = options.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
  }

  const expiresAt = Date.now() + 30_000;
  return {
    id: `trivia-${sequence}`,
    prompt: askHighestStreak
      ? 'Which player currently has the highest streak?'
      : 'Which player currently has the lowest score?',
    options,
    expiresAt,
    correctAnswerId: correctPlayer.id,
  };
}

function resolveTrivia(player, answerId) {
  if (!activeTrivia) return null;

  const correct = Boolean(player && answerId === activeTrivia.correctAnswerId);
  if (correct) player.inventory.push('self_help');

  clearTimeout(triviaTimeout);
  triviaTimeout = null;
  activeTrivia = null;
  gameState.triviaQuestion = null;
  gameState.status = 'PLAYING';
  return correct;
}

function applyOffensiveAttack(attacker, target) {
  if (target.isReversing) {
    target.isReversing = false;
    attacker.score -= 2;
    target.score += 2;
    const stolenPieces = stealPlacedPieces(attacker.id, 2);
    return { reversed: true, stolenPieces, message: `${target.name} reversed the attack.` };
  }

  // If not reversing (e.g. they rejected it), the shield absorbs it
  if (target.isShielded) {
    target.isShielded = false;
    return { message: `${target.name}'s shield blocked the attack.` };
  }

  target.score -= 2;
  attacker.score += 2;
  attacker.stats.pointsStolen += 2;
  const stolenPieces = stealPlacedPieces(target.id, 2);
  return { stolenPieces, message: `Attack landed on ${target.name}.` };
}

function applyUltimateSteal(attacker) {
  const otherPlayers = Object.values(gameState.players).filter((player) => player.id !== attacker.id);
  // Remove the !player.isShielded check so reversing takes priority
  const reversingPlayer = otherPlayers.find((player) => player.isReversing);

  if (reversingPlayer) {
    reversingPlayer.isReversing = false;
    const stolenPoints = transferAvailablePoints(attacker, reversingPlayer, 4);
    const stolenPieces = stealPlacedPieces(attacker.id, 4);
    return {
      reversed: true,
      affectedPlayers: 1,
      stolenPoints,
      stolenPieces,
      message: `${reversingPlayer.name} reversed the Ultimate Steal.`,
    };
  }

  let affectedPlayers = 0;
  let stolenPoints = 0;
  let stolenPieces = 0;

  for (const player of otherPlayers) {
    if (player.isShielded) {
      player.isShielded = false;
      continue;
    }

    affectedPlayers += 1;
    stolenPoints += transferAvailablePoints(player, attacker, 4);
    stolenPieces += stealPlacedPieces(player.id, 4);
  }

  return { affectedPlayers, stolenPoints, stolenPieces, message: 'Ultimate Steal resolved.' };
}

function applyFocusCracker(attacker) {
  let shieldChanged = false;
  let reversed = false;

  for (const player of Object.values(gameState.players)) {
    if (player.id === attacker.id) continue;
    if (player.isShielded) {
      player.isShielded = false;
      shieldChanged = true;
      continue;
    }

    if (player.isReversing && !reversed) {
      player.isReversing = false;
      io.to(attacker.id).emit('focus_cracker', { durationMs: 15000 });
      reversed = true;
      continue;
    }

    io.to(player.id).emit('focus_cracker', { durationMs: 15000 });
  }

  return { shieldChanged, reversed };
}

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  },
});

io.on('connection', (socket) => {
  socket.on('join_game', async ({ playerId, name } = {}) => {
    if (typeof playerId !== 'string' || playerId.length === 0 || playerId.length > 100) return;

    socket.data.playerId = playerId;
    socket.join(playerId);

    // --- NEW: FETCH DB STATS ---
    let dbStats = null;
    // Simple check: Guests have short IDs, Supabase users have long UUIDs (>20 chars)
    if (supabase && playerId.length > 20) { 
      const { data } = await supabase.from('stats').select('*').eq('user_id', playerId).single();
      dbStats = data;
    }

    gameState.players[playerId] ??= {
      id: playerId,
      name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : 'Player',
      isReady: false,
      isPlaying: false,
      friendsList: [],
      score: 0,
      streak: 0,
      inventory: [],
      powerUpUses: {
        self_protect: 0,
        reverse: 0,
        offensive_attack: 0,
        ultimate_steal: 0,
        focus_cracker: 0,
        self_help: 0,
      },
      isReversing: false,
      isShielded: false,
      isMicMuted: false,
      isSpeakerMuted: false,
      isSpeaking: false,
      stats: {
        highestStreak: 0,
        attacksUsed: 0,
        pointsStolen: 0,
      },
      // --- NEW: LIFETIME STATS ---
      lifetimeStats: dbStats || {
        games_played: 0,
        total_wins: 0,
        highest_streak: 0,
        attacks_used: 0,
        points_stolen: 0
      }
    };

    if (!gameState.hostId || !gameState.players[gameState.hostId]) {
      gameState.hostId = playerId;
    }

    socket.emit('game_state', gameState);
    broadcastGameState();
  });

  socket.on('disconnect', () => {
    const disconnectedPlayerId = socket.data.playerId;
    if (!disconnectedPlayerId) return;

    const wasHost = gameState.hostId === disconnectedPlayerId;
    delete gameState.players[disconnectedPlayerId];

    // Check if the room is empty OR if the only people left are in the lobby
    const activePlayers = Object.values(gameState.players).filter(p => p.isPlaying);
    if (Object.keys(gameState.players).length === 0 || (activePlayers.length === 0 && gameState.status !== 'LOBBY')) {
      gameState.hostId = null;
      resetGame();
      return;
    }

    if (wasHost || (gameState.hostId && !gameState.players[gameState.hostId])) {
      reassignHostIfNeeded();
    }

    broadcastGameState();
  });

  socket.on('webrtc_signal', ({ targetId, signal } = {}) => {
    const player = getPlayer(socket);
    if (!player || !targetId) return;
    
    // Relay the signal directly to the target player's socket room
    io.to(targetId).emit('webrtc_signal', {
      senderId: player.id,
      signal,
    });
  });

  socket.on('leave_game', (_payload = {}, callback) => {
    const playerId = socket.data.playerId;
    const player = playerId ? gameState.players[playerId] : null;
    if (!player) {
      acknowledge(callback, { ok: false, message: 'You are not in the game.' });
      return;
    }

    const wasHost = gameState.hostId === playerId;
    delete gameState.players[playerId];
    socket.data.playerId = null;
    socket.leave(playerId);

    const activePlayers = Object.values(gameState.players).filter(p => p.isPlaying);
    if (Object.keys(gameState.players).length === 0 || (activePlayers.length === 0 && gameState.status !== 'LOBBY')) {
      gameState.hostId = null;
      resetGame();
    } else {
      if (wasHost) reassignHostIfNeeded();
      broadcastGameState();
    }

    acknowledge(callback, { ok: true });
  });

  socket.on('toggle_ready', (_payload = {}, callback) => {
    const player = getPlayer(socket);
    if (!player) {
      acknowledge(callback, { ok: false, message: 'Join the game before toggling ready.' });
      return;
    }

    player.isReady = !player.isReady;
    acknowledge(callback, { ok: true, isReady: player.isReady });
    broadcastGameState();
  });

  socket.on('select_image', ({ imageUrl } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player) {
      acknowledge(callback, { ok: false, message: 'Join the lobby before selecting an image.' });
      return;
    }
    if (gameState.hostId !== player.id) {
      acknowledge(callback, { ok: false, message: 'Only the host can select an image.' });
      return;
    }
    if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
      acknowledge(callback, { ok: false, message: 'Choose a valid image URL.' });
      return;
    }

    gameState.puzzleImageSrc = imageUrl.trim();
    acknowledge(callback, { ok: true, imageUrl: gameState.puzzleImageSrc });
    broadcastGameState();
  });

  socket.on('start_game', (_payload = {}, callback) => {
    const player = getPlayer(socket);
    if (!player) {
      acknowledge(callback, { ok: false, message: 'Join the lobby before starting the game.' });
      return;
    }
    if (gameState.hostId !== player.id) {
      acknowledge(callback, { ok: false, message: 'Only the host can start the game.' });
      return;
    }
    if (!gameState.puzzleImageSrc) {
      acknowledge(callback, { ok: false, message: 'Select a puzzle image before starting.' });
      return;
    }

    const otherPlayers = Object.values(gameState.players).filter((entry) => entry.id !== gameState.hostId);
    const allReady = otherPlayers.length === 0 || otherPlayers.every((entry) => entry.isReady === true);
    if (!allReady) {
      acknowledge(callback, { ok: false, message: 'Every non-host player must be ready.' });
      return;
    }

    // NEW: Mark everyone entering the arena as 'isPlaying'
    for (const entry of Object.values(gameState.players)) {
      if (entry.id === gameState.hostId || entry.isReady) {
        entry.isPlaying = true;
      }
    }

    gameState.status = 'PLAYING';
    acknowledge(callback, { ok: true, status: gameState.status });
    broadcastGameState();
  });

  socket.on('add_friend', ({ targetPlayerId } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player) {
      acknowledge(callback, { ok: false, message: 'Join the lobby before adding friends.' });
      return;
    }
    if (typeof targetPlayerId !== 'string' || !targetPlayerId.trim()) {
      acknowledge(callback, { ok: false, message: 'Provide a valid friend ID.' });
      return;
    }

    const normalizedTargetId = targetPlayerId.trim();
    if (normalizedTargetId === player.id || !gameState.players[normalizedTargetId]) {
      acknowledge(callback, { ok: false, message: 'That player is not available to add.' });
      return;
    }

    if (!player.friendsList.includes(normalizedTargetId)) {
      player.friendsList.push(normalizedTargetId);
    }

    acknowledge(callback, { ok: true, friendsList: player.friendsList });
    broadcastGameState();
  });

  socket.on('dev_reset_game', () => {
    const player = getPlayer(socket);
    if (!player || gameState.hostId !== player.id) return; // Only Host can reset mid-game

    // Clear the board and reset mid-game stats, but keep playing
    gameState.pieces = {};
    gameState.status = 'PLAYING';
    for (const p of Object.values(gameState.players)) {
      p.score = 0;
      p.streak = 0;
      p.isShielded = false;
      p.isReversing = false;
      p.inventory = [];
      for (const powerUpType of Object.keys(p.powerUpUses)) {
        p.powerUpUses[powerUpType] = 0;
      }
    }
    io.emit('force_reset');
    broadcastAlert('The Host Reset The Game!', 'defense');
    broadcastGameState();
  });

  // New event specifically for returning to the lobby after a game finishes
  socket.on('return_to_lobby', () => {
    const player = getPlayer(socket);
    if (!player || gameState.hostId !== player.id) return; // Only Host can return
    resetGame();
  });

  socket.on('initialize_pieces', ({ pieces, boardWidth, boardHeight } = {}) => {
    if (!getPlayer(socket) || Object.keys(gameState.pieces).length > 0) {
      socket.emit('game_state', gameState);
      return;
    }
    if (!Array.isArray(pieces) || pieces.length === 0 || pieces.length > 500) return;
    if (!Number.isFinite(boardWidth) || !Number.isFinite(boardHeight)) return;

    gameState.pieces = Object.fromEntries(
      pieces
        .filter((piece) => piece
          && typeof piece.id === 'string'
          && Number.isFinite(piece.x)
          && Number.isFinite(piece.y)
          && Array.isArray(piece.shapeData?.path))
        .map((piece) => [piece.id, { ...piece, placedBy: null }]),
    );
    gameState.boardWidth = boardWidth;
    gameState.boardHeight = boardHeight;
    broadcastGameState();
  });

  socket.on('piece_moved', ({ pieces } = {}) => {
    if (!getPlayer(socket)) return;
    const updatedPieces = updatePieceSnapshots(pieces);
    if (updatedPieces.length > 0) socket.broadcast.emit('piece_moved', { pieces: updatedPieces });
  });

  socket.on('piece_connected', ({ pieces } = {}) => {
    const player = getPlayer(socket);
    if (!player || !Array.isArray(pieces)) return;

    const previousLockState = new Map((pieces ?? []).map((update) => [
      update.id,
      gameState.pieces[update.id]?.isLockedInFrame ?? false,
    ]));
    const updatedPieces = updatePieceSnapshots(pieces, true);
    if (updatedPieces.length === 0) return;
    // --- NEW: ROBUST SCORING LOGIC ---
    let newlyLockedCount = 0;
    
    for (const update of pieces ?? []) {
      const piece = gameState.pieces[update.id];
      if (piece?.isLockedInFrame && !previousLockState.get(update.id) && !piece.placedBy) {
        piece.placedBy = player.id;
        newlyLockedCount++;
      }
    }
    
    // If they snapped a block of pieces to the frame, give them points for ALL of them!
    // If they just joined two floating pieces together, give them 1 point for the action.
    const pointsEarned = newlyLockedCount > 0 ? newlyLockedCount : 1;
    
    player.score += pointsEarned;
    player.streak += pointsEarned;
    if (player.streak > player.stats.highestStreak) {
      player.stats.highestStreak = player.streak;
    }
    const allPieces = Object.values(gameState.pieces);
    if (allPieces.length > 0) {
      const referenceGroupId = allPieces[0].groupId;
      const allShareGroup = typeof referenceGroupId === 'string'
        && referenceGroupId.length > 0
        && allPieces.every((piece) => piece.groupId === referenceGroupId);
      const allLocked = allPieces.every((piece) => piece.isLockedInFrame);

      if (allShareGroup || allLocked) {
        gameState.status = 'GAMEOVER';
        
        // --- NEW: SAVE TO DATABASE ---
        if (supabase) {
          // Calculate the True Total Score to determine the winner
          // (Removed pointsStolen because stealing ALREADY adds it to p.score!)
          const calculateTotal = (p) => (p.score || 0) + (p.stats.attacksUsed || 0);
          const playersList = Object.values(gameState.players).filter(p => p.isPlaying);
          const sorted = [...playersList].sort((a, b) => calculateTotal(b) - calculateTotal(a));
          const winnerId = sorted[0]?.id;

          for (const p of playersList) {
            if (p.id.length > 20) { // Only save for real authenticated users
              const newGamesPlayed = (p.lifetimeStats.games_played || 0) + 1;
              const newTotalWins = (p.lifetimeStats.total_wins || 0) + (p.id === winnerId ? 1 : 0);
              const newHighestStreak = Math.max(p.lifetimeStats.highest_streak || 0, p.stats.highestStreak);
              const newAttacksUsed = (p.lifetimeStats.attacks_used || 0) + p.stats.attacksUsed;
              const newPointsStolen = (p.lifetimeStats.points_stolen || 0) + p.stats.pointsStolen;

              // Push update to Supabase
              supabase.from('stats').update({
                games_played: newGamesPlayed,
                total_wins: newTotalWins,
                highest_streak: newHighestStreak,
                attacks_used: newAttacksUsed,
                points_stolen: newPointsStolen
              }).eq('user_id', p.id).then(({ error }) => {
                if (error) console.error('Failed to save stats:', error);
                else console.log(`Stats saved successfully for ${p.name}!`);
              });

              // Update in-memory so they don't have to refresh to see new stats
              p.lifetimeStats = {
                games_played: newGamesPlayed,
                total_wins: newTotalWins,
                highest_streak: newHighestStreak,
                attacks_used: newAttacksUsed,
                points_stolen: newPointsStolen
              };
            }
          }
        }
      }
    }
    broadcastGameState();
  });

  socket.on('send_chat', (payload, callback) => {
    const player = getPlayer(socket);
    const text = (typeof payload === 'string' ? payload : payload?.text)?.trim();
    if (!player || typeof text !== 'string' || !text) {
      acknowledge(callback, { ok: false, message: 'Enter a message before sending.' });
      return;
    }

    const message = {
      id: randomUUID(),
      playerId: player.id,
      playerName: player.name,
      text: text.slice(0, 500),
      sentAt: Date.now(),
    };
    gameState.chatHistory.push(message);
    gameState.chatHistory = gameState.chatHistory.slice(-50);
    acknowledge(callback, { ok: true, messageId: message.id });
    broadcastGameState();
  });

  socket.on('update_voice_state', (updates = {}, callback) => {
    const player = getPlayer(socket);
    if (!player) {
      acknowledge(callback, { ok: false, message: 'Join the game before changing voice settings.' });
      return;
    }

    const validUpdates = ['isMicMuted', 'isSpeakerMuted', 'isSpeaking']
      .filter((key) => typeof updates[key] === 'boolean');
    if (validUpdates.length === 0) {
      acknowledge(callback, { ok: false, message: 'No valid voice state was provided.' });
      return;
    }

    for (const key of validUpdates) player[key] = updates[key];
    acknowledge(callback, { ok: true });
    broadcastGameState();
  });

  socket.on('trigger_help_request', (_payload = {}, callback) => {
    const player = getPlayer(socket);
    const now = Date.now();
    if (!player) {
      acknowledge(callback, { ok: false, message: 'Join the game before requesting help.' });
      return;
    }
    if (gameState.triviaCooldownUntil && gameState.triviaCooldownUntil > now) {
      acknowledge(callback, { ok: false, message: 'Help is on cooldown.' });
      return;
    }
    if (gameState.status !== 'PLAYING' || activeTrivia) {
      acknowledge(callback, { ok: false, message: 'Help is not available right now.' });
      return;
    }

    const question = createTriviaQuestion();
    if (!question) {
      acknowledge(callback, { ok: false, message: 'There are no players to build a question from.' });
      return;
    }

    activeTrivia = question;
    gameState.triviaQuestion = {
      id: question.id,
      prompt: question.prompt,
      options: question.options,
      expiresAt: question.expiresAt,
    };
    gameState.status = 'HELP_PAUSED';
    gameState.triviaCooldownUntil = question.expiresAt;
    triviaTimeout = setTimeout(() => {
      if (activeTrivia?.id !== question.id) return;
      resolveTrivia(null, null);
      broadcastGameState();
    }, question.expiresAt - now);

    acknowledge(callback, { ok: true, message: 'Trivia paused the game.' });
    broadcastGameState();
  });

  socket.on('submit_trivia_answer', ({ questionId, answerId } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player || gameState.status !== 'HELP_PAUSED' || activeTrivia?.id !== questionId) {
      acknowledge(callback, { ok: false, message: 'There is no active question to answer.' });
      return;
    }

    const correct = resolveTrivia(player, answerId);
    acknowledge(callback, {
      ok: true,
      correct,
      message: correct ? 'Correct. You earned Self-Help.' : 'Not quite. The game is resuming.',
    });
    broadcastGameState();
  });

  socket.on('purchase_powerup', ({ playerId, powerUpType } = {}, callback) => {
    if (typeof playerId !== 'string' || playerId !== socket.data.playerId) {
      acknowledge(callback, { ok: false, message: 'Player identity does not match this connection.' });
      return;
    }

    const player = gameState.players[playerId];
    if (!player || typeof powerUpType !== 'string' || !Object.hasOwn(powerCosts, powerUpType)) {
      acknowledge(callback, { ok: false, message: 'This power cannot be purchased.' });
      return;
    }

    if ((player.powerUpUses[powerUpType] ?? 0) >= 2) {
      acknowledge(callback, { ok: false, message: 'Maximum uses reached for this power.' });
      return;
    }

    const cost = powerCosts[powerUpType];
    if (player.streak < cost) {
      acknowledge(callback, { ok: false, message: `Requires a ${cost} streak.` });
      return;
    }

    player.streak -= cost;
    if (powerUpType === 'self_protect') {
      player.isShielded = true;
      player.powerUpUses[powerUpType] += 1;
    } else {
      player.inventory.push(powerUpType);
    }

    acknowledge(callback, {
      ok: true,
      message: powerUpType === 'self_protect' ? 'Shield activated.' : `${powerUpNames[powerUpType]} added to inventory.`,
    });
    broadcastAlert(`${player.name} Bought ${powerUpNames[powerUpType]}`,'purchase');
  });

  socket.on('wrong_placement', ({ playerId } = {}) => {
    if (typeof playerId !== 'string' || playerId !== socket.data.playerId) return;

    const player = gameState.players[playerId];
    if (!player) return;

    player.streak = 0;
    io.emit('game_state', gameState);
  });

  socket.on('resolve_reverse', ({ attackId, useReverse } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player || gameState.status !== 'REVERSE_PAUSED' || gameState.pendingAttack?.id !== attackId) {
      acknowledge(callback, { ok: false, message: 'Invalid or expired reverse request.' });
      return;
    }

    if (gameState.pendingAttack.targetId !== player.id) {
      acknowledge(callback, { ok: false, message: 'You are not the target of this attack.' });
      return;
    }

    const { attackerId, powerUp } = gameState.pendingAttack;
    const attacker = gameState.players[attackerId];

    // Resume game state
    gameState.status = 'PLAYING';
    gameState.pendingAttack = null;

    if (useReverse) {
      const reverseIndex = player.inventory.indexOf('reverse');
      if (reverseIndex > -1) {
        player.inventory.splice(reverseIndex, 1);
        player.powerUpUses['reverse'] += 1;
        player.isReversing = true; // Arm for the apply function
      }
    }

    // Apply original attack (which handles isReversing inherently)
    let result;
    if (powerUp === 'offensive_attack') {
      result = applyOffensiveAttack(attacker, player);
    } else if (powerUp === 'ultimate_steal') {
      result = applyUltimateSteal(attacker);
    }

    player.isReversing = false; // Immediately un-arm

    if (result?.message) { broadcastAlert(result.message, 'defense'); }

    acknowledge(callback, { ok: true, ...result });
    broadcastGameState();
  });

  socket.on('use_powerup', ({ powerUpType, targetId } = {}, callback) => {
    const player = getPlayer(socket);
    if (!player || typeof powerUpType !== 'string' || !Object.hasOwn(player.powerUpUses, powerUpType)) {
      acknowledge(callback, { ok: false, message: 'Unknown power.' });
      return;
    }

    if ((player.powerUpUses[powerUpType] ?? 0) >= 2) {
      acknowledge(callback, { ok: false, message: 'Maximum uses reached for this power.' });
      return;
    }

    const inventoryIndex = player.inventory.indexOf(powerUpType);
    if (inventoryIndex < 0) {
      acknowledge(callback, { ok: false, message: 'Add this power before using it.' });
      return;
    }

    const target = powerUpType === 'offensive_attack' ? gameState.players[targetId] : null;
    if (powerUpType === 'offensive_attack' || powerUpType === 'ultimate_steal') {
      let interceptTarget = null;
      
      // Check for Reverse without filtering out shielded players
      if (powerUpType === 'offensive_attack') {
        if (target && target.inventory.includes('reverse')) {
          interceptTarget = target;
        }
      } else if (powerUpType === 'ultimate_steal') {
        interceptTarget = Object.values(gameState.players).find(
          (p) => p.id !== player.id && p.inventory.includes('reverse')
        );
      }

      if (interceptTarget) {
        const attackId = randomUUID();
        gameState.pendingAttack = {
          id: attackId,
          attackerId: player.id,
          targetId: interceptTarget.id,
          powerUp: powerUpType,
          expiresAt: Date.now() + 5000,
        };
        gameState.status = 'REVERSE_PAUSED';

        // Deduct attack from attacker immediately
        player.inventory.splice(inventoryIndex, 1);
        player.powerUpUses[powerUpType] += 1;

        // Start 5-second intercept timer
        setTimeout(() => {
          if (gameState.pendingAttack?.id === attackId && gameState.status === 'REVERSE_PAUSED') {
            gameState.status = 'PLAYING';
            gameState.pendingAttack = null;

            let timeoutResult;
            if (powerUpType === 'offensive_attack') {
              timeoutResult = applyOffensiveAttack(player, interceptTarget);
            } else {
              timeoutResult = applyUltimateSteal(player);
            }
            
            if (timeoutResult?.message) {
              broadcastAlert(timeoutResult.message);
            }
            broadcastGameState();
          }
        }, 5000);

        acknowledge(callback, { ok: true, message: `Attack paused. ${interceptTarget.name} has 5s to react.` });
        broadcastGameState();
        return;
      }
    }

    let result;
    if (powerUpType === 'self_help') {
      const availablePieces = Object.values(gameState.pieces).filter((piece) => !piece.isLockedInFrame);
      if (availablePieces.length < 2) {
        acknowledge(callback, { ok: false, message: 'Not enough unplaced pieces to guide.' });
        return;
      }

      // Find two pieces that are meant to connect to each other
      let pair = null;
      for (let i = 0; i < availablePieces.length; i++) {
        for (let j = i + 1; j < availablePieces.length; j++) {
          const p1 = availablePieces[i];
          const p2 = availablePieces[j];
          const rowDiff = Math.abs(p1.shapeData.gridRow - p2.shapeData.gridRow);
          const colDiff = Math.abs(p1.shapeData.gridColumn - p2.shapeData.gridColumn);
          
          if (rowDiff + colDiff === 1) { // They are adjacent in the grid
            pair = [p1, p2];
            break;
          }
        }
        if (pair) break;
      }

      // Fallback if pieces are isolated
      if (!pair) pair = [availablePieces[0], availablePieces[1]];

      io.to(player.id).emit('guide_piece_highlight', {
        pieceIds: [pair[0].id, pair[1].id], // Send both IDs instead of target coordinates
        durationMs: 5000,
      });
      result = { ok: true, message: 'Two connecting pieces are highlighted on your board.' };
    } else if (powerUpType === 'reverse') {
      acknowledge(callback, { ok: false, message: 'Reverse is reactive and triggers automatically.' });
      return;
    } else if (powerUpType === 'offensive_attack') {
      result = { ok: true, ...applyOffensiveAttack(player, target) };
    } else if (powerUpType === 'ultimate_steal') {
      result = { ok: true, ...applyUltimateSteal(player) };
    } else if (powerUpType === 'focus_cracker') {
      const focusResult = applyFocusCracker(player);
      result = {
        ok: true,
        message: focusResult.reversed ? 'Focus Cracker was reversed.' : 'Focus Cracker sent.',
      };
    } else {
      player.isShielded = true;
      result = { ok: true, message: 'Shield activated.' };
    }

    player.inventory.splice(inventoryIndex, 1);
    player.powerUpUses[powerUpType] += 1;
    if (['offensive_attack', 'ultimate_steal', 'focus_cracker'].includes(powerUpType)) {
      player.stats.attacksUsed += 1;
    }
    acknowledge(callback, result);
    const alertType = powerUpType === 'self_protect' ? 'defense' : 'attack';
    broadcastAlert(`${player.name} used ${powerUpNames[powerUpType]}!`, alertType);
  });
});

const port = Number(process.env.PORT ?? 3001);

httpServer.listen(port, () => {
  console.log(`Puzzle Party server listening on port ${port}`);
});