# Development Phases & Task Tracker

## Phase 1: Lobby, Social & Matchmaking
- [x] **Profiles & Friends:** Generate temporary Player IDs. Build friend request system and online/offline status list[cite: 20].
- [x] **Lobby Setup:** Build lobby room UI with Invite capabilities[cite: 20].
- [x] **Host Controls:** Implement Host designation, random Host Migration on disconnect, and Image Selection modal[cite: 20].
- [x] **Game Init:** Build the "Ready" toggle for players and "Start Game" lock for the Host[cite: 20].

## Phase 2: Core Custom Game Engine
- [x] **The Canvas:** Render communal canvas, handle dynamic image slicing based on lobby selection[cite: 20].
- [x] **Spawning & Chunking:** Scatter pieces to edges, allow off-board connections, and board snapping[cite: 20].
- [x] **Scoring Logic:** Add +1 point and +1 streak for connections. Wrong placements break the streak[cite: 20].
- [x] **Match Reset:** Provide a Reset Game action that clears the board and returns the match to the lobby.
- [x] **Leave Game:** Add standard Leave Game logic and reset empty instances[cite: 20].

## Phase 3: The V4 Power-Up Economy
- [x] **Wallet Economy:** Spending a streak deducts the cost (does not reset to zero)[cite: 20].
- [x] **Inventory UI:** Render "Add" (purchase) vs "Use" (activate) buttons dynamically. Enforce maximum 2 uses per power-up per game[cite: 20].
- [x] **Passive/Active Logic:** Auto-activate Self-Protect on Add. Require manual "Use" triggers for all others[cite: 20].
- [x] **Targeted Attacks:** Build target selection for Offensive Attack[cite: 20].
- [x] **Reactive Reverse:** Build 5-second paused attack intercept. Handle "Use" (hijack) vs "Reject/Timeout" (take hit, save item)[cite: 20].

## Phase 4: Comms & Help System
- [x] **Audio Hardware:** Wire up WebRTC Mic/Speaker toggles across lobby and game[cite: 20].
- [x] **Text Chat:** Support text and emoji messages in the game chat[cite: 20].
- [x] **Purchase Broadcasts:** Show center-screen broadcast alerts for power-up purchases[cite: 20].
- [x] **Activation Broadcasts:** Show center-screen broadcast alerts when power-ups are used[cite: 20].
- [x] **Help System:** Build 30s global cooldown Trivia popup yielding the Self-Help guide power-up[cite: 20].

## Phase 5: Post-Game Analytics
- [x] **Win Condition:** Detect 100% board lock and transition state to post-game[cite: 20].
- [x] **Performance Cards:** Calculate and display Total Score, Highest Streak, Most Attacks Used, and Most Points Stolen[cite: 20].
- [x] **Loop Back:** Build "Return to Lobby" button to allow map changes or restarts[cite: 20].