export function FullScreenMessage({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      {eyebrow && (
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">
          {eyebrow}
        </div>
      )}
      <div className="text-lg font-medium text-ink">{title}</div>
      {subtitle && <div className="max-w-xs text-sm text-ink-dim">{subtitle}</div>}
    </div>
  );
}
