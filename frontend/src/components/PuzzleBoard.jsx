import { useEffect, useRef } from 'react';
import GameEngine from '../../../engine/GameEngine.js';
import '../../styles/main.css';

export default function PuzzleBoard({ gameState, onGameState, socket, localPlayerId }) { // <-- Add prop here
  const canvasRef = useRef(null);
  const puzzleImageUrl = gameState?.puzzleImageSrc ?? '/puzzle-reference.svg';

  useEffect(() => {
    if (!canvasRef.current || !socket) return undefined;

    // <-- Update this engine creation line to include initialGameState
    const engine = new GameEngine(canvasRef.current, puzzleImageUrl, { 
      onGameState, 
      socket, 
      localPlayerId,
      initialGameState: gameState 
    });
    engine.start(puzzleImageUrl).catch((error) => console.error(error));

    return () => {
      engine.destroy();
    };
  }, [gameState?.puzzleImageSrc, onGameState, socket, localPlayerId]);

  return <canvas ref={canvasRef} className="canvas-wrapper" id="puzzle-canvas" aria-label="Scattered jigsaw pieces" />;
}