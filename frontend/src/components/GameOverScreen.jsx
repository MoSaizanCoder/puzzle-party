import '../../styles/gameover.css';

export default function GameOverScreen({ gameState, socket, localPlayerId }) {
  // Calculate the True Total Score: Base Score + Attacks Used
  // (Points Stolen are already physically added to Base Score during the game!)
  const calculateTotal = (player) => {
    const baseScore = player.score || 0;
    const attacks = player.stats?.attacksUsed || 0;
    return baseScore + attacks;
  };

  // Sort players by their new True Total Score instead of just base score
  const standings = Object.values(gameState?.players ?? {})
    .sort((first, second) => calculateTotal(second) - calculateTotal(first));

  const handleReturnToLobby = () => {
    if (!socket?.connected) return;
    // Emits a request to drop this specific player back to the lobby screen
    socket.emit('return_to_lobby_individual');
  };

  return (
    <main className="gameover-screen">
      <section className="gameover-content" aria-labelledby="gameover-title">
        <h1 id="gameover-title">Puzzle complete</h1>
        <ol className="final-scoreboard" aria-label="Final standings">
          {standings.map((player, index) => {
            const isWinner = index === 0;
            const trueTotal = calculateTotal(player);

            return (
              <li key={player.id} className={isWinner ? 'winner-highlight' : ''}>
                <div className="final-player-heading">
                  <span className="final-player-rank">{index + 1}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="final-player-name">{player.name}</span>
                    {isWinner && (
                      <span style={{
                        background: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
                        color: '#fff',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '0.7rem',
                        fontWeight: 'bold',
                        letterSpacing: '1px',
                        boxShadow: '0 2px 4px rgba(253, 160, 133, 0.4)'
                      }}>
                        WINNER
                      </span>
                    )}
                  </div>
                  <span className="final-player-score">{trueTotal} Total Pts</span>
                </div>
                <div className="performance-stats" aria-label={`${player.name} performance stats`}>
                  <div className="performance-stat">
                    <span>Base Score</span>
                    <strong>{player.score}</strong>
                  </div>
                  <div className="performance-stat">
                    <span>Highest Streak</span>
                    <strong>{player.stats?.highestStreak ?? 0}</strong>
                  </div>
                  <div className="performance-stat">
                    <span>Attacks Used</span>
                    <strong>{player.stats?.attacksUsed ?? 0}</strong>
                  </div>
                  <div className="performance-stat">
                    <span>Points Stolen</span>
                    <strong>{player.stats?.pointsStolen ?? 0}</strong>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        
        <button
          type="button"
          className="play-again-button"
          disabled={!socket?.connected}
          onClick={handleReturnToLobby}
        >
          Return to Lobby
        </button>
        
      </section>
    </main>
  );
}