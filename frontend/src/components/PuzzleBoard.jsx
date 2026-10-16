import { useEffect, useRef } from 'react';
import GameEngine from '../../../engine/GameEngine.js';
import '../../styles/main.css';
import { playSnapSound } from '../utils/sounds.js';

export default function PuzzleBoard({ gameState, onGameState, socket, localPlayerId }) {
  const canvasRef = useRef(null);
  const puzzleImageUrl = gameState?.puzzleImageSrc ?? '/puzzle-reference.svg';

  useEffect(() => {
    if (!canvasRef.current || !socket) return undefined;

    const engine = new GameEngine(canvasRef.current, puzzleImageUrl, { 
      onGameState, 
      socket, 
      localPlayerId,
      initialGameState: gameState,
      onPieceSnap: playSnapSound // <-- Pass the sound callback here
    });
    engine.start(puzzleImageUrl).catch((error) => console.error(error));

    return () => {
      engine.destroy();
    };
  }, [gameState?.puzzleImageSrc, onGameState, socket, localPlayerId]);

  return <canvas ref={canvasRef} className="canvas-wrapper" id="puzzle-canvas" aria-label="Scattered jigsaw pieces" />;
}