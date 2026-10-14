const particles = Array.from({ length: 24 }, (_, index) => index);

export default function ConfettiBurst({ onComplete }) {
  return (
    <div className="confetti-overlay" aria-hidden="true">
      {particles.map((particle) => (
        <span
          key={particle}
          className="confetti-piece"
          onAnimationEnd={particle === particles.length - 1 ? onComplete : undefined}
        />
      ))}
    </div>
  );
}