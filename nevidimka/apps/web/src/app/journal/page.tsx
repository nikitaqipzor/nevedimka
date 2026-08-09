"use client";

import { useEffect, useState } from "react";
import type { Evidence } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { EmptyState, Eyebrow, Panel } from "@/components/ui";

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
  const [evidences, setEvidences] = useState<Evidence[] | null>(null);

  useEffect(() => {
    apiFetch<{ evidences: Evidence[] }>("/api/journal").then((res) => setEvidences(res.evidences));
  }, []);

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Дневник</Eyebrow>

      <div className="mt-4 space-y-3">
        {evidences === null && <div className="text-sm text-ink-faint">Загрузка…</div>}
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
