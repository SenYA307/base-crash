export default function BaseHeader() {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#0052ff] text-lg font-semibold text-white shadow-[0_10px_25px_rgba(0,82,255,0.35)]">
          B
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#9cc1ff]">
            Base Mini App
          </p>
          <h1 className="text-2xl font-semibold text-white">Base Crash</h1>
        </div>
      </div>
      <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70">
        Beta
      </span>
    </header>
  );
}
