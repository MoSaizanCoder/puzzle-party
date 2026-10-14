import '../../styles/pause.css';
import { useEffect, useState } from 'react';

export default function PauseOverlay({ gameState, socket }) {
  const [feedback, setFeedback] = useState('');
  const question = gameState?.triviaQuestion;

  useEffect(() => {
    setFeedback('');
  }, [question?.id]);

  const submitAnswer = (answerId) => {
    if (!socket?.connected || !question) return;
    socket.emit('submit_trivia_answer', { questionId: question.id, answerId }, (result) => {
      setFeedback(result.message);
    });
  };

  return (
    <main className="pause-overlay">
      <section className="trivia-box" aria-labelledby="pause-title">
        <p className="trivia-eyebrow">HELP ROUND</p>
        <h1 id="pause-title">Game paused</h1>
        {question ? (
          <>
            <p className="trivia-question">{question.prompt}</p>
            <div className="trivia-options">
              {question.options.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  disabled={!socket?.connected}
                  onClick={() => submitAnswer(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        ) : <p>Preparing a question...</p>}
        <p className="trivia-feedback" role="status">{feedback}</p>
      </section>
    </main>
  );
}