# Data Schema & Implementation Tracker

## Backend Models Progress
- [x] Define `GameState` interface.
- [x] Define `Player` interface.
- [x] Define `PuzzlePiece` interface.
- [x] Define `ChatMessage` interface.

## Core Interfaces
```typescript
type PowerUpType = 'self_protect' | 'reverse' | 'offensive_attack' | 'ultimate_steal' | 'focus_cracker' | 'self_help';

interface TriviaQuestion {
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
  expiresAt: number;
}

interface PendingAttack {
  id: string;
  attackerId: string;
  targetId: string;
  powerUp: PowerUpType;
  expiresAt: number; // 5-second window for Reverse[cite: 20]
}

interface GameState {
  matchId: string;
  status: 'LOBBY' | 'PLAYING' | 'HELP_PAUSED' | 'REVERSE_PAUSED' | 'GAMEOVER';
  hostId: string; // Enables Host Migration & Reset[cite: 20]
  puzzleImageSrc: string | null; // Selected by Host[cite: 20]
  players: Record<string, Player>;
  pieces: Record<string, PuzzlePiece>;
  chatHistory: ChatMessage[];
  broadcastMessage: string | null; // Screen-center alerts[cite: 20]
  boardWidth: number;
  boardHeight: number;
  triviaCooldownUntil: number | null; 
  triviaQuestion: TriviaQuestion | null;
  pendingAttack: PendingAttack | null; 
}

interface PlayerStats {
  highestStreak: number;
  attacksUsed: number;
  pointsStolen: number;
}

interface Player {
  id: string; // Temporary ID, future persistent[cite: 20]
  name: string;
  isReady: boolean; // Lobby requirement[cite: 20]
  friendsList: string[]; // Array of friend IDs[cite: 20]
  score: number; 
  streak: number; // Wallet subtraction system[cite: 20]
  inventory: PowerUpType[];
  powerUpUses: Record<PowerUpType, number>; // Max 2 per game[cite: 20]
  isShielded: boolean; // Passive, auto-activates[cite: 20]
  isMicMuted: boolean;
  isSpeakerMuted: boolean;
  isSpeaking: boolean;
  stats: PlayerStats; // For post-game cards[cite: 20]
}

interface PuzzlePiece {
  id: string;
  shapeData: BezierCurveData;
  x: number; 
  y: number; 
  groupId: string | null; 
  isLockedInFrame: boolean; 
  placedBy: string | null;
}

interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string; // Supports standard text and emojis[cite: 20]
  sentAt: number;
}