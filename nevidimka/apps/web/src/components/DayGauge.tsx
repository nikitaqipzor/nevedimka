export function DayGauge({
  dayNumber,
  programLength,
  label,
}: {
  dayNumber: number;
  programLength: number;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((dayNumber / programLength) * 100)));

  return (
    <div>
      {label && (
        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">
          {label}
        </div>
      )}
      <div className="flex items-baseline gap-2">
        <span className="tabular font-mono text-5xl font-medium leading-none text-ink">
          {dayNumber}
        </span>
        <span className="tabular font-mono text-base text-ink-dim">/ {programLength}</span>
      </div>
      <div className="mt-3 h-px w-full bg-line">
        <div
          className="h-px bg-brass transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 font-mono text-[11px] tracking-wide text-ink-faint">{pct}%</div>
    </div>
  );
}
