import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-line bg-panel p-4 shadow-panel ${className}`}>
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded-sm bg-brass px-4 py-2.5 text-sm font-medium text-base disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded-sm border border-line px-4 py-2.5 text-sm text-ink-dim disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed border-line p-6 text-center">
      <div className="text-sm text-ink-dim">{title}</div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

/**
 * Renders the non-ready states of a screen load (see lib/useLoad.ts):
 * загрузка, ошибка, офлайн. Returns null when there is nothing to show, so
 * a screen can render it unconditionally above its real content.
 *
 * Offline gets its own wording and no retry button — retrying without a
 * network just fails again; the user reconnecting is what changes the
 * outcome, and the service worker will already have served a cached Today
 * screen where one exists.
 */
export function LoadState({
  state,
  error,
  onRetry,
}: {
  state: "loading" | "ready" | "error" | "offline";
  error?: string | null;
  onRetry?: () => void;
}) {
  if (state === "ready") return null;

  if (state === "loading") {
    return <div className="px-5 pt-8 text-sm text-ink-faint">Загрузка…</div>;
  }

  if (state === "offline") {
    return (
      <div className="px-5 pt-8">
        <EmptyState
          title="Нет сети"
          hint="Показываем последнее сохранённое состояние, если оно есть. Данные обновятся, когда связь вернётся."
        />
      </div>
    );
  }

  return (
    <div className="px-5 pt-8">
      <div className="rounded-md border border-dashed border-warn/40 p-6 text-center">
        <div className="text-sm text-ink-dim">{error ?? "Не удалось загрузить данные."}</div>
        {onRetry && (
          <GhostButton className="mt-3" onClick={onRetry}>
            Повторить
          </GhostButton>
        )}
      </div>
    </div>
  );
}
