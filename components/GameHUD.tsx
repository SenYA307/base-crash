type GameHUDProps = {
  score: number;
  moves: number;
  hints: number;
};

export default function GameHUD({ score, moves, hints }: GameHUDProps) {
  return (
    <section className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#111a33] px-4 py-3">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#8aa8ff]">
          Score
        </p>
        <p className="text-xl font-semibold text-white">{score}</p>
      </div>
      <div className="h-10 w-px bg-white/10" />
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#8aa8ff]">
          Hints
        </p>
        <p className="text-xl font-semibold text-white">{hints}</p>
      </div>
      <div className="h-10 w-px bg-white/10" />
      <div className="text-right">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#8aa8ff]">
          Moves
        </p>
        <p className="text-xl font-semibold text-white">{moves}</p>
      </div>
    </section>
  );
}
