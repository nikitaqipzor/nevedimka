"use client";

import { useLoad } from "@/lib/useLoad";
import type { Evidence } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { EmptyState, Eyebrow, LoadState, Panel } from "@/components/ui";

const KIND_LABEL: Record<Evidence["kind"], string> = {
  text: "текст",
  voice: "голос",
  video: "видео",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function JournalPage() {
  const {
    data,
    state: loadState,
    error: loadError,
    reload,
  } = useLoad<{ evidences: Evidence[] }>(() =>
    apiFetch<{ evidences: Evidence[] }>("/api/journal")
  );
  const evidences = data?.evidences ?? null;

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Дневник</Eyebrow>

      <div className="mt-4 space-y-3">
        {loadState !== "ready" && (
          <LoadState state={loadState} error={loadError} onRetry={reload} />
        )}
        {evidences?.length === 0 && (
          <EmptyState title="Записей пока нет" hint="Отчёты по задачам появятся здесь." />
        )}
        {evidences?.map((e) => (
          <Panel key={e.id}>
            <div className="flex items-center justify-between font-mono text-[11px] text-ink-faint">
              <span>{formatDate(e.createdAt)}</span>
              <span className="text-slate">{KIND_LABEL[e.kind]}</span>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">
              {e.rawText ?? e.transcript ?? "Файл сохранён без расшифровки."}
            </p>
          </Panel>
        ))}
      </div>
    </div>
  );
}
